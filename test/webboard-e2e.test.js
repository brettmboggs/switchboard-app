// The web board end to end, in a real (headless) browser: Sam's Switchboard
// (lib/share.js, this process) shares Acme with Jordan; Jordan opens the invite
// link on the board, makes the account in the page (that is joining), sees the
// shared page in Notes, edits it in the real editor, cannot add to a kind he may
// only see, and Sam's change shows in his browser within seconds over the relay.
// Needs Chrome and playwright-core on this computer (PLAYWRIGHT_CORE, or the
// copy that comes with the Playwright CLI); without them it is skipped.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const candidates = [process.env.PLAYWRIGHT_CORE, (() => { try { return join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), '@playwright/cli/node_modules/playwright-core/index.mjs'); } catch { return null; } })(), join(homedir(), '.nvm')].filter((p) => p && p.endsWith('.mjs') && existsSync(p));
const chrome = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
const pw = candidates[0] && chrome ? await import(candidates[0]).catch(() => null) : null;

test('the web board, from the invite link to editing, in a browser', { skip: !pw && 'no Chrome or playwright-core on this computer', timeout: 120000 }, async () => {
  process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-e2e-'));
  const { db, setSetting } = await import('../lib/db.js');
  const { newPage, savePage } = await import('../lib/pages.js');
  const share = await import('../lib/share.js');
  const { startFakeSync } = await import('./fake-sync.mjs');
  const svc = await startFakeSync();
  after(() => svc.close());
  setSetting('sync', svc.account('a-sam', 'sam@example.com'));
  setSetting('spaces', [{ id: 'acme', name: 'Acme', color: '#3366AA', group: 'Work' }]);
  const plan = newPage({ title: 'Launch plan', body: '<ul class="checklist"><li data-checked="false">Pick a date</li></ul>', space: 'acme' });
  db.prepare("INSERT INTO items (kind, text, space, created_at) VALUES ('todo', 'Call the printer', 'acme', 1)").run();
  const r = await share.shareProject('acme', 'jordan@example.com', 'Jordan', { kinds: { pages: 'edit', tasks: 'see', repos: 'none', activity: 'none', about: 'see' } });
  // The link opens /join on this service, which hands the # to the board.
  assert.ok(r.link.startsWith(svc.base + '/join#join?'), r.link);

  const browser = await pw.chromium.launch({ executablePath: chrome });
  after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const logs = []; page.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
  const why = async () => `errors: ${errors.join(' | ')}\nconsole: ${logs.slice(-15).join(' | ')}\nmsg: ${await page.textContent('#acct-msg').catch(() => '')}\nshare: ${await page.evaluate(() => JSON.stringify({ a: S?.account, j: S?.share?.joining, e: S?.share?.error, je: S?.share?.joinError })).catch((e) => e.message)}`;
  await page.goto(r.link);
  // Not signed in: Settings, Account opens with the invited address filled in.
  await page.waitForSelector('#acct-email', { state: 'visible', timeout: 20000 });
  assert.equal(await page.inputValue('#acct-email'), 'jordan@example.com');
  assert.match(await page.textContent('#sync-own'), /To join Acme/);
  await page.fill('#acct-pass', 'a long enough password');
  await page.click('button[data-mode="signup"]');
  // In the account (scrypt runs in the page), then "You're in" until Sam's computer hands over the keys.
  await page.waitForFunction(() => typeof S !== 'undefined' && S?.account?.signedIn && (S.share.joining.length || Object.keys(S.share.projects).length), null, { timeout: 30000 }).catch(async (e) => { throw new Error(e.message + '\n' + await why()); });
  await share.syncShares();
  await page.waitForFunction(() => Object.keys((typeof S !== 'undefined' && S?.share?.projects) || {}).length === 1, null, { timeout: 15000 });
  // Notes shows the shared page; the rail has the full set (the owner, Nov 6: the board is the whole product, fed by what is shared).
  await page.keyboard.press('Escape');
  await page.evaluate(() => { location.hash = '#notes'; });
  await page.waitForSelector('text=Launch plan', { timeout: 10000 });
  const rail = await page.textContent('#pages');
  for (const w of ['Now', 'Sessions', 'Inbox', 'Money', 'Notes']) assert.ok(rail.includes(w), rail);
  // Edit it in the real editor.
  await page.click('text=Launch plan');
  await page.waitForSelector('#ed-body [contenteditable="true"], #ed-body', { timeout: 10000 });
  await page.evaluate(() => { const ed = document.querySelector('#ed-body [contenteditable]') || document.querySelector('#ed-body'); ed.focus(); });
  await page.keyboard.press('End');
  await page.keyboard.type(' — in the browser');
  // The editor saves after a pause; then the browser sends it, signed.
  await page.waitForFunction(() => (S.pages || []).some((p) => p.preview.includes('in the browser')), null, { timeout: 15000 }).catch(() => {});
  let saved = false;
  for (let i = 0; i < 20 && !saved; i++) { await new Promise((ok) => setTimeout(ok, 500)); await share.syncShares(); saved = /in the browser/.test(db.prepare('SELECT body FROM pages WHERE uid = ?').get(plan.uid).body); }
  assert.ok(saved, 'Sam has Jordan\'s edit');
  assert.equal(share.changedBy()[plan.uid], 'Jordan');
  // To-dos are See only for Jordan: adding one is refused, in plain words.
  const refusal = await page.evaluate(() => api('/api/capture', { line: 'todo sneaky', space: Object.keys(S.share.projects)[0] }).then(() => 'added', (e) => e.message));
  assert.match(refusal, /only people who may edit/);
  // His own project and a private note, made in the browser: they never reach Sam.
  const mineId = await page.evaluate(async () => {
    const set = await api('/api/settings');
    await api('/api/settings', { spaces: [...set.spaces, { name: 'Side project', color: '#22AA66', group: 'Mine' }] });
    const id = (await api('/api/state')).spaces.find((x) => x.name === 'Side project').id;
    await api('/api/pages', { title: 'My private plans', body: '<p>only mine</p>', space: id });
    return id;
  });
  assert.ok(mineId);
  await page.waitForTimeout(2500);
  await share.syncShares();
  assert.ok(!db.prepare("SELECT 1 FROM pages WHERE title = 'My private plans'").get(), 'not in Sam\'s Switchboard');
  await page.evaluate(() => { location.hash = '#notes'; });
  await page.waitForSelector('text=My private plans', { timeout: 10000 });
  // Sam changes the page; Jordan's browser has it within seconds, over the relay.
  const t0 = Date.now();
  savePage(plan.uid, { body: '<p>Sam was here</p>' }, Date.now() + 1000);
  await share.syncShares();
  await page.waitForFunction(() => (S.pages || []).some((p) => p.preview.includes('Sam was here')), null, { timeout: 8000 });
  assert.ok(Date.now() - t0 < 8000);
  assert.deepEqual(errors, [], 'no errors in the page');
});
