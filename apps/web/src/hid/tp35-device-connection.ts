/** Finds and opens a TP35 Pro over WebHID and returns a ready transport. */
import { TP35_PRO_PROFILE, type HidTransport } from "@tunewright/walkplay-protocol";
import { findControlCollection, WebHidTransport } from "@tunewright/webhid-transport";

export const isWebHidSupported = () => typeof navigator !== "undefined" && "hid" in navigator;

const filters = [{ vendorId: TP35_PRO_PROFILE.vendorId, productId: TP35_PRO_PROFILE.productId }];

/** `prompt` shows the browser chooser; `auto` reuses a device the user already granted. */
export async function openTp35Transport(mode: "prompt" | "auto"): Promise<HidTransport | null> {
  const candidates =
    mode === "prompt"
      ? await navigator.hid.requestDevice({ filters })
      : (await navigator.hid.getDevices()).filter(
          (d) => d.vendorId === TP35_PRO_PROFILE.vendorId && d.productId === TP35_PRO_PROFILE.productId,
        );
  for (const device of candidates) {
    const control = findControlCollection(device, TP35_PRO_PROFILE.reportId);
    if (!control) continue;
    if (!device.opened) await device.open();
    const length = control.outputReports.find((r) => r.id === TP35_PRO_PROFILE.reportId)?.bytes || 63; // 0 when the descriptor lists no items
    return new WebHidTransport(device, length);
  }
  return null;
}

/** Calls `onAvailable` when a previously granted TP35 is plugged in. */
export function watchTp35Plugged(onAvailable: () => void): () => void {
  if (!isWebHidSupported()) return () => {};
  const handler = (e: HIDConnectionEvent) => {
    if (e.device.vendorId === TP35_PRO_PROFILE.vendorId && e.device.productId === TP35_PRO_PROFILE.productId) onAvailable();
  };
  navigator.hid.addEventListener("connect", handler);
  return () => navigator.hid.removeEventListener("connect", handler);
}
