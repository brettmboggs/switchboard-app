// One SQLite file holds everything. node:sqlite ships with Node 22, so there is
// nothing native to compile. The file lives outside the repo and is readable by
// the user's user only, because it holds the Gmail app passwords.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DATA_DIR = process.env.SWITCHBOARD_DATA || join(homedir(), '.local/share/switchboard');
mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
const file = join(DATA_DIR, 'switchboard.db');
const fresh = !existsSync(file);

export const db = new DatabaseSync(file);
if (fresh) chmodSync(file, 0o600);
db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  cwd TEXT, repo TEXT, space TEXT,
  state TEXT NOT NULL,           -- idle | running | waiting | finished | ended
  detail TEXT,                   -- what it is waiting on, in Claude's words
  prompt TEXT,                   -- the last thing the user asked it
  last_message TEXT,             -- the end of Claude's last reply
  transcript TEXT,
  window_id INTEGER,
  started_at INTEGER, updated_at INTEGER,
  seen INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS session_events (
  session_id TEXT, at INTEGER, event TEXT, info TEXT
);
CREATE INDEX IF NOT EXISTS session_events_by_session ON session_events(session_id, at);

CREATE TABLE IF NOT EXISTS mail (
  account TEXT NOT NULL,
  msg_id TEXT NOT NULL,          -- Gmail's X-GM-MSGID
  thread_id TEXT,                -- Gmail's X-GM-THRID
  uid INTEGER,
  from_name TEXT, from_addr TEXT, to_addrs TEXT,
  subject TEXT, snippet TEXT,
  date INTEGER,
  inbox INTEGER, unread INTEGER, from_me INTEGER, bulk INTEGER,
  kind TEXT,                     -- mail | voice-text | voice-mail | voice-call | charge | receipt
  amount REAL, merchant TEXT,
  space TEXT,
  PRIMARY KEY (account, msg_id)
);
CREATE INDEX IF NOT EXISTS mail_by_thread ON mail(account, thread_id, date);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,            -- note | todo | reminder | paid | bill
  text TEXT NOT NULL,
  space TEXT,
  due_at INTEGER,
  amount REAL,
  cadence TEXT,                  -- weekly | monthly | yearly (bills)
  created_at INTEGER NOT NULL,
  done_at INTEGER,
  notified_at INTEGER
);

-- Done / snoozed for things that live elsewhere (mail threads, runs, sessions).
-- A thread comes back on its own if a new message arrives after it was cleared.
CREATE TABLE IF NOT EXISTS cleared (
  key TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  until INTEGER
);
`);

// Columns added after the first release.
for (const sql of [
  'ALTER TABLE mail ADD COLUMN primary_cat INTEGER',
  'CREATE TABLE IF NOT EXISTS contacts (addr TEXT PRIMARY KEY, last_at INTEGER)',
  // Sync: every setting and item carries when it last changed, items carry an id
  // that is the same on every computer, and deleted items leave a tombstone.
  'ALTER TABLE settings ADD COLUMN updated_at INTEGER',
  'ALTER TABLE items ADD COLUMN uid TEXT',
  'ALTER TABLE items ADD COLUMN updated_at INTEGER',
  'CREATE UNIQUE INDEX IF NOT EXISTS items_uid ON items(uid)',
  'CREATE TABLE IF NOT EXISTS tombstones (uid TEXT PRIMARY KEY, at INTEGER NOT NULL)',
  // Stamp changes automatically, so no code path can forget. Sync writes its own
  // updated_at, which is why the update triggers only fire when it did not change.
  `CREATE TRIGGER IF NOT EXISTS settings_ins AFTER INSERT ON settings WHEN NEW.updated_at IS NULL
     BEGIN UPDATE settings SET updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE key = NEW.key; END`,
  `CREATE TRIGGER IF NOT EXISTS settings_upd AFTER UPDATE OF value ON settings WHEN NEW.updated_at IS OLD.updated_at
     BEGIN UPDATE settings SET updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE key = NEW.key; END`,
  `CREATE TRIGGER IF NOT EXISTS items_ins AFTER INSERT ON items WHEN NEW.uid IS NULL OR NEW.updated_at IS NULL
     BEGIN UPDATE items SET uid = COALESCE(NEW.uid, lower(hex(randomblob(16)))), updated_at = COALESCE(NEW.updated_at, CAST(unixepoch('subsec') * 1000 AS INTEGER)) WHERE id = NEW.id; END`,
  `CREATE TRIGGER IF NOT EXISTS items_upd AFTER UPDATE ON items WHEN NEW.updated_at IS OLD.updated_at
     BEGIN UPDATE items SET updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = NEW.id; END`,
  `CREATE TRIGGER IF NOT EXISTS items_del AFTER DELETE ON items
     BEGIN INSERT OR REPLACE INTO tombstones (uid, at) VALUES (OLD.uid, CAST(unixepoch('subsec') * 1000 AS INTEGER)); END`,
  // cleared (done / snoozed conversations) syncs too
  'ALTER TABLE cleared ADD COLUMN updated_at INTEGER'
]) {
  try { db.exec(sql); } catch {}
}
// Items made before sync existed get their ids and stamps now.
db.exec("UPDATE items SET uid = lower(hex(randomblob(16))) WHERE uid IS NULL");
db.exec("UPDATE items SET updated_at = COALESCE(done_at, created_at) WHERE updated_at IS NULL");
db.exec("UPDATE settings SET updated_at = 1 WHERE updated_at IS NULL");

// Settings that hold passwords, tokens or private links are kept locked on disk
// with this computer's own key, which lives in the OS keychain (lib/secrets.js).
// A copied database file is no use without it.
export const SECRET_SETTINGS = new Set(['gmail', 'microsoft', 'sync', 'calendars', 'webhooks', 'tasks', 'google', 'granola', 'mailtrack', 'pagespeed', 'flips']);
let cipher = null;   // { encode(text), decode(text) } once the key is in hand
export const setCipher = (c) => { cipher = c; };
export const secretsUnlocked = () => !!cipher;
export function encodeSetting(key, json) {
  return cipher && SECRET_SETTINGS.has(key) ? cipher.encode(json) : json;
}
export function decodeSetting(key, stored) {
  if (typeof stored !== 'string' || !stored.startsWith('enc1:')) return stored;
  if (!cipher) throw new Error('This computer\'s keychain is still locked.');
  return cipher.decode(stored);
}
// Any secret setting still in plain text gets locked (once, when the key arrives).
export function lockSecrets() {
  if (!cipher) return 0;
  let n = 0;
  for (const key of SECRET_SETTINGS) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    if (row && !row.value.startsWith('enc1:')) { db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(cipher.encode(row.value), key); n++; }
  }
  return n;
}
export const hasLockedSecrets = () => db.prepare("SELECT COUNT(*) AS n FROM settings WHERE value LIKE 'enc1:%'").get().n > 0;

export function getSetting(key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return fallback;
  try { return JSON.parse(decodeSetting(key, row.value)); }
  catch { return fallback; }   // locked, or locked with a key this computer no longer has
}

export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, encodeSetting(key, JSON.stringify(value)));
  onLocalChange();
}

export function isCleared(key, activityAt = 0) {
  const row = db.prepare('SELECT at, until FROM cleared WHERE key = ?').get(key);
  if (!row) return false;
  if (row.until) return Date.now() < row.until;      // snoozed
  return activityAt <= row.at;                       // done, unless something new happened since
}

export function clear(key, until = null) {
  db.prepare('INSERT INTO cleared (key, at, until, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET at = excluded.at, until = excluded.until, updated_at = excluded.updated_at')
    .run(key, Date.now(), until, Date.now());
  onLocalChange();
}

// Sync listens here; anything that changes synced data calls it.
let changeHooks = [];
export const onChange = (fn) => changeHooks.push(fn);
export function onLocalChange() { for (const fn of changeHooks) try { fn(); } catch {} }
