// Agent transcripts, read for the Chat view on Sessions.
//
// Claude Code writes each session as JSON lines in
// ~/.claude/projects/<folder, every character but letters and digits made "-">/<session id>.jsonl.
// Those files reach tens of megabytes, so nothing here ever loads one whole:
// it reads byte ranges (the tail to start with, then only what was added, or
// an earlier window for "Show earlier"), one line at a time, and turns each
// line into the few things the page shows: what Brett said, what the agent
// said, and its tool calls with a short summary and a truncated result.
// Thinking, bookkeeping lines and sub-agent traffic are left out.
//
// Codex keeps rollouts in ~/.codex/sessions too, but its format was not
// available to check against, so the Chat view reads Claude Code only.
import { openSync, readSync, closeSync, fstatSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CHUNK = 256 * 1024;        // read size
const LINE_MAX = 2 * 1024 * 1024; // a single line longer than this (a huge tool result) is skipped unread
const TEXT_MAX = 24000;           // the longest assistant or user text kept
const RESULT_MAX = 1600;          // tool results are cut to this
const INPUT_MAX = 2000;           // tool inputs, as JSON, cut to this

export const projectDir = (cwd) => String(cwd || '').replace(/[^A-Za-z0-9]/g, '-');

// The transcript of a Claude session: the path its hooks reported when that is
// the same session, otherwise where Claude Code keeps it for that folder.
export function claudeTranscript(cwd, sessionId, reported) {
  if (!sessionId || !/^[\w-]+$/.test(sessionId)) return null;
  if (reported && reported.endsWith(sessionId + '.jsonl') && existsSync(reported)) return reported;
  const p = join(homedir(), '.claude', 'projects', projectDir(cwd), sessionId + '.jsonl');
  return existsSync(p) ? p : null;
}

const cut = (s, n) => (s.length > n ? s.slice(0, n) + '\n…' : s);
const oneLine = (s, n = 140) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

// A short line for each kind of tool call: the file, the command, the pattern.
export function toolSummary(name, input = {}) {
  const i = input && typeof input === 'object' ? input : {};
  switch (name) {
    case 'Bash': return oneLine(i.command, 160);
    case 'Read': case 'Write': case 'Edit': case 'MultiEdit': return oneLine(i.file_path);
    case 'NotebookEdit': return oneLine(i.notebook_path || i.file_path);
    case 'Grep': return oneLine(i.pattern + (i.path ? '  in ' + i.path : ''));
    case 'Glob': return oneLine(i.pattern + (i.path ? '  in ' + i.path : ''));
    case 'WebFetch': return oneLine(i.url);
    case 'WebSearch': return oneLine(i.query);
    case 'Task': case 'Agent': return oneLine(i.description || i.prompt);
    case 'TodoWrite': return Array.isArray(i.todos) ? `${i.todos.length} to-dos` : '';
    case 'AskUserQuestion': return oneLine(i.questions?.[0]?.question);
    default: {
      const first = Object.values(i).find((v) => typeof v === 'string' && v.trim());
      return first ? oneLine(first) : '';
    }
  }
}

// What went into a tool call, readable: the command itself, an edit as old and
// new text, anything else as JSON.
export function toolInput(name, input = {}) {
  const i = input && typeof input === 'object' ? input : {};
  if (name === 'Bash' && typeof i.command === 'string') return i.command + (i.description ? `\n\n# ${i.description}` : '');
  if (name === 'Edit' && typeof i.old_string === 'string') return `${i.file_path || ''}\n\n− ${i.old_string.split('\n').join('\n− ')}\n\n+ ${String(i.new_string ?? '').split('\n').join('\n+ ')}`;
  if (name === 'Write' && typeof i.content === 'string') return `${i.file_path || ''}\n\n${i.content}`;
  try { return JSON.stringify(i, null, 2); } catch { return ''; }
}

function resultText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((c) => (c?.type === 'text' ? c.text : c?.type === 'image' ? '[image]' : '')).filter(Boolean).join('\n');
}

// What Brett typed, without the wrappers Claude Code adds around it.
function cleanUser(text) {
  return String(text)
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<\/?pasted_content[^>]*>/g, '')
    .trim();
}

// One transcript line (already parsed) -> the messages it holds, in order.
//   { k: 'user', id, at, t, images }        Brett
//   { k: 'text', id, at, t }                the agent
//   { k: 'tool', id, at, name, sum, input } a tool call (id is the tool use id)
//   { k: 'result', id, t, err }             a tool call's result
//   { k: 'note', id, at, t }                interrupted, compacted, a slash command
export function normalize(rec) {
  if (!rec || typeof rec !== 'object' || rec.isSidechain) return [];
  const at = Date.parse(rec.timestamp) || null;
  const uid = String(rec.uuid || '');
  const content = rec.message?.content;
  if (rec.type === 'assistant') {
    if (!Array.isArray(content)) return [];
    const out = [];
    content.forEach((c, n) => {
      if (c?.type === 'text' && c.text?.trim()) out.push({ k: 'text', id: `${uid}:${n}`, at, t: cut(c.text.trim(), TEXT_MAX) });
      else if (c?.type === 'tool_use') {
        const input = cut(toolInput(c.name, c.input), INPUT_MAX);
        out.push({ k: 'tool', id: String(c.id || `${uid}:${n}`), at, name: String(c.name || 'Tool'), sum: toolSummary(c.name, c.input), input });
      }
    });
    return out;
  }
  if (rec.type !== 'user' || rec.isMeta) return [];
  if (rec.isCompactSummary) return [{ k: 'note', id: uid, at, t: 'Earlier conversation compacted' }];
  if (typeof content === 'string') return fromUserText(content, uid, at, 0);
  if (!Array.isArray(content)) return [];
  const out = [];
  const texts = [];
  let images = 0;
  for (const c of content) {
    if (c?.type === 'tool_result') out.push({ k: 'result', id: String(c.tool_use_id || ''), t: cut(resultText(c.content).trim(), RESULT_MAX), err: !!c.is_error });
    else if (c?.type === 'text') texts.push(c.text || '');
    else if (c?.type === 'image') images++;
  }
  if (texts.length || images) out.push(...fromUserText(texts.join('\n'), uid, at, images));
  return out;
}

function fromUserText(raw, id, at, images) {
  const text = String(raw || '');
  if (/^\s*\[Request interrupted by user/.test(text)) return [{ k: 'note', id, at, t: 'Interrupted' }];
  const cmd = text.match(/<command-name>([\s\S]*?)<\/command-name>/);
  if (cmd) {
    const args = text.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]?.trim();
    return [{ k: 'note', id, at, t: oneLine(cmd[1].trim() + (args ? ' ' + args : ''), 200) }];
  }
  // Shell commands typed with "!" in Claude Code, and what they printed.
  const bash = text.match(/^<bash-input>([\s\S]*?)<\/bash-input>/);
  if (bash) return [{ k: 'tool', id: `${id}:sh`, at, name: 'Shell', sum: oneLine(bash[1], 160), input: cut(bash[1].trim(), INPUT_MAX) }];
  if (/^<bash-stdout>/.test(text)) {
    const out = (text.match(/<bash-stdout>([\s\S]*?)<\/bash-stdout>/)?.[1] || '') + (text.match(/<bash-stderr>([\s\S]*?)<\/bash-stderr>/)?.[1] || '');
    return [{ k: 'result', id: '@shell', t: cut(out.replace(/\x1b\[[0-9;]*m/g, '').trim(), RESULT_MAX), err: false }];
  }
  if (/^\s*<(local-command-stdout|local-command-caveat|command-message|task-notification|user-prompt-submit-hook)/.test(text)) return [];
  const t = cleanUser(text);
  if (!t && !images) return [];
  return [{ k: 'user', id, at, t: cut(t, TEXT_MAX), images }];
}

// Read the complete lines in [start, end) of an open file, one at a time.
// Returns the offset just after the last complete line (where to carry on).
// A line longer than LINE_MAX is skipped without being kept in memory.
function scan(fd, start, end, onLine) {
  const buf = Buffer.allocUnsafe(CHUNK);
  let pos = start, done = start, parts = [], partLen = 0, skipping = false;
  while (pos < end) {
    const n = readSync(fd, buf, 0, Math.min(CHUNK, end - pos), pos);
    if (n <= 0) break;
    let from = 0;
    for (let i = 0; i < n; i++) {
      if (buf[i] !== 10) continue;
      if (!skipping) {
        const piece = buf.subarray(from, i);
        const line = partLen ? Buffer.concat([...parts, piece]).toString('utf8') : piece.toString('utf8');
        if (line) onLine(line);
      }
      parts = []; partLen = 0; skipping = false;
      from = i + 1;
      done = pos + i + 1;
    }
    if (from < n && !skipping) {
      partLen += n - from;
      if (partLen > LINE_MAX) { skipping = true; parts = []; partLen = 0; }
      else parts.push(Buffer.from(buf.subarray(from, n)));
    }
    pos += n;
  }
  return done;
}

// The first byte after the next newline at or after `at` (so a window that
// starts mid-line skips the broken line).
function nextLine(fd, at, end) {
  const buf = Buffer.allocUnsafe(64 * 1024);
  let pos = at;
  while (pos < end) {
    const n = readSync(fd, buf, 0, Math.min(buf.length, end - pos), pos);
    if (n <= 0) break;
    const i = buf.subarray(0, n).indexOf(10);
    if (i >= 0) return pos + i + 1;
    pos += n;
  }
  return end;
}

// Where the line that ends just before `end` starts.
function lineStart(fd, end) {
  const buf = Buffer.allocUnsafe(64 * 1024);
  let pos = end - 1;   // the newline that ends that line
  while (pos > 0) {
    const from = Math.max(0, pos - buf.length);
    const n = readSync(fd, buf, 0, pos - from, from);
    const i = buf.subarray(0, n).lastIndexOf(10);
    if (i >= 0) return from + i + 1;
    pos = from;
  }
  return 0;
}

function collect(fd, start, end, out) {
  return scan(fd, start, end, (line) => {
    if (line.charCodeAt(0) !== 123) return;   // "{"
    let rec; try { rec = JSON.parse(line); } catch { return; }
    if (rec.type !== 'user' && rec.type !== 'assistant') return;
    for (const m of normalize(rec)) out.push(m);
  });
}

const withFile = (path, fn) => {
  const fd = openSync(path, 'r');
  try { return fn(fd, fstatSync(fd).size); } finally { closeSync(fd); }
};

// The newest part of a transcript: about the last `bytes`, as messages.
// { start, end, messages }: start is where an earlier read would end.
export function readTail(path, { bytes = 768 * 1024, want = 150 } = {}) {
  const tail = withFile(path, (fd, size) => {
    const start = size > bytes ? nextLine(fd, size - bytes, size) : 0;
    const messages = [];
    const end = collect(fd, start, size, messages);
    return { start, end, messages };
  });
  if (tail.messages.length < want && tail.start > 0) {
    const more = readBefore(path, tail.start, { bytes, want: want - tail.messages.length, windows: 3 });
    tail.start = more.start;
    tail.messages = more.messages.concat(tail.messages);
  }
  return tail;
}

// What was added since `from`. Too far behind (or the file shrank) reads the tail afresh.
export function readSince(path, from, { max = 4 * 1024 * 1024 } = {}) {
  return withFile(path, (fd, size) => {
    if (!(from >= 0) || from > size || size - from > max) return null;
    const messages = [];
    const end = collect(fd, from, size, messages);
    return { end, messages };
  });
}

// Messages before `before`, reading back a window at a time until there are
// enough (or the start of the file).
export function readBefore(path, before, { bytes = 768 * 1024, want = 150, windows = 4 } = {}) {
  return withFile(path, (fd, size) => {
    let end = Math.min(before, size), messages = [];
    for (let w = 0; w < windows && end > 0 && messages.length < want; w++) {
      let start = end > bytes ? nextLine(fd, end - bytes, end) : 0;
      if (start >= end) start = lineStart(fd, end);   // one line longer than the window
      const got = [];
      collect(fd, start, end, got);
      messages = got.concat(messages);
      end = start;
    }
    return { start: end, messages };
  });
}
