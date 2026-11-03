/**
 * Preset format v1, shared by the web app, the API and (via fixtures) Swift.
 * Presets can arrive from untrusted share links, so every number is bounded.
 * Unknown fields are kept so an older client never strips a newer field.
 */
import { z } from "zod";
import { FILTER_MODES } from "./walkplay-wire-constants.ts";

export const PRESET_SCHEMA_VERSION = 1;
export const MAX_BANDS = 10;

const finite = () => z.number().refine(Number.isFinite, "must be finite");

export const eqBandSchema = z.looseObject({
  // Gain is stored for LP/HP too but has no effect on them.
  type: z.enum(["PK", "LSQ", "HSQ", "LP", "HP"]),
  freq: z.number().int().min(20).max(20_000),
  q: finite().min(0.1).max(10),
  gain: finite().min(-10).max(10),
});

export const eqPresetSchema = z.looseObject({
  schema: z.literal(PRESET_SCHEMA_VERSION),
  name: z.string().trim().min(1).max(64),
  preamp: z.number().int().min(-30).max(0),
  bands: z.array(eqBandSchema).max(MAX_BANDS),
  filterMode: z.enum(FILTER_MODES).optional(),
});

export type EqBand = z.infer<typeof eqBandSchema>;
export type EqPreset = z.infer<typeof eqPresetSchema>;

export function parsePreset(input: unknown): EqPreset {
  return eqPresetSchema.parse(input);
}

export function safeParsePreset(input: unknown) {
  return eqPresetSchema.safeParse(input);
}
