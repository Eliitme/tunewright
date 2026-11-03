/** Drives the app in-process against the test D1, with a mailbox instead of real email. */
import { env } from "cloudflare:workers";
import { createApp } from "../src/app.ts";
import type { AppDeps } from "../src/app-deps.ts";
import type { LoginMail } from "../src/lib/magic-link-email.ts";
import { sha256Base64Url } from "../src/lib/token-hashing.ts";

export const mailbox: LoginMail[] = [];
export const VALID_CAPTCHA = "captcha-ok";

const deps: AppDeps = {
  mailer: () => ({ sendLogin: async (mail) => void mailbox.push(mail) }),
  turnstile: () => async (token) => token === VALID_CAPTCHA,
};
export const app = createApp(deps);

let ipCounter = 0;
/** A fresh client IP per call by default so burst limits only apply where a test wants them. */
export const freshIp = () => `10.0.${(ipCounter >> 8) & 255}.${ipCounter++ & 255}`;

export interface CallOptions {
  token?: string;
  ip?: string;
  version?: string | null;
  origin?: string;
}

export async function call(method: string, path: string, body?: unknown, o: CallOptions = {}) {
  const headers: Record<string, string> = { "CF-Connecting-IP": o.ip ?? freshIp() };
  if (o.version !== null) headers["X-Client-Version"] = o.version ?? "0.1.0";
  if (o.token) headers.Authorization = `Bearer ${o.token}`;
  if (o.origin) headers.Origin = o.origin;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env);
  const text = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test responses are checked field by field
  return { status: res.status, headers: res.headers, json: (text ? JSON.parse(text) : null) as any };
}

export const lastMail = (to: string) => [...mailbox].reverse().find((m) => m.to === to)!;
export const linkToken = (mail: LoginMail) => new URL(mail.link!).hash.replace("#t=", "");

/** Signs in through the web code path and returns the session token. */
export async function signIn(email: string): Promise<string> {
  await call("POST", "/auth/request", { client: "web", email, turnstileToken: VALID_CAPTCHA });
  const res = await call("POST", "/auth/verify", { email, code: lastMail(email).code });
  if (res.status !== 200) throw new Error(`sign-in failed: ${res.status}`);
  return res.json.sessionToken as string;
}

export async function macChallenge() {
  const verifier = "v".repeat(20) + crypto.randomUUID().replace(/-/g, "");
  return { verifier, challenge: await sha256Base64Url(verifier) };
}

export const samplePreset = (name = "Warm") => ({
  schema: 1,
  name,
  preamp: -4,
  bands: [
    { type: "LSQ", freq: 105, q: 0.7, gain: 4 },
    { type: "PK", freq: 3000, q: 2, gain: -2.5 },
  ],
});
