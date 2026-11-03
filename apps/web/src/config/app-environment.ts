/**
 * Settings for this build. `vite --mode staging` selects staging; values are
 * public and can be overridden with VITE_API_URL / VITE_TURNSTILE_SITE_KEY.
 */
import { settingsForMode, type EnvironmentSettings } from "./environment-settings.ts";

const base = settingsForMode(import.meta.env.MODE);

export const appEnvironment: EnvironmentSettings = {
  apiUrl: import.meta.env.VITE_API_URL ?? base.apiUrl,
  turnstileSiteKey: import.meta.env.VITE_TURNSTILE_SITE_KEY ?? base.turnstileSiteKey,
};

/** Sent as X-Client-Version; the API answers 426 below its minimum. */
export const CLIENT_VERSION = "0.1.0";
