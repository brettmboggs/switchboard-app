// Codex sessions in the Chat view (lib/codexlog.js): the right log for a
// session, and its lines as chat messages, tool calls with their results.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'sb-codex-'));
process.env.CODEX_HOME = home;
const { codexRecord, codexLogFor, logHead } = await import('../lib/codexlog.js');

const at = '2026-11-05T16:00:00.000Z';
const item = (payload) => ({ timestamp: at, type: 'response_item', payload });

test('messages: what the person typed and what Codex said; its own instructions left out', () => {
  assert.deepEqual(codexRecord(item({ type: 'message', role: 'user', id: 'm1', content: [{ type: 'input_text', text: 'Fix the login bug' }] })).map((m) => [m.k, m.t]), [['user', 'Fix the login bug']]);
  assert.deepEqual(codexRecord(item({ type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>\n<cwd>/x</cwd>' }] })), []);
  assert.deepEqual(codexRecord(item({ type: 'message', role: 'user', content: [{ type: 'input_text', text: '# AGENTS.md instructions for /x' }] })), []);
  assert.deepEqual(codexRecord(item({ type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'You are Codex' }] })), []);
  assert.deepEqual(codexRecord(item({ type: 'message', role: 'assistant', id: 'm2', content: [{ type: 'output_text', text: 'Done.' }] })).map((m) => [m.k, m.t]), [['text', 'Done.']]);
  assert.deepEqual(codexRecord(item({ type: 'reasoning', summary: [] })), []);
  assert.deepEqual(codexRecord({ type: 'event_msg', payload: { type: 'token_count' } }), []);
});

test('tool calls and their results, matched by call id', () => {
  const [sh] = codexRecord(item({ type: 'function_call', name: 'shell', call_id: 'c1', arguments: JSON.stringify({ command: ['bash', '-lc', 'npm test'] }) }));
  assert.deepEqual([sh.k, sh.id, sh.name, sh.sum], ['tool', 'c1', 'Shell', 'npm test']);
  const [res] = codexRecord(item({ type: 'function_call_output', call_id: 'c1', output: JSON.stringify({ output: '1 failing', metadata: { exit_code: 1 } }) }));
  assert.deepEqual([res.k, res.id, res.t, res.err], ['result', 'c1', '1 failing', true]);
  const [patch] = codexRecord(item({ type: 'custom_tool_call', name: 'apply_patch', call_id: 'c2', input: '*** Begin Patch\n*** Update File: lib/a.js\n@@\n-x\n+y\n*** End Patch' }));
  assert.deepEqual([patch.name, patch.sum], ['Edit', 'lib/a.js']);
  const [ok] = codexRecord(item({ type: 'custom_tool_call_output', call_id: 'c2', output: 'Success. Updated: lib/a.js' }));
  assert.equal(ok.err, false);
});

test('the log for a session: same folder, started just after it, each log to one session', () => {
  const dir = join(home, 'sessions', '2026', '11', '05'); mkdirSync(dir, { recursive: true });
  const meta = (cwd, ts) => JSON.stringify({ timestamp: ts, type: 'session_meta', payload: { id: 'x', cwd, base_instructions: { text: 'long' } } }) + '\n';
  const start = Date.parse('2026-11-05T16:00:00Z');
  writeFileSync(join(dir, 'rollout-a.jsonl'), meta('/work/other', '2026-11-05T16:00:02Z'));
  writeFileSync(join(dir, 'rollout-b.jsonl'), meta('/work/app', '2026-11-05T16:00:03Z'));
  writeFileSync(join(dir, 'rollout-c.jsonl'), meta('/work/app', '2026-11-05T16:05:00Z'));
  const now = start + 3600e3;
  assert.ok(codexLogFor({ id: 'sb-app', created_at: start, cwd: '/work/app' }, now).endsWith('rollout-b.jsonl'));
  assert.ok(codexLogFor({ id: 'sb-app-2', created_at: start + 299e3, cwd: '/work/app' }, now).endsWith('rollout-c.jsonl'));
  assert.equal(codexLogFor({ id: 'sb-none', created_at: start, cwd: '/work/none' }, now), null);
  assert.deepEqual(logHead('{"timestamp":"2026-11-05T16:00:00Z","payload":{"cwd":"C:\\\\code\\\\app"}}'), { cwd: 'C:\\code\\app', at: start });
});
