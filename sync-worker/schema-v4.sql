-- Webhooks: a private link per webhook that anything can post to. The service
-- keeps a hash of each link's secret and the webhook's public key; messages are
-- sealed to that key on arrival (src/hookbox.js) and wait here, unreadable,
-- until one of the account's computers collects and deletes them.
-- Apply with: npx wrangler d1 execute switchboard-sync --remote --command "..." (each statement)
CREATE TABLE IF NOT EXISTS webhooks (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  secret_hash TEXT NOT NULL UNIQUE,
  pub TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS webhooks_by_account ON webhooks(account_id);
CREATE TABLE IF NOT EXISTS webhook_inbox (
  id TEXT PRIMARY KEY,
  hook_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  blob TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS webhook_inbox_by_account ON webhook_inbox(account_id, created_at);
CREATE INDEX IF NOT EXISTS webhook_inbox_by_hook ON webhook_inbox(hook_id);
