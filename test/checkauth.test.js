// Signed-in browser checks: where the saved sign-in lives and who can read it, that
// a run gets it only for its own check, that nothing from it is kept in a run or
// shown on the board, how a run that finds it expired is handled, and the sign-in
// window itself end to end with a stand-in Playwright (no browser needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, existsSync, symlinkSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-auth-data-'));
process.env.SWITCHBOARD_AUTH = join(mkdtempSync(join(tmpdir(), 'sb-auth-')), 'auth');
process.env.SWITCHBOARD_SESSIONS = 'direct';
const { setSetting } = await import('../lib/db.js');
const bc = await import('../lib/browserchecks.js');
const auth = await import('../lib/checkauth.js');
setSetting('notify', { checks: false });
const SECRET = 'cookie-value-abcdef123456';
const mode = (f) => statSync(f).mode & 0o777;
const wait = async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); } throw new Error('timed out'); };
const putState = (id) => { mkdirSync(auth.AUTH_DIR, { recursive: true }); writeFileSync(auth.statePath(id), JSON.stringify({ cookies: [{ name: 's', value: SECRET }], origins: [{ origin: 'https://x', localStorage: [{ name: 'k', value: 'local-storage-token-999' }] }] })); };

test('the sign-in address: https only, no credentials in it', () => {
  const ok = (signin_url) => bc.cleanCheck({ folder: '/a', signin_url }, { folderExists: () => true });
  assert.equal(ok('https://login.example.com/start').check.signin_url, 'https://login.example.com/start');
  assert.equal(ok('').check.signin_url, null);
  assert.equal(ok('http://localhost:3000/login').check.signin_url, 'http://localhost:3000/login');
  assert.match(ok('http://example.com').error, /https/);
  assert.match(ok('login.example.com').error, /in full/);
  assert.match(ok('https://me:pw@example.com').error, /no user name or password/);
  assert.equal(bc.cleanCheck({ kind: 'page', url: 'https://x.com', signin_url: 'https://x.com' }).check.signin_url, null, 'only a tests check can be signed in');
});

test('the saved sign-in is private, and a loose or linked file is not trusted', () => {
  putState(901);
  assert.equal(auth.stateFile(901), auth.statePath(901));
  chmodSync(auth.statePath(901), 0o644);
  auth.stateFile(901);
  assert.equal(mode(auth.statePath(901)), 0o600, 'a readable file is made private');
  assert.equal(auth.statePath('../x'), null);
  assert.equal(auth.statePath(0), null);
  symlinkSync(auth.statePath(901), auth.statePath(902));
  assert.equal(auth.stateFile(902), null, 'a link is not a saved sign-in');
  auth.removeState(901); auth.removeState(902);
  assert.equal(auth.stateFile(901), null);
});

test('values from the saved sign-in are hidden in text', () => {
  putState(903);
  const secrets = auth.secretsIn(903);
  assert.ok(secrets.includes(SECRET) && secrets.includes('local-storage-token-999'));
  assert.equal(auth.scrub(`token=${SECRET}; and local-storage-token-999`, secrets), 'token=[hidden]; and [hidden]');
  auth.removeState(903);
});

test('a signed-in check: waits for sign-in, gets its own state only, keeps nothing secret, stops when it expires', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'sb-proj-'));
  // Stands in for the project's tests: reports whether it was given a state, prints a cookie value, and says it expired when told to.
  writeFileSync(join(folder, 'fake.mjs'), `import { readFileSync, existsSync } from 'node:fs';
const f = process.env.SB_AUTH_STATE;
console.log('state given: ' + (f ? 'yes' : 'no'));
if (f) console.log('cookie: ' + JSON.parse(readFileSync(f, 'utf8')).cookies[0].value);
if (existsSync('EXPIRE')) { console.log('SIGNIN_EXPIRED'); process.exit(1); }`);
  const mk = (extra) => bc.saveCheck({ kind: 'tests', folder, command: `"${process.execPath}" fake.mjs`, ...extra });
  const signed = mk({ name: 'Signed', signin_url: 'https://login.example.com/' });
  const plainCheck = mk({ name: 'Plain' });
  const view = () => bc.checksForBoard().find((c) => c.id === signed.id);

  assert.equal(view().signin.state, 'none');
  assert.match(bc.runCheck(signed.id).error, /sign in first/i, 'no sign-in, no run');
  assert.equal(view().runs.length, 0);

  putState(signed.id);
  assert.equal(view().signin.state, 'ok');
  const run = async (id) => { bc.runCheck(id); return wait(() => { const c = bc.checksForBoard().find((x) => x.id === id); return c.runs[0] && !['queued', 'running'].includes(c.runs[0].state) && c; }); };
  let c = await run(signed.id);
  assert.equal(c.runs[0].state, 'success');
  const out = bc.runDetail(c.runs[0].id).output;
  assert.match(out, /state given: yes/);
  assert.doesNotMatch(out, new RegExp(SECRET), 'the cookie value the test printed is hidden');
  assert.match(out, /cookie: \[hidden\]/);
  assert.doesNotMatch(JSON.stringify(bc.checksForBoard()), new RegExp(SECRET + '|' + auth.AUTH_DIR.replace(/[/\\]/g, '.')), 'the board never carries the state or its path');

  c = await run(plainCheck.id);
  assert.match(bc.runDetail(c.runs[0].id).output, /state given: no/, 'another check is given nothing');

  writeFileSync(join(folder, 'EXPIRE'), '');
  c = await run(signed.id);
  assert.equal(c.runs[0].state, 'failure');
  assert.match(c.runs[0].summary, /Signed out/);
  assert.equal(c.signin.state, 'expired');
  const before = c.runs.length;
  assert.match(bc.runCheck(signed.id).error, /sign in first/i, 'it does not run again until you sign in');
  assert.equal(bc.checksForBoard().find((x) => x.id === signed.id).runs.length, before);

  // Changing the sign-in address drops the saved sign-in: it was made for the old one.
  assert.ok(existsSync(auth.statePath(signed.id)));
  bc.saveCheck({ id: signed.id, kind: 'tests', folder, command: `"${process.execPath}" fake.mjs`, name: 'Signed', signin_url: 'https://other.example.com/' });
  assert.equal(existsSync(auth.statePath(signed.id)), false);
  assert.equal(view().signin.state, 'none');

  putState(signed.id);
  assert.ok(bc.signOut(signed.id).ok);
  assert.equal(existsSync(auth.statePath(signed.id)), false, 'Sign out deletes the file');
  putState(signed.id);
  bc.removeCheck(signed.id);
  assert.equal(existsSync(auth.statePath(signed.id)), false, 'removing the check deletes the file');
});

test('the sign-in window, end to end with a stand-in Playwright: Done saves a private file, Cancel saves nothing', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'sb-proj-'));
  const pkg = join(folder, 'node_modules', '@playwright', 'test');
  mkdirSync(pkg, { recursive: true });
  writeFileSync(join(folder, 'package.json'), '{}');
  writeFileSync(join(pkg, 'package.json'), '{"name":"@playwright/test","main":"index.js"}');
  writeFileSync(join(pkg, 'index.js'), `exports.chromium = { launch: async (o) => { if (o.headless !== false) throw new Error('must be visible'); return {
  on() {}, close: async () => {},
  newContext: async () => ({ pages: () => [{ url: () => require('fs').existsSync('BACK') ? 'https://login.example.com/home' : 'https://idp.example.net/signin' }], newPage: async () => ({ goto: async () => {} }), storageState: async () => ({ cookies: [{ name: 's', value: 'signed-in-value-123456' }], origins: [] }) }) }; } };`);
  const saved = bc.saveCheck({ kind: 'tests', folder, command: 'npx playwright test', name: 'Win', signin_url: 'https://login.example.com/' });
  const id = saved.id;
  const state = () => bc.checksForBoard().find((c) => c.id === id).signin.state;

  assert.ok(bc.openSignin(id).ok);
  assert.match(bc.openSignin(id).error, /already open/);
  await wait(() => state() === 'open' && auth.signinState(id) === 'open');
  assert.equal(auth.stateFile(id), null, 'nothing is saved until Done');
  assert.ok(auth.cancelSignin(id) === undefined);
  await wait(() => state() === 'none' && auth.signinResult(id)?.state === 'cancelled');
  assert.equal(auth.stateFile(id), null);

  assert.ok(bc.openSignin(id).ok);
  await wait(() => state() === 'open' && auth.signinState(id) === 'open');
  // Done while the window is still on another site (the identity provider) saves nothing and keeps the window open.
  assert.ok(auth.finishSignin(id).ok);
  await wait(() => auth.signinResult(id)?.state === 'waiting' && auth.signinState(id) === 'open');
  assert.equal(auth.stateFile(id), null);
  writeFileSync(join(folder, 'BACK'), '');   // the window is back on the app
  assert.ok(auth.finishSignin(id).ok);
  await wait(() => state() === 'ok');
  assert.equal(mode(auth.statePath(id)), 0o600);
  assert.equal(mode(auth.AUTH_DIR), 0o700);
  assert.equal(JSON.parse(readFileSync(auth.statePath(id), 'utf8')).cookies[0].value, 'signed-in-value-123456');
  assert.equal(auth.signinResult(id).state, 'saved');
  bc.removeCheck(id);
});
