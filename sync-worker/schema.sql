CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  salt TEXT NOT NULL,          -- the client's key-derivation salt (not secret)
  auth_hash TEXT NOT NULL,     -- PBKDF2 of the client's auth key; the auth key itself is never stored
  auth_salt TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  fails INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER
);
CREATE TABLE IF NOT EXISTS tokens (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  device TEXT,
  created_at INTEGER NOT NULL,
  last_used INTEGER
);
CREATE TABLE IF NOT EXISTS docs (
  account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  body TEXT NOT NULL,          -- encrypted, base64
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, name)
);
-- Phone push. A phone registers its Expo push token; computers ask the service
-- to ping it. The service never sees what happened, only the kind of event, and
-- it sends fixed text, so nothing private reaches Expo, Apple or Google.
CREATE TABLE IF NOT EXISTS push_tokens (
  token TEXT PRIMARY KEY,      -- ExponentPushToken[...] of one phone
  account_id TEXT NOT NULL,
  device TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS push_tokens_account ON push_tokens (account_id);
CREATE TABLE IF NOT EXISTS push_sent (   -- last send per account and kind, to keep two computers from double-pinging
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (account_id, kind)
);
