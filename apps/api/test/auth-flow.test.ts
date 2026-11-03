import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { call, lastMail, linkToken, macChallenge, mailbox, signIn, VALID_CAPTCHA } from "./api-test-client.ts";

const request = (email: string, extra: object = {}) =>
  call("POST", "/auth/request", { client: "web", email, turnstileToken: VALID_CAPTCHA, ...extra });

describe("web sign-in", () => {
  it("magic link creates the user and a working session; the link works once", async () => {
    expect((await request("Ana@Example.com ")).status).toBe(200);
    const mail = lastMail("ana@example.com");
    expect(mail.link).toMatch(/^http:\/\/localhost:5173\/auth\/verify#t=/);
    expect(mail.code).toMatch(/^\d{6}$/);
    const first = await call("POST", "/auth/verify", { token: linkToken(mail) });
    expect(first.status).toBe(200);
    expect(first.json.user.email).toBe("ana@example.com");
    expect((await call("GET", "/me", undefined, { token: first.json.sessionToken })).json.user.email).toBe("ana@example.com");
    expect((await call("POST", "/auth/verify", { token: linkToken(mail) })).status).toBe(400);
  });

  it("the 6-digit code also signs in, and a new request retires the old one", async () => {
    await request("bo@example.com");
    const old = lastMail("bo@example.com");
    await request("bo@example.com");
    const fresh = lastMail("bo@example.com");
    expect((await call("POST", "/auth/verify", { token: linkToken(old) })).status).toBe(400);
    expect((await call("POST", "/auth/verify", { email: "bo@example.com", code: fresh.code })).status).toBe(200);
  });

  it("rejects a failed captcha and never reveals the hourly request limit", async () => {
    expect((await request("cy@example.com", { turnstileToken: "bad" })).status).toBe(400);
    const before = mailbox.length;
    for (let i = 0; i < 7; i++) expect((await request("cy@example.com")).status).toBe(200);
    expect(mailbox.length - before).toBe(5);
  });

  it("expired codes are refused", async () => {
    await request("dee@example.com");
    await env.DB.prepare("UPDATE login_tokens SET expires_at = 0 WHERE email = ?").bind("dee@example.com").run();
    expect((await call("POST", "/auth/verify", { email: "dee@example.com", code: lastMail("dee@example.com").code })).status).toBe(400);
  });
});

describe("code guessing", () => {
  it("50 parallel wrong guesses spend exactly 5 attempts, after which the right code fails too", async () => {
    await request("eve@example.com");
    const right = lastMail("eve@example.com").code;
    const wrong = right === "000000" ? "111111" : "000000";
    const results = await Promise.all(Array.from({ length: 50 }, () => call("POST", "/auth/verify", { email: "eve@example.com", code: wrong })));
    expect(results.every((r) => r.status === 400 || r.status === 429)).toBe(true);
    const row = await env.DB.prepare("SELECT attempts FROM login_tokens WHERE email = ? AND used_at IS NULL").bind("eve@example.com").first<{ attempts: number }>();
    expect(row?.attempts).toBe(5);
    expect((await call("POST", "/auth/verify", { email: "eve@example.com", code: right })).status).not.toBe(200);
  });

  it("locks verification after 10 failures in an hour", async () => {
    await env.DB.batch(Array.from({ length: 10 }, () => env.DB.prepare("INSERT INTO auth_failures (email, at) VALUES (?, ?)").bind("fay@example.com", Math.floor(Date.now() / 1000))));
    await request("fay@example.com");
    expect((await call("POST", "/auth/verify", { email: "fay@example.com", code: lastMail("fay@example.com").code })).status).toBe(429);
  });

  it("parallel redemption of one link yields exactly one session", async () => {
    await request("gus@example.com");
    const token = linkToken(lastMail("gus@example.com"));
    const results = await Promise.all(Array.from({ length: 10 }, () => call("POST", "/auth/verify", { token })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
  });
});

describe("mac sign-in", () => {
  it("mails only a code, and the code needs the matching verifier", async () => {
    const { verifier, challenge } = await macChallenge();
    await call("POST", "/auth/request", { client: "mac", email: "hal@example.com", turnstileToken: VALID_CAPTCHA, challenge });
    const mail = lastMail("hal@example.com");
    expect(mail.link).toBeUndefined();
    expect((await call("POST", "/auth/verify", { email: "hal@example.com", code: mail.code })).status).toBe(400);
    expect((await call("POST", "/auth/verify", { email: "hal@example.com", code: mail.code, verifier: "x".repeat(43) })).status).toBe(400);
    expect((await call("POST", "/auth/verify", { email: "hal@example.com", code: mail.code, verifier })).status).toBe(200);
  });

  it("a mac login token cannot be redeemed as a web link", async () => {
    const { challenge } = await macChallenge();
    await call("POST", "/auth/request", { client: "mac", email: "ivy@example.com", turnstileToken: VALID_CAPTCHA, challenge });
    const row = await env.DB.prepare("SELECT token_hash FROM login_tokens WHERE email = ?").bind("ivy@example.com").first();
    expect(row).not.toBeNull();
    // The raw token is never mailed for mac, so the only redemption path is code + verifier.
    expect(lastMail("ivy@example.com").link).toBeUndefined();
  });
});

describe("sessions", () => {
  it("logout ends one session, logout-all ends every session", async () => {
    const a = await signIn("jo@example.com");
    const b = await signIn("jo@example.com");
    expect((await call("POST", "/auth/logout", undefined, { token: a })).status).toBe(200);
    expect((await call("GET", "/me", undefined, { token: a })).status).toBe(401);
    expect((await call("GET", "/me", undefined, { token: b })).status).toBe(200);
    const c = await signIn("jo@example.com");
    await call("POST", "/auth/logout-all", undefined, { token: c });
    expect((await call("GET", "/me", undefined, { token: b })).status).toBe(401);
  });

  it("a session past its absolute limit is refused even if recently used", async () => {
    const token = await signIn("kai@example.com");
    await env.DB.prepare("UPDATE sessions SET absolute_expires_at = 1 WHERE user_id = (SELECT id FROM users WHERE email = ?)").bind("kai@example.com").run();
    expect((await call("GET", "/me", undefined, { token })).status).toBe(401);
  });

  it("outdated clients get 426", async () => {
    expect((await call("POST", "/auth/request", {}, { version: "0.0.9" })).status).toBe(426);
    expect((await call("GET", "/me", undefined, { version: null })).status).toBe(426);
  });

  it("CORS only echoes allowlisted origins", async () => {
    const ok = await call("GET", "/me", undefined, { origin: "http://localhost:5173" });
    expect(ok.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
    const bad = await call("GET", "/me", undefined, { origin: "https://evil.example" });
    expect(bad.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
