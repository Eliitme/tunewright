/**
 * Raw report access for hardware probing tools (the spike page). Goes through
 * the session queue, so probes are paced and never interleave with EQ I/O.
 * Not exposed unless the session is created with `enableProbeAccess`.
 */
import type { WalkplayRequestChannel } from "./walkplay-request-channel.ts";

export class WalkplayProbeAccess {
  private readonly channel: WalkplayRequestChannel;

  constructor(channel: WalkplayRequestChannel) {
    this.channel = channel;
  }

  /** Sends `payload` and returns the first matching reply, or null on timeout. */
  exchange(payload: Uint8Array, match: (p: Uint8Array) => boolean, timeoutMs = 250): Promise<Uint8Array | null> {
    return this.channel.enqueue(() =>
      this.channel.request(payload, match, { timeoutMs, retries: 0, label: "probe" }).catch((e: Error) => {
        if (e.name === "DeviceTimeoutError") return null;
        throw e;
      }),
    );
  }

  /** Sends several reports back to back (paced), e.g. a band write followed by RAM apply. */
  writeSequence(payloads: Uint8Array[]): Promise<void> {
    return this.channel.enqueue(async () => {
      for (const p of payloads) await this.channel.write(p);
    });
  }
}
