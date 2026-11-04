// Spaces are the parts of the user's life. Rules decide which space a repo, window
// or email belongs to: the first rule whose text appears (as a whole word) in the
// thing wins. Both are edited in Settings.
import { getSetting, setSetting } from './db.js';

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
let cache = { src: null, compiled: [] };

function compiled() {
  const src = rules();
  if (cache.src !== src) {
    cache = {
      src,
      compiled: src.map(([text, space]) => ({
        re: new RegExp(`(^|[^a-z0-9])${esc(text.toLowerCase())}([^a-z0-9]|$)`, 'i'),
        addr: /[@.]/.test(text),
        space
      }))
    };
  }
  return cache.compiled;
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
