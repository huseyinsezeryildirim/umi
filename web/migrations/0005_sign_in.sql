-- Email + password sign-in. Each signed-in device gets its own session token; the original
-- per-account token keeps working for the desktop app and the dev seeds.
ALTER TABLE accounts ADD COLUMN password_hash TEXT;
CREATE UNIQUE INDEX accounts_email ON accounts(email) WHERE email IS NOT NULL;

CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,        -- hex SHA-256 of the bearer token
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,        -- unix ms
  last_used   INTEGER NOT NULL
);
CREATE INDEX sessions_account ON sessions(account_id);
