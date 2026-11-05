// Browser checks: a project's Playwright tests, or one page, run in a headless
// Chromium that starts for the run and closes after it. No browser window is open
// at any point, which is the point: Switchboard alone uses far less memory.
//
//   tests  a folder and a command (npx playwright test): the project's own
//          Playwright from its own node_modules. Switchboard adds a JSON report
//          and its own output folder, then reads which tests failed and their
//          screenshots from it.
//   page   a web address and, if given, text it must show. Runs Playwright's
//          screenshot command from the same pinned package the agents' browser
//          uses (node scripts/setup.mjs browser installs its Chromium).
//
// One run at a time (each one is a whole browser). A failure is a Needs-you card
// on Now until it passes again or is cleared. Checks live in this computer's own
// tables, not in settings, because folders differ from one computer to the next
// and a scheduled check should run on one computer, not on all of them.
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve, sep, isAbsolute } from 'node:path';
import { db, DATA_DIR, isCleared, clear } from './db.js';
import { spaceFor } from './spaces.js';
import { alert } from './notify.js';
import { runCommand, npxArgs, shellQuote } from './terminals.js';
import { cancelSignin, stateFile, savedAt, removeState, secretsIn, scrub, startSignin, signinState, signinResult } from './checkauth.js';

// Keep in step with scripts/setup.mjs (test/browserchecks.test.js checks it).
export const PLAYWRIGHT_MCP = '@playwright/mcp@0.0.84';
export const EVERY = [0, 60, 360, 1440];   // minutes: only on a click, hourly, every 6 hours, daily
const KEEP = 15;                            // runs kept per check
const RUNS_DIR = join(DATA_DIR, 'browserchecks');

for (const sql of [
  `CREATE TABLE IF NOT EXISTS browser_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, space TEXT, kind TEXT NOT NULL,
    folder TEXT, command TEXT, url TEXT, expect TEXT, every_min INTEGER NOT NULL DEFAULT 0, created_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS browser_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, check_id INTEGER NOT NULL, state TEXT NOT NULL,
    by TEXT, started_at INTEGER, ended_at INTEGER, summary TEXT, counts TEXT, failures TEXT, shots TEXT, output TEXT
  )`,
  'CREATE INDEX IF NOT EXISTS browser_runs_by_check ON browser_runs(check_id, id)',
  // Signed-in checks (lib/checkauth.js): the sign-in address, and when a run found the sign-in had run out (0 = it has not).
  'ALTER TABLE browser_checks ADD COLUMN signin_url TEXT',
  'ALTER TABLE browser_checks ADD COLUMN needs_signin INTEGER NOT NULL DEFAULT 0'
]) { try { db.exec(sql); } catch {} }
// A run cut short by a restart never finishes.
db.prepare("UPDATE browser_runs SET state = 'cancelled', summary = 'Switchboard restarted during the run', ended_at = ? WHERE state IN ('queued', 'running')").run(Date.now());

// ---------- pure helpers (tested)
export const plain = (s) => String(s ?? '').replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\r/g, '');

// What a check set up by an agent (agent: true on the request) may run: the
// project's own test runner with plain arguments, nothing that reaches past it.
// bin/mcp.mjs keeps its own copy, since it runs on its own with no imports;
// test/mcp.test.js checks the two are the same.
export const AGENT_COMMAND = /^(npx playwright test|npm test|npm run [\w:.-]+|pnpm (test|run [\w:.-]+)|yarn (test|run [\w:.-]+))( [\w./:=-]+)*$/;

// Turns what the form sent into a check, or says what is wrong.
export function cleanCheck(b, { folderExists = existsSync } = {}) {
  const kind = b.kind === 'page' ? 'page' : 'tests';
  const every = EVERY.includes(Number(b.every)) ? Number(b.every) : 0;
  const c = { kind, every_min: every, space: typeof b.space === 'string' && b.space && b.space !== 'all' ? b.space : null };
  if (kind === 'page') {
    let u;
    try { u = new URL(String(b.url || '').trim()); } catch { return { error: 'Type the page\'s full address, starting with https:// or http://.' }; }
    if (!/^https?:$/.test(u.protocol)) return { error: 'Only http and https pages can be checked.' };
    const expect = String(b.expect || '').trim();
    if (/[\r\n"%]/.test(expect) || expect.length > 200) return { error: 'The text to look for has to be one short line, without quotes or %.' };
    return { check: { ...c, url: u.href, expect: expect || null, folder: null, command: null, signin_url: null, name: String(b.name || '').trim().slice(0, 80) || u.host + (u.pathname === '/' ? '' : u.pathname) } };
  }
  const folder = String(b.folder || '').trim();
  if (!folder || !isAbsolute(folder)) return { error: 'Give the project\'s full folder path.' };
  if (!folderExists(folder)) return { error: `There is no folder at ${folder} on this computer.` };
  let signin_url = null;
  const su = String(b.signin_url || '').trim();
  if (su) {
    let u;
    try { u = new URL(su); } catch { return { error: 'Type the sign-in address in full, starting with https://.' }; }
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(u.hostname))) return { error: 'The sign-in address has to start with https:// (http:// only for this computer\'s own localhost).' };
    if (u.username || u.password) return { error: 'Leave the sign-in address plain: no user name or password in it. You sign in yourself in the window.' };
    signin_url = u.href;
  }
  const command = String(b.command || '').trim() || 'npx playwright test';
  if (/[\r\n]/.test(command) || command.length > 400) return { error: 'The command has to be one line.' };
  if (b.agent && !AGENT_COMMAND.test(command)) return { error: 'From an agent a tests check can only run the project\'s test runner (npx playwright test, npm test, npm run <script>, with plain arguments). Add any other command in Sessions, Browser checks.' };
  return { check: { ...c, folder, command, signin_url, url: null, expect: null, name: String(b.name || '').trim().slice(0, 80) || folder.split(/[\\/]/).filter(Boolean).pop() } };
}

// What a tests folder has, so the form can say "run npm install first".
export function inspectFolder(folder) {
  const has = (f) => existsSync(join(folder, f));
  const config = ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs', 'playwright.config.cjs', 'playwright.config.mts'].find(has) || null;
  return { exists: existsSync(folder), config, installed: has('node_modules/.bin/playwright') || has('node_modules/@playwright/test') };
}

// `npx playwright test` gets Switchboard's reporter and output folder added at
// the end, when that is safe: a command with &&, | or ; is left as typed (the
// JSON report still lands where Switchboard looks if it uses the json reporter).
export function withReport(command, outDir, quote = shellQuote) {
  if (!/\bplaywright(\.cmd)?\s+test\b/.test(command) || /[;&|<>`]/.test(command)) return command;
  return `${command} --reporter=line,json --output=${quote(outDir)}`;
}

// Playwright's JSON report: totals, and each failed test with its error and screenshots.
export function readReport(json) {
  const s = json?.stats || {};
  const counts = { passed: s.expected || 0, failed: s.unexpected || 0, flaky: s.flaky || 0, skipped: s.skipped || 0, ms: Math.round(s.duration || 0) };
  const failures = [];
  const walk = (suite, trail) => {
    const here = suite.title && !/\.(spec|test)\.[cm]?[jt]sx?$/.test(suite.title) ? [...trail, suite.title] : trail;
    for (const spec of suite.specs || []) {
      if (spec.ok !== false) continue;
      for (const t of spec.tests || []) {
        const last = (t.results || []).at(-1) || {};
        if (t.status === 'expected' || t.status === 'flaky' || t.status === 'skipped') continue;
        const err = plain(last.error?.message || (last.errors || [])[0]?.message || last.status || 'Failed');
        failures.push({
          title: [...here, spec.title].join(' › '), project: t.projectName || '', file: spec.file || suite.file || '', line: spec.line || 0,
          error: err.split('\n').filter((l) => l.trim()).slice(0, 8).join('\n').slice(0, 900),
          shots: (last.attachments || []).filter((a) => a.path && /^image\//.test(a.contentType || '')).map((a) => a.path)
        });
      }
    }
    for (const child of suite.suites || []) walk(child, here);
  };
  for (const suite of json?.suites || []) walk(suite, []);
  return { counts, failures };
}

// One line that says how the run went.
export function testsSummary({ code, counts, failures, output, timedOut, cancelled }) {
  if (cancelled) return 'Cancelled';
  if (timedOut) return 'Stopped: it ran longer than 10 minutes';
  const out = plain(output);
  if (/Executable doesn't exist|npx playwright install/i.test(out)) return 'This project\'s Chromium isn\'t installed. In the folder run: npx playwright install chromium';
  if (counts) {
    const parts = [counts.failed && `${counts.failed} failed`, counts.flaky && `${counts.flaky} flaky`, `${counts.passed} passed`, counts.skipped && `${counts.skipped} skipped`].filter(Boolean);
    if (code !== 0 && !counts.failed && !failures.length && !counts.passed) return lastError(out) || `Exited with code ${code}`;
    return parts.join(', ');
  }
  if (code === 0) return 'Passed';
  if (/command not found|not recognized as an internal|could not determine executable/i.test(out)) return 'Playwright isn\'t installed in that folder. Run npm install there first.';
  return lastError(out) || `Exited with code ${code}`;
}
const lastError = (out) => out.split('\n').map((l) => l.trim()).filter((l) => /error|failed|not found|no tests/i.test(l)).at(-1)?.slice(0, 200) || '';

export function pageSummary({ code, output, expect, timedOut, cancelled }) {
  if (cancelled) return 'Cancelled';
  if (timedOut) return 'Stopped: the page took too long';
  const out = plain(output);
  if (code === 0) return expect ? `Showed "${expect}"` : 'Loaded';
  if (/Executable doesn't exist|playwright install/i.test(out)) return 'The headless browser isn\'t installed. Run: node scripts/setup.mjs browser';
  const net = out.match(/net::(ERR_[A-Z_]+)/);
  if (net) return `Could not open the page (${net[1]})`;
  if (/Timeout/i.test(out)) return expect ? `"${expect}" did not show within 30 seconds` : 'The page did not finish loading within 30 seconds';
  return lastError(out) || `Exited with code ${code}`;
}

// Due when the newest run started at least `every` minutes ago (or never ran).
export const isDue = (check, lastStart, now = Date.now()) => check.every_min > 0 && now - (lastStart || 0) >= check.every_min * 60e3;

// ---------- checks
const all = () => db.prepare('SELECT * FROM browser_checks ORDER BY id').all();
const one = (id) => db.prepare('SELECT * FROM browser_checks WHERE id = ?').get(Number(id));

export function saveCheck(b) {
  const r = cleanCheck(b);
  if (r.error) return r;
  const c = r.check;
  c.space ||= spaceFor(c.folder || c.url, c.name) || 'personal';
  if (b.id) {
    const was = one(b.id);
    if (!was) return { error: 'That check is gone.' };
    // A saved sign-in belongs to the folder and sign-in address it was made for.
    if (was.folder !== c.folder || (was.signin_url || null) !== c.signin_url) { cancelSignin(was.id); removeState(was.id); }
    db.prepare('UPDATE browser_checks SET name = ?, space = ?, kind = ?, folder = ?, command = ?, url = ?, expect = ?, every_min = ?, signin_url = ?, needs_signin = CASE WHEN ? THEN needs_signin ELSE 0 END WHERE id = ?')
      .run(c.name, c.space, c.kind, c.folder, c.command, c.url, c.expect, c.every_min, c.signin_url, was.folder === c.folder && (was.signin_url || null) === c.signin_url ? 1 : 0, Number(b.id));
    return { ok: true, id: Number(b.id) };
  }
  const { lastInsertRowid } = db.prepare('INSERT INTO browser_checks (name, space, kind, folder, command, url, expect, every_min, signin_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(c.name, c.space, c.kind, c.folder, c.command, c.url, c.expect, c.every_min, c.signin_url, Date.now());
  return { ok: true, id: Number(lastInsertRowid), folder: c.folder ? inspectFolder(c.folder) : null };
}

export function removeCheck(id) {
  cancelRun(id);
  cancelSignin(id);
  removeState(id);
  for (const r of db.prepare('SELECT id FROM browser_runs WHERE check_id = ?').all(Number(id))) rmSync(join(RUNS_DIR, String(r.id)), { recursive: true, force: true });
  db.prepare('DELETE FROM browser_runs WHERE check_id = ?').run(Number(id));
  db.prepare('DELETE FROM browser_checks WHERE id = ?').run(Number(id));
}

// ---------- runs
const queue = [];          // run ids waiting their turn
let current = null;        // { runId, checkId, job }
let onChanged = () => {};

// A signed-in check runs only with a saved sign-in that has not run out. Without
// one it does not run (and so never retries on its own): it waits for the person.
export const needsSignin = (c) => !!c.signin_url && (!!c.needs_signin || !stateFile(c.id));

export function runCheck(id, by = 'you') {
  const c = one(id);
  if (!c) return { error: 'That check is gone.' };
  if (needsSignin(c)) return { error: 'This check needs you to sign in first. Open it and press Sign in.' };
  const busy = db.prepare("SELECT id FROM browser_runs WHERE check_id = ? AND state IN ('queued', 'running')").get(c.id);
  if (busy) return { ok: true, runId: busy.id, already: true };
  const { lastInsertRowid } = db.prepare("INSERT INTO browser_runs (check_id, state, by, started_at) VALUES (?, 'queued', ?, ?)").run(c.id, by, Date.now());
  queue.push(Number(lastInsertRowid));
  setImmediate(pump);
  return { ok: true, runId: Number(lastInsertRowid) };
}

export function cancelRun(checkId) {
  for (const r of db.prepare("SELECT id FROM browser_runs WHERE check_id = ? AND state = 'queued'").all(Number(checkId))) {
    const i = queue.indexOf(r.id);
    if (i >= 0) queue.splice(i, 1);
    db.prepare("UPDATE browser_runs SET state = 'cancelled', summary = 'Cancelled', ended_at = ? WHERE id = ?").run(Date.now(), r.id);
  }
  if (current && current.checkId === Number(checkId)) current.job?.cancel();
}

async function pump() {
  if (current || !queue.length) return;
  const runId = queue.shift();
  const run = db.prepare('SELECT * FROM browser_runs WHERE id = ?').get(runId);
  const c = run && one(run.check_id);
  if (!c || run.state !== 'queued') return pump();
  current = { runId, checkId: c.id, job: null };
  const started = Date.now();
  db.prepare("UPDATE browser_runs SET state = 'running', started_at = ? WHERE id = ?").run(started, runId);
  onChanged();
  let result;
  try { result = c.kind === 'page' ? await runPage(c, runId) : await runTests(c, runId); }
  catch (e) { result = { state: 'failure', summary: String(e.message || e), output: String(e.stack || e) }; }
  const prev = db.prepare("SELECT state FROM browser_runs WHERE check_id = ? AND id < ? AND state IN ('success', 'failure') ORDER BY id DESC LIMIT 1").get(c.id, runId);
  db.prepare('UPDATE browser_runs SET state = ?, ended_at = ?, summary = ?, counts = ?, failures = ?, shots = ?, output = ? WHERE id = ?')
    .run(result.state, Date.now(), result.summary, JSON.stringify(result.counts || null), JSON.stringify(result.failures || []), JSON.stringify(result.shots || []), plain(result.output || '').slice(-20000), runId);
  if (result.state === 'failure' && prev?.state !== 'failure') alert('checks', `Browser check failed: ${c.name}`, result.summary);
  prune(c.id);
  current = null;
  onChanged();
  pump();
}

async function runTests(c, runId) {
  const dir = join(RUNS_DIR, String(runId));
  mkdirSync(dir, { recursive: true });
  const report = join(dir, 'report.json');
  const job = runCommand(withReport(c.command, join(dir, 'out')), {
    cwd: c.folder,
    // The JSON report goes to a file; the HTML report never opens a browser and waits.
    // SB_AUTH_STATE is the saved sign-in's path, for this check only, and nothing at all otherwise.
    env: { SB_AUTH_STATE: (c.signin_url && stateFile(c.id)) || '', PLAYWRIGHT_JSON_OUTPUT_FILE: report, PLAYWRIGHT_JSON_OUTPUT_NAME: report, PLAYWRIGHT_HTML_OPEN: 'never', PW_TEST_HTML_REPORT_OPEN: 'never', FORCE_COLOR: '0', NO_COLOR: '1' }
  });
  current.job = job;
  const r = await job.done;
  let rep = null;
  try { rep = readReport(JSON.parse(readFileSync(report, 'utf8'))); } catch {}
  const failures = rep?.failures || [];
  const shots = [];
  for (const f of failures) f.shots = f.shots.map((p) => { shots.push(p); return shots.length - 1; });
  let state = r.cancelled ? 'cancelled' : r.code === 0 && !r.timedOut ? 'success' : 'failure';
  let summary = testsSummary({ ...r, counts: rep?.counts, failures });
  let output = r.output;
  if (c.signin_url) {
    // The suite says the sign-in ran out by printing a line with SIGNIN_EXPIRED.
    if (state === 'failure' && /(^|\s)SIGNIN_EXPIRED(\s|$)/m.test(plain(output))) {
      db.prepare('UPDATE browser_checks SET needs_signin = ? WHERE id = ?').run(Date.now(), c.id);
      summary = 'Signed out: the saved sign-in has run out. Press Sign in.';
      alert('checks', `Browser check needs you to sign in: ${c.name}`, 'The saved sign-in ran out. Open Sessions, Browser checks and press Sign in.');
    }
    // Nothing from the saved sign-in is kept in a run, even if a test printed it.
    const secrets = secretsIn(c.id);
    if (secrets.length) {
      output = scrub(output, secrets); summary = scrub(summary, secrets);
      for (const f of failures) { f.error = scrub(f.error, secrets); f.title = scrub(f.title, secrets); }
    }
  }
  return { state, counts: rep?.counts || null, failures, shots, output, summary };
}

async function runPage(c, runId) {
  const dir = join(RUNS_DIR, String(runId));
  mkdirSync(dir, { recursive: true });
  const shot = (file, wait) => runCommand(npxArgs(['-y', '-p', PLAYWRIGHT_MCP, 'playwright', 'screenshot', '--channel', 'chromium', '--timeout', '30000', '--viewport-size', '1280, 800',
    ...(wait ? ['--wait-for-selector', `text=${c.expect}`] : []), c.url, join(dir, file)]), { cwd: dir, timeoutMs: 3 * 60e3, env: { FORCE_COLOR: '0', NO_COLOR: '1' } });
  current.job = shot('page.png', !!c.expect);
  const r = await current.job.done;
  let output = r.output;
  // The text never showed: take the page as it was, so the card shows why.
  if (r.code !== 0 && c.expect && !r.cancelled && !/net::ERR_|Executable doesn't exist/.test(r.output)) {
    current.job = shot('page.png', false);
    output += '\n' + (await current.job.done).output;
  }
  const shots = existsSync(join(dir, 'page.png')) ? [join(dir, 'page.png')] : [];
  const state = r.cancelled ? 'cancelled' : r.code === 0 ? 'success' : 'failure';
  return { state, shots, output, summary: pageSummary({ ...r, expect: c.expect }) };
}

function prune(checkId) {
  const old = db.prepare('SELECT id FROM browser_runs WHERE check_id = ? ORDER BY id DESC LIMIT -1 OFFSET ?').all(checkId, KEEP);
  for (const r of old) { rmSync(join(RUNS_DIR, String(r.id)), { recursive: true, force: true }); db.prepare('DELETE FROM browser_runs WHERE id = ?').run(r.id); }
}

// A screenshot from a run, only if it lies inside that run's folder or the check's own folder.
export function shotFile(runId, n) {
  const run = db.prepare('SELECT check_id, shots FROM browser_runs WHERE id = ?').get(Number(runId));
  if (!run) return null;
  const file = JSON.parse(run.shots || '[]')[Number(n)];
  const c = one(run.check_id);
  if (!file || !/\.(png|jpe?g|webp)$/i.test(file)) return null;
  const inside = (root) => root && resolve(file).startsWith(resolve(root) + sep);
  return (inside(join(RUNS_DIR, String(runId))) || inside(c?.folder)) && existsSync(file) ? file : null;
}

export function runDetail(runId) {
  const r = db.prepare('SELECT id, check_id, output FROM browser_runs WHERE id = ?').get(Number(runId));
  return r ? { id: r.id, output: r.output || '' } : null;
}

// ---------- the board
const runView = (r) => ({
  id: r.id, state: r.state, by: r.by, startedAt: r.started_at, endedAt: r.ended_at, summary: r.summary || '',
  counts: JSON.parse(r.counts || 'null'), failures: JSON.parse(r.failures || '[]'), shots: JSON.parse(r.shots || '[]').length
});
// Only the fact of a sign-in, never the file or its path. state: none (not signed
// in yet), ok, expired (a run found it had run out), or starting, open or saving (the window).
const signinView = (c) => {
  if (!c.signin_url) return null;
  const res = signinResult(c.id);
  return { url: c.signin_url, state: signinState(c.id) || (c.needs_signin ? 'expired' : stateFile(c.id) ? 'ok' : 'none'), savedAt: savedAt(c.id), since: c.needs_signin > 1 ? c.needs_signin : c.created_at, message: res?.message || '', result: res?.state || '' };
};
export function checksForBoard() {
  const runs = db.prepare('SELECT * FROM browser_runs ORDER BY id DESC').all();
  return all().map((c) => {
    const mine = runs.filter((r) => r.check_id === c.id).slice(0, 10).map(runView);
    const last = mine.find((r) => r.state === 'success' || r.state === 'failure');
    return {
      id: c.id, name: c.name, space: c.space || 'personal', kind: c.kind, folder: c.folder, command: c.command, url: c.url, expect: c.expect, every: c.every_min,
      signin: signinView(c),
      runs: mine, cleared: !!(last && last.state === 'failure' && isCleared('check:' + c.id, last.endedAt))
    };
  });
}

// Scheduled checks, looked at every 30 seconds.
export function startChecks(changed) {
  onChanged = changed;
  setInterval(() => {
    for (const c of all()) {
      if (needsSignin(c)) continue;   // waits for the person; never retried on its own
      const last = db.prepare('SELECT started_at FROM browser_runs WHERE check_id = ? ORDER BY id DESC LIMIT 1').get(c.id);
      if (isDue(c, last?.started_at || c.created_at)) { runCheck(c.id, 'schedule'); changed(); }
    }
  }, 30e3);
}

// ---------- sign-in (the window itself is lib/checkauth.js)
export function openSignin(id) {
  const c = one(id);
  if (!c || c.kind !== 'tests' || !c.signin_url) return { error: 'That check has no sign-in address. Add one with Change.' };
  const f = inspectFolder(c.folder);
  if (!f.exists) return { error: `There is no folder at ${c.folder} on this computer.` };
  if (!f.installed) return { error: 'Playwright isn\'t installed in that folder. Run npm install there first.' };
  return startSignin({
    checkId: c.id, folder: c.folder, url: c.signin_url, onChange: () => onChanged(),
    // A fresh sign-in ends "needs sign-in", and the old failure about it stops asking for you.
    onSaved: () => { db.prepare('UPDATE browser_checks SET needs_signin = 0 WHERE id = ?').run(c.id); clear('check:' + c.id); onChanged(); }
  });
}

export function signOut(id) {
  const c = one(id);
  if (!c) return { error: 'That check is gone.' };
  cancelSignin(c.id);
  removeState(c.id);
  db.prepare('UPDATE browser_checks SET needs_signin = 0 WHERE id = ?').run(c.id);
  return { ok: true };
}
