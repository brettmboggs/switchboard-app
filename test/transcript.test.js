// The Chat view's transcript reader (lib/transcript.js): turning Claude Code's
// JSON lines into messages, and reading a file by byte offset without ever
// loading it whole. Plus the git status parser and the checks summary that
// feed the chips on a session's bar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, appendFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalize, toolSummary, projectDir, readTail, readSince, readBefore } from '../lib/transcript.js';
import { parseStatus } from '../lib/gitinfo.js';
import { checksState } from '../lib/github.js';

const ts = '2026-11-03T20:00:00.000Z';
const user = (content, extra = {}) => ({ type: 'user', uuid: 'u' + Math.random().toString(36).slice(2), timestamp: ts, message: { role: 'user', content }, ...extra });
const asst = (content, extra = {}) => ({ type: 'assistant', uuid: 'a' + Math.random().toString(36).slice(2), timestamp: ts, message: { role: 'assistant', content }, ...extra });

test('the project folder name: every character but letters and digits becomes "-"', () => {
  assert.equal(projectDir('/home/me/dev/switchboard'), '-home-me-dev-switchboard');
  assert.equal(projectDir('/home/me/dev/my-app/.claude/worktrees/x'), '-home-me-dev-my-app--claude-worktrees-x');
});

test('what Brett typed, without Claude Code\'s wrappers', () => {
  const [m] = normalize(user('fix the <pasted_content id="a1">login</pasted_content> page<system-reminder>ignore</system-reminder>'));
  assert.equal(m.k, 'user');
  assert.equal(m.t, 'fix the login page');
  assert.equal(m.at, Date.parse(ts));
  const [img] = normalize(user([{ type: 'text', text: '[Image #1] this' }, { type: 'image', source: { data: 'xx' } }]));
  assert.equal(img.images, 1);
  assert.equal(img.t, '[Image #1] this');
});

test('meta lines, sub-agents, thinking and bookkeeping are left out', () => {
  assert.deepEqual(normalize(user('caveat', { isMeta: true })), []);
  assert.deepEqual(normalize(asst([{ type: 'text', text: 'hi' }], { isSidechain: true })), []);
  assert.deepEqual(normalize(asst([{ type: 'thinking', thinking: 'secret' }])), []);
  assert.deepEqual(normalize({ type: 'file-history-snapshot' }), []);
  assert.deepEqual(normalize(user('<local-command-stdout>ok</local-command-stdout>')), []);
});

test('assistant text and tool calls, with a short summary for each tool', () => {
  const out = normalize(asst([
    { type: 'thinking', thinking: 'hmm' },
    { type: 'text', text: 'Reading it now.' },
    { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'npm test\n  --watch', description: 'Run tests' } },
    { type: 'tool_use', id: 'toolu_2', name: 'Read', input: { file_path: '/repo/server.js' } }
  ]));
  assert.deepEqual(out.map((m) => m.k), ['text', 'tool', 'tool']);
  assert.equal(out[1].id, 'toolu_1');
  assert.equal(out[1].sum, 'npm test --watch');
  assert.equal(out[2].sum, '/repo/server.js');
  assert.match(out[2].input, /server\.js/);
  assert.equal(toolSummary('Grep', { pattern: 'foo', path: 'lib' }), 'foo in lib');
  assert.equal(toolSummary('TodoWrite', { todos: [1, 2] }), '2 to-dos');
  assert.equal(toolSummary('mcp__x__y', { query: 'a b' }), 'a b');
});

test('tool results are tied to their call and cut short', () => {
  const [r] = normalize(user([{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'x'.repeat(5000), is_error: true }]));
  assert.equal(r.k, 'result');
  assert.equal(r.id, 'toolu_1');
  assert.equal(r.err, true);
  assert.ok(r.t.length < 1700);
  const [r2] = normalize(user([{ type: 'tool_result', tool_use_id: 't2', content: [{ type: 'text', text: 'a' }, { type: 'image' }] }]));
  assert.equal(r2.t, 'a\n[image]');
});

test('interruptions, slash commands, compaction and ! shell commands read as notes and tools', () => {
  assert.equal(normalize(user([{ type: 'text', text: '[Request interrupted by user for tool use]' }]))[0].t, 'Interrupted');
  assert.equal(normalize(user('<command-name>/model</command-name><command-args>opus</command-args>'))[0].t, '/model opus');
  assert.equal(normalize(user('summary', { isCompactSummary: true }))[0].k, 'note');
  const [sh] = normalize(user('<bash-input>ls -la</bash-input>'));
  assert.deepEqual([sh.k, sh.name, sh.sum], ['tool', 'Shell', 'ls -la']);
  const [out] = normalize(user('<bash-stdout>file\x1b[33m!</bash-stdout><bash-stderr></bash-stderr>'));
  assert.deepEqual([out.k, out.id, out.t], ['result', '@shell', 'file!']);
});

test('reading by byte offset: the tail, then only what is new, then earlier', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sb-transcript-'));
  const file = join(dir, 's.jsonl');
  const lines = [];
  for (let i = 0; i < 400; i++) {
    lines.push(JSON.stringify(user(`question ${i}`, { uuid: 'q' + i })));
    lines.push(JSON.stringify({ type: 'api-request-blob', pad: 'z'.repeat(3000) }));   // bookkeeping that is skipped
    lines.push(JSON.stringify(asst([{ type: 'text', text: `answer ${i}` }], { uuid: 'r' + i })));
  }
  writeFileSync(file, lines.join('\n') + '\n');
  const size = statSync(file).size;

  const tail = readTail(file, { bytes: 64 * 1024, want: 50 });
  assert.equal(tail.end, size);
  assert.ok(tail.start > 0 && tail.start < size);
  assert.ok(tail.messages.length >= 50);
  assert.equal(tail.messages.at(-1).t, 'answer 399');

  // Nothing new yet.
  assert.deepEqual(readSince(file, tail.end).messages, []);
  // A line being written (no newline yet) waits until it is complete.
  appendFileSync(file, JSON.stringify(user('half')).slice(0, 20));
  const partial = readSince(file, tail.end);
  assert.deepEqual(partial.messages, []);
  assert.equal(partial.end, tail.end);
  appendFileSync(file, '\n' + JSON.stringify(user('new one', { uuid: 'n1' })) + '\n');
  const next = readSince(file, partial.end);
  assert.deepEqual(next.messages.map((m) => m.t), ['new one']);
  // Gone backwards (the file was replaced): start over from the tail.
  assert.equal(readSince(file, size * 10), null);

  // Earlier, window by window, back to the start, with nothing lost or repeated.
  let start = tail.start, seen = [...tail.messages];
  while (start > 0) {
    const r = readBefore(file, start, { bytes: 64 * 1024, want: 100 });
    assert.ok(r.start < start);
    seen = r.messages.concat(seen);
    start = r.start;
  }
  const texts = seen.map((m) => m.t);
  assert.equal(texts[0], 'question 0');
  assert.equal(new Set(seen.map((m) => m.id)).size, seen.length);
  assert.equal(texts.filter((t) => /^answer/.test(t)).length, 400);
});

test('a line longer than the reader keeps is skipped, and the rest still reads', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sb-transcript-'));
  const file = join(dir, 'big.jsonl');
  writeFileSync(file, [
    JSON.stringify(user('before', { uuid: 'b' })),
    JSON.stringify(user([{ type: 'tool_result', tool_use_id: 'huge', content: 'y'.repeat(3 * 1024 * 1024) }])),
    JSON.stringify(user('after', { uuid: 'c' }))
  ].join('\n') + '\n');
  const all = readSince(file, 0, { max: 64 * 1024 * 1024 });
  assert.deepEqual(all.messages.map((m) => m.t), ['before', 'after']);
  const back = readBefore(file, statSync(file).size, { bytes: 16 * 1024, want: 10, windows: 6 });
  assert.ok(back.messages.some((m) => m.t === 'after'));
});

test('git status: uncommitted files and ahead / behind', () => {
  const v = parseStatus(['# branch.oid abc', '# branch.head feature/x', '# branch.upstream origin/feature/x', '# branch.ab +2 -1',
    '1 .M N... 100644 100644 100644 a b lib/a.js', '? notes.txt', '2 R. N... 100644 100644 100644 a b c new.js\told.js'].join('\n'));
  assert.deepEqual(v, { branch: 'feature/x', upstream: 'origin/feature/x', ahead: 2, behind: 1, changed: 3 });
  assert.equal(parseStatus('# branch.head main\n').upstream, null);
});

test('pull request checks come down to one state', () => {
  assert.equal(checksState([]), null);
  assert.equal(checksState([{ status: 'COMPLETED', conclusion: 'SUCCESS' }, { state: 'SUCCESS' }]), 'success');
  assert.equal(checksState([{ status: 'IN_PROGRESS', conclusion: '' }, { status: 'COMPLETED', conclusion: 'SUCCESS' }]), 'running');
  assert.equal(checksState([{ state: 'PENDING' }]), 'running');
  assert.equal(checksState([{ status: 'COMPLETED', conclusion: 'FAILURE' }, { status: 'QUEUED' }]), 'failure');
  assert.equal(checksState([{ status: 'COMPLETED', conclusion: 'SKIPPED' }]), 'success');
});
