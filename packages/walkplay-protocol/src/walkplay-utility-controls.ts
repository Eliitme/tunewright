/** DAC utility registers (not part of the EQ state). */
import type { DeviceProfile } from "./device-profile-tp35-pro.ts";
import * as build from "./walkplay-packet-builders.ts";
import * as parse from "./walkplay-response-parsers.ts";
import type { WalkplayRequestChannel } from "./walkplay-request-channel.ts";
import { CMD, type FilterMode } from "./walkplay-wire-constants.ts";

export class WalkplayUtilityControls {
  private readonly channel: WalkplayRequestChannel;
  private readonly profile: DeviceProfile;
  /** Called after restore defaults: the DAC reloads its stored EQ, so cached state is stale. */
  private readonly onEqInvalidated: () => void;

  constructor(channel: WalkplayRequestChannel, profile: DeviceProfile, onEqInvalidated: () => void) {
    this.channel = channel;
    this.profile = profile;
    this.onEqInvalidated = onEqInvalidated;
  }

  async readFilterMode(): Promise<FilterMode | null> {
    return parse.parseFilterModeResponse(await this.readRegister(CMD.FILTER_MODE));
  }

  setFilterMode(mode: FilterMode): Promise<void> {
    return this.channel.enqueue(() => this.channel.write(build.buildFilterModeWritePacket(mode)));
  }

  async readHighGain(): Promise<boolean | null> {
    const v = parse.parseRegisterResponse(await this.readRegister(CMD.GAIN_MODE), CMD.GAIN_MODE);
    return v === null ? null : v === 1;
  }

  setHighGain(high: boolean): Promise<void> {
    return this.channel.enqueue(() => this.channel.write(build.buildGainModeWritePacket(high)));
  }

  /** Explicit user action only: resets filter/amp/balance and reloads the stored EQ. */
  restoreDefaults(): Promise<void> {
    return this.channel.enqueue(async () => {
      await this.channel.write(build.buildRestoreDefaultsPacket());
      await this.channel.sleep(this.profile.postFlashReadDelayMs);
      this.onEqInvalidated();
    });
  }

  /** Single-register read; the value is at byte 3 for filter and gain mode. */
  readRegister(cmd: number): Promise<Uint8Array> {
    return this.channel.enqueue(() =>
      this.channel.request(build.buildRegisterReadRequest(cmd), (p) => parse.isResponse(p, cmd) && p.length >= 4, {
        label: `register 0x${cmd.toString(16)}`,
      }),
    );
  }
}
