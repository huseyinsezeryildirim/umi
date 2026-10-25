-- Team workspaces (Umi Cloud): people join with an invite code; videos can belong to a
-- workspace (all members see them and their insights); styles (presets) are shared.
CREATE TABLE workspaces (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  owner_id     TEXT NOT NULL REFERENCES accounts(id),
  invite_code  TEXT NOT NULL UNIQUE,     -- rotate to stop old invites
  created_at   INTEGER NOT NULL
);

CREATE TABLE workspace_members (
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id),
  account_id    TEXT NOT NULL REFERENCES accounts(id),
  role          TEXT NOT NULL,           -- 'owner' | 'member'
  joined_at     INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, account_id)
);
CREATE INDEX workspace_members_account ON workspace_members(account_id);

ALTER TABLE videos ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);
CREATE INDEX videos_workspace ON videos(workspace_id, created_at DESC) WHERE workspace_id IS NOT NULL;

CREATE TABLE workspace_presets (
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id),
  id            TEXT NOT NULL,           -- the app's preset id
  name          TEXT NOT NULL,
  data          TEXT NOT NULL,           -- the preset's edit settings (JSON, ≤ 64 KB)
  updated_by    TEXT NOT NULL REFERENCES accounts(id),
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, id)
);
