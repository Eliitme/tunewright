/** Users and bearer sessions (stored as SHA-256 of the token). */
import type { User } from "../env.ts";

const DAY = 86_400;
export const SESSION_IDLE_SECONDS = 30 * DAY;
export const SESSION_ABSOLUTE_SECONDS = 90 * DAY;
/** Rolling refresh is written at most once a day per session. */
const REFRESH_AFTER_SECONDS = DAY;

export async function findOrCreateUser(db: D1Database, email: string, now: number): Promise<User> {
  await db
    .prepare("INSERT INTO users (id, email, created_at) VALUES (?, ?, ?) ON CONFLICT (email) DO NOTHING")
    .bind(crypto.randomUUID(), email, now)
    .run();
  const user = await db.prepare("SELECT id, email FROM users WHERE email = ?").bind(email).first<User>();
  if (!user) throw new Error("user upsert failed");
  return user;
}

export async function createSession(db: D1Database, tokenHash: string, userId: string, client: string, now: number) {
  await db
    .prepare(
      `INSERT INTO sessions (token_hash, user_id, client, created_at, expires_at, absolute_expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(tokenHash, userId, client, now, now + SESSION_IDLE_SECONDS, now + SESSION_ABSOLUTE_SECONDS)
    .run();
}

/** Returns the session's user and slides the idle expiry, never past the absolute limit. */
export async function touchSession(db: D1Database, tokenHash: string, now: number): Promise<User | null> {
  const row = await db
    .prepare(
      `SELECT u.id, u.email, s.expires_at, s.absolute_expires_at FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ? AND s.absolute_expires_at > ?`,
    )
    .bind(tokenHash, now, now)
    .first<User & { expires_at: number; absolute_expires_at: number }>();
  if (!row) return null;
  const target = Math.min(now + SESSION_IDLE_SECONDS, row.absolute_expires_at);
  if (target - row.expires_at >= REFRESH_AFTER_SECONDS) {
    await db.prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ?").bind(target, tokenHash).run();
  }
  return { id: row.id, email: row.email };
}

export async function deleteSession(db: D1Database, tokenHash: string) {
  await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
}

export async function deleteAllSessions(db: D1Database, userId: string) {
  await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
}
