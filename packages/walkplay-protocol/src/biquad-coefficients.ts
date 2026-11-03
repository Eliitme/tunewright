/**
 * RBJ "Audio EQ Cookbook" biquads, Q form for shelves (same convention as
 * AutoEQ). Verified against a TP35 Pro capture: a 21 Hz / +7 dB / Q 0.6 peak
 * at fs 96 kHz matches the device's stored coefficients to the last bit.
 */
export type FilterType = "PK" | "LSQ" | "HSQ" | "LP" | "HP";

export interface FilterSpec {
  type: FilterType;
  freq: number;
  q: number;
  gain: number;
}

/** Normalized by a0. Feedback terms are returned with the usual sign (a1, a2). */
export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

export function computeBiquad(filter: FilterSpec, sampleRate: number): Biquad {
  const { type, freq, q, gain } = filter;
  if (!(freq > 0 && freq < sampleRate / 2) || !(q > 0)) {
    throw new RangeError(`Invalid filter freq ${freq} Hz / Q ${q}`);
  }
  const A = Math.pow(10, gain / 40);
  const w0 = (2 * Math.PI * freq) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const sqrtA2alpha = 2 * Math.sqrt(A) * alpha;

  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  switch (type) {
    case "PK":
      b0 = 1 + alpha * A;
      b1 = -2 * cos;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cos;
      a2 = 1 - alpha / A;
      break;
    case "LSQ":
      b0 = A * (A + 1 - (A - 1) * cos + sqrtA2alpha);
      b1 = 2 * A * (A - 1 - (A + 1) * cos);
      b2 = A * (A + 1 - (A - 1) * cos - sqrtA2alpha);
      a0 = A + 1 + (A - 1) * cos + sqrtA2alpha;
      a1 = -2 * (A - 1 + (A + 1) * cos);
      a2 = A + 1 + (A - 1) * cos - sqrtA2alpha;
      break;
    case "HSQ":
      b0 = A * (A + 1 + (A - 1) * cos + sqrtA2alpha);
      b1 = -2 * A * (A - 1 + (A + 1) * cos);
      b2 = A * (A + 1 + (A - 1) * cos - sqrtA2alpha);
      a0 = A + 1 - (A - 1) * cos + sqrtA2alpha;
      a1 = 2 * (A - 1 - (A + 1) * cos);
      a2 = A + 1 - (A - 1) * cos - sqrtA2alpha;
      break;
    case "LP":
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = (1 - cos) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    case "HP":
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = (1 + cos) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}
