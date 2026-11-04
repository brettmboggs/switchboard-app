-- Sign in with Google, GitHub or Microsoft, recovery keys, and pairing a new
-- computer. Additive only: existing accounts and data are untouched.
-- Apply with: npx wrangler d1 execute switchboard-sync --remote --file=schema-v2.sql

-- Who signed in where: one row per provider identity, pointing at an account.
CREATE TABLE IF NOT EXISTS identities (
  provider TEXT NOT NULL,      -- google | github | microsoft
  subject TEXT NOT NULL,       -- the provider's stable user id
  account_id TEXT NOT NULL,
  email TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (provider, subject)
);

-- The account key, locked with the recovery key on the user's computer. This
-- service cannot open it.
CREATE TABLE IF NOT EXISTS key_wraps (
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL,          -- recovery
  blob TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, kind)
);

-- A sign-in in progress (between leaving for the provider and coming back).
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  client_state TEXT NOT NULL,
  return_to TEXT NOT NULL,
  verifier TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- A finished sign-in waiting for the computer to collect its token (one use, two minutes).
CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  is_new INTEGER NOT NULL,
  email TEXT,
  created_at INTEGER NOT NULL
);

-- A new computer asking one already signed in for the account key.
CREATE TABLE IF NOT EXISTS pairings (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,    -- the asking computer's token
  name TEXT,
  pub TEXT NOT NULL,           -- the asking computer's one-time public key
  status TEXT NOT NULL,        -- waiting | approved | denied
  pub2 TEXT,                   -- the approving computer's one-time public key
  box TEXT,                    -- the account key, locked to both keys
  created_at INTEGER NOT NULL
);
