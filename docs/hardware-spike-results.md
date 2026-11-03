# Hardware spike results

Run 1 — 2026-11-03 · EPZ TP35 Pro · firmware **1.7** (the devicePEQ capture was 1.5) · Chrome on macOS. Listening notes from the tester are included.

| # | Question | Result |
|---|---|---|
| 0 | Firmware version | `1.7`, read with `80 0C 00` |
| 1 | HID collections | One collection: usage page `0x0C` (Consumer), usage `0x01`. Reports `0x4B` and `0x54` (63-byte in/out), input `0x03` (1 byte). No vendor-page collection |
| 2 | Stored coefficients vs our RBJ encoder | **PK**: match (max diff ≤ 2.3e-4, from wire Q rounding; ~7e-3 for Q≈0.1, where small Q errors matter more). **LSQ**: match (1e-3). **HSQ**: stored by the vendor app as `[-0.125, 0.125, -0.043, 0.125, -0.039]`, nothing like a high shelf |
| 2b | What those HSQ coefficients would do if used | about −26 dB across the whole band. The user's EQ does not sound 26 dB quieter, so the firmware **does not use the stored coefficients**, at least for high shelves |
| 3 | Firmware uses our coefficients or recomputes? | **Recomputes.** Low shelf +6 dB metadata with flat coefficients → bass audibly increased |
| 4 | Type byte 4 / 5 | DAC stores and echoes 4 and 5 unchanged (two runs). Listening at 1 kHz: **4 = low pass** (muffled, treble gone), **5 = high pass** (thin, cassette-like, bass gone) → LP/HP enabled |
| 4b | Type byte 3 = high shelf (−6 dB cut) | Stored and echoed (not listened to separately; covered by 4c) |
| 4c | High-shelf boost from metadata only | **Treble audibly brighter** → type 3 is a high shelf computed by the firmware; HSQ enabled |
| 5 | Nonce echo | **Echoed**: band read with nonce `0x5A` answered `80 09 5A …`. Sessions now use nonces 1..255 for band reads |
| 6 | Utility registers (raw `80 cmd 00`) | filter mode `80 11 00 01` → FAST-LL at byte 3; gain mode `80 19 00 00` → low; amp mode `80 1D 00 00`; balance `80 16 00 00`; mic volume `80 02 02 00 03` (value at byte 4). Amp mode, balance and mic volume meanings still unverified |
| 7 | +6 dB at 1 kHz, verified write + readback | **Pass**: clearly audible; `applyVerified` succeeded on hardware (write → RAM apply → readback match), and "Restore snapshot" also verified |
| 8 | Save survives replug | Not run yet |
| 9 | REW sweep | Not run yet |

Run 2 (same day, after page reload) repeated the probes above and added rows 5 and 6. Its "stored coefficients" check matched exactly only because the previous "Restore snapshot" had written our own encoder output; it is not extra evidence about the firmware's filter design.

## Observations
- The DAC stores band packets byte for byte as written (readback = write, including the 0/101/0 tail).
- Unused slots written by the vendor app are PK, gain 0, Q 26/256 (≈0.1), at 4 k / 7 k / 16 kHz.
- The session's verified write path (pacing, readback tolerance, preamp register) works on firmware 1.7.
