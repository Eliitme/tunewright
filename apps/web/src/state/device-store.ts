/**
 * Device state for the editor. The WalkplaySession lives outside the store
 * (it is not serializable); the store holds what the UI renders.
 */
import { create } from "zustand";
import {
  cloneState,
  EqVerifyError,
  statesMatch,
  TP35_PRO_PROFILE,
  WalkplaySession,
  type Clock,
  type DeviceEqState,
  type FilterMode,
  type FilterSpec,
  type HidTransport,
} from "@tunewright/walkplay-protocol";

export type DeviceStatus = "disconnected" | "connecting" | "ready" | "error";

export interface DeviceStore {
  status: DeviceStatus;
  firmware: string | null;
  /** False while the DAC answered with a flat EQ that could not be corroborated; editing and saving are blocked. */
  confirmed: boolean;
  eq: DeviceEqState | null;
  /** EQ as of the last confirmed read or Save; the editor is dirty when `eq` differs. */
  savedEq: DeviceEqState | null;
  filterMode: FilterMode | null;
  highGain: boolean | null;
  /** Another app (or tab) seems to be talking to the DAC. */
  foreignActivity: boolean;
  busy: boolean;
  message: string | null;
  selectedBand: number;
  connectWith(transport: HidTransport, options?: { clock?: Clock }): Promise<void>;
  disconnect(): Promise<void>;
  selectBand(index: number): void;
  updateBand(index: number, patch: Partial<FilterSpec>): void;
  setPreamp(db: number): void;
  /** Sets every band to 0 dB and the preamp to 0 (types, frequencies and Q are kept). Live, not saved. */
  resetFlat(): void;
  /** Writes a whole EQ with verification. Resolves true on success. */
  applyState(state: DeviceEqState, filterMode?: FilterMode): Promise<boolean>;
  save(): Promise<void>;
  revert(): Promise<void>;
  rereadDevice(): Promise<void>;
  setFilterMode(mode: FilterMode): Promise<void>;
  setHighGain(high: boolean): Promise<void>;
  restoreDefaults(): Promise<void>;
  setMessage(message: string | null): void;
  flushLiveWrite(): Promise<void>;
}

let session: WalkplaySession | null = null;
let transport: HidTransport | null = null;
let liveTimer: ReturnType<typeof setTimeout> | null = null;
let foreignTimer: ReturnType<typeof setInterval> | null = null;
const LIVE_DEBOUNCE_MS = 100;

const cancelLiveWrite = () => {
  if (liveTimer) clearTimeout(liveTimer);
  liveTimer = null;
};

export const isDirty = (s: Pick<DeviceStore, "eq" | "savedEq">) =>
  !!s.eq && !!s.savedEq && !statesMatch(s.eq, s.savedEq);

const DISCONNECTED = {
  eq: null,
  savedEq: null,
  firmware: null,
  confirmed: false,
  filterMode: null,
  highGain: null,
  foreignActivity: false,
  busy: false,
} as const;

export const useDeviceStore = create<DeviceStore>((set, get) => {
  /**
   * Runs a device operation with a busy flag and error reporting. Results from
   * a session that was replaced or closed meanwhile are dropped.
   */
  async function run(label: string, task: (s: WalkplaySession) => Promise<void>): Promise<boolean> {
    const current = session;
    if (!current) return false;
    set({ busy: true, message: null });
    try {
      await task(current);
      return true;
    } catch (error) {
      if (session !== current) return false;
      const message = `${label} failed: ${(error as Error).message}`;
      if (error instanceof EqVerifyError) await resync(current).catch(() => undefined);
      set({ message });
      return false;
    } finally {
      if (session === current) set({ busy: false });
    }
  }

  /** Re-reads the DAC and makes that the new baseline (only when the read is confirmed). */
  async function resync(s: WalkplaySession) {
    const { state, confirmed } = await s.readInitialState();
    if (session !== s) return;
    set(confirmed ? { eq: state, savedEq: cloneState(state), confirmed } : { eq: state, confirmed });
  }

  function scheduleLiveWrite() {
    cancelLiveWrite();
    liveTimer = setTimeout(() => void get().flushLiveWrite(), LIVE_DEBOUNCE_MS);
  }

  function editEq(mutate: (eq: DeviceEqState) => void) {
    const { eq, confirmed, busy } = get();
    if (!eq || !confirmed || busy) return;
    const next = cloneState(eq);
    mutate(next);
    set({ eq: next });
    scheduleLiveWrite();
  }

  /** Nulls the module state synchronously so a concurrent connect is never wiped, then closes. */
  async function teardown(status: DeviceStatus, message: string | null) {
    cancelLiveWrite();
    if (foreignTimer) clearInterval(foreignTimer);
    foreignTimer = null;
    const oldSession = session;
    const oldTransport = transport;
    session = transport = null;
    set({ ...DISCONNECTED, status, message });
    oldSession?.dispose();
    await oldTransport?.close().catch(() => undefined);
  }

  return {
    status: "disconnected",
    ...DISCONNECTED,
    message: null,
    selectedBand: 0,

    async connectWith(next, options = {}) {
      await teardown("connecting", null);
      const mine = new WalkplaySession(next, TP35_PRO_PROFILE, { clock: options.clock });
      session = mine;
      transport = next;
      // Ignore late disconnect events from a transport that was already replaced.
      next.onDisconnect(() => void (transport === next && teardown("disconnected", "TP35 Pro disconnected")));
      try {
        const firmware = await mine.readVersion();
        const { state, confirmed } = await mine.readInitialState();
        const filterMode = await mine.utility.readFilterMode();
        const highGain = await mine.utility.readHighGain();
        if (session !== mine) return;
        set({ status: "ready", firmware, confirmed, eq: state, savedEq: cloneState(state), filterMode, highGain });
      } catch (error) {
        if (session === mine) await teardown("error", `Could not read the DAC: ${(error as Error).message}`);
        return;
      }
      let seen = mine.unsolicitedReports;
      foreignTimer = setInterval(() => {
        const now = mine.unsolicitedReports;
        if (now > seen) set({ foreignActivity: true });
        seen = now;
      }, 2000);
    },

    disconnect: () => teardown("disconnected", null),
    selectBand: (index) => set({ selectedBand: index }),
    updateBand: (index, patch) =>
      editEq((eq) => {
        const band = Object.assign(eq.bands[index]!, patch);
        // Pass filters have no gain; keeping it at 0 stops a stale value from moving the handle or the clip check.
        if (band.type === "LP" || band.type === "HP") band.gain = 0;
      }),
    setPreamp: (db) => editEq((eq) => void (eq.preamp = db)),
    resetFlat: () =>
      editEq((eq) => {
        eq.preamp = 0;
        eq.bands.forEach((b) => (b.gain = 0));
      }),

    async flushLiveWrite() {
      cancelLiveWrite();
      const current = session;
      const { eq } = get();
      if (!current || !eq) return;
      await current.applyLive(eq).catch((e: Error) => session === current && set({ message: `Write failed: ${e.message}` }));
    },

    applyState: (state, filterMode) =>
      run("Applying preset", async (s) => {
        cancelLiveWrite();
        await s.applyVerified(state);
        set({ eq: cloneState(state), confirmed: true });
        if (filterMode && filterMode !== get().filterMode) {
          await s.utility.setFilterMode(filterMode);
          set({ filterMode });
        }
      }),

    save: () =>
      run("Saving to the DAC", async (s) => {
        const { eq, confirmed } = get();
        if (!eq || !confirmed) return;
        cancelLiveWrite();
        await s.save(eq);
        set({ savedEq: cloneState(eq), message: "Saved to the DAC" });
      }).then(() => undefined),

    async revert() {
      const { savedEq, confirmed } = get();
      if (savedEq && confirmed) await get().applyState(savedEq);
    },

    rereadDevice: () => run("Reading the DAC", resync).then(() => undefined),

    setFilterMode: (mode) =>
      run("Filter mode", async (s) => (await s.utility.setFilterMode(mode), set({ filterMode: mode }))).then(() => undefined),
    setHighGain: (high) =>
      run("Gain mode", async (s) => (await s.utility.setHighGain(high), set({ highGain: high }))).then(() => undefined),

    restoreDefaults: () =>
      run("Restore defaults", async (s) => {
        cancelLiveWrite();
        await s.utility.restoreDefaults();
        // The DAC reloads its stored EQ, so the read-back is also the saved baseline.
        await resync(s);
        set({ filterMode: await s.utility.readFilterMode(), highGain: await s.utility.readHighGain() });
      }).then(() => undefined),

    setMessage: (message) => set({ message }),
  };
});
