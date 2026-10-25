-- Links whose expiry the plan set (free links last a week): upgrading keeps them for good.
ALTER TABLE videos ADD COLUMN plan_expiry INTEGER NOT NULL DEFAULT 0;
