import { describe, expect, it } from "vitest";
import { prepareImport, stateToPreset } from "../state/preset-store.ts";
import { freqToX, xToFreq, dbToY, yToDb } from "../lib/graph-scale.ts";

describe("preset import", () => {
  it("imports AutoEQ text with a clip-safe preamp", () => {
    const draft = prepareImport("Preamp: -1 dB\nFilter 1: ON LSC Fc 105 Hz Gain 6 dB Q 0.71\nFilter 2: ON PK Fc 3000 Hz Gain -2 dB Q 2", "IEM");
    expect(draft.preset.name).toBe("IEM");
    expect(draft.preset.preamp).toBeLessThanOrEqual(-6);
    expect(draft.preampLowered).toBe(true);
    expect(draft.state.bands).toHaveLength(10);
  });

  it("imports preset JSON and keeps a sufficient preamp", () => {
    const json = JSON.stringify({ schema: 1, name: "Cut", preamp: 0, bands: [{ type: "PK", freq: 1000, q: 1, gain: -3 }] });
    expect(prepareImport(json, "x")).toMatchObject({ preampLowered: false, preset: { name: "Cut", preamp: 0 } });
  });

  it("rejects out-of-range or unsafe presets with a readable message", () => {
    expect(() => prepareImport(JSON.stringify({ schema: 1, name: "Loud", preamp: 0, bands: [{ type: "PK", freq: 30, q: 1, gain: 16 }] }), "x")).toThrow(/Not a valid preset/);
    const stacked = Array.from({ length: 10 }, () => "Filter: ON PK Fc 1000 Hz Gain 10 dB Q 1").join("\n");
    expect(() => prepareImport(stacked, "x")).toThrow(/boosts more/);
  });

  it("round-trips the current state into a preset", () => {
    const preset = stateToPreset("  Mine ", { preamp: -2, bands: [{ type: "PK", freq: 100, q: 1, gain: 1 }] }, "NON-OS");
    expect(preset).toEqual({ schema: 1, name: "Mine", preamp: -2, filterMode: "NON-OS", bands: [{ type: "PK", freq: 100, q: 1, gain: 1 }] });
  });
});

describe("graph scale", () => {
  it("maps frequency and dB both ways", () => {
    const s = { width: 800, height: 300, pad: 28 };
    expect(xToFreq(freqToX(1234, s), s)).toBeCloseTo(1234, 6);
    expect(yToDb(dbToY(-4.5, s), s)).toBeCloseTo(-4.5, 9);
  });
});
