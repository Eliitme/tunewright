/**
 * Login tokens and failed-attempt counters. Every check-and-change is a
 * single SQL statement because D1 has no interactive transactions.
 */
export const LOGIN_TTL_SECONDS = 15 * 60;
export const MAX_CODE_ATTEMPTS = 5;
export const MAX_REQUESTS_PER_HOUR = 5;
export const MAX_FAILURES_PER_HOUR = 10;

export interface NewLoginToken {
  tokenHash: string;
  email: string;
  codeHash: string;
  challenge: string | null;
  client: "web" | "mac";
}

export interface CodeCandidate {
  token_hash: string;
  code_hash: string;
  challenge: string | null;
}

const UNDER_HOURLY_LIMIT = `(SELECT COUNT(*) FROM login_tokens WHERE email = ? AND created_at > ?) < ${MAX_REQUESTS_PER_HOUR}`;

/**
 * Retires any live login for this email and stores the new one, in one
 * transaction and only while the email is under its hourly limit, so parallel
 * requests cannot overshoot it. Returns false when the limit was reached.
 */
export async function issueLoginToken(db: D1Database, t: NewLoginToken, now: number): Promise<boolean> {
  const hourAgo = now - 3600;
  const [, insert] = await db.batch([
    db
      .prepare(`UPDATE login_tokens SET used_at = ? WHERE email = ? AND used_at IS NULL AND ${UNDER_HOURLY_LIMIT}`)
      .bind(now, t.email, t.email, hourAgo),
    db
      .prepare(
        `INSERT INTO login_tokens (token_hash, email, code_hash, challenge, client, created_at, expires_at)
         SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${UNDER_HOURLY_LIMIT}`,
      )
      .bind(t.tokenHash, t.email, t.codeHash, t.challenge, t.client, now, now + LOGIN_TTL_SECONDS, t.email, hourAgo),
  ]);
  return insert!.meta.changes === 1;
}

/**
 * Spends one attempt before the code is compared, so concurrent guesses can
 * never use more than MAX_CODE_ATTEMPTS. A Mac login only matches when the
 * caller proves the verifier, so nobody else can burn its attempts.
 * No row means expired, used, out of attempts or wrong verifier.
 */
export async function spendCodeAttempt(
  db: D1Database,
  email: string,
  now: number,
  challengeFromVerifier: string | null,
): Promise<CodeCandidate | null> {
  return db
    .prepare(
      `UPDATE login_tokens SET attempts = attempts + 1
       WHERE email = ? AND used_at IS NULL AND expires_at > ? AND attempts < ?
         AND (challenge IS NULL OR challenge = ?)
       RETURNING token_hash, code_hash, challenge`,
    )
    .bind(email, now, MAX_CODE_ATTEMPTS, challengeFromVerifier)
    .first<CodeCandidate>();
}

/** Marks a token used; only the caller that flips used_at gets the email back. */
export async function consumeToken(
  db: D1Database,
  tokenHash: string,
  now: number,
  client?: "web",
): Promise<string | null> {
  const row = await db
    .prepare(
      `UPDATE login_tokens SET used_at = ?
       WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? AND (? IS NULL OR client = ?)
       RETURNING email`,
    )
    .bind(now, tokenHash, now, client ?? null, client ?? null)
    .first<{ email: string }>();
  return row?.email ?? null;
}

export async function recordFailure(db: D1Database, email: string, now: number): Promise<void> {
  await db.prepare("INSERT INTO auth_failures (email, at) VALUES (?, ?)").bind(email, now).run();
}

export async function countRecentFailures(db: D1Database, email: string, now: number): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM auth_failures WHERE email = ? AND at > ?")
    .bind(email, now - 3600)
    .first<{ n: number }>();
  return row?.n ?? 0;
}
