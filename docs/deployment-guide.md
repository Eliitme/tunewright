# Deployment guide

Cloudflare account: EliitmeVN. Zone: `serendipity-work.com` (its root mail stays on Hostinger; Tunewright sends from a subdomain so the root MX/SPF/DKIM are untouched).

| Piece | Staging | Production |
|---|---|---|
| Web app (Worker, static assets) | `tunewright-web-staging` → https://tunewright-staging.serendipity-work.com | `tunewright-web` → https://tunewright.serendipity-work.com |
| Sync API (Worker) | `tunewright-api-staging` → https://tunewright-api-staging.serendipity-work.com | `tunewright-api` → https://tunewright-api.serendipity-work.com |
| D1 | `walk-tuning-db-staging` (`8008a88a-c5b7-45a0-8ffe-e80c719a1ba0`) | `walk-tuning-db` (`78ab318a-ef5b-4427-a2e0-bc6a8344c34a`) |
| Login mail sender | `login@tunewright-mail.serendipity-work.com` (Email Sending; DNS records under `tunewright-mail.` only) | same |
| Turnstile widget | `tunewright` (hostnames: both web origins), site key `0x4AAAAAAFxokVZVIzh9SvDC` (public) | same |

The D1 names predate the project's rename; they are internal and kept so staging data survives.

Secrets per API Worker (never in git): `TOKEN_PEPPER` (random), `TURNSTILE_SECRET` (from the Turnstile widget page).

## Release order

Migrations → API → smoke test → web. Migrations must be additive (expand, then contract in a later release).

```sh
cd apps/api
npx wrangler d1 migrations apply walk-tuning-db-staging --env staging --remote
npx wrangler deploy --env staging                    # production: --env production, D1 walk-tuning-db
npx wrangler secret put TURNSTILE_SECRET --env staging   # once per Worker; paste when prompted

cd ../web
pnpm build:staging && pnpm deploy:staging            # production: build:production / deploy:production
```

`vite --mode <env>` picks the API origin and Turnstile key (`src/config/environment-settings.ts`) and emits `dist/_headers` with a CSP for that API; an unknown mode fails the build. Never run a bare `wrangler deploy`: the top-level configs are for local development only.

## Local

`apps/api/.dev.vars` (copy `.dev.vars.example`) uses Cloudflare's always-pass Turnstile test secret. `wrangler dev` writes sent mail to `.wrangler/tmp/email/` instead of delivering it.
