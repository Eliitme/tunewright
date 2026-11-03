import type { FilterSpec } from "./biquad-coefficients.ts";
import type { DeviceEqState } from "./preset-device-mapping.ts";

/** One wire LSB of Q and gain (both are stored ×256), plus float slack. */
const WIRE_STEP = 1 / 256 + 1e-9;

export function bandsMatch(a: FilterSpec, b: FilterSpec): boolean {
  return (
    a.type === b.type &&
    Math.round(a.freq) === Math.round(b.freq) &&
    Math.abs(a.q - b.q) <= WIRE_STEP &&
    Math.abs(a.gain - b.gain) <= WIRE_STEP
  );
}

export function statesMatch(a: DeviceEqState, b: DeviceEqState): boolean {
  return (
    a.preamp === b.preamp &&
    a.bands.length === b.bands.length &&
    a.bands.every((band, i) => {
      const other = b.bands[i];
      return other !== undefined && bandsMatch(band, other);
    })
  );
}

/**
 * A DAC that was just plugged in or flashed can briefly answer with an
 * all-flat EQ. Such a read is only trusted after a second read agrees.
 */
export function looksLikeTransientReset(state: DeviceEqState): boolean {
  return state.preamp === 0 && state.bands.every((b) => b.gain === 0 && b.type === "PK");
}

export function changedBandIndexes(prev: DeviceEqState | null, next: DeviceEqState): number[] {
  return next.bands.flatMap((band, i) => {
    const old = prev?.bands[i];
    return old && bandsMatch(old, band) ? [] : [i];
  });
}
