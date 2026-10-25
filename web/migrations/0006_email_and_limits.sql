-- Email verification, password reset, and a limit on wrong-password attempts.
ALTER TABLE accounts ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;

CREATE TABLE email_tokens (
  token_hash  TEXT PRIMARY KEY,        -- hex SHA-256 of the token in the emailed link
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,           -- 'verify' | 'reset'
  expires_at  INTEGER NOT NULL,        -- unix ms
  used_at     INTEGER
);
CREATE INDEX email_tokens_account ON email_tokens(account_id, kind);

-- Failed sign-ins per key ('email:<address>' or 'ip:<address>') in a sliding window.
CREATE TABLE login_failures (
  key         TEXT PRIMARY KEY,
  count       INTEGER NOT NULL,
  window_start INTEGER NOT NULL        -- unix ms
);
