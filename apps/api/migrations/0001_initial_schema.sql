-- Accounts, passwordless login, sessions, synced presets and share snapshots.
-- Every token, code and session is stored only as a hash.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

-- One live login per email: a new request marks older rows used.
CREATE TABLE login_tokens (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  -- base64url SHA-256 of the native app's verifier (PKCE style); NULL for web.
  challenge TEXT,
  client TEXT NOT NULL CHECK (client IN ('web', 'mac')),
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX login_tokens_email_created ON login_tokens (email, created_at);

CREATE TABLE auth_failures (
  email TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX auth_failures_email_at ON auth_failures (email, at);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  client TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  absolute_expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);

-- Preset ids are only unique per user, so every lookup must include user_id.
CREATE TABLE presets (
  user_id TEXT NOT NULL REFERENCES users (id),
  id TEXT NOT NULL,
  -- NULL once deleted (tombstone).
  data_json TEXT,
  rev INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX presets_user_rev ON presets (user_id, rev);

-- Server-issued revisions; clients never supply timestamps or revisions of their own.
CREATE TABLE rev_counter (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  value INTEGER NOT NULL,
  -- Highest rev whose tombstone the cleanup job removed; clients synced to an older rev must resync fully.
  purged_through_rev INTEGER NOT NULL DEFAULT 0
);
INSERT INTO rev_counter (id, value) VALUES (1, 0);

-- A share is a frozen copy taken when the user shares, not a live view of the preset.
CREATE TABLE shares (
  slug TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  preset_id TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, preset_id)
);
