// GitHub through the gh CLI, which is already signed in.
//
// Every two minutes: workflow runs on recently pushed repos and on the repos of
// open sessions, and pull requests waiting on the user's review. In between, a
// live check: every 10 seconds while a run is queued or in progress (with its
// jobs), and every 20 seconds for the repos sessions are working in, so a push
// shows up as a glowing run almost at once, like the Actions tab on GitHub.
import { execFile } from 'node:child_process';
import { spaceFor } from './spaces.js';
import { alert } from './notify.js';
import { friendlyError } from './friendly.js';
import { retry, hold, ok as steadyOk } from './steady.js';

// The last reason gh failed, so the board can say what went wrong (signed out
// or offline) instead of a guess.
let lastGhError = null;
function gh(path) {
  return new Promise((resolve) => {
    execFile('gh', ['api', path], { timeout: 20000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) { lastGhError = Object.assign(err, { stderr: String(stderr || '') }); return resolve(null); }
      lastGhError = null;
      try { resolve(JSON.parse(stdout)); } catch { resolve(null); }
    });
  });
}
function git(cwd, args) {
  return new Promise((resolve) => {
    execFile('git', ['-C', cwd, ...args], { timeout: 5000 }, (err, stdout) => resolve(err ? null : stdout.trim()));
  });
}

// "git@github.com:owner/repo.git", "https://github.com/owner/repo", "ssh://git@github.com/owner/repo.git" → "owner/repo"
export function githubRepo(remote) {
  const m = /github\.com[:/]+([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(String(remote || '').trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

// One state word per run, the way GitHub colours it.
export function runState(run) {
  if (run.status === 'in_progress') return 'running';
  if (run.status !== 'completed') return 'queued';   // queued, waiting, requested, pending
  if (run.conclusion === 'success') return 'success';
  if (['failure', 'timed_out', 'startup_failure'].includes(run.conclusion)) return 'failure';
  if (run.conclusion === 'action_required') return 'action';
  if (run.conclusion === 'cancelled') return 'cancelled';
  return 'skipped';   // skipped, neutral, stale
}
const ACTIVE = new Set(['running', 'queued']);

let state = { at: null, ok: null, runs: [], reviews: [], actions: [], sharedPrs: [], error: null };
// Repos of shared projects (lib/share.js): only their names arrive; they are
// read with this person's own gh sign-in, and their runs go to that project.
let sharedSource = () => [];
export function watchShared(fn) { sharedSource = fn; }
// Your GitHub login, for "pushed to main" in a shared project's activity.
let login = null;
export const ghLogin = () => login;
export const github = () => state;

// ---- the folders sessions work in, and the GitHub repo and branch of each
let folderSource = () => [];
export function watchFolders(fn) { folderSource = fn; }
const folders = new Map();   // cwd -> { fullName, branch, at }
export const repoFor = (cwd) => { const f = cwd && folders.get(cwd); return f?.fullName ? { fullName: f.fullName, branch: f.branch } : null; };
async function refreshFolders() {
  const cwds = [...new Set(folderSource().filter(Boolean))];
  let moved = false;
  await Promise.all(cwds.map(async (cwd) => {
    const old = folders.get(cwd);
    const remote = old && Date.now() - old.at < 10 * 60e3 ? old.remote : await git(cwd, ['remote', 'get-url', 'origin']);
    const branch = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const fullName = githubRepo(remote);
    if (old?.fullName !== fullName || old?.branch !== branch) moved = true;
    folders.set(cwd, { remote, fullName, branch, at: old && old.remote === remote ? old.at : Date.now() });
  }));
  for (const k of folders.keys()) if (!cwds.includes(k)) folders.delete(k);
  return moved;
}
const sessionRepos = () => [...new Set([...folders.values()].map((f) => f.fullName).filter(Boolean))];

// ---- runs for one repo
const repoInfo = new Map();   // fullName -> { name, space }
async function runsFor(fullName) {
  const data = await gh(`repos/${fullName}/actions/runs?per_page=12`);
  if (!data?.workflow_runs) return null;
  const name = fullName.split('/')[1];
  const space = repoInfo.get(fullName)?.space || spaceFor(fullName, name) || 'personal';
  const old = new Map((state.actions.find((a) => a.fullName === fullName)?.runs || []).map((r) => [r.id, r]));
  return {
    fullName, name, space,
    runs: data.workflow_runs.map((run) => ({
      id: run.id, workflow: run.name, title: run.display_title, branch: run.head_branch, sha: (run.head_sha || '').slice(0, 7),
      event: run.event, actor: run.triggering_actor?.login || run.actor?.login || '', number: run.run_number, attempt: run.run_attempt,
      status: run.status, conclusion: run.conclusion, state: runState(run), url: run.html_url,
      createdAt: Date.parse(run.created_at), startedAt: Date.parse(run.run_started_at || run.created_at), updatedAt: Date.parse(run.updated_at),
      jobs: old.get(run.id)?.jobs || null
    }))
  };
}
async function jobsFor(fullName, run) {
  const data = await gh(`repos/${fullName}/actions/runs/${run.id}/jobs?per_page=30`);
  if (!data?.jobs) return;
  run.jobs = data.jobs.map((j) => ({
    name: j.name, state: runState(j), url: j.html_url,
    startedAt: j.started_at ? Date.parse(j.started_at) : null, endedAt: j.completed_at ? Date.parse(j.completed_at) : null,
    step: (j.steps || []).find((s) => s.status === 'in_progress')?.name || null
  }));
}
// Jobs for runs that are going (to show which step is on), once more for a run
// that just finished so its last picture is right, and once for a recent
// failure so the board can say which job broke.
async function fillJobs(repo) {
  const want = repo.runs.filter((r, i) => ACTIVE.has(r.state) || (r.jobs && r.jobs.some((j) => ACTIVE.has(j.state))) || (i < 6 && r.state === 'failure' && !r.jobs)).slice(0, 5);
  await Promise.all(want.map((r) => jobsFor(repo.fullName, r)));
}

// The board's cards: only what needs a look (going, failed recently, or passed
// in the last few hours), the newest per workflow and branch.
function boardRuns(actions) {
  const runs = [];
  for (const repo of actions) {
    const seen = new Set();
    for (const run of repo.runs) {
      const key = run.workflow + ':' + run.branch;
      if (seen.has(key)) continue;
      seen.add(key);
      const age = Date.now() - run.updatedAt;
      let st = null;
      if (ACTIVE.has(run.state)) st = 'running';
      else if (run.state === 'failure' && age < 2 * 86400e3) st = 'failed';
      else if (run.state === 'success' && age < 3 * 3600e3) st = 'done';
      if (!st) continue;
      runs.push({ id: run.id, repo: repo.name, fullName: repo.fullName, workflow: run.workflow, title: run.title, branch: run.branch, state: st, conclusion: run.conclusion, url: run.url, updatedAt: run.updatedAt, space: repo.space });
    }
  }
  return runs.sort((a, b) => b.updatedAt - a.updatedAt);
}

const fingerprint = (actions) => JSON.stringify(actions.map((a) => [a.fullName, a.runs.map((r) => [r.id, r.state, r.updatedAt, (r.jobs || []).map((j) => j.state + j.step)])]));
// A run that turns red raises a "builds" alert (desktop and phone, filtered by
// Settings). The first publish after start only fills the list, and only runs that
// finished in the last hour count, so a restart or a newly watched repo never
// replays old failures.
const failedSeen = new Set();
let firstPublish = true;
function alertFailures(actions) {
  for (const a of actions) for (const r of a.runs) {
    if (r.state !== 'failure' || failedSeen.has(r.id)) continue;
    failedSeen.add(r.id);
    if (!firstPublish && Date.now() - r.updatedAt < 60 * 60e3) alert('builds', `${a.name} build failed`, `${r.workflow} on ${r.branch}`);
  }
  firstPublish = false;
}

function publish(actions, extra = {}) {
  const before = fingerprint(state.actions);
  alertFailures(actions);
  actions.sort((a, b) => Math.max(0, ...b.runs.map((r) => r.updatedAt)) - Math.max(0, ...a.runs.map((r) => r.updatedAt)));
  state = { ...state, ...extra, actions, runs: boardRuns(actions) };
  return before !== fingerprint(actions);
}

export async function pollGithub() {
  await refreshFolders();
  // A blip (offline for a moment, a stalled lookup, GitHub answering 5xx) is
  // tried again, then kept off the page until it lasts (lib/steady.js).
  let failure = null;
  const repos = await retry(async () => {
    const r = await gh('user/repos?affiliation=owner,collaborator,organization_member&sort=pushed&per_page=30');
    if (!r) throw lastGhError || new Error('gh api failed');
    return r;
  }).catch((e) => { failure = e; return null; });
  if (!repos) {
    if (hold('github', failure) && state.ok) return;
    state = { ...state, at: Date.now(), ok: false, error: friendlyError(failure, 'GitHub') };
    return;
  }
  steadyOk('github');
  for (const r of repos) repoInfo.set(r.full_name, { name: r.name, space: spaceFor(r.full_name, r.name) || 'personal' });
  if (!login) login = (await gh('user'))?.login || null;
  const shared = (sharedSource() || []).filter((r) => /^[\w.-]+\/[\w.-]+$/.test(r.fullName || '')).slice(0, 20);
  for (const r of shared) repoInfo.set(r.fullName, { name: r.fullName.split('/')[1], space: r.space });
  const recent = repos.filter((r) => Date.now() - Date.parse(r.pushed_at) < 3 * 86400e3).slice(0, 12).map((r) => r.full_name);
  const watch = [...new Set([...recent, ...sessionRepos(), ...shared.map((r) => r.fullName)])];

  const actions = (await Promise.all(watch.map(runsFor))).filter((a) => a && a.runs.length);
  await Promise.all(actions.map(fillJobs));

  const search = await gh('search/issues?q=' + encodeURIComponent('is:open is:pr review-requested:@me archived:false') + '&per_page=20');
  const reviews = (search?.items || []).map((p) => {
    const repo = p.repository_url.split('/').slice(-2).join('/');
    return {
      id: p.id, number: p.number, title: p.title, repo, url: p.html_url, author: p.user?.login,
      updatedAt: Date.parse(p.updated_at), space: spaceFor(repo, p.title) || 'personal'
    };
  });
  // Open pull requests on shared projects' repos, for each project's page.
  let sharedPrs = [];
  if (shared.length) {
    const q = 'is:open is:pr archived:false ' + shared.map((r) => 'repo:' + r.fullName).join(' ');
    const found = await gh('search/issues?q=' + encodeURIComponent(q) + '&per_page=30&sort=updated');
    sharedPrs = (found?.items || []).map((p) => {
      const repo = p.repository_url.split('/').slice(-2).join('/');
      return { id: p.id, number: p.number, title: p.title, repo, url: p.html_url, author: p.user?.login, updatedAt: Date.parse(p.updated_at), space: shared.find((r) => r.fullName === repo)?.space || 'personal' };
    });
  }
  publish(actions, { at: Date.now(), ok: true, reviews, sharedPrs, error: null });
}

// The quick check between full polls. Returns true when something changed.
let ticks = 0, kicked = new Set();
export async function liveGithub() {
  if (state.ok !== true) return false;
  ticks++;
  const moved = ticks % 2 === 0 ? await refreshFolders() : false;
  const want = new Set(kicked);
  kicked = new Set();
  for (const a of state.actions) if (a.runs.some((r) => ACTIVE.has(r.state) || (r.jobs || []).some((j) => ACTIVE.has(j.state)))) want.add(a.fullName);
  if (ticks % 2 === 0) for (const f of sessionRepos()) want.add(f);
  if (!want.size) return moved;
  const fresh = (await Promise.all([...want].map(runsFor))).filter((a) => a && a.runs.length);
  await Promise.all(fresh.map(fillJobs));
  const byName = new Map(state.actions.map((a) => [a.fullName, a]));
  for (const a of fresh) byName.set(a.fullName, a);
  return publish([...byName.values()]) || moved;
}
// Check a repo on the next live tick (after a re-run, a cancel, or a push).
export const kick = (fullName) => { if (fullName) kicked.add(fullName); };

// Actions, on the user's click.
function ghRun(args) {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { timeout: 60000 }, (err, stdout, stderr) => err ? reject(new Error((stderr || err.message).trim().split('\n').pop())) : resolve(stdout));
  });
}
// A run, job or pull request number from the page reaches gh only as a positive
// whole number; anything else is refused before it becomes an argument.
export function ghNumber(n) {
  const v = Number(n);
  if (!Number.isInteger(v) || v <= 0) throw new Error('That is not a run or pull request number.');
  return String(v);
}
export const rerunFailed = async (fullName, runId) => ghRun(['run', 'rerun', ghNumber(runId), '-R', fullName, '--failed']);
export const cancelRun = async (fullName, runId) => ghRun(['run', 'cancel', ghNumber(runId), '-R', fullName]);
export const approvePr = async (repo, number) => ghRun(['pr', 'review', ghNumber(number), '-R', repo, '--approve']);
export const mergePr = async (repo, number) => ghRun(['pr', 'merge', ghNumber(number), '-R', repo, '--squash', '--delete-branch']);

// ---- the open pull request for a session's branch, with its checks (the chip
// on the session's bar). One `gh pr view` per branch every three minutes at most.
const prCache = new Map();   // "cwd|branch" -> { at, value, busy }
const PR_MS = 3 * 60e3;
export function checksState(rollup) {
  if (!Array.isArray(rollup) || !rollup.length) return null;
  let pending = false, failed = false;
  for (const c of rollup) {
    const v = String(c.conclusion || c.state || '').toUpperCase(), st = String(c.status || '').toUpperCase();
    if (['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(v)) failed = true;
    else if (v === 'PENDING' || v === 'EXPECTED' || (!v && st && st !== 'COMPLETED')) pending = true;
  }
  return failed ? 'failure' : pending ? 'running' : 'success';
}
export function prFor(cwd, branch) {
  if (!cwd || !branch || ['main', 'master', 'HEAD'].includes(branch)) return Promise.resolve(null);
  const key = cwd + '|' + branch;
  const c = prCache.get(key) || { at: 0, value: null, busy: null };
  prCache.set(key, c);
  if (Date.now() - c.at < PR_MS) return Promise.resolve(c.value);
  if (!c.busy) {
    c.busy = new Promise((resolve) => {
      execFile('gh', ['pr', 'view', branch, '--json', 'number,title,url,state,isDraft,statusCheckRollup'], { cwd, timeout: 20000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, out) => {
        let v = null;
        if (!err) {
          try {
            const p = JSON.parse(out);
            if (p.state === 'OPEN') v = { number: p.number, title: p.title, url: p.url, draft: !!p.isDraft, checks: checksState(p.statusCheckRollup) };
          } catch {}
        }
        resolve(v);
      });
    }).then((v) => { c.value = v; c.at = Date.now(); c.busy = null; return v; });
  }
  return c.busy;
}
