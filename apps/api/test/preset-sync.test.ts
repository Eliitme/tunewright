import { describe, expect, it } from "vitest";
import { call, samplePreset, signIn } from "./api-test-client.ts";

describe("preset sync", () => {
  it("creates, lists incrementally, updates with baseRev and tombstones", async () => {
    const t = await signIn("sync@example.com");
    const created = await call("PUT", "/presets/p1", { data: samplePreset(), baseRev: 0 }, { token: t });
    expect(created.status).toBe(200);
    expect(created.json.rev).toBeGreaterThan(0);

    const list = await call("GET", "/presets?sinceRev=0", undefined, { token: t });
    expect(list.json.items.map((i: { id: string }) => i.id)).toEqual(["p1"]);
    const since = list.json.nextRev;

    const updated = await call("PUT", "/presets/p1", { data: samplePreset("Warmer"), baseRev: created.json.rev }, { token: t });
    expect(updated.json.rev).toBeGreaterThan(created.json.rev);
    const delta = await call("GET", `/presets?sinceRev=${since}`, undefined, { token: t });
    expect(delta.json.items).toHaveLength(1);
    expect(delta.json.items[0].data.name).toBe("Warmer");

    const removed = await call("DELETE", "/presets/p1", { baseRev: updated.json.rev }, { token: t });
    expect(removed.json).toMatchObject({ deleted: true, data: null });
    const after = await call("GET", `/presets?sinceRev=${delta.json.nextRev}`, undefined, { token: t });
    expect(after.json.items[0]).toMatchObject({ id: "p1", deleted: true });
  });

  it("a stale baseRev gets 409 with the server copy", async () => {
    const t = await signIn("stale@example.com");
    const v1 = await call("PUT", "/presets/a", { data: samplePreset(), baseRev: 0 }, { token: t });
    await call("PUT", "/presets/a", { data: samplePreset("Other device"), baseRev: v1.json.rev }, { token: t });
    const conflict = await call("PUT", "/presets/a", { data: samplePreset("Mine"), baseRev: v1.json.rev }, { token: t });
    expect(conflict.status).toBe(409);
    expect(conflict.json.current.data.name).toBe("Other device");
    expect((await call("PUT", "/presets/a", { data: samplePreset(), baseRev: 0 }, { token: t })).status).toBe(409);
  });

  it("users cannot read, change, delete or share each other's presets", async () => {
    const a = await signIn("owner@example.com");
    const b = await signIn("intruder@example.com");
    const own = await call("PUT", "/presets/shared-id", { data: samplePreset(), baseRev: 0 }, { token: a });
    expect((await call("PUT", "/presets/shared-id", { data: samplePreset("Hijack"), baseRev: own.json.rev }, { token: b })).status).toBe(404);
    expect((await call("DELETE", "/presets/shared-id", { baseRev: own.json.rev }, { token: b })).status).toBe(404);
    expect((await call("POST", "/presets/shared-id/share", undefined, { token: b })).status).toBe(404);
    expect((await call("GET", "/presets", undefined, { token: b })).json.items).toEqual([]);
    // The same id is a separate preset for B.
    expect((await call("PUT", "/presets/shared-id", { data: samplePreset("B's"), baseRev: 0 }, { token: b })).status).toBe(200);
    expect((await call("GET", "/presets", undefined, { token: a })).json.items[0].data.name).toBe("Warm");
  });

  it("rejects out-of-bounds presets, oversized bodies and unauthenticated calls", async () => {
    const t = await signIn("bounds@example.com");
    const loud = { ...samplePreset(), bands: [{ type: "PK", freq: 1000, q: 1, gain: 30 }] };
    expect((await call("PUT", "/presets/x", { data: loud, baseRev: 0 }, { token: t })).status).toBe(400);
    expect((await call("PUT", "/presets/bad id", { data: samplePreset(), baseRev: 0 }, { token: t })).status).toBe(400);
    const huge = { data: { ...samplePreset(), junk: "x".repeat(20_000) }, baseRev: 0 };
    expect((await call("PUT", "/presets/y", huge, { token: t })).status).toBe(413);
    expect((await call("GET", "/presets")).status).toBe(401);
  });

  it("enforces the 200-preset quota", async () => {
    const t = await signIn("quota@example.com");
    for (let i = 0; i < 200; i++) await call("PUT", `/presets/q${i}`, { data: samplePreset(), baseRev: 0 }, { token: t });
    const over = await call("PUT", "/presets/q200", { data: samplePreset(), baseRev: 0 }, { token: t });
    expect(over.status).toBe(422);
    expect(over.json.error).toBe("quota_exceeded");
  });

  it("pages with hasMore", async () => {
    const t = await signIn("pages@example.com");
    for (let i = 0; i < 3; i++) await call("PUT", `/presets/p${i}`, { data: samplePreset(), baseRev: 0 }, { token: t });
    const page = await call("GET", "/presets?limit=2", undefined, { token: t });
    expect(page.json).toMatchObject({ hasMore: true });
    const rest = await call("GET", `/presets?limit=2&sinceRev=${page.json.nextRev}`, undefined, { token: t });
    expect(rest.json.items).toHaveLength(1);
  });
});
