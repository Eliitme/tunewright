/**
 * In-memory Walkplay DAC for tests and the web dev mode. Answers reads
 * synchronously inside `send`, stores band packets exactly as the real DAC
 * echoes them, and can simulate dropped reports, transient flat reads,
 * unplugging and a second client.
 */
import type { HidTransport } from "../hid-transport.ts";
import { buildBandWritePacket } from "../walkplay-packet-builders.ts";
import { CMD, DIR_READ, DIR_WRITE } from "../walkplay-wire-constants.ts";
import { FLAT_BAND } from "../preset-device-mapping.ts";

const RESPONSE_LENGTH = 63;

export interface FakeDacOptions {
  firmware?: string;
  bandCount?: number;
  /** Return true to silently drop an incoming report (real DAC drops ~1%). */
  drop?: (payload: Uint8Array, sendIndex: number) => boolean;
  /** Number of upcoming band reads answered as an erased/flat slot. */
  transientFlatReads?: number;
}

export class FakeWalkplayDacTransport implements HidTransport {
  readonly outputReportLength = 63;
  readonly sent: Uint8Array[] = [];
  ramBands: Uint8Array[];
  flashBands: Uint8Array[];
  ramPreamp = 0;
  flashPreamp = 0;
  filterMode = 1;
  gainMode = 0;
  transientFlatReads: number;
  private reportListeners = new Set<(id: number, p: Uint8Array) => void>();
  private disconnectListeners = new Set<() => void>();
  private connected = true;
  private readonly options: FakeDacOptions;

  constructor(options: FakeDacOptions = {}) {
    this.options = options;
    const count = options.bandCount ?? 10;
    this.ramBands = Array.from({ length: count }, (_, i) =>
      buildBandWritePacket(i, { ...FLAT_BAND, freq: 100 }, 96_000),
    );
    this.flashBands = this.ramBands.map((b) => b.slice());
    this.transientFlatReads = options.transientFlatReads ?? 0;
  }

  async send(reportId: number, payload: Uint8Array): Promise<void> {
    if (!this.connected) throw new Error("device gone");
    if (payload.length > this.outputReportLength) throw new Error("report too long");
    const index = this.sent.push(payload.slice()) - 1;
    if (reportId !== 0x4b || this.options.drop?.(payload, index)) return;
    if (payload[0] === DIR_WRITE) this.handleWrite(payload);
    else if (payload[0] === DIR_READ) this.handleRead(payload);
  }

  onReport(listener: (id: number, p: Uint8Array) => void): () => void {
    this.reportListeners.add(listener);
    return () => this.reportListeners.delete(listener);
  }

  onDisconnect(listener: () => void): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  async close(): Promise<void> {
    this.connected = false;
  }

  /** Simulates unplugging the dongle. */
  unplug(): void {
    this.connected = false;
    this.disconnectListeners.forEach((l) => l());
  }

  /** Simulates another app's reply arriving on this handle. */
  emitForeignReport(payload: Uint8Array): void {
    this.reply(payload);
  }

  sentCommands(): number[] {
    return this.sent.map((p) => p[1] ?? -1);
  }

  private handleWrite(p: Uint8Array): void {
    switch (p[1]) {
      case CMD.BAND:
        if (p[4] !== undefined && p[4] < this.ramBands.length) this.ramBands[p[4]] = p.slice();
        break;
      case CMD.PREAMP:
        this.ramPreamp = new DataView(p.buffer, p.byteOffset).getInt8(4);
        break;
      case CMD.FLASH_SAVE:
        this.flashBands = this.ramBands.map((b) => b.slice());
        this.flashPreamp = this.ramPreamp;
        break;
      case CMD.RESTORE_DEFAULTS:
        this.ramBands = this.flashBands.map((b) => b.slice());
        this.ramPreamp = this.flashPreamp;
        this.filterMode = 1;
        break;
      case CMD.FILTER_MODE:
        this.filterMode = p[3] ?? 1;
        break;
      case CMD.GAIN_MODE:
        this.gainMode = p[3] ?? 0;
        break;
    }
  }

  private handleRead(p: Uint8Array): void {
    const cmd = p[1];
    if (cmd === CMD.VERSION) {
      const fw = [...(this.options.firmware ?? "1.5")].map((c) => c.charCodeAt(0));
      this.reply(Uint8Array.from([DIR_READ, CMD.VERSION, 0, ...fw]));
    } else if (cmd === CMD.BAND) {
      const index = p[4] ?? 0;
      const stored = this.ramBands[index];
      if (!stored) return;
      const out = stored.slice();
      out[0] = DIR_READ;
      out[2] = p[2] ?? 0; // echoes the request nonce, like firmware 1.7
      if (this.transientFlatReads > 0) {
        this.transientFlatReads--;
        out.fill(0, 7); // erased slot: no coefficients, freq/Q/gain/type all zero
      }
      this.reply(out);
    } else if (cmd === CMD.PREAMP) {
      this.reply(Uint8Array.of(DIR_READ, CMD.PREAMP, 2, 0, this.ramPreamp & 0xff, 0xff, 0xff));
    } else if (cmd === CMD.FILTER_MODE || cmd === CMD.GAIN_MODE) {
      const value = cmd === CMD.FILTER_MODE ? this.filterMode : this.gainMode;
      this.reply(Uint8Array.of(DIR_READ, cmd, 1, value));
    }
  }

  private reply(payload: Uint8Array): void {
    const padded = new Uint8Array(RESPONSE_LENGTH);
    padded.set(payload.subarray(0, RESPONSE_LENGTH));
    this.reportListeners.forEach((l) => l(0x4b, padded));
  }
}
