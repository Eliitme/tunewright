/**
 * High-level EQ session for a Walkplay DAC.
 *
 * Every verified write follows: snapshot → write → RAM apply → verify → retry
 * once → restore snapshot. Flash is written only after a verified RAM state.
 * Live edits are coalesced latest-wins and are superseded by any verified
 * operation (preset switch, save, re-read) that runs after them.
 */
import type { DeviceProfile } from "./device-profile-tp35-pro.ts";
import { changedBandIndexes, looksLikeTransientReset, statesMatch } from "./eq-state-comparison.ts";
import { DeviceTimeoutError, type HidTransport } from "./hid-transport.ts";
import * as build from "./walkplay-packet-builders.ts";
import * as parse from "./walkplay-response-parsers.ts";
import { realClock, WalkplayRequestChannel, type Clock } from "./walkplay-request-channel.ts";
import { cloneState, type DeviceEqState } from "./preset-device-mapping.ts";
import { CMD } from "./walkplay-wire-constants.ts";
import { WalkplayUtilityControls } from "./walkplay-utility-controls.ts";
import { WalkplayProbeAccess } from "./walkplay-probe-access.ts";

export class EqVerifyError extends Error {
  readonly restored: boolean;

  constructor(restored: boolean) {
    super(
      restored
        ? "DAC did not accept the EQ; previous EQ restored"
        : "DAC did not accept the EQ and the previous EQ could not be restored",
    );
    this.name = "EqVerifyError";
    this.restored = restored;
  }
}

export interface ReadStateResult {
  state: DeviceEqState;
  /** False when the read looked like a transient reset and could not be corroborated. */
  confirmed: boolean;
}

export interface SessionOptions {
  clock?: Clock;
  /** Exposes raw report access for hardware probing tools only. */
  enableProbeAccess?: boolean;
  /** Starting point of the band-read nonce; random by default, fixed in tests. */
  initialNonce?: number;
}

interface PendingLive {
  state: DeviceEqState;
  waiters: { resolve: () => void; reject: (e: unknown) => void }[];
}

export class WalkplaySession {
  readonly profile: DeviceProfile;
  /** Filter mode, gain mode, restore defaults, register reads. */
  readonly utility: WalkplayUtilityControls;
  readonly probe: WalkplayProbeAccess | null;
  private readonly channel: WalkplayRequestChannel;
  /** Last state read back from the DAC and confirmed; null when the DAC state is unknown. */
  private verified: DeviceEqState | null = null;
  /** Last state sent to RAM; null forces the next write to send every band. */
  private sent: DeviceEqState | null = null;
  /** Slots that read back erased; always rewritten by the next write. */
  private erasedSlots = new Set<number>();
  private pending: PendingLive | null = null;
  private liveTaskQueued = false;
  private nonce: number;
  private readonly useNonce: boolean;

  constructor(transport: HidTransport, profile: DeviceProfile, options: SessionOptions = {}) {
    this.profile = profile;
    this.channel = new WalkplayRequestChannel(transport, profile.reportId, profile.reportIntervalMs, options.clock ?? realClock);
    this.utility = new WalkplayUtilityControls(this.channel, profile, () => this.forgetDeviceState());
    this.probe = options.enableProbeAccess ? new WalkplayProbeAccess(this.channel) : null;
    this.nonce = options.initialNonce ?? Math.floor(Math.random() * 255);
    this.useNonce = !profile.probeGated.includes("readNonceEcho");
  }

  get unsolicitedReports(): number {
    return this.channel.unsolicitedReports;
  }

  readVersion(): Promise<string | null> {
    return this.channel.enqueue(async () =>
      parse.parseVersionResponse(
        await this.channel.request(build.buildVersionRequest(), (p) => parse.isResponse(p, CMD.VERSION), {
          label: "firmware version",
        }),
      ),
    );
  }

  /** Initial read after connect: waits for the DAC to settle and corroborates a flat read. */
  readInitialState(): Promise<ReadStateResult> {
    return this.channel.enqueue(async () => {
      this.supersedePendingLive();
      await this.channel.sleep(this.profile.connectSettleMs);
      let state = await this.readStateUnqueued();
      let confirmed = true;
      if (looksLikeTransientReset(state)) {
        await this.channel.sleep(100);
        const again = await this.readStateUnqueued();
        confirmed = statesMatch(state, again);
        state = again;
      }
      if (confirmed) this.verified = this.sent = cloneState(state);
      else this.forgetDeviceState();
      return { state: cloneState(state), confirmed };
    });
  }

  /**
   * Live edit path: coalesced latest-wins, writes changed bands + RAM apply,
   * no readback. Resolves once this state (or a newer one) has been sent, or
   * when a verified operation supersedes it.
   */
  applyLive(state: DeviceEqState): Promise<void> {
    return new Promise((resolve, reject) => {
      const waiters = this.pending?.waiters ?? [];
      waiters.push({ resolve, reject });
      this.pending = { state: cloneState(state), waiters };
      if (this.liveTaskQueued) return;
      this.liveTaskQueued = true;
      void this.channel.enqueue(() => this.runPendingLive());
    });
  }

  /** Writes and verifies a whole state (preset switch, import). Rolls back on failure. */
  applyVerified(state: DeviceEqState): Promise<void> {
    const target = cloneState(state);
    return this.channel.enqueue(() => {
      this.supersedePendingLive();
      return this.writeVerifiedUnqueued(target);
    });
  }

  /** Verifies the RAM state (rewriting it if needed), then persists it to flash. */
  save(state: DeviceEqState): Promise<void> {
    const target = cloneState(state);
    return this.channel.enqueue(async () => {
      this.supersedePendingLive();
      await this.writeVerifiedUnqueued(target);
      await this.channel.write(build.buildFlashSavePacket());
      await this.channel.sleep(this.profile.postFlashReadDelayMs);
    });
  }

  dispose(): void {
    this.channel.dispose();
  }

  /** Runs inside the queue, so it always writes the newest pending state. */
  private async runPendingLive(): Promise<void> {
    this.liveTaskQueued = false;
    const pending = this.pending;
    this.pending = null;
    if (!pending) return;
    try {
      await this.writeUnqueued(pending.state, this.indexesToWrite(pending.state));
      pending.waiters.forEach((w) => w.resolve());
    } catch (error) {
      pending.waiters.forEach((w) => w.reject(error));
    }
  }

  /** A verified operation overrides any live edit queued before it; the edit is dropped, not failed. */
  private supersedePendingLive(): void {
    const pending = this.pending;
    this.pending = null;
    pending?.waiters.forEach((w) => w.resolve());
  }

  private async writeVerifiedUnqueued(state: DeviceEqState): Promise<void> {
    const snapshot = this.verified;
    for (let attempt = 0; attempt < 2; attempt++) {
      await this.writeUnqueued(state, allIndexes(state), true);
      if (await this.readbackMatches(state)) {
        this.verified = cloneState(state);
        return;
      }
    }
    let restored = false;
    if (snapshot) {
      await this.writeUnqueued(snapshot, allIndexes(snapshot), true);
      restored = await this.readbackMatches(snapshot);
    }
    if (!restored) this.forgetDeviceState();
    throw new EqVerifyError(restored);
  }

  /** A readback that times out counts as a mismatch; a disconnect still propagates. */
  private async readbackMatches(state: DeviceEqState): Promise<boolean> {
    try {
      return statesMatch(await this.readStateUnqueued(), state);
    } catch (error) {
      if (error instanceof DeviceTimeoutError) return false;
      throw error;
    }
  }

  private indexesToWrite(state: DeviceEqState): number[] {
    const set = new Set([...changedBandIndexes(this.sent, state), ...this.erasedSlots]);
    return [...set].sort((a, b) => a - b);
  }

  /** Builds every packet first so an encoding error can never leave a half-written DAC. */
  private async writeUnqueued(state: DeviceEqState, bandIndexes: number[], includePreamp = false): Promise<void> {
    const packets = bandIndexes.map((i) => {
      const band = state.bands[i];
      if (!band) throw new RangeError(`Missing band ${i}`);
      return build.buildBandWritePacket(i, band, this.profile.dspSampleRate);
    });
    if (includePreamp || !this.sent || this.sent.preamp !== state.preamp) {
      packets.push(build.buildPreampWritePacket(state.preamp));
    }
    // Until the RAM apply lands the DAC is in an unknown mix of old and new bands.
    this.sent = null;
    for (const packet of packets) await this.channel.write(packet);
    await this.channel.write(build.buildRamApplyPacket());
    bandIndexes.forEach((i) => this.erasedSlots.delete(i));
    this.sent = cloneState(state);
  }

  private async readStateUnqueued(): Promise<DeviceEqState> {
    const bands = [];
    for (let i = 0; i < this.profile.bandCount; i++) {
      // Nonces 1..255 (never 0): replies to other apps or to our own timed-out reads are not matched.
      const nonce = this.useNonce ? (this.nonce = (this.nonce % 255) + 1) : 0;
      const payload = await this.channel.request(
        build.buildBandReadRequest(i, nonce),
        (p) => parse.isBandResponse(p, i) && (!this.useNonce || p[2] === nonce),
        { label: `band ${i}` },
      );
      const band = parse.parseBandResponse(payload);
      if (!band) throw new Error(`Unreadable band ${i}`);
      if (band.valid) this.erasedSlots.delete(i);
      else this.erasedSlots.add(i);
      bands.push({ type: band.type, freq: band.freq, q: band.q, gain: band.gain });
    }
    const preampPayload = await this.channel.request(
      build.buildPreampReadRequest(),
      (p) => parse.isResponse(p, CMD.PREAMP) && p.length >= 5,
      { label: "preamp" },
    );
    const preamp = parse.parsePreampResponse(preampPayload);
    if (preamp === null) throw new Error("Unreadable preamp");
    return { preamp, bands };
  }

  private forgetDeviceState(): void {
    this.verified = this.sent = null;
  }
}

const allIndexes = (state: DeviceEqState) => state.bands.map((_, i) => i);
