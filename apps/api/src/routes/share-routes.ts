/**
 * Share links. The owner freezes a snapshot of the preset; the public route
 * serves only that snapshot's sound settings, never ids, revisions or owner.
 */
import { Hono } from "hono";
import { eqPresetSchema, PRESET_SCHEMA_VERSION, type EqPreset } from "@tunewright/walkplay-protocol";
import { now, type AppEnv } from "../env.ts";
import { getPreset } from "../db/preset-repository.ts";
import * as shares from "../db/share-repository.ts";
import { purgeCachedShare, readCachedShare, SHARE_MAX_AGE_SECONDS, storeCachedShare } from "../lib/share-cache.ts";
import { presetIdSchema } from "./preset-routes.ts";

/** Keeps only known sound fields, dropping anything extra a client stored. Valid input for `parsePreset`. */
function publicSnapshot(p: EqPreset) {
  return {
    schema: PRESET_SCHEMA_VERSION,
    name: p.name,
    preamp: p.preamp,
    bands: p.bands.map(({ type, freq, q, gain }) => ({ type, freq, q, gain })),
    ...(p.filterMode ? { filterMode: p.filterMode } : {}),
  };
}

/** Mounted under /presets, behind the session middleware. */
export function shareOwnerRoutes() {
  const app = new Hono<AppEnv>();

  app.post("/:id/share", async (c) => {
    const id = presetIdSchema.safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "bad_request" }, 400);
    const userId = c.get("user").id;
    const row = await getPreset(c.env.DB, userId, id.data);
    if (!row?.data_json) return c.json({ error: "not_found" }, 404);
    const stored = eqPresetSchema.safeParse(JSON.parse(row.data_json));
    if (!stored.success) return c.json({ error: "preset_invalid" }, 422);
    const slug = await shares.upsertShare(c.env.DB, userId, id.data, row.rev, JSON.stringify(publicSnapshot(stored.data)), now());
    if (!slug) return c.json({ error: "conflict" }, 409);
    await purgeCachedShare(new URL(c.req.url).origin, slug);
    return c.json({ slug });
  });

  app.delete("/:id/share", async (c) => {
    const id = presetIdSchema.safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "bad_request" }, 400);
    const slug = await shares.deleteShare(c.env.DB, c.get("user").id, id.data);
    if (!slug) return c.json({ error: "not_found" }, 404);
    await purgeCachedShare(new URL(c.req.url).origin, slug);
    return c.json({ ok: true });
  });

  return app;
}

export function publicShareRoutes() {
  const app = new Hono<AppEnv>();

  app.get("/:slug", async (c) => {
    const slug = c.req.param("slug");
    if (!/^[A-Za-z0-9]{12,32}$/.test(slug)) return c.json({ error: "not_found" }, 404);
    const origin = new URL(c.req.url).origin;
    const cached = await readCachedShare(origin, slug);
    if (cached) return cached;
    const snapshot = await shares.getShareSnapshot(c.env.DB, slug);
    if (!snapshot) return c.json({ error: "not_found" }, 404);
    const res = new Response(snapshot, {
      headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${SHARE_MAX_AGE_SECONDS}` },
    });
    // Fill the cache after responding; app.request() in tests has no execution context.
    const store = storeCachedShare(origin, slug, res);
    try {
      c.executionCtx.waitUntil(store);
    } catch {
      await store;
    }
    return res;
  });

  return app;
}
