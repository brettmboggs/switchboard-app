// Browser checks (lib/browserchecks.js): add, change, run, cancel and remove a
// check; a run's output and its screenshots.
// Called by server.js for every request after its host and header checks;
// sends a response when the path is one of these, otherwise does nothing.
import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { saveCheck, removeCheck, runCheck, cancelRun, inspectFolder, runDetail, shotFile } from '../browserchecks.js';
import { send, readJson } from '../http.js';

const TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

export async function route({ req, res, path, changed }) {
  if (!path.startsWith('/api/checks')) return;
  if (req.method === 'GET') {
    const shot = path.match(/^\/api\/checks\/runs\/(\d+)\/shot\/(\d+)$/);
    if (shot) {
      const file = shotFile(shot[1], shot[2]);
      if (!file) return send(res, 404, { error: 'That screenshot is gone.' });
      return send(res, 200, await readFile(file), TYPES[file.split('.').pop().toLowerCase()]);
    }
    const run = path.match(/^\/api\/checks\/runs\/(\d+)$/);
    if (run) { const d = runDetail(run[1]); return d ? send(res, 200, d) : send(res, 404, { error: 'That run is gone.' }); }
    return;
  }
  if (req.method !== 'POST') return;
  const b = await readJson(req, 20000);
  if (path === '/api/checks') {
    const r = saveCheck(b);
    if (r.error) return send(res, 400, r);
    changed(); return send(res, 200, r);
  }
  if (path === '/api/checks/inspect') {
    const folder = String(b.folder || '').trim();
    return send(res, 200, folder && isAbsolute(folder) ? inspectFolder(folder) : { exists: false });
  }
  const id = Number(b.id) || 0;
  if (path === '/api/checks/run') { const r = runCheck(id); if (r.error) return send(res, 400, r); changed(); return send(res, 200, r); }
  if (path === '/api/checks/cancel') { cancelRun(id); changed(); return send(res, 200, { ok: true }); }
  if (path === '/api/checks/remove') { removeCheck(id); changed(); return send(res, 200, { ok: true }); }
}
