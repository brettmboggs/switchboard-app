-- Team chat (src/chat.js): a channel per shared project and one-to-one chats
-- between people who share a project. Additive only. (v7 is the sharing
-- core's; this one needs only schema-v5.sql before it.)
-- Apply with: npx wrangler d1 execute switchboard-sync --remote --file=schema-v8.sql
--
-- The service keeps an append-only log of sealed messages: who sent each one
-- and when, and ciphertext. A project channel is sealed with a key made from
-- the project key; a one-to-one chat with a key only the two people's
-- computers can make. Edits, deletions, reactions and pins are more sealed
-- lines in the same log, so the service cannot tell them from messages.
CREATE TABLE IF NOT EXISTS chat_log (
  chan TEXT NOT NULL,           -- 'p' + share id, or 'd' + 24 hex for a pair of accounts
  seq INTEGER NOT NULL,         -- 1, 2, 3 … per channel
  sender_id TEXT NOT NULL,
  body TEXT NOT NULL,           -- sealed on the sender's computer, base64
  at INTEGER NOT NULL,
  PRIMARY KEY (chan, seq)
);

-- Which two accounts a one-to-one chat is between.
CREATE TABLE IF NOT EXISTS chat_direct (
  chan TEXT PRIMARY KEY,
  a_id TEXT NOT NULL,
  b_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS chat_direct_a ON chat_direct (a_id);
CREATE INDEX IF NOT EXISTS chat_direct_b ON chat_direct (b_id);

-- How far each person has read in each channel: "seen" for the others.
CREATE TABLE IF NOT EXISTS chat_seen (
  chan TEXT NOT NULL,
  account_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (chan, account_id)
);
