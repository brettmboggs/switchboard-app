// Recurring costs on Money: add, edit, and "not recurring" for a charge
// Switchboard thought came back like a subscription. Delete is the items' own
// (/api/items/<id>/delete).
// Called by server.js for every request after its host and header checks;
// sends a response when the path is one of these, otherwise does nothing.
import { addCost, editCost, markNotRecurring } from '../costs.js';
import { send, readJson } from '../http.js';

export async function route({ req, res, path, changed }) {
  const m = path.match(/^\/api\/costs(?:\/(\d+|not-recurring))?$/);
  if (!m || req.method !== 'POST') return;
  try {
    const b = await readJson(req, 20 * 1024);
    if (!m[1]) { const id = addCost(b); changed(); return send(res, 200, { id }); }
    if (m[1] === 'not-recurring') { markNotRecurring(b.name); changed(); return send(res, 200, { ok: true }); }
    editCost(Number(m[1]), b); changed(); return send(res, 200, { ok: true });
  } catch (e) { return send(res, 400, { error: String(e.message || e) }); }
}
