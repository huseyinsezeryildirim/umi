-- Local-only dev account. Bearer token: umi_dev_token
INSERT OR REPLACE INTO accounts (id, email, token_hash, is_paid, created_at)
VALUES ('acc_dev', 'dev@umi.local', '9335b8e159ef89861486a7e7413989b6bbfe10715cec3201e9f8f587a9950f10', 1, 0);

-- Local-only unpaid account (cloud sharing must be refused with 402). Bearer token: umi_free_token
INSERT OR REPLACE INTO accounts (id, email, token_hash, is_paid, created_at)
VALUES ('acc_free', 'free@umi.local', '5c83a61b2f006f20b404022bc41c177a8f2d3b1b452a84352efc8e8a6901d370', 0, 0);

-- Local-only second paid account (workspace tests). Bearer token: umi_team_token
INSERT OR REPLACE INTO accounts (id, email, token_hash, is_paid, created_at)
VALUES ('acc_team', 'team@umi.local', 'b5b5b19a9ee94f22d5b720d10d43c7922cf87f568f6d5d677a9243b66db05474', 1, 0);

-- Local-only account for trying the website's sign-in (http://localhost:3210/login).
-- Email: demo@umi.local  Password: p6vfN4JAUtPFeN
INSERT OR REPLACE INTO accounts (id, email, token_hash, password_hash, is_paid, created_at)
VALUES ('acc_demo', 'demo@umi.local', '1fb7d733310422623836ea927edf529e46ff2fa2fecc0fa9feaa3059c9bb3c95', 'pbkdf2-sha256$100000$8fIRbe6iYZkvzoYjuxs4gw$GtFRXL_jzkqz9UZ9Ev30fCjDEPKPbSz4-kCD-vGfVI8', 0, 0);

-- Plans (migration 0007): the paid seeds get Team so the workspace tests can run.
UPDATE accounts SET plan = 'team' WHERE id IN ('acc_dev', 'acc_team');

-- Local-only quick sign-in for the owner: name "sezer", password "admin" (works only with DEV_TOOLS=1).
INSERT OR REPLACE INTO accounts (id, email, token_hash, password_hash, is_paid, email_verified, plan, created_at)
VALUES ('acc_sezer', 'sezer', '8513aee0484947c45e4b5865fbd20cff8a4ea1e812f0339307e5353e5a81d35e', 'pbkdf2-sha256$100000$CgRNKRUGCrmEu7nB_ObOlQ$nHP4uNBzg5c0AxWW_DqfWcUa_Sa7YsRzOO3tU_3s3oo', 1, 1, 'team', 0);
