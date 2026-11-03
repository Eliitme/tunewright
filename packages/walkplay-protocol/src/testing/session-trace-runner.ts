/**
 * Runs a declarative session scenario against the fake DAC and records every
 * report sent plus each step's outcome. The same JSON scenarios are replayed
 * by the Swift port, so both sessions must behave byte-for-byte alike.
 */
import { FakeWalkplayDacTransport } from "./fake-walkplay-dac-transport.ts";
import { toHex } from "./packet-vector-runner.ts";
import { TP35_PRO_PROFILE } from "../device-profile-tp35-pro.ts";
import { WalkplaySession } from "../walkplay-session.ts";
import { buildBandWritePacket } from "../walkplay-packet-builders.ts";
import type { DeviceEqState } from "../preset-device-mapping.ts";
import type { Clock } from "../walkplay-request-channel.ts";

export interface FakeDacSetup {
  initialState?: DeviceEqState;
  transientFlatReads?: number;
  /** Drop band writes to `index` carrying `gain`, at most `times` times (-1 = always). */
  dropBandWrite?: { index: number; gain: number; times: number };
  /** Unplug the DAC when this many reports have been sent. */
  unplugAtSend?: number;
}

export type TraceStep =
  | { op: "readInitialState" }
  | { op: "applyVerified"; state: DeviceEqState }
  | { op: "applyLiveBurst"; states: DeviceEqState[] }
  | { op: "save"; state: DeviceEqState };

export interface SessionTrace {
  name: string;
  fake: FakeDacSetup;
  steps: TraceStep[];
  expected?: { sentHex: string[]; results: unknown[] };
}

/** Clock that never really waits; time advances only through sleeps. */
export function instantClock(): Clock {
  let t = 0;
  return { now: () => t, sleep: async (ms) => void (t += Math.max(0, ms)) };
}

function seedFake(fake: FakeWalkplayDacTransport, state: DeviceEqState): void {
  // Stored bytes are exactly what a band write produces, as on the real DAC.
  fake.ramPreamp = fake.flashPreamp = state.preamp;
  state.bands.forEach((b, i) => {
    fake.ramBands[i] = fake.flashBands[i] = encode(i, b);
  });
}

const encode = (i: number, b: DeviceEqState["bands"][number]) =>
  buildBandWritePacket(i, b, TP35_PRO_PROFILE.dspSampleRate);

export async function runSessionTrace(trace: SessionTrace) {
  const { dropBandWrite, unplugAtSend } = trace.fake;
  let dropsLeft = dropBandWrite?.times ?? 0;
  const fake: FakeWalkplayDacTransport = new FakeWalkplayDacTransport({
    transientFlatReads: trace.fake.transientFlatReads ?? 0,
    drop: (p, sendIndex) => {
      if (unplugAtSend !== undefined && sendIndex + 1 >= unplugAtSend) {
        queueMicrotask(() => fake.unplug());
        return true;
      }
      if (!dropBandWrite || p[0] !== 0x01 || p[1] !== 0x09 || p[4] !== dropBandWrite.index) return false;
      const gain = new DataView(p.buffer, p.byteOffset).getInt16(31, true) / 256;
      if (Math.abs(gain - dropBandWrite.gain) > 1e-6 || dropsLeft === 0) return false;
      dropsLeft--;
      return true;
    },
  });
  if (trace.fake.initialState) seedFake(fake, trace.fake.initialState);
  const session = new WalkplaySession(fake, TP35_PRO_PROFILE, { clock: instantClock(), initialNonce: 0 });
  const results: unknown[] = [];
  for (const step of trace.steps) {
    try {
      switch (step.op) {
        case "readInitialState": {
          const r = await session.readInitialState();
          results.push({ ok: true, confirmed: r.confirmed, preamp: r.state.preamp });
          break;
        }
        case "applyVerified":
          await session.applyVerified(step.state);
          results.push({ ok: true });
          break;
        case "applyLiveBurst":
          await Promise.all(step.states.map((s) => session.applyLive(s)));
          results.push({ ok: true });
          break;
        case "save":
          await session.save(step.state);
          results.push({ ok: true, flashPreamp: fake.flashPreamp });
          break;
      }
    } catch (error) {
      const e = error as Error & { restored?: boolean };
      results.push({ ok: false, error: e.name, ...(e.restored !== undefined && { restored: e.restored }) });
    }
  }
  session.dispose();
  return { sentHex: fake.sent.map(toHex), results };
}
