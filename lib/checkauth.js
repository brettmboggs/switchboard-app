// Signed-in browser checks: the sign-in state a tests check runs with.
//
// A person signs in themselves, in a visible browser window on their own computer
// (scripts/signin.mjs), on the sign-in site's own page. Switchboard never sees,
// types, asks for or stores a password, code or MFA answer. What is kept is what
// the browser keeps once you are signed in (Playwright's storageState: cookies
// and local storage), in one file per check:
//
//   ~/.config/switchboard/auth/<check id>.json   file mode 0600, folder 0700
//
// That file is outside every project and outside Switchboard's data folder, is
// never logged, never shown on the page or to an agent (the board carries only
// "signed in" and when it was saved), and never leaves this computer. A run gets
// its path in SB_AUTH_STATE, only for the check it was saved for. Sign out and
// removing the check delete it; so does changing the check's folder or sign-in
// address. Anything in a run's output that matches a value in the file is
// replaced with [hidden] before it is kept.
import { mkdirSync, chmodSync, lstatSync, statSync, rmSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// A copy run with its own SWITCHBOARD_DATA (a test copy, the tests themselves) keeps its
// sign-ins inside that folder, so it can never read, replace or delete the real ones:
// check ids start at 1 in every database.
export const AUTH_DIR = process.env.SWITCHBOARD_AUTH || (process.env.SWITCHBOARD_DATA ? join(process.env.SWITCHBOARD_DATA, 'auth') : join(homedir(), '.config', 'switchboard', 'auth'));
const SCRIPT = fileURLToPath(new URL('../scripts/signin.mjs', import.meta.url));
const WAIT_MS = 15 * 60e3;   // an open window that nobody finishes is closed after this

const safeId = (id) => { const n = Number(id); return Number.isInteger(n) && n > 0 ? n : null; };
export const statePath = (id) => safeId(id) && join(AUTH_DIR, `${safeId(id)}.json`);

// The folder, made private (0700) every time, even if it was there already.
function ensureDir() {
  mkdirSync(AUTH_DIR, { recursive: true, mode: 0o700 });
  try { chmodSync(AUTH_DIR, 0o700); } catch {}   // Windows has no modes
}

// The file's path if there is a saved state (a plain file, not a link), else null.
// A file anyone else could read is made private first.
export function stateFile(id) {
  const f = statePath(id);
  if (!f) return null;
  try {
    const st = lstatSync(f);
    if (!st.isFile()) return null;
    if (process.platform !== 'win32' && (st.mode & 0o077)) chmodSync(f, 0o600);
    return f;
  } catch { return null; }
}
export const savedAt = (id) => { const f = stateFile(id); try { return f ? Math.round(statSync(f).mtimeMs) : 0; } catch { return 0; } };
export function removeState(id) {
  const f = statePath(id);
  if (!f) return;
  rmSync(f, { force: true });
  rmSync(f + '.tmp', { force: true });
}

// Values in the saved state that must never show up in a stored run: cookie
// values and local-storage values long enough to be a token, longest first.
export function secretsIn(id) {
  const f = stateFile(id);
  if (!f) return [];
  try {
    const s = JSON.parse(readFileSync(f, 'utf8'));
    const vals = new Set();
    const add = (v) => { if (typeof v === 'string' && v.length >= 8) { vals.add(v); try { vals.add(encodeURIComponent(v)); } catch {} } };
    for (const c of s.cookies || []) add(c.value);
    for (const o of s.origins || []) for (const l of o.localStorage || []) add(l.value);
    return [...vals].sort((a, b) => b.length - a.length).slice(0, 500);
  } catch { return []; }
}
export const scrub = (text, secrets) => secrets.reduce((t, v) => t.split(v).join('[hidden]'), String(text ?? ''));

// ---------- the sign-in window (one at a time)
let job = null;          // { checkId, child, state: 'starting' | 'open' | 'saving' }
let last = null;         // { checkId, state: 'saved' | 'cancelled' | 'closed' | 'error', message }

// '' when there is no window for this check, else starting, open (ready for Done) or saving.
export const signinState = (checkId) => (job && job.checkId === Number(checkId) ? job.state : '');
export const signinResult = (checkId) => (last && last.checkId === Number(checkId) ? last : null);

// folder: the project's own folder (its Playwright opens the window). onChange
// runs whenever the window's state changes; onSaved once the file is written.
export function startSignin({ checkId, folder, url, onChange = () => {}, onSaved = () => {} }) {
  const id = safeId(checkId);
  if (!id) return { error: 'That check is gone.' };
  if (job) return { error: job.checkId === id ? 'The sign-in window is already open. Finish it there, or press Cancel.' : 'Another sign-in window is open. Finish or cancel it first.' };
  ensureDir();
  let child;
  try { child = spawn(process.execPath, [SCRIPT, url, statePath(id)], { cwd: folder, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: false }); }
  catch (e) { return { error: 'Could not open the browser window on this computer.' }; }
  const me = { checkId: id, child, state: 'starting' };
  job = me;
  last = null;
  let seen = '', hadSaved = false, errText = '';
  const finish = (state, message) => { clearTimeout(timer); if (job === me) job = null; last = { checkId: id, state, message }; onChange(); };
  const timer = setTimeout(() => { try { child.stdin.write('cancel\n'); } catch {} setTimeout(() => { try { child.kill(); } catch {} }, 3000).unref(); }, WAIT_MS);
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => {
    seen += d;
    let i;
    while ((i = seen.indexOf('\n')) >= 0) {
      const line = seen.slice(0, i).trim();
      seen = seen.slice(i + 1);
      if (line === 'READY') { me.state = 'open'; onChange(); }
      else if (line === 'NOTYET') { me.state = 'open'; last = { checkId: id, state: 'waiting', message: 'The window isn\'t back on the site yet. Finish signing in there until you can see the site itself, then press Done.' }; onChange(); }
      else if (line === 'SAVED') hadSaved = true;
      else if (line.startsWith('ERROR ')) errText = line.slice(6);
    }
  });
  child.stderr.on('data', () => {});   // nothing from the browser is kept
  child.on('error', () => finish('error', 'Could not open the browser window on this computer.'));
  child.on('close', () => {
    if (hadSaved && stateFile(id)) { finish('saved', 'Signed in. The sign-in is saved on this computer.'); onSaved(); return; }
    if (errText) return finish('error', errText);
    if (me.cancelled) return finish('cancelled', 'Cancelled. Nothing was saved.');
    finish(me.state === 'saving' ? 'error' : 'closed', me.state === 'saving' ? 'The sign-in could not be saved. Try Sign in again.' : 'The window was closed before you pressed Done, so nothing was saved.');
  });
  return { ok: true };
}

// The person pressed Done: save what the window holds and close it.
export function finishSignin(checkId) {
  if (!job || job.checkId !== Number(checkId) || job.state !== 'open') return { error: 'There is no sign-in window waiting on you for this check.' };
  job.state = 'saving';
  last = null;
  try { job.child.stdin.write('done\n'); } catch { return { error: 'The sign-in window is not answering. Press Cancel and try again.' }; }
  return { ok: true };
}

export function cancelSignin(checkId) {
  if (!job || job.checkId !== Number(checkId)) return;
  const { child } = job;
  job.cancelled = true;
  try { child.stdin.write('cancel\n'); } catch {}
  setTimeout(() => { try { child.kill(); } catch {} }, 3000).unref();
}
