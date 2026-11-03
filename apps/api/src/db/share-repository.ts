/** Public share snapshots. Re-sharing keeps the slug and refreshes the snapshot. */
import { randomSlug } from "../lib/token-hashing.ts";

/**
 * Stores the snapshot only if the preset is still live at the rev it was read
 * from, so a delete racing the share can never leave a public link behind.
 * Returns null when the preset changed or was deleted meanwhile.
 */
export async function upsertShare(
  db: D1Database,
  userId: string,
  presetId: string,
  presetRev: number,
  snapshotJson: string,
  now: number,
): Promise<string | null> {
  const row = await db
    .prepare(
      `INSERT INTO shares (slug, user_id, preset_id, snapshot_json, created_at)
       SELECT ?, ?, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM presets WHERE user_id = ? AND id = ? AND rev = ? AND deleted_at IS NULL)
       ON CONFLICT (user_id, preset_id) DO UPDATE SET snapshot_json = excluded.snapshot_json, created_at = excluded.created_at
       RETURNING slug`,
    )
    .bind(randomSlug(), userId, presetId, snapshotJson, now, userId, presetId, presetRev)
    .first<{ slug: string }>();
  return row?.slug ?? null;
}

/** Returns the removed slug so its cached copy can be purged. */
export async function deleteShare(db: D1Database, userId: string, presetId: string): Promise<string | null> {
  const row = await db
    .prepare("DELETE FROM shares WHERE user_id = ? AND preset_id = ? RETURNING slug")
    .bind(userId, presetId)
    .first<{ slug: string }>();
  return row?.slug ?? null;
}

export async function getShareSnapshot(db: D1Database, slug: string): Promise<string | null> {
  const row = await db.prepare("SELECT snapshot_json FROM shares WHERE slug = ?").bind(slug).first<{ snapshot_json: string }>();
  return row?.snapshot_json ?? null;
}
