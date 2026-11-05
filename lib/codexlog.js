// Codex sessions in the Chat view. Codex writes each session to
// ~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl (or under $CODEX_HOME):
// a session_meta line (with the folder it runs in), then response_item lines
// for messages, tool calls and their output. This finds the file that belongs
// to a Switchboard session and turns its lines into the Chat view's messages,
// the same shapes lib/transcript.js makes from Claude Code's transcript.
// Read only; nothing is written to Codex's files.
import { readdirSync, openSync, readSync, closeSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const ROOT = () => join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions');
const oneLine = (s, n = 140) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const cut = (s, n) => (s.length > n ? s.slice(0, n) + '\n…' : s);

// The folder and start time from a log's first line, read from its first
// 64 KB (that line also carries Codex's long instructions, so it is not parsed whole).
export function logHead(text) {
  const cwd = text.match(/"cwd":"((?:[^"\\]|\\.)*)"/);
  const ts = text.match(/"timestamp":"([^"]+)"/);
  if (!cwd || !ts) return null;
  let folder; try { folder = JSON.parse(`"${cwd[1]}"`); } catch { return null; }
  const at = Date.parse(ts[1]);
  return Number.isFinite(at) ? { cwd: folder, at } : null;
}
function head(file) {
  const buf = Buffer.alloc(64 * 1024);
  let fd;
  try { fd = openSync(file, 'r'); const n = readSync(fd, buf, 0, buf.length, 0); return logHead(buf.subarray(0, n).toString('utf8')); }
  catch { return null; } finally { if (fd !== undefined) closeSync(fd); }
}

// The day folders a session could have written to: from the day it started to today.
function dayDirs(from, now = Date.now()) {
  const out = [];
  for (let d = new Date(from - 86400e3); d.getTime() <= now + 86400e3; d.setDate(d.getDate() + 1)) {
    out.push(join(ROOT(), String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')));
  }
  return out;
}

// Session -> its log. Each log goes to one session: the first one, in the same
// folder, that started up to 10 seconds before the log did.
const found = new Map();   // `${id}-${created}` -> path
export function codexLogFor(t, now = Date.now()) {
  const key = `${t.id}-${t.created_at}`;
  if (found.has(key)) return found.get(key);
  const taken = new Set(found.values());
  const logs = [];
  for (const dir of dayDirs(t.created_at, now)) {
    let names; try { names = readdirSync(dir); } catch { continue; }
    for (const n of names) {
      if (!/^rollout-.*\.jsonl$/.test(n)) continue;
      const file = join(dir, n);
      if (taken.has(file)) continue;
      try { if (statSync(file).mtimeMs < t.created_at - 10e3) continue; } catch { continue; }
      const h = head(file);
      if (h && h.cwd === t.cwd && h.at >= t.created_at - 10e3) logs.push({ file, at: h.at });
    }
  }
  logs.sort((a, b) => a.at - b.at);
  if (!logs.length) return null;
  found.set(key, logs[0].file);
  return logs[0].file;
}

// What Codex puts in the conversation for itself, not typed by the person.
const NOT_TYPED = /^(<(environment_context|user_instructions|permissions|skills_instructions|multi_agent|turn_aborted|subagent|INSTRUCTIONS)\b|# AGENTS\.md instructions)/;
const textOf = (content) => (Array.isArray(content) ? content : []).filter((c) => /text$/.test(c?.type || '')).map((c) => c.text || '').join('\n').trim();
const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
const command = (c) => (Array.isArray(c) ? (c[0] === 'bash' && c[1] === '-lc' ? c.slice(2).join(' ') : c.join(' ')) : String(c || ''));

// A tool call, named the way the Chat view words it (Shell runs, Edit edits).
function tool(p) {
  if (p.type === 'local_shell_call') { const c = command(p.action?.command); return { name: 'Shell', sum: oneLine(c, 160), input: c }; }
  if (p.type === 'web_search_call') { const q = p.action?.query || ''; return { name: 'WebSearch', sum: oneLine(q), input: q }; }
  if (p.type === 'custom_tool_call') {
    const input = String(p.input || '');
    if (p.name === 'apply_patch') { const files = [...input.matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm)].map((m) => m[1]); return { name: 'Edit', sum: oneLine(files.join(', ')), input }; }
    return { name: String(p.name || 'Tool'), sum: oneLine(input), input };
  }
  const args = parse(p.arguments) || {};
  if (/^(shell|exec_command|container\.exec)$/.test(p.name)) { const c = command(args.command ?? args.cmd); return { name: 'Shell', sum: oneLine(c, 160), input: c }; }
  return { name: String(p.name || 'Tool'), sum: oneLine(Object.values(args).find((v) => typeof v === 'string') || ''), input: JSON.stringify(args, null, 2) };
}
function result(p) {
  let out = p.output, err = false;
  if (typeof out === 'string') { const j = parse(out); if (j && typeof j === 'object' && 'output' in j) { err = Number(j.metadata?.exit_code) > 0; out = j.output; } }
  else if (out && typeof out === 'object') { err = out.success === false; out = out.content ?? JSON.stringify(out); }
  return { t: cut(String(out ?? '').trim(), 1600), err };
}

// One line of a Codex log into Chat view messages (none for most lines).
export function codexRecord(rec) {
  if (rec?.type !== 'response_item' || !rec.payload) return [];
  const p = rec.payload, at = Date.parse(rec.timestamp) || null;
  const id = String(p.call_id || p.id || `${rec.timestamp}:${p.type}`);
  if (p.type === 'message') {
    const t = textOf(p.content);
    if (p.role === 'assistant' && t) return [{ k: 'text', id, at, t: cut(t, 24000) }];
    if (p.role === 'user' && t && !NOT_TYPED.test(t)) {
      const images = (p.content || []).filter((c) => c?.type === 'input_image').length;
      return [{ k: 'user', id, at, t: cut(t, 24000), images }];
    }
    return [];
  }
  if (/^(function_call|custom_tool_call|local_shell_call|web_search_call)$/.test(p.type)) { const x = tool(p); return [{ k: 'tool', id, at, ...x, input: cut(x.input, 2000) }]; }
  if (/^(function_call_output|custom_tool_call_output)$/.test(p.type)) return [{ k: 'result', id: String(p.call_id || ''), ...result(p) }];
  return [];
}
