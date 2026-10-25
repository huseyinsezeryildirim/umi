-- Local-only dev account. Bearer token: umi_dev_token
INSERT OR REPLACE INTO accounts (id, email, token_hash, is_paid, created_at)
VALUES ('acc_dev', 'dev@umi.local', '9335b8e159ef89861486a7e7413989b6bbfe10715cec3201e9f8f587a9950f10', 1, 0);

-- Local-only unpaid account (cloud sharing must be refused with 402). Bearer token: umi_free_token
INSERT OR REPLACE INTO accounts (id, email, token_hash, is_paid, created_at)
VALUES ('acc_free', 'free@umi.local', '5c83a61b2f006f20b404022bc41c177a8f2d3b1b452a84352efc8e8a6901d370', 0, 0);

-- Local-only second paid account (workspace tests). Bearer token: umi_team_token
INSERT OR REPLACE INTO accounts (id, email, token_hash, is_paid, created_at)
VALUES ('acc_team', 'team@umi.local', 'b5b5b19a9ee94f22d5b720d10d43c7922cf87f568f6d5d677a9243b66db05474', 1, 0);
