/**
 * Builds golden vectors straight from the TP35 Pro HID capture, without using
 * any of this package's encoders, so the TS and Swift ports are both checked
 * against what the real DAC stores and accepts.
 *
 * Band write inputs use Q = wire Q rounded to 2 decimals (154/256 → 0.6):
 * the device's coefficients match the RBJ biquad of the unrounded Q exactly.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../test-vectors/", import.meta.url));
const capture = JSON.parse(
  readFileSync(`${root}source-captures/devicepeq-walkplay-tp35-pro-firmware-1-5-capture.json`, "utf8"),
) as { exchanges: { send: { data: number[] }; responses: { data: number[] }[] }[] };

const hex = (bytes: number[]) => bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
const TYPES: Record<number, string> = { 1: "LSQ", 2: "PK", 3: "HSQ" };
const u16 = (b: number[], o: number) => (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8);
const i16 = (b: number[], o: number) => (u16(b, o) << 16) >> 16;

const vectors: object[] = [];
const seen = new Set<string>();
const push = (v: { name: string; [key: string]: unknown }) => {
  if (seen.has(v.name)) return;
  vectors.push(v);
  seen.add(v.name);
};

for (const { send, responses } of capture.exchanges) {
  const s = send.data;
  const r = responses[0]?.data;
  if (s[0] === 0x80 && s[1] === 0x0c && r) {
    push({ name: "parse version", kind: "parseVersion", payloadHex: hex(r), expected: "1.5" });
    push({ name: "build version request", kind: "buildVersionRequest", expectedHex: hex(s) });
  }
  if (s[0] === 0x80 && s[1] === 0x09 && s.length === 6 && r) {
    const index = s[4] ?? 0;
    push({ name: `build band read ${index}`, kind: "buildBandReadRequest", input: { index }, expectedHex: hex(s) });
    push({
      name: `parse band ${index}`,
      kind: "parseBand",
      payloadHex: hex(r),
      expected: { index, type: TYPES[r[33] ?? 0], freq: u16(r, 27), q: u16(r, 29) / 256, gain: i16(r, 31) / 256 },
    });
  }
  if (s[0] === 0x80 && s[1] === 0x03 && r) {
    push({ name: "build preamp read", kind: "buildPreampReadRequest", expectedHex: hex(s) });
    push({ name: "parse preamp", kind: "parsePreamp", payloadHex: hex(r), expected: (r[4] ?? 0) << 24 >> 24 });
  }
  if (s[0] === 0x01 && s[1] === 0x09) {
    const index = s[4] ?? 0;
    push({
      name: `build band write ${index}`,
      kind: "buildBandWrite",
      input: {
        index,
        type: TYPES[s[33] ?? 0],
        freq: u16(s, 27),
        q: Math.round((u16(s, 29) / 256) * 100) / 100,
        gain: i16(s, 31) / 256,
        sampleRate: 96000,
      },
      expectedHex: hex(s),
    });
  }
  if (s[0] === 0x01 && s[1] === 0x03) {
    push({ name: "build preamp write", kind: "buildPreampWrite", input: { preamp: (s[4] ?? 0) << 24 >> 24 }, expectedHex: hex(s) });
  }
  if (s[0] === 0x01 && s[1] === 0x0a) push({ name: "build RAM apply", kind: "buildRamApply", expectedHex: hex(s) });
  if (s[0] === 0x01 && s[1] === 0x01) push({ name: "build flash save", kind: "buildFlashSave", expectedHex: hex(s) });
}

writeFileSync(
  `${root}packets-golden-capture.json`,
  JSON.stringify({ source: "capture", device: "EPZ TP35 Pro", firmware: "1.5", vectors }, null, 2) + "\n",
);
console.log(`wrote ${vectors.length} golden vectors`);
