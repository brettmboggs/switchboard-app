// The notebook: pages of notes, each in one of your projects, with #tags
// written anywhere in the text. A page's body is the HTML the editor
// (public/js/editor.js) makes, from a short list of tags it allows (and
// cleans everything else out of, on the page, before showing it). Pages from
// the first notebook are plain lines ("- [ ] eggs"); both are read here.
// Pages sync between computers like everything else (lib/sync.js, document
// "pages"), encrypted; the newest edit of a page wins.
import { randomBytes } from 'node:crypto';
import { db, onLocalChange } from './db.js';

db.exec(`
CREATE TABLE IF NOT EXISTS pages (
  uid TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  space TEXT NOT NULL DEFAULT 'personal',
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS page_tombstones (uid TEXT PRIMARY KEY, at INTEGER NOT NULL);
`);

const MAX_BODY = 200 * 1024;
const TAG = /(^|[\s(])#([a-z][\w-]{0,30})\b/gi;
const isHtml = (b) => /^\s*</.test(b || '');
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };
const unent = (s) => s.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (m, k) => ENT[k]).replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n));
const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// A page as lines of plain text (search, previews, tags).
export function textLines(body) {
  const b = String(body || '');
  if (!isHtml(b)) return b.split('\n').map((l) => l.replace(/^\s*(#{1,3} |- \[[ x]\] |- |\d+\. |> )/i, '').trim());
  return unent(b.replace(/<(br|hr)\b[^>]*>/gi, '\n').replace(/<(li|p|h[1-3]|blockquote|ul|ol)\b[^>]*>/gi, '\n').replace(/<\/(p|li|h[1-3]|blockquote|ul|ol)>/gi, '\n').replace(/<[^>]+>/g, ''))
    .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
export const tagsOf = (text) => [...new Set([...String(text || '').matchAll(TAG)].map((m) => m[2].toLowerCase()))];

// Checkboxes in a page: how many, how many done.
export function checks(body) {
  let total = 0, done = 0;
  const b = String(body || '');
  if (isHtml(b)) { for (const m of b.matchAll(/<li\b[^>]*\bdata-checked="(true|false)"/g)) { total++; if (m[1] === 'true') done++; } return { total, done }; }
  for (const l of b.split('\n')) { const m = l.match(/^\s*- \[( |x)\] /i); if (m) { total++; if (m[1] !== ' ') done++; } }
  return { total, done };
}
const firstText = (body) => (textLines(body).find((l) => l && l !== '---') || '').slice(0, 140);

// For the list: everything but the body.
export function pageList() {
  return db.prepare('SELECT * FROM pages ORDER BY pinned DESC, updated_at DESC').all()
    .map((p) => ({ uid: p.uid, title: p.title, space: p.space, pinned: !!p.pinned, created_at: p.created_at, updated_at: p.updated_at, tags: tagsOf(p.title + '\n' + textLines(p.body).join('\n')), preview: firstText(p.body), checks: checks(p.body), size: p.body.length }));
}
export const getPage = (uid) => db.prepare('SELECT * FROM pages WHERE uid = ?').get(uid) || null;

export function newPage({ title = '', body = '', space = 'personal' } = {}, now = Date.now()) {
  const uid = randomBytes(12).toString('hex');
  db.prepare('INSERT INTO pages (uid, title, body, space, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(uid, String(title).slice(0, 200), String(body).slice(0, MAX_BODY), String(space || 'personal'), now, now);
  onLocalChange();
  return getPage(uid);
}

// Saves what changed. Returns the page.
export function savePage(uid, fields, now = Date.now()) {
  const p = getPage(uid);
  if (!p) throw new Error('That page is gone. It may have been deleted on another computer.');
  const next = {
    title: fields.title !== undefined ? String(fields.title).replace(/\s+/g, ' ').slice(0, 200) : p.title,
    body: fields.body !== undefined ? String(fields.body).replace(/\r\n?/g, '\n') : p.body,
    space: fields.space !== undefined ? String(fields.space) : p.space,
    pinned: fields.pinned !== undefined ? (fields.pinned ? 1 : 0) : p.pinned
  };
  if (next.body.length > MAX_BODY) throw new Error('This page is too long to save (200,000 characters). Split it into two pages.');
  if (next.title === p.title && next.body === p.body && next.space === p.space && next.pinned === p.pinned) return p;
  db.prepare('UPDATE pages SET title = ?, body = ?, space = ?, pinned = ?, updated_at = ? WHERE uid = ?').run(next.title, next.body, next.space, next.pinned, Math.max(now, p.updated_at + 1), uid);
  onLocalChange();
  return getPage(uid);
}

export function deletePage(uid, now = Date.now()) {
  db.prepare('DELETE FROM pages WHERE uid = ?').run(uid);
  db.prepare('INSERT OR REPLACE INTO page_tombstones (uid, at) VALUES (?, ?)').run(uid, now);
  onLocalChange();
}

// ---- search: pages (title and lines), plus reminders, to-dos, routines and quick notes
const norm = (s) => String(s || '').toLowerCase();
export function search(q, limit = 12) {
  const words = norm(q).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hit = (text) => { const t = norm(text); return words.every((w) => t.includes(w)); };
  const out = [];
  for (const p of db.prepare('SELECT * FROM pages ORDER BY updated_at DESC').all()) {
    if (hit(p.title)) { out.push({ type: 'page', uid: p.uid, space: p.space, title: p.title || 'Untitled', line: firstText(p.body), score: 3 }); continue; }
    const lines = textLines(p.body);
    const i = lines.findIndex((l) => hit(l));
    if (i >= 0) out.push({ type: 'page', uid: p.uid, space: p.space, title: p.title || 'Untitled', line: lines[i].slice(0, 140), score: 2 });
    else if (hit(p.title + '\n' + lines.join('\n'))) out.push({ type: 'page', uid: p.uid, space: p.space, title: p.title || 'Untitled', line: firstText(p.body), score: 1 });
  }
  for (const it of db.prepare("SELECT id, kind, text, space, due_at FROM items WHERE kind IN ('note', 'todo', 'reminder', 'routine') AND done_at IS NULL ORDER BY created_at DESC").all()) {
    if (hit(it.text)) out.push({ type: it.kind, id: it.id, space: it.space, title: it.text, due_at: it.due_at, score: 1 });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

// ---- lists and logs from Ctrl K
// A list page: one with a checklist (or bullets). "shopping eggs, milk" finds the page
// called Shopping and adds eggs and milk to its last checklist.
const isListPage = (b) => isHtml(b) ? /<ul\b[^>]*class="checklist"|<ul>/.test(b) : /^\s*(- \[[ x]\] |- )/m.test(b);
export function findListPage(words, space) {
  const list = db.prepare('SELECT * FROM pages ORDER BY updated_at DESC').all().filter((p) => isListPage(p.body));
  const key = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+(list)$/, '').trim();
  return list.find((p) => key(p.title) === key(words) && (!space || space === 'all' || p.space === space)) || list.find((p) => key(p.title) === key(words)) || null;
}
export function addToList(uid, items, now = Date.now()) {
  const p = getPage(uid);
  const clean = items.map((t) => String(t).replace(/\s+/g, ' ').trim().slice(0, 200)).filter(Boolean);
  if (!p || !clean.length) return null;
  let body = p.body;
  if (!isHtml(body)) body = body.replace(/\n*$/, '') + '\n' + clean.map((t) => `- [ ] ${t}`).join('\n');
  else {
    const lis = clean.map((t) => `<li data-checked="false">${escHtml(t)}</li>`).join('');
    const at = body.lastIndexOf('<ul class="checklist">');
    if (at >= 0) { const end = body.indexOf('</ul>', at); body = body.slice(0, end) + lis + body.slice(end); }
    else body += `<ul class="checklist">${lis}</ul>`;
  }
  savePage(uid, { body }, now);
  return { page: getPage(uid), count: clean.length };
}
// "log eggs 14 cracked one": the page "Eggs log" (made if it is not there), newest entry first.
export const logDate = (t) => new Date(t).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
export function addLog(name, amount, note = '', space = 'personal', now = Date.now()) {
  const title = name.trim().replace(/^\w/, (c) => c.toUpperCase()).slice(0, 80) + ' log';
  let p = db.prepare('SELECT * FROM pages WHERE lower(title) = ? ORDER BY updated_at DESC').get(title.toLowerCase());
  if (!p) p = newPage({ title, body: '', space }, now);
  const li = `<li data-at="${now}">${escHtml([logDate(now), amount, note.trim()].filter(Boolean).join(' · '))}</li>`;
  let body = isHtml(p.body) ? p.body : p.body ? `<p>${escHtml(p.body)}</p>` : '';
  const at = body.indexOf('<ul class="log">');
  body = at >= 0 ? body.slice(0, at + 16) + li + body.slice(at + 16) : body + `<ul class="log">${li}</ul>`;
  savePage(p.uid, { body }, now);
  return getPage(p.uid);
}

// "today fed the goats": a line, with the time, on a page named for the day
// ("Tue Nov 4") in that project, made on first use. One page a day that a
// session can read.
export const dayTitle = (t) => new Date(t).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '');
export function addToday(text, space = 'personal', now = Date.now()) {
  const title = dayTitle(now), clean = String(text).replace(/\s+/g, ' ').trim().slice(0, 2000);
  if (!clean) return null;
  let p = db.prepare('SELECT * FROM pages WHERE lower(title) = ? AND space = ? ORDER BY updated_at DESC').get(title.toLowerCase(), space);
  if (!p) p = newPage({ title, body: '', space }, now);
  const time = new Date(now).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const line = `<p>${escHtml(`${time} · ${clean}`)}</p>`;
  const body = isHtml(p.body) ? p.body : p.body.split('\n').filter(Boolean).map((l) => `<p>${escHtml(l)}</p>`).join('');
  savePage(p.uid, { body: body + line }, now);
  return getPage(p.uid);
}

// ---- sync (lib/sync.js): every page and every deletion; the newest edit of a page wins.
export const pagesDoc = {
  read() {
    return { rows: db.prepare('SELECT uid, title, body, space, pinned, created_at, updated_at FROM pages').all(), dead: db.prepare('SELECT uid, at FROM page_tombstones').all() };
  },
  merge(remote) {
    let n = 0;
    for (const t of remote?.dead || []) {
      db.prepare('INSERT OR REPLACE INTO page_tombstones (uid, at) VALUES (?, ?)').run(t.uid, t.at);
      const cur = db.prepare('SELECT updated_at FROM pages WHERE uid = ?').get(t.uid);
      if (cur && cur.updated_at <= t.at) { db.prepare('DELETE FROM pages WHERE uid = ?').run(t.uid); n++; }
    }
    for (const r of remote?.rows || []) {
      const dead = db.prepare('SELECT at FROM page_tombstones WHERE uid = ?').get(r.uid);
      if (dead && dead.at >= r.updated_at) continue;
      const cur = db.prepare('SELECT updated_at FROM pages WHERE uid = ?').get(r.uid);
      if (!cur) { db.prepare('INSERT INTO pages (uid, title, body, space, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(r.uid, r.title, r.body, r.space, r.pinned ? 1 : 0, r.created_at, r.updated_at); n++; }
      else if (cur.updated_at < r.updated_at) { db.prepare('UPDATE pages SET title = ?, body = ?, space = ?, pinned = ?, created_at = ?, updated_at = ? WHERE uid = ?').run(r.title, r.body, r.space, r.pinned ? 1 : 0, r.created_at, r.updated_at, r.uid); n++; }
    }
    db.prepare('DELETE FROM page_tombstones WHERE at < ?').run(Date.now() - 60 * 86400e3);
    return n;
  }
};
