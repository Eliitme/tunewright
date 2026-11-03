/**
 * Rounding shared by every value that goes on the wire.
 *
 * JS `Math.round` rounds half toward +Infinity (-2.5 → -2) and Swift's
 * `.rounded()` rounds half away from zero (-2.5 → -3). Both clients must
 * produce identical bytes, so neither built-in is used directly.
 */
export function roundHalfAwayFromZero(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`Cannot round non-finite value ${value}`);
  }
  // Math.round on the magnitude avoids the floor(x + 0.5) error at 0.49999999999999994.
  const magnitude = Math.round(Math.abs(value));
  return value < 0 ? -magnitude : magnitude;
}

/** Scales and rounds, then checks the result fits the given integer range. */
export function toScaledInt(
  value: number,
  scale: number,
  min: number,
  max: number,
  label: string,
): number {
  const scaled = roundHalfAwayFromZero(value * scale);
  if (scaled < min || scaled > max) {
    throw new RangeError(`${label} ${value} is outside the wire range`);
  }
  return scaled;
}
