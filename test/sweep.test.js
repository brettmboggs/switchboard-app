// Ending a session leaves nothing running (lib/terminals.js sweepSession):
// every process it started carries SWITCHBOARD_TERM=<id>, including ones that
// detached themselves, and all of them stop. Other sessions' processes stay.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-sweep-'));
const { taggedPids, sweepSession } = await import('../lib/terminals.js');

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const until = async (fn, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 50)); } return fn(); };
// A detached process (its own process group, parent gone) that ignores SIGTERM,
// like a server that will not stop when asked.
const start = (id, stubborn) => {
  const p = spawn(process.execPath, ['-e', `${stubborn ? "process.on('SIGTERM', () => {});" : ''} setInterval(() => {}, 1000)`], { detached: true, stdio: 'ignore', env: { ...process.env, SWITCHBOARD_TERM: id } });
  p.unref();
  return p.pid;
};

test('a session\'s leftovers stop, even detached or stubborn; another session\'s do not', { skip: process.platform !== 'linux' && process.platform !== 'darwin' }, async () => {
  const id = 'sb-sweep-test-' + process.pid, other = id + '-other';
  const a = start(id, false), b = start(id, true), c = start(other, false);
  try {
    assert.ok(await until(() => { const t = taggedPids(id); return t.includes(a) && t.includes(b); }), 'found by their tag');
    assert.ok(!taggedPids(id).includes(c));
    assert.ok(!taggedPids(id).includes(process.pid), 'never Switchboard itself');
    assert.equal(sweepSession(id), 2);
    assert.ok(await until(() => !alive(a)), 'asked to stop, it stops');
    assert.ok(await until(() => !alive(b)), 'one that ignores the ask is stopped 3 seconds later');
    assert.ok(alive(c), 'another session is left alone');
  } finally { for (const p of [a, b, c]) { try { process.kill(p, 'SIGKILL'); } catch {} } }
});
