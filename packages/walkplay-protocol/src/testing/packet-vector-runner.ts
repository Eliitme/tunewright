/**
 * Executes one packet vector (golden or generated) against the TS encoders.
 * The Swift port implements the same `kind` dispatch over the same JSON.
 */
import * as build from "../walkplay-packet-builders.ts";
import * as parse from "../walkplay-response-parsers.ts";
import { roundHalfAwayFromZero } from "../wire-rounding.ts";
import type { FilterType } from "../biquad-coefficients.ts";
import type { FilterMode } from "../walkplay-wire-constants.ts";

export interface PacketVector {
  name: string;
  kind: string;
  input?: Record<string, unknown>;
  payloadHex?: string;
  expectedHex?: string;
  expected?: unknown;
  expectedError?: string;
}

export const toHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
export const fromHex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));

/** Returns the produced value: hex string for builders, parsed value for parsers. */
export function runPacketVector(v: PacketVector): unknown {
  const i = v.input ?? {};
  const n = (k: string) => i[k] as number;
  switch (v.kind) {
    case "buildVersionRequest":
      return toHex(build.buildVersionRequest());
    case "buildBandReadRequest":
      return toHex(build.buildBandReadRequest(n("index")));
    case "buildPreampReadRequest":
      return toHex(build.buildPreampReadRequest());
    case "buildBandWrite":
      return toHex(
        build.buildBandWritePacket(
          n("index"),
          { type: i.type as FilterType, freq: n("freq"), q: n("q"), gain: n("gain") },
          n("sampleRate"),
        ),
      );
    case "buildPreampWrite":
      return toHex(build.buildPreampWritePacket(n("preamp")));
    case "buildRamApply":
      return toHex(build.buildRamApplyPacket());
    case "buildFlashSave":
      return toHex(build.buildFlashSavePacket());
    case "buildRestoreDefaults":
      return toHex(build.buildRestoreDefaultsPacket());
    case "buildFilterModeWrite":
      return toHex(build.buildFilterModeWritePacket(i.mode as FilterMode));
    case "buildGainModeWrite":
      return toHex(build.buildGainModeWritePacket(i.high as boolean));
    case "roundHalfAwayFromZero":
      return roundHalfAwayFromZero(n("value"));
    case "parseVersion":
      return parse.parseVersionResponse(fromHex(v.payloadHex ?? ""));
    case "parsePreamp":
      return parse.parsePreampResponse(fromHex(v.payloadHex ?? ""));
    case "parseBand": {
      const b = parse.parseBandResponse(fromHex(v.payloadHex ?? ""));
      return b && { index: b.index, type: b.type, freq: b.freq, q: b.q, gain: b.gain };
    }
    default:
      throw new Error(`Unknown vector kind ${v.kind}`);
  }
}
