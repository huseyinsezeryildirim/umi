-- Plans replace the single paid flag. is_paid stays in step for older clients.
ALTER TABLE accounts ADD COLUMN plan TEXT NOT NULL DEFAULT 'free';
UPDATE accounts SET plan = 'pro' WHERE is_paid = 1;
