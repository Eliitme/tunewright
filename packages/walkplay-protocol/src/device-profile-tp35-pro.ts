import type { FilterType } from "./biquad-coefficients.ts";

export type ProbeGatedFeature = "HSQ" | "LP" | "HP" | "ampMode" | "balance" | "readNonceEcho";

export interface DeviceProfile {
  name: string;
  vendorId: number;
  productId: number;
  /**
   * Usage page of the HID collection that carries the control report. On the
   * TP35 Pro it is Consumer Control (0x0C), shared with the media-key report 3,
   * so the collection must be found by report ID, not by a vendor usage page.
   */
  controlUsagePage: number;
  reportId: number;
  bandCount: number;
  dspSampleRate: number;
  freqRange: readonly [number, number];
  qRange: readonly [number, number];
  gainRange: readonly [number, number];
  preampRange: readonly [number, number];
  filterTypes: readonly FilterType[];
  /** Features left disabled until a hardware probe confirms their encoding. */
  probeGated: readonly ProbeGatedFeature[];
  /** Pacing between reports; one HID polling interval on Walkplay DACs. */
  reportIntervalMs: number;
  /** After a flash write the DAC ignores writes for ~100 ms and reads for ~200 ms. */
  postFlashWriteDelayMs: number;
  postFlashReadDelayMs: number;
  /** Delay before the first read after connect/replug (state may read flat until then). */
  connectSettleMs: number;
  testedFirmware: readonly string[];
}

export const TP35_PRO_PROFILE: DeviceProfile = {
  name: "EPZ TP35 Pro",
  vendorId: 0x3302,
  productId: 0x43e6,
  controlUsagePage: 0x0c,
  reportId: 0x4b,
  bandCount: 10,
  dspSampleRate: 96_000,
  freqRange: [20, 20_000],
  qRange: [0.1, 10],
  gainRange: [-10, 10],
  preampRange: [-30, 0],
  // Confirmed by ear on firmware 1.7, all computed by the firmware from
  // metadata: low shelf (1), PK (2), high shelf (3), low pass (4, muffled at
  // 1 kHz) and high pass (5, thin at 1 kHz).
  filterTypes: ["PK", "LSQ", "HSQ", "LP", "HP"],
  // Nonce echo at band-read byte 2 confirmed on firmware 1.7.
  probeGated: ["ampMode", "balance"],
  reportIntervalMs: 16,
  postFlashWriteDelayMs: 100,
  postFlashReadDelayMs: 200,
  connectSettleMs: 200,
  testedFirmware: ["1.7"],
};

export function matchesProfile(
  profile: DeviceProfile,
  device: { vendorId: number; productId: number },
): boolean {
  return device.vendorId === profile.vendorId && device.productId === profile.productId;
}
