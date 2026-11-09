// Spaces are the parts of the user's life. Rules decide which space a repo, window
// or email belongs to: the first rule whose text appears (as a whole word) in the
// thing wins. Both are edited in Settings.
import { db, getSetting, setSetting } from './db.js';

// A fresh install starts with one project and no rules; the first-run card on
// Now walks through adding the rest. (the user's own projects and rules live in
// his settings, not here.)
export const DEFAULT_SPACES = [
  { id: 'personal', name: 'Personal', color: '#8A8F98', group: 'Mine' }
];

export const DEFAULT_RULES = [];

export function spaces() {
  return getSetting('spaces', DEFAULT_SPACES);
}

export function rules() {
  return getSetting('rules', DEFAULT_RULES);
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const digits = (s) => String(s || '').replace(/\D/g, '').slice(-10);

// Your own addresses are never someone's: server.js tells this file what they are.
let ownAddresses = () => [];
export function knowOwnAddresses(fn) { ownAddresses = fn; }

// The people on each project's About card (lib/projects.js profiles): every
// email address, the full name and every phone number sort their messages into
// that project, after the rules (Nov 5 2026). An address, name or number on
// more than one project's card sorts nothing: there is no telling which project
// a message is for. A person with one of your own addresses is you, and sorts
// nothing. Older cards carry a single email and phone; both forms are read.
export function aboutPeople() {
  const out = [], seen = { email: {}, name: {}, phone: {} };
  let mine = new Set();
  try { mine = new Set(ownAddresses().map((a) => String(a || '').toLowerCase())); } catch {}
  const listOf = (one, many) => [one, ...(Array.isArray(many) ? many : [])];
  for (const [space, p] of Object.entries(getSetting('profiles', {}) || {})) {
    for (const x of Array.isArray(p?.people) ? p.people : []) {
      const emails = [...new Set(listOf(x?.email, x?.emails).map((e) => String(e || '').trim().toLowerCase()).filter((e) => e.includes('@')))];
      const phones = [...new Set(listOf(x?.phone, x?.phones).map(digits).filter((d) => d.length === 10))];
      if (emails.some((e) => mine.has(e))) continue;
      const name = String(x?.name || '').trim().replace(/\s+/g, ' ');
      out.push({ space, name, emails, phones, role: x?.role || '' });
      for (const e of emails) (seen.email[e] ||= new Set()).add(space);
      for (const d of phones) (seen.phone[d] ||= new Set()).add(space);
      if (name) (seen.name[name.toLowerCase()] ||= new Set()).add(space);
    }
  }
  const one = (k, v) => seen[k][v.toLowerCase()].size === 1;
  return out.map((x) => {
    const emails = x.emails.filter((e) => one('email', e)), phones = x.phones.filter((d) => one('phone', d));
    // allEmails and allPhones: everything on the card, for showing; the rest sort.
    return { ...x, allEmails: x.emails, allPhones: x.phones, emails, phones, email: emails[0] || '', phone: phones[0] || '', name: x.name && one('name', x.name) ? x.name : '' };
  });
}

const word = (text, space) => ({ re: new RegExp(`(^|[^a-z0-9])${esc(text.toLowerCase())}([^a-z0-9]|$)`, 'i'), addr: /[@.]/.test(text), space });
let cache = { raw: null, own: null, key: null, compiled: [], phones: [] };
const ownKey = () => { try { return ownAddresses().join(','); } catch { return ''; } };
function compiled() {
  // Rebuilt only when the stored rules or About cards change: a mail check sorts
  // thousands of messages at a time, and this is one quick read for each.
  const raw = db.prepare("SELECT group_concat(key || '=' || value, '\n') AS v FROM settings WHERE key IN ('rules', 'profiles', 'shareMap')").get()?.v || '';
  if (cache.raw !== raw || cache.own !== ownKey()) {
    const src = rules(), people = aboutPeople(), key = null;
    // A shared project's card can be written on someone else's computer, and what is sorted into a shared
    // project leaves this one: its people sort messages (which never leave), not notes, sessions or repos (M2).
    const shared = new Set(Object.values(getSetting('shareMap', {}) || {}));
    const derived = [];
    for (const x of people) {
      const card = { about: true, shared: shared.has(x.space) };
      for (const e of x.emails) derived.push({ ...word(e, x.space), ...card });
      // A full name (two words or more), so "Sam" alone never pulls in every Sam.
      if (x.name && x.name.includes(' ')) derived.push({ ...word(x.name, x.space), addr: false, ...card });
    }
    cache = { raw, own: ownKey(), key, compiled: [...src.map(([text, space]) => word(text, space)), ...derived], phones: people.flatMap((x) => x.phones.map((d) => [d, x.space])) };
  }
  return cache.compiled;
}

// Texts (Google Voice) by the sender's phone number, from the About cards.
export function spaceForPhone(...texts) {
  compiled();
  for (const t of texts) for (const run of String(t || '').match(/\d[\d\s().+-]{8,}\d/g) || []) {
    const d = digits(run), hit = cache.phones.find(([p]) => p === d);
    if (hit) return hit[1];
  }
  // Voice relay addresses carry both numbers: 1<yours>.1<theirs>.x@txt.voice.google.com
  for (const t of texts) for (const run of String(t || '').match(/\d{10,11}/g) || []) {
    const hit = cache.phones.find(([p]) => p === digits(run));
    if (hit) return hit[1];
  }
  return null;
}

// Notes, sessions, repos, windows: the rules, and the About cards of projects that are not shared.
export function spaceFor(...texts) {
  const hay = texts.filter(Boolean).join(' \n ').toLowerCase();
  for (const r of compiled()) if (!r.shared && r.re.test(hay)) return r.space;
  return null;
}
// A conversation by who it is with (a Teams chat's name): every About card counts, shared or not.
export function spaceForPeople(...texts) {
  const hay = texts.filter(Boolean).join(' \n ').toLowerCase();
  for (const r of compiled()) if (r.re.test(hay)) return r.space;
  return null;
}

// Email addresses only match rules that look like an address or a domain
// ("client@example.com", "example.com"), so a stranger who shares a word is not a client.
export function spaceForAddress(...addrs) {
  const hay = addrs.filter(Boolean).join(' \n ').toLowerCase();
  for (const r of compiled()) if (r.addr && r.re.test(hay)) return r.space;
  return null;
}

// Settings arrive as editable text. "Name | id | #color | group | send-from address" per space,
// "text -> space" per rule.
export function parseSpaces(text) {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [name, id, color, group, from] = l.split('|').map((s) => s.trim());
    return { name, id: (id || name).toLowerCase().replace(/[^a-z0-9]+/g, '-'), color: color || '#8A8F98', group: group || 'Mine', ...(from ? { from: from.toLowerCase() } : {}) };
  });
}

export function parseRules(text) {
  return text.split('\n').map((l) => l.trim()).filter((l) => l.includes('->')).map((l) => {
    const i = l.lastIndexOf('->');
    return [l.slice(0, i).trim(), l.slice(i + 2).trim()];
  }).filter(([a, b]) => a && b);
}

// Projects from the Settings editor. A project keeps its id once made, since
// items and rules point at it; a new one takes its id from its name, never one
// another project in the list already has (one of the same name made elsewhere
// meanwhile keeps its own). made: filled with the page's temporary id for each
// new project (tmp, "new-…") and the id it got, which the page takes in place
// of finding it by name (re-review L2).
const slugOf = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export function cleanSpaces(list, made = null) {
  const seen = new Set(), taken = new Set(list.map((x) => slugOf(x?.id)).filter(Boolean));
  return list.map((x) => {
    const name = String(x?.name || '').trim(), given = slugOf(x?.id);
    // A new id is the name's first 40 characters: the page's address takes up to 60 (#project/<id>), and a '-2' may follow.
    let id = given || slugOf(name).slice(0, 40).replace(/-$/, '');
    if (!name || !id) return null;
    while (seen.has(id) || (!given && taken.has(id))) id += '-2';
    seen.add(id);
    if (!given && made && /^new-[a-z0-9]{1,24}$/.test(String(x.tmp || ''))) made[x.tmp] = id;
    const color = /^#[0-9a-f]{6}$/i.test(x.color) ? x.color : '#8A8F98';
    const from = String(x.from || '').trim().toLowerCase();
    return { name, id, color, group: String(x.group || '').trim() || 'Mine', ...(from ? { from } : {}) };
  }).filter(Boolean);
}

export function saveSpaces(list) { setSetting('spaces', list); }
export function saveRules(list) { setSetting('rules', list); }
