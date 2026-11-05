// Remove Switchboard from this computer (Settings, General). Takes out what
// setup put in: the Claude Code hooks and status line, Switchboard's tools in
// each coding agent, the headless browser, the launcher, and (for a git
// checkout) the start-at-login service, which stops the server last. With
// "delete my data" it also deletes the data folder and this computer's
// keychain entry. Your own Claude settings, and anything Switchboard did not
// add, are left alone (scripts/setup.mjs only takes out entries that are its own).
//
// In the app, the app itself finishes: the page goes to /app/remove, and the app
// turns off its start at login, stops this server, deletes the data folder if
// asked and quits (desktop/src-tauri/src/main.rs). The app itself goes to the
// Trash by hand, like any app.
import { execFile, spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR, db } from './db.js';
import { keychainDelete } from './desktop.js';
import { keyName } from './secrets.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SETUP = join(ROOT, 'scripts', 'setup.mjs');
const isApp = () => !existsSync(join(ROOT, '.git')) && process.env.SWITCHBOARD_DESKTOP === '1';

// The first half, while the server is still here to answer: everything but the
// service. A test copy (another port) never touches the real computer's setup.
export async function removeParts({ data = false, port }) {
  if (port !== 4747) throw new Error('This is a test copy of Switchboard (it is not on port 4747), so it does not remove anything from this computer.');
  const app = isApp();
  await new Promise((resolve, reject) => execFile(process.execPath, [SETUP, 'remove-parts', app ? 'app' : 'checkout'], { windowsHide: true, timeout: 180000 },
    (err, out, errOut) => err ? reject(new Error('Switchboard could not take everything out: ' + (errOut || err.message).trim().split('\n').pop() + '. Try again, or run npm run uninstall in its folder.')) : resolve(out)));
  if (data) keychainDelete(keyName());
  return { app, folder: app ? null : ROOT, data: DATA_DIR };
}

// The second half, after the answer has gone (a checkout only): the data folder,
// then the service, which stops this server. 76 tells bin/run.mjs to stay stopped.
export function finishRemoval({ data = false }) {
  setTimeout(() => {
    if (data) {
      try { db.close(); } catch {}
      try { rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { console.error('Could not delete the data folder: ' + e.message); }
    }
    try { spawn(process.execPath, [SETUP, 'remove-service'], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch {}
    setTimeout(() => process.exit(76), 1500);
  }, 600);
}
