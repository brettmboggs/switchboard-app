// "Clone to this computer" on a shared project's repo: a copy of it in one of
// your code folders, made with your own GitHub sign-in (gh if it is there,
// else git), so it then shows in the folder picker like any repo of yours.
// Nothing is run through a shell; the repo name and the folder are checked
// before they become arguments.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { getSetting } from './db.js';

// owner/name as GitHub makes them: neither part may start with "-", which gh would read as an option (review L1).
const okRepo = (r) => typeof r === 'string' && /^[A-Za-z0-9][\w.-]{0,99}\/(?!-)[\w.-]{1,100}$/.test(r) && !r.includes('..');
// The folders sessions start in (the same list as lib/terminals.js folders()).
export function codeRoots() {
  const set = getSetting('codeRoot', null);
  return [...new Set([set, 'dev', 'code', 'Projects', 'projects', 'src', 'source/repos', 'Documents/GitHub', 'GitHub']
    .filter(Boolean).map((r) => (r.startsWith('/') || /^[A-Za-z]:/.test(r)) ? r : join(homedir(), r)).filter(existsSync))];
}
const run = (cmd, args) => new Promise((ok, no) => execFile(cmd, args, { timeout: 10 * 60e3, windowsHide: true }, (err, stdout, stderr) => err ? no(Object.assign(err, { stderr: String(stderr || '') })) : ok(stdout)));
const has = async (cmd) => { try { await run(cmd, ['--version']); return true; } catch { return false; } };

export async function cloneRepo(repo, root) {
  if (!okRepo(repo)) throw new Error('That is not a GitHub repo name.');
  const roots = codeRoots();
  const base = root ? roots.find((r) => resolve(r) === resolve(String(root))) : roots[0];
  if (!base) throw new Error(roots.length ? 'Pick one of your code folders.' : 'There is no code folder yet. Make a folder called dev in your home folder, or pick one in Settings, then try again.');
  const name = repo.split('/')[1].replace(/\.git$/, '');
  const target = join(base, name);
  if (existsSync(target)) throw new Error(`There is already a folder called ${name} in ${base}. It may be this repo already.`);
  try {
    if (await has('gh')) await run('gh', ['repo', 'clone', repo, target]);
    else if (await has('git')) await run('git', ['clone', '--', `https://github.com/${repo}.git`, target]);
    else throw Object.assign(new Error('nogit'), { nogit: true });
  } catch (e) {
    if (e.nogit) throw new Error('This computer has neither gh nor git, so it cannot copy a repo. Use Open in Codespaces or Download ZIP instead.');
    const why = e.stderr || e.message || '';
    if (/not found|could not read|authentication|permission|403|404/i.test(why)) throw new Error(`GitHub did not let this computer copy ${repo}. Sign in to GitHub on this computer (gh auth login, or your git sign-in), and check you have been given access to the repo.`);
    throw new Error(`Copying ${repo} did not finish: ${why.trim().split('\n').pop().slice(0, 200) || 'no reason given'}.`);
  }
  return { path: target, name };
}
