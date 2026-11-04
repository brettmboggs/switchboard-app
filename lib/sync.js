// Switchboard account and sync, end-to-end encrypted.
//
// From the password, scrypt makes 64 bytes: the first half is the auth key (sent
// to the sync service, which keeps only a slow hash of it), the second half is
// the encryption key (never leaves this computer). Each synced document is
// AES-256-GCM ciphertext; the service stores blobs it cannot read. Forgetting
// the password means the synced copy cannot be opened, by anyone.
//
// What syncs: settings (projects, rules, accounts and their passwords and
// tokens, signatures, notifications), items (notes, reminders, to-dos,
// invoices, payments, bills) and cleared (done and snoozed conversations).
// What stays on each computer: its windows, its Claude sessions, its mail cache.
import { scryptSync, randomBytes, createCipheriv, createDecipheriv, createHash, generateKeyPairSync, createPublicKey, diffieHellman, hkdfSync } from 'node:crypto';
import { hostname } from 'node:os';
import { db, getSetting, onChange, encodeSetting, decodeSetting } from './db.js';
import { PRODUCT } from './product.js';
import { pagesDoc } from './pages.js';

// allowRemote: whether this computer's sessions may be seen and used from the account's other computers.
const LOCAL_ONLY = (k) => k === 'sync' || k === 'deviceId' || k === 'codeRoot' || k === 'rules_v2' || k === 'allowRemote' || k.startsWith('contacts_seeded:');

let status = { at: null, ok: null, error: null, busy: false };
export const syncStatus = () => {
  const s = getSetting('sync', null);
  return {
    signedIn: !!s?.token, email: s?.email || null, server: s?.server || PRODUCT.syncUrl, ...status,
    // Signed in but this computer does not have the account key yet.
    locked: !!s?.token && !s?.key,
    info: info,                                        // what the account has (sign-ins, recovery key)
    pairing: pairing ? { code: pairing.code, status: pairing.status } : null,
    asks: s?.key ? asks : [],                          // other computers asking to be let in
    recoveryKey: freshRecovery                         // shown once, until the user says it is saved
  };
};
let info = null, pairing = null, asks = [], freshRecovery = null;

// ---- keys and crypto
function deriveKeys(password, saltHex) {
  const out = scryptSync(password.normalize('NFKC'), Buffer.from(saltHex, 'hex'), 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return { auth: out.subarray(0, 32).toString('hex'), key: out.subarray(32).toString('hex') };
}
export function seal(obj, keyHex) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([Buffer.from([1]), iv, c.getAuthTag(), data]).toString('base64');   // v1 | iv | tag | data
}
export function unseal(b64, keyHex) {
  const buf = Buffer.from(b64, 'base64');
  if (buf[0] !== 1) throw new Error('Unknown sync format.');
  const d = createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), buf.subarray(1, 13));
  d.setAuthTag(buf.subarray(13, 29));
  return JSON.parse(Buffer.concat([d.update(buf.subarray(29)), d.final()]).toString('utf8'));
}

// ---- talking to the service
export async function call(server, path, { method = 'GET', body, token } = {}) {
  const res = await fetch(server.replace(/\/$/, '') + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000)
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

function saveSync(v) {
  // The sync record itself is local only; write it without bumping anything.
  db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('sync', encodeSetting('sync', JSON.stringify(v)));
}

export async function signUp(email, password) {
  if ((password || '').length < 10) throw new Error('Use a password of at least 10 characters. It also unlocks your data, so keep it somewhere safe.');
  const server = PRODUCT.syncUrl;
  const salt = randomBytes(16).toString('hex');
  const { auth, key } = deriveKeys(password, salt);
  const r = await call(server, '/v1/signup', { method: 'POST', body: { email, salt, auth, device: hostname() } });
  if (r.status !== 200) throw new Error(r.json.error || 'Could not create the account.');
  saveSync({ server, email: email.trim().toLowerCase(), token: r.json.token, key, versions: {} });
  await syncNow();
  await refreshInfo();
}

export async function signIn(email, password) {
  const server = PRODUCT.syncUrl;
  const s = await call(server, '/v1/salt', { method: 'POST', body: { email } });
  if (s.status !== 200) throw new Error(s.json.error || 'Could not reach the sync service.');
  const { auth, key } = deriveKeys(password, s.json.salt);
  const r = await call(server, '/v1/login', { method: 'POST', body: { email, auth, device: hostname() } });
  if (r.status !== 200) throw new Error(r.json.error || 'Could not sign in.');
  saveSync({ server, email: email.trim().toLowerCase(), token: r.json.token, key, versions: {} });
  await syncNow({ preferRemote: true });
  await refreshInfo();
  if (status.ok === false) throw new Error(status.error);
}

// ---- Sign in with Google, GitHub or Microsoft
// The browser goes to the sync service, then the provider, and comes back to
// /auth/done here with a one-time code, which this computer trades for its token.
const pendingOauth = new Map();   // state -> { at, link }
let providerCache = { at: 0, list: [] };
export async function providers() {
  if (Date.now() - providerCache.at < 10 * 60e3) return providerCache.list;
  const r = await call(PRODUCT.syncUrl, '/v1/providers').catch(() => null);
  providerCache = { at: Date.now(), list: r?.json?.providers || [] };
  return providerCache.list;
}
export async function oauthStart(provider, returnTo, { link = false, email } = {}) {
  const state = randomBytes(16).toString('hex');
  let ticket = '';
  if (link) {
    const s = getSetting('sync', null);
    const r = await call(s.server, '/v1/oauth/link', { method: 'POST', token: s.token, body: {} });
    if (r.status !== 200) throw new Error(r.json.error || 'Could not start.');
    ticket = r.json.ticket;
  }
  pendingOauth.set(state, { at: Date.now(), link });
  for (const [k, v] of pendingOauth) if (Date.now() - v.at > 15 * 60e3) pendingOauth.delete(k);
  const q = new URLSearchParams({ provider, return: returnTo, state, ...(ticket ? { link: ticket } : {}), ...(email ? { email } : {}) });
  return `${PRODUCT.syncUrl.replace(/\/$/, '')}/v1/oauth/start?${q}`;
}
export async function oauthFinish({ state, code, error, linked }) {
  const p = pendingOauth.get(state || '');
  if (!p) throw new Error('This sign-in did not start here, or it expired. Try again from Switchboard.');
  pendingOauth.delete(state);
  if (error) throw new Error(error);
  if (p.link || linked) { await refreshInfo(); return { linked: true }; }
  const server = PRODUCT.syncUrl;
  const r = await call(server, '/v1/oauth/redeem', { method: 'POST', body: { code, device: hostname() } });
  if (r.status !== 200) throw new Error(r.json.error || 'Could not sign in.');
  saveSync({ server, email: r.json.email, token: r.json.token, key: null, versions: {} });
  await refreshInfo();
  // A new account: this computer makes the account key and a recovery key for it.
  if (r.json.isNew || (info && !info.hasData && !info.hasRecovery && !info.hasPassword)) {
    const s = getSetting('sync', null);
    s.key = randomBytes(32).toString('hex');
    saveSync(s);
    await makeRecoveryKey();
    await syncNow();
    return { isNew: true };
  }
  return { locked: true };
}

export async function refreshInfo() {
  const s = getSetting('sync', null);
  if (!s?.token) { info = null; return null; }
  const r = await call(s.server, '/v1/account', { token: s.token }).catch(() => null);
  if (r?.status === 200) info = r.json;
  return info;
}

// ---- recovery key: 25 letters and digits, shown once; it locks the copy of the
// account key kept on the sync service.
const ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const normRecovery = (t) => String(t || '').toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1').replace(/[^0-9A-Z]/g, '');
function wrapKey(keyHex, secret) {
  const salt = randomBytes(16);
  const k = scryptSync(secret, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', k, iv);
  const data = Buffer.concat([c.update(keyHex, 'utf8'), c.final()]);
  return Buffer.concat([Buffer.from([1]), salt, iv, c.getAuthTag(), data]).toString('base64');
}
function unwrapKey(b64, secret) {
  const b = Buffer.from(b64, 'base64');
  if (b[0] !== 1) throw new Error('Unknown key format.');
  const k = scryptSync(secret, b.subarray(1, 17), 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const d = createDecipheriv('aes-256-gcm', k, b.subarray(17, 29));
  d.setAuthTag(b.subarray(29, 45));
  return Buffer.concat([d.update(b.subarray(45)), d.final()]).toString('utf8');
}
export { wrapKey, unwrapKey, normRecovery };

export async function makeRecoveryKey() {
  const s = getSetting('sync', null);
  if (!s?.key) throw new Error('This computer does not have the account key yet.');
  const raw = [...randomBytes(25)].map((b) => ALPHA[b % 32]).join('');
  const r = await call(s.server, '/v1/keys/recovery', { method: 'PUT', token: s.token, body: { blob: wrapKey(s.key, raw) } });
  if (r.status !== 200) throw new Error(r.json.error || 'Could not save the recovery key.');
  freshRecovery = raw.match(/.{5}/g).join('-');
  await refreshInfo();
  return freshRecovery;
}
export function recoverySeen() { freshRecovery = null; }

// A key is right if it opens this account's synced data.
async function keyWorks(s, keyHex) {
  for (const name of Object.keys(docs)) {
    const r = await call(s.server, `/v1/docs/${name}`, { token: s.token });
    if (r.status === 200 && r.json.body) { try { unseal(r.json.body, keyHex); return true; } catch { return false; } }
  }
  return true;   // nothing synced yet: nothing to check against
}
// Whoever needs to know this computer now has the key (the relay connects then).
let unlockedFns = [];
export const onUnlocked = (fn) => unlockedFns.push(fn);
async function useKey(keyHex) {
  const s = getSetting('sync', null);
  if (!(await keyWorks(s, keyHex))) throw new Error('That does not unlock this account.');
  s.key = keyHex; saveSync(s);
  pairing = null;
  await syncNow({ preferRemote: true });
  for (const fn of unlockedFns) { try { fn(); } catch {} }
}
export async function unlockWithRecovery(text) {
  const s = getSetting('sync', null);
  const r = await call(s.server, '/v1/keys/recovery', { token: s.token });
  if (r.status !== 200) throw new Error(r.json.error || 'This account has no recovery key.');
  let keyHex;
  try { keyHex = unwrapKey(r.json.blob, normRecovery(text)); } catch { throw new Error('That recovery key is not right.'); }
  await useKey(keyHex);
}
export async function unlockWithPassword(password) {
  const s = getSetting('sync', null);
  const salt = await call(s.server, '/v1/salt', { method: 'POST', body: { email: s.email } });
  if (salt.status !== 200) throw new Error(salt.json.error || 'Could not reach the sync service.');
  await useKey(deriveKeys(password, salt.json.salt).key);
}

// ---- pairing: this computer asks, one already signed in approves. The code is
// made from this computer's one-time public key, and the approving computer
// shows the code from the key it received: if they match, nobody in between
// swapped the key, so only this computer can open what comes back.
export const pairCode = (pubB64) => String(parseInt(createHash('sha256').update(pubB64).digest('hex').slice(0, 8), 16) % 1e6).padStart(6, '0');
const pubOf = (keyObj) => keyObj.export({ type: 'spki', format: 'der' }).toString('base64');
const fromPub = (b64) => createPublicKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'spki' });
function boxKey(privateKey, otherPub, pubA, pubB) {
  const shared = diffieHellman({ privateKey, publicKey: fromPub(otherPub) });
  return Buffer.from(hkdfSync('sha256', shared, Buffer.from(pubA + pubB), 'switchboard-pair', 32));
}
export function sealForPair(keyHex, askPub) {
  const mine = generateKeyPairSync('x25519');
  const pub2 = pubOf(mine.publicKey);
  const k = boxKey(mine.privateKey, askPub, askPub, pub2);
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', k, iv);
  const data = Buffer.concat([c.update(keyHex, 'utf8'), c.final()]);
  return { pub2, box: Buffer.concat([iv, c.getAuthTag(), data]).toString('base64') };
}
export function openFromPair(privateKey, myPub, pub2, box) {
  const k = boxKey(privateKey, pub2, myPub, pub2);
  const b = Buffer.from(box, 'base64');
  const d = createDecipheriv('aes-256-gcm', k, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}

let pairTimer = null;
export async function requestPair(onChange) {
  const s = getSetting('sync', null);
  if (!s?.token || s.key) return;
  const kp = generateKeyPairSync('x25519'), pub = pubOf(kp.publicKey);
  const r = await call(s.server, '/v1/pair', { method: 'POST', token: s.token, body: { pub, name: getSetting('deviceName', null) || hostname().replace(/\.local$/, '') } });
  if (r.status !== 200) throw new Error(r.json.error || 'Could not ask the other computer.');
  pairing = { id: r.json.id, priv: kp.privateKey, pub, code: pairCode(pub), status: 'waiting', at: Date.now() };
  clearInterval(pairTimer);
  pairTimer = setInterval(async () => {
    if (!pairing || Date.now() - pairing.at > 10 * 60e3) { clearInterval(pairTimer); if (pairing) pairing.status = 'expired'; onChange?.(); return; }
    const q = await call(s.server, `/v1/pair/${pairing.id}`, { token: s.token }).catch(() => null);
    if (q?.json?.status === 'denied') { pairing.status = 'denied'; clearInterval(pairTimer); onChange?.(); }
    if (q?.json?.status === 'approved') {
      clearInterval(pairTimer);
      try { await useKey(openFromPair(pairing.priv, pairing.pub, q.json.pub2, q.json.box)); }
      catch { if (pairing) pairing.status = 'failed'; }
      onChange?.();
    }
  }, 2000);
  onChange?.();
}
export function cancelPair() { clearInterval(pairTimer); pairing = null; }

// Requests from other computers, for this one to approve.
export async function refreshAsks() {
  const s = getSetting('sync', null);
  if (!s?.token || !s.key) { asks = []; return; }
  const r = await call(s.server, '/v1/pair', { token: s.token }).catch(() => null);
  asks = (r?.json?.requests || []).map((x) => ({ id: x.id, name: x.name, code: pairCode(x.pub), pub: x.pub }));
}
export async function answerPair(id, approve) {
  const s = getSetting('sync', null);
  const a = asks.find((x) => x.id === id);
  if (!a) throw new Error('That request is gone.');
  const body = approve ? { approve: true, ...sealForPair(s.key, a.pub) } : { approve: false };
  const r = await call(s.server, `/v1/pair/${id}`, { method: 'POST', token: s.token, body });
  if (r.status !== 200) throw new Error(r.json.error || 'Could not answer.');
  asks = asks.filter((x) => x.id !== id);
}

// ---- Devices: every computer signed in to this account
export async function devices() {
  const s = getSetting('sync', null);
  if (!s?.token) return [];
  const r = await call(s.server, '/v1/devices', { token: s.token });
  if (r.status !== 200) throw new Error(r.json.error || 'Could not load your computers.');
  return r.json.devices;
}
export async function removeDevice(id) {
  const s = getSetting('sync', null);
  const r = await call(s.server, `/v1/devices/${encodeURIComponent(id)}/remove`, { method: 'POST', token: s.token, body: {} });
  if (r.status !== 200) throw new Error(r.json.error || 'Could not remove that computer.');
}

export async function signOut() {
  const s = getSetting('sync', null);
  if (s?.token) await call(s.server, '/v1/logout', { method: 'POST', token: s.token }).catch(() => {});
  db.prepare("DELETE FROM settings WHERE key = 'sync'").run();
  status = { at: null, ok: null, error: null, busy: false };
  info = null; asks = []; freshRecovery = null; cancelPair();
}

// ---- the three documents: read local, merge remote
const docs = {
  pages: pagesDoc,   // the notebook (lib/pages.js)
  settings: {
    read() {
      const out = {};
      // Locked settings are unlocked here, then sealed with the account key for the trip.
      for (const r of db.prepare('SELECT key, value, updated_at FROM settings').all()) {
        if (LOCAL_ONLY(r.key)) continue;
        try { out[r.key] = { v: decodeSetting(r.key, r.value), at: r.updated_at || 0 }; } catch {}
      }
      return out;
    },
    merge(remote, preferRemote) {
      let n = 0;
      const put = db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at');
      for (const [k, { v, at }] of Object.entries(remote || {})) {
        if (LOCAL_ONLY(k)) continue;
        const cur = db.prepare('SELECT updated_at FROM settings WHERE key = ?').get(k);
        // Signing in on a new computer: the account's settings win over whatever was set up locally.
        if (!cur || preferRemote || (cur.updated_at || 0) < at) { put.run(k, encodeSetting(k, v), Math.max(at, 1)); n++; }
      }
      return n;
    }
  },
  items: {
    read() {
      const rows = db.prepare('SELECT uid, kind, text, space, due_at, amount, cadence, created_at, done_at, notified_at, updated_at FROM items').all();
      const dead = db.prepare('SELECT uid, at FROM tombstones').all();
      return { rows, dead };
    },
    merge(remote) {
      let n = 0;
      for (const t of remote?.dead || []) {
        db.prepare('INSERT OR REPLACE INTO tombstones (uid, at) VALUES (?, ?)').run(t.uid, t.at);
        const cur = db.prepare('SELECT updated_at FROM items WHERE uid = ?').get(t.uid);
        if (cur && cur.updated_at <= t.at) { db.prepare('DELETE FROM items WHERE uid = ?').run(t.uid); n++; }
      }
      for (const r of remote?.rows || []) {
        const dead = db.prepare('SELECT at FROM tombstones WHERE uid = ?').get(r.uid);
        if (dead && dead.at >= r.updated_at) continue;
        const cur = db.prepare('SELECT id, updated_at FROM items WHERE uid = ?').get(r.uid);
        if (!cur) {
          db.prepare('INSERT INTO items (uid, kind, text, space, due_at, amount, cadence, created_at, done_at, notified_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(r.uid, r.kind, r.text, r.space, r.due_at, r.amount, r.cadence, r.created_at, r.done_at, r.notified_at, r.updated_at);
          n++;
        } else if (cur.updated_at < r.updated_at) {
          db.prepare('UPDATE items SET kind = ?, text = ?, space = ?, due_at = ?, amount = ?, cadence = ?, created_at = ?, done_at = ?, notified_at = ?, updated_at = ? WHERE id = ?')
            .run(r.kind, r.text, r.space, r.due_at, r.amount, r.cadence, r.created_at, r.done_at, r.notified_at, r.updated_at, cur.id);
          n++;
        }
      }
      // Tombstones only need to outlive the slowest computer; keep 60 days.
      db.prepare('DELETE FROM tombstones WHERE at < ?').run(Date.now() - 60 * 86400e3);
      return n;
    }
  },
  cleared: {
    read() { return db.prepare('SELECT key, at, until, updated_at FROM cleared WHERE at > ?').all(Date.now() - 30 * 86400e3); },
    merge(remote) {
      let n = 0;
      for (const r of remote || []) {
        const cur = db.prepare('SELECT updated_at FROM cleared WHERE key = ?').get(r.key);
        if (!cur || (cur.updated_at || 0) < (r.updated_at || r.at)) {
          db.prepare('INSERT INTO cleared (key, at, until, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET at = excluded.at, until = excluded.until, updated_at = excluded.updated_at')
            .run(r.key, r.at, r.until, r.updated_at || r.at);
          n++;
        }
      }
      return n;
    }
  }
};

const stable = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v)) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : 1)) : v);

// Pull each document that changed elsewhere, merge it in, and push back if this
// computer knows more. One cheap list call first: a document whose version on
// the service and whose local contents are both unchanged since last time is
// skipped, so a quiet check costs one request.
const digest = (o) => createHash('sha256').update(stable(o)).digest('hex');
export async function syncNow({ preferRemote = false } = {}) {
  const s = getSetting('sync', null);
  if (!s?.token || !s.key || status.busy) return false;
  status.busy = true;
  let merged = 0;
  try {
    const list = await call(s.server, '/v1/docs', { token: s.token });
    if (list.status === 401) throw new Error('Signed out on the sync service. Sign in again.');
    if (list.status !== 200) throw new Error(list.json.error || `Sync failed (${list.status}).`);
    const remoteVersions = Object.fromEntries((list.json.docs || []).map((d) => [d.name, d.version]));
    const seen = s.seen || {};   // name -> { version, hash } after the last sync
    for (const [name, doc] of Object.entries(docs)) {
      if (!preferRemote && seen[name] && seen[name].version === (remoteVersions[name] || 0) && seen[name].hash === digest(doc.read())) continue;
      for (let attempt = 0; attempt < 3; attempt++) {
        const r = await call(s.server, `/v1/docs/${name}`, { token: s.token });
        if (r.status === 401) throw new Error('Signed out on the sync service. Sign in again.');
        if (r.status !== 200) throw new Error(r.json.error || `Sync failed (${r.status}).`);
        let remote = null;
        if (r.json.body) {
          try { remote = unseal(r.json.body, s.key); }
          catch { throw new Error('The synced data could not be unlocked with this password.'); }
          merged += doc.merge(remote, preferRemote && attempt === 0);
        }
        const local = doc.read();
        if (remote && stable(local) === stable(remote)) { seen[name] = { version: r.json.version || 0, hash: digest(local) }; break; }
        const put = await call(s.server, `/v1/docs/${name}`, { method: 'PUT', token: s.token, body: { body: seal(local, s.key), baseVersion: r.json.version || 0 } });
        if (put.status === 200) { seen[name] = { version: put.json.version, hash: digest(local) }; break; }
        if (put.status !== 409) throw new Error(put.json.error || 'Sync failed.');
        // Someone else saved first: loop, merge theirs, try again.
      }
    }
    const cur = getSetting('sync', null);
    if (cur?.token === s.token) saveSync({ ...cur, seen });
    status = { at: Date.now(), ok: true, error: null, busy: false };
  } catch (e) {
    status = { at: Date.now(), ok: false, error: String(e.message || e), busy: false };
  }
  status.busy = false;
  return merged > 0;
}

// Sync a few seconds after a local change, at once when another computer saved
// (the sync service says so over the relay), and every five minutes regardless.
let soon = null, mergedFn = null;
export function syncSoon(ms = 1000) {
  clearTimeout(soon);
  soon = setTimeout(() => syncNow().then((m) => { if (m) mergedFn?.(); }).catch(() => {}), ms);
}
export function startSync(onMerged) {
  mergedFn = onMerged;
  const run = () => syncNow().then((m) => { if (m) onMerged?.(); }).catch(() => {})
    .then(() => refreshAsks()).then(() => { if (asks.length) onMerged?.(); }).catch(() => {});
  setTimeout(() => refreshInfo().then(() => onMerged?.()).catch(() => {}), 1500);
  onChange(() => syncSoon(3000));
  setTimeout(run, 2000);
  setInterval(run, 5 * 60e3);
}
