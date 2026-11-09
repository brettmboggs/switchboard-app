// The live link between your computers. Each Switchboard keeps one WebSocket to
// the relay (the sync service's Durable Object) while signed in. Through it:
//
//   - every computer shares its session list, so all of them can show all sessions
//   - opening another computer's session streams its terminal both ways
//   - queue, send now, stop and end work on any computer's sessions
//
// A session always runs on the computer that started it; the others are windows
// into it. Every message is encrypted with the account key before it leaves, so
// the relay only sees who it is for.
import WebSocket from 'ws';
import { hostname } from 'node:os';
import { randomBytes } from 'node:crypto';
import { db, getSetting } from './db.js';
import { friendlyError } from './friendly.js';
import { seal, unseal, refreshAsks, syncSoon } from './sync.js';
import { shareSoon } from './share.js';
import { chatNotice } from './chat.js';
import { collect as collectWebhooks } from './webhooks.js';
import { listTerms, attach, enqueue, releaseItem, dropItem, sendItemNow, deliver, sendNow, interrupt, closeTerm, startTerm, renameTerm, folders, installedAgents } from './terminals.js';
import { termRow, readChat, readMenu, answerMenu } from './chatview.js';
import { remoteFiles } from './localfile.js';

export function deviceId() {
  let id = getSetting('deviceId', null);
  if (!id) {
    id = randomBytes(12).toString('hex');
    db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('deviceId', JSON.stringify(id));
  }
  return id;
}
const deviceName = () => getSetting('deviceName', null) || hostname().replace(/\.local$/, '');

let ws = null, key = null, retry = 2000, pingTimer = null, stopped = false, removedHere = false;
let online = [];                         // [{ device, name }]
const remote = new Map();                // device -> { terms, at }
const hosted = new Map();                // chan -> { p, viewer, buf, timer }   (sessions here, viewed elsewhere)
const viewing = new Map();               // chan -> browser socket              (sessions elsewhere, viewed here)
let onChangeFn = () => {};

export const relayState = () => ({
  connected: !!ws && ws.readyState === 1,
  removed: removedHere,
  allowRemote: allowRemote(),
  device: deviceId(),
  devices: online.map((d) => ({ ...d, me: d.device === deviceId() }))
});

// Sessions on the other computers, flattened for the page.
export function remoteTerms() {
  const names = new Map(online.map((d) => [d.device, d.name]));
  const out = [];
  for (const [device, r] of remote) {
    if (!names.has(device)) continue;      // that computer went offline
    for (const t of r.terms) out.push({ ...t, device, deviceName: names.get(device), remote: true });
  }
  return out;
}

// ---- replay protection. The sealed part of every message says who sent it,
// who it is for, when, and carries a one-time nonce. A message for another
// device, from a device other than the one the relay says, older than the
// window, or seen before is dropped: the sync operator can relay ciphertext,
// not re-send it. Nonces are kept per peer, the newest 2000, within a
// ten-minute window (so clocks have to agree to within ten minutes).
const REPLAY_WINDOW = 10 * 60e3, REPLAY_KEEP = 2000;
const seen = new Map();                  // from device -> Set of nonces, oldest first
const olderPeers = new Set();
export function sealFor(payload, keyHex, from, to, now = Date.now()) {
  return seal({ ...payload, from, to, at: now, nonce: randomBytes(8).toString('hex') }, keyHex);
}
// The payload, or null when it must not be acted on. Throws when it is not this account's.
export function openFrom(blob, keyHex, me, from, now = Date.now()) {
  const m = unseal(blob, keyHex);
  if (m.nonce === undefined) {
    // A Switchboard from before Nov 4 2026 seals no sender, recipient or nonce.
    // Taken for one release so both computers keep working across the update;
    // remove this branch (return null) after Dec 15 2026.
    if (!olderPeers.has(from)) { olderPeers.add(from); console.log(`relay: ${from} runs an older Switchboard (no replay protection on its messages); update it`); }
    return m;
  }
  if (m.from !== from || (m.to !== me && m.to !== '*')) return null;
  if (typeof m.nonce !== 'string' || !(Math.abs(now - m.at) <= REPLAY_WINDOW)) return null;
  let s = seen.get(from);
  if (!s) seen.set(from, s = new Set());
  if (s.has(m.nonce)) return null;
  s.add(m.nonce);
  if (s.size > REPLAY_KEEP) s.delete(s.values().next().value);
  return m;
}

function send(to, payload) {
  if (!ws || ws.readyState !== 1 || !key) return false;
  ws.send(JSON.stringify({ to, p: sealFor(payload, key, deviceId(), to) }));
  return true;
}

const slim = (t) => ({
  id: t.id, name: t.name, cwd: t.cwd, space: t.space, agent: t.agent, agentName: t.agentName, mode: t.mode,
  state: t.state, detail: t.detail, prompt: t.prompt, updatedAt: t.updatedAt, title: t.title, named: t.named,
  queued: t.queued.map((q) => ({ id: q.id, text: q.text, source: q.source, held: q.held })), links: []
});

// Whether the account's other computers may see and use this one's sessions (Settings, Accounts).
// Off until the person turns it on (Settings, Accounts): a new install should not
// hand its shells to every computer on the account by default.
export const allowRemote = () => getSetting('allowRemote', false) === true;
export function publishTerms() { send('*', { t: 'terms', terms: allowRemote() ? listTerms().map(slim) : [] }); }
// Actions another computer may ask of this one's sessions; all refused when allowRemote is off.
const HOSTING = new Set(['attach', 'in', 'size', 'queue', 'release', 'drop', 'now', 'interrupt', 'close', 'ask', 'start', 'rename']);

function flush(chan) {
  const h = hosted.get(chan);
  if (!h || !h.buf) return;
  send(h.viewer, { t: 'out', chan, d: h.buf });
  h.buf = ''; h.timer = null;
}

async function handle(from, m) {
  if (HOSTING.has(m.t) && !allowRemote()) {
    if (m.t === 'attach') send(from, { t: 'end', chan: m.chan, why: 'That computer does not share its sessions.' });
    if (m.t === 'ask') send(from, { t: 'answer', rid: m.rid, r: { status: 403, error: 'That computer does not share its sessions.' } });
    return;
  }
  switch (m.t) {
    case 'terms': remote.set(from, { terms: m.terms || [], at: Date.now() }); onChangeFn(); break;
    case 'need-terms': publishTerms(); break;

    // ---- this computer hosting a session someone else is looking at
    case 'attach': {
      let p;
      try { p = attach(m.term, m.cols, m.rows); } catch { send(from, { t: 'end', chan: m.chan, why: 'That session is closed.' }); return; }
      const h = { p, viewer: from, buf: '', timer: null };
      hosted.set(m.chan, h);
      p.onData((d) => { h.buf += d; if (h.buf.length > 64 * 1024) flush(m.chan); else if (!h.timer) h.timer = setTimeout(() => flush(m.chan), 25); });
      p.onExit(() => { flush(m.chan); send(from, { t: 'end', chan: m.chan }); hosted.delete(m.chan); });
      break;
    }
    case 'in': hosted.get(m.chan)?.p.write(m.d); break;
    case 'size': try { hosted.get(m.chan)?.p.resize(m.c, m.r); } catch {} break;
    case 'detach': { const h = hosted.get(m.chan); if (h) { try { h.p.kill(); } catch {} hosted.delete(m.chan); } break; }

    // ---- this computer viewing a session hosted elsewhere
    case 'out': { const b = viewing.get(m.chan); if (b?.readyState === 1) b.send(m.d); break; }
    case 'end': { const b = viewing.get(m.chan); if (b) { if (m.why && b.readyState === 1) b.send(`\r\n\x1b[90m[${m.why}]\x1b[0m\r\n`); b.close(); } viewing.delete(m.chan); break; }

    // ---- actions on this computer's sessions, sent from another
    case 'queue':
      if (m.now) await sendNow(m.term, m.text).catch(() => {});
      else { enqueue(m.term, m.text, { source: m.source || 'You', held: !!m.held }); await deliver().catch(() => {}); }
      publishTerms(); onChangeFn(); break;
    case 'release': releaseItem(m.qid); await deliver().catch(() => {}); publishTerms(); onChangeFn(); break;
    case 'drop': dropItem(m.qid); publishTerms(); onChangeFn(); break;
    case 'now': await sendItemNow(m.qid).catch(() => {}); publishTerms(); onChangeFn(); break;
    case 'interrupt': await interrupt(m.term).catch(() => {}); break;
    case 'close': await closeTerm(m.term).catch(() => {}); publishTerms(); onChangeFn(); break;
    // A new session here, started from another device (the phone's New session): a folder from this computer's own list only.
    case 'start': {
      const cwd = String(m.cwd || '');
      if (!folders().some((f) => f.path === cwd)) break;
      const agent = installedAgents().some((a) => a.id === m.agent && a.id !== 'custom' && a.installed) ? m.agent : 'claude';
      await startTerm({ cwd, agent }).catch(() => {});
      publishTerms(); onChangeFn(); break;
    }
    case 'rename': if (renameTerm(String(m.term || ''), m.name)) { publishTerms(); onChangeFn(); } break;

    // ---- the Chat view of a session here, asked from another computer, and its answer
    case 'ask': send(from, { t: 'answer', rid: m.rid, r: await answerAsk(m).catch((err) => ({ status: 500, error: friendlyError(err, 'the other computer') })) }); break;
    case 'answer': { const w = asks.get(m.rid); if (w) { asks.delete(m.rid); clearTimeout(w.timer); w.done(m.r || {}); } break; }
  }
}

function connect() {
  const s = getSetting('sync', null);
  if (stopped || !s?.token || !s.key) return;   // no account key on this computer yet
  key = s.key;
  const url = s.server.replace(/^http/, 'ws').replace(/\/$/, '') + `/v1/relay?device=${deviceId()}&name=${encodeURIComponent(deviceName())}`;
  const sock = new WebSocket(url, { headers: { Authorization: `Bearer ${s.token}` }, handshakeTimeout: 15000 });
  ws = sock;
  sock.on('open', () => {
    retry = 2000;
    clearInterval(pingTimer);
    pingTimer = setInterval(() => { if (sock.readyState === 1) sock.send('{"type":"ping"}'); }, 25000);
    publishTerms();
    send('*', { t: 'need-terms' });
    onChangeFn();
  });
  sock.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === 'presence') {
      online = msg.devices || [];
      const ids = new Set(online.map((d) => d.device));
      for (const d of remote.keys()) if (!ids.has(d)) remote.delete(d);
      publishTerms();
      onChangeFn();
      return;
    }
    // From the sync service itself: another computer is asking to be let in.
    if (msg.from === 'service' && msg.type === 'pair') { refreshAsks().then(() => onChangeFn()).catch(() => {}); return; }
    // Another computer saved something: fetch it now rather than at the next check.
    if (msg.from === 'service' && msg.type === 'docs') { syncSoon(800); return; }
    // Someone in a shared project saved, invited you, or left (lib/share.js).
    if (msg.from === 'service' && msg.type === 'shares') { shareSoon(500); return; }
    // Team chat: a new message, a read mark, or someone typing (lib/chat.js).
    if (msg.from === 'service' && msg.type === 'chat') { chatNotice(msg); return; }
    if (msg.from === 'service' && msg.type === 'devices') { onChangeFn(); return; }
    // Something came in on a webhook: collect it (lib/webhooks.js).
    if (msg.from === 'service' && msg.type === 'hooks') { collectWebhooks(onChangeFn); return; }
    if (!msg.p || !msg.from) return;
    let m; try { m = openFrom(msg.p, key, deviceId(), msg.from); } catch { return; }   // not from this account
    if (!m) return;                                                                        // not for this device, or seen before
    handle(msg.from, m).catch(() => {});
  });
  sock.on('close', (code) => {
    // Removed from the account on another computer: stop trying to reconnect.
    if (code === 4001) { stopped = true; removedHere = true; }
    clearInterval(pingTimer);
    if (ws === sock) ws = null;
    online = []; remote.clear();
    for (const [chan, h] of hosted) { try { h.p.kill(); } catch {} hosted.delete(chan); }
    onChangeFn();
    if (!stopped) setTimeout(connect, retry);
    retry = Math.min(retry * 2, 60000);
  });
  sock.on('error', () => {});
  sock.on('unexpected-response', (req, res) => { if (res.statusCode === 401) { stopped = true; removedHere = true; } try { sock.terminate(); } catch {} });
}

export function startRelay(onChange) {
  onChangeFn = onChange || onChangeFn;
  stopped = false; removedHere = false;
  connect();
}

// After signing in or out.
export function restartRelay() {
  stopped = true;
  try { ws?.close(); } catch {}
  ws = null;
  setTimeout(() => { stopped = false; removedHere = false; connect(); }, 300);
}

// A browser terminal on this computer showing a session on another one.
export function openRemote(browser, device, term, cols, rows) {
  const chan = randomBytes(8).toString('hex');
  viewing.set(chan, browser);
  if (!send(device, { t: 'attach', term, chan, cols, rows })) {
    browser.send('\r\n\x1b[90m[Not connected to your other computers right now.]\x1b[0m\r\n');
    browser.close();
    return;
  }
  browser.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.t === 'in' && typeof msg.d === 'string') send(device, { t: 'in', chan, d: msg.d });
    if (msg.t === 'size') send(device, { t: 'size', chan, c: msg.c, r: msg.r });
  });
  browser.on('close', () => { viewing.delete(chan); send(device, { t: 'detach', chan }); });
}

// ---- Chat view across computers: a question, and one answer per question id.
const asks = new Map();   // rid -> { done, timer }
async function answerAsk(m) {
  // The phone's pages: this computer's own board and routes, asked over the relay.
  if (m.what === 'api') return phoneApi(m);
  // Where a new session can start on this computer, and with which agents.
  if (m.what === 'folders') return { folders: folders().slice(0, 200).map(({ path, name, copyOf }) => ({ path, name, ...(copyOf ? { copyOf } : {}) })), agents: installedAgents().filter((a) => a.installed && a.id !== 'custom').map(({ id, name }) => ({ id, name })) };
  const t = termRow(String(m.term || ''));
  if (!t) return { status: 404, error: 'That session has ended.' };
  if (m.what === 'chat') { const out = readChat(t, m.q || {}, { small: true }); delete out.path; return out; }
  if (m.what === 'menu') return { menu: await readMenu(t) };
  // File names in that session's chat or terminal, read for the computer showing it (lib/localfile.js).
  if (m.what === 'files') return remoteFiles(m, t.cwd);
  if (m.what === 'answer') { const r = await answerMenu(t, m.sig, m.index, typeof m.text === 'string' ? m.text : undefined); if (r.ok) { publishTerms(); onChangeFn(); } return r; }
  return { status: 400, error: 'Unknown question.' };
}
// What another device (the phone) may ask of this computer's own routes: the
// board and what its pages do with it (Now, Inbox, Money, Notes, Sessions,
// Builds, projects, Calendar's events, a task app's Done). Never settings, the account, keys, updates, connecting
// accounts, or this computer's windows and files. The same as using the page
// here, and like every relay action, refused when this computer does not
// share its sessions. The request goes to this server itself on 127.0.0.1,
// through the same checks as the page's own requests.
const PHONE_GET = [/^\/api\/state$/, /^\/api\/thread(\/full)?$/, /^\/api\/conversation$/, /^\/api\/session\/[\w-]+$/, /^\/api\/search$/,
  /^\/api\/folders$/, /^\/api\/agents$/, /^\/api\/terms\/[\w-]+\/(chat|menu|dev)$/, /^\/api\/pages\/[0-9a-f]{24}$/, /^\/api\/projects\/[a-z0-9-]{1,60}$/,
  /^\/api\/routines\/ideas$/, /^\/api\/feeds$/, /^\/api\/checks\/runs\/\d+$/, /^\/api\/bring$/, /^\/api\/system$/, /^\/api\/calendar$/];
const PHONE_POST = [/^\/api\/(capture|clear|seen|reply|archive|read|compose|terms|links|routines|refresh|paste)$/, /^\/api\/items\/\d+\/(done|snooze|undo|delete|paid)$/,
  /^\/api\/terms\/[\w-]+\/(close|queue|interrupt|rename|menu)$/, /^\/api\/queue\/\d+\/(release|drop|edit|now)$/, /^\/api\/pages(\/[0-9a-f]{24})?(\/delete)?$/,
  /^\/api\/costs(\/(\d+|not-recurring))?$/, /^\/api\/feeds\/(add|remove|edit|read|all-read)$/, /^\/api\/checks(\/(run|cancel|remove|inspect))?$/, /^\/api\/github\/[\w/-]+$/,
  /^\/api\/calendar\/event(\/delete)?$/, /^\/api\/tasks\/close$/, /^\/api\/jarvis(\/warm)?$/];
const PHONE_MAX = 700 * 1024;
export function phoneAllowed(method, path) {
  if (typeof path !== 'string' || path.length > 300 || !path.startsWith('/api/') || path.includes('..')) return false;
  const bare = path.split('?')[0];
  return (method === 'GET' ? PHONE_GET : method === 'POST' ? PHONE_POST : []).some((re) => re.test(bare));
}
// Long texts cut until a reply fits in one relay message.
const cutStrings = (v, n) => typeof v === 'string' ? (v.length > n ? v.slice(0, n) + ' …' : v)
  : Array.isArray(v) ? v.map((x) => cutStrings(x, n)) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cutStrings(x, n)])) : v;
async function phoneApi(m) {
  const method = m.method === 'POST' ? 'POST' : 'GET';
  if (!phoneAllowed(method, m.path)) return { status: 403, error: 'Not from the phone.' };
  const port = Number(process.env.SWITCHBOARD_PORT || 4747);
  const res = await fetch(`http://127.0.0.1:${port}${m.path}`, {
    method, headers: { 'Content-Type': 'application/json', 'X-Switchboard': '1' },
    body: method === 'POST' ? JSON.stringify(m.body || {}) : undefined, signal: AbortSignal.timeout(m.path === '/api/jarvis' ? 45000 : 20000)
  });
  let json = await res.json().catch(() => ({}));
  // The board without this computer's windows, version, connection status or account details.
  if (m.path === '/api/state') { json = { ...json, account: { email: json.account?.email || null } }; delete json.windows; delete json.version; delete json.status; }
  for (const cut of [4000, 1000, 300]) { if (JSON.stringify(json).length <= PHONE_MAX) break; json = cutStrings(json, cut); }
  return res.status === 200 ? { status: 0, json } : { status: res.status, error: json.error || 'That did not work.' };
}

export function askRemote(device, term, ask, wait = 12000) {
  const rid = randomBytes(8).toString('hex');
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { asks.delete(rid); reject(new Error('That computer did not answer in time.')); }, wait);
    asks.set(rid, { done: resolve, timer });
    if (!send(device, { ...ask, t: 'ask', rid, term })) { clearTimeout(timer); asks.delete(rid); reject(new Error('Not connected to your other computers right now.')); }
  });
}

export function remoteAction(device, payload) {
  if (!send(device, payload)) throw new Error('That computer is not connected right now.');
}
