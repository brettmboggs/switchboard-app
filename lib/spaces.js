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

// The people on each project's About card (lib/projects.js profiles): their
// email, full name and phone sort their messages into that project, after the
// rules (Nov 5 2026). Someone listed on more than one project's card, and your
// own addresses, sort nothing: there is no telling which project a message is for.
export function aboutPeople() {
  const out = [], seen = { email: {}, name: {}, phone: {} };
  let mine = new Set();
  try { mine = new Set(ownAddresses().map((a) => String(a || '').toLowerCase())); } catch {}
  for (const [space, p] of Object.entries(getSetting('profiles', {}) || {})) {
    for (const x of Array.isArray(p?.people) ? p.people : []) {
      const email = String(x?.email || '').trim().toLowerCase(), name = String(x?.name || '').trim().replace(/\s+/g, ' '), phone = digits(x?.phone);
      if (email && mine.has(email)) continue;
      const person = { space, name, email: email.includes('@') ? email : '', phone: phone.length === 10 ? phone : '', role: x?.role || '' };
      out.push(person);
      for (const k of ['email', 'name', 'phone']) if (person[k]) (seen[k][person[k].toLowerCase()] ||= new Set()).add(space);
    }
  }
  const one = (k, v) => !v || seen[k][v.toLowerCase()].size === 1;
  return out.map((x) => ({ ...x, email: one('email', x.email) ? x.email : '', name: one('name', x.name) ? x.name : '', phone: one('phone', x.phone) ? x.phone : '' }));
}

const word = (text, space) => ({ re: new RegExp(`(^|[^a-z0-9])${esc(text.toLowerCase())}([^a-z0-9]|$)`, 'i'), addr: /[@.]/.test(text), space });
let cache = { raw: null, own: null, key: null, compiled: [], phones: [] };
const ownKey = () => { try { return ownAddresses().join(','); } catch { return ''; } };
function compiled() {
  // Rebuilt only when the stored rules or About cards change: a mail check sorts
  // thousands of messages at a time, and this is one quick read for each.
  const raw = db.prepare("SELECT group_concat(key || '=' || value, '\n') AS v FROM settings WHERE key IN ('rules', 'profiles')").get()?.v || '';
  if (cache.raw !== raw || cache.own !== ownKey()) {
    const src = rules(), people = aboutPeople(), key = null;
    const derived = [];
    for (const x of people) {
      if (x.email) derived.push(word(x.email, x.space));
      // A full name (two words or more), so "Sam" alone never pulls in every Sam.
      if (x.name && x.name.includes(' ')) derived.push({ ...word(x.name, x.space), addr: false });
    }
    cache = { raw, own: ownKey(), key, compiled: [...src.map(([text, space]) => word(text, space)), ...derived], phones: people.filter((x) => x.phone).map((x) => [x.phone, x.space]) };
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

export function spaceFor(...texts) {
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
// items and rules point at it; a new one takes its id from its name.
export function cleanSpaces(list) {
  const seen = new Set();
  return list.map((x) => {
    const name = String(x?.name || '').trim();
    let id = String(x?.id || name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!name || !id) return null;
    while (seen.has(id)) id += '-2';
    seen.add(id);
    const color = /^#[0-9a-f]{6}$/i.test(x.color) ? x.color : '#8A8F98';
    const from = String(x.from || '').trim().toLowerCase();
    return { name, id, color, group: String(x.group || '').trim() || 'Mine', ...(from ? { from } : {}) };
  }).filter(Boolean);
}

export function saveSpaces(list) { setSetting('spaces', list); }
export function saveRules(list) { setSetting('rules', list); }
