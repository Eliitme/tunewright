/**
 * Presets as kept in this browser. Every preset is usable offline; presets
 * owned by the signed-in account also carry their server revision and a dirty
 * flag that the sync engine uses to push changes.
 */
import { create } from "zustand";
import {
  parseAutoEqText,
  presetToDeviceState,
  safeParsePreset,
  safePreamp,
  TP35_PRO_PROFILE,
  type DeviceEqState,
  type EqPreset,
  type FilterMode,
} from "@tunewright/walkplay-protocol";
import { readJson, writeJson } from "../lib/safe-local-storage.ts";

export interface StoredPreset {
  id: string;
  preset: EqPreset;
  updatedAt: number;
  /** Account id this preset syncs with; null for presets that live only in this browser. */
  owner: string | null;
  /** Server revision of the last synced state; 0 when never synced. */
  rev: number;
  /** Has local changes the server has not seen yet. */
  dirty: boolean;
  /** Deleted locally, waiting for the server to confirm. Hidden from the UI. */
  deleted: boolean;
  /** Last push failure for this preset (e.g. quota), shown next to it. */
  syncError?: string;
}

export const PRESETS_STORAGE_KEY = "tunewright.presets.v1";

export interface PresetRepository {
  load(): StoredPreset[];
  persist(presets: StoredPreset[]): boolean;
}

const isStoredPreset = (p: unknown): p is StoredPreset =>
  !!p &&
  typeof p === "object" &&
  typeof (p as StoredPreset).id === "string" &&
  safeParsePreset((p as StoredPreset).preset).success;

/** Older entries had only id/preset/updatedAt; they become local-only presets. */
const normalize = (p: StoredPreset): StoredPreset => ({
  id: p.id,
  preset: p.preset,
  updatedAt: typeof p.updatedAt === "number" ? p.updatedAt : 0,
  owner: typeof p.owner === "string" ? p.owner : null,
  rev: Number.isSafeInteger(p.rev) && p.rev > 0 ? p.rev : 0,
  dirty: p.dirty === true,
  deleted: p.deleted === true,
  ...(typeof p.syncError === "string" && { syncError: p.syncError }),
});

export const localPresetRepository: PresetRepository = {
  // Corrupted or foreign data is dropped instead of crashing the app on load.
  load: () => {
    const raw = readJson<unknown>(PRESETS_STORAGE_KEY, []);
    return Array.isArray(raw) ? raw.filter(isStoredPreset).map(normalize) : [];
  },
  persist: (presets) => writeJson(PRESETS_STORAGE_KEY, presets),
};

/** Builds a validated preset from the device state; throws a readable error if the DAC holds values presets can't store. */
export function stateToPreset(name: string, state: DeviceEqState, filterMode: FilterMode | null): EqPreset {
  const parsed = safeParsePreset({
    schema: 1,
    name: name.trim().slice(0, 64) || "Untitled",
    preamp: state.preamp,
    bands: state.bands.map((b) => ({ type: b.type, freq: b.freq, q: b.q, gain: b.gain })),
    ...(filterMode && { filterMode }),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`The current EQ can't be saved as a preset: ${issue ? `${issue.path.join(".")} ${issue.message}` : "invalid"}`);
  }
  return parsed.data;
}

export interface ImportDraft {
  preset: EqPreset;
  state: DeviceEqState;
  /** Preamp was lowered to keep the EQ from clipping. */
  preampLowered: boolean;
  skippedLines: string[];
}

/**
 * Parses AutoEQ text or preset JSON into a validated, device-mappable preset
 * with a clip-safe preamp. Throws with a readable message when it cannot.
 */
export function prepareImport(text: string, fallbackName: string): ImportDraft {
  let raw: unknown;
  let skippedLines: string[] = [];
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    raw = JSON.parse(trimmed);
  } else {
    const draft = parseAutoEqText(trimmed, fallbackName);
    skippedLines = draft.skippedLines;
    raw = { schema: draft.schema, name: draft.name, preamp: draft.preamp, bands: draft.bands };
  }
  const parsed = safeParsePreset(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Not a valid preset: ${issue ? `${issue.path.join(".")} ${issue.message}` : "unknown error"}`);
  }
  const state = presetToDeviceState(parsed.data, TP35_PRO_PROFILE);
  const safe = safePreamp(state, TP35_PRO_PROFILE);
  if (!safe.clipSafe) throw new Error("This preset boosts more than the preamp can compensate; it was not imported.");
  const preampLowered = safe.preamp < state.preamp;
  return { preset: { ...parsed.data, preamp: safe.preamp }, state: { ...state, preamp: safe.preamp }, preampLowered, skippedLines };
}

export interface PresetStore {
  presets: StoredPreset[];
  /** Signed-in account; new presets are created for it. */
  account: string | null;
  activeId: string | null;
  storageFailed: boolean;
  /** Preset JSON waiting to be reviewed in the import dialog (e.g. opened from a share link). */
  pendingImport: string | null;
  add(preset: EqPreset): StoredPreset;
  update(id: string, preset: EqPreset): void;
  remove(id: string): void;
  setActive(id: string | null): void;
  setAccount(account: string | null): void;
  setPendingImport(text: string | null): void;
  /** Sync engine write access: replace or drop single entries without touching the rest. */
  putSynced(item: StoredPreset): void;
  dropSynced(id: string): void;
  /** Re-reads storage after another tab changed it, so this tab never writes back a stale list. */
  reload(): void;
}

/** What the UI lists: local-only presets plus the signed-in account's, minus pending deletes. */
export const visiblePresets = (s: Pick<PresetStore, "presets" | "account">) =>
  s.presets.filter((p) => !p.deleted && (p.owner === null || p.owner === s.account));

export const createPresetStore = (repo: PresetRepository) =>
  create<PresetStore>((set, get) => {
    const commit = (presets: StoredPreset[]) => set({ presets, storageFailed: !repo.persist(presets) });
    const owned = (p: StoredPreset) => p.owner !== null && p.owner === get().account;
    return {
      presets: repo.load(),
      account: null,
      activeId: null,
      storageFailed: false,
      pendingImport: null,
      add(preset) {
        const owner = get().account;
        const item: StoredPreset = { id: crypto.randomUUID(), preset, updatedAt: Date.now(), owner, rev: 0, dirty: owner !== null, deleted: false };
        commit([...get().presets, item]);
        return item;
      },
      update: (id, preset) =>
        commit(get().presets.map((p) => (p.id === id ? { ...p, preset, updatedAt: Date.now(), dirty: owned(p) } : p))),
      remove(id) {
        // An account preset stays as a hidden tombstone until the sync engine settles it, even if it was
        // never synced: its first upload may be in flight, and the server copy must then be deleted too.
        commit(
          get().presets.flatMap((p) => {
            if (p.id !== id) return [p];
            return owned(p) ? [{ ...p, deleted: true, dirty: true, updatedAt: Date.now() }] : [];
          }),
        );
        if (get().activeId === id) set({ activeId: null });
      },
      setActive: (id) => set({ activeId: id }),
      setAccount: (account) => set({ account }),
      setPendingImport: (pendingImport) => set({ pendingImport }),
      putSynced(item) {
        const exists = get().presets.some((p) => p.id === item.id);
        commit(exists ? get().presets.map((p) => (p.id === item.id ? item : p)) : [...get().presets, item]);
      },
      dropSynced: (id) => commit(get().presets.filter((p) => p.id !== id)),
      // When storage is unavailable, memory is the only copy: never replace it with an empty read.
      reload: () => !get().storageFailed && set({ presets: repo.load() }),
    };
  });

export const usePresetStore = createPresetStore(localPresetRepository);
