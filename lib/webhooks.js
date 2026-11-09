// Webhooks in: a private link that IFTTT, Zapier, Home Assistant, a phone
// shortcut or any script can post to, putting an item on the board.
//
// Each webhook has one secret and two doors:
//   - this computer: http://127.0.0.1:4747/hook/in/<secret> (scripts here; no web page may use it)
//   - anywhere: <sync service>/v1/in/<secret>, once signed in. Each webhook has an
//     X25519 key pair made here; the service holds only the public half and seals
//     every message to it as it arrives (sync-worker/src/hookbox.js). It tells the
//     account's computers over the relay; they collect, open and delete.
//
// The list (with secrets and private keys) is a synced setting, locked on disk
// like passwords. Every computer can open every message; an item's id comes from
// the message's id, so two computers collecting the same one make one item.
import { randomBytes, generateKeyPairSync, createPrivateKey, createPublicKey, diffieHellman, hkdfSync, createDecipheriv, createHash, timingSafeEqual } from 'node:crypto';
import { db, getSetting, setSetting, onLocalChange } from './db.js';
import { spaces } from './spaces.js';
import { parseWhen } from './capture.js';
import { call } from './sync.js';
import { friendlyError } from './friendly.js';

export const KINDS = ['needs', 'todo', 'reminder', 'note'];
const MAX_BODY = 16 * 1024;
const MAX_HOOKS = 20;

// ---- the list: { hooks: [{ id, name, space, kind, secret, priv, pub, pending, at }], gone: [ids] }
const load = () => { const v = getSetting('webhooks', null); return { hooks: v?.hooks || [], gone: v?.gone || [] }; };
const save = (v) => setSetting('webhooks', { hooks: v.hooks, gone: v.gone.slice(-50) });
export const hooks = () => load().hooks;
const account = () => { const s = getSetting('sync', null); return s?.token && s.key ? s : null; };
const sha = (s) => createHash('sha256').update(s).digest('hex');

// For Settings: never the secret or the key.
export function hooksForPage() {
  return hooks().map((h) => ({ id: h.id, name: h.name, space: h.space, kind: h.kind, at: h.at, public: !!account() && !h.pending, pending: !!h.pending && !!account() }));
}
export function links(id, port, server) {
  const h = hooks().find((x) => x.id === id);
  if (!h) return null;
  return { local: `http://127.0.0.1:${port}/hook/in/${h.secret}`, public: account() ? `${server.replace(/\/$/, '')}/v1/in/${h.secret}` : null };
}

// ---- keys. The public key goes to the service as its raw 32 bytes.
const SPKI_X25519 = Buffer.from('302a300506032b656e032100', 'hex');
function newKeys() {
  const kp = generateKeyPairSync('x25519');
  return { priv: kp.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'), pub: kp.publicKey.export({ type: 'spki', format: 'der' }).subarray(12).toString('base64') };
}
// Opens what the service sealed (the format is in sync-worker/src/hookbox.js).
export function openBlob(h, b64) {
  const b = Buffer.from(b64, 'base64');
  if (b[0] !== 1 || b.length < 1 + 32 + 12 + 16) throw new Error('Unknown webhook format.');
  const ephRaw = b.subarray(1, 33), iv = b.subarray(33, 45), data = b.subarray(45, b.length - 16), tag = b.subarray(b.length - 16);
  const hookRaw = Buffer.from(h.pub, 'base64');
  const shared = diffieHellman({
    privateKey: createPrivateKey({ key: Buffer.from(h.priv, 'base64'), format: 'der', type: 'pkcs8' }),
    publicKey: createPublicKey({ key: Buffer.concat([SPKI_X25519, ephRaw]), format: 'der', type: 'spki' })
  });
  const key = Buffer.from(hkdfSync('sha256', shared, Buffer.alloc(0), Buffer.concat([Buffer.from('switchboard-hook'), ephRaw, hookRaw]), 32));
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(data), d.final()]).toString('utf8'));
}

// ---- reading a message: JSON, a form (what IFTTT and Zapier send), a phone
// shortcut's multipart form, or plain text. Returns the fields as strings.
export function readFields(type = '', body = '', query = '') {
  const f = {};
  const put = (k, v) => { if (typeof k === 'string' && k.length <= 40 && v != null && typeof v !== 'object') f[k.toLowerCase()] = String(v); };
  for (const [k, v] of new URLSearchParams(query || '')) put(k, v);
  const t = String(type).toLowerCase(), raw = String(body || '');
  if (t.includes('json') || /^\s*[{["]/.test(raw)) {
    let j; try { j = JSON.parse(raw); } catch { j = undefined; }
    if (j && typeof j === 'object' && !Array.isArray(j)) {
      for (const [k, v] of Object.entries(j)) {
        if (v && typeof v === 'object') f['_' + k.toLowerCase()] = JSON.stringify(v).slice(0, 300);
        else put(k, v);
      }
      return f;
    }
    if (typeof j === 'string' || typeof j === 'number') { f.text ??= String(j); return f; }
  }
  // A form, unless it is plain words sent as one (curl -d 'Gate left open' sends them that way).
  if (t.includes('x-www-form-urlencoded') && /^[^\s=&]+=/.test(raw.trim())) { for (const [k, v] of new URLSearchParams(raw)) put(k, v); return f; }
  const boundary = t.includes('multipart/form-data') && String(type).match(/boundary="?([^";]+)"?/i)?.[1];
  if (boundary) {
    for (const part of raw.split('--' + boundary)) {
      const m = part.match(/^\r?\n([\s\S]*?)\r?\n\r?\n([\s\S]*?)\r?\n?$/);
      const name = m?.[1].match(/name="([^"]*)"/i)?.[1];
      if (name && !/filename=/i.test(m[1])) put(name, m[2]);
    }
    return f;
  }
  if (raw.trim()) f.text ??= raw;
  return f;
}

const clean = (s, n = 500) => String(s ?? '').replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const KIND_WORDS = { needs: 'needs', need: 'needs', 'needs-you': 'needs', alert: 'needs', urgent: 'needs', todo: 'todo', 'to-do': 'todo', task: 'todo', reminder: 'reminder', remind: 'reminder', note: 'note' };

// A time in a message: a date and time (ISO), seconds or milliseconds since 1970, or words ("tomorrow 9am", "in 2h").
export function readDue(v, now = new Date()) {
  const s = clean(v, 100);
  if (!s) return null;
  if (/^\d{9,13}$/.test(s)) return Number(s) < 1e12 ? Number(s) * 1000 : Number(s);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) { const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + 'T09:00' : s); return Number.isNaN(t) ? null : t; }
  return parseWhen(s, now)?.at ?? null;
}

// The item a message makes. hook: the webhook it came in on (its project and kind are the defaults).
export function toItem(f, hook, now = Date.now()) {
  const title = f.title || f.subject, main = f.text || f.message || f.body || f.content;
  const values = [f.value1, f.value2, f.value3].filter((v) => v && clean(v));
  let text = clean([title, main].filter((v) => v && clean(v)).join(': ')) || clean(values.join(' · '));
  // Something else entirely (Home Assistant state, say): show its fields.
  if (!text) text = clean(Object.entries(f).filter(([k]) => !['kind', 'project', 'space', 'due', 'when', 'test'].includes(k)).filter(([, v]) => clean(v)).map(([k, v]) => `${k.replace(/^_/, '')}: ${v}`).join(' · '));
  if (!text) return { error: 'Nothing to put on the board. Send some text, for example {"text": "Gate left open"}.' };
  const kind = KIND_WORDS[clean(f.kind, 20).toLowerCase()] || hook.kind || 'needs';
  const want = clean(f.project || f.space, 80).toLowerCase().replace(/^@/, '');
  const list = spaces();
  const hit = want && list.find((s) => s.id === want || s.name.toLowerCase() === want || s.name.toLowerCase().replace(/\s+/g, '') === want.replace(/\s+/g, ''));
  const space = hit?.id || (list.some((s) => s.id === hook.space) ? hook.space : 'personal');
  const due = readDue(f.due || f.when, new Date(now));
  if (kind === 'note') return { kind: 'note', text, space, due_at: null };
  if (kind === 'todo') return { kind: 'todo', text, space, due_at: due };
  if (kind === 'reminder') return { kind: 'reminder', text, space, due_at: due ?? now };
  return { kind: 'todo', text, space, due_at: now };   // needs: on Now as "Needs you" at once, with an alert
}

// Puts it on the board. uid: the same on every computer for a message from the
// service, so collecting it twice makes one item; never brings back one deleted here.
function addItem(item, uid) {
  if (db.prepare('SELECT 1 FROM tombstones WHERE uid = ?').get(uid) || db.prepare('SELECT 1 FROM items WHERE uid = ?').get(uid)) return false;
  db.prepare('INSERT INTO items (uid, kind, text, space, due_at, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(uid, item.kind, item.text, item.space, item.due_at, Date.now());
  onLocalChange();
  return true;
}

// ---- managing them (Settings, Accounts)
export async function addHook({ name, space, kind }) {
  const v = load();
  if (v.hooks.length >= MAX_HOOKS) throw new Error(`You can have ${MAX_HOOKS} webhooks. Remove one first.`);
  const h = { id: randomBytes(16).toString('hex'), name: clean(name, 60) || 'Webhook', space: String(space || 'personal'), kind: KINDS.includes(kind) ? kind : 'needs', secret: randomBytes(32).toString('hex'), ...newKeys(), pending: true, at: Date.now() };
  v.hooks.push(h); save(v);
  await register(h).catch(() => {});
  return h.id;
}
export function updateHook(id, { name, space, kind }) {
  const v = load(), h = v.hooks.find((x) => x.id === id);
  if (!h) throw new Error('That webhook is gone.');
  if (name !== undefined) h.name = clean(name, 60) || h.name;
  if (space !== undefined) h.space = String(space);
  if (kind !== undefined && KINDS.includes(kind)) h.kind = kind;
  save(v);
}
// A new secret: the old link stops working at once. The keys stay, so messages already waiting still open.
export async function newLink(id) {
  const v = load(), h = v.hooks.find((x) => x.id === id);
  if (!h) throw new Error('That webhook is gone.');
  h.secret = randomBytes(32).toString('hex'); h.pending = true;
  save(v);
  await register(h).catch(() => {});
}
export async function removeHook(id) {
  const v = load();
  v.hooks = v.hooks.filter((x) => x.id !== id); v.gone.push(id);
  save(v);
  const s = account();
  if (s) await call(s.server, `/v1/webhooks/${id}/remove`, { method: 'POST', token: s.token, body: {} }).catch(() => {});
}

// Tells the service about a webhook (its secret's hash and its public key).
async function register(h) {
  const s = account();
  if (!s) return false;
  const r = await call(s.server, `/v1/webhooks/${h.id}`, { method: 'PUT', token: s.token, body: { hash: sha(h.secret), pub: h.pub } });
  if (r.status !== 200) throw new Error(r.json.error || 'Could not set up the public link.');
  const v = load(), cur = v.hooks.find((x) => x.id === h.id);
  if (cur && cur.secret === h.secret) { delete cur.pending; save(v); }
  return true;
}
// Brings the service up to date: webhooks made before signing in or while
// offline, and ones removed meanwhile. Never overwrites a link already there.
async function reconcile(s) {
  const r = await call(s.server, '/v1/webhooks', { token: s.token });
  if (r.status !== 200) return;
  const there = new Set((r.json.hooks || []).map((x) => x.id));
  const { hooks: list, gone } = load();
  for (const h of list) if (!there.has(h.id) || h.pending) await register(h).catch(() => {});
  for (const id of gone) if (there.has(id) && !list.some((h) => h.id === id)) await call(s.server, `/v1/webhooks/${id}/remove`, { method: 'POST', token: s.token, body: {} }).catch(() => {});
}

// ---- the door on this computer
const recent = new Map();   // hook id -> times of recent posts
const LOCAL_LIMIT = 120;    // per ten minutes
export async function hookInLocal(req, res, secret, send, changed) {
  // Scripts and services only. A browser always says where a post comes from
  // (Origin on every cross-site POST; Sec-Fetch-Site in current browsers), so a
  // web page posting here is turned away even with the secret. (Not Sec-Fetch-Mode:
  // Node's own fetch sends that one.)
  if (req.headers.origin || req.headers['sec-fetch-site']) return send(res, 403, { error: 'Webhooks take posts from scripts and services, not from web pages.' });
  if (req.method !== 'POST') return send(res, 405, { error: 'Send a POST to this address.' });
  const want = Buffer.from(sha(secret), 'hex');
  const h = hooks().find((x) => timingSafeEqual(Buffer.from(sha(x.secret), 'hex'), want));
  if (!h) return send(res, 404, { error: 'There is no webhook at this address. Copy the link again from Switchboard.' });
  const now = Date.now(), times = (recent.get(h.id) || []).filter((t) => now - t < 600e3);
  if (times.length >= LOCAL_LIMIT) return send(res, 429, { error: 'Too many posts to this webhook. Wait a few minutes.' });
  times.push(now); recent.set(h.id, times);
  let body = '', size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) return send(res, 413, { error: 'Too large: keep it under 16 KB.' }); body += chunk; }
  const url = new URL(req.url, 'http://127.0.0.1');
  const f = readFields(req.headers['content-type'], body, url.search.slice(1));
  if (f.test) { testArrived(f.test); return send(res, 200, { ok: true, test: true }); }
  const item = toItem(f, h);
  if (item.error) return send(res, 400, item);
  addItem(item, randomBytes(16).toString('hex'));
  changed();
  return send(res, 200, { ok: true, kind: item.kind, project: item.space });
}

// ---- collecting from the service
let busy = false, again = false;
export async function collect(changed) {
  const s = account();
  if (!s) return 0;
  if (busy) { again = true; return 0; }
  busy = true;
  let added = 0;
  try {
    await reconcile(s);
    const r = await call(s.server, '/v1/webhooks/inbox', { token: s.token });
    if (r.status !== 200) return 0;
    const { hooks: list, gone } = load();
    const done = [];
    for (const m of r.json.messages || []) {
      const h = list.find((x) => x.id === m.hook_id);
      if (!h) { if (gone.includes(m.hook_id)) done.push(m.id); continue; }   // not synced here yet: leave it
      let env;
      try { env = openBlob(h, m.blob); } catch { done.push(m.id); continue; }   // not ours, or damaged
      const f = readFields(env.type, env.body, env.query);
      if (f.test) {
        // Another computer's test: leave it for that one to collect (for two minutes).
        if (testArrived(f.test) || Date.now() - m.created_at > 120e3) done.push(m.id);
        continue;
      }
      const item = toItem(f, h, env.at || m.created_at);
      if (!item.error && addItem(item, m.id)) added++;
      done.push(m.id);
    }
    if (done.length) await call(s.server, '/v1/webhooks/inbox/delete', { method: 'POST', token: s.token, body: { ids: done } });
  } catch {} finally {
    busy = false;
    if (again) { again = false; setTimeout(() => collect(changed), 200); }
  }
  if (added) changed();
  return added;
}

// ---- Test it: a real message through each door, and how long it took.
const tests = new Map();   // nonce -> resolve
function testArrived(nonce) {
  const fn = tests.get(String(nonce));
  if (!fn) return false;
  tests.delete(String(nonce)); fn();
  return true;
}
function waitFor(nonce, ms) {
  return new Promise((ok, fail) => {
    const t = setTimeout(() => { tests.delete(nonce); fail(new Error('Nothing came back. Check this computer is connected to the internet.')); }, ms);
    tests.set(nonce, () => { clearTimeout(t); ok(); });
  });
}
async function post(url, nonce) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ test: nonce }), signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `It answered ${r.status}.`);
}
export async function testHook(id, port, server) {
  const l = links(id, port, server);
  if (!l) throw new Error('That webhook is gone.');
  const out = { local: null, public: null };
  const run = async (url, viaService) => {
    const nonce = randomBytes(8).toString('hex'), t0 = Date.now();
    const arrived = waitFor(nonce, 20000);
    arrived.catch(() => {});
    try {
      await post(url, nonce);
      // The relay normally says at once; look anyway, in case it is reconnecting.
      if (viaService) for (const ms of [3000, 7000, 12000]) setTimeout(() => collect(changedFn), ms);
      await arrived;
      return { ok: true, ms: Date.now() - t0 };
    }
    catch (e) { tests.delete(nonce); return { ok: false, error: friendlyError(e, 'the webhook link') }; }
  };
  out.local = await run(l.local);
  if (l.public) {
    await collect(changedFn);   // anything waiting first, so a full inbox does not fail the test
    const h = hooks().find((x) => x.id === id);
    if (h?.pending) await register(h).catch((e) => { out.public = { ok: false, error: friendlyError(e, 'the sync service') }; });
    if (!out.public) out.public = await run(l.public, true);
  }
  return out;
}

// Collect at start, every five minutes, and whenever the service says something came in (lib/relay.js).
let changedFn = () => {};
export function startWebhooks(changed) {
  changedFn = changed;
  setTimeout(() => collect(changed), 4000);
  setInterval(() => collect(changed), 5 * 60e3);
}
