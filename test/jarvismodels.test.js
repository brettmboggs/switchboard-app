// Jarvis's local model never sits on the graphics card unused (lib/jarvis.js): a model process LM Studio
// has let go of is stopped once it has been seen twice with nothing loaded; while a model is loaded, none is.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-jvmodels-'));
const { strays, idleModels, IDLE } = await import('../lib/jarvis.js');
const { loadedFrom, NUDGE_MIN } = await import('../lib/lmloaded.js');

test('a lingering model process is stopped on the second sweep, never while LM Studio has a model loaded', () => {
  let r = strays(new Set(), [101], 0);
  assert.deepEqual(r.kill, []);   // first sight: it may be loading
  r = strays(r.suspects, [101, 202], 0);
  assert.deepEqual(r.kill, [101]);
  assert.deepEqual([...r.suspects], [101, 202]);
  r = strays(r.suspects, [202], 1);   // a model is loaded: LM Studio's own
  assert.deepEqual(r.kill, []);
  assert.equal(r.suspects.size, 0);
});

test('the model unloads itself after five idle minutes', () => {
  assert.equal(IDLE, 300);
});

test('a model with a time limit (Jarvis\'s, or one LM Studio loaded for a question) unused for five minutes is unloaded; one loaded by hand, answering or just used is not', () => {
  const now = 10_000_000;
  const list = [
    { identifier: 'old', status: 'idle', lastUsedTime: now - 301e3, ttlMs: 3600000 },
    { identifier: 'recent', status: 'idle', lastUsedTime: now - 60e3 },
    { identifier: 'busy', status: 'generating', lastUsedTime: now - 900e3 },
    { identifier: 'reading', status: 'processingprompt', lastUsedTime: now - 900e3 },
    { identifier: 'loading', status: 'loading', lastUsedTime: now - 900e3 },
    { identifier: 'waiting', status: 'idle', queued: 1, lastUsedTime: now - 900e3 },
    { identifier: 'never', status: 'idle' },
    { identifier: 'by-hand', status: 'idle', lastUsedTime: now - 7200e3, ttlMs: null },
    { identifier: 'jarvis', status: 'idle', lastUsedTime: now - 400e3, ttlMs: 300000 }
  ];
  assert.deepEqual(idleModels(list, now), ['old', 'jarvis']);
});

test('the Local AI card lists what is loaded: a model loaded by hand is never automatic, and is pointed out after 30 idle minutes', () => {
  const now = 10_000_000;
  const list = loadedFrom([
    { identifier: 'qwen-big', displayName: 'Qwen Big', sizeBytes: 22e9, status: 'idle', lastUsedTime: now - 45 * 60e3, ttlMs: null },
    { identifier: 'gemma', modelKey: 'google/gemma', sizeBytes: 7e9, status: 'idle', lastUsedTime: now - 2 * 60e3, ttlMs: 300000 },
    { identifier: 'busy', status: 'processingprompt', lastUsedTime: now - 90 * 60e3 },
    { status: 'idle' }
  ], now);
  assert.deepEqual(list.map((m) => [m.id, m.name, m.idleMin, m.auto, m.nudge]), [
    ['qwen-big', 'Qwen Big', 45, false, true],
    ['gemma', 'google/gemma', 2, true, false],
    ['busy', 'busy', null, false, false]
  ]);
  assert.equal(NUDGE_MIN, 30);
});
