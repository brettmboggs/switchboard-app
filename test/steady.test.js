// Connections ride out blips (lib/steady.js): a passing failure is retried and
// kept off the page for a while; one that needs the person shows at once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transient, retry, hold, ok, GRACE } from '../lib/steady.js';

test('network stalls, timeouts and 5xx answers pass on their own; sign-in trouble does not', () => {
  assert.ok(transient(Object.assign(new Error('getaddrinfo ENOTFOUND imap.gmail.com'), { code: 'ENOTFOUND' })));
  assert.ok(transient(new TypeError('fetch failed', { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } })));
  assert.ok(transient(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })));
  assert.ok(transient(Object.assign(new Error('Microsoft is having trouble right now (it answered 502).'), { status: 502 })));
  assert.ok(transient(Object.assign(new Error('Command failed: gh api user'), { stderr: 'error connecting to api.github.com' })));
  assert.ok(transient(Object.assign(new Error('Command failed: gh api user'), { killed: true, signal: 'SIGTERM' })));
  assert.ok(!transient(Object.assign(new Error('Google signed Switchboard out.'), { signin: true })));
  assert.ok(!transient(new Error('Gmail refused the sign-in. Check the app password.')));
  assert.ok(!transient(Object.assign(new Error('Command failed: gh api user'), { stderr: 'HTTP 401: Bad credentials' })));
  assert.ok(!transient(null));
});

test('retry tries a passing failure again and gives up on the rest at once', async () => {
  const sleeper = async () => {};
  let n = 0;
  assert.equal(await retry(async () => { if (++n < 3) throw Object.assign(new Error('x'), { code: 'EAI_AGAIN' }); return 'ok'; }, { sleeper }), 'ok');
  assert.equal(n, 3);
  n = 0;
  await assert.rejects(retry(async () => { n++; throw new Error('refused the sign-in'); }, { sleeper }), /refused/);
  assert.equal(n, 1, 'a refused password is not retried');
  n = 0;
  await assert.rejects(retry(async () => { n++; throw Object.assign(new Error('503'), { status: 503 }); }, { sleeper }), /503/);
  assert.equal(n, 3, 'three tries in all, then the failure stands');
});

test('a blip stays hidden until it has lasted GRACE; a real problem shows at once', () => {
  const blip = Object.assign(new Error('x'), { code: 'ENOTFOUND' });
  const t0 = 1_000_000;
  assert.equal(hold('t:a', blip, t0), true);
  assert.equal(hold('t:a', blip, t0 + GRACE - 1), true);
  assert.equal(hold('t:a', blip, t0 + GRACE), false, 'shown once it has lasted');
  ok('t:a');
  assert.equal(hold('t:a', blip, t0 + GRACE + 5), true, 'a fresh count after it worked again');
  assert.equal(hold('t:b', Object.assign(new Error('signed out'), { signin: true }), t0), false);
});
