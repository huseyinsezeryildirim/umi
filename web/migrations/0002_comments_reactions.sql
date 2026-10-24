-- Viewer comments + emoji reactions, per-video comment toggle, animated GIF preview slot.

ALTER TABLE videos ADD COLUMN allow_comments INTEGER NOT NULL DEFAULT 1;
ALTER TABLE videos ADD COLUMN has_gif INTEGER NOT NULL DEFAULT 0;

CREATE TABLE comments (
  id           TEXT PRIMARY KEY,
  video_id     TEXT NOT NULL REFERENCES videos(id),
  author_name  TEXT NOT NULL,          -- display name typed by the viewer (≤ 60 chars)
  body         TEXT NOT NULL,          -- plain text (≤ 2000 chars), never rendered as HTML
  time_ms      INTEGER,                -- playback position the comment is pinned to, NULL = general comment
  ip_hash      TEXT NOT NULL,          -- HMAC of the client IP, only used for rate limiting
  created_at   INTEGER NOT NULL,       -- unix ms
  deleted_at   INTEGER                 -- soft delete by the owner
);

CREATE INDEX comments_video ON comments(video_id, created_at);
CREATE INDEX comments_rate ON comments(video_id, ip_hash, created_at);

CREATE TABLE reactions (
  id          TEXT PRIMARY KEY,
  video_id    TEXT NOT NULL REFERENCES videos(id),
  emoji       TEXT NOT NULL,           -- one of the allowed set in src/social.ts
  time_ms     INTEGER NOT NULL,
  ip_hash     TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE INDEX reactions_video ON reactions(video_id, created_at);
CREATE INDEX reactions_rate ON reactions(video_id, ip_hash, created_at);
