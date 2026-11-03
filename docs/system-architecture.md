# System architecture

```
Web (Vite/React, Cloudflare Pages) ─┐                ┌─ Cloudflare Worker (Hono) ── D1
  └─ WebHID transport               ├── HTTPS/JSON ──┤     magic-link auth (Email Service)
macOS app (SwiftUI, menu bar) ──────┘                └─ /s/:slug share snapshots (cached)
  └─ IOKit HID transport

Both clients ──► Walkplay protocol (TS package / Swift port) ──► HID report 0x4B ──► TP35 Pro
```

## Protocol layer (`packages/walkplay-protocol`)
- Packet builders/parsers: pure functions; payloads exclude the report ID.
- `HidTransport`: each platform normalizes framing (adds/strips the report ID, pads to `outputReportLength`).
- `WalkplayRequestChannel`: one report in flight, 16 ms pacing, timeouts with retry, instant rejection on disconnect, counts unsolicited reports (another app driving the DAC).
- `WalkplaySession`: snapshot → write → RAM apply → verify → retry once → restore; flash only after a verified RAM state; live edits are coalesced (latest wins); a flat read after connect is re-read before it is trusted.
- `WalkplayUtilityControls`: filter mode, gain mode, restore defaults, register reads.
- `WalkplayProbeAccess`: raw paced report access for the hardware spike; only created with `enableProbeAccess`.
- Preset schema v1 (zod), preset → device state mapping, clip-safe preamp, frequency response, AutoEQ text import.

## Data
Preset schema v1 is shared (zod in TS, Codable in Swift, fixtures in `test-vectors/`). Sync uses a server-assigned `rev`.

## Shared vectors
See `docs/test-vectors-contract.md`.

## Web app (`apps/web`)
- Vite + React 19 + Tailwind v4 + zustand. Shared WebHID transport in `packages/webhid-transport`.
- UI kit: GlassyUI (vendored, `src/components/glassyui/`, do not edit; re-add with the shadcn CLI to update). `src/components/ui-primitives.tsx`, `glass-select-field.tsx` and `confirm-dialog.tsx` wrap it; app colour tokens in `index.css` point at GlassyUI's `--lg-*` theme variables so the canvas graph follows light/dark. `apps/web` disables `noUncheckedIndexedAccess` because the vendored code does not compile with it.
- Editor (single screen, no page scroll on desktop): response graph (drag point = freq/gain, wheel = Q; when focused, arrows nudge the selected band, `[`/`]` change Q, number keys pick a band), a 10-column band strip (type, bipolar gain slider filled from 0 dB, gain/Hz/Q inputs), preamp with clip-safe Auto, presets, DAC controls, Reset. ⌘S/Ctrl+S saves to the DAC. LP/HP bands keep gain at 0.
- `hid/tp35-device-connection.ts`: `requestDevice` (prompt) or `getDevices` (auto), picks the collection carrying report `0x4B`; plug events trigger auto-connect. `app.tsx` serializes connection attempts.
- `state/device-store.ts`: owns the `WalkplaySession` (outside React state). Edits update the store immediately and reach the DAC through a 100 ms debounced `applyLive`; Save, preset apply and Revert use the verified path. Editing is locked while the initial read is unconfirmed. Unsolicited reports raise a "another app is controlling the DAC" banner.
- `state/preset-store.ts`: local presets behind a `PresetRepository` (localStorage, never throws). Imports (AutoEQ text or preset JSON) are validated, mapped to the device and given a clip-safe preamp before they can be saved or applied.
- Sync (`src/sync/`): `api-client.ts` (bearer + `X-Client-Version`, typed `ApiError`), `preset-sync-engine.ts` (one round = pull by `sinceRev`, then push dirty presets with `baseRev`; server wins, local edits survive as "(conflict)" copies; entries are patched one at a time so edits during a round are kept; 410 → full resync), `auth-session.ts` (session in localStorage, sign-in by link or code, sign-out drops the account's cached presets, single-flight `syncNow`), `sync-triggers.ts` (after edits, on focus/online, every minute), `shared-link-opener.ts` (`/s/<slug>` → import dialog).
- Presets carry `owner`, `rev`, `dirty`, `deleted`; the UI lists local-only presets plus the signed-in account's. First sign-in offers to adopt local-only presets (deduplicated by content).
- `/auth/verify#t=…` scrubs the token from the URL and redeems it only on click (mail scanners open links).
- Build mode picks the API origin and Turnstile site key (`src/config/environment-settings.ts`); the Vite build emits `_headers` with a CSP for that API. Served by Workers static assets (`apps/web/wrangler.jsonc`, SPA fallback).
- Dialogs: GlassyUI's dialog backdrop filter blurred the dialog's own text in Chrome, so `index.css` gives `.lg-dialog-content` a near-opaque surface without a backdrop filter.
- `?fake=1` in dev uses the in-memory fake DAC; it is loaded with a dynamic import behind `import.meta.env.DEV` and is absent from production builds.

## Sync API (`apps/api`)
- Cloudflare Worker (Hono) + D1, schema in `migrations/`. `src/app.ts` builds the app from `AppDeps` (mailer, Turnstile) so tests run against real D1 in Miniflare with a fake mailbox.
- Sign-in without passwords: `POST /auth/request` always answers 200. Web mail carries a link (`/auth/verify#t=…`, in the fragment so it never reaches server logs or `Referer`) plus a 6-digit code; Mac mail carries only a code, redeemable only with the verifier behind the app's `challenge` (PKCE-style S256).
- Atomic single statements stand in for transactions: an attempt is spent before the code is compared (5 per login), a token is consumed by the one `UPDATE … WHERE used_at IS NULL` that succeeds, the preset quota (200) is checked inside the `INSERT`, updates are conditional on `rev = baseRev`, delete + share removal is one D1 batch.
- Limits: 5 login mails per email per hour (checked inside the insert) and 10 wrong codes per email per hour (counted in D1; calls without a live login, or a Mac login without its verifier, never count or spend attempts); per-IP bursts via Rate Limiting bindings (per location); body ≤ 16 KB; exact-origin CORS; `X-Client-Version` below `MIN_CLIENT_VERSION` gets 426.
- Sessions: random bearer token, SHA-256 stored, 30-day rolling (refreshed at most daily), 90-day absolute; logout and logout-all.
- Presets: every query is scoped by `user_id`, so another user's id is a 404. `GET /presets?sinceRev=` returns changes and tombstones in server `rev` order. The rev bump and the write share one D1 batch, so revs become visible in issue order and an incremental pull never skips a change. Reviving a tombstone counts against the quota. A client whose `sinceRev` is older than the last tombstone cleanup gets `410 resync_required` and must pull from 0.
- Shares: `POST /presets/:id/share` freezes a snapshot (`schema`, name, preamp, bands, filter mode; valid input for `parsePreset`), only if the preset is still live at the rev that was read; public `GET /s/:slug` is cached for 5 minutes, with a best-effort purge on unshare/delete in the purging location.
- Daily cron removes expired logins, sessions, old failures and tombstones older than 30 days.
