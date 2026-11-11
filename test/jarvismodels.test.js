// Jarvis's local model never sits on the graphics card unused (lib/jarvis.js): a model process LM Studio
// has let go of is stopped once it has been seen twice with nothing loaded; while a model is loaded, none is.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-jvmodels-'));
const { strays, idleModels, IDLE } = await import('../lib/jarvis.js');

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

test('a loaded model unused for five minutes is unloaded, whoever loaded it; one answering or just used is not', () => {
  const now = 10_000_000;
  const list = [
    { identifier: 'old', status: 'idle', lastUsedTime: now - 301e3, ttlMs: 3600000 },
    { identifier: 'recent', status: 'idle', lastUsedTime: now - 60e3 },
    { identifier: 'busy', status: 'generating', lastUsedTime: now - 900e3 },
    { identifier: 'never', status: 'idle' }
  ];
  assert.deepEqual(idleModels(list, now), ['old']);
});
