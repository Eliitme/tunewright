import { describe, expect, it } from "vitest";
import { TP35_PRO_PROFILE } from "../device-profile-tp35-pro.ts";
import { FLAT_BAND, type DeviceEqState } from "../preset-device-mapping.ts";
import { EqVerifyError, WalkplaySession } from "../walkplay-session.ts";
import { FakeWalkplayDacTransport } from "../testing/fake-walkplay-dac-transport.ts";
import { instantClock } from "../testing/session-trace-runner.ts";
import { parseBandResponse } from "../walkplay-response-parsers.ts";
import { CMD, DIR_READ } from "../walkplay-wire-constants.ts";

const withBand3 = (gain: number, preamp = -4): DeviceEqState => ({
  preamp,
  bands: Array.from({ length: 10 }, (_, i) => (i === 3 ? { type: "PK" as const, freq: 2000, q: 1, gain } : { ...FLAT_BAND })),
});
const storedGain = (dac: FakeWalkplayDacTransport, i: number) => {
  const p = dac.ramBands[i]!.slice();
  p[0] = DIR_READ;
  return parseBandResponse(p)!.gain;
};
const newSession = (dac: FakeWalkplayDacTransport) =>
  new WalkplaySession(dac, TP35_PRO_PROFILE, { clock: instantClock() });

describe("band read nonce", () => {
  it("ignores a band reply whose nonce does not match", async () => {
    const dac = new FakeWalkplayDacTransport();
    dac.ramPreamp = -3;
    const realSend = dac.send.bind(dac);
    let injected = false;
    dac.send = async (id, p) => {
      // Another app's reply for band 0 (nonce 0) arrives right before ours.
      if (!injected && p[1] === CMD.BAND && p[0] === DIR_READ) {
        injected = true;
        const foreign = dac.ramBands[0]!.slice();
        foreign[0] = DIR_READ;
        foreign[2] = 0;
        foreign[31] = 0x00;
        foreign[32] = 0x09; // +9 dB, must not be trusted
        dac.emitForeignReport(foreign);
        return realSend(id, p);
      }
      return realSend(id, p);
    };
    const s = new WalkplaySession(dac, TP35_PRO_PROFILE, { clock: instantClock(), initialNonce: 0 });
    const { state } = await s.readInitialState();
    expect(state.bands[0]!.gain).toBe(0);
  });
});

describe("session ordering", () => {
  it("a preset switch supersedes a live edit queued before it", async () => {
    const dac = new FakeWalkplayDacTransport();
    const s = newSession(dac);
    const first = s.applyLive(withBand3(1));
    const stale = s.applyLive(withBand3(2));
    const preset = s.applyVerified(withBand3(7));
    await Promise.all([first, stale, preset]);
    expect(storedGain(dac, 3)).toBe(7);
  });

  it("copies inputs so in-place mutation is still detected as a change", async () => {
    const dac = new FakeWalkplayDacTransport();
    const s = newSession(dac);
    const state = withBand3(1);
    await s.applyLive(state);
    state.bands[3]!.gain = 5;
    await s.applyLive(state);
    expect(storedGain(dac, 3)).toBe(5);
  });

  it("rewrites slots that read back erased", async () => {
    const dac = new FakeWalkplayDacTransport({ transientFlatReads: 1 }); // band 0 reads erased once
    dac.ramPreamp = -3; // not a flat-looking DAC, so the initial read is trusted as is
    const s = newSession(dac);
    const { state } = await s.readInitialState();
    state.bands[3] = { type: "PK", freq: 2000, q: 1, gain: 2 };
    const before = dac.sent.length;
    await s.applyLive(state);
    const writtenIndexes = dac.sent.slice(before).filter((p) => p[1] === CMD.BAND).map((p) => p[4]);
    expect(writtenIndexes).toEqual([0, 3]);
  });
});

describe("session recovery", () => {
  it("forgets the device state when restore fails, so the next live write sends every band", async () => {
    const dac = new FakeWalkplayDacTransport({ drop: (p) => p[1] === CMD.BAND && p[4] === 3 });
    const s = newSession(dac);
    await expect(s.applyVerified(withBand3(3))).rejects.toMatchObject({ name: "EqVerifyError", restored: false });
    const before = dac.sent.length;
    await s.applyLive(withBand3(3));
    expect(dac.sent.slice(before).filter((p) => p[1] === CMD.BAND)).toHaveLength(10);
  });

  it("a verify readback timeout is treated as a mismatch and retried", async () => {
    let dropReads = 3; // band 0 read and both of its retries time out on the first verify
    const dac = new FakeWalkplayDacTransport({ drop: (p) => p[0] === DIR_READ && dropReads-- > 0 });
    const s = newSession(dac);
    await expect(s.applyVerified(withBand3(3))).resolves.toBeUndefined();
  });

  it("surfaces EqVerifyError rather than a raw timeout", async () => {
    const dac = new FakeWalkplayDacTransport({ drop: (p) => p[0] === DIR_READ });
    const s = newSession(dac);
    const error = await s.applyVerified(withBand3(3)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EqVerifyError);
  });

  it("a failed send is reported as a disconnect", async () => {
    const dac = new FakeWalkplayDacTransport();
    dac.send = async () => {
      throw new DOMException("gone", "NetworkError");
    };
    await expect(newSession(dac).readVersion()).rejects.toMatchObject({ name: "DeviceDisconnectedError" });
  });
});
