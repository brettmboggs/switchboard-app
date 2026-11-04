// Updates. Every copy of Switchboard is a git checkout of the private repo. Every
// half hour it asks GitHub whether there is anything newer; when there is, the
// page shows "Update ready", and one click pulls it, installs any new packages,
// and restarts. The restart is done by whatever keeps Switchboard running
// (systemd, launchd, or bin/run.mjs on Windows): Switchboard just exits with 75.
// Claude sessions in tmux keep running through it.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const isRepo = existsSync(join(ROOT, '.git'));

function git(args, timeout = 30000) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: ROOT, timeout, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (err, out, errOut) => err ? reject(new Error((errOut || err.message).trim().split('\n').pop())) : resolve(out.trim()));
  });
}

let state = { sha: null, behind: 0, subjects: [], checkedAt: null, error: null, busy: false };
export const updateState = () => state;

export async function currentSha() {
  if (!isRepo) return null;
  try { state.sha = await git(['rev-parse', '--short', 'HEAD']); } catch {}
  return state.sha;
}

export async function checkForUpdate() {
  if (!isRepo) return state;
  try {
    await currentSha();
    await git(['fetch', '--quiet', 'origin']);
    const upstream = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    const behind = Number(await git(['rev-list', '--count', `HEAD..${upstream}`])) || 0;
    const subjects = behind ? (await git(['log', '--format=%s', `HEAD..${upstream}`, '-n', '5'])).split('\n').filter(Boolean) : [];
    state = { ...state, behind, subjects, checkedAt: Date.now(), error: null };
  } catch (e) {
    state = { ...state, checkedAt: Date.now(), error: 'Could not check GitHub for updates: ' + e.message };
  }
  return state;
}

export async function applyUpdate() {
  if (!isRepo) throw new Error('This copy is not a git checkout, so it cannot update itself.');
  if (state.busy) throw new Error('Already updating.');
  state.busy = true;
  try {
    const before = await git(['rev-parse', 'HEAD']);
    await git(['pull', '--ff-only', '--quiet'], 120000);
    const changed = await git(['diff', '--name-only', before, 'HEAD']);
    if (/package(-lock)?\.json/.test(changed)) {
      await new Promise((resolve, reject) => execFile(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--omit=dev', '--no-audit', '--no-fund'],
        { cwd: ROOT, timeout: 300000, windowsHide: true, shell: process.platform === 'win32' }, (err, out, errOut) => err ? reject(new Error((errOut || err.message).trim().split('\n').pop())) : resolve()));
    }
    state = { ...state, behind: 0, subjects: [] };
    // Give the response time to reach the page, then let the supervisor restart us.
    setTimeout(() => process.exit(75), 600);
  } finally { state.busy = false; }
}
