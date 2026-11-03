/** Bindings and settings available to the Worker (see wrangler.jsonc). */
export interface Env {
  DB: D1Database;
  EMAIL: SendEmail;
  AUTH_LIMITER: RateLimit;
  SHARE_LIMITER: RateLimit;
  /** Comma-separated exact origins allowed by CORS. */
  WEB_ORIGINS: string;
  /** Base URL of the web app; magic links point at `${WEB_APP_URL}/auth/verify`. */
  WEB_APP_URL: string;
  MAIL_FROM: string;
  MIN_CLIENT_VERSION: string;
  /** Secret key for hashing 6-digit codes, so a leaked table cannot be brute-forced offline. */
  TOKEN_PEPPER: string;
  TURNSTILE_SECRET: string;
}

export interface User {
  id: string;
  email: string;
}

/** Hono context variables set by middleware. */
export interface Variables {
  user: User;
  sessionHash: string;
}

export type AppEnv = { Bindings: Env; Variables: Variables };

export const now = () => Math.floor(Date.now() / 1000);
