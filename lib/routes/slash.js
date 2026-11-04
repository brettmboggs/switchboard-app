// The slash commands a session's folder offers (lib/slash.js), for the message
// bar's "/" menu: GET /api/terms/<id>/slash.
// Called by server.js for every request after its host and header checks;
// sends a response when the path is one of these, otherwise does nothing.
import { db } from '../db.js';
import { slashCommands } from '../slash.js';
import { send } from '../http.js';

export async function route({ req, res, path }) {
  const m = path.match(/^\/api\/terms\/([\w-]+)\/slash$/);
  if (!m || req.method !== 'GET') return;
  const t = db.prepare('SELECT cwd FROM terms WHERE id = ? AND ended_at IS NULL').get(m[1]);
  if (!t) return send(res, 404, { error: 'That session has ended.' });
  return send(res, 200, slashCommands(t.cwd));
}
