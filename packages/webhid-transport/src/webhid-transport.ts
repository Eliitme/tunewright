/** WebHID implementation of the shared HidTransport contract (payloads exclude the report ID). */
import { padPayload, type HidTransport } from "@tunewright/walkplay-protocol";

export interface CollectionSummary {
  usagePage: number;
  usage: number;
  outputReports: { id: number; bytes: number }[];
  inputReports: { id: number; bytes: number }[];
}

const reportBytes = (r: HIDReportInfo) =>
  (r.items ?? []).reduce((sum, item) => sum + ((item.reportSize ?? 0) * (item.reportCount ?? 0)) / 8, 0);

/** Flattens the collection tree; vendor collections are sometimes nested. */
export function describeCollections(device: HIDDevice): CollectionSummary[] {
  const walk = (cs: readonly HIDCollectionInfo[] = []): CollectionSummary[] =>
    cs.flatMap((c) => [
      {
        usagePage: c.usagePage ?? 0,
        usage: c.usage ?? 0,
        outputReports: (c.outputReports ?? []).map((r) => ({ id: r.reportId ?? 0, bytes: reportBytes(r) })),
        inputReports: (c.inputReports ?? []).map((r) => ({ id: r.reportId ?? 0, bytes: reportBytes(r) })),
      },
      ...walk(c.children),
    ]);
  return walk(device.collections);
}

/** Collection that has output report `reportId`; matched by report ID because its usage page varies by DAC. */
export function findControlCollection(device: HIDDevice, reportId: number) {
  return describeCollections(device).find((c) => c.outputReports.some((r) => r.id === reportId)) ?? null;
}

export class WebHidTransport implements HidTransport {
  readonly outputReportLength: number;
  private readonly device: HIDDevice;
  private readonly disconnectListeners = new Set<() => void>();
  private readonly onHidDisconnect = (e: HIDConnectionEvent) => {
    if (e.device === this.device) this.disconnectListeners.forEach((l) => l());
  };

  constructor(device: HIDDevice, outputReportLength: number) {
    this.device = device;
    this.outputReportLength = outputReportLength;
    navigator.hid.addEventListener("disconnect", this.onHidDisconnect);
  }

  async send(reportId: number, payload: Uint8Array): Promise<void> {
    await this.device.sendReport(reportId, padPayload(payload, this.outputReportLength));
  }

  onReport(listener: (reportId: number, payload: Uint8Array) => void): () => void {
    const handler = (e: HIDInputReportEvent) =>
      listener(e.reportId, new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength));
    this.device.addEventListener("inputreport", handler);
    return () => this.device.removeEventListener("inputreport", handler);
  }

  onDisconnect(listener: () => void): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  async close(): Promise<void> {
    navigator.hid.removeEventListener("disconnect", this.onHidDisconnect);
    if (this.device.opened) await this.device.close();
  }
}
