/**
 * Turns a validated preset into the exact device state to write: band count
 * padded to the device, types checked against what the device supports, every
 * band pre-encoded (so an unencodable filter is a validation error, never a
 * half-finished write), and a clip-safe preamp for untrusted presets.
 */
import type { FilterSpec, FilterType } from "./biquad-coefficients.ts";
import type { DeviceProfile } from "./device-profile-tp35-pro.ts";
import type { EqPreset } from "./eq-preset-schema.ts";
import { maxBoostDb } from "./frequency-response.ts";
import { buildBandWritePacket } from "./walkplay-packet-builders.ts";

export interface DeviceEqState {
  preamp: number;
  bands: FilterSpec[];
}

/** Identity band used to fill unused slots (peak at 0 dB has unity response). */
export const FLAT_BAND: FilterSpec = { type: "PK", freq: 1000, q: 1, gain: 0 };

export class PresetNotSupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PresetNotSupportedError";
  }
}

export function cloneState(state: DeviceEqState): DeviceEqState {
  return { preamp: state.preamp, bands: state.bands.map((b) => ({ ...b })) };
}

export function enabledFilterTypes(profile: DeviceProfile): Set<FilterType> {
  const types = new Set<FilterType>(profile.filterTypes);
  for (const gated of ["HSQ", "LP", "HP"] as const) {
    if (!profile.probeGated.includes(gated)) types.add(gated);
  }
  return types;
}

export function presetToDeviceState(preset: EqPreset, profile: DeviceProfile): DeviceEqState {
  if (preset.bands.length > profile.bandCount) {
    throw new PresetNotSupportedError(
      `Preset has ${preset.bands.length} bands; ${profile.name} supports ${profile.bandCount}`,
    );
  }
  const allowed = enabledFilterTypes(profile);
  const bands: FilterSpec[] = preset.bands.map((b, i) => {
    if (!allowed.has(b.type)) {
      throw new PresetNotSupportedError(`Band ${i + 1}: ${profile.name} does not support ${b.type} filters yet`);
    }
    // Pass filters ignore gain; writing 0 keeps the graph and clip check honest.
    const band = { type: b.type, freq: b.freq, q: b.q, gain: b.type === "LP" || b.type === "HP" ? 0 : b.gain };
    try {
      buildBandWritePacket(i, band, profile.dspSampleRate);
    } catch (error) {
      throw new PresetNotSupportedError(`Band ${i + 1}: ${(error as Error).message}`);
    }
    return band;
  });
  while (bands.length < profile.bandCount) bands.push({ ...FLAT_BAND });
  return { preamp: preset.preamp, bands };
}

export interface SafePreampResult {
  preamp: number;
  /** False when even the lowest preamp cannot remove all boost; callers must refuse or warn. */
  clipSafe: boolean;
}

/**
 * Preamp low enough that the EQ cannot boost above 0 dBFS. Mandatory for
 * presets that come from share links or imports.
 */
export function safePreamp(state: DeviceEqState, profile: DeviceProfile): SafePreampResult {
  const needed = -Math.ceil(maxBoostDb(state.bands, profile.dspSampleRate) - 1e-9);
  const wanted = Math.min(state.preamp, needed);
  const floor = profile.preampRange[0];
  return { preamp: Math.max(floor, wanted), clipSafe: wanted >= floor };
}
