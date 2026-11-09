-- Invites for people with no Switchboard account yet (src/shares.js). Additive only.
-- Apply with: npx wrangler d1 execute switchboard-sync --remote --file=schema-v6.sql
--
-- The service keeps a hash of the invited email (never the address), which
-- project, and the invitation itself: what they may see and edit, signed by
-- whoever invited them, so no other computer believes one the service made
-- up. When that person makes an account and accepts, the inviter's computer
-- gives them the project's keys on its next sync. The link is used once, and
-- only by an account with the invited email. Gone after 14 days.
CREATE TABLE IF NOT EXISTS share_pending (
  id TEXT PRIMARY KEY,
  share_id TEXT NOT NULL,
  email_hash TEXT NOT NULL,     -- sha256("switchboard-invite:" + lowercased email), hex
  token_hash TEXT NOT NULL,     -- sha256 of the link's secret: following the link and signing in with that email is joining
  inviter_id TEXT NOT NULL,
  grant_body TEXT NOT NULL,     -- the signed invitation (JSON), read by the inviter's and the invitee's computers
  grant_sig TEXT NOT NULL,
  status TEXT NOT NULL,         -- waiting | accepted
  account_id TEXT,              -- who accepted it
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS share_pending_by_email ON share_pending (email_hash);
CREATE INDEX IF NOT EXISTS share_pending_by_share ON share_pending (share_id);
CREATE INDEX IF NOT EXISTS share_pending_by_token ON share_pending (token_hash);
