import { beforeEach, describe, expect, it } from "vitest";
import { FakeWalkplayDacTransport, instantClock } from "@tunewright/walkplay-protocol/testing";
import { CMD, DIR_READ, parseBandResponse } from "@tunewright/walkplay-protocol";

import { isDirty, useDeviceStore } from "../state/device-store.ts";

const gainOf = (dac: FakeWalkplayDacTransport, i: number) => {
  const p = dac.ramBands[i]!.slice();
  p[0] = DIR_READ;
  return parseBandResponse(p)!.gain;
};

async function connected() {
  const dac = new FakeWalkplayDacTransport({ firmware: "1.7" });
  dac.ramPreamp = dac.flashPreamp = -3;
  await useDeviceStore.getState().connectWith(dac, { clock: instantClock() });
  return dac;
}

describe("device store", () => {
  beforeEach(async () => useDeviceStore.getState().disconnect());

  it("connects and reads firmware, EQ and utilities", async () => {
    await connected();
    const s = useDeviceStore.getState();
    expect(s.status).toBe("ready");
    expect(s.firmware).toBe("1.7");
    expect(s.confirmed).toBe(true);
    expect(s.eq?.preamp).toBe(-3);
    expect(s.filterMode).toBe("FAST-LL");
    expect(isDirty(s)).toBe(false);
  });

  it("live edits reach DAC RAM and mark the editor dirty, Save flashes", async () => {
    const dac = await connected();
    useDeviceStore.getState().updateBand(2, { gain: 4 });
    expect(isDirty(useDeviceStore.getState())).toBe(true);
    await useDeviceStore.getState().flushLiveWrite();
    expect(gainOf(dac, 2)).toBe(4);
    expect(dac.sentCommands()).not.toContain(CMD.FLASH_SAVE);
    await useDeviceStore.getState().save();
    expect(dac.sentCommands().at(-1)).toBe(CMD.FLASH_SAVE);
    expect(isDirty(useDeviceStore.getState())).toBe(false);
  });

  it("revert writes the saved EQ back", async () => {
    const dac = await connected();
    useDeviceStore.getState().updateBand(0, { gain: -6 });
    await useDeviceStore.getState().flushLiveWrite();
    await useDeviceStore.getState().revert();
    expect(gainOf(dac, 0)).toBe(0);
    expect(isDirty(useDeviceStore.getState())).toBe(false);
  });

  it("unplugging resets to disconnected with a message", async () => {
    const dac = await connected();
    dac.unplug();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    const s = useDeviceStore.getState();
    expect(s.status).toBe("disconnected");
    expect(s.message).toMatch(/disconnected/i);
  });

  it("an unconfirmed flat read blocks editing", async () => {
    const dac = new FakeWalkplayDacTransport({ transientFlatReads: 10 });
    dac.ramPreamp = 0;
    dac.ramBands[0]![32] = 0x03; // band 0 really has +3 dB, but the first read comes back flat
    await useDeviceStore.getState().connectWith(dac, { clock: instantClock() });
    const before = useDeviceStore.getState().eq;
    useDeviceStore.getState().updateBand(0, { gain: 5 });
    expect(useDeviceStore.getState().confirmed).toBe(false);
    expect(useDeviceStore.getState().eq).toBe(before);
  });
});

describe("reset to flat", () => {
  it("zeroes every band and the preamp, keeping types and frequencies", async () => {
    await useDeviceStore.getState().disconnect();
    const dac = new FakeWalkplayDacTransport();
    dac.ramPreamp = -3;
    await useDeviceStore.getState().connectWith(dac, { clock: instantClock() });
    useDeviceStore.getState().updateBand(0, { type: "LSQ", gain: 4, freq: 105 });
    useDeviceStore.getState().resetFlat();
    const eq = useDeviceStore.getState().eq!;
    expect(eq.preamp).toBe(0);
    expect(eq.bands.every((b) => b.gain === 0)).toBe(true);
    expect(eq.bands[0]).toMatchObject({ type: "LSQ", freq: 105 });
  });
});

describe("pass filters", () => {
  it("switching a band to LP or HP drops its gain to 0", async () => {
    await useDeviceStore.getState().disconnect();
    await useDeviceStore.getState().connectWith(new FakeWalkplayDacTransport(), { clock: instantClock() });
    useDeviceStore.getState().updateBand(2, { gain: 6 });
    useDeviceStore.getState().updateBand(2, { type: "HP" });
    useDeviceStore.getState().updateBand(2, { gain: 3 });
    expect(useDeviceStore.getState().eq!.bands[2]).toMatchObject({ type: "HP", gain: 0 });
  });
});
