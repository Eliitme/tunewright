/** Public per-environment settings, shared by the app and the build (for CSP). */
export interface EnvironmentSettings {
  apiUrl: string;
  turnstileSiteKey: string;
}

export const ENVIRONMENT_SETTINGS: Record<string, EnvironmentSettings> = {
  // Cloudflare's always-pass Turnstile test key; pairs with the test secret in apps/api/.dev.vars.
  development: { apiUrl: "http://localhost:8787", turnstileSiteKey: "1x00000000000000000000AA" },
  test: { apiUrl: "http://api.test", turnstileSiteKey: "1x00000000000000000000AA" },
  staging: { apiUrl: "https://tunewright-api-staging.serendipity-work.com", turnstileSiteKey: "0x4AAAAAAFxokVZVIzh9SvDC" },
  production: { apiUrl: "https://tunewright-api.serendipity-work.com", turnstileSiteKey: "0x4AAAAAAFxokVZVIzh9SvDC" },
};

/** Unknown modes fail the build instead of quietly pointing at another environment. */
export function settingsForMode(mode: string): EnvironmentSettings {
  const settings = ENVIRONMENT_SETTINGS[mode];
  if (!settings) throw new Error(`No environment settings for build mode "${mode}"`);
  return settings;
}

const TURNSTILE = "https://challenges.cloudflare.com";

/** Security headers for the static site (Cloudflare `_headers` format). */
export function securityHeadersFile(mode: string, apiUrl = settingsForMode(mode).apiUrl): string {
  const csp = [
    "default-src 'self'",
    `script-src 'self' ${TURNSTILE}`,
    // Radix and GlassyUI set inline style attributes.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    `connect-src 'self' ${new URL(apiUrl).origin} ${TURNSTILE}`,
    `frame-src ${TURNSTILE}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "form-action 'self'",
  ].join("; ");
  return [
    "/*",
    `  Content-Security-Policy: ${csp}`,
    "  Referrer-Policy: no-referrer",
    "  X-Content-Type-Options: nosniff",
    "  Permissions-Policy: hid=(self), camera=(), microphone=(), geolocation=()",
    "",
  ].join("\n");
}
