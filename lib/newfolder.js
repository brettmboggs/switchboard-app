// New folder, from New session: a folder for something that has no repo yet
// (a new client, a new idea), made in one of your code folders, so a session
// can start there without leaving Switchboard. It is made a git repo unless you
// untick that, and, only when you tick it, a private repo on your GitHub too
// (gh, with your own sign-in). Nothing runs through a shell; the name is
// checked before it becomes a path or an argument.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { codeRoots } from './clone.js';

const run = (cmd, args, cwd) => new Promise((ok, no) => execFile(cmd, args, { cwd, timeout: 2 * 60e3, windowsHide: true }, (err, stdout, stderr) => err ? no(Object.assign(err, { stderr: String(stderr || '') })) : ok(String(stdout))));

// A folder name as typed, with spaces made dashes: letters, digits, - _ and .,
// not starting with - or . (an option to git, or a hidden folder).
export function folderName(raw) {
  const name = String(raw || '').trim().replace(/\s+/g, '-');
  if (!/^[A-Za-z0-9][\w.-]{0,63}$/.test(name) || name.includes('..')) return null;
  return name;
}

export async function makeFolder({ name, root, git = true, github = false } = {}, { roots = codeRoots(), home = homedir() } = {}) {
  const n = folderName(name);
  if (!n) throw new Error('Give the folder a name: letters, numbers, dashes and dots, starting with a letter or number.');
  let base = root ? roots.find((r) => resolve(r) === resolve(String(root))) : roots[0];
  if (root && !base) throw new Error('Pick one of your code folders.');
  if (!base) { base = join(home, 'dev'); mkdirSync(base, { recursive: true }); }   // no code folder yet: ~/dev, as the folder list looks there
  const path = join(base, n);
  if (existsSync(path)) throw new Error(`There is already a folder called ${n} in ${base}. Pick it from the list instead.`);
  mkdirSync(path);
  const done = { path, name: n, git: false, github: null };
  if (git || github) {
    try {
      try { await run('git', ['init', '-b', 'main'], path); }
      catch { await run('git', ['init'], path); }   // git older than 2.28 has no -b
      done.git = true;
    } catch { done.warning = 'The folder is made, but git is not installed here, so it is not a repo yet.'; return done; }
  }
  if (github) {
    try {
      await run('gh', ['repo', 'create', n, '--private', '--source', path, '--remote', 'origin'], path);
      const url = (await run('git', ['remote', 'get-url', 'origin'], path).catch(() => '')).trim();
      done.github = url.replace(/\.git$/, '').replace(/^git@github\.com:/, 'https://github.com/') || true;
    } catch (e) {
      const why = e.stderr || e.message || '';
      done.warning = e.code === 'ENOENT' ? 'The folder and its git repo are made. GitHub was skipped: the GitHub app (gh) is not installed here.'
        : /auth|login|token/i.test(why) ? 'The folder and its git repo are made. GitHub was skipped: sign in to GitHub on this computer (Settings, Connections, GitHub), then make the repo from the session.'
        : /already exists|Name already/i.test(why) ? `The folder and its git repo are made. GitHub already has a repo called ${n}, so none was made there.`
        : `The folder is made and keeps its history, but GitHub did not make the private copy${/auth|login|token/i.test(why) ? ': sign in to GitHub (Builds, Sign in to GitHub) and try again' : /exist/i.test(why) ? ': you already have one with that name on GitHub' : '. Try again later, or make it on github.com'}.`;
    }
  }
  return done;
}
