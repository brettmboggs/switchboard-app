// Team chat (Nov 5 2026): a channel for each shared project, and one-to-one
// chats with the people you share a project with. They show in the Inbox like
// any conversation (public/js/convo.js, public/js/teamchat.js), with what Teams
// cannot give us: "seen" per message, who is typing, edit and delete your own,
// reply to a message, @mentions and pins.
//
// How it holds (sync-worker/src/chat.js says what the service keeps):
// - Every line is sealed here before it leaves. A project channel uses a key
//   made from the project key (lib/share.js), one per epoch, so someone removed
//   from the project reads nothing written after; a one-to-one chat uses a key
//   both computers make from their own sharing keys (X25519) and nobody else can.
// - Every line is signed (Ed25519) by its writer, with the signing key the
//   project's signed roster and policy give for them. A line whose signature
//   does not fit, or that says it is from someone other than the account the
//   service says sent it, is dropped. Only the writer's own edit or delete is
//   believed, so nobody (and no service) can change what someone else said.
// - The service stores an append-only log of sealed lines, how far each person
//   has read (for "seen"), and passes on "typing" without keeping it.
// - A desktop alert, and a push to the phone that says only "A teammate wrote
//   to you.", come for a one-to-one message or an @mention of you; never for
//   every line in a busy channel (Settings, Notifications, "A teammate writes").
import { createPublicKey, diffieHellman, hkdfSync, randomBytes, sign, verify } from 'node:crypto';
import { db, getSetting } from './db.js';
import { call, seal, unseal } from './sync.js';
import { myKey, chatAccess, shareSoon } from './share.js';
import { spaces } from './spaces.js';
import { alert } from './notify.js';
import { friendlyError } from './friendly.js';

db.exec(`CREATE TABLE IF NOT EXISTS chat_lines (
  chan TEXT NOT NULL, seq INTEGER NOT NULL, by TEXT, at INTEGER, ev TEXT,
  PRIMARY KEY (chan, seq)
);
CREATE TABLE IF NOT EXISTS chat_keys (share_id TEXT NOT NULL, epoch INTEGER NOT NULL, k TEXT NOT NULL, PRIMARY KEY (share_id, epoch));
CREATE TABLE IF NOT EXISTS chat_peers (email TEXT PRIMARY KEY, pub TEXT NOT NULL, sign_pub TEXT);`);

const lc = (s) => String(s || '').trim().toLowerCase();
const stable = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v)) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : 1)) : v);
const pubOf = (b64) => createPublicKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'spki' });
export const MAX_TEXT = 8000;
export const EMOJI = /^(\p{Extended_Pictographic}|\p{Emoji_Presentation}|[‍️\u{1F3FB}-\u{1F3FF}]){1,8}$/u;
const TYPING_FOR = 6000, ALERT_FRESH = 10 * 60e3, PULL_FRESH = 20e3;

let channels = new Map();   // chan -> { chan, kind: 'project' | 'direct', share, with, members, last, at, seen: {email: seq} }
const typing = new Map();   // chan -> Map(email -> until)
const pulledAt = new Map(); // chan -> when it was last fetched
const views = new Map();    // chan -> { n, view } built from the lines, rebuilt when lines come in
let state = { at: 0, ok: null, error: null };
let changedFn = () => {}, alertFn = alert;
export function onChatAlert(fn) { alertFn = fn; }   // tests

function account() {
  const s = getSetting('sync', null);
  if (!s?.token || !s.key) throw new Error('Team chat needs your Switchboard account. Sign in, in Settings, Account.');
  return s;
}
const me = () => lc(getSetting('sync', null)?.email);
async function req(path, opts = {}) {
  const s = account();
  const r = await call(s.server, path, { ...opts, token: s.token });
  if (r.status === 401) throw new Error('Signed out on the sync service. Sign in again in Settings, Account.');
  return r;
}

// ---- who is who: names and signing keys from the projects you are in
function people() {
  const out = new Map();
  for (const a of chatAccess()) for (const m of a.members) if (!out.has(m.email)) out.set(m.email, { ...m, space: a.space });
  return out;
}
const nameOf = (email, ppl = people()) => lc(email) === me() ? 'You' : ppl.get(lc(email))?.name || String(email || 'Someone').split('@')[0];

// ---- keys
const hk = (ikm, salt, info) => Buffer.from(hkdfSync('sha256', ikm, Buffer.from(salt), Buffer.from(info), 32)).toString('hex');
// A project channel's key for one epoch: made from the project key, kept so earlier messages stay readable.
function projectKeys() {
  for (const a of chatAccess()) db.prepare('INSERT OR IGNORE INTO chat_keys (share_id, epoch, k) VALUES (?, ?, ?)').run(a.id, a.epoch, hk(Buffer.from(a.key, 'hex'), 'switchboard-chat', a.id));
}
const keyOfEpoch = (share, epoch) => db.prepare('SELECT k FROM chat_keys WHERE share_id = ? AND epoch = ?').get(share, epoch)?.k || null;
// Someone's sharing keys, kept the first time they are seen. Their signing key
// must be the one the project's signed roster or policy gives, so a service
// that swapped keys would have to forge a signature it cannot make.
async function peerKeys(email) {
  const e = lc(email);
  const pinned = db.prepare('SELECT pub, sign_pub FROM chat_peers WHERE email = ?').get(e);
  if (pinned) return pinned;
  const r = await req(`/v1/share-key/lookup?email=${encodeURIComponent(e)}`);
  if (r.status !== 200) throw new Error(r.json.error || 'Could not find their sharing key.');
  const known = people().get(e)?.signPub;
  if (!known || known !== r.json.signPub) throw new Error(`The sync service gave a key for ${e} that their projects do not vouch for, so nothing was sent.`);
  db.prepare('INSERT OR REPLACE INTO chat_peers (email, pub, sign_pub) VALUES (?, ?, ?)').run(e, r.json.pub, r.json.signPub);
  return { pub: r.json.pub, sign_pub: r.json.signPub };
}
const directKeys = new Map();   // email -> key
async function directKey(email) {
  const e = lc(email);
  if (directKeys.has(e)) return directKeys.get(e);
  const mk = await myKey(), them = await peerKeys(e);
  const shared = diffieHellman({ privateKey: mk.priv, publicKey: pubOf(them.pub) });
  const k = hk(shared, [mk.pub, them.pub].sort().join(''), 'switchboard-chat-dm');
  directKeys.set(e, k);
  return k;
}
// The key a line is sealed with: [epoch, key]. A project channel uses its newest epoch.
async function keyFor(c) {
  if (c.kind === 'direct') return [0, await directKey(c.with)];
  const a = chatAccess().find((x) => x.id === c.share);
  if (!a) throw new Error('This project\'s keys are not here yet. Try again in a moment.');
  projectKeys();
  return [a.epoch, keyOfEpoch(a.id, a.epoch)];
}
function signPubFor(email) {
  const e = lc(email);
  if (e === me()) return null;   // filled in by the caller from myKey()
  return people().get(e)?.signPub || db.prepare('SELECT sign_pub FROM chat_peers WHERE email = ?').get(e)?.sign_pub || null;
}
const checks = (ev, sig, signPub) => { try { return !!signPub && verify(null, Buffer.from(stable(ev)), pubOf(signPub), Buffer.from(String(sig || ''), 'base64')); } catch { return false; } };

// ---- reading lines in: open, check, keep
// What a line may carry, whatever a sender put in it.
function cleanEv(ev) {
  const t = ev?.t, id = typeof ev?.id === 'string' && /^[0-9a-f]{16,32}$/.test(ev.id) ? ev.id : null, ref = typeof ev?.ref === 'string' && /^[0-9a-f]{16,32}$/.test(ev.ref) ? ev.ref : null;
  const mentions = Array.isArray(ev?.mentions) ? ev.mentions.filter((x) => typeof x === 'string').map(lc).slice(0, 30) : [];
  if (t === 'msg' && id) {
    const pics = Array.isArray(ev.pics) ? ev.pics.filter((p) => /^image\/(png|jpeg|gif|webp)$/.test(p?.type) && typeof p.data === 'string' && /^[A-Za-z0-9+/=]+$/.test(p.data)).slice(0, 6) : [];
    return { t, id, text: String(ev.text || '').slice(0, MAX_TEXT), pics, reply: ref, mentions };
  }
  if (t === 'edit' && ref) return { t, ref, text: String(ev.text || '').slice(0, MAX_TEXT), mentions };
  if (t === 'del' && ref) return { t, ref };
  if (t === 'react' && ref && typeof ev.emoji === 'string' && EMOJI.test(ev.emoji)) return { t, ref, emoji: ev.emoji, on: !!ev.on };
  if (t === 'pin' && ref) return { t, ref, on: !!ev.on };
  return null;
}
async function openLine(c, line) {
  const dot = String(line.body || '').indexOf('.');
  const epoch = Number(String(line.body).slice(0, dot)), sealed = String(line.body).slice(dot + 1);
  let key;
  if (c.kind === 'direct') key = await directKey(c.with);
  else {
    key = keyOfEpoch(c.share, epoch);
    // A newer key than this computer has: the project was given new keys; get them first.
    if (!key && epoch >= (chatAccess().find((x) => x.id === c.share)?.epoch || 0)) return { wait: true };
  }
  if (!key) return { ev: null };   // from before you joined
  let box; try { box = unseal(sealed, key); } catch { return { ev: null }; }
  const ev = box?.ev;
  if (!ev || ev.chan !== c.chan || lc(ev.by) !== lc(line.from)) return { ev: null };
  const signPub = lc(ev.by) === me() ? (await myKey()).signPub : signPubFor(ev.by);
  if (!checks(ev, box.sig, signPub)) return { ev: null };
  const clean = cleanEv(ev);
  return { ev: clean ? { ...clean, at: Number(ev.at) || line.at } : null };
}

// Fetch a channel's new lines from the service and keep them. Alerts for fresh
// one-to-one messages and @mentions of you.
async function pull(chan) {
  const c = channels.get(chan);
  if (!c) return 0;
  pulledAt.set(chan, Date.now());
  let after = db.prepare('SELECT MAX(seq) AS n FROM chat_lines WHERE chan = ?').get(chan).n || 0, got = 0;
  const put = db.prepare('INSERT OR IGNORE INTO chat_lines (chan, seq, by, at, ev) VALUES (?, ?, ?, ?, ?)');
  for (let page = 0; page < 20; page++) {
    const r = await req(`/v1/chat/${chan}?after=${after}`);
    if (r.status !== 200) throw new Error(r.json.error || 'Could not get the chat.');
    c.seen = r.json.seen || c.seen;
    let stop = false;
    for (const line of r.json.messages || []) {
      const o = await openLine(c, line);
      if (o.wait) { stop = true; shareSoon(0); break; }
      put.run(chan, line.seq, lc(line.from), line.at, o.ev ? JSON.stringify(o.ev) : null);
      after = line.seq; got++;
      if (o.ev?.t === 'msg' && lc(line.from) !== me() && Date.now() - o.ev.at < ALERT_FRESH && (c.kind === 'direct' || o.ev.mentions.includes(me()))) {
        const who = nameOf(line.from), where = c.kind === 'direct' ? '' : ` · ${projectName(c)}`;
        alertFn('chat', `${who}${where}`, o.ev.text.slice(0, 140) || 'A picture');
      }
      // Whoever wrote last has read up to there.
      typing.get(chan)?.delete(lc(line.from));
    }
    if (stop || !r.json.more) break;
  }
  if (got) views.delete(chan);
  return got;
}

// ---- the conversation, built from its lines
function build(chan) {
  const n = db.prepare('SELECT COUNT(*) AS n FROM chat_lines WHERE chan = ?').get(chan).n;
  const have = views.get(chan);
  if (have && have.n === n) return have.view;
  const msgs = new Map(), order = [];
  let unreadable = 0;
  for (const row of db.prepare('SELECT seq, by, at, ev FROM chat_lines WHERE chan = ? ORDER BY seq').all(chan)) {
    let ev = null; try { ev = row.ev ? JSON.parse(row.ev) : null; } catch {}
    if (!ev) { unreadable++; continue; }
    if (ev.t === 'msg') {
      if (msgs.has(ev.id)) continue;
      const m = { id: ev.id, seq: row.seq, by: row.by, at: ev.at, text: ev.text, pics: ev.pics.length, reply: ev.reply, mentions: ev.mentions, reactions: new Map(), edited: 0, deleted: false, pinned: null };
      msgs.set(ev.id, m); order.push(m);
      continue;
    }
    const m = msgs.get(ev.ref);
    if (!m) continue;
    // Only the writer's own edit or delete counts.
    if (ev.t === 'edit' && row.by === m.by && !m.deleted) { m.text = ev.text; m.mentions = ev.mentions; m.edited = ev.at; }
    else if (ev.t === 'del' && row.by === m.by) { m.deleted = true; m.text = ''; m.pics = 0; m.reactions.clear(); m.pinned = null; }
    else if (ev.t === 'react' && !m.deleted) { const s = m.reactions.get(ev.emoji) || new Set(); if (ev.on) s.add(row.by); else s.delete(row.by); if (s.size) m.reactions.set(ev.emoji, s); else m.reactions.delete(ev.emoji); }
    else if (ev.t === 'pin' && !m.deleted) m.pinned = ev.on ? { by: row.by, at: ev.at } : null;
  }
  const view = { msgs: order, byId: msgs, unreadable };
  views.set(chan, { n, view });
  return view;
}
const snippetOf = (m) => m.deleted ? 'Deleted a message' : (m.text || (m.pics ? 'A picture' : '')).replace(/\s+/g, ' ').slice(0, 300);
const projectName = (c) => spaces().find((s) => s.id === chatAccess().find((a) => a.id === c.share)?.space)?.name || 'Shared project';
const spaceOfChan = (c, ppl = people()) => c.kind === 'project' ? chatAccess().find((a) => a.id === c.share)?.space || 'personal' : ppl.get(lc(c.with))?.space || 'personal';
const keyOf = (chan) => 'team:' + chan;
const chanOf = (key) => { const m = String(key || '').match(/^team:([pd][0-9a-f]{24})$/); return m ? m[1] : null; };
export const isChatKey = (key) => !!chanOf(key);

// Channels this computer can use: a project you are in whose keys are here, or a teammate.
function usable() {
  const ids = new Set(chatAccess().map((a) => a.id)), ppl = people();
  return [...channels.values()].filter((c) => c.kind === 'project' ? ids.has(c.share) : ppl.has(lc(c.with)));
}

// For the board: conversations waiting on you (the last message is someone
// else's) and ones you answered in the last week, shaped like the Inbox's others.
export function chatThreads() {
  const waiting = [], recent = [], ppl = people(), mine = me();
  for (const c of usable()) {
    const v = build(c.chan);
    const last = [...v.msgs].reverse().find((m) => !m.deleted) || v.msgs[v.msgs.length - 1];
    if (!last) continue;
    const who = c.kind === 'project' ? projectName(c) : nameOf(c.with, ppl);
    const seen = c.seen?.[mine] || 0;
    const fromOther = last.by !== mine;
    const t = {
      key: keyOf(c.chan), kind: 'team', who, from: fromOther ? nameOf(last.by, ppl) : 'You', subject: c.kind === 'project' ? 'Project chat' : 'Team chat',
      snippet: (c.kind === 'project' && fromOther ? nameOf(last.by, ppl) + ': ' : fromOther ? '' : 'You: ') + snippetOf(last),
      date: last.at, unread: v.msgs.some((m) => m.by !== mine && m.seq > seen), space: spaceOfChan(c, ppl), count: 1, ...(fromOther ? {} : { replied: true })
    };
    if (fromOther) waiting.push(t); else if (Date.now() - last.at < 7 * 86400e3) recent.push(t);
  }
  return { waiting, recent };
}

// For the page: every chat you can open (to start one), and whether it works.
export function chatBoard() {
  const ppl = people();
  const list = usable().map((c) => ({ key: keyOf(c.chan), kind: c.kind, who: c.kind === 'project' ? projectName(c) : nameOf(c.with, ppl), space: spaceOfChan(c, ppl), last: c.last }))
    .sort((a, b) => (a.kind === b.kind ? a.who.localeCompare(b.who) : a.kind === 'project' ? -1 : 1));
  return { channels: list, ok: state.ok, error: state.error };
}

// One open conversation, for convo.js: the newest `limit` messages, oldest first.
export async function chatConversation(key, limit = 40) {
  const chan = chanOf(key), c = chan && channels.get(chan);
  if (!c) throw new Error('That chat is not here. It may be a project you left.');
  // Fetched on open, and again when it has been a while (new lines also arrive over the relay).
  if (Date.now() - (pulledAt.get(chan) || 0) > PULL_FRESH) { try { await pull(chan); } catch {} }
  const v = build(chan), ppl = people(), mine = me();
  const n = Math.max(10, Math.min(400, Number(limit) || 40));
  const shown = v.msgs.slice(-n);
  const others = Object.entries(c.seen || {}).filter(([e]) => e !== mine);
  // Each person's "Seen" sits under the newest of your messages they have read; hovering any shows everyone.
  const placed = new Map();
  for (const [e, s] of others) { const at = [...shown].reverse().find((m) => m.by === mine && !m.deleted && m.seq <= s); if (at) placed.set(at.id, [...(placed.get(at.id) || []), nameOf(e, ppl)]); }
  const messages = shown.map((m) => ({
    id: m.id, seq: m.seq, from_me: m.by === mine ? 1 : 0, from_name: nameOf(m.by, ppl), text: m.deleted ? '' : m.text, date: m.at,
    pictures: Array.from({ length: m.pics }, (_, i) => `/api/chat/picture?key=${encodeURIComponent(key)}&id=${m.id}&n=${i}`),
    reactions: [...m.reactions].map(([emoji, who]) => ({ emoji, n: who.size, mine: who.has(mine), who: [...who].map((e) => nameOf(e, ppl)) })),
    edited: m.edited || 0, deleted: m.deleted, pinned: !!m.pinned, mention: m.mentions.includes(mine),
    reply: m.reply && v.byId.get(m.reply) ? (({ id, by, text, deleted, pics }) => ({ id, from_name: nameOf(by, ppl), text: deleted ? 'Deleted message' : (text || (pics ? 'A picture' : '')).slice(0, 160) }))(v.byId.get(m.reply)) : null,
    seen: placed.get(m.id) || [], seenBy: m.by === mine ? others.filter(([, s]) => s >= m.seq).map(([e]) => nameOf(e, ppl)) : []
  }));
  const now = Date.now();
  const typers = [...(typing.get(chan) || new Map())].filter(([e, until]) => until > now && e !== mine).map(([e]) => nameOf(e, ppl));
  const members = c.kind === 'project' ? (chatAccess().find((a) => a.id === c.share)?.members || []).filter((m) => m.email !== mine).map((m) => ({ email: m.email, name: m.name })) : [{ email: lc(c.with), name: nameOf(c.with, ppl) }];
  const pins = v.msgs.filter((m) => m.pinned).map((m) => ({ id: m.id, from_name: nameOf(m.by, ppl), text: snippetOf(m).slice(0, 160), by: nameOf(m.pinned.by, ppl) }));
  return { messages, more: v.msgs.length > shown.length, typing: typers, members, pins, unreadable: v.unreadable, last: v.msgs[v.msgs.length - 1]?.seq || 0, seenUpTo: c.seen?.[mine] || 0 };
}
// A picture in a message, for <img>: { type, data (Buffer) } or null.
export function chatPicture(key, id, n) {
  const chan = chanOf(key);
  if (!chan) return null;
  const hex = String(id).replace(/[^0-9a-f]/g, '');
  const row = hex && db.prepare('SELECT ev FROM chat_lines WHERE chan = ? AND ev LIKE ?').get(chan, `{"t":"msg","id":"${hex}"%`);
  let ev = null; try { ev = JSON.parse(row?.ev || 'null'); } catch {}
  const m = build(chan).byId.get(String(id));
  const p = ev?.pics?.[Number(n) || 0];
  return p && m && !m.deleted ? { type: p.type, data: Buffer.from(p.data, 'base64') } : null;
}

// ---- writing: seal, sign, send; then fetch, so it shows where the service put it
async function post(chan, ev) {
  const c = channels.get(chan);
  if (!c) throw new Error('That chat is not here. It may be a project you left.');
  const [epoch, key] = await keyFor(c);
  if (!key) throw new Error('This project\'s keys are not here yet. Try again in a moment.');
  const full = { ...ev, chan, by: me(), at: Date.now() };
  const sig = sign(null, Buffer.from(stable(full)), (await myKey()).signPriv).toString('base64');
  const r = await req(`/v1/chat/${chan}`, { method: 'POST', body: { body: `${epoch}.${seal({ ev: full, sig }, key)}` } });
  if (r.status !== 200) throw new Error(r.json.error || 'The message did not go. Try again.');
  await pull(chan);
  changedFn();
  return r.json.seq;
}
// @Name in the text, for the people in that chat: their emails.
export function mentionsIn(text, members) {
  const t = String(text || '').toLowerCase(), out = [];
  for (const m of members) {
    const names = [m.name, String(m.name || '').split(/\s+/)[0], m.email.split('@')[0]].filter(Boolean).map((x) => '@' + x.toLowerCase());
    if (names.some((n) => new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\p{N}])', 'u').test(t))) out.push(m.email);
  }
  return out;
}
const membersOf = (c) => c.kind === 'project' ? (chatAccess().find((a) => a.id === c.share)?.members || []) : [{ email: lc(c.with), name: nameOf(c.with) }];

export async function sendChat(key, { text = '', images = [], reply = null } = {}) {
  const chan = chanOf(key), c = chan && channels.get(chan);
  if (!c) throw new Error('That chat is not here. It may be a project you left.');
  const body = String(text || '').trim().slice(0, MAX_TEXT);
  const pics = (Array.isArray(images) ? images : []).filter((im) => /^image\/(png|jpeg|gif|webp)$/.test(im?.type) && typeof im.data === 'string' && /^[A-Za-z0-9+/=]+$/.test(im.data)).slice(0, 6);
  if (!body && !pics.length) throw new Error('Write something first.');
  if (pics.reduce((n, p) => n + p.data.length, 0) > 480e3) throw new Error('Those pictures are too big to send together. Send one or two at a time.');
  const id = randomBytes(12).toString('hex');
  const ref = reply && build(chan).byId.has(String(reply)) ? String(reply) : undefined;
  const seq = await post(chan, { t: 'msg', id, text: body, pics, ...(ref ? { ref } : {}), mentions: mentionsIn(body, membersOf(c)) });
  return { id, seq };
}
// Edit or delete your own message, react, pin.
export async function chatAct(key, { what, id, text, emoji, on }) {
  const chan = chanOf(key), c = chan && channels.get(chan);
  if (!c) throw new Error('That chat is not here. It may be a project you left.');
  const m = build(chan).byId.get(String(id));
  if (!m || m.deleted) throw new Error('That message is gone.');
  if ((what === 'edit' || what === 'delete') && m.by !== me()) throw new Error('You can only change your own messages.');
  if (what === 'edit') {
    const body = String(text || '').trim().slice(0, MAX_TEXT);
    if (!body && !m.pics) throw new Error('Write something, or delete the message instead.');
    if (body === m.text) return { ok: true };
    await post(chan, { t: 'edit', ref: m.id, text: body, mentions: mentionsIn(body, membersOf(c)) });
  } else if (what === 'delete') await post(chan, { t: 'del', ref: m.id });
  else if (what === 'react') {
    if (typeof emoji !== 'string' || !EMOJI.test(emoji)) throw new Error('Pick one of the reactions.');
    await post(chan, { t: 'react', ref: m.id, emoji, on: !!on });
  } else if (what === 'pin') await post(chan, { t: 'pin', ref: m.id, on: !!on });
  else throw new Error('Unknown action.');
  return { ok: true };
}
// Read up to the newest message: the others see it as "Seen".
export async function markSeen(key) {
  const chan = chanOf(key), c = chan && channels.get(chan);
  if (!c) return { ok: false };
  const last = db.prepare('SELECT MAX(seq) AS n FROM chat_lines WHERE chan = ?').get(chan).n || 0;
  if (!last || (c.seen?.[me()] || 0) >= last) return { ok: true };
  const r = await req(`/v1/chat/${chan}/seen`, { method: 'POST', body: { seq: last } });
  if (r.status !== 200) throw new Error(r.json.error || 'Could not mark it read.');
  c.seen = { ...(c.seen || {}), [me()]: last };
  changedFn();
  return { ok: true };
}
// "Typing…" for the others: at most every four seconds per chat.
const typedAt = new Map();
export async function sendTyping(key) {
  const chan = chanOf(key);
  if (!chan || !channels.has(chan) || Date.now() - (typedAt.get(chan) || 0) < 4000) return;
  typedAt.set(chan, Date.now());
  await req(`/v1/chat/${chan}/typing`, { method: 'POST', body: {} }).catch(() => {});
}

// ---- keeping up
async function listChannels() {
  const r = await req('/v1/chat');
  if (r.status !== 200) throw new Error(r.json.error || 'Could not reach the sync service.');
  const next = new Map();
  for (const c of r.json.channels || []) next.set(c.chan, { ...c, with: c.with ? lc(c.with) : undefined, seen: c.seen || {} });
  channels = next;
}
let busy = false;
export async function syncChat() {
  const s = getSetting('sync', null);
  if (!s?.token || !s.key || busy) return 0;
  busy = true;
  let got = 0;
  try {
    await myKey();
    projectKeys();
    await listChannels();
    for (const c of usable()) {
      const have = db.prepare('SELECT MAX(seq) AS n FROM chat_lines WHERE chan = ?').get(c.chan).n || 0;
      if (c.last > have) got += await pull(c.chan);
    }
    state = { at: Date.now(), ok: true, error: null };
  } catch (e) {
    state = { at: Date.now(), ok: false, error: friendlyError(e, 'the sync service') };
  } finally { busy = false; }
  return got;
}

// Over the relay from the service (lib/relay.js): a new line, a read mark, or someone typing.
export function chatNotice(msg) {
  const chan = String(msg?.chan || '');
  if (!/^[pd][0-9a-f]{24}$/.test(chan)) return;
  if (msg.typing) {
    if (!typing.has(chan)) typing.set(chan, new Map());
    typing.get(chan).set(lc(msg.typing), Date.now() + TYPING_FOR);
    return;
  }
  const c = channels.get(chan);
  // A channel this computer does not know yet (a new project, a new teammate): list them again.
  const go = c ? pull(chan) : syncChat();
  return Promise.resolve(go).then(() => changedFn()).catch(() => {});
}

export function startChat(changed) {
  changedFn = changed || changedFn;
  setTimeout(() => syncChat().then((n) => { if (n) changedFn(); }), 6000);
  setInterval(() => syncChat().then((n) => { if (n) changedFn(); }).catch(() => {}), 2 * 60e3);
}
export const _test = { reset() { channels = new Map(); typing.clear(); pulledAt.clear(); views.clear(); directKeys.clear(); }, channels: () => channels, post };
