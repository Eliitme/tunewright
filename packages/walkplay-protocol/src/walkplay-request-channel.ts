/**
 * Serial request channel over a HidTransport: one report in flight, fixed
 * pacing between reports, timeouts with retry, and immediate rejection of
 * everything pending (including sleeps) when the device disappears.
 */
import {
  DeviceDisconnectedError,
  DeviceTimeoutError,
  type HidTransport,
} from "./hid-transport.ts";

export interface Clock {
  /** Resolves after `ms`, or early (without error) when `signal` aborts. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  now(): number;
}

export const realClock: Clock = {
  sleep: (ms, signal) =>
    new Promise((resolve) => {
      if (signal?.aborted) return resolve();
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
    }),
  now: () => Date.now(),
};

export interface RequestOptions {
  timeoutMs?: number;
  retries?: number;
  label: string;
}

/** A late reply to our own timed-out request is not evidence of another app. */
const LATE_REPLY_GRACE_MS = 1000;

export class WalkplayRequestChannel {
  private inbox: Uint8Array[] = [];
  private tail: Promise<unknown> = Promise.resolve();
  private lastSendAt = -Infinity;
  private lastTimeoutAt = -Infinity;
  private waiting = false;
  private wake: (() => void) | null = null;
  private readonly gone = new AbortController();
  /** Reports nobody asked for: a sign that another app is driving the DAC. */
  unsolicitedReports = 0;
  private readonly unsubscribers: (() => void)[];
  private readonly transport: HidTransport;
  private readonly reportId: number;
  private readonly intervalMs: number;
  private readonly clock: Clock;

  constructor(transport: HidTransport, reportId: number, intervalMs: number, clock: Clock = realClock) {
    this.transport = transport;
    this.reportId = reportId;
    this.intervalMs = intervalMs;
    this.clock = clock;
    this.unsubscribers = [
      transport.onReport((id, payload) => {
        if (id !== reportId) return;
        if (!this.waiting) {
          // Idle reports are never needed later; drop them so another app's polling can't grow memory.
          if (this.clock.now() - this.lastTimeoutAt > LATE_REPLY_GRACE_MS) this.unsolicitedReports++;
          return;
        }
        this.inbox.push(payload);
        this.wake?.();
      }),
      transport.onDisconnect(() => this.markGone()),
    ];
  }

  get isDisconnected(): boolean {
    return this.gone.signal.aborted;
  }

  /** Runs `task` after every previously queued task, keeping I/O strictly serial. */
  enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(task, task);
    this.tail = run.catch(() => undefined);
    return run;
  }

  /** Fire-and-forget write (the DAC does not answer writes). Caller must be inside enqueue. */
  async write(payload: Uint8Array): Promise<void> {
    await this.pace();
    await this.sendNow(payload);
  }

  /** Sends a read request and resolves with the first report accepted by `match`. */
  async request(
    payload: Uint8Array,
    match: (report: Uint8Array) => boolean,
    { timeoutMs = 120, retries = 2, label }: RequestOptions,
  ): Promise<Uint8Array> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      await this.pace();
      this.inbox = []; // flushed right before sending so a stale reply can't be matched
      this.waiting = true;
      try {
        await this.sendNow(payload);
        const found = await this.waitFor(match, timeoutMs);
        if (found) return found;
        this.lastTimeoutAt = this.clock.now();
      } finally {
        this.waiting = false;
        this.inbox = [];
      }
    }
    throw new DeviceTimeoutError(label);
  }

  /** Sleeps, but rejects as soon as the device disappears. */
  async sleep(ms: number): Promise<void> {
    this.assertConnected();
    await this.clock.sleep(ms, this.gone.signal);
    this.assertConnected();
  }

  dispose(): void {
    this.unsubscribers.forEach((off) => off());
  }

  private async pace(): Promise<void> {
    const wait = this.lastSendAt + this.intervalMs - this.clock.now();
    if (wait > 0) await this.sleep(wait);
    this.assertConnected();
  }

  private async sendNow(payload: Uint8Array): Promise<void> {
    this.lastSendAt = this.clock.now();
    try {
      await this.transport.send(this.reportId, payload);
    } catch {
      // WebHID can reject sendReport before its disconnect event fires; treat both the same.
      this.markGone();
      throw new DeviceDisconnectedError();
    }
  }

  private async waitFor(
    match: (report: Uint8Array) => boolean,
    timeoutMs: number,
  ): Promise<Uint8Array | null> {
    const take = () => {
      const i = this.inbox.findIndex(match);
      return i === -1 ? null : (this.inbox.splice(i, 1)[0] ?? null);
    };
    const timeout = new AbortController();
    let timedOut = false;
    const timer = this.clock.sleep(timeoutMs, timeout.signal).then(() => {
      timedOut = true;
      this.wake?.();
    });
    try {
      for (;;) {
        this.assertConnected();
        const found = take();
        if (found) return found;
        if (timedOut) return null;
        await Promise.race([new Promise<void>((r) => (this.wake = r)), timer]);
      }
    } finally {
      this.wake = null;
      timeout.abort();
    }
  }

  private markGone(): void {
    if (!this.gone.signal.aborted) this.gone.abort();
    this.wake?.();
  }

  private assertConnected(): void {
    if (this.gone.signal.aborted) throw new DeviceDisconnectedError();
  }
}
