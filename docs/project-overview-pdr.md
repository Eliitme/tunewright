# Project overview (PDR)

## Goal
Noncommercial software to tune the PEQ of the EPZ TP35 Pro (Walkplay HID) without the vendor app.

## Users
IEM listeners using a TP35 Pro on a desktop browser (Chrome/Edge) or on macOS.

## Functional requirements
- Detect the TP35 Pro (VID 0x3302, PID 0x43E6, vendor HID usage page).
- Read/write 10 PEQ bands plus preamp; audition in real time (RAM), persist to the DAC (flash) only on Save.
- Utilities: filter mode, gain mode; amp mode and balance stay disabled until probed on real hardware.
- Presets: local, synced per account (email magic link), shareable as snapshot links.
- macOS: menu bar icon, global hotkeys to switch presets, full editor.

## Non-functional requirements
- Hearing safety: presets from external sources are always bounded, get a clip-safe preamp and a volume warning.
- Flash wear: flash only on Save and only after the RAM state was verified.
- License PolyForm Noncommercial 1.0.0; no GPL code.

## Out of scope (v0.1)
Dongles other than the TP35 Pro, native Windows/Linux apps, deep-link sign-in on macOS.
