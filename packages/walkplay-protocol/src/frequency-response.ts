import { computeBiquad, type Biquad, type FilterSpec } from "./biquad-coefficients.ts";

/** Magnitude in dB of one biquad at `freq`. */
export function biquadMagnitudeDb(c: Biquad, freq: number, sampleRate: number): number {
  const w = (2 * Math.PI * freq) / sampleRate;
  const cos1 = Math.cos(w);
  const sin1 = Math.sin(w);
  const cos2 = Math.cos(2 * w);
  const sin2 = Math.sin(2 * w);
  const numRe = c.b0 + c.b1 * cos1 + c.b2 * cos2;
  const numIm = -(c.b1 * sin1 + c.b2 * sin2);
  const denRe = 1 + c.a1 * cos1 + c.a2 * cos2;
  const denIm = -(c.a1 * sin1 + c.a2 * sin2);
  const mag2 = (numRe * numRe + numIm * numIm) / (denRe * denRe + denIm * denIm);
  return 10 * Math.log10(mag2);
}

/** Log-spaced frequencies from 20 Hz to 20 kHz. */
export function logFrequencies(points = 256, min = 20, max = 20_000): number[] {
  const ratio = Math.log(max / min);
  return Array.from({ length: points }, (_, i) => min * Math.exp((ratio * i) / (points - 1)));
}

/** Total response (dB) of a filter chain plus preamp at each frequency. */
export function chainResponseDb(
  filters: readonly FilterSpec[],
  preampDb: number,
  sampleRate: number,
  freqs: readonly number[] = logFrequencies(),
): number[] {
  const biquads = filters.map((f) => computeBiquad(f, sampleRate));
  return freqs.map(
    (f) => preampDb + biquads.reduce((sum, c) => sum + biquadMagnitudeDb(c, f, sampleRate), 0),
  );
}

/**
 * Highest boost of the chain above 0 dB, ignoring preamp. Sampled densely up
 * to just below Nyquist so narrow peaks and shelf overshoot are not missed.
 */
export function maxBoostDb(filters: readonly FilterSpec[], sampleRate: number): number {
  const freqs = logFrequencies(4096, 10, sampleRate * 0.499);
  return Math.max(0, ...chainResponseDb(filters, 0, sampleRate, freqs));
}
