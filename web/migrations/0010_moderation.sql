-- Reports wait for a decision in the moderation panel (/adagiris): nothing is hidden or deleted
-- automatically. Each decision is logged.
ALTER TABLE reports ADD COLUMN resolved_at INTEGER;
CREATE INDEX reports_open ON reports(video_id) WHERE resolved_at IS NULL;

CREATE TABLE moderation_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id    TEXT NOT NULL,
  action      TEXT NOT NULL,           -- 'hide' | 'unhide' | 'delete' | 'dismiss'
  by_email    TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
