/** Direction byte (payload[0]). */
export const DIR_READ = 0x80;
export const DIR_WRITE = 0x01;

/** Command byte (payload[1]). */
export const CMD = {
  FLASH_SAVE: 0x01,
  MIC_VOLUME: 0x02,
  PREAMP: 0x03,
  BAND: 0x09,
  RAM_APPLY: 0x0a,
  VERSION: 0x0c,
  FILTER_MODE: 0x11,
  BALANCE: 0x16,
  RESTORE_DEFAULTS: 0x17,
  GAIN_MODE: 0x19,
  AMP_MODE: 0x1d,
} as const;

export const BAND_PAYLOAD_LENGTH_FIELD = 0x18;

/** Offsets inside a band payload (read response and write packet share the layout). */
export const BAND_OFFSET = {
  INDEX: 4,
  COEFFS: 7,
  FREQ: 27,
  Q: 29,
  GAIN: 31,
  TYPE: 33,
  /** The DAC echoes 0 / 101 / 0 here; writes mirror what it stores. */
  TAIL: 34,
} as const;
export const BAND_WRITE_TAIL = [0x00, 0x65, 0x00] as const;
export const BAND_PACKET_LENGTH = 37;

export const FILTER_TYPE_BYTE = { LSQ: 1, PK: 2, HSQ: 3, LP: 4, HP: 5 } as const;

export const FILTER_MODES = ["FAST-LL", "FAST-PC", "Slow-LL", "Slow-PC", "NON-OS"] as const;
export type FilterMode = (typeof FILTER_MODES)[number];
