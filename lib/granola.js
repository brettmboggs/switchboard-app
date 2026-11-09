// Granola: your meeting notes, each one a page in Notes, in the project the
// meeting belongs to (its Granola folder, who was in it, its title), so you
// and your sessions can read them (switchboard_notes). Read only: nothing goes
// back to Granola.
//
// Two ways in. Signed in (any plan, the free one too): Granola's MCP server,
// lib/granolamcp.js, read by pollSignedIn below. Or Granola's public API (public-api.granola.ai/v1) with a personal API key
// (grn_…), made in Granola, Settings, Connectors, API keys; Granola gives
// those on its Business plan. The key is a secret setting (db.js
// SECRET_SETTINGS, locked on disk) and never goes to the page. Only
// public-api.granola.ai is ever asked. Granola's webhooks need an address on
// the internet, which this computer is not, so Switchboard asks every 10
// minutes for notes changed since it last looked.
//
// A note's page has an id made from the note's own id, so two computers that
// both read Granola make the same page and sync keeps one. A page you have
// changed in Switchboard is left as you made it; one you deleted stays deleted.
import { createHash } from 'node:crypto';
import { db, getSetting, setSetting, onLocalChange } from './db.js';
import { spaces, spaceForAddress, spaceFor } from './spaces.js';
import { friendlyError } from './friendly.js';
import { granolaSignOut, granolaTool, parseMeetings } from './granolamcp.js';

const API = 'https://public-api.granola.ai/v1';
const FIRST_DAYS = 30;          // how far back the first read goes
const MAX_BODY = 190 * 1024;    // under pages.js's 200 KB
// A public API note id (not_…), or a meeting id from Granola's MCP server (a UUID).
const NOTE_ID = /^(not_[a-z0-9]{14}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

db.exec(`CREATE TABLE IF NOT EXISTS granola_notes (
  note_id TEXT PRIMARY KEY, page_uid TEXT NOT NULL, note_updated TEXT, page_updated INTEGER
)`);

const conf = () => getSetting('granola', {});
let state = { ok: null, error: null, at: 0, count: 0 };

export const pageUid = (noteId) => createHash('sha256').update('granola:' + String(noteId).toLowerCase()).digest('hex').slice(0, 24);

async function granola(path, key, fetchImpl = fetch) {
  const r = await fetchImpl(API + path, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, signal: AbortSignal.timeout(20000), redirect: 'error' });
  if (r.status === 401 || r.status === 403) throw new Error('Granola did not accept that API key. Make a new one in Granola, Settings, Connectors, API keys, and paste it here.');
  if (r.status === 429) throw new Error('Granola asked Switchboard to slow down; it tries again in a few minutes.');
  if (r.status === 404) return null;   // a note still being written up
  if (!r.ok) throw new Error(`Granola answered ${r.status}. Switchboard tries again in a few minutes.`);
  return r.json();
}

// ---- Granola's Markdown summary to the HTML Notes keeps (public/js/sanitize.js):
// headings, bullets (nested by indent), numbered lists, to-do boxes, bold and
// italic, paragraphs. Links come out as their text and address.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inline = (s) => esc(s)
  .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (m, t, u) => t === u ? u : `${t} (${u})`)
  .replace(/\*\*(.+?)\*\*|__(.+?)__/g, (m, a, b) => `<b>${a ?? b}</b>`)
  .replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, '$1<i>$2</i>');
export function mdToHtml(md) {
  const out = [];
  const stack = [];   // open lists: { kind, indent }
  const close = (to = -1) => { while (stack.length && stack.at(-1).indent > to) out.push(`</li></${stack.pop().tag}>`); };
  let para = [];
  const flush = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } };
  for (const raw of String(md || '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\t/g, '    ');
    const item = line.match(/^(\s*)(?:[-*+]|(\d+)[.)])\s+(\[( |x|X)\]\s+)?(.*)$/);
    if (item) {
      flush();
      const indent = item[1].length, kind = item[4] !== undefined ? 'check' : item[2] ? 'ol' : 'ul';
      const tag = kind === 'ol' ? 'ol' : 'ul';
      close(indent);
      const top = stack.at(-1);
      if (top && top.indent === indent && top.kind !== kind) { out.push(`</li></${stack.pop().tag}>`); }
      if (stack.at(-1)?.indent === indent) out.push('</li>');
      else { stack.push({ kind, tag, indent }); out.push(kind === 'check' ? '<ul class="checklist">' : `<${tag}>`); }
      out.push(kind === 'check' ? `<li data-checked="${item[4] === ' ' ? 'false' : 'true'}">${inline(item[5])}` : `<li>${inline(item[5])}`);
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    close();
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { flush(); const n = Math.min(h[1].length, 3); out.push(`<h${n}>${inline(h[2].replace(/\s+#+$/, ''))}</h${n}>`); continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); out.push('<hr>'); continue; }
    const q = line.match(/^\s*>\s?(.*)$/);
    if (q) { flush(); out.push(`<blockquote>${inline(q[1])}</blockquote>`); continue; }
    para.push(line.trim());
  }
  flush(); close();
  return out.join('');
}

// A Granola note as a Notes page: who and when on top, the summary, then your
// own notes from the meeting, and where to open it in Granola.
export function notePage(n) {
  const start = Date.parse(n.calendar_event?.scheduled_start_time || '') || Date.parse(n.created_at) || Date.now();
  const when = new Date(start).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const owner = String(n.owner?.email || '').toLowerCase();
  const people = (n.attendees || []).filter((a) => a && String(a.email || '').toLowerCase() !== owner).map((a) => a.name || a.email).filter(Boolean);
  const head = `<p>${esc(`Meeting · ${when}${people.length ? ' · with ' + people.slice(0, 8).join(', ') + (people.length > 8 ? ` and ${people.length - 8} more` : '') : ''}`)}</p>`;
  const summary = n.summary_markdown ? mdToHtml(n.summary_markdown) : n.summary_text ? mdToHtml(n.summary_text) : '';
  const mine = n.private_notes_markdown || n.private_notes_text;
  const body = head + summary + (mine ? '<h2>My notes</h2>' + mdToHtml(mine) : '') + (n.web_url ? `<p>${esc('In Granola: ' + n.web_url)}</p>` : '');
  const title = String(n.title || n.calendar_event?.event_title || 'Meeting').replace(/\s+/g, ' ').trim().slice(0, 200);
  return { title, body: body.slice(0, MAX_BODY), at: start };
}

// The project: a Granola folder named like one of your projects, then whoever
// was in the meeting (Settings, Projects rules on addresses), then the
// meeting's title; else Personal. There is no one project for all of Granola:
// any meeting page can be moved to any project, like any page.
export function noteSpace(n) {
  const key = (x) => String(x || '').trim().toLowerCase();
  for (const f of n.folders || []) { const sp = spaces().find((x) => key(x.name) === key(f) || key(x.id) === key(f)); if (sp) return sp.id; }
  const owner = String(n.owner?.email || '').toLowerCase();
  const addrs = [...(n.attendees || []).map((a) => a?.email), ...(n.calendar_event?.invitees || []).map((a) => a?.email), n.calendar_event?.organiser]
    .map((a) => String(a || '').toLowerCase()).filter((a) => a && a !== owner);
  const ids = new Set(spaces().map((s) => s.id));
  const hit = spaceForAddress(...addrs) || spaceFor(n.title || '', n.calendar_event?.event_title || '', ...(n.folders || []));
  return hit && ids.has(hit) ? hit : 'personal';
}

// Put one note in Notes. Returns true when a page was made or changed.
export function saveNote(n, now = Date.now()) {
  const id = String(n.id || '');
  if (!NOTE_ID.test(id) || n.deleted_at) return false;
  const uid = pageUid(id);
  const seen = db.prepare('SELECT * FROM granola_notes WHERE note_id = ?').get(id);
  const page = db.prepare('SELECT uid, updated_at FROM pages WHERE uid = ?').get(uid);
  if (seen?.note_updated === n.updated_at && page) return false;
  if (!page && (seen || db.prepare('SELECT 1 FROM page_tombstones WHERE uid = ?').get(uid))) return false;   // you deleted it
  if (page && seen && page.updated_at > seen.page_updated) return false;   // you changed it here: yours now
  const p = notePage(n);
  const at = Math.max(now, (page?.updated_at || 0) + 1);
  if (page) db.prepare('UPDATE pages SET title = ?, body = ?, space = ?, updated_at = ? WHERE uid = ?').run(p.title, p.body, noteSpace(n), at, uid);   // filed in a Granola folder since: it follows
  else db.prepare('INSERT INTO pages (uid, title, body, space, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(uid, p.title, p.body, noteSpace(n), p.at, at);
  db.prepare('INSERT OR REPLACE INTO granola_notes (note_id, page_uid, note_updated, page_updated) VALUES (?, ?, ?, ?)').run(id, uid, n.updated_at || null, at);
  onLocalChange();
  return true;
}

let busy = false;
// Notes changed since the last look (the first time: the last 30 days), each
// read in full and put in Notes. Granola allows 5 requests a second; this
// asks for one note at a time, a quarter second apart.
export async function pollGranola(fetchImpl = fetch, { pause = 250 } = {}) {
  const c = conf();
  if (!c.key && c.refreshToken) return pollSignedIn(fetchImpl === fetch ? granolaTool : fetchImpl);
  if (!c.key) { const had = state.ok !== null; state = { ok: null, error: null, at: 0, count: 0 }; return had; }
  if (busy) return false;
  busy = true;
  const before = JSON.stringify(state), started = new Date().toISOString();
  let changed = 0;
  try {
    const since = c.since || new Date(Date.now() - FIRST_DAYS * 86400e3).toISOString();
    const field = c.since ? 'updated_after' : 'created_after';
    let cursor = null, pages = 0;
    do {
      const q = new URLSearchParams({ [field]: since, page_size: '30', ...(cursor ? { cursor } : {}) });
      const list = await granola('/notes?' + q, c.key, fetchImpl);
      for (const s of list?.notes || []) {
        if (!NOTE_ID.test(String(s.id || ''))) continue;
        const known = db.prepare('SELECT note_updated FROM granola_notes WHERE note_id = ?').get(s.id);
        if (known && known.note_updated === s.updated_at) continue;
        if (pause) await new Promise((r) => setTimeout(r, pause));
        const n = await granola(`/notes/${encodeURIComponent(s.id)}`, c.key, fetchImpl);
        if (n && saveNote(n)) changed++;
      }
      cursor = list?.hasMore ? list.cursor : null;
    } while (cursor && ++pages < 20);
    setSetting('granola', { ...conf(), since: started });
    state = { ok: true, error: null, at: Date.now(), count: db.prepare('SELECT COUNT(*) AS n FROM granola_notes').get().n };
  } catch (e) {
    state = { ...state, ok: false, error: friendlyError(e, 'Granola'), at: Date.now() };
  } finally { busy = false; }
  return changed > 0 || JSON.stringify(state) !== before;
}

export async function connectGranola(key, fetchImpl = fetch) {
  key = String(key || '').trim();
  if (!/^grn_[A-Za-z0-9_-]{8,200}$/.test(key)) throw new Error('That does not look like a Granola API key: it starts with grn_. Make one in Granola, Settings, Connectors, API keys.');
  await granola('/notes?page_size=1', key, fetchImpl);   // throws in plain words if Granola says no
  setSetting('granola', { key });
  state = { ok: null, error: null, at: 0, count: 0 };
}

// Signed in (lib/granolamcp.js): read through Granola's MCP server. The list
// of meetings changed since the last look (the first time: the last 30 days,
// all a free plan shows), then the changed ones read in full, ten a call.
async function pollSignedIn(tool = granolaTool) {
  if (busy) return false;
  busy = true;
  const c = conf(), before = JSON.stringify(state), started = new Date().toISOString();
  let changed = 0;
  try {
    if (c.needsSignIn) throw Object.assign(new Error('Granola signed Switchboard out. Press Sign in with Granola again.'), { signin: true });
    const want = [];
    let cursor = null, pages = 0;
    do {
      const args = { ...(c.since ? { updated_after: c.since } : { time_range: 'last_30_days' }), limit: 100, max_participants: 20, ...(cursor ? { cursor } : {}) };
      const r = parseMeetings((await tool('list_meetings', args)).text);
      for (const m of r.meetings) {
        if (!NOTE_ID.test(m.id)) continue;
        const known = db.prepare('SELECT note_updated FROM granola_notes WHERE note_id = ?').get(m.id);
        if (!known || known.note_updated !== m.updated_at) want.push(m.id);
      }
      cursor = r.more ? r.cursor : null;
    } while (cursor && ++pages < 20);
    for (let i = 0; i < want.length; i += 10) {
      const r = parseMeetings((await tool('get_meetings', { meeting_ids: want.slice(i, i + 10), attachments: 'none', max_participants: 20 })).text);
      for (const n of r.meetings) if (n.full && saveNote(n)) changed++;
    }
    setSetting('granola', { ...conf(), since: started });
    state = { ok: true, error: null, at: Date.now(), count: db.prepare('SELECT COUNT(*) AS n FROM granola_notes').get().n };
  } catch (e) {
    state = { ...state, ok: false, error: e.signin ? e.message : friendlyError(e, 'Granola'), at: Date.now() };
  } finally { busy = false; }
  return changed > 0 || JSON.stringify(state) !== before;
}
// Disconnect (or Sign out): the key or sign-in is gone from this computer; the pages already in Notes stay yours.
export function disconnectGranola() {
  granolaSignOut();
  const { client } = conf();
  setSetting('granola', client ? { client } : {});
  state = { ok: null, error: null, at: 0, count: 0 };
}

export function granolaStatus() {
  const c = conf();
  if (c.key) return { connected: true, via: 'key', ...state };
  if (c.refreshToken) return { connected: true, via: 'signin', email: c.email || '', needsSignIn: !!c.needsSignIn, ...state };
  return { connected: false };
}
