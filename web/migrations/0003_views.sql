-- Viewer insights (Umi Cloud): one row per viewing session. No personal data: the session id
-- is random per page load, the country comes from Cloudflare.
CREATE TABLE views (
  id          TEXT PRIMARY KEY,          -- random per viewing session (from the player)
  video_id    TEXT NOT NULL REFERENCES videos(id),
  started_at  INTEGER NOT NULL,          -- unix ms
  last_at     INTEGER NOT NULL,
  watched_ms  INTEGER NOT NULL DEFAULT 0,
  -- Which twentieths of the video were seen, as 20 '0'/'1' characters.
  buckets     TEXT NOT NULL DEFAULT '00000000000000000000',
  country     TEXT,
  embedded    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX views_video ON views(video_id, started_at DESC);
