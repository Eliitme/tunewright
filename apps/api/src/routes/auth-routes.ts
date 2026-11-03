/**
 * Passwordless sign-in. Web logins get a link and a code; Mac logins get only
 * a code that must be redeemed with the verifier behind their challenge, so a
 * code read off someone else's screen or inbox is useless without the app.
 */
import { Hono } from "hono";
import { z } from "zod";
import type { AppDeps } from "../app-deps.ts";
import { now, type AppEnv } from "../env.ts";
import * as tokens from "../db/login-token-repository.ts";
import * as users from "../db/user-session-repository.ts";
import { requireSession } from "../lib/session-middleware.ts";
import { hmacHex, randomCode, randomToken, sha256Base64Url, sha256Hex, timingSafeEqualStrings } from "../lib/token-hashing.ts";

const email = z.string().trim().toLowerCase().max(254).email();
const b64url = (min: number, max: number) => z.string().regex(/^[A-Za-z0-9_-]+$/).min(min).max(max);

const requestSchema = z.discriminatedUnion("client", [
  z.object({ client: z.literal("web"), email, turnstileToken: z.string().max(2048) }),
  z.object({ client: z.literal("mac"), email, turnstileToken: z.string().max(2048), challenge: b64url(43, 43) }),
]);

const verifySchema = z.union([
  z.object({ token: b64url(20, 128) }),
  z.object({ email, code: z.string().regex(/^\d{6}$/), verifier: b64url(43, 128).optional() }),
]);

const invalid = { error: "invalid_or_expired" } as const;

export function authRoutes(deps: AppDeps) {
  const app = new Hono<AppEnv>();

  // Always 200 so the response never reveals whether an address has an account or hit its limit.
  app.post("/request", async (c) => {
    const parsed = requestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "bad_request" }, 400);
    const body = parsed.data;
    const ip = c.req.header("CF-Connecting-IP") ?? null;
    if (!(await deps.turnstile(c.env)(body.turnstileToken, ip))) return c.json({ error: "captcha_failed" }, 400);

    const t = now();
    const token = randomToken();
    const code = randomCode();
    const issued = await tokens.issueLoginToken(
      c.env.DB,
      {
        tokenHash: await sha256Hex(token),
        email: body.email,
        codeHash: await hmacHex(c.env.TOKEN_PEPPER, `${body.email}:${code}`),
        challenge: body.client === "mac" ? body.challenge : null,
        client: body.client,
      },
      t,
    );
    if (!issued) return c.json({ ok: true });
    // The link opens a page that asks for a click before redeeming, so mail scanners cannot burn it.
    const link = body.client === "web" ? `${c.env.WEB_APP_URL}/auth/verify#t=${token}` : undefined;
    try {
      await deps.mailer(c.env).sendLogin({ to: body.email, code, link });
    } catch {
      return c.json({ error: "mail_failed" }, 502);
    }
    return c.json({ ok: true });
  });

  app.post("/verify", async (c) => {
    const parsed = verifySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "bad_request" }, 400);
    const body = parsed.data;
    const t = now();
    const db = c.env.DB;

    let address: string | null;
    let client: "web" | "mac" = "web";
    if ("token" in body) {
      address = await tokens.consumeToken(db, await sha256Hex(body.token), t, "web");
      if (!address) return c.json(invalid, 400);
    } else {
      if ((await tokens.countRecentFailures(db, body.email, t)) >= tokens.MAX_FAILURES_PER_HOUR) {
        return c.json({ error: "too_many_attempts" }, 429);
      }
      const challenge = body.verifier ? await sha256Base64Url(body.verifier) : null;
      const candidate = await tokens.spendCodeAttempt(db, body.email, t, challenge);
      // Only a wrong code against a real live login counts as a failure; random calls cannot lock an email out.
      if (!candidate) return c.json(invalid, 400);
      if (!timingSafeEqualStrings(candidate.code_hash, await hmacHex(c.env.TOKEN_PEPPER, `${body.email}:${body.code}`))) {
        await tokens.recordFailure(db, body.email, t);
        return c.json(invalid, 400);
      }
      address = await tokens.consumeToken(db, candidate.token_hash, t);
      if (!address) return c.json(invalid, 400);
      if (candidate.challenge) client = "mac";
    }

    const user = await users.findOrCreateUser(db, address, t);
    const sessionToken = randomToken();
    await users.createSession(db, await sha256Hex(sessionToken), user.id, client, t);
    return c.json({ sessionToken, user });
  });

  app.post("/logout", requireSession, async (c) => {
    await users.deleteSession(c.env.DB, c.get("sessionHash"));
    return c.json({ ok: true });
  });

  app.post("/logout-all", requireSession, async (c) => {
    await users.deleteAllSessions(c.env.DB, c.get("user").id);
    return c.json({ ok: true });
  });

  return app;
}
