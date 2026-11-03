# Walkplay protocol notes (EPZ TP35 Pro)

Written in our own words from: (1) a real HID capture of a TP35 Pro on firmware `1.5` published by devicePEQ (0BSD; copy in `test-vectors/source-captures/`), (2) facts read from reference projects (no code copied), (3) hardware spike results (`docs/hardware-spike-results.md`, not run yet).

## Framing
- HID report ID `0x4B`, in the Consumer Control collection (usage page `0x0C`). Input and output payloads are 63 bytes (64-byte report including the ID). All offsets below are into the payload **without** the report ID.
- Byte 0: `0x80` = READ, `0x01` = WRITE. Byte 1: command.

## Wire decisions
| Item | Decision | Source |
|---|---|---|
| Version | send `80 0C 00` → ASCII from byte 3, NUL-terminated (TP35: `"1.5"`) | capture |
| Read band i | send `80 09 00 00 i 00` → 63-byte payload | capture |
| Band layout (read = write) | `[0]dir [1]09 [2]18 (write) / 00 (read) [3]00 [4]index [5]00 [6]?? [7..26] 5×i32 LE coefficients [27..28] freq u16 [29..30] Q×256 u16 [31..32] gain×256 i16 [33] type [34]00 [35]101 [36]00` | capture |
| Write band | 37 bytes; tail `type, 0, 101, 0` mirrors what the DAC stores; byte 6 written as `0` | capture |
| Byte 6 on read | `0` on the first read pass, `255` on later ones; meaning unknown, ignored | capture |
| Coefficients | RBJ cookbook, fs **96000**, normalized by a0, order `b0 b1 b2 −a1 −a2`, ×2³⁰ rounded → i32 LE. Computed from the **real Q** (e.g. 0.6) while the wire Q field is `round(Q×256)` (0.6 → 154). **The firmware ignores these bytes and recomputes each filter from freq/Q/gain/type**; we still send RBJ values (matching the vendor app) and fall back to identity coefficients when they don't fit Q30 | capture, bit-exact match; spike (by ear) |
| Filter type byte | `1` low shelf, `2` peak, `3` high shelf, `4` low pass, `5` high pass (all confirmed by ear, fw 1.7) | capture + spike |
| High-shelf boosts | RBJ high-shelf boosts need coefficients beyond ±2 (1 kHz +1 dB gives b1 = −2.14). Irrelevant on the TP35 because the firmware computes shelves itself; such bands are sent with identity coefficients | spike |
| Flat band | peak at 0 dB (identity coefficients); the capture uses 100 Hz Q 1 | capture |
| Preamp | separate register: read `80 03 00` → `[4]` = i8 dB (TP35: `F9` = −7); write `01 03 02 00 g`. **Not** embedded in band packets (byte 34 stays 0 with preamp −7). The host must write it | capture |
| Read nonce | byte 2 of a band read is echoed in the reply (fw 1.7). Sessions send nonces 1..255 and match on command + index + nonce | spike |
| Audition (RAM) | `01 0A 04 00 00 FF FF 00` | capture (end of commit sequence) + reference |
| Flash save | RAM apply then `01 01 00`. After flash: no writes for ~100 ms, no reads for ~200 ms | reference + spike |
| Never sent on Save | `01 05 00`, `01 17 00` (0x17 = restore defaults: resets filter/amp/balance and reloads the stored EQ) | reference |
| Pacing | 16 ms between reports (one HID poll interval) | reference + spike |
| Filter mode | write `01 11 01 m` (1 FAST-LL, 2 FAST-PC, 3 Slow-LL, 4 Slow-PC, 5 NON-OS); read `80 11 00` → `[3]` | reference + spike |
| Gain mode | write `01 19 01 v` (1 = high); read `80 19 00` → `[3]` | reference + spike |
| Amp mode / balance | probe-gated: the references disagree on values | spike |
| Restore defaults | `01 17 00`, only on an explicit Restore button | reference |

## Limits (TP35 profile)
10 bands, 20–20000 Hz, Q 0.1–10, gain ±10 dB (devicePEQ's config for the SchemeNo16 family), preamp −30..0 dB in whole dB. Enabled filter types: PK, LSQ, HSQ, LP, HP. Probe-gated: amp mode, balance. Tested firmware: 1.7.

## Open questions for the hardware spike
1. ~~Coefficient bytes used?~~ — answered: no, the firmware recomputes from metadata.
2. ~~Is type 4/5 LP or HP?~~ — answered by ear: 4 = low pass, 5 = high pass.
6. Does the firmware's filter design match RBJ closely enough for the graph? Needs a REW sweep.
3. ~~Nonce echo~~ — answered: yes.
4. ~~Descriptor layout~~ — answered: one collection, usage page `0x0C` (Consumer) usage `0x01`, with output+input reports `0x54` and `0x4B` (63-byte payloads) and input report `0x03` (1 byte, media keys). No vendor-page collection. Report `0x54` is unknown and unused.
5. Amp mode and balance: values and whether they have any effect.
