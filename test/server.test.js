// server.js as a whole, on a free port with its own data folder: the host and
// header checks, the page's security headers, the hook, webhooks in, static
// files, and a bad request line. Skips when it cannot bind a port.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, request } from 'node:http';
import { connect } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DATA = mkdtempSync(join(tmpdir(), 'sb-server-'));
process.env.SWITCHBOARD_DATA = DATA;
const { setSetting } = await import('../lib/db.js');
setSetting('notify', { waiting: false, finished: false, checks: false });   // no desktop alerts from the tests
const { ghNumber } = await import('../lib/github.js');

const freePort = () => new Promise((r) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

async function boot() {
  const port = await freePort();
  const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', new URL('../server.js', import.meta.url).pathname],
    { env: { ...process.env, SWITCHBOARD_PORT: String(port), SWITCHBOARD_DATA: DATA, SWITCHBOARD_SESSIONS: 'direct' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  const up = await new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), 20000);
    const look = (c) => { log += c; if (/Switchboard on /.test(log)) { clearTimeout(t); resolve(true); } };
    p.stdout.on('data', look); p.stderr.on('data', look);
    p.on('exit', () => { clearTimeout(t); resolve(false); });
  });
  const stop = () => new Promise((r) => { if (p.exitCode !== null) return r(); p.on('exit', r); p.kill('SIGTERM'); setTimeout(() => p.kill('SIGKILL'), 5000).unref(); });
  return { port, up, log: () => log, stop };
}

const req = (port, method, path, { headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const r = request({ host: '127.0.0.1', port, method, path, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
    let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: d }));
  });
  r.on('error', reject);
  if (body) r.write(body);
  r.end();
});
// A request line the HTTP module would not write itself.
const raw = (port, text) => new Promise((resolve, reject) => {
  const s = connect(port, '127.0.0.1', () => s.write(text));
  let d = ''; s.on('data', (c) => (d += c)); s.on('end', () => resolve(d)); s.on('close', () => resolve(d)); s.on('error', reject);
  setTimeout(() => s.destroy(), 3000).unref();
});

test('the server end to end', async (t) => {
  const srv = await boot();
  if (!srv.up) {
    if (/EADDRINUSE|EACCES|EPERM/.test(srv.log())) { await srv.stop(); return t.skip('could not bind a port here'); }
    await srv.stop();
    assert.fail('Switchboard did not start:\n' + srv.log());
  }
  const { port } = srv;
  const zeros = '0'.repeat(64);
  try {
    await t.test('the page, with its security headers', async () => {
      const r = await req(port, 'GET', '/');
      assert.equal(r.status, 200);
      const csp = r.headers['content-security-policy'] || '';
      assert.match(csp, /object-src 'none'/);
      assert.match(csp, /frame-ancestors 'none'/);
      assert.doesNotMatch(csp, /unsafe-eval/);
      assert.equal(r.headers['x-content-type-options'], 'nosniff');
    });
    await t.test('the board state', async () => {
      const r = await req(port, 'GET', '/api/state');
      assert.equal(r.status, 200);
      assert.ok(Array.isArray(JSON.parse(r.body).spaces));
    });
    await t.test('a POST without the header, and a request for another host', async () => {
      assert.equal((await req(port, 'POST', '/api/item', { headers: { 'content-type': 'application/json' }, body: '{"text":"x"}' })).status, 403);
      assert.equal((await req(port, 'GET', '/', { headers: { host: `evil.test:${port}` } })).status, 403);
      assert.equal((await req(port, 'GET', '/api/state', { headers: { host: `127.0.0.1:${port + 1}` } })).status, 403);
    });
    await t.test('the Claude Code hook', async () => {
      const body = JSON.stringify({ hook_event_name: 'Stop', session_id: 'test-session', cwd: DATA });
      const r = await req(port, 'POST', '/hook/claude?event=Stop', { headers: { 'X-Switchboard': '1', 'content-type': 'application/json' }, body });
      assert.ok(r.status >= 200 && r.status < 300, String(r.status));
    });
    await t.test('webhooks in: scripts only, and only a real secret', async () => {
      assert.equal((await req(port, 'GET', `/hook/in/${zeros}`)).status, 405);
      assert.equal((await req(port, 'POST', `/hook/in/${zeros}`, { headers: { origin: 'https://evil.test' }, body: 'x' })).status, 403);
      assert.equal((await req(port, 'POST', `/hook/in/${zeros}`, { headers: { 'sec-fetch-site': 'cross-site' }, body: 'x' })).status, 403);
      assert.equal((await req(port, 'POST', `/hook/in/${zeros}`, { body: 'x' })).status, 404);
    });
    await t.test('static files: the vendored terminal yes, the server\'s own files no', async () => {
      assert.equal((await req(port, 'GET', '/vendor/xterm.js')).status, 200);
      assert.equal((await req(port, 'GET', '/js/core.js')).status, 200);
      assert.notEqual((await req(port, 'GET', '/js/../server.js')).status, 200);
      assert.notEqual((await req(port, 'GET', '/js/..%2fserver.js')).status, 200);
      assert.notEqual((await req(port, 'GET', '/vendor/../../package.json')).status, 200);
      const r = await req(port, 'GET', '/js/../server.js');
      assert.doesNotMatch(r.body, /createServer/);
    });
    await t.test('a request line that is not a URL gets a 400, not a crash', async () => {
      const r = await raw(port, `GET http://[ HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`);
      assert.match(r, /^HTTP\/1\.1 400/);
      assert.equal((await req(port, 'GET', '/api/state')).status, 200);   // still up
    });
  } finally { await srv.stop(); }
});

test('numbers for gh: positive whole numbers only', () => {
  assert.equal(ghNumber(42), '42');
  assert.equal(ghNumber('42'), '42');
  for (const bad of ['--help', '-1', '0', '1.5', '', null, undefined, '4 --flag', 'NaN', '1e3x', [1, 2]]) assert.throws(() => ghNumber(bad), bad === undefined ? undefined : String(bad));
});
