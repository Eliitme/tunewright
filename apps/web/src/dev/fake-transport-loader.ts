/**
 * Dev-only fake DAC (`?fake=1`). Imported dynamically behind import.meta.env.DEV
 * so production bundles never contain it.
 */
import type { HidTransport } from "@tunewright/walkplay-protocol";

export async function loadFakeTransportIfRequested(): Promise<HidTransport | null> {
  if (!import.meta.env.DEV || !new URLSearchParams(location.search).has("fake")) return null;
  const [{ FakeWalkplayDacTransport }, protocol] = await Promise.all([
    import("@tunewright/walkplay-protocol/testing"),
    import("@tunewright/walkplay-protocol"),
  ]);
  const fake = new FakeWalkplayDacTransport({ firmware: "1.7-fake" });
  fake.ramPreamp = fake.flashPreamp = -3;
  // Spread the slots like a real tuning so the graph handles don't overlap.
  protocol.DEFAULT_BAND_FREQS.forEach((freq, i) => {
    const band = { type: "PK" as const, freq, q: 1, gain: 0 };
    fake.ramBands[i] = fake.flashBands[i] = protocol.buildBandWritePacket(i, band, protocol.TP35_PRO_PROFILE.dspSampleRate);
  });
  return fake;
}
