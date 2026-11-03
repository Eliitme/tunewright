/** Cases found in review: ordering of revisions, quota via tombstones, lockout and burn attacks, races. */
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { getPreset } from "../src/db/preset-repository.ts";
import { upsertShare } from "../src/db/share-repository.ts";
import { call, lastMail, macChallenge, mailbox, samplePreset, signIn, VALID_CAPTCHA } from "./api-test-client.ts";

const request = (email: string) => call("POST", "/auth/request", { client: "web", email, turnstileToken: VALID_CAPTCHA });

describe("revision ordering", () => {
  it("parallel writes get distinct revisions that list back in order", async () => {
    const t = await signIn("order@example.com");
    const writes = await Promise.all(Array.from({ length: 20 }, (_, i) => call("PUT", `/presets/o${i}`, { data: samplePreset(), baseRev: 0 }, { token: t })));
    const revs = writes.map((w) => w.json.rev as number);
    expect(new Set(revs).size).toBe(20);
    const list = await call("GET", "/presets", undefined, { token: t });
    const listed = list.json.items.map((i: { rev: number }) => i.rev);
    expect(listed).toEqual([...revs].sort((a, b) => a - b));
  });

  it("clients older than the tombstone cleanup are told to resync", async () => {
    const t = await signIn("old-client@example.com");
    await env.DB.prepare("UPDATE rev_counter SET purged_through_rev = 1000000 WHERE id = 1").run();
    try {
      expect((await call("GET", "/presets?sinceRev=5", undefined, { token: t })).status).toBe(410);
      expect((await call("GET", "/presets?sinceRev=0", undefined, { token: t })).status).toBe(200);
    } finally {
      await env.DB.prepare("UPDATE rev_counter SET purged_through_rev = 0 WHERE id = 1").run();
    }
  });
});

describe("quota and tombstones", () => {
  it("bringing a deleted preset back counts against the quota", async () => {
    const t = await signIn("revive@example.com");
    const user = await call("GET", "/me", undefined, { token: t });
    // Fill to the limit directly in D1 to keep the test fast.
    await env.DB.batch(
      Array.from({ length: 199 }, (_, i) =>
        env.DB.prepare("INSERT INTO presets (user_id, id, data_json, rev, updated_at) VALUES (?, ?, '{}', 1, 0)").bind(user.json.user.id, `f${i}`),
      ),
    );
    const a = await call("PUT", "/presets/a", { data: samplePreset(), baseRev: 0 }, { token: t });
    const gone = await call("DELETE", "/presets/a", { baseRev: a.json.rev }, { token: t });
    expect((await call("PUT", "/presets/b", { data: samplePreset(), baseRev: 0 }, { token: t })).status).toBe(200);
    const revive = await call("PUT", "/presets/a", { data: samplePreset(), baseRev: gone.json.rev }, { token: t });
    expect(revive.status).toBe(422);
  });

  it("deleting a tombstone again is a conflict, not a new revision", async () => {
    const t = await signIn("twice@example.com");
    const a = await call("PUT", "/presets/a", { data: samplePreset(), baseRev: 0 }, { token: t });
    const gone = await call("DELETE", "/presets/a", { baseRev: a.json.rev }, { token: t });
    expect((await call("DELETE", "/presets/a", { baseRev: gone.json.rev }, { token: t })).status).toBe(409);
  });
});

describe("sign-in abuse", () => {
  it("bogus codes for an email without a live login never lock it out", async () => {
    for (let i = 0; i < 15; i++) await call("POST", "/auth/verify", { email: "target@example.com", code: "123456" });
    await request("target@example.com");
    expect((await call("POST", "/auth/verify", { email: "target@example.com", code: lastMail("target@example.com").code })).status).toBe(200);
  });

  it("without the verifier nobody can burn a Mac login's attempts", async () => {
    const { verifier, challenge } = await macChallenge();
    await call("POST", "/auth/request", { client: "mac", email: "macuser@example.com", turnstileToken: VALID_CAPTCHA, challenge });
    for (let i = 0; i < 10; i++) {
      await call("POST", "/auth/verify", { email: "macuser@example.com", code: "000000" });
      await call("POST", "/auth/verify", { email: "macuser@example.com", code: "000000", verifier: "w".repeat(43) });
    }
    expect((await call("POST", "/auth/verify", { email: "macuser@example.com", code: lastMail("macuser@example.com").code, verifier })).status).toBe(200);
  });

  it("parallel login requests cannot exceed the hourly mail limit", async () => {
    const before = mailbox.length;
    await Promise.all(Array.from({ length: 12 }, () => request("burst@example.com")));
    expect(mailbox.length - before).toBe(5);
  });
});

describe("share races", () => {
  it("a share is not created for a preset that changed or was deleted after it was read", async () => {
    const t = await signIn("race@example.com");
    const v1 = await call("PUT", "/presets/r", { data: samplePreset(), baseRev: 0 }, { token: t });
    const userId = (await call("GET", "/me", undefined, { token: t })).json.user.id as string;
    await call("DELETE", "/presets/r", { baseRev: v1.json.rev }, { token: t });
    expect(await upsertShare(env.DB, userId, "r", v1.json.rev, "{}", 0)).toBeNull();
    expect((await getPreset(env.DB, userId, "r"))?.deleted_at).not.toBeNull();
  });
});
