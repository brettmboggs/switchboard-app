// Switchboard itself: updates and refresh.
// Called by server.js for every request after its host and header checks;
// sends a response when the path is one of these, otherwise does nothing.
import { pollGithub } from '../github.js';
import { pollGmail } from '../gmail.js';
import { updateState, checkForUpdate, applyUpdate, setChannel, appReport } from '../update.js';
import { listTerms, MODE } from '../terminals.js';
import { getSetting } from '../db.js';
import { removeParts, finishRemoval } from '../uninstall.js';
import { pollMicrosoft } from '../microsoft.js';
import { send, readJson } from '../http.js';
import { systemSnapshot } from '../sysmon.js';
import { pollCalendars } from '../calendar.js';
import { forget as forgetCalendarView } from '../calendarview.js';

// Automatic updates (Settings, About) go in only when nothing is lost by the
// restart: no agent is working or starting, and, where sessions do not survive a
// restart (no tmux), no session is open at all.
export function autoUpdateOk(PREFS) {
  if (!({ ...PREFS, ...getSetting('prefs', {}) }).autoUpdate) return false;
  const terms = listTerms();
  if (MODE !== 'tmux') return terms.length === 0;
  return !terms.some((t) => t.state === 'running' || t.state === 'starting');
}

export async function route({ req, res, path, url, changed, PREFS, PORT }) {
    // Settings, General, Remove Switchboard from this computer (lib/uninstall.js).
    if (req.method === 'POST' && path === '/api/remove-switchboard') {
      const body = await readJson(req), data = body.data === true;
      let r;
      try { r = await removeParts({ data, port: PORT }); }
      catch (e) { return send(res, 400, { error: e.message }); }   // already in plain words (lib/uninstall.js)
      send(res, 200, { ok: true, ...r });
      if (!r.app) finishRemoval({ data });
      return;
    }
    // The Switchboard app reports what its updater found (lib/update.js, desktop/src-tauri/src/main.rs).
    if (req.method === 'POST' && path === '/api/app/update') {
      const r = appReport(await readJson(req), { autoOk: () => autoUpdateOk(PREFS) });
      if (!r) return send(res, 404, { error: 'Not run by the Switchboard app.' });
      if (r.changed || r.install) changed();
      return send(res, 200, { check: r.check, install: r.install });
    }
    // The System monitor (lib/sysmon.js): read on request only, never on a timer.
    if (req.method === 'GET' && path === '/api/system') return send(res, 200, await systemSnapshot());
    if (req.method === 'POST' && path === '/api/update') {
      const body = await readJson(req);
      try { await applyUpdate({ force: body.force === true }); }
      catch (e) { if (e.localCommits) return send(res, 409, { error: e.message, localCommits: e.localCommits }); throw e; }
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
      await Promise.all([pollGmail(), pollGithub(), pollMicrosoft(), checkForUpdate(), pollCalendars().then(() => forgetCalendarView())]);
      changed();
      return send(res, 200, { ok: true });
    }
}
