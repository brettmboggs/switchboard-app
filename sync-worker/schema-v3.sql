-- Rate limits: tries per key (kind, address or account, ten-minute window).
-- Apply with: npx wrangler d1 execute switchboard-sync --remote --file=schema-v3.sql
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  win INTEGER NOT NULL
);
