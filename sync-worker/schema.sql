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
