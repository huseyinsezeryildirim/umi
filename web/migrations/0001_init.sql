-- Accounts: one API token per account for now. Billing/plans come later.
CREATE TABLE accounts (
  id          TEXT PRIMARY KEY,
  email       TEXT,
  token_hash  TEXT NOT NULL UNIQUE,   -- hex SHA-256 of the bearer token
  is_paid     INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL        -- unix ms
);

CREATE TABLE videos (
  id              TEXT PRIMARY KEY,   -- public short id used in /v/:id
  account_id      TEXT NOT NULL REFERENCES accounts(id),
  title           TEXT NOT NULL,
  status          TEXT NOT NULL,      -- 'uploading' | 'ready' | 'deleted'
  upload_id       TEXT,               -- R2 multipart upload id while uploading
  content_type    TEXT NOT NULL DEFAULT 'video/mp4',
  size_bytes      INTEGER NOT NULL,
  duration_ms     INTEGER,
  width           INTEGER,
  height          INTEGER,
  has_thumbnail   INTEGER NOT NULL DEFAULT 0,
  password_hash   TEXT,               -- pbkdf2-sha256$iter$salt$hash, NULL = public
  expires_at      INTEGER,            -- unix ms, NULL = never
  allow_download  INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  deleted_at      INTEGER
);

CREATE INDEX videos_account ON videos(account_id, created_at DESC);
CREATE INDEX videos_status ON videos(status, updated_at);
CREATE INDEX videos_expires ON videos(expires_at) WHERE expires_at IS NOT NULL;
