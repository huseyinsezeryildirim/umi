-- Abuse protection: reports from viewers, videos hidden while they're reviewed, and a
-- general counter for rate limits (sign-ups, new links, reports).
CREATE TABLE reports (
  id          TEXT PRIMARY KEY,
  video_id    TEXT NOT NULL REFERENCES videos(id),
  reason      TEXT NOT NULL,           -- 'spam' | 'abuse' | 'copyright' | 'illegal' | 'other'
  details     TEXT,
  ip_hash     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  UNIQUE (video_id, ip_hash)
);
CREATE INDEX reports_video ON reports(video_id);

-- Set when enough people report a video: viewers see "under review" until it's cleared
-- (UPDATE videos SET flagged_at = NULL WHERE id = ?) or removed.
ALTER TABLE videos ADD COLUMN flagged_at INTEGER;

CREATE TABLE rate_limits (
  key          TEXT PRIMARY KEY,
  count        INTEGER NOT NULL,
  window_start INTEGER NOT NULL        -- unix ms
);
