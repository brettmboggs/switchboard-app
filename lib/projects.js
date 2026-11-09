// A project's own page: who it is for, how to reach them, where its things
// live, and the files dropped onto it. The profile (about, people, links) is a
// setting, so it syncs with the rest of the account; the files stay on this
// computer, in the data folder under projects/<id>/files.
import { mkdirSync, readdirSync, statSync, unlinkSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { db, getSetting, setSetting, DATA_DIR } from './db.js';
import { spaces } from './spaces.js';
import { accounts } from './gmail.js';
import { microsoft, msConfig } from './microsoft.js';
import { streamToFile } from './attachments.js';

export const FILE_MAX = 1024 * 1024 * 1024;   // one file, 1 GB, streamed to disk (lib/attachments.js)
const str = (v, n) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n);
// A link is http(s), mailto or tel; anything else is dropped, so a profile can
// never carry a javascript: link onto the page.
const okUrl = (u) => {
  const s = str(u, 2000);
  if (!s) return '';
  if (/^(mailto:|tel:)/i.test(s)) return s;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : 'https://' + s;
  try { const x = new URL(withScheme); return ['http:', 'https:'].includes(x.protocol) ? x.href : ''; } catch { return ''; }
};

// Up to 10 values, blanks dropped, each kept once (same: what counts as one).
const several = (list, n, same) => {
  const seen = new Set(), out = [];
  for (const v of list.map((x) => str(x, n)).filter(Boolean)) if (!seen.has(same(v))) { seen.add(same(v)); out.push(v); }
  return out.slice(0, 10);
};

export function cleanProfile(p = {}) {
  return {
    about: str(p.about, 4000),
    // A person holds any number of addresses and numbers (Nov 5 2026). The
    // first of each is also written as the old single email and phone, so a
    // copy of Switchboard from before still reads it.
    people: (Array.isArray(p.people) ? p.people : []).slice(0, 50).map((x) => {
      const emails = several([x?.email, ...(Array.isArray(x?.emails) ? x.emails : [])], 200, (v) => v.toLowerCase());
      const phones = several([x?.phone, ...(Array.isArray(x?.phones) ? x.phones : [])], 60, (v) => v.replace(/\D/g, '').slice(-10) || v);
      return { name: str(x?.name, 120), role: str(x?.role, 120), email: emails[0] || '', phone: phones[0] || '', emails, phones };
    }).filter((x) => x.name || x.emails.length || x.phones.length),
    links: (Array.isArray(p.links) ? p.links : []).slice(0, 50).map((x) => ({ label: str(x?.label, 120), url: okUrl(x?.url) })).filter((x) => x.url),
    // People found in the mail that were waved away (Hide), by address.
    hidden: [...new Set((Array.isArray(p.hidden) ? p.hidden : []).map((a) => str(a, 200).toLowerCase()).filter(Boolean))].slice(0, 500)
  };
}

const known = (id) => spaces().some((s) => s.id === id);
export function profiles() { return getSetting('profiles', {}); }
export function profileOf(id) { return cleanProfile(profiles()[id] || {}); }
// A form that was open a while sends what it started from (was): only its own changes go in, so people
// taken off with ×, put back with Undo or brought by a shared project's sync meanwhile stay as they are (M7).
const personKey = (x) => String(x.email || '').trim().toLowerCase() || 'name:' + String(x.name || '').trim().toLowerCase();
const linkKey = (x) => String(x.url || '');
function mergeList(cur, next, was, key) {
  const before = new Map(was.map((x) => [key(x), JSON.stringify(x)])), mine = new Map(next.map((x) => [key(x), x]));
  const kept = cur.filter((x) => mine.has(key(x)) || !before.has(key(x))).map((x) => mine.get(key(x)) || x);
  const have = new Set(kept.map(key));
  // From the form: what it added or changed. One it only still had, gone meanwhile, stays gone.
  return [...kept, ...next.filter((x) => !have.has(key(x)) && before.get(key(x)) !== JSON.stringify(x))];
}
function mergeProfile(cur, next, was) {
  return {
    about: next.about !== was.about ? next.about : cur.about,
    people: mergeList(cur.people, next.people, was.people, personKey),
    links: mergeList(cur.links, next.links, was.links, linkKey),
    hidden: [...new Set([...cur.hidden.filter((a) => next.hidden.includes(a) || !was.hidden.includes(a)), ...next.hidden])]
  };
}
export function saveProfile(id, p) {
  if (!known(id)) throw new Error('That project is gone.');
  const next = p?.was && typeof p.was === 'object' ? mergeProfile(profileOf(id), cleanProfile(p), cleanProfile(p.was)) : p;
  const all = { ...profiles(), [id]: cleanProfile(next) };
  setSetting('profiles', all);
  return all[id];
}

// ---- files
// The folder is named by the project's id (lowercase letters, digits and
// dashes, from cleanSpaces), and a file keeps its own name with anything that
// could step out of the folder taken out.
function folder(id, make = false) {
  if (!/^[a-z0-9-]{1,60}$/.test(id) || !known(id)) throw new Error('That project is gone.');
  const dir = join(DATA_DIR, 'projects', id, 'files');
  if (make) mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}
export function safeName(name) {
  const base = String(name || '').split(/[\\/]/).pop().replace(/[\u0000-\u001f<>:"|?*]/g, '').replace(/^\.+/, '').trim().slice(0, 140);
  return base || 'file';
}
export function listFiles(id) {
  const dir = folder(id);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => !n.startsWith('.')).map((name) => {
    const st = statSync(join(dir, name));
    return st.isFile() ? { name, size: st.size, at: st.mtimeMs } : null;
  }).filter(Boolean).sort((a, b) => b.at - a.at);
}
// The request body becomes the file as it arrives; never overwrites: a second
// "brief.pdf" becomes "brief (2).pdf".
function freeName(dir, name) {
  let n = safeName(name);
  const dot = n.lastIndexOf('.'), stem = dot > 0 ? n.slice(0, dot) : n, ext = dot > 0 ? n.slice(dot) : '';
  for (let i = 2; existsSync(join(dir, n)); i++) n = `${stem} (${i})${ext}`;
  return n;
}
export async function addFileFrom(req, id, name) {
  const dir = folder(id, true), n = freeName(dir, name);
  await streamToFile(req, join(dir, n), FILE_MAX);
  return n;
}
// A copy of a file Switchboard already keeps (another project's, a note's picture).
export function addFileCopy(id, src, name) {
  const dir = folder(id, true), n = freeName(dir, name);
  copyFileSync(src, join(dir, n));
  return n;
}
export function filePath(id, name) {
  const n = safeName(name);
  if (n !== name) throw new Error('No such file.');
  const p = join(folder(id), n);
  if (!existsSync(p) || !statSync(p).isFile()) throw new Error('No such file.');
  return p;
}
export function removeFile(id, name) { unlinkSync(filePath(id, name)); }

// ---- people found in the mail
// Who this project's mail is with: everyone you wrote to in it, and anyone who
// wrote to you in it that you have written to at some point (so a stranger or
// a newsletter is never a contact), plus the people in its Outlook threads
// (already only people). Your own addresses, automated senders, anyone already
// on the profile and anyone you hid are left out. Read from what is already on
// this computer: nothing new is fetched for it.
const AUTOMATED = /(^|[._+-])(no-?reply|do-?not-?reply|notifications?|mailer-daemon|postmaster|bounce[s]?|alerts?|news(letter)?|marketing|support|billing|receipts?|info|hello|team)([._+-]|@)/i;
const addrOf = (s) => { const m = String(s || '').match(/<([^>]+)>/); return (m ? m[1] : String(s || '')).trim().toLowerCase(); };
export function foundPeople(id, limit = 20) {
  const prof = profileOf(id);
  const me = new Set(accounts().flatMap((a) => [a.email, ...(a.aliases || [])]).map((a) => String(a).toLowerCase()));
  const ms = msConfig()?.account?.email; if (ms) me.add(ms.toLowerCase());
  const skip = new Set([...me, ...prof.hidden, ...prof.people.flatMap((x) => x.emails.map((a) => a.toLowerCase()))]);
  const known = new Set(db.prepare('SELECT addr FROM contacts').all().map((c) => c.addr));
  const found = new Map();
  const note = (addr, name, at) => {
    addr = addrOf(addr);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr) || skip.has(addr) || AUTOMATED.test(addr)) return;
    const f = found.get(addr) || { email: addr, name: '', count: 0, last: 0 };
    f.count++; f.last = Math.max(f.last, at || 0);
    const n = String(name || '').replace(/^["']|["']$/g, '').trim();
    if (n && !n.includes('@') && !f.name) f.name = n.slice(0, 120);
    found.set(addr, f);
  };
  const rows = db.prepare(`SELECT from_name, from_addr, to_addrs, from_me, date FROM mail WHERE space = ? AND kind = 'mail' AND bulk = 0 ORDER BY date DESC LIMIT 2000`).all(id);
  for (const r of rows) {
    if (r.from_me) { for (const a of String(r.to_addrs || '').split(',')) if (a.trim()) note(a, '', r.date); }
    else if (known.has(addrOf(r.from_addr))) note(r.from_addr, r.from_name, r.date);
  }
  // Names from their own messages, for people only ever written to so far.
  for (const r of rows) { const f = found.get(addrOf(r.from_addr)); if (f && !f.name && r.from_name && !r.from_name.includes('@')) f.name = r.from_name.slice(0, 120); }
  // Still nameless: the name they sign their mail with anywhere else.
  const nameAny = db.prepare(`SELECT from_name FROM mail WHERE lower(from_addr) = ? AND from_name IS NOT NULL AND from_name != '' AND from_name NOT LIKE '%@%' ORDER BY date DESC LIMIT 1`);
  for (const f of found.values()) if (!f.name) f.name = String(nameAny.get(f.email)?.from_name || '').slice(0, 120);
  const m = microsoft() || {};
  for (const t of [...(m.threads || []), ...(m.recent || [])]) if (t.space === id && t.from) note(t.from, t.who, t.date);
  return [...found.values()].sort((a, b) => b.last - a.last).slice(0, limit);
}
