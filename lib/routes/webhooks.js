// Webhooks: add, rename, change project or kind, copy the links, make a new link, test, remove.
// Called by server.js for every request after its host and header checks;
// sends a response when the path is one of these, otherwise does nothing.
// (The doors themselves are /hook/in/<secret> in server.js and the sync service.)
import { addHook, updateHook, newLink, removeHook, links, testHook } from '../webhooks.js';
import { PRODUCT } from '../product.js';
import { getSetting } from '../db.js';
import { send, readJson } from '../http.js';

const server = () => getSetting('sync', null)?.server || PRODUCT.syncUrl;

export async function route({ req, res, path, changed, PORT }) {
  if (req.method !== 'POST' || path !== '/api/webhooks') return;
  const b = await readJson(req, 20000);
  const id = typeof b.id === 'string' ? b.id : '';
  try {
    if (b.add) {
      const newId = await addHook({ name: b.name, space: b.space, kind: b.kind });
      changed();
      return send(res, 200, { ok: true, id: newId, links: links(newId, PORT, server()) });
    }
    if (b.links) {
      const l = links(id, PORT, server());
      return l ? send(res, 200, l) : send(res, 404, { error: 'That webhook is gone.' });
    }
    if (b.newLink) { await newLink(id); changed(); return send(res, 200, { ok: true, links: links(id, PORT, server()) }); }
    if (b.remove) { await removeHook(id); changed(); return send(res, 200, { ok: true }); }
    if (b.test) return send(res, 200, await testHook(id, PORT, server()));
    updateHook(id, { name: b.name, space: b.space, kind: b.kind });
    changed();
    return send(res, 200, { ok: true });
  } catch (e) {
    return send(res, 400, { error: String(e.message || e) });
  }
}
