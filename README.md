# Tunewright

EQ tuning for the **EPZ TP35 Pro** USB-C DAC dongle (Walkplay chip, VID `0x3302` / PID `0x43E6`):

- **Web app**: Chrome / Edge / Opera on desktop (needs WebHID). Safari and Firefox are not supported.
- **macOS app**: SwiftUI menu bar app with global hotkeys to switch presets.
- Preset sync across devices (Cloudflare Worker + D1), email sign-in, shareable preset links.

Live: https://tunewright.serendipity-work.com (staging: https://tunewright-staging.serendipity-work.com).

Status: in development. See `docs/`.

Tunewright is an independent project. It is not affiliated with, endorsed by or sponsored by EPZ or Walkplay; their names are used only to say which hardware it works with, and remain trademarks of their owners.

## Layout

```
packages/walkplay-protocol/   Walkplay HID protocol (TypeScript, no DOM)
packages/webhid-transport/    WebHID transport shared by the web app and the spike page
test-vectors/                 Vectors shared by the TypeScript and Swift ports
tools/hardware-spike/         Minimal WebHID page to probe a real TP35 Pro
apps/web | apps/api | apps/macos
```

## Development

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test
pnpm --filter @tunewright/web dev              # http://localhost:5173 (add ?fake=1 for a simulated DAC)
pnpm --filter @tunewright/hardware-spike dev   # http://localhost:5174
pnpm --filter @tunewright/api db:migrate:local && pnpm --filter @tunewright/api dev   # sync API on http://localhost:8787
```

## License

[PolyForm Noncommercial 1.0.0](LICENSE). Free to use, modify and share for **noncommercial** purposes. Commercial use is not permitted.
Third-party material: see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Not affiliated with EPZ or Walkplay. Use at your own risk, and always lower the volume before applying an unfamiliar preset.
