/**
 * Hardware probes that answer the open protocol questions on a real TP35 Pro.
 * All raw I/O goes through the session queue (session.probe), so probes are
 * paced and never interleave with EQ reads/writes.
 */
import {
  buildBandReadRequest,
  buildBandWritePacket,
  buildRamApplyPacket,
  CMD,
  computeBiquad,
  FLAT_BAND,
  isBandResponse,
  isResponse,
  parseBandResponse,
  quantizeQ30,
  TP35_PRO_PROFILE,
  type DeviceEqState,
  type FilterSpec,
  type WalkplaySession,
} from "@tunewright/walkplay-protocol";

const hex = (b: Uint8Array | null) => (b ? [...b.subarray(0, 40)].map((x) => x.toString(16).padStart(2, "0")).join(" ") : null);
const FS = TP35_PRO_PROFILE.dspSampleRate;

/** Slot the probes overwrite; the snapshot restores it. */
export const PROBE_BAND = 9;

function probeAccess(session: WalkplaySession) {
  if (!session.probe) throw new Error("Session was created without probe access");
  return session.probe;
}

const readBand = (session: WalkplaySession, index: number) =>
  probeAccess(session).exchange(buildBandReadRequest(index), (p) => isBandResponse(p, index));

/** Writes one band packet plus RAM apply, then reads the slot back. */
async function writeProbeBand(session: WalkplaySession, packet: Uint8Array) {
  await probeAccess(session).writeSequence([packet, buildRamApplyPacket()]);
  const back = await readBand(session, PROBE_BAND);
  const parsed = back && parseBandResponse(back);
  return { wroteHex: hex(packet), readbackHex: hex(back), parsedType: parsed?.type ?? null };
}

/** Band packet whose coefficients are replaced by identity (flat) coefficients. */
function withFlatCoefficients(packet: Uint8Array): Uint8Array {
  const flat = computeBiquad({ ...FLAT_BAND }, FS);
  const view = new DataView(packet.buffer, packet.byteOffset);
  [flat.b0, flat.b1, flat.b2, -flat.a1, -flat.a2].map(quantizeQ30).forEach((c, i) => view.setInt32(7 + i * 4, c, true));
  return packet;
}

export async function probeReadState(session: WalkplaySession) {
  return session.readInitialState();
}

/**
 * Compares the coefficients stored in each slot with what our RBJ encoder
 * produces from the slot's metadata. Wire Q is rounded to 1/256, so a tiny
 * difference is expected; a large one means a different formula.
 */
export async function probeStoredCoefficients(session: WalkplaySession) {
  const rows = [];
  for (let i = 0; i < TP35_PRO_PROFILE.bandCount; i++) {
    const payload = await readBand(session, i);
    const band = payload && parseBandResponse(payload);
    if (!band || !band.valid) {
      rows.push({ index: i, valid: false, raw: hex(payload) });
      continue;
    }
    let maxDiff: number | null = null;
    try {
      const ours = new DataView(buildBandWritePacket(i, band, FS).buffer);
      maxDiff = Math.max(...band.rawCoefficients.map((c, k) => Math.abs(c - ours.getInt32(7 + k * 4, true) / 2 ** 30)));
    } catch {
      // Our encoder cannot represent it (e.g. a high-shelf boost): the device scales differently.
    }
    rows.push({ index: i, type: band.type, freq: band.freq, q: band.q, gain: band.gain, stored: band.rawCoefficients, maxDiff, formulaMatches: maxDiff !== null && maxDiff < 2e-3 });
  }
  return rows;
}

export async function probeNonceEcho(session: WalkplaySession) {
  const reply = await probeAccess(session).exchange(buildBandReadRequest(0, 0x5a), (p) => isResponse(p, CMD.BAND));
  return { replyHex: hex(reply), echoed: reply?.[2] === 0x5a };
}

export async function probeRawRegisters(session: WalkplaySession) {
  const registers = { filterMode: CMD.FILTER_MODE, gainMode: CMD.GAIN_MODE, ampMode: CMD.AMP_MODE, balance: CMD.BALANCE, micVolume: CMD.MIC_VOLUME };
  const out: Record<string, string | null> = {};
  for (const [name, cmd] of Object.entries(registers)) {
    out[name] = hex(await probeAccess(session).exchange(Uint8Array.of(0x80, cmd, 0x00), (p) => isResponse(p, cmd)));
  }
  return out;
}

/** Audible test: +6 dB peak at 1 kHz on the probe slot, written and verified via the session. */
export async function probeAudiblePeak(session: WalkplaySession, base: DeviceEqState) {
  const band: FilterSpec = { type: "PK", freq: 1000, q: 1, gain: 6 };
  await session.applyVerified({ ...base, bands: base.bands.map((b, i) => (i === PROBE_BAND ? band : b)) });
  return { wrote: band, listen: "1 kHz should get clearly louder" };
}

/** Does the firmware use our coefficients, or recompute from freq/Q/gain/type? */
export async function probeCoefficientsUsed(session: WalkplaySession) {
  const packet = withFlatCoefficients(buildBandWritePacket(PROBE_BAND, { type: "LSQ", freq: 150, q: 0.7, gain: 6 }, FS));
  return { ...(await writeProbeBand(session, packet)), listen: "More bass => firmware recomputes from metadata. No change => firmware uses our coefficients." };
}

/** High-shelf cut is encodable with RBJ; confirms type byte 3 = high shelf. */
export async function probeHighShelfCut(session: WalkplaySession) {
  const packet = buildBandWritePacket(PROBE_BAND, { type: "HSQ", freq: 4000, q: 0.7, gain: -6 }, FS);
  return { ...(await writeProbeBand(session, packet)), listen: "Treble should get quieter" };
}

/** High-shelf boost metadata with flat coefficients: only audible if the firmware recomputes. */
export async function probeHighShelfBoostMetadata(session: WalkplaySession) {
  const packet = withFlatCoefficients(buildBandWritePacket(PROBE_BAND, { type: "PK", freq: 4000, q: 0.7, gain: 0 }, FS));
  packet[33] = 3; // high shelf
  new DataView(packet.buffer, packet.byteOffset).setInt16(31, 6 * 256, true); // +6 dB metadata
  return { ...(await writeProbeBand(session, packet)), listen: "Brighter treble => firmware computes shelves itself, so HSQ boosts can be enabled" };
}

/** Type byte 4/5 with real LP/HP coefficients at 1 kHz; listen for muffled (LP) or thin (HP). */
export async function probeFilterTypeByte(session: WalkplaySession, typeByte: 4 | 5, coefficientsFor: "LP" | "HP") {
  const packet = buildBandWritePacket(PROBE_BAND, { type: coefficientsFor, freq: 1000, q: 0.71, gain: 0 }, FS);
  packet[33] = typeByte;
  return { typeByte, coefficientsFor, ...(await writeProbeBand(session, packet)), listen: coefficientsFor === "LP" ? "Muffled = low-pass" : "Thin = high-pass" };
}
