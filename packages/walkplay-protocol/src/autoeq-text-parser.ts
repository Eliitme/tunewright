/**
 * Parses AutoEQ / Equalizer APO "ParametricEQ.txt" text, e.g.
 *   Preamp: -6.2 dB
 *   Filter 1: ON PK Fc 105 Hz Gain 3.2 dB Q 0.70
 *   Filter 2: ON LSC Fc 105 Hz Gain 5.5 dB Q 0.71
 * Returns an unvalidated preset draft; callers must run it through the schema.
 */
import type { FilterType } from "./biquad-coefficients.ts";
import { roundHalfAwayFromZero } from "./wire-rounding.ts";

const TYPE_ALIASES: Record<string, FilterType> = {
  PK: "PK",
  PEQ: "PK",
  LS: "LSQ",
  LSC: "LSQ",
  LSQ: "LSQ",
  HS: "HSQ",
  HSC: "HSQ",
  HSQ: "HSQ",
  LP: "LP",
  LPQ: "LP",
  HP: "HP",
  HPQ: "HP",
};

const FILTER_LINE =
  /^Filter\s*\d*\s*:\s*(ON|OFF)\s+([A-Z]+)\s+Fc\s+([\d.]+)\s*Hz(?:\s+Gain\s+(-?[\d.]+)\s*dB)?(?:\s+Q\s+([\d.]+))?/i;
const PREAMP_LINE = /^Preamp\s*:\s*([+-]?[\d.]+)\s*dB/i;

export interface AutoEqDraft {
  schema: 1;
  name: string;
  preamp: number;
  bands: { type: FilterType; freq: number; q: number; gain: number }[];
  skippedLines: string[];
}

export function parseAutoEqText(text: string, name = "AutoEQ import"): AutoEqDraft {
  const draft: AutoEqDraft = { schema: 1, name, preamp: 0, bands: [], skippedLines: [] };
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const preamp = PREAMP_LINE.exec(line);
    if (preamp?.[1] && Number.isFinite(Number(preamp[1]))) {
      // Device preamp is whole dB; round down (more headroom), never up.
      draft.preamp = Math.min(0, Math.floor(Number(preamp[1])));
      continue;
    }
    const m = FILTER_LINE.exec(line);
    const type = m?.[2] ? TYPE_ALIASES[m[2].toUpperCase()] : undefined;
    if (!m || !type) {
      draft.skippedLines.push(line);
      continue;
    }
    if (m[1]?.toUpperCase() === "OFF") continue;
    const freq = Number(m[3]);
    const gain = m[4] ? Number(m[4]) : 0;
    const q = m[5] ? Number(m[5]) : 0.707;
    if (![freq, gain, q].every(Number.isFinite)) {
      draft.skippedLines.push(line);
      continue;
    }
    draft.bands.push({ type, freq: roundHalfAwayFromZero(freq), gain, q });
  }
  return draft;
}
