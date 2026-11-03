import { roundHalfAwayFromZero } from "./wire-rounding.ts";

/** The DSP stores biquad coefficients as signed 32-bit values scaled by 2^30. */
export const Q30_SCALE = 1_073_741_824;

// Symmetric bound: -2.0 fits in i32 but +2.0 does not, so both are rejected
// to keep the representable range identical for positive and negative terms.
const Q30_LIMIT = 2_147_483_647;

/**
 * Quantizes one normalized coefficient. Throws instead of clamping: a clamped
 * coefficient loads a different filter than the one the editor shows.
 */
export function quantizeQ30(value: number): number {
  const scaled = roundHalfAwayFromZero(value * Q30_SCALE);
  if (Math.abs(scaled) > Q30_LIMIT) {
    throw new RangeError(
      `Coefficient ${value.toFixed(4)} exceeds the device fixed-point range of ±2.0`,
    );
  }
  return scaled;
}

export function decodeQ30(raw: number): number {
  return raw / Q30_SCALE;
}
