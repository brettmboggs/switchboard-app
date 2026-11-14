// Ending apps from the System monitor (lib/procs.js): the plain-words name of a
// process, its label (safe to end, ask first, keep), the readings it is built
// from, and ending real child processes, politely and then by force.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, shortFolder, classify, worst, appLabel, parseNvidiaProcs, parseListen, endProcs, CAN_END } from '../lib/procs.js';

const H = '/home/sam';

test('a folder in short: past the usual code folder, at most two parts', () => {
  assert.equal(shortFolder('/home/sam/dev/shop/web', H), 'shop/web');
  assert.equal(shortFolder('/home/sam/ComfyUI', H), 'ComfyUI');
  assert.equal(shortFolder('/home/sam', H), null);
  assert.equal(shortFolder('/opt/google/chrome', H), 'google/chrome');
});

test('what a process is: the script for an interpreter, a browser helper by its role', () => {
  assert.equal(describe(['python', 'main.py', '--listen', '0.0.0.0'], '/home/sam/ComfyUI', 'python', H), 'main.py in ComfyUI');
  assert.equal(describe(['node', '/home/sam/dev/shop/web/node_modules/.bin/vite', '--port', '3000'], '/home/sam/dev/shop/web', 'node', H), 'vite in shop/web');
  assert.equal(describe(['/usr/bin/python3', '-m', 'http.server'], '/home/sam/dev/site', 'python3', H), 'http.server in site');
  assert.equal(describe(['/opt/google/chrome/chrome --type=renderer --lang=en-US'], H, 'chrome', H), 'chrome renderer');
  assert.equal(describe([], null, 'kworker/0:1', H), 'kworker/0:1');
});

test('labels: the system and tmux stay, work in progress asks, idle and yours is safe', () => {
  const me = { myUid: 1000, uid: 1000, argv: [], cpu: 0 };
  const L = (f) => classify({ ...me, ...f }).level;
  assert.equal(L({ name: 'switchboard', self: true }), 'keep');
  assert.equal(L({ name: 'tmux: server' }), 'keep');
  assert.equal(L({ name: 'Xorg', uid: 0 }), 'keep');
  assert.equal(L({ name: 'cinnamon' }), 'keep');
  assert.equal(L({ name: 'node', term: 'sb-shop' }), 'ask');
  assert.match(classify({ ...me, name: 'node', term: 'sb-shop' }).why, /shop session/);
  assert.equal(L({ name: 'claude' }), 'ask');
  assert.equal(L({ name: 'bash', inTmux: true }), 'ask');
  assert.equal(L({ name: 'chrome' }), 'ask');
  assert.equal(L({ name: 'code' }), 'ask');
  assert.equal(L({ name: 'llama-server', argv: ['/home/sam/.lmstudio/extensions/backends/x/llama-server'] }), 'ask');
  assert.equal(L({ name: 'bionic' }), 'ask');
  assert.equal(L({ name: 'python', cpu: 40 }), 'ask');
  assert.equal(L({ name: 'python', cpu: 0.2 }), 'safe');
  assert.match(classify({ ...me, name: 'node', ports: [3000] }).why, /port 3000/);
});

test('an app takes the most careful label of the processes that can end; keep only when all are', () => {
  const s = { level: 'safe', why: 'idle' }, a = { level: 'ask', why: 'busy' }, k = { level: 'keep', why: 'system' };
  assert.equal(worst([s, a]).level, 'ask');
  assert.deepEqual([appLabel([s, k]).level, appLabel([s, k]).some], ['safe', true]);
  assert.equal(appLabel([k, k]).level, 'keep');
  assert.equal(appLabel([]).level, null);
});

test('nvidia-smi process table: video memory by pid, graphics and compute', () => {
  const t = `| Processes:                                                                              |
|  GPU   GI   CI              PID   Type   Process name                        GPU Memory |
|=========================================================================================|
|    0   N/A  N/A            1568      G   /usr/lib/xorg/Xorg                      355MiB |
|    0   N/A  N/A          857366      C   python                                  256MiB |
+-----------------------------------------------------------------------------------------+`;
  const m = parseNvidiaProcs(t);
  assert.equal(m.get(1568), 355 * 1048576); assert.equal(m.get(857366), 256 * 1048576); assert.equal(m.size, 2);
});

test('listening sockets: inode to port, only LISTEN rows', () => {
  const t = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 0100007F:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 55501 1
   1: 0100007F:A1B2 0100007F:0BB8 01 00000000:00000000 00:00000000 00000000  1000        0 55502 1`;
  const m = parseListen(t);
  assert.equal(m.get('55501'), 3000); assert.equal(m.has('55502'), false);
});

const startOf = (pid) => Number(readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ')[19]);
const gone = (child) => new Promise((ok) => (child.exitCode != null || child.signalCode ? ok() : child.once('exit', ok)));

test('ending: Switchboard is refused, its children ask first, then go', { skip: !CAN_END }, async () => {
  const child = spawn('sleep', ['30']);
  await new Promise((r) => setTimeout(r, 100));
  const me = { pid: process.pid, start: startOf(process.pid), ppid: process.ppid, name: 'node', cpu: 0, mem: 0 };
  const kid = { pid: child.pid, start: startOf(child.pid), ppid: process.pid, name: 'sleep', cpu: 0, mem: 0 };
  const procs = [me, kid];
  const self = await endProcs({ targets: [{ pid: me.pid, start: me.start }] }, procs);
  assert.equal(self.refused.length, 1); assert.equal(self.ended.length, 0);
  const ask = await endProcs({ targets: [{ pid: kid.pid, start: kid.start }] }, procs);
  assert.equal(ask.needSure.length, 1); assert.equal(child.exitCode, null);
  const wrongStart = await endProcs({ targets: [{ pid: kid.pid, start: kid.start + 1 }], sure: true }, procs);
  assert.equal(wrongStart.ended.length, 0);                      // a reused pid is left alone
  const r = await endProcs({ targets: [{ pid: kid.pid, start: kid.start }], sure: true }, procs);
  assert.deepEqual(r.ended, [kid.pid]); await gone(child);
});

test('ending: one that ignores the polite ask is reported, and Force end stops it', { skip: !CAN_END }, async () => {
  const child = spawn('sh', ['-c', 'trap "" TERM; while :; do sleep 0.2; done']);
  await new Promise((r) => setTimeout(r, 150));
  const kid = { pid: child.pid, start: startOf(child.pid), ppid: process.pid, name: 'sh', cpu: 0, mem: 0 };
  const procs = [{ pid: process.pid, start: startOf(process.pid), ppid: process.ppid, name: 'node', cpu: 0, mem: 0 }, kid];
  const r = await endProcs({ targets: [{ pid: kid.pid, start: kid.start }], sure: true }, procs, { wait: 2000 });
  assert.equal(r.left.length, 1);
  const f = await endProcs({ targets: r.left, sure: true, force: true }, procs);
  assert.deepEqual(f.ended, [kid.pid]); await gone(child);
});
