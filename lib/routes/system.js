// Switchboard itself: updates and refresh.
// Called by server.js for every request after its host and header checks;
// sends a response when the path is one of these, otherwise does nothing.
import { pollGithub } from '../github.js';
import { pollGmail } from '../gmail.js';
import { updateState, checkForUpdate, applyUpdate } from '../update.js';
import { pollMicrosoft } from '../microsoft.js';
import { send, readJson } from '../http.js';

export async function route({ req, res, path, url, changed }) {
    if (req.method === 'POST' && path === '/api/update') {
      await applyUpdate();
      return send(res, 200, { ok: true, restarting: true });
    }
    if (req.method === 'POST' && path === '/api/update/check') {
      await checkForUpdate();
      changed();
      return send(res, 200, updateState());
    }

    if (req.method === 'POST' && path === '/api/refresh') {
      await Promise.all([pollGmail(), pollGithub(), pollMicrosoft(), checkForUpdate()]);
      changed();
      return send(res, 200, { ok: true });
    }
}
