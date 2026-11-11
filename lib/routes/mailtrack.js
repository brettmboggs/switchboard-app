// Mail tracking (lib/mailtrack.js): connect your tracker, its settings, and one
// sent email's timeline. The list of sent emails and who tracks you come with
// the board (state.mailtrack).
import { send, readJson } from '../http.js';
import { connectTracker, disconnectTracker, trackerSettings, trackedEmail, pollMailtrack, mailtrackForBoard } from '../mailtrack.js';

export async function route({ req, res, path, changed }) {
  if (!path.startsWith('/api/mailtrack')) return;
  if (req.method === 'GET' && path === '/api/mailtrack') return send(res, 200, mailtrackForBoard());
  const one = path.match(/^\/api\/mailtrack\/emails\/([\w-]{1,64})$/);
  if (req.method === 'GET' && one) {
    try { return send(res, 200, await trackedEmail(one[1])); } catch (e) { return send(res, 400, { error: e.message }); }
  }
  if (req.method !== 'POST') return;
  const b = await readJson(req);
  try {
    if (path === '/api/mailtrack/connect') { const r = await connectTracker(b.address, b.token); changed(); return send(res, 200, r); }
    if (path === '/api/mailtrack/disconnect') { disconnectTracker(); changed(); return send(res, 200, { ok: true }); }
    if (path === '/api/mailtrack/settings') { await trackerSettings(b); changed(); return send(res, 200, mailtrackForBoard()); }
    if (path === '/api/mailtrack/refresh') { await pollMailtrack(); changed(); return send(res, 200, mailtrackForBoard()); }
  } catch (e) { return send(res, 400, { error: e.message, signin: !!e.signin }); }
}
