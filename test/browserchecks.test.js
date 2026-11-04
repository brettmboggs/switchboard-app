// Browser checks: what the form accepts, reading Playwright's JSON report, the one
// line each run gets, the schedule, and a whole run end to end with a stand-in
// test command (no browser needed), including a failure's screenshot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-checks-'));
process.env.SWITCHBOARD_SESSIONS = 'direct';
const { setSetting } = await import('../lib/db.js');
const bc = await import('../lib/browserchecks.js');
const { runCommand } = await import('../lib/terminals.js');
setSetting('notify', { checks: false });   // no desktop alerts from the tests

test('the pinned Playwright MCP is the same in setup and in the checks', () => {
  const setup = readFileSync(new URL('../scripts/setup.mjs', import.meta.url), 'utf8');
  assert.match(setup, new RegExp(`PLAYWRIGHT_MCP = '${bc.PLAYWRIGHT_MCP.replace(/[.@/]/g, '\\$&')}'`));
});

test('the form: pages and tests', () => {
  const page = bc.cleanCheck({ kind: 'page', url: 'https://example.com', expect: 'Sign in', every: 60, space: 'datum' });
  assert.deepEqual(page.check, { kind: 'page', every_min: 60, space: 'datum', url: 'https://example.com/', expect: 'Sign in', folder: null, command: null, name: 'example.com' });
  assert.match(bc.cleanCheck({ kind: 'page', url: 'example.com' }).error, /full address/);
  assert.match(bc.cleanCheck({ kind: 'page', url: 'file:///etc/passwd' }).error, /http/);
  assert.match(bc.cleanCheck({ kind: 'page', url: 'https://x.com', expect: 'say "hi"' }).error, /quotes/);
  assert.equal(bc.cleanCheck({ kind: 'page', url: 'https://x.com', every: 7 }).check.every_min, 0);

  const yes = () => true, no = () => false;
  const t = bc.cleanCheck({ folder: '/home/me/dev/my-app/frontend', space: 'all' }, { folderExists: yes });
  assert.deepEqual(t.check, { kind: 'tests', every_min: 0, space: null, folder: '/home/me/dev/my-app/frontend', command: 'npx playwright test', url: null, expect: null, name: 'frontend' });
  assert.match(bc.cleanCheck({ folder: 'dev/app' }, { folderExists: yes }).error, /full folder path/);
  assert.match(bc.cleanCheck({ folder: '/nope' }, { folderExists: no }).error, /no folder/);
  assert.match(bc.cleanCheck({ folder: '/a', command: 'npx playwright test\nrm -rf /' }, { folderExists: yes }).error, /one line/);
});

test('Switchboard adds its report to `playwright test`, and leaves anything else alone', () => {
  const q = (s) => `'${s}'`;
  assert.equal(bc.withReport('npx playwright test', '/d/out', q), "npx playwright test --reporter=line,json --output='/d/out'");
  assert.equal(bc.withReport('npx playwright test e2e/login.spec.ts --project=chromium', '/o', q), "npx playwright test e2e/login.spec.ts --project=chromium --reporter=line,json --output='/o'");
  assert.equal(bc.withReport('npm run e2e', '/o', q), 'npm run e2e');
  assert.equal(bc.withReport('npm ci && npx playwright test', '/o', q), 'npm ci && npx playwright test');
});

// Trimmed from a real `npx playwright test --reporter=json` run (Playwright 1.55).
const REPORT = {
  stats: { duration: 3248.9, expected: 4, skipped: 1, unexpected: 1, flaky: 0 },
  suites: [{ title: 'home.spec.js', file: 'home.spec.js', specs: [], suites: [{ title: 'Home', file: 'home.spec.js', specs: [
    { title: 'shows the title', ok: true, file: 'home.spec.js', line: 3, tests: [{ projectName: '', status: 'expected', results: [{ status: 'passed', attachments: [] }] }] },
    { title: 'shows the sign-in button', ok: false, file: 'home.spec.js', line: 4, tests: [{ projectName: 'chromium', status: 'unexpected', results: [{ status: 'failed',
      error: { message: "Error: \u001b[2mexpect(\u001b[22m\u001b[31mlocator\u001b[39m\u001b[2m).\u001b[22mtoBeVisible\u001b[2m()\u001b[22m failed\n\nLocator:  getByRole('button', { name: 'Sign in' })\nExpected: visible\nReceived: <element(s) not found>\n" },
      attachments: [{ name: 'screenshot', contentType: 'image/png', path: '/run/out/home-Home-shows-the-sign-in-button/test-failed-1.png' }, { name: 'error-context', contentType: 'text/markdown', path: '/run/out/x/error-context.md' }] }] }] }
  ] }] }]
};

test('reading the report: totals, failed tests, their errors and screenshots', () => {
  const { counts, failures } = bc.readReport(REPORT);
  assert.deepEqual(counts, { passed: 4, failed: 1, flaky: 0, skipped: 1, ms: 3249 });
  assert.equal(failures.length, 1);
  assert.equal(failures[0].title, 'Home › shows the sign-in button');
  assert.equal(failures[0].project, 'chromium');
  assert.equal(failures[0].line, 4);
  assert.match(failures[0].error, /^Error: expect\(locator\)\.toBeVisible\(\) failed\nLocator:/);
  assert.deepEqual(failures[0].shots, ['/run/out/home-Home-shows-the-sign-in-button/test-failed-1.png']);
  assert.equal(bc.testsSummary({ code: 1, counts, failures, output: '' }), '1 failed, 4 passed, 1 skipped');
});

test('one line per run', () => {
  assert.equal(bc.testsSummary({ code: 0, output: '' }), 'Passed');
  assert.equal(bc.testsSummary({ code: 1, output: "Error: browserType.launch: Executable doesn't exist at /x" }), "This project's Chromium isn't installed. In the folder run: npx playwright install chromium");
  assert.equal(bc.testsSummary({ code: 127, output: 'sh: 1: playwright: not found\nnpm error could not determine executable to run' }), "Playwright isn't installed in that folder. Run npm install there first.");
  assert.equal(bc.testsSummary({ code: 1, timedOut: true, output: '' }), 'Stopped: it ran longer than 10 minutes');
  assert.equal(bc.testsSummary({ code: 1, counts: { passed: 0, failed: 0, flaky: 0, skipped: 0 }, failures: [], output: 'Error: No tests found' }), 'Error: No tests found');
  assert.equal(bc.pageSummary({ code: 0, expect: 'Sign in', output: '' }), 'Showed "Sign in"');
  assert.equal(bc.pageSummary({ code: 0, expect: null, output: '' }), 'Loaded');
  assert.equal(bc.pageSummary({ code: 1, expect: 'Sign in', output: "TimeoutError: Timeout 30000ms exceeded.\n  - waiting for locator('text=Sign in')" }), '"Sign in" did not show within 30 seconds');
  assert.equal(bc.pageSummary({ code: 1, output: 'Error: net::ERR_NAME_NOT_RESOLVED at https://nope.invalid/' }), 'Could not open the page (ERR_NAME_NOT_RESOLVED)');
  assert.equal(bc.pageSummary({ code: 1, output: "Error: Executable doesn't exist at /x\nnpx playwright install" }), "The headless browser isn't installed. Run: node scripts/setup.mjs browser");
});

test('the schedule', () => {
  const now = Date.now();
  assert.equal(bc.isDue({ every_min: 0 }, 0, now), false);
  assert.equal(bc.isDue({ every_min: 60 }, now - 59 * 60e3, now), false);
  assert.equal(bc.isDue({ every_min: 60 }, now - 60 * 60e3, now), true);
  assert.equal(bc.isDue({ every_min: 1440 }, 0, now), true);
});

const settle = async (id) => {
  for (let i = 0; i < 200; i++) {
    const c = bc.checksForBoard().find((x) => x.id === id);
    if (c.runs[0] && !['queued', 'running'].includes(c.runs[0].state)) return c;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('the run never finished');
};

test('a run end to end: a failure with its screenshot, then a pass', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'sb-proj-'));
  mkdirSync(join(folder, 'shots'));
  writeFileSync(join(folder, 'shots', 'fail.png'), 'PNG');
  // Stands in for `npx playwright test`: writes the JSON report where Switchboard asked for it.
  const report = { ...REPORT, suites: JSON.parse(JSON.stringify(REPORT.suites)) };
  report.suites[0].suites[0].specs[1].tests[0].results[0].attachments[0].path = join(folder, 'shots', 'fail.png');
  writeFileSync(join(folder, 'fake.mjs'), `import { writeFileSync, existsSync } from 'node:fs';
const pass = existsSync('PASS');
writeFileSync(process.env.PLAYWRIGHT_JSON_OUTPUT_FILE, JSON.stringify(pass ? { stats: { expected: 5, unexpected: 0, skipped: 0, flaky: 0, duration: 900 }, suites: [] } : ${JSON.stringify(report)}));
console.log(pass ? 'all good' : '1 failed');
process.exit(pass ? 0 : 1);`);
  const saved = bc.saveCheck({ kind: 'tests', folder, command: `"${process.execPath}" fake.mjs`, name: 'Datum smoke', space: 'datum' });
  assert.ok(saved.ok, saved.error);
  assert.deepEqual(saved.folder, { exists: true, config: null, installed: false });

  assert.ok(bc.runCheck(saved.id).ok);
  assert.equal(bc.runCheck(saved.id).already, true, 'a second click while it runs does not queue another');
  let c = await settle(saved.id);
  assert.equal(c.runs[0].state, 'failure');
  assert.equal(c.runs[0].summary, '1 failed, 4 passed, 1 skipped');
  assert.equal(c.runs[0].failures[0].title, 'Home › shows the sign-in button');
  assert.deepEqual(c.runs[0].failures[0].shots, [0]);
  assert.equal(c.space, 'datum');
  assert.equal(bc.shotFile(c.runs[0].id, 0), join(folder, 'shots', 'fail.png'));
  assert.equal(bc.shotFile(c.runs[0].id, 1), null);
  assert.match(bc.runDetail(c.runs[0].id).output, /1 failed/);

  writeFileSync(join(folder, 'PASS'), '');
  bc.runCheck(saved.id);
  c = await settle(saved.id);
  assert.equal(c.runs[0].state, 'success');
  assert.equal(c.runs[0].summary, '5 passed');
  assert.equal(c.runs.length, 2);

  bc.removeCheck(saved.id);
  assert.equal(bc.checksForBoard().find((x) => x.id === saved.id), undefined);
});

test('a screenshot outside the run and the project is never served', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'sb-proj-'));
  const outside = mkdtempSync(join(tmpdir(), 'sb-elsewhere-'));
  writeFileSync(join(outside, 'secret.png'), 'PNG');
  const report = JSON.parse(JSON.stringify(REPORT));
  report.suites[0].suites[0].specs[1].tests[0].results[0].attachments[0].path = join(outside, 'secret.png');
  writeFileSync(join(folder, 'report.json'), JSON.stringify(report));
  writeFileSync(join(folder, 'fake.mjs'), `import { copyFileSync } from 'node:fs'; copyFileSync('report.json', process.env.PLAYWRIGHT_JSON_OUTPUT_FILE); process.exit(1);`);
  const { id } = bc.saveCheck({ kind: 'tests', folder, command: `"${process.execPath}" fake.mjs` });
  bc.runCheck(id);
  const c = await settle(id);
  assert.equal(c.runs[0].failures[0].shots.length, 1);
  assert.equal(bc.shotFile(c.runs[0].id, 0), null);
  bc.removeCheck(id);
});

test('cancel stops the command and what it started', { skip: process.platform === 'win32' }, async () => {
  const t = Date.now();
  const job = runCommand('sleep 30 & sleep 30; wait', { cwd: tmpdir() });
  setTimeout(() => job.cancel(), 200);
  const r = await job.done;
  assert.equal(r.cancelled, true);
  assert.ok(Date.now() - t < 5000, 'it stopped');
});
