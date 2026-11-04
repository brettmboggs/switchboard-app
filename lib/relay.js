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
import { seal, unseal, refreshAsks, syncSoon } from './sync.js';
import { collect as collectWebhooks } from './webhooks.js';
import { listTerms, attach, enqueue, releaseItem, dropItem, deliver, sendNow, interrupt, closeTerm } from './terminals.js';

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

function send(to, payload) {
  if (!ws || ws.readyState !== 1 || !key) return false;
  ws.send(JSON.stringify({ to, p: seal(payload, key) }));
  return true;
}

const slim = (t) => ({
  id: t.id, name: t.name, cwd: t.cwd, space: t.space, agent: t.agent, agentName: t.agentName, mode: t.mode,
  state: t.state, detail: t.detail, prompt: t.prompt, updatedAt: t.updatedAt,
  queued: t.queued.map((q) => ({ id: q.id, text: q.text, source: q.source, held: q.held })), links: []
});

// Whether the account's other computers may see and use this one's sessions (Settings, Accounts).
export const allowRemote = () => getSetting('allowRemote', true) !== false;
export function publishTerms() { send('*', { t: 'terms', terms: allowRemote() ? listTerms().map(slim) : [] }); }
// Actions another computer may ask of this one's sessions; all refused when allowRemote is off.
const HOSTING = new Set(['attach', 'in', 'size', 'queue', 'release', 'drop', 'interrupt', 'close']);

function flush(chan) {
  const h = hosted.get(chan);
  if (!h || !h.buf) return;
  send(h.viewer, { t: 'out', chan, d: h.buf });
  h.buf = ''; h.timer = null;
}

async function handle(from, m) {
  if (HOSTING.has(m.t) && !allowRemote()) {
    if (m.t === 'attach') send(from, { t: 'end', chan: m.chan, why: 'That computer does not share its sessions.' });
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
    case 'interrupt': await interrupt(m.term).catch(() => {}); break;
    case 'close': await closeTerm(m.term).catch(() => {}); publishTerms(); onChangeFn(); break;
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
    if (msg.from === 'service' && msg.type === 'devices') { onChangeFn(); return; }
    // Something came in on a webhook: collect it (lib/webhooks.js).
    if (msg.from === 'service' && msg.type === 'hooks') { collectWebhooks(onChangeFn); return; }
    if (!msg.p || !msg.from) return;
    let m; try { m = unseal(msg.p, key); } catch { return; }   // not from this account
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

export function remoteAction(device, payload) {
  if (!send(device, payload)) throw new Error('That computer is not connected right now.');
}
