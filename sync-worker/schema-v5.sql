-- Shared projects (src/shares.js): one project's notes and to-dos shared
-- between accounts, end to end. Additive only.
-- Apply with: npx wrangler d1 execute switchboard-sync --remote --file=schema-v5.sql

-- Each account's key pair for sharing: the public half, and the private half
-- locked with the account key (this service cannot open it).
CREATE TABLE IF NOT EXISTS share_keys (
  account_id TEXT PRIMARY KEY,
  pub TEXT NOT NULL,           -- X25519, for locking project keys to this account
  sign_pub TEXT NOT NULL,      -- Ed25519, for the owner's signed roster and admins' signed choices
  wrapped TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- A shared project: its encrypted document, and which key (epoch) locks it.
CREATE TABLE IF NOT EXISTS shares (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  epoch INTEGER NOT NULL,
  needs_rekey INTEGER NOT NULL DEFAULT 0,   -- someone left: the owner picks a new key
  version INTEGER NOT NULL,
  body TEXT NOT NULL,                       -- encrypted, base64
  roster TEXT NOT NULL,                     -- who the admins are, signed by the owner (not secret, not forgeable here)
  roster_sig TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Who is in it, and their copy of the project key, locked to their public key.
CREATE TABLE IF NOT EXISTS share_members (
  share_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  role TEXT NOT NULL,          -- owner | admin | member (who may invite and remove; computers trust the roster)
  status TEXT NOT NULL,        -- invited | joined
  lock TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (share_id, account_id)
);
CREATE INDEX IF NOT EXISTS share_members_by_account ON share_members (account_id);
