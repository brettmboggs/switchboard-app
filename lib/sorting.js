// Sorting things into projects (Nov 5 2026): what a project holds, what has no
// project yet (Unsorted), and what could be added (the Add picker).
//
// A thing's main project still comes from the rules (lib/spaces.js). Filing
// something that has no project yet writes a rule, so every list that already
// sorts by rules follows. Adding something that already has a main project, or
// a page or a section of one, adds a row in lib/belongs.js instead: it then
// also belongs there.
import { basename } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spaces, rules, spaceFor, spaceForAddress, aboutPeople } from './spaces.js';
import { getSetting, setSetting } from './db.js';
import { folders } from './terminals.js';
import { recentConversations } from './bring.js';
import { belongsAll, addBelongs, removeBelongs } from './belongs.js';
import { hiddenKeys } from './hidden.js';
import { sendAddresses, accounts } from './gmail.js';
import { pageList, getPage, savePage, newPage } from './pages.js';
import { keptPaths } from './keptpaths.js';
import { shareState, sharedBy, moveIsCopy } from './share.js';

const pageBody = (uid) => getPage(uid)?.body || '';

const openOf = (p) => (p.checks?.total || 0) - (p.checks?.done || 0);
const lc = (s) => String(s || '').toLowerCase();
const AUTOMATED = /^(no-?reply|do-?not-?reply|notifications?|mailer-daemon|bounce|alerts?|news(letter)?|support|billing|info|hello|team)@/i;

// The headings in a page, for "only this section". Pages are HTML from the
// editor (h1-h3), or older plain text with # headings.
export function sectionsOf(body) {
  const b = String(body || ''), out = [];
  if (b.trimStart().startsWith('<')) for (const m of b.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)) out.push(m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim());
  else for (const m of b.matchAll(/^#{1,3}\s+(.+)$/gm)) out.push(m[1].trim());
  return out.filter(Boolean).slice(0, 60);
}

// Everything Switchboard knows that can belong to a project, each with its key,
// a label, a line saying what it is, its main project (null: none yet) and the
// rule text that would file it.
function candidates() {
  const hidden = hiddenKeys(), out = [];
  for (const f of folders()) {
    if (f.copyOf || hidden.has('folder:' + f.path)) continue;
    const repo = f.kind === 'repo';
    out.push({
      key: repo ? 'repo:' + f.name : 'folder:' + f.path, kind: repo ? 'repo' : 'folder', label: f.name, path: f.path,
      line: repo ? (f.fork ? 'Fork' : f.others ? `Repo from ${f.owner} on GitHub` : 'Repo') + ' · ' + f.path.replace(/^\/home\/[^/]+|^\/Users\/[^/]+/, '~')
        : 'Folder · not a git repo · ' + f.path.replace(/^\/home\/[^/]+|^\/Users\/[^/]+/, '~'),
      main: spaceFor(f.path, f.name), rule: f.name, at: f.m, notRepo: !repo, fork: !!f.fork, others: !!f.others,
      hideKey: 'folder:' + f.path
    });
  }
  const people = new Map(), domains = new Map();
  // Your own addresses are never someone to sort.
  const mine = new Set([...sendAddresses().map((a) => lc(a.address)), ...accounts().map((a) => lc(a.email))]);
  for (const c of recentConversations()) {
    if (c.kind === 'teams' || c.kind === 'outlook') {
      if (c.kind !== 'teams' || hidden.has('chat:' + c.key)) continue;
      out.push({ key: 'chat:' + c.key, kind: 'chat', label: c.who, line: 'Teams chat · ' + (c.snippet || '').slice(0, 80), main: spaceFor(c.who) , rule: c.who, at: c.date, hideKey: 'chat:' + c.key });
      continue;
    }
    // Texts come from a Voice relay address, and reports from machines: neither is a person to sort.
    if (String(c.kind || '').startsWith('voice') || /dmarc|postmaster|report/i.test(c.who + ' ' + c.from)) continue;
    const addr = lc(c.from);
    if (!addr.includes('@') || mine.has(addr) || AUTOMATED.test(addr) || hidden.has('person:' + addr)) continue;
    const p = people.get(addr) || { key: 'person:' + addr, kind: 'person', label: c.who && !c.who.includes('@') ? c.who : addr, email: addr, n: 0, at: 0, subjects: [] };
    p.n++; p.at = Math.max(p.at, c.date || 0); if (p.subjects.length < 2 && c.subject) p.subjects.push(c.subject);
    people.set(addr, p);
    const d = addr.split('@')[1];
    domains.set(d, (domains.get(d) || 0) + 1);
  }
  const common = /^(gmail|googlemail|outlook|hotmail|live|yahoo|icloud|me|mac|aol|proton|protonmail|msn)\./;
  for (const p of people.values()) {
    out.push({ ...p, line: `${p.email} · ${p.n} conversation${p.n === 1 ? '' : 's'}${p.subjects[0] ? ' · ' + p.subjects[0].slice(0, 60) : ''}`, main: spaceForAddress(p.email), rule: p.email, hideKey: p.key });
  }
  // People on a project's About card, written to or not: one row each, with
  // every address and number in its line. Conversations from any of their
  // addresses fold into that row.
  const pname = (id) => spaces().find((s) => s.id === id)?.name || id;
  const fmtPhone = (d) => d.replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3');
  for (const x of aboutPeople()) {
    if (!x.email && !x.name) continue;
    const key = x.email ? 'person:' + x.email : 'about:' + x.space + ':' + lc(x.name);
    let n = 0, at = 0, had = null, seenAs = '';
    for (const e of x.emails) {
      const i = out.findIndex((o) => o.key === 'person:' + e);
      if (i < 0) continue;
      n += out[i].n || 0; at = Math.max(at, out[i].at || 0); seenAs ||= out[i].label;
      if (out[i].key === key) had = out[i]; else out.splice(i, 1);
    }
    const line = [`On ${pname(x.space)}'s About card`, x.role, ...x.allEmails, ...x.allPhones.map(fmtPhone)].filter(Boolean).join(' · ')
      + (n ? ` · ${n} conversation${n === 1 ? '' : 's'}` : '');
    const row = { key, kind: 'person', label: x.name || seenAs || x.email, email: x.email, emails: x.emails, line, main: x.email ? spaceForAddress(...x.emails) : spaceFor(x.name), rule: x.email || x.name, n, at, about: x.space, hideKey: key };
    if (had) Object.assign(had, row); else out.push(row);
  }
  for (const [d, n] of domains) {
    if (common.test(d) || n < 2) continue;
    out.push({ key: 'domain:@' + d, kind: 'domain', label: 'Anything from @' + d, line: `Every address at ${d} · ${n} conversations`, main: spaceForAddress('x@' + d), rule: d, at: 0 });
  }
  return out;
}

// The likely project for a thing with none: a project whose name is in it, or
// the project most people at the same domain are in.
function suggest(c, list) {
  const sp = spaces();
  const words = lc(c.label + ' ' + (c.email || '') + ' ' + (c.path || ''));
  const named = sp.find((s) => s.id !== 'personal' && lc(s.name).split(/[^a-z0-9]+/).filter((w) => w.length > 2).some((w) => words.includes(w)));
  if (named) return named.id;
  if (c.email) {
    const d = c.email.split('@')[1], counts = {};
    for (const o of list) if (o.email && o.main && o.email.endsWith('@' + d)) counts[o.main] = (counts[o.main] || 0) + 1;
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (best) return best[0];
  }
  return null;
}

// Unsorted: what has no project yet and is not hidden, newest first.
let unsortedCache = { at: 0, list: [] };
export function unsorted({ fresh = false } = {}) {
  if (!fresh && Date.now() - unsortedCache.at < 60e3) return unsortedCache.list;
  const list = candidates(), also = new Set(belongsAll().map((b) => b.key));
  const out = list.filter((c) => !c.main && !also.has(c.key) && c.kind !== 'domain')
    .map((c) => ({ ...c, suggest: suggest(c, list) }))
    .sort((a, b) => (b.at || 0) - (a.at || 0));
  unsortedCache = { at: Date.now(), list: out };
  return out;
}
export const unsortedCount = () => unsorted().length;

// What a project holds: its rules (each shown as the thing it matches, when
// one is known) and what also belongs to it.
export function members(space) {
  const list = candidates(), byRule = new Map(list.map((c) => [lc(c.rule), c]));
  const pages = new Map(pageList().map((p) => [p.uid, p]));
  const out = [];
  rules().forEach(([text, s], i) => {
    if (s !== space) return;
    const c = byRule.get(lc(text));
    const kind = c?.kind || (text.includes('@') ? 'person' : /\.[a-z]{2,}$/i.test(text) ? 'domain' : 'word');
    out.push({ key: c?.key || 'rule:' + text, kind, label: kind === 'domain' && !c ? 'Anything from @' + text : c?.label || text, line: c?.line || (kind === 'word' ? `Anything named with "${text}"` : ''), rule: text, ruleIndex: i, main: true });
  });
  for (const b of belongsAll()) {
    if (b.space !== space) continue;
    const [kind, rest] = [b.key.split(':')[0], b.key.slice(b.key.indexOf(':') + 1)];
    let label = b.label, line = '';
    if (kind === 'page' || kind === 'section') {
      const uid = rest.split('#')[0], p = pages.get(uid);
      if (!p) continue;   // the page was deleted
      label = kind === 'page' ? (p.title || 'Untitled') : `${p.title || 'Untitled'} → ${rest.slice(uid.length + 1)}`;
      line = (kind === 'page' ? 'Whole page' : 'One section of the page') + (openOf(p) ? ` · ${openOf(p)} open checkbox${openOf(p) === 1 ? '' : 'es'}` : '') + (b.repo ? ` · shows in ${b.repo} sessions` : '');
    } else {
      const c = list.find((x) => x.key === b.key);
      label = label || c?.label || rest; line = c?.line || '';
    }
    out.push({ key: b.key, kind, label, line, repo: b.repo, main: false });
  }
  // The people on this project's About card are in it: change them there.
  for (const c of list) if (c.about === space && !out.some((m) => m.key === c.key || (m.rule && c.rule && lc(m.rule) === lc(c.rule)))) out.push({ key: c.key, kind: 'person', label: c.label, line: c.line, main: true, own: true, from: 'about' });
  // A page whose own project is this one is in it too.
  // Personal has nowhere to move a page to, and a shared page someone else shared stays for everyone:
  // × takes either off this card instead (offCard).
  const off = new Set(getSetting('offCard', {})[space] || []);
  for (const p of pages.values()) if (p.space === space && !off.has('page:' + p.uid) && !out.some((m) => m.key === 'page:' + p.uid)) out.push({ key: 'page:' + p.uid, kind: 'page', label: p.title || 'Untitled', line: 'Its own project' + (openOf(p) ? ` · ${openOf(p)} open checkboxes` : ''), main: true, own: true, from: space === 'personal' ? 'card' : 'page' });
  return out;
}

// The Add picker: everything that could be added, best first. With no search,
// the suggestions for this project; with one, anything that matches.
export function addable(space, q = '') {
  const have = new Set(members(space).map((m) => m.key)), needle = lc(q).trim();
  const sp = spaces().find((s) => s.id === space);
  let list = candidates().filter((c) => !have.has(c.key));
  for (const p of pageList()) {
    if (!have.has('page:' + p.uid)) list.push({ key: 'page:' + p.uid, kind: 'page', label: p.title || 'Untitled', line: 'Page' + (p.space ? ' in ' + (spaces().find((s) => s.id === p.space)?.name || p.space) : ''), main: p.space, at: p.updated_at });
    if (needle) for (const h of sectionsOf(pageBody(p.uid))) {
      const key = `section:${p.uid}#${h}`;
      if (!have.has(key)) list.push({ key, kind: 'section', label: `${p.title || 'Untitled'} → ${h}`, line: 'One section of a page', at: p.updated_at - 1 });
    }
  }
  const named = sp ? lc(sp.name).split(/[^a-z0-9]+/).filter((w) => w.length > 2) : [];
  const score = (c) => {
    const hay = lc(c.label + ' ' + (c.line || '') + ' ' + (c.email || ''));
    if (needle) return hay.includes(needle) ? (lc(c.label).startsWith(needle) ? 3 : 2) : 0;
    return (named.some((w) => hay.includes(w)) ? 2 : 0) + (c.main ? 0 : 1);
  };
  const hits = list.map((c) => ({ c, s: score(c) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s || (b.c.at || 0) - (a.c.at || 0)).slice(0, 12)
    .map(({ c }) => ({ key: c.key, kind: c.kind, label: c.label, line: c.line + (c.main && c.main !== space && !['page', 'section'].includes(c.kind) ? ' · already in ' + (spaces().find((s) => s.id === c.main)?.name || c.main) : ''), hasMain: !!c.main, rule: c.rule }));
  const typed = typedThing(q);
  if (typed && !have.has('rule:' + typed.rule) && !hits.some((h) => lc(h.rule) === lc(typed.rule))) {
    // Another project's rule already has it: say so, since adding it here moves it (review L2).
    const there = ruleHomes(typed.rule, space);
    hits.push(there.length ? { ...typed, line: typed.line + ` · now in ${there.join(', ')}; adding it here moves it` } : typed);
  }
  return hits;
}

// Something typed into the Add picker that Switchboard has not seen yet: an
// address, a domain, or a name (a person on Teams, a client, a word in window
// titles). Filing it writes it as a rule, the same as Settings, Projects.
export function typedThing(q) {
  const t = String(q || '').trim().replace(/\s+/g, ' ');
  if (t.length < 2 || t.length > 120) return null;
  const email = t.match(/[^\s<>"',]+@[^\s<>"',]+\.[a-z]{2,}/i)?.[0];
  if (email) {
    const name = t.replace(email, '').replace(/[<>"',]/g, ' ').trim();
    return { key: 'new:' + lc(email), kind: 'person', label: name || lc(email), rule: lc(email), line: `Add ${name ? name + ', ' : ''}${lc(email)} · their email comes here` };
  }
  if (/^@?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(t)) {
    const d = lc(t.replace(/^@/, ''));
    return { key: 'new:' + d, kind: 'domain', label: 'Anything from @' + d, rule: d, line: `Add every address at ${d}` };
  }
  return { key: 'new:' + lc(t), kind: 'person', label: t, rule: t, line: `Add "${t}" · Teams chats, messages and sessions with this name come here. Add their email address too to bring in their mail` };
}

// File a thing in a project. With no main project yet (and a rule that can
// match it), a rule makes this its main project; otherwise it also belongs.
// The other projects whose rules have this text, by name.
const ruleHomes = (text, space) => [...new Set(getSetting('rules', []).filter(([r, s]) => lc(r) === lc(text) && s !== space).map(([, s]) => spaces().find((x) => x.id === s)?.name || s))];
// A rule now this project's: the same text in any other project goes, rather than stay behind it unseen.
function moveRule(text, space) {
  const movedFrom = ruleHomes(text, space);
  setSetting('rules', [[text, space], ...getSetting('rules', []).filter(([r]) => lc(r) !== lc(text))]);
  unsortedCache.at = 0;
  return { main: true, ...(movedFrom.length ? { movedFrom: movedFrom.join(', ') } : {}) };
}
export function fileIn(space, { key, label, repo }) {
  if (!spaces().some((s) => s.id === space)) throw new Error('That project is gone. Pick another one.');
  if (key.startsWith('new:')) {
    const t = typedThing(key.slice(4));
    if (!t) throw new Error('Type a name, an email address or a domain first.');
    return moveRule(t.rule, space);
  }
  const c = candidates().find((x) => x.key === key);
  if (c && !c.main && c.rule && ['repo', 'folder', 'person', 'domain', 'chat'].includes(c.kind)) return moveRule(c.rule, space);
  addBelongs({ space, key, label: label || c?.label, repo });
  unsortedCache.at = 0;
  return { main: false };
}

// Take a thing out of a project: its rule (main) or its row.
// A page whose own project this is moves to Personal; a person on the About
// card comes off the card. What comes back says how to undo it (fileIn's restore).
// Off this computer's card for a project (the thing itself stays where it is).
function offCard(space, key) {
  const all = getSetting('offCard', {});
  setSetting('offCard', { ...all, [space]: [...new Set([...(all[space] || []), key])].slice(-2000) });
}

// The notebook's project menu (lib/routes/pages.js). Moving a page out of a shared project sends it as gone
// to everyone, so a page someone else shared is never moved: you get a copy of your own in the project you
// picked, and theirs comes off your card in the shared one, for you only (review H4).
// Returns null when it is an ordinary move (the caller saves it), or { copy, sharedBy }.
export function moveOwnCopy(uid, space) {
  const p = getPage(uid);
  const by = p ? moveIsCopy(p.uid, p.space, space) : null;
  if (!by) return null;
  if (!spaces().some((s) => s.id === space)) throw new Error('That project is gone. Pick another one.');
  const copy = newPage({ title: p.title, body: p.body, space });
  offCard(p.space, 'page:' + p.uid);
  unsortedCache.at = 0;
  return { copy: { uid: copy.uid, space }, sharedBy: by, stays: p.space };
}

export function takeOut(space, { key, rule }) {
  let restore = null;
  // The rules taken away, with where each was, so Undo puts them back in place (review M6).
  let gone = [];
  if (rule != null) {
    const all = getSetting('rules', []);
    gone = all.map((r, i) => [i, r]).filter(([, [t, s]]) => s === space && t === rule);
    if (gone.length) setSetting('rules', all.filter(([t, s]) => !(s === space && t === rule)));
  }
  removeBelongs({ space, key });
  let extra = {};
  if (key.startsWith('page:')) {
    const p = getPage(key.slice(5));
    // In a shared project, moving a page out sends it as gone to everyone (lib/share.js). Only whoever
    // shared it may do that; anyone else's × takes it off their own card and it stays (review H4).
    const shared = space !== 'personal' ? shareState().projects?.[space] : null;
    const by = p ? sharedBy()[p.uid] || null : null;   // from this computer's share records, so right even before the first sync
    if (p && p.space === space && space !== 'personal' && !by) {
      savePage(p.uid, { space: 'personal' }); restore = { page: p.uid };
      if (shared) extra = { unshared: (shared.members || []).length };
    }
    else if (p && p.space === space) {
      if (by) extra = { sharedBy: by };
      offCard(space, key);
      restore = { onCard: key };
    }
  }
  if (key.startsWith('person:') || key.startsWith('about:')) {
    const all = getSetting('profiles', {}), card = all[space];
    const people = Array.isArray(card?.people) ? card.people : [];
    // By any of their emails; by name, the ones with no email first, so × never takes another person of
    // that name too (review L2). Someone whose email is on two cards also has a name tile: then the name is all there is.
    const mails = (x) => [x.email, ...(Array.isArray(x.emails) ? x.emails : [])].map((e) => lc(e).trim()).filter(Boolean);
    const byName = (x) => key === 'about:' + space + ':' + lc(x.name).trim().replace(/\s+/g, ' ');
    const noEmail = people.some((x) => byName(x) && !mails(x).length);
    const isIt = (x) => mails(x).some((e) => key === 'person:' + e) || (byName(x) && (!noEmail || !mails(x).length));
    const gone = people.filter(isIt);
    if (gone.length) { setSetting('profiles', { ...all, [space]: { ...card, people: people.filter((x) => !isIt(x)) } }); restore = { people: gone }; }
  }
  if (gone.length) restore = { ...(restore || {}), rules: gone };
  unsortedCache.at = 0;
  // What Undo may put back is kept here, not trusted from the page (review M5): the page gets an id.
  if (restore) {
    const id = randomBytes(12).toString('hex');
    restores.set(id, { space, rec: restore, at: Date.now() });
    for (const [k, v] of restores) if (Date.now() - v.at > UNDO_FOR) restores.delete(k);
    restore = { ...restore, id };
  }
  return { restore, ...extra };
}

// Undo a takeOut: the page back in the project, the people back on the card.
// Undo records: id -> { space, rec, at }, for a quarter of an hour, used once.
const restores = new Map();
const UNDO_FOR = 15 * 60e3;
export function putBack(space, restore) {
  if (!spaces().some((s) => s.id === space)) throw new Error('That project is gone.');
  const kept = restores.get(String(restore?.id || ''));
  if (!kept || kept.space !== space || Date.now() - kept.at > UNDO_FOR) throw new Error('That can no longer be undone. Add it to the project again from Add.');
  restores.delete(String(restore.id));
  const rec = kept.rec;
  // A page goes back only if it is still where × put it (Personal): a later move stands.
  if (rec.page) { const p = getPage(String(rec.page)); if (p && p.space === 'personal') savePage(p.uid, { space }); }
  if (Array.isArray(rec.rules) && rec.rules.length) {
    const now = [...getSetting('rules', [])];
    for (const [i, r] of rec.rules) if (!now.some(([t, s]) => t === r[0] && s === r[1])) now.splice(Math.min(i, now.length), 0, r);
    setSetting('rules', now);
  }
  if (rec.onCard) { const all = getSetting('offCard', {}); setSetting('offCard', { ...all, [space]: (all[space] || []).filter((k) => k !== rec.onCard) }); }
  if (Array.isArray(rec.people) && rec.people.length) {
    const all = getSetting('profiles', {}), card = all[space] || {};
    const now = Array.isArray(card.people) ? card.people : [];
    const same = (a, b) => (lc(a.email).trim() && lc(a.email).trim() === lc(b.email).trim()) || (!a.email && !b.email && lc(a.name).trim() === lc(b.name).trim());
    const back = rec.people.filter((x) => !now.some((y) => same(x, y)));
    if (back.length) setSetting('profiles', { ...all, [space]: { ...card, people: [...now, ...back].slice(0, 50) } });
  }
  unsortedCache.at = 0;
}

export const repoOfPath = (p) => basename(String(p || ''));

// A picture or file in a note, as text an agent can follow: where it is on this computer (keptPaths).
const attr = (tag, name) => (tag.match(new RegExp(`\\b${name}="([^"]*)"`, 'i')) || [])[1] || '';
const pictureText = (tag) => { const src = attr(tag, 'src'); return src.startsWith('/api/') ? ` [picture ${attr(tag, 'alt') || ''}: ${src}] `.replace(/ :/, ':') : ''; };

// A page, or one section of it (the heading and what follows until the next
// heading), as plain text for a session or an agent: headings as "## ",
// checkboxes as "- [ ]" and "- [x]".
export function noteText(uid, section = null) {
  const p = getPage(uid);
  if (!p) return null;
  let b = String(p.body || '');
  const html = b.trimStart().startsWith('<');
  if (section) {
    const parts = html ? b.split(/(?=<h[1-3][^>]*>)/i) : b.split(/(?=^#{1,3}\s)/m);
    const hit = parts.find((s) => sectionsOf(s)[0] === section);
    if (!hit) return null;
    b = hit;
  }
  const text = html
    ? b.replace(/(<li\b[^>]*>)\s*<p\b[^>]*>/gi, '$1').replace(/<img\b[^>]*>/gi, (t) => pictureText(t)).replace(/<a\b[^>]*class="file-link"[^>]*>([\s\S]*?)<\/a>/gi, (t, name) => `${name} [file: ${attr(t, 'href')}]`)
      .replace(/<h[1-3][^>]*>/gi, '\n## ').replace(/<li\b[^>]*data-checked="true"[^>]*>/gi, '\n- [x] ').replace(/<li\b[^>]*data-checked="false"[^>]*>/gi, '\n- [ ] ').replace(/<li\b[^>]*>/gi, '\n- ')
      .replace(/<(br|hr|p|blockquote|ul|ol)\b[^>]*>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    : b;
  const body = keptPaths(text).split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trimEnd()).filter((l) => l.trim()).join('\n');
  return { title: p.title || 'Untitled', section, text: body };
}

// The notes for a session: pages and sections in its project (its main
// project or also), and those tied to its repo. A note tied to another repo is
// left out.
export function notesFor({ space, repo }) {
  const out = [], seen = new Set();
  const rows = belongsAll();
  const tiedElsewhere = (key) => rows.some((b) => b.key === key && b.repo && b.repo !== repo);
  for (const b of rows) {
    if (!b.key.startsWith('page:') && !b.key.startsWith('section:')) continue;
    if (!(b.space === space || (repo && b.repo === repo))) continue;
    if (b.repo && b.repo !== repo) continue;
    if (seen.has(b.key)) continue;
    seen.add(b.key);
    const [uid, section] = b.key.slice(b.key.indexOf(':') + 1).split('#');
    const p = getPage(uid);
    if (p) out.push({ key: b.key, uid, section: section || null, title: p.title || 'Untitled', updated: p.updated_at, repo: b.repo });
  }
  if (space && space !== 'personal') for (const p of pageList()) {
    const key = 'page:' + p.uid;
    if (p.space === space && !seen.has(key) && !tiedElsewhere(key)) { seen.add(key); out.push({ key, uid: p.uid, section: null, title: p.title || 'Untitled', updated: p.updated_at, open: openOf(p) }); }
  }
  for (const n of out) if (n.open == null) { const p = pageList().find((x) => x.uid === n.uid); n.open = p ? openOf(p) : 0; }
  return out.sort((a, b) => (b.repo ? 1 : 0) - (a.repo ? 1 : 0) || b.updated - a.updated).slice(0, 12);
}

// What Settings, Projects offers as you type a rule: every repo, folder,
// person, chat and domain Switchboard knows, with the rule text that files it.
export function ruleChoices() {
  const seen = new Set(), out = [];
  const name = (id) => spaces().find((s) => s.id === id)?.name || id;
  for (const c of candidates()) {
    if (!c.rule || seen.has(lc(c.rule))) continue;
    seen.add(lc(c.rule));
    out.push({ rule: c.rule, kind: c.kind, label: c.label, main: c.main || null, line: `${({ repo: 'Repo', folder: 'Folder', person: 'Person', domain: 'Address', chat: 'Teams chat' })[c.kind] || ''}${c.label !== c.rule ? ' · ' + c.label : ''}${c.main ? ' · in ' + name(c.main) : ''}` });
  }
  const order = { repo: 0, chat: 1, person: 2, domain: 3, folder: 4 };
  return out.sort((a, b) => (order[a.kind] ?? 5) - (order[b.kind] ?? 5) || lc(a.label).localeCompare(lc(b.label)));
}
