// Switchboard itself: updates and refresh.
// Called by server.js for every request after its host and header checks;
// sends a response when the path is one of these, otherwise does nothing.
import { pollGithub } from '../github.js';
import { pollGmail } from '../gmail.js';
import { updateState, checkForUpdate, applyUpdate, setChannel } from '../update.js';
import { pollMicrosoft } from '../microsoft.js';
import { send, readJson } from '../http.js';
import { systemSnapshot } from '../sysmon.js';

export async function route({ req, res, path, url, changed }) {
    // The System monitor (lib/sysmon.js): read on request only, never on a timer.
    if (req.method === 'GET' && path === '/api/system') return send(res, 200, await systemSnapshot());
    if (req.method === 'POST' && path === '/api/update') {
      await applyUpdate();
      return send(res, 200, { ok: true, restarting: true });
    }
    if (req.method === 'POST' && path === '/api/update/check') {
      await checkForUpdate();
      changed();
      return send(res, 200, updateState());
    }
    // Settings, About: Updates Stable | Latest. Moves the checkout's upstream (lib/update.js).
    if (req.method === 'POST' && path === '/api/update/channel') {
      const body = await readJson(req);
      const r = await setChannel(String(body.channel || ''));
      changed();
      return send(res, 200, { ok: true, ...r, ...updateState() });
    }

    if (req.method === 'POST' && path === '/api/refresh') {
      await Promise.all([pollGmail(), pollGithub(), pollMicrosoft(), checkForUpdate()]);
      changed();
      return send(res, 200, { ok: true });
    }
}
