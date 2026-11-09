// Updates. Every copy of Switchboard is a git checkout of the private repo. Every
// half hour it asks GitHub whether there is anything newer; when there is, the
// page shows "Update ready", and one click pulls it, installs any new packages,
// and restarts. The restart is done by whatever keeps Switchboard running
// (systemd, launchd, or bin/run.mjs on Windows): Switchboard just exits with 75.
// Claude sessions in tmux keep running through it.
//
// The Switchboard app (desktop/) is not a checkout: its files ship inside the
// app, and the app's own updater replaces it from GitHub Releases. There the app
// asks GitHub itself and tells this server what it found (POST /api/app/update,
// every few seconds); the page shows the same Update ready button, and a click
// is passed back to the app in the answer, which installs and restarts.
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const isRepo = existsSync(join(ROOT, '.git'));
// The version people see (Settings, About) is package.json's; the git SHA says which build of it.
const PKG = (() => { try { return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version || null; } catch { return null; } })();
// Which branch updates come from. Stable is the public repo's `stable` branch,
// moved forward at each tagged release; Latest is main (or master), every push.
const CHANNELS = ['stable', 'latest'];
// Run by the app (desktop/src-tauri/src/main.rs sets SWITCHBOARD_DESKTOP=1) and not a checkout.
let isApp = !isRepo && process.env.SWITCHBOARD_DESKTOP === '1';
// For the tests only: behave as the app's server would.
export function actAsAppForTests() { isApp = true; state = { ...state, app: true }; }

function git(args, timeout = 30000) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: ROOT, timeout, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (err, out, errOut) => err ? reject(new Error((errOut || err.message).trim().split('\n').pop())) : resolve(out.trim()));
  });
}

// Git's own words, turned into what happened and what to do. Kept here, not in
// lib/friendly.js: this file must work on its own (test/update.test.js copies it
// alone into a throwaway checkout). Callers log the raw text; the page gets this.
const plain = (msg) => Object.assign(new Error(msg), { plain: true });
export function plainGit(e, fallback = 'Git could not finish. Try again in a few minutes; if it keeps happening, ask for help.') {
  if (e?.plain) return e.message;
  const raw = String(e?.code || '') + ' ' + String(e?.message || e || '');
  if (/ENOENT|git: (command )?not found|'git' is not recognized/i.test(raw)) return 'Git, the tool Switchboard updates itself with, is not installed on this computer. Install Git, then try again.';
  if (/could not resolve host|unable to access|network|timed? ?out|ETIMEDOUT|connection|EAI_AGAIN|ENOTFOUND/i.test(raw)) return 'GitHub could not be reached. Check that this computer is online, then try again.';
  if (/authentication|permission denied|could not read username|403|access denied|repository not found/i.test(raw)) return 'GitHub did not let this computer in. Sign in to GitHub again (Settings, Connections, GitHub), then try again.';
  if (/no upstream|@\{u\}|no such branch|does not point to a branch/i.test(raw)) return 'This copy is not following an update channel. Pick Stable or Latest in Settings, About, then try again.';
  if (/not a git repository/i.test(raw)) return 'This copy of Switchboard was not installed in a way that can update itself. Install it again from the instructions on GitHub to get updates.';
  return fallback;
}

let state = { pkg: PKG, sha: null, channel: null, behind: 0, subjects: [], checkedAt: null, error: null, busy: false, app: isApp };
export const updateState = () => state;

// The commit this server started on. If the files on disk move to another commit
// without the Update button (a git pull in a terminal, a reset), the running server
// would serve a page its own code does not understand: plain text and no styling.
// So it notices and restarts itself, whatever supervisor keeps it (see exit 75 below).
let startSha = null;
async function restartIfCodeMoved() {
  if (!startSha || !state.sha || state.sha === startSha || state.busy) return;
  try {
    const changed = await git(['diff', '--name-only', startSha, 'HEAD']);
    if (!/^(server\.js|lib\/|public\/|package(-lock)?\.json)/m.test(changed)) { startSha = state.sha; return; }
  } catch { /* the old commit is gone: restart to be safe */ }
  console.log('The code on disk changed since this server started; restarting to load it.');
  setTimeout(() => process.exit(75), 600);
}

export async function currentSha() {
  if (!isRepo) return null;
  try { state.sha = await git(['rev-parse', '--short', 'HEAD']); } catch {}
  await channel();
  if (state.sha && !startSha) startSha = state.sha;
  return state.sha;
}

// 'stable' when the checkout tracks origin/stable, 'latest' for any other upstream,
// null when this is not a checkout or nothing is tracked.
export async function channel() {
  if (!isRepo) return null;
  try { state.channel = /\/stable$/.test(await git(['rev-parse', '--abbrev-ref', '@{u}'])) ? 'stable' : 'latest'; } catch { state.channel = null; }
  return state.channel;
}

// Moves the current branch's upstream to origin/stable or origin/main (master
// where there is no main), after a fetch. If the remote has no stable branch yet,
// the branch keeps tracking its own name and the answer says so.
export async function setChannel(name) {
  if (!isRepo) throw plain('This copy of Switchboard was not installed in a way that can update itself, so it has no update channel. Install it again from the instructions on GitHub to get updates.');
  if (!CHANNELS.includes(name)) throw plain('The update channel is Stable or Latest.');
  let remote, current;
  try {
    await git(['fetch', '--quiet', 'origin'], 60000);
    remote = (await git(['branch', '-r', '--format=%(refname:short)'])).split('\n').filter(Boolean);
    current = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
  } catch (e) { console.error('update channel:', e.message); throw plain('Could not change the update channel: ' + plainGit(e)); }
  const latest = ['origin/main', 'origin/master'].find((b) => remote.includes(b)) || (remote.includes('origin/' + current) ? 'origin/' + current : null);
  let target = name === 'stable' ? 'origin/stable' : latest, note = null;
  if (!target || !remote.includes(target)) {
    if (!remote.includes('origin/' + current)) throw plain(`GitHub has no ${name === 'stable' ? 'Stable' : 'Latest'} updates for this copy, so the channel stayed as it was. Keep the other channel for now.`);
    target = 'origin/' + current;
    note = name === 'stable' ? 'There is no Stable channel yet, so updates keep coming from where they came before.' : null;
  }
  try { await git(['branch', `--set-upstream-to=${target}`]); }
  catch (e) { console.error('update channel:', e.message); throw plain('Could not change the update channel: ' + plainGit(e)); }
  await channel();
  await checkForUpdate();
  return { channel: state.channel, upstream: target, note };
}

// ---- the app's updates (see the top of this file)
// What the page has asked the app to do, handed over in the answer to its next report.
const ask = { check: false, install: false };
let reported = [];   // callers of checkForUpdate waiting for the app's next answer
let lastReport = 0;
// The app's report: the version GitHub has for it (null when it is current), or
// why it could not tell. The answer says whether to check now and whether to
// install (a click on Update ready, or automatic updates when it is safe).
export function appReport({ available, error } = {}, { autoOk = () => false } = {}) {
  if (!isApp) return null;
  lastReport = Date.now();
  const v = typeof available === 'string' && /^\d+\.\d+\.\d+/.test(available) ? available : null;
  const before = state.behind;
  state = { ...state, behind: v ? 1 : 0, subjects: v ? [`Switchboard ${v}`] : [], checkedAt: Date.now(), error: error ? 'Could not check GitHub for updates: ' + plainGit(new Error(String(error).slice(0, 200)), 'GitHub did not answer as expected. Try again in a few minutes.') : null };
  if (!v) state.busy = false;
  const answer = { check: ask.check, install: !!v && (ask.install || autoOk()) };
  if (answer.install) state.busy = true;
  ask.check = false; ask.install = false;
  // A check answers only once the app has really asked GitHub (it says so by reporting again).
  if (!answer.check) { for (const r of reported) r(); reported = []; }
  return { ...answer, changed: before !== state.behind };
}

export async function checkForUpdate() {
  if (isApp) {
    // The app reports every few seconds; ask it to check now and wait for that answer.
    if (Date.now() - lastReport > 60e3) return state;   // not reporting: an older app, or another server
    ask.check = true;
    await new Promise((resolve) => { reported.push(resolve); setTimeout(resolve, 30e3); });
    return state;
  }
  if (!isRepo) return state;
  try {
    await currentSha();
    await restartIfCodeMoved();
    await git(['fetch', '--quiet', 'origin']);
    const upstream = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    const behind = Number(await git(['rev-list', '--count', `HEAD..${upstream}`])) || 0;
    const subjects = behind ? (await git(['log', '--format=%s', `HEAD..${upstream}`, '-n', '5'])).split('\n').filter(Boolean) : [];
    state = { ...state, behind, subjects, checkedAt: Date.now(), error: null };
  } catch (e) {
    state = { ...state, checkedAt: Date.now(), error: 'Could not check GitHub for updates: ' + plainGit(e) };
    console.error('update check:', e.message);
  }
  return state;
}

// Commits on this computer that GitHub does not have (by content, so one that
// GitHub has under another id does not count): someone building Switchboard here.
export function localOnly(cherryOut) {
  return String(cherryOut || '').split('\n').filter((l) => l.startsWith('+ ')).length;
}

export async function applyUpdate({ force = false } = {}) {
  if (isApp) {
    if (!state.behind) throw plain('This app is already the newest version.');
    // The app takes it from here: it downloads the new version, closes this server and restarts.
    ask.install = true; state.busy = true;
    return;
  }
  if (!isRepo) throw plain('This copy of Switchboard was not installed in a way that can update itself. Install it again from the instructions on GitHub to get updates.');
  if (state.busy) throw plain('Switchboard is already updating. Wait a moment for it to restart.');
  state.busy = true;
  try {
    const before = await git(['rev-parse', 'HEAD']);
    try { await git(['pull', '--ff-only', '--quiet'], 120000); }
    catch (e) {
      // This copy and GitHub went their own ways (a commit made here that GitHub
      // has under another id, or npm rewrote the lockfile). Keep what is here on
      // a backup branch, drop only the lockfile's own changes, and move to
      // GitHub's version. `reset --keep` stops, changing nothing, if any other
      // edit of yours would be overwritten.
      if (!/fast-forward|diverge|unrelated|not uptodate|overwritten/i.test(e.message)) throw e;
      const upstream = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
      // Work committed here and not yet on GitHub is never moved aside without
      // asking: the page offers "Update anyway" (force), which keeps it on the
      // backup branch below.
      const mine = localOnly(await git(['cherry', upstream, 'HEAD']).catch(() => ''));
      if (mine && !force) {
        throw Object.assign(plain(`This computer has ${mine} change${mine === 1 ? '' : 's'} that GitHub does not have yet. Send ${mine === 1 ? 'it' : 'them'} to GitHub first, or update anyway: ${mine === 1 ? 'it is' : 'they are'} kept on a backup branch.`), { localCommits: mine });
      }
      await git(['branch', `before-update-${before.slice(0, 7)}`]).catch(() => {});
      await git(['checkout', '--', 'package-lock.json']).catch(() => {});
      try { await git(['reset', '--keep', upstream]); }
      catch (err) {
        console.error(`update: reset failed (${err.message}); work kept on branch before-update-${before.slice(0, 7)}`);
        throw plain('Could not update: files of Switchboard\'s own were changed on this computer, and updating would overwrite them. Nothing was changed, and a backup copy of your work was kept. Undo or save those changes, then press Update again.');
      }
    }
    const changed = await git(['diff', '--name-only', before, 'HEAD']);
    if (/package(-lock)?\.json/.test(changed)) {
      await new Promise((resolve, reject) => execFile(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--omit=dev', '--no-audit', '--no-fund'],
        { cwd: ROOT, timeout: 300000, windowsHide: true, shell: process.platform === 'win32' }, (err, out, errOut) => { if (err) console.error('update: npm install failed:', (errOut || err.message).trim().split('\n').pop()); return err ? reject(plain('Switchboard got the update but could not finish installing its parts. Check that this computer is online, then press Update again.')) : resolve(); }));
    }
    state = { ...state, behind: 0, subjects: [] };
    // Give the response time to reach the page, then let the supervisor restart us.
    setTimeout(() => process.exit(75), 600);
  } catch (e) {
    if (e.plain || e.localCommits) throw e;
    console.error('update:', e.message);
    throw plain('Could not update: ' + plainGit(e));
  } finally { state.busy = false; }
}

// A cheap look every 20 seconds (one `git rev-parse`) so the window never sits
// broken for long after the files change under a running server.
if (isRepo) setInterval(() => currentSha().then(restartIfCodeMoved).catch(() => {}), 20000).unref();
