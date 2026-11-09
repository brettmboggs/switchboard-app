// Shared projects and your team, in the app: the one implementation lives in
// public/js/shared/share-core.js (the web board uses it too); this file gives
// it what is different here: this computer's SQLite (pages, items, the share
// tables, settings) and node:crypto. What the core does and how it holds is
// written at its top; what the service keeps, in sync-worker/src/shares.js.
import { randomBytes, generateKeyPairSync, createPrivateKey, createPublicKey, createHash, sign, verify } from 'node:crypto';
import { db, getSetting, setSetting, onChange, onLocalChange } from './db.js';
import { call, seal, unseal, sealForPair, openFromPair, providers } from './sync.js';
import { spaces, saveSpaces } from './spaces.js';
import { friendlyError } from './friendly.js';
import './belongs.js';   // its table: pages added to a project from another one are shared with it
import { PRODUCT } from './product.js';
import { WebSocket as WsClient } from 'ws';
import { makeShareCore, stable, SHARE_KINDS, LEVELS, DEFAULT_KINDS, ALL_KINDS, LEVELS_OF, PUBLISHED, okRepo, lc } from '../public/js/shared/share-core.js';

export { SHARE_KINDS, LEVELS, DEFAULT_KINDS, ALL_KINDS, LEVELS_OF, PUBLISHED, okRepo };

db.exec(`CREATE TABLE IF NOT EXISTS share_rows (
  share_id TEXT NOT NULL, uid TEXT NOT NULL, kind TEXT NOT NULL,
  by TEXT, at INTEGER, gone_at INTEGER,
  PRIMARY KEY (share_id, uid)
);
CREATE TABLE IF NOT EXISTS share_kv (share_id TEXT NOT NULL, k TEXT NOT NULL, v TEXT, PRIMARY KEY (share_id, k));`);
// Who first put a page or to-do in the share (only they can take it back with
// Only me), and the writer's signature over the row as it is now.
try { db.exec('ALTER TABLE share_rows ADD COLUMN origin TEXT'); } catch {}
try { db.exec('ALTER TABLE share_rows ADD COLUMN sig TEXT'); } catch {}

// ---- this computer's tables, as the core asks for them
const q = (sql) => db.prepare(sql);
// A section: its heading and what follows until the next heading, as the page's own HTML.
function sectionHtml(body, heading) {
  const b = String(body || ''), html = b.trimStart().startsWith('<');
  const parts = html ? b.split(/(?=<h[1-3][^>]*>)/i) : b.split(/(?=^#{1,3}\s)/m);
  const name = (part) => html ? (part.match(/^<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i)?.[1] || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim() : (part.match(/^#{1,3}\s+(.+)$/m)?.[1] || '').trim();
  return parts.find((part) => name(part) === heading) || null;
}
function sectionPages(space) {
  const out = [];
  for (const b of q("SELECT key FROM belongs WHERE space = ? AND key LIKE 'section:%'").all(space)) {
    const rest = b.key.slice(8), uid = rest.split('#')[0], heading = rest.slice(uid.length + 1);
    const p = q('SELECT uid, title, body, created_at, updated_at FROM pages WHERE uid = ?').get(uid);
    const part = p && sectionHtml(p.body, heading);
    if (!part) continue;
    out.push({ uid: 'sec' + createHash('sha256').update(b.key).digest('hex').slice(0, 21), title: `${p.title || 'Untitled'} → ${heading}`, body: part, pinned: 0, private: 0, created_at: p.created_at, updated_at: p.updated_at });
  }
  return out;
}
const store = {
  getSetting, setSetting, spaces, saveSpaces, onLocalChange,
  kvGet: (id, k) => { const r = q('SELECT v FROM share_kv WHERE share_id = ? AND k = ?').get(id, k); try { return r ? JSON.parse(r.v) : null; } catch { return null; } },
  kvSet: (id, k, v) => q('INSERT INTO share_kv (share_id, k, v) VALUES (?, ?, ?) ON CONFLICT(share_id, k) DO UPDATE SET v = excluded.v').run(id, k, JSON.stringify(v)),
  kvClear: (id) => q('DELETE FROM share_kv WHERE share_id = ?').run(id),
  tracked: (id) => q('SELECT * FROM share_rows WHERE share_id = ?').all(id),
  trackedGet: (id, uid) => q('SELECT * FROM share_rows WHERE share_id = ? AND uid = ?').get(id, uid) || null,
  trackedAll: () => q('SELECT share_id, uid, by, origin, gone_at FROM share_rows').all(),
  // The first writer (origin) is set once, when the row is first seen.
  trackUpsert: (id, uid, t) => q('INSERT INTO share_rows (share_id, uid, kind, by, at, gone_at, origin, sig) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(share_id, uid) DO UPDATE SET kind = excluded.kind, by = excluded.by, at = excluded.at, gone_at = excluded.gone_at, sig = excluded.sig')
    .run(id, uid, t.kind, t.by ?? null, t.at ?? null, t.gone_at ?? null, t.origin ?? null, t.sig ?? null),
  trackGone: (id, uid, at, by, sig) => q('UPDATE share_rows SET gone_at = ?, by = ?, sig = ? WHERE share_id = ? AND uid = ?').run(at, by, sig, id, uid),
  trackPrune: (id, before) => q('DELETE FROM share_rows WHERE share_id = ? AND gone_at < ?').run(id, before),
  trackClear: (id) => q('DELETE FROM share_rows WHERE share_id = ?').run(id),
  // Moving a 0.2.6 share over: every row is signed afresh by you.
  trackResign: (id, me) => { q('UPDATE share_rows SET sig = NULL WHERE share_id = ?').run(id); q('UPDATE share_rows SET by = ? WHERE share_id = ? AND gone_at IS NULL').run(me, id); },
  // The project's own pages, pages added to it from another project (In this project, lib/belongs.js),
  // and sections of pages added on their own, each as a read-only page of its own.
  sharePages: (space) => [...q("SELECT uid, title, body, pinned, private, created_at, updated_at FROM pages WHERE space = ? OR uid IN (SELECT substr(key, 6) FROM belongs WHERE space = ? AND key LIKE 'page:%')").all(space, space), ...sectionPages(space)],
  // The items that travel; never bills, invoices or payments.
  shareItems: (space) => q("SELECT uid, kind, text, due_at, created_at, done_at, updated_at FROM items WHERE space = ? AND kind IN ('note', 'todo', 'reminder')").all(space),
  pageMeta: (uid) => q('SELECT updated_at, space FROM pages WHERE uid = ?').get(uid) || null,
  // A page added to the project from another one (In this project): edits in the share reach it where it is.
  pageLinked: (space, uid) => !!q('SELECT 1 FROM belongs WHERE space = ? AND key = ?').get(space, 'page:' + uid),
  pageTomb: (uid) => q('SELECT at FROM page_tombstones WHERE uid = ?').get(uid)?.at || null,
  pageInsert: (p) => q('INSERT INTO pages (uid, title, body, space, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(p.uid, p.title, p.body, p.space, p.pinned, p.created_at, p.updated_at),
  pageUpdate: (uid, p) => q('UPDATE pages SET title = ?, body = ?, pinned = ?, updated_at = ? WHERE uid = ?').run(p.title, p.body, p.pinned, p.updated_at, uid),
  pageDelete: (uid, at) => { q('DELETE FROM pages WHERE uid = ?').run(uid); q('INSERT OR REPLACE INTO page_tombstones (uid, at) VALUES (?, ?)').run(uid, at); },
  itemMeta: (uid) => q('SELECT updated_at, space, kind FROM items WHERE uid = ?').get(uid) || null,
  itemTomb: (uid) => q('SELECT at FROM tombstones WHERE uid = ?').get(uid)?.at || null,
  itemInsert: (i) => q('INSERT INTO items (uid, kind, text, space, due_at, created_at, done_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(i.uid, i.kind, i.text, i.space, i.due_at, i.created_at, i.done_at, i.updated_at),
  itemUpdate: (uid, i) => q('UPDATE items SET kind = ?, text = ?, space = ?, due_at = ?, done_at = ?, updated_at = ? WHERE uid = ?').run(i.kind, i.text, i.space, i.due_at, i.done_at, i.updated_at, uid),
  itemDelete: (uid) => q('DELETE FROM items WHERE uid = ?').run(uid),   // its tombstone comes from the items_del trigger (lib/db.js)
  pagesHere: (space) => q('SELECT COUNT(*) AS n FROM pages WHERE space = ? AND private = 0').get(space).n,
  makePagesPrivate: (space) => q('UPDATE pages SET private = 1, updated_at = updated_at + 1 WHERE space = ? AND private = 0').run(space)
};

// ---- node:crypto, as the core asks for it (the browser's WebCrypto does the same in public/js/web/crypto.js)
const der = (k, type) => k.export({ type, format: 'der' }).toString('base64');
const privOf = (b64) => createPrivateKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'pkcs8' });
const pubOf = (b64) => createPublicKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'spki' });
const crypto = {
  seal: async (obj, key) => seal(obj, key),
  unseal: async (b64, key) => unseal(b64, key),
  sealForPair: async (text, pub) => sealForPair(text, pub),
  openFromPair: async (priv, myPub, pub2, box) => openFromPair(priv, myPub, pub2, box),
  sign: async (priv, obj) => sign(null, Buffer.from(stable(obj)), priv).toString('base64'),
  verify: async (obj, sig, pub) => { try { return verify(null, Buffer.from(stable(obj)), pubOf(pub), Buffer.from(String(sig || ''), 'base64')); } catch { return false; } },
  sha256hex: async (text) => createHash('sha256').update(text).digest('hex'),
  randomHex: async (n) => randomBytes(n).toString('hex'),
  newKeyPairs: async () => {
    const box = generateKeyPairSync('x25519'), sig = generateKeyPairSync('ed25519');
    return { pub: der(box.publicKey, 'spki'), priv: der(box.privateKey, 'pkcs8'), signPub: der(sig.publicKey, 'spki'), signPriv: der(sig.privateKey, 'pkcs8') };
  },
  importBoxPriv: async (b64) => privOf(b64),
  importSignPriv: async (b64) => privOf(b64)
};

// The live link for shared sessions: a WebSocket with this account's token (the browser puts it in the subprotocol instead).
const openSocket = (url, token) => new WsClient(url, { headers: { Authorization: `Bearer ${token}` } });
const core = makeShareCore({ store, crypto, call, friendlyError, inviteBaseDefault: PRODUCT.inviteBase, askProviders: () => providers(), openSocket });

export const { setRepoSource, setActivitySource, setCiSource, setSource, setLiveHandler, sessions, sessionChat, sessionSend, myKey, inviteBase, inviteLink, shareState, changedBy, sharedBy, moveIsCopy, sharedRepos, syncShares,
  keepInviteLink, answerInvite, admitInvite, cancelInvite, trustNewKeys, markChecked, pagesHere, shareProject, setAccess, setRole, acceptShare, leaveShare, leaveSpace, removeMember, removePerson, resetCodeFor, stopSharing, chatAccess, _test } = core;
// The address hash an invite is kept under (the same as the core's, synchronous here).
export const emailHash = (email) => createHash('sha256').update('switchboard-invite:' + lc(email)).digest('hex');

// After a local change, a few seconds' quiet; at once when the service says
// a member saved (lib/relay.js); every two minutes regardless.
let soon = null, changedFn = null;
export function shareSoon(ms = 1500) {
  clearTimeout(soon);
  soon = setTimeout(() => syncShares().then((n) => { changedFn?.(); return n; }).catch(() => {}), ms);
}
export function startShares(changed) {
  changedFn = changed;
  onChange(() => { if (Object.keys(getSetting('shareMap', {})).length) shareSoon(3000); });
  setTimeout(() => shareSoon(0), 4000);
  setInterval(() => shareSoon(0), 2 * 60e3);
}
