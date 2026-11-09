// Settings, Projects in a real (headless) browser (review L2): a new project
// named like an older one gets its own first rule, typing in its rule box
// survives the save that gives the project its id, and Enter twice adds once.
// Needs Chrome and playwright-core (the copy that comes with the Playwright CLI); skipped without.
/* global S, openSettings */   // the page's own, inside page.evaluate
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';

const candidates = [process.env.PLAYWRIGHT_CORE, (() => { try { return join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), '@playwright/cli/node_modules/playwright-core/index.mjs'); } catch { return null; } })(), join(homedir(), '.nvm')].filter((p) => p && p.endsWith('.mjs') && existsSync(p));
const chrome = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
const pw = candidates[0] && chrome ? await import(candidates[0]).catch(() => null) : null;
const freePort = () => new Promise((r) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

test('a new project\'s first rule goes to it, typing survives its save (review L2), quick or elsewhere rule changes stick (re-review M7), and a new project keeps the id made for it (re-review L2)', { skip: !pw && 'no Chrome or playwright-core on this computer', timeout: 120000 }, async (t) => {
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', new URL('../server.js', import.meta.url).pathname],
    { env: { ...process.env, SWITCHBOARD_PORT: String(port), SWITCHBOARD_DATA: mkdtempSync(join(tmpdir(), 'sb-sete2e-')), SWITCHBOARD_SESSIONS: 'direct', SWITCHBOARD_HELPER_GRACE: '300' }, stdio: ['ignore', 'pipe', 'pipe'] });
  after(() => new Promise((r) => { if (srv.exitCode !== null) return r(); srv.on('exit', r); srv.kill('SIGTERM'); setTimeout(() => srv.kill('SIGKILL'), 5000).unref(); }));
  let log = '';
  const up = await new Promise((ok) => { const tm = setTimeout(() => ok(false), 20000); const look = (c) => { log += c; if (/Switchboard on /.test(log)) { clearTimeout(tm); ok(true); } }; srv.stdout.on('data', look); srv.stderr.on('data', look); srv.on('exit', () => ok(false)); });
  if (!up) { if (/EADDRINUSE|EACCES|EPERM/.test(log)) return t.skip('could not bind a port here'); assert.fail('Switchboard did not start:\n' + log); }
  const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Switchboard': '1' }, body: JSON.stringify(body) });
  await post('/api/settings', { spaces: [{ id: 'acme', name: 'Acme', color: '#3366AA', group: 'Work' }, { id: 'personal', name: 'Personal', color: '#8A8F98', group: 'Mine' }], prefs: { welcome: { done: true, seen: [], uses: [] } } });
  const settings = async () => (await fetch(base + '/api/settings')).json();

  const browser = await pw.chromium.launch({ executablePath: chrome });
  after(() => browser.close());
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  // Saves take a while, as on a slow computer: each settings save is held 600 ms on its way.
  await page.route('**/api/settings', async (route) => { if (route.request().method() === 'POST') await new Promise((r) => setTimeout(r, 600)); return route.continue(); });
  await page.goto(base + '/');
  await page.waitForFunction(() => typeof openSettings === 'function' && typeof S !== 'undefined' && S);
  await page.evaluate(() => openSettings('projects'));
  await page.waitForSelector('#proj-list .proj');
  const ruleBox = () => page.locator('#proj-list .proj').last().locator('[data-rule-add]');
  const until = async (fn) => { for (let i = 0; i < 60; i++) { const s = await settings(); if (fn(s)) return s; await page.waitForTimeout(150); } return settings(); };

  // 1. Typing in the rule box while the new project's first save is out: nothing typed is lost.
  await page.click('#proj-add');
  await page.locator('#proj-list .proj').last().locator('[data-field="name"]').fill('Acme');
  await ruleBox().click();   // leaving the name saves the project: that save starts now
  await page.keyboard.type('sh');
  await page.waitForTimeout(1000);   // the save comes back meanwhile
  await page.keyboard.type('ed');
  await page.keyboard.press('Enter');
  let s = await until((x) => x.rules.some(([v]) => /ed$/.test(v)));
  assert.deepEqual(s.rules.filter(([v]) => /ed$/.test(v)), [['shed', 'acme-2']], 'typed whole, for the new project: ' + JSON.stringify(s.rules));

  // 2. Enter while a new project's save is still out (and Enter twice): its own project, made once.
  await page.click('#proj-add');
  await page.locator('#proj-list .proj').last().locator('[data-field="name"]').fill('Acme');
  await ruleBox().click();
  await page.keyboard.type('garage');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  s = await until((x) => x.rules.some(([v]) => v === 'garage') && x.spaces.length >= 4);
  await page.waitForTimeout(1500);
  s = await settings();
  const acmes = s.spaces.filter((x) => x.name === 'Acme').map((x) => x.id);
  assert.equal(acmes.length, 3, 'one more project, not two: ' + JSON.stringify(s.spaces));
  assert.deepEqual(s.rules.filter(([v]) => v === 'garage'), [['garage', acmes[2]]], 'the rule is the newest project\'s, once: ' + JSON.stringify(s.rules));

  // 3. A rule added and taken away again before the first save comes back stays away (re-review M7).
  const acmeBox = page.locator('#proj-list .proj').first().locator('[data-rule-add]');
  await acmeBox.click();
  await page.keyboard.type('porch');
  await page.keyboard.press('Enter');
  await page.locator('#proj-list .proj').first().locator('[aria-label="Remove porch"]').click();
  await page.waitForTimeout(2000);
  s = await settings();
  assert.ok(!s.rules.some(([v]) => v === 'porch'), 'added then removed: gone: ' + JSON.stringify(s.rules));

  // 4. A rule deleted elsewhere while Settings is open stays deleted when the page saves another.
  const now = await settings();
  await post('/api/settings', { rulesRemove: [['shed', 'acme-2']] });
  assert.ok(!(await settings()).rules.some(([v]) => v === 'shed'));
  await acmeBox.click();
  await page.keyboard.type('attic');
  await page.keyboard.press('Enter');
  s = await until((x) => x.rules.some(([v]) => v === 'attic'));
  await page.waitForTimeout(800);
  s = await settings();
  assert.ok(!s.rules.some(([v]) => v === 'shed'), 'deleted elsewhere: still gone: ' + JSON.stringify(s.rules));
  assert.deepEqual(s.rules.filter(([v]) => v === 'attic'), [['attic', 'acme']]);
  assert.equal(s.rules.length, now.rules.length, 'one in, one out');

  // 5. A project of the same name made elsewhere while the page's new one is being saved keeps its own id,
  // and the page's project gets the id made for it, never found by name (re-review L2).
  const before5 = await settings();
  await page.click('#proj-add');
  await page.locator('#proj-list .proj').last().locator('[data-field="name"]').fill('Garden');
  await ruleBox().click();   // the page's save starts, and is held
  await post('/api/settings', { spaces: [...before5.spaces, { id: 'garden', name: 'Garden', color: '#22AA66', group: 'Mine' }], spacesWas: before5.spaces.map((x) => x.id) });
  await page.keyboard.type('compost');
  await page.keyboard.press('Enter');
  s = await until((x) => x.rules.some(([v]) => v === 'compost'));
  await page.waitForTimeout(1500);
  s = await settings();
  const gardens = s.spaces.filter((x) => x.name === 'Garden');
  assert.equal(gardens.length, 2, 'both projects: ' + JSON.stringify(s.spaces));
  assert.equal(s.spaces.find((x) => x.id === 'garden')?.color, '#22AA66', 'the one made elsewhere keeps its id: ' + JSON.stringify(s.spaces));
  const ours = gardens.find((x) => x.id !== 'garden').id;
  assert.deepEqual(s.rules.filter(([v]) => v === 'compost'), [['compost', ours]], 'the rule is the page\'s new project\'s: ' + JSON.stringify(s.rules));

  // 6. Renamed while its first save is out: still one project, not two.
  const before6 = await settings();
  await page.click('#proj-add');
  const nameBox = page.locator('#proj-list .proj').last().locator('[data-field="name"]');
  await nameBox.fill('Studio');
  await ruleBox().click();
  await nameBox.fill('Workshop');
  await ruleBox().click();
  await page.keyboard.type('bench');
  await page.keyboard.press('Enter');
  s = await until((x) => x.rules.some(([v]) => v === 'bench'));
  await page.waitForTimeout(2000);
  s = await settings();
  assert.equal(s.spaces.length, before6.spaces.length + 1, 'one more project: ' + JSON.stringify(s.spaces));
  const shop = s.spaces.find((x) => x.name === 'Workshop');
  assert.ok(shop, 'named as typed last: ' + JSON.stringify(s.spaces));
  assert.deepEqual(s.rules.filter(([v]) => v === 'bench'), [['bench', shop.id]], JSON.stringify(s.rules));
  assert.deepEqual(errors, []);
});
