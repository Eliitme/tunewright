/**
 * Generated vectors: edge cases the capture does not cover (other filter
 * types, rounding ties, out-of-range inputs). They pin TS/Swift parity; real
 * device truth comes from packets-golden-capture.json.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runPacketVector, type PacketVector } from "../src/testing/packet-vector-runner.ts";

const root = fileURLToPath(new URL("../../../test-vectors/", import.meta.url));
const band = (index: number, type: string, freq: number, q: number, gain: number) =>
  ({ name: `band ${type} ${freq}Hz Q${q} ${gain}dB`, kind: "buildBandWrite", input: { index, type, freq, q, gain, sampleRate: 96000 } });

const cases: PacketVector[] = [
  band(0, "PK", 1000, 1, 6),
  band(1, "PK", 20, 0.1, -10),
  band(2, "PK", 20000, 10, 10),
  band(3, "LSQ", 105, 0.71, 5.5),
  band(4, "HSQ", 8000, 0.71, -3.25),
  band(5, "LSQ", 20, 0.5, 10),
  { ...band(6, "HSQ", 16000, 2, 10), name: "high shelf boost beyond Q30 range falls back to identity coefficients" },
  { ...band(6, "HSQ", 1000, 0.7, 1), name: "high shelf +1 dB at 1 kHz falls back to identity coefficients" },
  band(7, "LP", 18000, 0.71, 0),
  band(8, "HP", 25, 0.71, 0),
  band(9, "PK", 3150, 4.33, -2.7),
  ...[2.5, -2.5, 0.5, -0.5, 1.4999, -6.5].map((value) => ({
    name: `round ${value}`, kind: "roundHalfAwayFromZero", input: { value },
  })),
  { name: "preamp -12", kind: "buildPreampWrite", input: { preamp: -12 } },
  { name: "preamp 0", kind: "buildPreampWrite", input: { preamp: 0 } },
  { name: "restore defaults", kind: "buildRestoreDefaults" },
  ...["FAST-LL", "NON-OS"].map((mode) => ({ name: `filter mode ${mode}`, kind: "buildFilterModeWrite", input: { mode } })),
  { name: "gain mode high", kind: "buildGainModeWrite", input: { high: true } },
  { name: "error: freq above Nyquist", kind: "buildBandWrite", input: { index: 0, type: "PK", freq: 48000, q: 1, gain: 0, sampleRate: 96000 } },
  { name: "error: Q zero", kind: "buildBandWrite", input: { index: 0, type: "PK", freq: 1000, q: 0, gain: 0, sampleRate: 96000 } },
];

const vectors = cases.map((v) => {
  try {
    const out = runPacketVector(v);
    return typeof out === "string" ? { ...v, expectedHex: out } : { ...v, expected: out };
  } catch (error) {
    return { ...v, expectedError: (error as Error).name };
  }
});
writeFileSync(`${root}packets-generated.json`, JSON.stringify({ source: "generated", vectors }, null, 2) + "\n");
console.log(`wrote ${vectors.length} generated vectors`);
