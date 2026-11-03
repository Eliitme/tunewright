/**
 * Pure builders for Walkplay payloads. Payloads never contain the HID report
 * ID and are never padded; the transport does both for its platform.
 */
import { computeBiquad, type FilterSpec } from "./biquad-coefficients.ts";
import { quantizeQ30 } from "./q30-fixed-point.ts";
import { toScaledInt } from "./wire-rounding.ts";
import {
  BAND_PAYLOAD_LENGTH_FIELD,
  BAND_WRITE_TAIL,
  CMD,
  DIR_READ,
  DIR_WRITE,
  FILTER_MODES,
  FILTER_TYPE_BYTE,
  type FilterMode,
} from "./walkplay-wire-constants.ts";

const u16le = (v: number): [number, number] => [v & 0xff, (v >> 8) & 0xff];

function i32le(v: number): number[] {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setInt32(0, v, true);
  return [...out];
}

export function buildVersionRequest(): Uint8Array {
  return Uint8Array.of(DIR_READ, CMD.VERSION, 0x00);
}

export function buildBandReadRequest(index: number, nonce = 0): Uint8Array {
  return Uint8Array.of(DIR_READ, CMD.BAND, nonce & 0xff, 0x00, index, 0x00);
}

export function buildPreampReadRequest(): Uint8Array {
  return Uint8Array.of(DIR_READ, CMD.PREAMP, 0x00);
}

/** Generic 3-byte register read used by utility controls. */
export function buildRegisterReadRequest(cmd: number): Uint8Array {
  return Uint8Array.of(DIR_READ, cmd, 0x00);
}

/**
 * Q30 coefficients for the packet. The TP35 firmware recomputes every filter
 * from freq/Q/gain/type and ignores these bytes (a hardware probe with flat
 * coefficients still produced the requested bass and treble shelves), so a
 * filter whose RBJ coefficients exceed ±2 (e.g. high-shelf boosts) is sent
 * with identity coefficients instead of being rejected. Encodable filters
 * keep real RBJ coefficients, matching what the vendor app stores.
 */
function encodeCoefficients(filter: FilterSpec, dspSampleRate: number): number[] {
  const c = computeBiquad(filter, dspSampleRate); // still throws for invalid freq/Q
  try {
    return [c.b0, c.b1, c.b2, -c.a1, -c.a2].map(quantizeQ30);
  } catch {
    const flat = computeBiquad({ type: "PK", freq: 1000, q: 1, gain: 0 }, dspSampleRate);
    return [flat.b0, flat.b1, flat.b2, -flat.a1, -flat.a2].map(quantizeQ30);
  }
}

/**
 * Coefficients are computed from the real Q, while the Q field on the wire is
 * Q×256 rounded; the device's own stored packets follow the same rule.
 */
export function buildBandWritePacket(
  index: number,
  filter: FilterSpec,
  dspSampleRate: number,
): Uint8Array {
  const coeffs = encodeCoefficients(filter, dspSampleRate);
  const freq = toScaledInt(filter.freq, 1, 1, 0xffff, "Frequency");
  const q = toScaledInt(filter.q, 256, 1, 0xffff, "Q");
  const gain = toScaledInt(filter.gain, 256, -0x8000, 0x7fff, "Gain");
  return Uint8Array.from([
    DIR_WRITE,
    CMD.BAND,
    BAND_PAYLOAD_LENGTH_FIELD,
    0x00,
    index,
    0x00,
    0x00,
    ...coeffs.flatMap(i32le),
    ...u16le(freq),
    ...u16le(q),
    ...u16le(gain & 0xffff),
    FILTER_TYPE_BYTE[filter.type],
    ...BAND_WRITE_TAIL,
  ]);
}

export function buildPreampWritePacket(preampDb: number): Uint8Array {
  const value = toScaledInt(preampDb, 1, -128, 127, "Preamp");
  return Uint8Array.of(DIR_WRITE, CMD.PREAMP, 0x02, 0x00, value & 0xff);
}

/** Loads the written bands into the DSP without saving them. */
export function buildRamApplyPacket(): Uint8Array {
  return Uint8Array.of(DIR_WRITE, CMD.RAM_APPLY, 0x04, 0x00, 0x00, 0xff, 0xff, 0x00);
}

/** Persists the RAM state; always sent after a verified RAM apply. */
export function buildFlashSavePacket(): Uint8Array {
  return Uint8Array.of(DIR_WRITE, CMD.FLASH_SAVE, 0x00);
}

/** Resets filter/amp/balance and reloads the stored EQ. Only for an explicit user action. */
export function buildRestoreDefaultsPacket(): Uint8Array {
  return Uint8Array.of(DIR_WRITE, CMD.RESTORE_DEFAULTS, 0x00);
}

export function buildFilterModeWritePacket(mode: FilterMode): Uint8Array {
  return Uint8Array.of(DIR_WRITE, CMD.FILTER_MODE, 0x01, FILTER_MODES.indexOf(mode) + 1);
}

export function buildGainModeWritePacket(highGain: boolean): Uint8Array {
  return Uint8Array.of(DIR_WRITE, CMD.GAIN_MODE, 0x01, highGain ? 1 : 0);
}
