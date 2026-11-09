// The notebook: open, make, save, delete pages; search everything.
// Called by server.js for every request after its host and header checks;
// sends a response when the path is one of these, otherwise does nothing.
import { getPage, newPage, savePage, deletePage, search } from '../pages.js';
import { searchConversations, olderConversations } from '../search.js';
import { send, readJson } from '../http.js';
import { friendlyError } from '../friendly.js';
import { moveOwnCopy } from '../sorting.js';
import { clearNoteMark } from '../notemarks.js';

export async function route({ req, res, path, url, changed }) {
  // A note line's "sent to a session" mark, cleared from the note (lib/notemarks.js).
  if (req.method === 'POST' && path === '/api/notemarks/clear') {
    const b = await readJson(req, 8 * 1024);
    clearNoteMark(b.page, b.line); changed();
    return send(res, 200, { ok: true });
  }
  // ?all=1 (Ctrl K): conversations too; the notebook's own search asks without it.
  if (req.method === 'GET' && path === '/api/search') {
    const q = url.searchParams.get('q') || '';
    if (!url.searchParams.get('all')) return send(res, 200, { results: search(q) });
    const recent = searchConversations(q);
    return send(res, 200, { results: search(q), convos: [...recent, ...olderConversations(q, { limit: Math.max(2, 8 - recent.length) })] });
  }
  // A page, or a section of someone's page shared with you on its own ("sec…", read-only: lib/share.js).
  const m = path.match(/^\/api\/pages(?:\/((?:sec[0-9a-f]{21})|[0-9a-f]{24}))?(\/delete)?$/);
  if (!m) return;
  try {
    if (req.method === 'GET' && m[1]) { const p = getPage(m[1]); return p ? send(res, 200, p) : send(res, 404, { error: 'That page is gone.' }); }
    if (req.method !== 'POST') return;
    const b = await readJson(req, 400 * 1024);
    if (m[1]?.startsWith('sec')) return send(res, 400, { error: 'This is a section of a page in a shared project, shared on its own: it is read-only here. Its owner changes it on their page.' });
    if (!m[1]) { const p = newPage({ title: b.title || '', body: b.body || '', space: b.space && b.space !== 'all' ? b.space : 'personal' }); changed(); return send(res, 200, p); }
    if (m[2]) { deletePage(m[1]); changed(); return send(res, 200, { ok: true }); }
    // A page someone else shared, moved to another project: a copy of your own goes there instead (review H4).
    const own = b.space !== undefined ? moveOwnCopy(m[1], String(b.space)) : null;
    const p = savePage(m[1], { title: b.title, body: b.body, space: own ? undefined : b.space, pinned: b.pinned, private: b.private });
    changed();
    return send(res, 200, { uid: p.uid, updated_at: p.updated_at, ...(own || {}) });
  } catch (e) { return send(res, 400, { error: friendlyError(e, 'Switchboard') }); }
}
