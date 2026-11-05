// Task apps (lib/tasks.js): connect with a token, change the project, disconnect,
// and close a task when Done is pressed on the board.
// Called by server.js for every request after its host and header checks;
// sends a response when the path is one of these, otherwise does nothing.
import { connectTasks, editTasks, disconnectTasks, closeTask } from '../tasks.js';
import { send, readJson } from '../http.js';

export async function route({ req, res, path, changed }) {
  const m = path.match(/^\/api\/tasks\/(connect|edit|disconnect|close)$/);
  if (!m || req.method !== 'POST') return;
  try {
    const b = await readJson(req, 8 * 1024);
    const source = String(b.source || '');
    if (m[1] === 'connect') await connectTasks(source, { token: b.token, key: b.key }, String(b.space || ''));
    if (m[1] === 'edit') editTasks(source, { space: String(b.space || ''), list: String(b.list || '') });
    if (m[1] === 'disconnect') disconnectTasks(source);
    if (m[1] === 'close') await closeTask(source, String(b.id || ''));
    changed();
    return send(res, 200, { ok: true });
  } catch (e) { return send(res, 400, { error: String(e.message || e) }); }
}
