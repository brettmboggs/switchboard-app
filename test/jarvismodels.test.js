// Local models on the graphics card (lib/jarvis.js, lib/lmloaded.js): Jarvis's own unload themselves when
// idle; anything loaded by hand, in LM Studio or held by another app such as Bionic, waits for Unload.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-jvmodels-'));
const { idleModels, IDLE } = await import('../lib/jarvis.js');
const { loadedFrom, heldFrom, ownerOf, NUDGE_MIN } = await import('../lib/lmloaded.js');

test('a model process another app holds (Bionic) is listed with its owner and idle time, never stopped on its own', () => {
  const seen = new Map(), t0 = 1_000_000;
  const info = { model: '/m/llmfan46/Qwen3.6-35B-A3B-uncensored-heretic-Q4_K_M.gguf', cgroup: '0::/user.slice/app.slice/app-ai.elementlabs.bionic-570780.scope', ticks: 100, rss: 4e9 };
  let h = heldFrom(587977, info, seen, t0, 9.6e9);
  assert.deepEqual([h.id, h.name, h.held, h.status, h.idleMin, h.auto, h.nudge, h.size], ['pid:587977', 'Qwen3.6-35B-A3B-uncensored-heretic-Q4_K_M', 'Bionic', 'idle', 0, false, false, 13.6e9]);
  h = heldFrom(587977, { ...info, ticks: 250 }, seen, t0 + 120e3);   // used the processor since the last look: working
  assert.deepEqual([h.status, h.idleMin], ['working', null]);
  h = heldFrom(587977, { ...info, ticks: 250 }, seen, t0 + 120e3 + 31 * 60e3);   // then quiet for 31 minutes
  assert.deepEqual([h.status, h.idleMin, h.nudge], ['idle', 31, true]);
  assert.equal(ownerOf('0::/user.slice/app.slice/something.scope'), 'another app');
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
