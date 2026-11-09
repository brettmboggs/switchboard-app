// News and blogs: follow a feed (or a site that has one), rename it, move it to
// a project, stop following; mark posts read.
// Called by server.js for every request after its host and header checks;
// sends a response when the path is one of these, otherwise does nothing.
import { addFeed, removeFeed, editFeed, markRead, markAllRead, feeds, feedStatus } from '../feeds.js';
import { spaces } from '../spaces.js';
import { send, readJson } from '../http.js';
import { friendlyError } from '../friendly.js';

export async function route({ req, res, path, changed }) {
  if (req.method === 'GET' && path === '/api/feeds') return send(res, 200, { feeds: feedStatus() });
  const m = path.match(/^\/api\/feeds(?:\/(add|remove|edit|read|all-read))?$/);
  if (!m || req.method !== 'POST' || !m[1]) return;
  try {
    const b = await readJson(req, 32 * 1024);
    const space = spaces().some((s) => s.id === b.space) ? b.space : undefined;
    if (m[1] === 'add') { const f = await addFeed(b.url, space || 'personal'); changed(); return send(res, 200, { feed: f }); }
    if (m[1] === 'remove') removeFeed(String(b.id));
    if (m[1] === 'edit') editFeed(String(b.id), { name: b.name, space });
    if (m[1] === 'read') markRead(String(b.feed), String(b.guid), b.read !== false);
    if (m[1] === 'all-read') markAllRead((Array.isArray(b.feeds) ? b.feeds : feeds().map((f) => f.id)).map(String));
    changed();
    return send(res, 200, { ok: true });
  } catch (e) { return send(res, 400, { error: friendlyError(e, 'the feed') }); }
}
