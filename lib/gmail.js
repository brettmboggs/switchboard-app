// Email over IMAP with an app password: Gmail, and any other provider (iCloud,
// Yahoo, Fastmail, work mail; see mailservers.js). Reading never marks anything
// read, moves or deletes mail; archive, mark read and send happen only on a click.
// Every few minutes it reads the last two weeks of mail for each account (Gmail:
// All Mail; others: the Inbox and Sent folders) and sorts each message into:
//   mail        a person wrote to you
//   voice-*     Google Voice texts, voicemails and missed calls (forwarded to Gmail)
//   charge      a bank or card alert with an amount
//   receipt     a receipt, invoice or renewal notice
// Threads whose newest message is from someone else and still in the inbox are
// "waiting on you".
import { readShipment, refreshDeliveries, deliveries } from './deliveries.js';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';
import { db, getSetting, setSetting } from './db.js';
import { spaceFor, spaceForAddress, spaceForPhone } from './spaces.js';
import { alert } from './notify.js';
import { friendlyError } from './friendly.js';

// Accounts live under the 'gmail' setting (its name from when Gmail was the only kind).
// An account without a kind is Gmail.
export function accounts() { return getSetting('gmail', []); }
const isGmail = (a) => (a.kind || 'gmail') === 'gmail';
const pass = (a) => String(a.password || '').replace(isGmail(a) ? /\s+/g : /^\s+|\s+$/g, '');
const imapClient = (a) => new ImapFlow({
  ...(isGmail(a) ? { host: 'imap.gmail.com', port: 993 } : { host: a.imap.host, port: a.imap.port }), secure: isGmail(a) || a.imap.port === 993,
  auth: { user: a.user || a.email, pass: pass(a) }, logger: false, socketTimeout: 60000
});
const mailName = (a) => a.name || (isGmail(a) ? 'Gmail' : 'Email');
export function saveAccounts(list) { setSetting('gmail', list); }

const status = new Map();   // email -> { at, ok, error, count }
export const gmailStatus = () => accounts().map((a) => ({ email: a.email, space: a.space, kind: a.kind || 'gmail', name: mailName(a), ...(status.get(a.email) || {}) }));

const DAYS = 14;
const BANK_SENDERS = /(chase|bankofamerica|bofa|capitalone|capital one|discover|americanexpress|aexp|citi|wellsfargo|usbank|u\.s\. bank|navyfederal|ally|synchrony|pnc|regions|commercebank|commerce bank|truist|fifththird|5\/3|centralbank|central bank|usaa|sofi|chime|venmo|cash app|square|paypal|apple card|goldman|amex|bmo|huntington|busey|firstbank|first bank|midwest bankcentre|enterprise bank|simmons|carrollton|credit union)/i;
const CHARGE_WORDS = /(transaction|purchase|charge|charged|spent|debit|withdrawal|payment (sent|to)|you (made|sent|paid)|card (was )?used)/i;
const RECEIPT_WORDS = /(receipt|invoice|your (order|subscription|plan|bill|payment)|payment (received|confirmation|successful)|renew|billing|billed|charged|thanks for (your )?(payment|purchase))/i;
const NOREPLY = /(no-?reply|do-?not-?reply|notifications?@|mailer-daemon|postmaster|bounce|alerts?@|news(letter)?@|marketing@|updates?@|info@.*(mailchimp|sendgrid))/i;
const AUTOMATED_SUBJECT = /(^\[?preview\]?\s*report domain|dmarc|^welcome to google voice)/i;
const VOICE = /^New (text message|voicemail|missed call|group message) from (.+)$/i;

// Google Voice wraps each text in links and a footer; keep just the message.
export function cleanVoice(t) {
  return String(t || '').replace(/<https?:[^>]*>/g, ' ')
    .replace(/\s*(To respond to this text message|YOUR ACCOUNT|HELP CENTER|This email was sent to you because)[\s\S]*$/i, '')
    .replace(/\s+/g, ' ').trim();
}

const money = (s) => {
  const m = s && s.match(/\$\s?([\d,]+\.\d{2})/);
  return m ? parseFloat(m[1].replace(/,/g, '')) : null;
};

function merchantFrom(text) {
  if (!text) return null;
  const m = text.match(/\b(?:at|with|to|from)\s+([A-Z0-9][A-Za-z0-9&*'.#\- ]{2,40}?)(?:\s+(?:on|for|was|has|in|using)\b|[.,\n]|$)/);
  return m ? m[1].trim() : null;
}

export function classify(env, fromAddr, fromName, unsub, body) {
  const subject = env.subject || '';
  const v = subject.match(VOICE) || (/txt\.voice\.google\.com|voice-noreply@google\.com/i.test(fromAddr) && ['', 'text message', fromName]);
  if (v) {
    const what = (v[1] || 'text message').toLowerCase();
    return { kind: what.startsWith('voicemail') ? 'voice-mail' : what.startsWith('missed') ? 'voice-call' : 'voice-text', who: (v[2] || fromName || '').trim() };
  }
  const text = subject + '\n' + (body || '');
  if (BANK_SENDERS.test(fromAddr + ' ' + fromName) && (CHARGE_WORDS.test(text)) && money(text) !== null) {
    return { kind: 'charge', amount: money(text), merchant: merchantFrom(text) };
  }
  // News about a package (shipped, out for delivery, delivered): Deliveries on Now, not Inbox or Money.
  if (readShipment({ subject, from_addr: fromAddr, from_name: fromName, snippet: body })) return { kind: 'ship', bulk: true };
  if (RECEIPT_WORDS.test(subject)) {
    return { kind: 'receipt', amount: money(text), merchant: fromName || fromAddr };
  }
  return { kind: 'mail', bulk: unsub || NOREPLY.test(fromAddr) };
}

export function snippetOf(parsed) {
  let t = parsed?.text || '';
  if (!t && parsed?.html) t = parsed.html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
  // The snippet is 600 characters, so only the start of a long body matters;
  // the cut also keeps the cleaning below quick on anything a stranger sends.
  t = t.slice(0, 12000);
  // Shops' mail often carries its stylesheet and invisible spacer characters into
  // the text. A rule is "selector { ...: ... }": one bounded class per part, never
  // overlapping ones, so a body built to make this backtrack cannot stall the server
  // (test/mail.test.js keeps it under budget).
  t = t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/[^{}\n]{0,300}\{(?=[^{}]{0,2000}:)[^{}]{0,2000}\}/g, ' ').replace(/[\u034f\u00ad\u200b-\u200d\u2060\ufeff]/g, '');
  t = t.replace(/^>.*$/gm, '').replace(/On .{5,80} wrote:[\s\S]*$/m, '').replace(/\s+/g, ' ').trim();
  return t.slice(0, 600);
}

let busy = false;
export async function pollGmail() {
  if (busy) return false;
  busy = true;
  let changed = false;
  try {
    for (const acct of accounts()) {
      if (!acct.email || !acct.password) continue;
      try {
        const n = await pollAccount(acct);
        status.set(acct.email, { at: Date.now(), ok: true, error: null, count: n.total });
        if (n.added) changed = true;
      } catch (e) {
        status.set(acct.email, { at: Date.now(), ok: false, error: friendly(e, acct) });
        changed = true;
      }
    }
  } finally { busy = false; }
  // Packages: rebuilt from the mail just read; news that is fresh gets an alert.
  try {
    const d = refreshDeliveries();
    if (d.changed) changed = true;
    for (const p of d.news) alert('deliveries', SHIP_ALERT[p.status] + (p.window && p.status === 'out' ? `, ${p.window}` : ''), [p.name, p.from].filter(Boolean).join(' · '));
  } catch (e) { console.error('deliveries', e); }
  return changed;
}
const SHIP_ALERT = { out: 'Out for delivery', delivered: 'Delivered', delayed: 'Package delayed', pickup: 'Ready for pickup' };
// Packages for the board, each with a link to the email it came from.
export const deliveriesForBoard = () => deliveries().map((p) => ({ ...p, link: mailLink(p.mail.account, p.mail.thread) }));

function friendly(e, acct = {}) {
  const msg = String(e?.responseText || e?.message || e);
  const who = mailName(acct);
  if (/AUTHENTICATIONFAILED|Invalid credentials|Application-specific password|authentication failed|LOGIN failed|\bAUTH/i.test(msg)) return `${who} refused the sign-in. Check the ${isGmail(acct) ? 'app password (16 letters, no spaces needed)' : 'password: most providers want an app password here, not your normal one'}.`;
  if (/ENOTFOUND|ETIMEDOUT|ECONNREFUSED|EHOSTUNREACH/i.test(msg)) return `Could not reach ${who}. Check the internet connection${isGmail(acct) ? '' : ' and the server settings'}.`;
  return friendlyError(e, who).slice(0, 300);
}

export async function testAccount(acct) {
  const client = imapClient(acct);
  try { await client.connect(); await client.logout(); }
  catch (e) { return { ok: false, error: friendly(e, acct) }; }
  if (!isGmail(acct)) {
    // Sending too: a reply that cannot go out is worse than no account at all.
    try { await transport(acct).verify(); }
    catch (e) { return { ok: false, error: `Reading works, but sending did not: ${friendly(e, acct)}` }; }
  }
  return { ok: true };
}

// The first message id in References (or In-Reply-To, or its own id) names the
// conversation: every reply carries the id of the message that started it.
export function threadKey(messageId, inReplyTo, references) {
  const ids = String(references || '').match(/<[^>]+>/g) || [];
  return (ids[0] || String(inReplyTo || '').match(/<[^>]+>/)?.[0] || messageId || '').replace(/[<>]/g, '').trim();
}

// One message into the mail table, sorted: person, Voice, charge, receipt.
async function storeMessage(client, acct, me, ins, { m, id, threadId, inbox, unread, uid }) {
  const env = m.envelope || {};
  const from = env.from?.[0] || {};
  const fromAddr = (from.address || '').toLowerCase();
  const fromName = from.name || fromAddr;
  const to = [...(env.to || []), ...(env.cc || [])].map((a) => a.address).filter(Boolean).join(', ');
  const headers = m.headers?.toString() || '';
  const unsub = /list-unsubscribe:/i.test(headers) || /precedence:\s*(bulk|list)/i.test(headers) || /auto-submitted:\s*auto-/i.test(headers);
  const fromMe = me.has(fromAddr) ? 1 : 0;
  // Read the start of the body for people, Voice, and anything that may carry an amount.
  let body = '';
  const wantBody = !fromMe && (!unsub || BANK_SENDERS.test(fromAddr + fromName) || RECEIPT_WORDS.test(env.subject || '') || VOICE.test(env.subject || '') || !!readShipment({ subject: env.subject || '', from_addr: fromAddr, from_name: fromName }));
  if (wantBody || fromMe) {
    try {
      const msg = await client.fetchOne(String(m.uid), { source: { maxLength: 48 * 1024 } }, { uid: true });
      if (msg?.source) body = snippetOf(await simpleParser(msg.source));
    } catch {}
  }
  const c = classify(env, fromAddr, fromName, unsub, body);
  const date = env.date ? new Date(env.date).getTime() : Date.now();
  const subject = env.subject || '(no subject)';
  const space = spaceForAddress(fromAddr, to) || 'personal';
  ins.run(acct.email, id, threadId, uid, c.who || fromName, fromAddr, to, subject, body, date, inbox, unread, fromMe, c.bulk ? 1 : 0, c.kind, c.amount ?? null, c.merchant ?? null, space);
  if (!fromMe && Date.now() - date < 15 * 60e3 && c.kind.startsWith('voice')) {
    alert('email', c.kind === 'voice-call' ? `Missed call: ${c.who}` : `${c.who}`, body.slice(0, 140) || subject);
  }
}
const insertSql = () => db.prepare(`INSERT OR REPLACE INTO mail (account, msg_id, thread_id, uid, from_name, from_addr, to_addrs, subject, snippet, date, inbox, unread, from_me, bulk, kind, amount, merchant, space)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

async function pollAccount(acct) {
  if (!isGmail(acct)) return pollImap(acct);
  const me = new Set([acct.email.toLowerCase(), ...(acct.aliases || []).map((a) => a.toLowerCase())]);
  const client = imapClient(acct);
  await client.connect();
  let total = 0, added = 0;
  try {
    const boxes = await client.list();
    const all = boxes.find((b) => b.specialUse === '\\All')?.path || '[Gmail]/All Mail';
    const lock = await client.getMailboxLock(all, { readOnly: true });
    try {
      const uids = await client.search({ gmraw: `newer_than:${DAYS}d -in:spam -in:trash -in:drafts` }, { uid: true });   // drafts: lib/drafts.js
      if (!uids?.length) return { total: 0, added: 0 };
      total = uids.length;
      const known = new Set(db.prepare('SELECT msg_id FROM mail WHERE account = ?').all(acct.email).map((r) => r.msg_id));
      const upd = db.prepare('UPDATE mail SET inbox = ?, unread = ? WHERE account = ? AND msg_id = ?');
      const fresh = [];
      for await (const m of client.fetch(uids, { uid: true, envelope: true, flags: true, labels: true, threadId: true, headers: ['list-unsubscribe', 'precedence', 'auto-submitted'] }, { uid: true })) {
        const id = m.emailId || String(m.uid);
        const inbox = m.labels?.has('\\Inbox') ? 1 : 0;
        const unread = m.flags?.has('\\Seen') ? 0 : 1;
        if (known.has(id)) { upd.run(inbox, unread, acct.email, id); continue; }
        fresh.push({ m, id, inbox, unread });
      }
      const ins = insertSql();
      for (const f of fresh) { await storeMessage(client, acct, me, ins, { ...f, threadId: f.m.threadId || f.id, uid: f.m.uid }); added++; }
      // Everyone the user has sent mail to. The Email card only shows people on this list.
      const addContact = db.prepare('INSERT INTO contacts (addr, last_at) VALUES (?, ?) ON CONFLICT(addr) DO UPDATE SET last_at = MAX(last_at, excluded.last_at)');
      for (const r of db.prepare('SELECT to_addrs, date FROM mail WHERE account = ? AND from_me = 1').all(acct.email)) {
        for (const a of (r.to_addrs || '').split(',')) if (a.trim()) addContact.run(a.trim().toLowerCase(), r.date);
      }
      if (!getSetting('contacts_seeded:' + acct.email, false)) {
        const sent = await client.search({ gmraw: 'in:sent newer_than:730d' }, { uid: true });
        if (sent?.length) {
          for await (const m of client.fetch(sent.slice(-3000), { uid: true, envelope: true }, { uid: true })) {
            const env = m.envelope || {};
            const at = env.date ? new Date(env.date).getTime() : 0;
            for (const a of [...(env.to || []), ...(env.cc || [])]) if (a.address) addContact.run(a.address.toLowerCase(), at);
          }
        }
        setSetting('contacts_seeded:' + acct.email, true);
      }

      // Gmail's Primary tab, so the quiet Email card skips Promotions, Social and Updates.
      const primary = new Set(await client.search({ gmraw: `category:primary newer_than:${DAYS}d` }, { uid: true }) || []);
      const setPrim = db.prepare('UPDATE mail SET primary_cat = ? WHERE account = ? AND uid = ?');
      for (const uid of uids) setPrim.run(primary.has(uid) ? 1 : 0, acct.email, uid);
    } finally { lock.release(); }
    // Forget mail older than the window.
    db.prepare('DELETE FROM mail WHERE account = ? AND date < ?').run(acct.email, Date.now() - (DAYS + 1) * 86400e3);
  } finally {
    await client.logout().catch(() => {});
  }
  return { total, added };
}

// Any other provider: the Inbox (what is waiting) and Sent (what you answered,
// and who you write to), each for the last two weeks.
async function pollImap(acct) {
  const me = new Set([acct.email.toLowerCase(), ...(acct.aliases || []).map((a) => a.toLowerCase())]);
  const client = imapClient(acct);
  await client.connect();
  let total = 0, added = 0;
  const since = new Date(Date.now() - DAYS * 86400e3);
  const fields = { uid: true, envelope: true, flags: true, headers: ['list-unsubscribe', 'precedence', 'auto-submitted', 'references'] };
  const refs = (m) => (m.headers?.toString().match(/references:\s*([\s\S]*?)(\r?\n\S|$)/i) || [])[1] || '';
  const idOf = (m, box) => m.envelope?.messageId ? m.envelope.messageId.replace(/[<>]/g, '') : `${box}-${m.uid}`;
  try {
    const boxes = await client.list();
    const sentPath = boxes.find((b) => b.specialUse === '\\Sent')?.path || boxes.find((b) => /^(sent|sent items|sent mail|sent messages)$/i.test(b.name))?.path;
    const ins = insertSql();
    const known = new Set(db.prepare('SELECT msg_id FROM mail WHERE account = ?').all(acct.email).map((r) => r.msg_id));
    // Inbox
    let lock = await client.getMailboxLock('INBOX', { readOnly: true });
    try {
      const uids = (await client.search({ since }, { uid: true })) || [];
      total = uids.length;
      const upd = db.prepare('UPDATE mail SET inbox = 1, unread = ?, uid = ? WHERE account = ? AND msg_id = ?');
      const here = new Set();
      if (uids.length) {
        const fresh = [];
        for await (const m of client.fetch(uids, fields, { uid: true })) {
          const id = idOf(m, 'inbox'); here.add(id);
          const unread = m.flags?.has('\\Seen') ? 0 : 1;
          if (known.has(id)) { upd.run(unread, m.uid, acct.email, id); continue; }
          fresh.push({ m, id, inbox: 1, unread, uid: m.uid, threadId: threadKey(m.envelope?.messageId, m.envelope?.inReplyTo, refs(m)) || id });
        }
        for (const f of fresh) { await storeMessage(client, acct, me, ins, f); added++; }
      }
      // Moved out of the Inbox somewhere else (archived on the phone): no longer waiting.
      for (const r of db.prepare('SELECT msg_id FROM mail WHERE account = ? AND inbox = 1 AND from_me = 0').all(acct.email)) {
        if (!here.has(r.msg_id)) db.prepare('UPDATE mail SET inbox = 0 WHERE account = ? AND msg_id = ?').run(acct.email, r.msg_id);
      }
    } finally { lock.release(); }
    // Sent: kept without a uid (actions only ever touch the Inbox).
    if (sentPath) {
      lock = await client.getMailboxLock(sentPath, { readOnly: true });
      try {
        const uids = (await client.search({ since }, { uid: true })) || [];
        const fresh = [];
        if (uids.length) for await (const m of client.fetch(uids, fields, { uid: true })) {
          const id = idOf(m, 'sent');
          if (known.has(id)) continue;
          fresh.push({ m, id, inbox: 0, unread: 0, uid: null, threadId: threadKey(m.envelope?.messageId, m.envelope?.inReplyTo, refs(m)) || id });
        }
        for (const f of fresh) { await storeMessage(client, acct, me, ins, f); added++; }
        // Everyone you have written to in two years: the quiet Email card shows only them.
        const addContact = db.prepare('INSERT INTO contacts (addr, last_at) VALUES (?, ?) ON CONFLICT(addr) DO UPDATE SET last_at = MAX(last_at, excluded.last_at)');
        if (!getSetting('contacts_seeded:' + acct.email, false)) {
          const sent = (await client.search({ since: new Date(Date.now() - 730 * 86400e3) }, { uid: true })) || [];
          if (sent.length) for await (const m of client.fetch(sent.slice(-3000), { uid: true, envelope: true }, { uid: true })) {
            const at = m.envelope?.date ? new Date(m.envelope.date).getTime() : 0;
            for (const a of [...(m.envelope?.to || []), ...(m.envelope?.cc || [])]) if (a.address) addContact.run(a.address.toLowerCase(), at);
          }
          setSetting('contacts_seeded:' + acct.email, true);
        }
        for (const r of db.prepare('SELECT to_addrs, date FROM mail WHERE account = ? AND from_me = 1').all(acct.email)) {
          for (const a of (r.to_addrs || '').split(',')) if (a.trim()) addContact.run(a.trim().toLowerCase(), r.date);
        }
      } finally { lock.release(); }
    }
    db.prepare('DELETE FROM mail WHERE account = ? AND date < ?').run(acct.email, Date.now() - (DAYS + 1) * 86400e3);
  } finally {
    await client.logout().catch(() => {});
  }
  return { total, added };
}

// Where to open a conversation on the web: Gmail can link to the thread itself;
// other providers open their webmail.
export function mailLink(accountEmail, threadId) {
  const a = account(accountEmail);
  if (!a || isGmail(a)) return gmailLink(accountEmail, threadId);
  return a.web || null;
}

// Gmail's web link for a thread: the X-GM-THRID in hex.
export function gmailLink(account, threadId) {
  let hex = threadId;
  try { hex = BigInt(threadId).toString(16); } catch {}
  return `https://mail.google.com/mail/u/${encodeURIComponent(account)}/#all/${hex}`;
}

// Email splits two ways. "Business" means it was sent to one of the user's business
// addresses or came from someone a rule ties to a business or client,
// and is not a newsletter: those wait on him. Everything else from a real person
// in Gmail's Primary tab goes to the quiet Email card, which never counts.
// Google Voice texts, voicemails and missed calls always wait on him.
export function mailThreads() {
  const rows = db.prepare(`
    SELECT m.* FROM mail m
    JOIN (SELECT account, thread_id, MAX(date) AS d FROM mail GROUP BY account, thread_id) t
      ON t.account = m.account AND t.thread_id = m.thread_id AND t.d = m.date
    ORDER BY m.date DESC`).all();
  const waiting = [], email = [], recent = [];
  const known = new Set(db.prepare('SELECT addr FROM contacts').all().map((c) => c.addr));
  const count = db.prepare('SELECT COUNT(*) AS n FROM mail WHERE account = ? AND thread_id = ?');
  const mine = new Set(sendAddresses().map((a) => a.address.toLowerCase()));
  for (const r of rows) {
    if (r.from_me) {
      // the user answered last: a recent business conversation, not waiting.
      if (Date.now() - r.date > 7 * 86400e3) continue;
      const others = (r.to_addrs || '').split(',').map((a) => a.trim().toLowerCase()).filter((a) => a && !mine.has(a));
      if (!others.length) continue;
      const voice = /txt\.voice\.google\.com/.test(others[0]);
      const space = voice ? (spaceForPhone(others[0]) || 'personal') : spaceForAddress(others.join(','), r.from_addr);
      if (!voice && (!space || space === 'personal')) continue;
      recent.push({ key: `mail:${r.account}:${r.thread_id}`, account: r.account, threadId: r.thread_id, who: voice ? 'Text conversation' : others[0], from: 'You', subject: r.subject, snippet: 'You: ' + (voice ? cleanVoice(r.snippet) : r.snippet || ''), date: r.date, unread: false, kind: voice ? 'voice-text' : 'mail', space, count: 1, link: mailLink(r.account, r.thread_id), replied: true });
      continue;
    }
    if (!r.inbox) continue;
    if (r.kind === 'charge' || r.kind === 'receipt') continue;
    if (AUTOMATED_SUBJECT.test(r.subject || '') || /dmarc/i.test(r.from_addr)) continue;
    const voice = r.kind.startsWith('voice');
    if (!voice && r.bulk) continue;
    const space = (voice ? spaceForPhone(r.from_name, r.subject, r.from_addr) : spaceForAddress(r.from_addr, r.to_addrs)) || 'personal';   // rules and About cards apply live
    const business = voice || space !== 'personal';
    if (!business && (r.primary_cat === 0 || !known.has(r.from_addr))) continue;   // people you have written to, Primary tab
    const t = {
      key: `mail:${r.account}:${r.thread_id}`, account: r.account, threadId: r.thread_id,
      who: r.from_name || r.from_addr, from: r.from_addr, subject: r.subject, snippet: voice ? cleanVoice(r.snippet) : r.snippet,
      date: r.date, unread: !!r.unread, kind: r.kind, space, count: count.get(r.account, r.thread_id).n,
      to: r.to_addrs,
      link: mailLink(r.account, r.thread_id)
    };
    (business ? waiting : email).push(t);
  }
  return { waiting, email, recent };
}

export function moneyFromMail() {
  return db.prepare(`SELECT account, msg_id, thread_id, from_name, from_addr, subject, snippet, date, kind, amount, merchant, space
    FROM mail WHERE kind IN ('charge', 'receipt') AND from_me = 0 ORDER BY date DESC LIMIT 80`).all()
    .map((r) => ({ ...r, link: mailLink(r.account, r.thread_id) }));
}

export function threadMessages(account, threadId, limit = 10) {
  return db.prepare('SELECT msg_id, from_name, from_addr, subject, snippet, date, from_me, kind FROM mail WHERE account = ? AND thread_id = ? ORDER BY date DESC LIMIT ?').all(account, threadId, limit)
    .map((m) => (m.kind || '').startsWith('voice') || /txt\.voice\.google\.com/.test(m.from_addr || '') ? { ...m, snippet: cleanVoice(m.snippet) } : m);
}

// ---------------------------------------------------------------------------
// Acting on mail. Every one of these runs only when the user clicks a button.


const account = (email) => accounts().find((a) => a.email === email);

// Gmail acts in All Mail; other providers in the Inbox (the only folder whose uids are kept).
async function withMailbox(acct, fn) {
  const client = imapClient(acct);
  await client.connect();
  try {
    const boxes = await client.list();
    const all = isGmail(acct) ? (boxes.find((b) => b.specialUse === '\\All')?.path || '[Gmail]/All Mail') : 'INBOX';
    client.boxes = boxes;
    const lock = await client.getMailboxLock(all);
    try { return await fn(client); } finally { lock.release(); }
  } finally { await client.logout().catch(() => {}); }
}

const threadUids = (email, threadId) => db.prepare('SELECT uid FROM mail WHERE account = ? AND thread_id = ?').all(email, threadId).map((r) => r.uid).filter(Boolean);

// Archive: take the thread out of the Gmail inbox and mark it read.
export async function archiveThread(email, threadId) {
  const acct = account(email); const uids = threadUids(email, threadId);
  if (!acct || !uids.length) return;
  await withMailbox(acct, async (c) => {
    await c.messageFlagsAdd(uids, ['\\Seen'], { uid: true });
    if (isGmail(acct)) { await c.messageFlagsRemove(uids, ['\\Inbox'], { uid: true, useLabels: true }); return; }
    // Other providers: move to their Archive folder (made if there is none).
    let archive = c.boxes.find((b) => b.specialUse === '\\Archive')?.path || c.boxes.find((b) => /^archive$/i.test(b.name))?.path;
    if (!archive) { await c.mailboxCreate('Archive').catch(() => {}); archive = 'Archive'; }
    await c.messageMove(uids, archive, { uid: true });
  });
  db.prepare('UPDATE mail SET inbox = 0, unread = 0 WHERE account = ? AND thread_id = ?').run(email, threadId);
}

export async function markThreadRead(email, threadId) {
  const acct = account(email); const uids = threadUids(email, threadId);
  if (!acct || !uids.length) return;
  await withMailbox(acct, (c) => c.messageFlagsAdd(uids, ['\\Seen'], { uid: true }));
  db.prepare('UPDATE mail SET unread = 0 WHERE account = ? AND thread_id = ?').run(email, threadId);
}

// Addresses the user can send as from this account: the account itself and the "Also you" list.
export function sendAddresses() {
  return accounts().flatMap((a) => [a.email, ...(a.aliases || [])].map((addr) => ({ account: a.email, address: addr })));
}

function transport(acct) {
  const smtp = isGmail(acct) ? { host: 'smtp.gmail.com', port: 465, secure: true } : acct.smtp;
  return nodemailer.createTransport({ host: smtp.host, port: smtp.port, secure: !!smtp.secure, requireTLS: !smtp.secure, auth: { user: acct.user || acct.email, pass: pass(acct) } });
}

const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function bodyFor(from, text) {
  const sig = getSetting('signatures', {})[from.toLowerCase()] || '';
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5">${escHtml(text).split(/\n{2,}/).map((p) => `<p style="margin:0 0 12px">${p.replace(/\n/g, '<br>')}</p>`).join('')}</div>${sig}`;
  return { text, html: sig || text.includes('\n') ? html : undefined };
}

// The envelope of the newest message from the other side, for a threaded reply.
async function replyContext(email, threadId) {
  const acct = account(email);
  const last = db.prepare('SELECT uid, from_addr, to_addrs, subject, kind, from_me FROM mail WHERE account = ? AND thread_id = ? AND from_me = 0 AND uid IS NOT NULL ORDER BY date DESC LIMIT 1').get(email, threadId)
    || db.prepare('SELECT uid, from_addr, to_addrs, subject, kind, from_me FROM mail WHERE account = ? AND thread_id = ? AND uid IS NOT NULL ORDER BY date DESC LIMIT 1').get(email, threadId);
  if (!acct || !last) throw new Error('That conversation is no longer in the last 14 days of mail.');
  return withMailbox(acct, async (c) => {
    const m = await c.fetchOne(String(last.uid), { envelope: true, headers: ['references'] }, { uid: true });
    const env = m?.envelope || {};
    const refs = (m?.headers?.toString().match(/references:\s*([\s\S]*)/i)?.[1] || '').replace(/\s+/g, ' ').trim();
    // A follow-up on the user's own unanswered email goes to whoever they wrote to.
    const to = last.from_me ? (env.to || []).map((a) => a.address).filter(Boolean).join(', ') || last.to_addrs
      : env.replyTo?.[0]?.address || env.from?.[0]?.address || last.from_addr;
    const subject = env.subject || last.subject || '';
    return { acct, to, subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`, inReplyTo: env.messageId, references: [refs, env.messageId].filter(Boolean).join(' '), kind: last.kind };
  });
}

export async function replyThread(email, threadId, text, from) {
  const ctx = await replyContext(email, threadId);
  // Google Voice only accepts replies from the Gmail address the number belongs to, as plain text.
  const sender = ctx.kind.startsWith('voice') ? ctx.acct.email : (from || ctx.acct.email);
  const body = ctx.kind.startsWith('voice') ? { text } : bodyFor(sender, text);
  await transport(ctx.acct).sendMail({ from: sender, to: ctx.to, subject: ctx.subject, inReplyTo: ctx.inReplyTo, references: ctx.references, ...body });
  const id = 'local-' + Date.now();
  // Show it right away as answered; the next read of Gmail confirms it.
  db.prepare(`INSERT OR REPLACE INTO mail (account, msg_id, thread_id, uid, from_name, from_addr, to_addrs, subject, snippet, date, inbox, unread, from_me, bulk, kind, space)
    VALUES (?, ?, ?, NULL, 'You', ?, ?, ?, ?, ?, 1, 0, 1, 0, 'mail', NULL)`).run(email, id, threadId, sender.toLowerCase(), ctx.to, ctx.subject, text.slice(0, 600), Date.now());
  return { id };
}

export async function composeMail(from, to, subject, text) {
  const addr = sendAddresses().find((a) => a.address === from) || sendAddresses()[0];
  if (!addr) throw new Error('Add an email account in Settings first.');
  await transport(account(addr.account)).sendMail({ from: addr.address, to, subject, ...bodyFor(addr.address, text) });
}

// Threads the user sent last that nobody has answered yet: waiting on others.
// Business only (an address rule ties it to a project), at least a day old.
export function awaitingReply() {
  const rows = db.prepare(`
    SELECT m.* FROM mail m
    JOIN (SELECT account, thread_id, MAX(date) AS d FROM mail GROUP BY account, thread_id) t
      ON t.account = m.account AND t.thread_id = m.thread_id AND t.d = m.date
    WHERE m.from_me = 1 AND m.date < ? ORDER BY m.date DESC`).all(Date.now() - 86400e3);
  const out = [];
  const mine = new Set(sendAddresses().map((a) => a.address.toLowerCase()));
  for (const r of rows) {
    const others = (r.to_addrs || '').split(',').map((a) => a.trim().toLowerCase()).filter((a) => a && !mine.has(a));
    if (!others.length) continue;                       // a note to yourself
    r.to_addrs = others.join(', ');
    const space = spaceForAddress(r.to_addrs, r.from_addr);
    if (!space || space === 'personal' || r.kind !== 'mail') continue;
    const to = (r.to_addrs || '').split(',')[0].trim();
    if (!to) continue;
    out.push({ key: `mail:${r.account}:${r.thread_id}`, account: r.account, threadId: r.thread_id, who: to, subject: r.subject, date: r.date, space, link: mailLink(r.account, r.thread_id) });
  }
  return out;
}

// The whole conversation, for handing to an agent: the last few messages in full
// (quoted earlier replies trimmed, since they repeat), oldest first.
export async function fullThread(email, threadId, max = 6) {
  const acct = account(email);
  const rows = db.prepare('SELECT msg_id, uid, from_name, from_addr, date, from_me, kind FROM mail WHERE account = ? AND thread_id = ? AND uid IS NOT NULL ORDER BY date DESC LIMIT ?').all(email, threadId, max).reverse();
  if (!acct || !rows.length) return [];
  return withMailbox(acct, async (c) => {
    const out = [];
    for (const r of rows) {
      let text = '';
      try {
        const m = await c.fetchOne(String(r.uid), { source: { maxLength: 400 * 1024 } }, { uid: true });
        const parsed = m?.source ? await simpleParser(m.source) : null;
        text = parsed?.text || (parsed?.html || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, ' ');
      } catch {}
      text = text.replace(/\r/g, '').replace(/\n>.*(?=\n|$)/g, '').replace(/\nOn .{5,120} wrote:[\s\S]*$/m, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      if (r.kind?.startsWith('voice') || /txt\.voice\.google\.com/.test(r.from_addr || '')) text = cleanVoice(text);
      out.push({ id: r.msg_id, from: r.from_me ? 'You' : (r.from_name || r.from_addr), date: r.date, text });
    }
    return out;
  });
}

// For lib/drafts.js, which reads and writes the Drafts folder with the same connection details.
export const mailParts = { imapClient, isGmail, account, transport, bodyFor };
