// Switchboard's own model engine (lib/engine.js): the right engine picked, model
// files found, the measured settings used, a failed start said in plain words,
// and Sessions' Local AI agent started with the one model Switchboard runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-engine-'));
process.env.HOME = process.env.USERPROFILE = mkdtempSync(join(tmpdir(), 'sb-engine-home-'));   // no real models or engine
const { pickBackend, modelsIn, modelLabel, engineArgs, whyFailed, threadsFor, config, saveConfig, usable } = await import('../lib/engine.js');

test('the newest CUDA engine wins on Linux, then Vulkan, then the processor', () => {
  const names = ['llama.cpp-linux-x86_64-avx2-2.66.0', 'llama.cpp-linux-x86_64-nvidia-cuda12-avx2-2.69.0', 'llama.cpp-linux-x86_64-nvidia-cuda12-avx2-2.73.0', 'llama.cpp-linux-x86_64-vulkan-avx2-2.66.0', 'vendor'];
  assert.equal(pickBackend(names, 'linux'), 'llama.cpp-linux-x86_64-nvidia-cuda12-avx2-2.73.0');
  assert.equal(pickBackend(names.filter((n) => !/cuda/.test(n)), 'linux'), 'llama.cpp-linux-x86_64-vulkan-avx2-2.66.0');
  assert.equal(pickBackend(['llama.cpp-linux-x86_64-nvidia-cuda12-avx2-2.9.0', 'llama.cpp-linux-x86_64-nvidia-cuda12-avx2-2.10.0'], 'linux'), 'llama.cpp-linux-x86_64-nvidia-cuda12-avx2-2.10.0');
  assert.equal(pickBackend(['vendor'], 'linux'), null);
});

test('model files: the first part only, never the picture reader or an embedding model', () => {
  const root = join(process.env.HOME, 'models');
  const a = join(root, 'org', 'Big-35B-GGUF'), b = join(root, 'org', 'Small-GGUF');
  mkdirSync(a, { recursive: true }); mkdirSync(b, { recursive: true });
  writeFileSync(join(a, 'Big-35B-Q4_K_M.gguf'), 'x'.repeat(300));
  writeFileSync(join(a, 'mmproj-Big-BF16.gguf'), 'x');
  writeFileSync(join(b, 'Small-3B-Q4_0-00001-of-00002.gguf'), 'x'.repeat(100));
  writeFileSync(join(b, 'Small-3B-Q4_0-00002-of-00002.gguf'), 'x'.repeat(100));
  writeFileSync(join(b, 'nomic-embed-text.gguf'), 'x'.repeat(50));
  const m = modelsIn(root);
  assert.deepEqual(m.map((x) => x.file), ['Big-35B-Q4_K_M.gguf', 'Small-3B-Q4_0-00001-of-00002.gguf']);
  assert.equal(m[0].vision, join(a, 'mmproj-Big-BF16.gguf'));
  assert.equal(m[1].vision, null);
});

test('model names read like names', () => {
  assert.equal(modelLabel('Qwen3.6-35B-A3B-uncensored-heretic-Q4_K_M.gguf'), 'Qwen3.6 35B A3B uncensored heretic');
  assert.equal(modelLabel('gemma-4-12B-it-QAT-Q4_0.gguf'), 'gemma 4 12B it');
});

test('the measured settings: fit to the card, big batches, one conversation, localhost with a key', () => {
  const a = engineArgs({ model: '/m.gguf', mmproj: '/p.gguf', ctx: 32768, port: 5000, key: 'k', threads: 12 });
  const arg = (f) => a[a.indexOf(f) + 1];
  assert.equal(arg('--host'), '127.0.0.1');
  assert.equal(arg('--api-key'), 'k');
  assert.equal(arg('--fit'), 'on');
  assert.equal(arg('--ctx-size'), '32768');
  assert.equal(arg('--ubatch-size'), '4096');
  assert.equal(arg('--parallel'), '1');
  assert.equal(arg('--mmproj'), '/p.gguf');
  assert.ok(!engineArgs({ model: '/m.gguf', ctx: 32768, port: 1, key: 'k', threads: 4 }).includes('--mmproj'));
  assert.equal(threadsFor(24), 12);
  assert.equal(threadsFor(4), 4);
});

test('a failed start says what happened and what to do', () => {
  const full = whyFailed('ggml_backend_cuda_buffer_type_alloc_buffer: allocating 7078.65 MiB on device 0: cudaMalloc failed: out of memory', { model: 'Qwen', others: [{ name: 'ComfyUI', mb: 6144 }] });
  assert.match(full, /ran out of room loading Qwen/);
  assert.match(full, /ComfyUI \(6\.0 GB\)/);
  assert.match(whyFailed('error while loading shared libraries: libcudart.so.12'), /missing a library/);
  assert.match(whyFailed('something else'), /did not start/);
});

test('no engine or model here: not usable, and settings refuse what is not offered', () => {
  assert.equal(usable(), false);
  assert.equal(config().ctx, 32768);
  assert.throws(() => saveConfig({ ctx: 1000 }), /memory sizes/);
  assert.throws(() => saveConfig({ model: '/nope.gguf' }), /not in the models folder/);
  assert.equal(saveConfig({ idleMin: 500 }).idleMin, 60);
});

test('Local AI (Switchboard) sessions: listed, and not startable without a model', async () => {
  const { AGENTS, startOptions, localChatCommand } = await import('../lib/terminals.js');
  assert.equal(AGENTS.engine.local, 'engine');
  assert.throws(() => startOptions('engine', '', ''), /no model on this computer/);
  const cmd = localChatCommand('engine', 'Qwen 35B', '/tmp/x.jsonl');
  assert.match(cmd, /--engine/);
  assert.match(cmd, /127\.0\.0\.1:\d+\/api\/ai/);
  assert.ok(!/--start/.test(cmd));
});
