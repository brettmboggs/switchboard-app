// Mail tracking, through the person's own tracker: the mail-tracker Worker on
// their Cloudflare account (its address, e.g. https://t.example.com, and an
// access token from its dashboard, Settings, Access tokens). Switchboard is one
// more client of it, like its Chrome extension and Gmail add-on:
// - Email sent from Switchboard is registered just before it goes and carries
//   the tracker's pixel and tracked links (trackOutgoing). No answer within
//   2.5 s and it goes untracked, so a link can never point at a tracker that
//   doesn't know it (the tracker's own rule).
// - Inbox, Tracking lists what was sent with opens and clicks, each with the
//   tracker's verdict (confirmed human, likely human, automated) and reasons.
//   A new human open or click is a desktop alert (the tracker's ntfy push
//   covers the phone, so Switchboard's phone push is not used).
// - Mail coming in from people is reported to the tracker's detector (its
//   images, links and a few headers); a sender who tracks you is marked in
//   Inbox, and a person doing it is an alert. Switchboard shows received mail
//   as text, so their pixels never load here.
// The token is kept like other secrets (SECRET_SETTINGS in db.js).
import { db, getSetting, setSetting } from './db.js';
import { alert } from './notify.js';
import { createHash } from 'node:crypto';

const cfg = () => getSetting('mailtrack', null);   // { origin, token, user, trackerOrigin, settings, at }
export const mailtrackOn = () => !!cfg()?.token;

db.exec(`CREATE TABLE IF NOT EXISTS mailtrack_in (
  msg_id TEXT PRIMARY KEY, thread_id TEXT, from_addr TEXT, category TEXT, vendors TEXT, read_receipt INTEGER, at INTEGER NOT NULL
)`);

// The tracker's address as typed: https only, no path.
export function trackerOrigin(text) {
  let s = String(text || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try { const u = new URL(s); return u.protocol === 'https:' || /^(localhost|127\.0\.0\.1)$/.test(u.hostname) ? u.origin : null; } catch { return null; }   // http only for a tracker run on this computer (development)
}

async function call(method, path, body, { timeout = 8000, conf = cfg() } = {}) {
  if (!conf?.token) throw new Error('Mail tracking is not connected. Settings, Connections, Mail tracking.');
  let r;
  try {
    r = await fetch(conf.origin + path, { method, headers: { authorization: `Bearer ${conf.token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeout) });
  } catch (e) { throw Object.assign(new Error(`Could not reach your tracker at ${conf.origin.replace(/^https:\/\//, '')}. Check the address and the internet connection.`), { cause: e }); }
  if (r.status === 401 || r.status === 403) throw Object.assign(new Error('Your tracker did not accept that token. Make a new one in the tracker (Settings, Access tokens) and paste it in Settings, Connections, Mail tracking.'), { signin: true });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ? `Your tracker said: ${j.error}` : `Your tracker answered ${r.status}. Try again in a minute.`);
  return j;
}

// ---------- connecting
export async function connectTracker(address, token) {
  const origin = trackerOrigin(address);
  if (!origin) throw new Error('Type your tracker\'s address, like t.example.com (it must be https).');
  token = String(token || '').trim();
  if (token.length < 16) throw new Error('Paste an access token from your tracker: its dashboard, Settings, Access tokens, New token.');
  const me = await call('GET', '/api/me', null, { conf: { origin, token } });
  setSetting('mailtrack', { origin, token, user: me.user?.email || null, trackerOrigin: me.trackerOrigin || origin, settings: me.settings || {}, at: Date.now() });
  state = blank();
  await pollMailtrack().catch(() => {});
  return { ok: true, user: me.user?.email || null };
}
export function disconnectTracker() { setSetting('mailtrack', null); state = blank(); db.exec('DELETE FROM mailtrack_in'); }
// Track new email by default, links too: the tracker's own settings, changed there or here.
export async function trackerSettings(patch) {
  const allowed = Object.fromEntries(Object.entries(patch || {}).filter(([k]) => ['trackByDefault', 'trackLinks', 'notifyOn', 'notifyTrackedBy'].includes(k)));
  const r = await call('PATCH', '/api/settings', allowed);
  setSetting('mailtrack', { ...cfg(), settings: r.settings || { ...cfg().settings, ...allowed } });
  return r;
}

// ---------- outgoing
const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?]/gi;
const hex = (dec) => { try { return dec && /^\d+$/.test(String(dec)) ? BigInt(dec).toString(16) : null; } catch { return null; } };
const addrs = (s) => String(s || '').split(/[,;]/).map((x) => (x.match(/<([^>]+)>/)?.[1] || x).trim().toLowerCase()).filter((x) => /^[^\s@]+@[^\s@]+$/.test(x));

// Registers an email about to go out. Returns { id, pixelUrl, links: Map(url -> trackedUrl) },
// or null (not connected, turned off, or the tracker did not answer in time: it goes untracked).
export async function trackOutgoing({ to, cc = '', subject, text, threadId = null }) {
  const c = cfg(); if (!c?.token) return null;
  const recipients = [...addrs(to).map((email) => ({ email, kind: 'to' })), ...addrs(cc).map((email) => ({ email, kind: 'cc' }))];
  if (!recipients.length) return null;
  const links = c.settings?.trackLinks === false ? [] : [...new Set(String(text || '').match(URL_RE) || [])].slice(0, 50);
  try {
    const r = await call('POST', '/api/emails', { subject: String(subject || '').slice(0, 300), recipients, links, gmailThreadId: hex(threadId) || undefined, client: 'switchboard' }, { timeout: 2500 });
    return { id: r.id, pixelUrl: r.pixelUrl, links: new Map((r.links || []).map((l) => [l.url, l.trackedUrl])) };
  } catch (e) { console.warn('mail tracking: sent untracked:', e.message); return null; }
}
// The tracked HTML for one paragraph's escaped text: its links point at the tracker.
export function linkify(escaped, links) {
  if (!links?.size) return escaped;
  return escaped.replace(URL_RE, (u) => { const raw = u.replace(/&amp;/g, '&'); const t = links.get(raw); return t ? `<a href="${t.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">${u}</a>` : u; });
}
export const pixelHtml = (url) => `<img src="${String(url).replace(/"/g, '&quot;')}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;margin:0;padding:0">`;
// After it went: when it was sent, so "too soon to be a person" is measured from then.
export function sentTracked(id) { if (id) call('PATCH', `/api/emails/${encodeURIComponent(id)}`, { sentAt: Date.now() }).catch(() => {}); }
export const trackByDefault = () => mailtrackOn() && cfg().settings?.trackByDefault !== false;

// ---------- incoming: what a received email carries, for the tracker's detector
const KEEP_HEADER = /^(list-|precedence$|x-|disposition-notification-to$|return-receipt-to$|feedback-id$|auto-submitted$)/;
let inbound = [];   // reports waiting to go, from the last read of mail
export function noteIncoming({ msgId, threadId, from, fromName, subject, date, parsed }) {
  if (!mailtrackOn() || !parsed || !msgId) return;
  const html = String(parsed.html || '');
  const images = [...html.matchAll(/<img\b[^>]*>/gi)].slice(0, 40).map(([tag]) => {
    const a = (n) => tag.match(new RegExp(`\\b${n}\\s*=\\s*["']?([^"'\\s>]+)`, 'i'))?.[1];
    return { src: a('src') || '', width: Number(a('width')) || undefined, height: Number(a('height')) || undefined, hidden: /display\s*:\s*none|visibility\s*:\s*hidden/i.test(tag) || undefined };
  }).filter((i) => /^https?:/i.test(i.src));
  const links = [...html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)].slice(0, 60).map((m) => ({ href: m[1].replace(/&amp;/g, '&') })).filter((l) => /^https?:/i.test(l.href));
  const headers = {};
  for (const [k, v] of parsed.headers || []) if (KEEP_HEADER.test(k)) headers[k] = (typeof v === 'string' ? v : v?.text || v?.value?.[0]?.address || JSON.stringify(v)).slice(0, 300);
  // The tracker keys a message by Gmail's id (hex); mail from other servers by a hash of its own id.
  const key = hex(msgId) || 'sb-' + createHash('sha1').update(String(msgId)).digest('hex').slice(0, 32);
  inbound.push({ gmailMessageId: key, gmailThreadId: hex(threadId) || undefined, from: { email: from, name: fromName || undefined }, subject: String(subject || '').slice(0, 300), receivedAt: date, images, links, headers, source: 'scan', pixelState: 'blocked', _dec: { msgId: String(msgId), threadId: String(threadId || '') } });
}
async function sendIncoming() {
  while (inbound.length) {
    const batch = inbound.splice(0, 50);
    let r;
    try { r = await call('POST', '/api/inbound', { messages: batch.map(({ _dec, ...m }) => m) }); }
    catch (e) { state.error = e.message; return; }
    const put = db.prepare('INSERT OR REPLACE INTO mailtrack_in (msg_id, thread_id, from_addr, category, vendors, read_receipt, at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const res of r.results || []) {
      const m = batch.find((b) => b.gmailMessageId === res.key);
      if (!m) continue;
      const tracked = (res.vendors || []).length > 0 || res.readReceipt;
      put.run(m._dec.msgId, m._dec.threadId, m.from.email, res.category || 'none', JSON.stringify(res.vendors || []), res.readReceipt ? 1 : 0, Date.now());
      // A person tracking you, in mail from the last day: say so (newsletters track everyone; that is not news).
      if (tracked && (res.category === 'person' || res.readReceipt) && Date.now() - (m.receivedAt || 0) < 86400e3) {
        alert('tracking', `${m.from.name || m.from.email} is tracking this email`, `${res.readReceipt ? 'It asks for a read receipt' : (res.vendors || []).join(', ')}${m.subject ? ' · ' + m.subject : ''}. Switchboard did not load their tracker.`);
      }
    }
  }
}

// ---------- reading the tracker
const blank = () => ({ emails: [], senders: new Map(), stats: null, at: 0, error: null, since: Date.now() - 60e3, sendersAt: 0 });
let state = blank();
const who = (e) => e.recipients?.[0]?.name || e.recipients?.[0]?.email || 'Someone';

// Every couple of minutes (server.js): sent emails and their status, new human
// opens and clicks (alerts), and now and then the senders who track you.
export async function pollMailtrack() {
  if (!mailtrackOn()) return false;
  const before = JSON.stringify(state.emails);
  try {
    await sendIncoming();
    const r = await call('GET', '/api/emails?limit=60');
    state.emails = r.emails || [];
    const act = await call('GET', `/api/activity?since=${state.since}`);
    state.since = act.now || Date.now();
    for (const ev of (act.events || []).slice(-5)) {
      const em = state.emails.find((e) => e.id === ev.emailId);
      alert('tracking', `${em ? who(em) : 'Someone'} ${ev.kind === 'click' ? 'clicked a link in' : 'opened'} “${ev.subject || em?.subject || 'your email'}”`, [ev.label === 'confirmed_human' ? 'Confirmed person' : 'Likely a person', ev.device, ev.location?.city].filter(Boolean).join(' · '));
    }
    if (Date.now() - state.sendersAt > 10 * 60e3) {
      const s = await call('GET', '/api/inbound/known-senders');
      state.senders = new Map((s.senders || []).map((x) => [String(x.email).toLowerCase(), x.vendors || []]));
      state.stats = await call('GET', '/api/inbound/stats').catch(() => null);
      state.sendersAt = Date.now();
    }
    state.error = null;
  } catch (e) { state.error = e.message; }
  state.at = Date.now();
  return JSON.stringify(state.emails) !== before;
}

// For the board: connection, sent emails (most recent first), and who tracks you.
const dec = (h) => { try { return h ? BigInt('0x' + h).toString() : null; } catch { return null; } };
export function mailtrackForBoard() {
  const c = cfg();
  if (!c?.token) return { connected: false };
  const since = Date.now() - 30 * 86400e3;
  const marks = db.prepare('SELECT thread_id, from_addr, category, vendors, read_receipt FROM mailtrack_in WHERE at > ? AND (vendors != \'[]\' OR read_receipt = 1)').all(since);
  return {
    connected: true, address: c.origin.replace(/^https:\/\//, ''), origin: c.origin, user: c.user, ok: !state.error, error: state.error, at: state.at,
    trackByDefault: c.settings?.trackByDefault !== false, trackLinks: c.settings?.trackLinks !== false,
    emails: state.emails.slice(0, 60).map((e) => ({ id: e.id, subject: e.subject, to: e.recipients || [], sentAt: e.sentAt, status: e.status, opens: e.opens, clicks: e.clicks, firstOpenAt: e.firstOpenAt, lastActivityAt: e.lastActivityAt, repliedAt: e.repliedAt || null, thread: dec(e.gmailThreadId), forward: !!e.possibleForward })),
    // Threads where the sender tracks you, and senders known to (from the tracker's scan too).
    trackedThreads: marks.map((m) => ({ thread: m.thread_id, from: m.from_addr, category: m.category, vendors: JSON.parse(m.vendors || '[]'), readReceipt: !!m.read_receipt })),
    senders: [...state.senders].slice(0, 400).map(([email, vendors]) => ({ email, vendors })),
    stats: state.stats ? { checked: state.stats.checked, tracked: state.stats.tracked, person: state.stats.person, bulk: state.stats.bulk, vendors: (state.stats.vendors || []).slice(0, 8) } : null
  };
}
// One sent email with its timeline (Inbox, Tracking, a row opened).
export const trackedEmail = (id) => call('GET', `/api/emails/${encodeURIComponent(id)}`);
