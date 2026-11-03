/** Preset sync: incremental pull by server revision, conditional writes, tombstones. */
import { Hono } from "hono";
import { z } from "zod";
import { eqPresetSchema } from "@tunewright/walkplay-protocol";
import { now, type AppEnv } from "../env.ts";
import * as repo from "../db/preset-repository.ts";
import { purgeCachedShare } from "../lib/share-cache.ts";

export const presetIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const rev = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const putSchema = z.object({ data: eqPresetSchema, baseRev: rev });
const deleteSchema = z.object({ baseRev: rev.min(1) });
const listQuery = z.object({
  sinceRev: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(100),
});

export function toItem(row: repo.PresetRow) {
  return {
    id: row.id,
    rev: row.rev,
    updatedAt: row.updated_at,
    deleted: row.deleted_at !== null,
    data: row.data_json === null ? null : (JSON.parse(row.data_json) as unknown),
  };
}

function failure(c: { json: (b: unknown, s: 404 | 409 | 422) => Response }, r: repo.WriteFailure) {
  if (r.reason === "conflict") return c.json({ error: "conflict", current: toItem(r.current!) }, 409);
  if (r.reason === "quota") return c.json({ error: "quota_exceeded", limit: repo.PRESET_QUOTA }, 422);
  return c.json({ error: "not_found" }, 404);
}

export function presetRoutes() {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const q = listQuery.safeParse(c.req.query());
    if (!q.success) return c.json({ error: "bad_request" }, 400);
    const { sinceRev, limit } = q.data;
    // Deletions older than the retention window are gone; a client that far behind must start over.
    if (sinceRev > 0 && sinceRev < (await repo.purgedThroughRev(c.env.DB))) return c.json({ error: "resync_required" }, 410);
    const rows = await repo.listSince(c.env.DB, c.get("user").id, sinceRev, limit);
    return c.json({
      items: rows.map(toItem),
      nextRev: rows.at(-1)?.rev ?? sinceRev,
      hasMore: rows.length === limit,
    });
  });

  app.put("/:id", async (c) => {
    const id = presetIdSchema.safeParse(c.req.param("id"));
    const body = putSchema.safeParse(await c.req.json().catch(() => null));
    if (!id.success || !body.success) return c.json({ error: "bad_request" }, 400);
    const r = await repo.putPreset(c.env.DB, c.get("user").id, id.data, JSON.stringify(body.data.data), body.data.baseRev, now());
    return r.ok ? c.json(toItem(r.row)) : failure(c, r);
  });

  app.delete("/:id", async (c) => {
    const id = presetIdSchema.safeParse(c.req.param("id"));
    const body = deleteSchema.safeParse(await c.req.json().catch(() => null));
    if (!id.success || !body.success) return c.json({ error: "bad_request" }, 400);
    const r = await repo.deletePreset(c.env.DB, c.get("user").id, id.data, body.data.baseRev, now());
    if (!r.ok) return failure(c, r);
    if (r.removedShareSlug) await purgeCachedShare(new URL(c.req.url).origin, r.removedShareSlug);
    return c.json(toItem(r.row));
  });

  return app;
}
