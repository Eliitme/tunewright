/**
 * Synced presets. Every statement is scoped by user_id; revisions come from a
 * single server counter so clients never depend on their own clocks.
 *
 * The counter bump and the write run in one D1 batch (one transaction), so
 * revisions become visible in the order they were issued and a client that
 * pulled up to rev N can never later miss a change with a rev below N.
 */
export const PRESET_QUOTA = 200;
export const TOMBSTONE_RETENTION_SECONDS = 30 * 86_400;

export interface PresetRow {
  id: string;
  data_json: string | null;
  rev: number;
  updated_at: number;
  deleted_at: number | null;
}

const COLUMNS = "id, data_json, rev, updated_at, deleted_at";
const BUMP_REV = "UPDATE rev_counter SET value = value + 1 WHERE id = 1";
const CURRENT_REV = "(SELECT value FROM rev_counter WHERE id = 1)";
const LIVE_COUNT = "(SELECT COUNT(*) FROM presets WHERE user_id = ? AND deleted_at IS NULL)";

export async function listSince(db: D1Database, userId: string, sinceRev: number, limit: number): Promise<PresetRow[]> {
  const { results } = await db
    .prepare(`SELECT ${COLUMNS} FROM presets WHERE user_id = ? AND rev > ? ORDER BY rev LIMIT ?`)
    .bind(userId, sinceRev, limit)
    .all<PresetRow>();
  return results;
}

/** Revisions at or below this may have lost tombstones to the cleanup job; such clients must resync fully. */
export async function purgedThroughRev(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT purged_through_rev AS r FROM rev_counter WHERE id = 1").first<{ r: number }>();
  return row?.r ?? 0;
}

export async function getPreset(db: D1Database, userId: string, id: string): Promise<PresetRow | null> {
  return db.prepare(`SELECT ${COLUMNS} FROM presets WHERE user_id = ? AND id = ?`).bind(userId, id).first<PresetRow>();
}

export type WriteFailure = { ok: false; reason: "conflict" | "not_found" | "quota"; current?: PresetRow };
export type WriteResult = { ok: true; row: PresetRow; removedShareSlug?: string } | WriteFailure;

async function explainFailure(db: D1Database, userId: string, id: string, baseRev: number): Promise<WriteFailure> {
  const current = await getPreset(db, userId, id);
  if (!current) return { ok: false, reason: baseRev === 0 ? "quota" : "not_found" };
  // The rev still matched, so the only thing that can have blocked the write is the quota.
  if (current.rev === baseRev) return { ok: false, reason: "quota" };
  return { ok: false, reason: "conflict", current };
}

/**
 * Creates when baseRev is 0, otherwise updates only if the stored rev still
 * equals baseRev. Bringing a tombstone back counts against the quota too.
 */
export async function putPreset(
  db: D1Database,
  userId: string,
  id: string,
  dataJson: string,
  baseRev: number,
  now: number,
): Promise<WriteResult> {
  const write =
    baseRev === 0
      ? db
          .prepare(
            `INSERT INTO presets (user_id, id, data_json, rev, updated_at, deleted_at)
             SELECT ?, ?, ?, ${CURRENT_REV}, ?, NULL WHERE ${LIVE_COUNT} < ?
             ON CONFLICT (user_id, id) DO NOTHING
             RETURNING ${COLUMNS}`,
          )
          .bind(userId, id, dataJson, now, userId, PRESET_QUOTA)
      : db
          .prepare(
            `UPDATE presets SET data_json = ?, rev = ${CURRENT_REV}, updated_at = ?, deleted_at = NULL
             WHERE user_id = ? AND id = ? AND rev = ? AND (deleted_at IS NULL OR ${LIVE_COUNT} < ?)
             RETURNING ${COLUMNS}`,
          )
          .bind(dataJson, now, userId, id, baseRev, userId, PRESET_QUOTA);
  const [, result] = await db.batch<PresetRow>([db.prepare(BUMP_REV), write]);
  const row = result!.results[0];
  return row ? { ok: true, row } : explainFailure(db, userId, id, baseRev);
}

/** Tombstones a live preset and drops its share in the same transaction. */
export async function deletePreset(db: D1Database, userId: string, id: string, baseRev: number, now: number): Promise<WriteResult> {
  const [, share, update] = await db.batch<{ slug: string } & PresetRow>([
    db.prepare(BUMP_REV),
    db
      .prepare(
        `DELETE FROM shares WHERE user_id = ? AND preset_id = ?
         AND EXISTS (SELECT 1 FROM presets WHERE user_id = ? AND id = ? AND rev = ? AND deleted_at IS NULL)
         RETURNING slug`,
      )
      .bind(userId, id, userId, id, baseRev),
    db
      .prepare(
        `UPDATE presets SET data_json = NULL, rev = ${CURRENT_REV}, updated_at = ?, deleted_at = ?
         WHERE user_id = ? AND id = ? AND rev = ? AND deleted_at IS NULL
         RETURNING ${COLUMNS}`,
      )
      .bind(now, now, userId, id, baseRev),
  ]);
  const row = update!.results[0];
  if (!row) {
    const current = await getPreset(db, userId, id);
    return current ? { ok: false, reason: "conflict", current } : { ok: false, reason: "not_found" };
  }
  return { ok: true, row: { id: row.id, data_json: null, rev: row.rev, updated_at: row.updated_at, deleted_at: row.deleted_at }, removedShareSlug: share!.results[0]?.slug };
}

/** Daily cleanup. Records the highest purged tombstone rev before deleting, in the same transaction. */
export async function purgeExpired(db: D1Database, now: number) {
  const cutoff = now - TOMBSTONE_RETENTION_SECONDS;
  await db.batch([
    db.prepare("DELETE FROM login_tokens WHERE expires_at < ?").bind(now - 3600),
    db.prepare("DELETE FROM auth_failures WHERE at < ?").bind(now - 3600),
    db.prepare("DELETE FROM sessions WHERE expires_at < ? OR absolute_expires_at < ?").bind(now, now),
    db
      .prepare(
        `UPDATE rev_counter SET purged_through_rev = MAX(purged_through_rev,
           COALESCE((SELECT MAX(rev) FROM presets WHERE deleted_at IS NOT NULL AND deleted_at < ?), 0))
         WHERE id = 1`,
      )
      .bind(cutoff),
    db.prepare("DELETE FROM presets WHERE deleted_at IS NOT NULL AND deleted_at < ?").bind(cutoff),
  ]);
}
