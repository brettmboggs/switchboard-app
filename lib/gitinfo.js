// Git status for the folder a session works in, for the chips on its bar:
// files not yet committed, and how far the branch is ahead of or behind its
// upstream. One `git status` per folder at most every 20 seconds; a hook event
// from that folder (Claude edited a file, ran a command, finished) lets the
// next look come sooner, after 4 seconds.
import { execFile } from 'node:child_process';

const FRESH_MS = 20e3, DIRTY_MS = 4e3;
const cache = new Map();   // cwd -> { at, dirty, value, busy }

// `git status --porcelain=v2 --branch` -> { branch, upstream, ahead, behind, changed }
export function parseStatus(out) {
  const v = { branch: null, upstream: null, ahead: 0, behind: 0, changed: 0 };
  for (const line of String(out || '').split('\n')) {
    if (line.startsWith('# branch.head ')) v.branch = line.slice(14).trim();
    else if (line.startsWith('# branch.upstream ')) v.upstream = line.slice(18).trim();
    else if (line.startsWith('# branch.ab ')) {
      const m = line.match(/\+(\d+) -(\d+)/);
      if (m) { v.ahead = Number(m[1]); v.behind = Number(m[2]); }
    } else if (/^[12u?] /.test(line)) v.changed++;
  }
  if (v.branch === '(detached)') v.branch = null;
  return v;
}

function run(cwd) {
  return new Promise((resolve) => {
    execFile('git', ['-C', cwd, '--no-optional-locks', 'status', '--porcelain=v2', '--branch'], { timeout: 5000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (err, out) => resolve(err ? null : parseStatus(out)));
  });
}

export async function gitStatus(cwd) {
  if (!cwd) return null;
  const c = cache.get(cwd) || { at: 0, dirty: false, value: null, busy: null };
  cache.set(cwd, c);
  const age = Date.now() - c.at;
  if (age < (c.dirty ? DIRTY_MS : FRESH_MS)) return c.value;
  if (!c.busy) c.busy = run(cwd).then((v) => { c.value = v; c.at = Date.now(); c.dirty = false; c.busy = null; return v; });
  return c.busy;
}

// A hook event from inside this folder: something may have changed.
export function gitTouched(cwd) {
  if (!cwd) return;
  for (const [k, c] of cache) if (cwd === k || cwd.startsWith(k + '/') || k.startsWith(cwd + '/')) c.dirty = true;
}
