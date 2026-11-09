// Chores and routines: add (typed, or one of the built-in ideas), done, skip, change the schedule or the name.
// Snooze and delete are the items' own (/api/items/<id>/snooze, /delete).
// Called by server.js for every request after its host and header checks;
// sends a response when the path is one of these, otherwise does nothing.
import { addRoutine, advance, reschedule, renameRoutine, IDEAS } from '../routines.js';
import { send, readJson } from '../http.js';
import { friendlyError } from '../friendly.js';

export async function route({ req, res, path, changed }) {
  if (req.method === 'GET' && path === '/api/routines/ideas') return send(res, 200, { ideas: IDEAS.map(([group, line]) => ({ group, line })) });
  if (req.method !== 'POST' || path !== '/api/routines') return;
  const b = await readJson(req, 20000);
  const id = Number(b.id) || 0;
  try {
    if (typeof b.add === 'string') {
      const r = addRoutine(b.add, typeof b.space === 'string' && b.space !== 'all' ? b.space : 'personal');
      if (r.error) return send(res, 400, r);
      changed(); return send(res, 200, r);
    }
    if (b.done || b.skip) { const due = advance(id, { skip: !!b.skip }); changed(); return send(res, 200, { ok: true, due_at: due }); }
    if (typeof b.schedule === 'string') { reschedule(id, b.schedule); changed(); return send(res, 200, { ok: true }); }
    if (typeof b.text === 'string') { renameRoutine(id, b.text); changed(); return send(res, 200, { ok: true }); }
    return send(res, 400, { error: 'Nothing to do.' });
  } catch (e) { return send(res, 400, { error: friendlyError(e, 'Switchboard') }); }
}
