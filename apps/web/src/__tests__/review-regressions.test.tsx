import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FakeWalkplayDacTransport, instantClock } from "@tunewright/walkplay-protocol/testing";
import { CMD, DIR_READ, DIR_WRITE } from "@tunewright/walkplay-protocol";
import { isDirty, useDeviceStore } from "../state/device-store.ts";
import { localPresetRepository } from "../state/preset-store.ts";
import { NumberField } from "../components/ui-primitives.tsx";

const connect = (dac: FakeWalkplayDacTransport) => useDeviceStore.getState().connectWith(dac, { clock: instantClock() });

describe("device store regressions", () => {
  beforeEach(async () => useDeviceStore.getState().disconnect());

  it("keeps the verify error visible after the automatic re-read", async () => {
    const dac = new FakeWalkplayDacTransport();
    dac.ramPreamp = -3;
    await connect(dac);
    dac.send = ((orig) => async (id: number, p: Uint8Array) => {
      if (p[0] === DIR_WRITE && p[1] === CMD.BAND && p[4] === 2) return; // band 2 writes are always lost
      return orig(id, p);
    })(dac.send.bind(dac));
    const eq = useDeviceStore.getState().eq!;
    const next = { ...eq, bands: eq.bands.map((b, i) => (i === 2 ? { ...b, gain: 5 } : b)) };
    expect(await useDeviceStore.getState().applyState(next)).toBe(false);
    expect(useDeviceStore.getState().message).toMatch(/Applying preset failed/);
  });

  it("an unconfirmed connect cannot be saved or reverted, and a confirmed re-read becomes the baseline", async () => {
    const dac = new FakeWalkplayDacTransport({ transientFlatReads: 10 });
    dac.ramBands[0]![32] = 0x03; // the real EQ has +3 dB on band 0
    await connect(dac);
    expect(useDeviceStore.getState().confirmed).toBe(false);
    const sentBefore = dac.sent.length;
    await useDeviceStore.getState().save();
    await useDeviceStore.getState().revert();
    expect(dac.sent.slice(sentBefore).some((p) => p[0] === DIR_WRITE)).toBe(false);
    await useDeviceStore.getState().rereadDevice();
    const s = useDeviceStore.getState();
    expect(s.confirmed).toBe(true);
    expect(s.eq!.bands[0]!.gain).toBe(3);
    expect(isDirty(s)).toBe(false);
  });

  it("restore defaults re-reads both filter and gain mode", async () => {
    const dac = new FakeWalkplayDacTransport();
    dac.ramPreamp = -3;
    await connect(dac);
    await useDeviceStore.getState().setHighGain(true);
    dac.gainMode = 0; // what the DAC reports after its reset
    await useDeviceStore.getState().restoreDefaults();
    expect(useDeviceStore.getState().highGain).toBe(false);
    expect(dac.sent.filter((p) => p[0] === DIR_READ && p[1] === CMD.GAIN_MODE).length).toBeGreaterThan(1);
  });
});

describe("preset storage", () => {
  // Node 26 exposes its own (unconfigured) localStorage global, which shadows jsdom's; use a stub.
  const items = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
    removeItem: (k: string) => void items.delete(k),
  });
  it.each([["{}"], ["null"], ["[null, 1, {\"id\": 3}]"], ["not json"]])("survives corrupted data %s", (raw) => {
    localStorage.setItem("tunewright.presets.v1", raw);
    expect(localPresetRepository.load()).toEqual([]);
  });
});

describe("NumberField", () => {
  it("shows wire values rounded and does not commit on focus/blur alone", () => {
    const onCommit = vi.fn();
    render(<NumberField label="Q" value={0.69921875} min={0.1} max={10} onCommit={onCommit} />);
    const input = screen.getByLabelText("Q") as HTMLInputElement;
    expect(input.value).toBe("0.7");
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("commits on blur only, and Escape reverts", () => {
    const onCommit = vi.fn();
    render(<NumberField label="Freq" value={1000} min={20} max={20000} onCommit={onCommit} />);
    const input = screen.getByLabelText("Freq") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "2" } });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "2000" } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(2000);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(input.value).toBe("1000");
  });
});
