import type { FilterSpec, FilterType } from "./biquad-coefficients.ts";
import { decodeQ30 } from "./q30-fixed-point.ts";
import {
  BAND_OFFSET,
  CMD,
  DIR_READ,
  FILTER_MODES,
  FILTER_TYPE_BYTE,
  type FilterMode,
} from "./walkplay-wire-constants.ts";

export interface ParsedBand extends FilterSpec {
  index: number;
  /** False when the slot held erased/uninitialized data and defaults were substituted. */
  valid: boolean;
  /** Raw stored coefficients (b0, b1, b2, -a1, -a2), useful for probing. */
  rawCoefficients: number[];
}

const TYPE_BY_BYTE = new Map<number, FilterType>(
  Object.entries(FILTER_TYPE_BYTE).map(([k, v]) => [v, k as FilterType]),
);

const view = (p: Uint8Array) => new DataView(p.buffer, p.byteOffset, p.byteLength);

export function isResponse(payload: Uint8Array, cmd: number): boolean {
  return payload.length >= 3 && payload[0] === DIR_READ && payload[1] === cmd;
}

/** ASCII version string starting at byte 3, terminated by 0. */
export function parseVersionResponse(payload: Uint8Array): string | null {
  if (!isResponse(payload, CMD.VERSION)) return null;
  const end = payload.indexOf(0, 3);
  const bytes = payload.subarray(3, end === -1 ? payload.length : end);
  return String.fromCharCode(...bytes);
}

export function isBandResponse(payload: Uint8Array, index: number): boolean {
  return (
    payload.length > BAND_OFFSET.TYPE &&
    isResponse(payload, CMD.BAND) &&
    payload[BAND_OFFSET.INDEX] === index
  );
}

export const DEFAULT_BAND_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export function parseBandResponse(payload: Uint8Array): ParsedBand | null {
  if (payload.length <= BAND_OFFSET.TYPE || !isResponse(payload, CMD.BAND)) return null;
  const v = view(payload);
  const index = payload[BAND_OFFSET.INDEX] ?? 0;
  const freq = v.getUint16(BAND_OFFSET.FREQ, true);
  const qRaw = v.getUint16(BAND_OFFSET.Q, true);
  const gainRaw = v.getInt16(BAND_OFFSET.GAIN, true);
  const type = TYPE_BY_BYTE.get(payload[BAND_OFFSET.TYPE] ?? 0);
  const rawCoefficients = [0, 1, 2, 3, 4].map((i) =>
    decodeQ30(v.getInt32(BAND_OFFSET.COEFFS + i * 4, true)),
  );
  // Erased slots read back as zeros or 0xffff; never let them into a later write.
  const valid =
    type !== undefined && freq > 0 && freq <= 24_000 && qRaw > 0 && qRaw !== 0xffff;
  if (!valid) {
    return {
      index,
      valid: false,
      type: "PK",
      freq: DEFAULT_BAND_FREQS[index] ?? 1000,
      q: 1,
      gain: 0,
      rawCoefficients,
    };
  }
  return { index, valid, type, freq, q: qRaw / 256, gain: gainRaw / 256, rawCoefficients };
}

/** Preamp register: signed dB at byte 4. */
export function parsePreampResponse(payload: Uint8Array): number | null {
  if (payload.length < 5 || !isResponse(payload, CMD.PREAMP)) return null;
  return view(payload).getInt8(4);
}

/** Single-byte utility register value at byte 3. */
export function parseRegisterResponse(payload: Uint8Array, cmd: number): number | null {
  if (payload.length < 4 || !isResponse(payload, cmd)) return null;
  return payload[3] ?? null;
}

export function parseFilterModeResponse(payload: Uint8Array): FilterMode | null {
  const raw = parseRegisterResponse(payload, CMD.FILTER_MODE);
  return raw === null ? null : (FILTER_MODES[raw - 1] ?? null);
}
