// The notebook: open, make, save, delete pages; search everything.
// Called by server.js for every request after its host and header checks;
// sends a response when the path is one of these, otherwise does nothing.
import { getPage, newPage, savePage, deletePage, search } from '../pages.js';
import { searchConversations, olderConversations } from '../search.js';
import { send, readJson } from '../http.js';

export async function route({ req, res, path, url, changed }) {
  // ?all=1 (Ctrl K): conversations too; the notebook's own search asks without it.
  if (req.method === 'GET' && path === '/api/search') {
    const q = url.searchParams.get('q') || '';
    if (!url.searchParams.get('all')) return send(res, 200, { results: search(q) });
    const recent = searchConversations(q);
    return send(res, 200, { results: search(q), convos: [...recent, ...olderConversations(q, { limit: Math.max(2, 8 - recent.length) })] });
  }
  const m = path.match(/^\/api\/pages(?:\/([0-9a-f]{24}))?(\/delete)?$/);
  if (!m) return;
  try {
    if (req.method === 'GET' && m[1]) { const p = getPage(m[1]); return p ? send(res, 200, p) : send(res, 404, { error: 'That page is gone.' }); }
    if (req.method !== 'POST') return;
    const b = await readJson(req, 400 * 1024);
    if (!m[1]) { const p = newPage({ title: b.title || '', body: b.body || '', space: b.space && b.space !== 'all' ? b.space : 'personal' }); changed(); return send(res, 200, p); }
    if (m[2]) { deletePage(m[1]); changed(); return send(res, 200, { ok: true }); }
    const p = savePage(m[1], { title: b.title, body: b.body, space: b.space, pinned: b.pinned });
    changed();
    return send(res, 200, { uid: p.uid, updated_at: p.updated_at });
  } catch (e) { return send(res, 400, { error: String(e.message || e) }); }
}
