// Email drafts: the ones in each account's Drafts folder (yours, or written
// for you by an assistant through your Gmail), shown in the Inbox thread they
// answer, editable there. Save puts the new version in Drafts in place of the
// old (so Gmail on the phone shows the same), Send sends it in its thread and
// takes the draft away, Discard moves it to the account's Trash (Gmail keeps
// it there 30 days). Nothing is sent unless the person presses Send.
//
// Read every few minutes with the rest of the mail (lib/gmail.js pollGmail);
// kept in their own table so a draft never counts as mail you sent.
import MailComposer from 'nodemailer/lib/mail-composer';
import { simpleParser } from 'mailparser';
import { db } from './db.js';
import { accounts, threadKey, mailParts } from './gmail.js';
import { htmlToText } from './conversation.js';

db.exec(`CREATE TABLE IF NOT EXISTS drafts (
  account TEXT NOT NULL, msg_id TEXT NOT NULL, uid INTEGER, thread_id TEXT,
  message_id TEXT, in_reply_to TEXT, refs TEXT,
  from_addr TEXT, to_addrs TEXT, cc_addrs TEXT, subject TEXT, text TEXT, date INTEGER,
  PRIMARY KEY (account, msg_id)
)`);

const MAX = 50, TEXT_MAX = 20000;
const list = (a) => (a || []).map((x) => x.address).filter(Boolean).join(', ');
const boxOf = (boxes, use, names) => boxes.find((b) => b.specialUse === use)?.path || boxes.find((b) => names.test(b.name))?.path || null;

async function connect(acct, fn) {
  const client = mailParts.imapClient(acct);
  await client.connect();
  try { return await fn(client, await client.list()); } finally { await client.logout().catch(() => {}); }
}

// Read one account's drafts (the newest MAX) into the table, replacing what was there.
// Drafts come and go while they are read (deleted or saved in Gmail at that
// moment), which can fail the read: it is tried once more before giving up.
export async function pollDrafts(acct) {
  let rows;
  try { rows = await readDrafts(acct); }
  catch { await new Promise((r) => setTimeout(r, 3000)); rows = await readDrafts(acct); }
  return storeDrafts(acct, rows);
}
async function readDrafts(acct) {
  const gmail = mailParts.isGmail(acct);
  return connect(acct, async (client, boxes) => {
    const path = boxOf(boxes, '\\Drafts', /^drafts?$/i) || (gmail ? '[Gmail]/Drafts' : null);
    if (!path) return [];
    const lock = await client.getMailboxLock(path, { readOnly: true });
    try {
      const out = [];
      const uids = ((await client.search({ all: true }, { uid: true })) || []).slice(-MAX);
      if (!uids.length) return out;
      for await (const m of client.fetch(uids, { uid: true, envelope: true, threadId: gmail, source: true, internalDate: true }, { uid: true })) {
        const p = await simpleParser(m.source).catch(() => null);   // an HTML-only draft's words come from its HTML, below
        const env = m.envelope || {};
        const refs = String(p?.references ? [].concat(p.references).map((r) => `<${String(r).replace(/[<>]/g, '')}>`).join(' ') : '');
        const inReplyTo = p?.inReplyTo || '';
        const id = m.emailId || env.messageId || `d-${m.uid}`;
        out.push({
          msg_id: String(id), uid: m.uid, thread_id: gmail ? String(m.threadId || id) : threadKey(env.messageId, inReplyTo, refs),
          message_id: env.messageId || '', in_reply_to: inReplyTo, refs,
          from_addr: list(env.from), to_addrs: list(env.to), cc_addrs: list(env.cc), subject: env.subject || '',
          text: String(p?.text || (p?.html ? htmlToText(p.html) : '')).replace(/\r/g, '').trim().slice(0, TEXT_MAX), date: new Date(env.date || m.internalDate || Date.now()).getTime()
        });
      }
      return out;
    } finally { lock.release(); }
  });
}
function storeDrafts(acct, rows) {
  const before = JSON.stringify(db.prepare('SELECT msg_id, date FROM drafts WHERE account = ? ORDER BY msg_id').all(acct.email));
  db.prepare('DELETE FROM drafts WHERE account = ?').run(acct.email);
  const ins = db.prepare(`INSERT OR REPLACE INTO drafts (account, msg_id, uid, thread_id, message_id, in_reply_to, refs, from_addr, to_addrs, cc_addrs, subject, text, date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const r of rows) ins.run(acct.email, r.msg_id, r.uid, r.thread_id, r.message_id, r.in_reply_to, r.refs, r.from_addr, r.to_addrs, r.cc_addrs, r.subject, r.text, r.date);
  // A draft read as mail before drafts were their own thing: not mail you sent.
  const del = db.prepare('DELETE FROM mail WHERE account = ? AND msg_id = ?');
  for (const r of rows) del.run(acct.email, r.msg_id);
  return JSON.stringify(db.prepare('SELECT msg_id, date FROM drafts WHERE account = ? ORDER BY msg_id').all(acct.email)) !== before;
}

// For the board: each draft, and the Inbox conversation it belongs to (when that is one Switchboard has).
export function drafts() {
  const known = db.prepare('SELECT 1 FROM mail WHERE account = ? AND thread_id = ? LIMIT 1');
  const mine = new Set(accounts().map((a) => a.email));
  return db.prepare('SELECT * FROM drafts ORDER BY date DESC LIMIT 200').all().filter((d) => mine.has(d.account)).map((d) => ({
    key: `draft:${d.account}:${d.msg_id}`, account: d.account, id: d.msg_id, from: d.from_addr, to: d.to_addrs, cc: d.cc_addrs, subject: d.subject, text: d.text, date: d.date,
    thread: d.thread_id && known.get(d.account, d.thread_id) ? `mail:${d.account}:${d.thread_id}` : null
  }));
}

const row = (account, id) => db.prepare('SELECT * FROM drafts WHERE account = ? AND msg_id = ?').get(account, id);
const clean = (f = {}) => ({ to: String(f.to || '').trim().slice(0, 2000), cc: String(f.cc || '').trim().slice(0, 2000), subject: String(f.subject || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 500), text: String(f.text || '').replace(/\r/g, '').slice(0, 200000) });
const ADDRS = /^\s*([^,\s@]+@[^,\s@]+\.[^,\s@]+)(\s*,\s*[^,\s@]+@[^,\s@]+\.[^,\s@]+)*\s*$/;
function check(f, sending) {
  if (sending && !f.to) throw new Error('Add who it goes to first.');
  for (const [k, v] of [['To', f.to], ['Cc', f.cc]]) if (v && !ADDRS.test(v)) throw new Error(`${k} has something that is not an email address. Separate addresses with commas.`);
  if (sending && !f.text.trim()) throw new Error('Write something first.');
}
const sender = (acct, d) => {
  const mine = [acct.email, ...(acct.aliases || [])].map((a) => a.toLowerCase());
  return mine.includes(String(d.from_addr || '').toLowerCase()) ? d.from_addr : acct.email;
};

// The draft's old version out of Drafts, into Trash: by its Gmail id where there is one.
async function trashDraft(client, boxes, acct, d) {
  const path = boxOf(boxes, '\\Drafts', /^drafts?$/i) || '[Gmail]/Drafts';
  const trash = boxOf(boxes, '\\Trash', /^(trash|deleted items|deleted messages|bin)$/i);
  const lock = await client.getMailboxLock(path);
  try {
    const uids = mailParts.isGmail(acct) && /^\d+$/.test(d.msg_id) ? await client.search({ emailId: d.msg_id }, { uid: true }) : d.uid ? [d.uid] : [];
    if (!uids?.length) return false;
    if (trash) await client.messageMove(uids, trash, { uid: true });
    else await client.messageDelete(uids, { uid: true });
    return true;
  } finally { lock.release(); }
}

export async function saveDraft(email, id, fields) {
  const acct = mailParts.account(email), d = row(email, id);
  if (!acct || !d) throw new Error('That draft is gone. It may have been sent or deleted somewhere else; the list updates in a moment.');
  const f = clean(fields); check(f, false);
  const raw = await new MailComposer({ from: sender(acct, d), to: f.to || undefined, cc: f.cc || undefined, subject: f.subject, text: f.text,
    inReplyTo: d.in_reply_to || undefined, references: d.refs || undefined }).compile().build();
  await connect(acct, async (client, boxes) => {
    const path = boxOf(boxes, '\\Drafts', /^drafts?$/i) || '[Gmail]/Drafts';
    await client.append(path, raw, ['\\Draft', '\\Seen']);
    await trashDraft(client, boxes, acct, d);
  });
  await pollDrafts(acct);
}

export async function sendDraft(email, id, fields) {
  const acct = mailParts.account(email), d = row(email, id);
  if (!acct || !d) throw new Error('That draft is gone. It may have been sent or deleted somewhere else; the list updates in a moment.');
  const f = clean(fields); check(f, true);
  const from = sender(acct, d);
  await mailParts.transport(acct).sendMail({ from, to: f.to, cc: f.cc || undefined, subject: f.subject, inReplyTo: d.in_reply_to || undefined, references: d.refs || undefined, ...mailParts.bodyFor(from, f.text) });
  // Sent: it shows in the thread at once, and the draft leaves Drafts (into Trash).
  if (d.thread_id) {
    db.prepare(`INSERT OR REPLACE INTO mail (account, msg_id, thread_id, uid, from_name, from_addr, to_addrs, subject, snippet, date, inbox, unread, from_me, bulk, kind, space)
      VALUES (?, ?, ?, NULL, 'You', ?, ?, ?, ?, ?, 1, 0, 1, 0, 'mail', NULL)`).run(email, 'local-' + Date.now(), d.thread_id, from.toLowerCase(), f.to, f.subject, f.text.slice(0, 600), Date.now());
  }
  db.prepare('DELETE FROM drafts WHERE account = ? AND msg_id = ?').run(email, id);
  await connect(acct, (client, boxes) => trashDraft(client, boxes, acct, d)).catch(() => {});
  return { thread: d.thread_id ? `mail:${email}:${d.thread_id}` : null };
}

export async function discardDraft(email, id) {
  const acct = mailParts.account(email), d = row(email, id);
  if (!acct || !d) return;
  await connect(acct, (client, boxes) => trashDraft(client, boxes, acct, d));
  db.prepare('DELETE FROM drafts WHERE account = ? AND msg_id = ?').run(email, id);
}

// Every account, after each read of the mail. True when the list changed.
let polling = false;
// Part of the email connection (its setup entry is "email"), not one of its own.
export async function readAllDrafts() {
  if (polling) return false;
  polling = true;
  let changed = false;
  try {
    for (const acct of accounts()) {
      if (!acct.email || !acct.password) continue;
      try { if (await pollDrafts(acct)) changed = true; } catch (e) { console.error('drafts', acct.email, e.message, e.responseText || e.serverResponseCode || ''); }
    }
  } finally { polling = false; }
  return changed;
}
