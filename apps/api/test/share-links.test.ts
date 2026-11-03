import { describe, expect, it } from "vitest";
import { call, samplePreset, signIn } from "./api-test-client.ts";

describe("share links", () => {
  it("serve a frozen snapshot without ids, revisions or owner", async () => {
    const t = await signIn("sharer@example.com");
    const v1 = await call("PUT", "/presets/s1", { data: { ...samplePreset(), filterMode: "Slow-LL", note: "private" }, baseRev: 0 }, { token: t });
    const { slug } = (await call("POST", "/presets/s1/share", undefined, { token: t })).json;
    expect(slug).toMatch(/^[A-Za-z0-9]{16}$/);

    await call("PUT", "/presets/s1", { data: samplePreset("Edited later"), baseRev: v1.json.rev }, { token: t });
    const pub = await call("GET", `/s/${slug}`, undefined, { version: null });
    expect(pub.status).toBe(200);
    expect(pub.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(Object.keys(pub.json).sort()).toEqual(["bands", "filterMode", "name", "preamp", "schema"]);
    expect(pub.json.name).toBe("Warm");
  });

  it("re-sharing keeps the slug and refreshes the snapshot", async () => {
    const t = await signIn("reshare@example.com");
    const v1 = await call("PUT", "/presets/r", { data: samplePreset(), baseRev: 0 }, { token: t });
    const first = (await call("POST", "/presets/r/share", undefined, { token: t })).json.slug;
    await call("GET", `/s/${first}`);
    await call("PUT", "/presets/r", { data: samplePreset("V2"), baseRev: v1.json.rev }, { token: t });
    expect((await call("POST", "/presets/r/share", undefined, { token: t })).json.slug).toBe(first);
    expect((await call("GET", `/s/${first}`)).json.name).toBe("V2");
  });

  it("unsharing or deleting the preset makes the link 404", async () => {
    const t = await signIn("unshare@example.com");
    const a = await call("PUT", "/presets/a", { data: samplePreset(), baseRev: 0 }, { token: t });
    const b = await call("PUT", "/presets/b", { data: samplePreset(), baseRev: 0 }, { token: t });
    const slugA = (await call("POST", "/presets/a/share", undefined, { token: t })).json.slug;
    const slugB = (await call("POST", "/presets/b/share", undefined, { token: t })).json.slug;
    await call("GET", `/s/${slugA}`);
    await call("GET", `/s/${slugB}`);

    expect((await call("DELETE", "/presets/a/share", undefined, { token: t })).status).toBe(200);
    expect((await call("GET", `/s/${slugA}`)).status).toBe(404);
    await call("DELETE", "/presets/b", { baseRev: b.json.rev }, { token: t });
    expect((await call("GET", `/s/${slugB}`)).status).toBe(404);
    expect(a.status).toBe(200);
  });

  it("unknown or malformed slugs are 404", async () => {
    expect((await call("GET", "/s/doesNotExist1234")).status).toBe(404);
    expect((await call("GET", "/s/%27--")).status).toBe(404);
  });
});
