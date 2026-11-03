import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runPacketVector, type PacketVector } from "../testing/packet-vector-runner.ts";
import { runSessionTrace, type SessionTrace } from "../testing/session-trace-runner.ts";
import { eqPresetSchema } from "../eq-preset-schema.ts";

const load = <T>(file: string): T =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../test-vectors/${file}`, import.meta.url)), "utf8"));

function check(v: PacketVector) {
  if (v.expectedError) {
    expect(() => runPacketVector(v)).toThrow();
    return;
  }
  const out = runPacketVector(v);
  if (v.expectedHex !== undefined) expect(out).toBe(v.expectedHex);
  else expect(out).toEqual(v.expected);
}

describe("golden vectors from the TP35 Pro capture", () => {
  const { vectors } = load<{ vectors: PacketVector[] }>("packets-golden-capture.json");
  it("covers every packet kind the session uses", () => {
    const kinds = new Set(vectors.map((v) => v.kind));
    for (const k of ["buildBandWrite", "parseBand", "parsePreamp", "buildPreampWrite", "buildRamApply", "buildFlashSave"]) {
      expect(kinds).toContain(k);
    }
  });
  it.each(vectors.map((v) => [v.name, v] as const))("%s", (_, v) => check(v));
});

describe("generated vectors", () => {
  const { vectors } = load<{ vectors: PacketVector[] }>("packets-generated.json");
  it.each(vectors.map((v) => [v.name, v] as const))("%s", (_, v) => check(v));
});

describe("session traces", () => {
  const { traces } = load<{ traces: SessionTrace[] }>("session-traces.json");
  it.each(traces.map((t) => [t.name, t] as const))("%s", async (_, t) => {
    expect(await runSessionTrace(t)).toEqual(t.expected);
  });
});

describe("preset fixtures", () => {
  type Fixture = { name: string; preset: unknown; keepsKeys?: string[] };
  const fixtures = load<{ valid: Fixture[]; invalid: Fixture[] }>("preset-fixtures.json");
  it.each(fixtures.valid.map((f) => [f.name, f] as const))("accepts %s", (_, f) => {
    const parsed = eqPresetSchema.parse(f.preset) as Record<string, unknown>;
    for (const path of f.keepsKeys ?? []) {
      const value = path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], parsed);
      expect(value, path).toBeDefined();
    }
  });
  it.each(fixtures.invalid.map((f) => [f.name, f] as const))("rejects %s", (_, f) => {
    expect(eqPresetSchema.safeParse(f.preset).success).toBe(false);
  });
});
