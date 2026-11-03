import { describe, expect, it } from "vitest";
import { TP35_PRO_PROFILE } from "../device-profile-tp35-pro.ts";
import { parseAutoEqText } from "../autoeq-text-parser.ts";
import { parsePreset } from "../eq-preset-schema.ts";
import { PresetNotSupportedError, presetToDeviceState, safePreamp } from "../preset-device-mapping.ts";
import { WalkplaySession } from "../walkplay-session.ts";
import { FakeWalkplayDacTransport } from "../testing/fake-walkplay-dac-transport.ts";
import { instantClock } from "../testing/session-trace-runner.ts";
import { CMD } from "../walkplay-wire-constants.ts";

const preset = parsePreset({
  schema: 1, name: "Bass", preamp: 0,
  bands: [{ type: "LSQ", freq: 100, q: 0.7, gain: 10 }, { type: "PK", freq: 60, q: 0.8, gain: 8 }],
});

describe("preset → device state", () => {
  it("pads to 10 bands with identity peaks", () => {
    const state = presetToDeviceState(preset, TP35_PRO_PROFILE);
    expect(state.bands).toHaveLength(10);
    expect(state.bands[9]).toEqual({ type: "PK", freq: 1000, q: 1, gain: 0 });
  });
  it("accepts LP/HP bands and maps them onto the TP35 Pro", () => {
    const cut = parsePreset({ schema: 1, name: "Cut", preamp: 0, bands: [{ type: "HP", freq: 20, q: 0.71, gain: 0 }, { type: "LP", freq: 18000, q: 0.71, gain: 4 }] });
    const bands = presetToDeviceState(cut, TP35_PRO_PROFILE).bands.slice(0, 2);
    expect(bands.map((b) => b.type)).toEqual(["HP", "LP"]);
    expect(bands[1]!.gain).toBe(0);
  });
  it("rejects unknown filter types", () => {
    expect(() => parsePreset({ schema: 1, name: "X", preamp: 0, bands: [{ type: "BP", freq: 1000, q: 0.7, gain: 0 }] })).toThrow();
  });
  it("safe preamp removes all boost from untrusted presets", () => {
    const state = presetToDeviceState(preset, TP35_PRO_PROFILE);
    const safe = safePreamp(state, TP35_PRO_PROFILE);
    expect(safe.preamp).toBeLessThanOrEqual(-17);
    expect(safe.clipSafe).toBe(true);
    expect(safePreamp({ ...state, preamp: -25 }, TP35_PRO_PROFILE).preamp).toBe(-25);
  });
  it("flags presets whose boost exceeds the preamp range", () => {
    const loud = { preamp: 0, bands: Array.from({ length: 10 }, () => ({ type: "PK" as const, freq: 1000, q: 1, gain: 10 })) };
    expect(safePreamp(loud, TP35_PRO_PROFILE)).toEqual({ preamp: -30, clipSafe: false });
  });
  it("accepts high-shelf boosts (the firmware computes them from metadata)", () => {
    const air = parsePreset({ schema: 1, name: "Air", preamp: 0, bands: [{ type: "HSQ", freq: 1000, q: 0.7, gain: 3 }] });
    expect(presetToDeviceState(air, TP35_PRO_PROFILE).bands[0]).toEqual({ type: "HSQ", freq: 1000, q: 0.7, gain: 3 });
  });
  it("rejects filter types still gated behind a hardware probe", () => {
    const gated = { ...TP35_PRO_PROFILE, filterTypes: ["PK"] as const, probeGated: ["HSQ" as const] };
    const shelf = parsePreset({ schema: 1, name: "Air", preamp: 0, bands: [{ type: "HSQ", freq: 8000, q: 0.7, gain: 3 }] });
    expect(() => presetToDeviceState(shelf, gated)).toThrow(PresetNotSupportedError);
  });
});

describe("AutoEQ text", () => {
  it("parses preamp, shelf aliases and skips junk", () => {
    const draft = parseAutoEqText(
      "Preamp: -6.4 dB\nFilter 1: ON LSC Fc 105 Hz Gain 5.5 dB Q 0.71\nFilter 2: OFF PK Fc 1000 Hz Gain 3 dB Q 1\nFilter 3: ON PK Fc 3150.4 Hz Gain -2.7 dB Q 4.33\nnonsense",
    );
    expect(draft.preamp).toBe(-7);
    expect(draft.bands).toEqual([
      { type: "LSQ", freq: 105, gain: 5.5, q: 0.71 },
      { type: "PK", freq: 3150, gain: -2.7, q: 4.33 },
    ]);
    expect(draft.skippedLines).toEqual(["nonsense"]);
    expect(parseAutoEqText("Filter 1: ON PK Fc . Hz Gain 1 dB Q 1\nPreamp: +1.0 dB").skippedLines).toHaveLength(1);
    expect(parseAutoEqText("Preamp: +1.0 dB").preamp).toBe(0);
  });
});

describe("session", () => {
  it("reads firmware and utility registers", async () => {
    const dac = new FakeWalkplayDacTransport({ firmware: "1.5" });
    const s = new WalkplaySession(dac, TP35_PRO_PROFILE, { clock: instantClock() });
    expect(await s.readVersion()).toBe("1.5");
    await s.utility.setFilterMode("Slow-PC");
    expect(await s.utility.readFilterMode()).toBe("Slow-PC");
    await s.utility.setHighGain(true);
    expect(await s.utility.readHighGain()).toBe(true);
  });

  it("counts reports nobody asked for (another app driving the DAC)", async () => {
    const dac = new FakeWalkplayDacTransport();
    const s = new WalkplaySession(dac, TP35_PRO_PROFILE, { clock: instantClock() });
    dac.emitForeignReport(Uint8Array.of(0x80, CMD.BAND, 0, 0, 2));
    expect(s.unsolicitedReports).toBe(1);
  });

  it("never sends restore-defaults or 0x05 while saving", async () => {
    const dac = new FakeWalkplayDacTransport();
    const s = new WalkplaySession(dac, TP35_PRO_PROFILE, { clock: instantClock() });
    await s.save(presetToDeviceState(preset, TP35_PRO_PROFILE));
    expect(dac.sentCommands()).not.toContain(CMD.RESTORE_DEFAULTS);
    expect(dac.sentCommands()).not.toContain(0x05);
    expect(dac.sentCommands().at(-1)).toBe(CMD.FLASH_SAVE);
  });

  it("restore defaults reloads flash into RAM", async () => {
    const dac = new FakeWalkplayDacTransport();
    const s = new WalkplaySession(dac, TP35_PRO_PROFILE, { clock: instantClock() });
    await s.applyVerified(presetToDeviceState(preset, TP35_PRO_PROFILE));
    expect(dac.ramPreamp).toBe(0);
    await s.utility.restoreDefaults();
    expect(dac.ramBands).toEqual(dac.flashBands);
  });
});
