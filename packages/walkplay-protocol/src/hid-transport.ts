/**
 * Platform-neutral HID transport contract shared by WebHID and IOKit.
 *
 * Framing is the transport's job: payloads handed to and from the session
 * never contain the report ID and are never padded. WebHID already strips the
 * ID; IOKit keeps it in the buffer, so its transport adds/removes it.
 */
export interface HidTransport {
  /** Output report size from the descriptor, excluding the report ID byte. */
  readonly outputReportLength: number;
  send(reportId: number, payload: Uint8Array): Promise<void>;
  /** Returns an unsubscribe function. */
  onReport(listener: (reportId: number, payload: Uint8Array) => void): () => void;
  onDisconnect(listener: () => void): () => void;
  close(): Promise<void>;
}

export class DeviceDisconnectedError extends Error {
  constructor() {
    super("Device disconnected");
    this.name = "DeviceDisconnectedError";
  }
}

export class DeviceTimeoutError extends Error {
  constructor(what: string) {
    super(`Timed out waiting for ${what}`);
    this.name = "DeviceTimeoutError";
  }
}

/** Pads a payload with zeros to the transport's report length. */
export function padPayload(payload: Uint8Array, length: number): Uint8Array<ArrayBuffer> {
  if (payload.length > length) {
    throw new RangeError(`Payload of ${payload.length} bytes exceeds report length ${length}`);
  }
  const out = new Uint8Array(length);
  out.set(payload);
  return out;
}
