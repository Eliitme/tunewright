/** Records expected outputs for the declarative session scenarios (TS/Swift parity). */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runSessionTrace, type SessionTrace } from "../src/testing/session-trace-runner.ts";
import type { DeviceEqState } from "../src/preset-device-mapping.ts";

const root = fileURLToPath(new URL("../../../test-vectors/", import.meta.url));
const flat = { type: "PK" as const, freq: 1000, q: 1, gain: 0 };
const state = (preamp: number, gain3: number): DeviceEqState => ({
  preamp,
  bands: Array.from({ length: 10 }, (_, i) =>
    i === 0 ? { type: "LSQ" as const, freq: 105, q: 0.71, gain: 4.5 }
    : i === 3 ? { type: "PK" as const, freq: 2500, q: 2, gain: gain3 }
    : { ...flat }),
});
const A = state(-5, 3);
const B = state(-6, -2);

const traces: SessionTrace[] = [
  { name: "initial read of a genuinely flat DAC is confirmed", fake: {}, steps: [{ op: "readInitialState" }] },
  { name: "transient flat read is not trusted", fake: { initialState: { ...A, preamp: 0 }, transientFlatReads: 10 }, steps: [{ op: "readInitialState" }] },
  { name: "verified apply succeeds", fake: {}, steps: [{ op: "applyVerified", state: A }] },
  { name: "dropped band is retried once", fake: { dropBandWrite: { index: 3, gain: 3, times: 1 } }, steps: [{ op: "applyVerified", state: A }] },
  { name: "persistent drop restores the previous verified EQ", fake: { initialState: B, dropBandWrite: { index: 3, gain: 3, times: -1 } }, steps: [{ op: "readInitialState" }, { op: "applyVerified", state: A }] },
  { name: "save verifies then flashes", fake: {}, steps: [{ op: "save", state: A }] },
  { name: "failed verify never flashes", fake: { dropBandWrite: { index: 3, gain: 3, times: -1 } }, steps: [{ op: "save", state: A }] },
  { name: "live burst writes only the newest state", fake: {}, steps: [{ op: "applyLiveBurst", states: [A, state(-5, 4), state(-5, 5), B] }] },
  { name: "unplug mid batch rejects", fake: { unplugAtSend: 4 }, steps: [{ op: "applyVerified", state: A }] },
];

const out = [];
for (const t of traces) out.push({ ...t, expected: await runSessionTrace(t) });
writeFileSync(`${root}session-traces.json`, JSON.stringify({ source: "generated", traces: out }, null, 2) + "\n");
for (const t of out) console.log(t.name, "→", JSON.stringify(t.expected.results), `${t.expected.sentHex.length} reports`);
