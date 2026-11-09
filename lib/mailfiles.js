// Pictures and files in email (and Google Voice texts, which arrive as email):
// for the Inbox's conversation view (public/js/mailfiles.js). Switchboard keeps
// only a snippet of each email, so the files are listed from the mail server's
// outline of each message (IMAP BODYSTRUCTURE) when a conversation is opened,
// and a file is downloaded, just that part, when the page shows or saves it.
// Both are kept in memory a while; nothing is written to disk.
import { db } from './db.js';
import { mailParts } from './gmail.js';

// Pictures the page may show as pictures. Anything else (SVG and HTML included,
// which can carry script) is only ever a download.
export const SHOWABLE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/avif']);
// Signature logos and tracking pixels are small: inline pictures under this are left out.
const TINY = 3 * 1024;
const MAX_PART = 25 * 1024 * 1024;   // Gmail's own limit for a message

const lc = (s) => String(s || '').toLowerCase();
const nameOf = (n) => String(n.dispositionParameters?.filename || n.parameters?.name || '').replace(/[\r\n"\\/]/g, '').trim().slice(0, 200);

// The files in one message's outline: every leaf part that is not the message's
// own text (text/plain and text/html, unless marked as an attachment).
export function walkStructure(node, out = [], root = true) {
  if (!node) return out;
  if (Array.isArray(node.childNodes) && node.childNodes.length) {
    for (const c of node.childNodes) walkStructure(c, out, false);
    return out;
  }
  // A message that is only a file (no text part) is part 1.
  if (root && !node.part) node = { ...node, part: '1' };
  const type = lc(node.type);
  const attached = lc(node.disposition) === 'attachment';
  if (!attached && (type === 'text/plain' || type === 'text/html')) return out;
  if (type.startsWith('multipart/') || !node.part) return out;
  const name = nameOf(node);
  const cid = String(node.id || '').replace(/^<|>$/g, '') || null;
  const inline = !attached && (lc(node.disposition) === 'inline' || !!cid);
  const size = Number(node.size) || 0;
  // A message attached to a message, or a calendar invite: shown as a file like any other.
  if (inline && type.startsWith('image/') && size && size < TINY) return out;
  out.push({ part: String(node.part), type: type || 'application/octet-stream', name: name || (type.startsWith('image/') ? 'picture' : 'file'), size, cid, inline, picture: SHOWABLE.has(type) });
  return out;
}

// Strict checks on what the page asks for.
export const okPart = (p) => /^\d{1,3}(\.\d{1,3}){0,8}$/.test(String(p || ''));
export const okUid = (u) => /^\d{1,10}$/.test(String(u || ''));
export const knownAccount = (a) => !!mailParts.account(String(a || ''));

// One mail-server connection at a time per account: a conversation shows several
// pictures at once, and Gmail turns away too many connections at a time.
const queues = new Map();
function inMailbox(acct, fn) {
  const prev = queues.get(acct.email) || Promise.resolve();
  const run = prev.catch(() => {}).then(() => mailParts.withMailbox(acct, fn));
  queues.set(acct.email, run.catch(() => {}));
  return run;
}

const fileUrl = (acct, uid, f, dl = false) => `/api/mail/file?a=${encodeURIComponent(acct)}&u=${uid}&p=${encodeURIComponent(f.part)}${dl ? '&dl=1' : ''}`;

// The outlines already read, by account|uid (a message's parts never change).
const outlines = new Map();
const remember = (k, v) => { outlines.set(k, v); if (outlines.size > 2000) outlines.delete(outlines.keys().next().value); };

// { <msg_id>: [{ name, type, size, picture, url, download }] } for one conversation.
export async function threadFiles(email, threadId) {
  const acct = mailParts.account(email);
  if (!acct) throw Object.assign(new Error('That email account is not connected any more.'), { status: 404 });
  const rows = db.prepare('SELECT msg_id, uid FROM mail WHERE account = ? AND thread_id = ? AND uid IS NOT NULL ORDER BY date DESC LIMIT 60').all(email, threadId);
  const want = rows.filter((r) => !outlines.has(`${email}|${r.uid}`));
  if (want.length) {
    await inMailbox(acct, async (c) => {
      for await (const m of c.fetch(want.map((r) => r.uid).join(','), { uid: true, bodyStructure: true }, { uid: true })) {
        remember(`${email}|${m.uid}`, walkStructure(m.bodyStructure));
      }
    });
    // Messages the server no longer has: nothing to show.
    for (const r of want) if (!outlines.has(`${email}|${r.uid}`)) remember(`${email}|${r.uid}`, []);
  }
  const out = {};
  for (const r of rows) {
    const files = outlines.get(`${email}|${r.uid}`) || [];
    if (files.length) out[r.msg_id] = files.map((f) => ({ name: f.name, type: f.type, size: f.size, picture: f.picture, url: fileUrl(email, r.uid, f), download: fileUrl(email, r.uid, f, true) }));
  }
  return out;
}

// One part's bytes, kept a while (the page redraws a conversation often).
const parts = new Map();
export async function mailFile(email, uid, part) {
  if (!knownAccount(email) || !okUid(uid) || !okPart(part)) throw Object.assign(new Error('That file is not in your mail.'), { status: 400 });
  const k = `${email}|${uid}|${part}`;
  const hit = parts.get(k);
  if (hit) return hit;
  // Only a message Switchboard has in its list for that account.
  if (!db.prepare('SELECT 1 FROM mail WHERE account = ? AND uid = ? LIMIT 1').get(email, Number(uid))) throw Object.assign(new Error('That file is not in your mail.'), { status: 404 });
  const acct = mailParts.account(email);
  let listed = null;
  const buf = await inMailbox(acct, async (c) => {
    // The part must be one the outline lists: no reaching into a message's own text by number.
    // The outline is read again if Switchboard restarted since the conversation was opened.
    if (!outlines.has(`${email}|${uid}`)) {
      const m = await c.fetchOne(String(uid), { uid: true, bodyStructure: true }, { uid: true });
      remember(`${email}|${uid}`, m?.bodyStructure ? walkStructure(m.bodyStructure) : []);
    }
    listed = outlines.get(`${email}|${uid}`).find((f) => f.part === String(part));
    if (!listed) return null;
    const d = await c.download(String(uid), String(part), { uid: true, maxBytes: MAX_PART });
    if (!d?.content) return null;
    const chunks = []; let n = 0;
    for await (const ch of d.content) { n += ch.length; if (n > MAX_PART) break; chunks.push(ch); }
    return Buffer.concat(chunks);
  });
  if (!listed) throw Object.assign(new Error('That file is not in your mail.'), { status: 404 });
  if (!buf) throw Object.assign(new Error('The mail server did not send that file. Try again in a moment.'), { status: 502 });
  const got = { type: listed.type, name: listed.name, picture: listed.picture, buf };
  parts.set(k, got);
  let total = 0; for (const v of parts.values()) total += v.buf.length;
  while (parts.size > 1 && (parts.size > 200 || total > 120e6)) { const [kk, v] = parts.entries().next().value; parts.delete(kk); total -= v.buf.length; }
  return got;
}
