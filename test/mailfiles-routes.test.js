// The file routes for email and Outlook (lib/routes/inbox.js) turn away
// anything that is not a well-formed ask for the person's own mail, before
// touching a mail server: a test copy has no accounts, so nothing is fetched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, request } from 'node:http';

const DATA = mkdtempSync(join(tmpdir(), 'sb-mailroutes-'));
const freePort = () => new Promise((r) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const get = (port, path) => new Promise((resolve, reject) => {
  const r = request({ host: '127.0.0.1', port, method: 'GET', path, headers: { host: `127.0.0.1:${port}` } }, (res) => {
    let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ status: res.statusCode, body: d }));
  });
  r.on('error', reject); r.end();
});

test('email and Outlook file routes take only well-formed asks', async (t) => {
  const port = await freePort();
  const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', new URL('../server.js', import.meta.url).pathname],
    { env: { ...process.env, SWITCHBOARD_PORT: String(port), SWITCHBOARD_DATA: DATA, SWITCHBOARD_SESSIONS: 'direct', SWITCHBOARD_HELPER_GRACE: '300' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  const up = await new Promise((resolve) => {
    const tm = setTimeout(() => resolve(false), 20000);
    const look = (c) => { log += c; if (/Switchboard on /.test(log)) { clearTimeout(tm); resolve(true); } };
    p.stdout.on('data', look); p.stderr.on('data', look);
    p.on('exit', () => { clearTimeout(tm); resolve(false); });
  });
  const stop = () => new Promise((r) => { if (p.exitCode !== null) return r(); p.on('exit', r); p.kill('SIGTERM'); setTimeout(() => p.kill('SIGKILL'), 5000).unref(); });
  try {
    if (!up) { if (/EADDRINUSE|EACCES|EPERM/.test(log)) return t.skip('could not bind a port here'); assert.fail('Switchboard did not start:\n' + log); }
    assert.equal((await get(port, '/api/mail/files?key=teams:abc')).status, 400);
    assert.equal((await get(port, '/api/mail/files?key=mail:nobody@example.com:123')).status, 404, 'an account that is not connected');
    for (const q of ['a=nobody@example.com&u=1&p=1', 'a=x&u=1:*&p=1', 'a=x&u=1&p=HEADER', 'a=x&u=1&p=1..2'])
      assert.equal((await get(port, '/api/mail/file?' + q)).status, 400, q);
    const none = await get(port, '/api/outlook/files?ids=../me,a%20b');
    assert.equal(none.status, 200); assert.equal(none.body, '{}', 'bad ids are dropped, not fetched');
    assert.equal((await get(port, '/api/outlook/file?m=../me&f=x')).status, 400);
  } finally { await stop(); }
});
