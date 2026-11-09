-- Forgot password (src/reset.js): one waiting reset code per account. Additive only.
-- Apply with: npx wrangler d1 execute switchboard-sync --remote --file=schema-v9.sql
--
-- Only a hash of the code is kept (with the account id mixed in). A code works
-- once, for 30 minutes, and five wrong tries use it up.
CREATE TABLE IF NOT EXISTS password_resets (
  account_id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  tries INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
