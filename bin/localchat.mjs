#!/usr/bin/env node
// A chat with a model on this computer, run as a Switchboard session.
//
//   node bin/localchat.mjs --server http://127.0.0.1:11434 --model llama3.2 --name Ollama --log <file>
//
// It talks to the model through the local server's OpenAI-style chat API
// (Ollama on 11434, LM Studio on 1234; both offer /v1/chat/completions), prints
// the reply as it comes, and writes each turn to --log in the same shape as
// Claude Code's transcript, so Switchboard's Chat view reads it the same way
// (lib/chatview.js). Only 127.0.0.1 is ever asked; nothing leaves the computer.
//
// Keys: Enter sends. Shift+Enter (Switchboard sends Ctrl+J) or Ctrl+J is a new
// line. Ctrl+C or Esc stops a reply; Ctrl+C on an empty line, or Ctrl+D, ends.
// A message pasted by Switchboard's message bar arrives as a bracketed paste.
import { appendFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

const arg = (k) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : null; };
const SERVER = arg('server') || 'http://127.0.0.1:11434', MODEL = arg('model'), NAME = arg('name') || 'the local server', LOG = arg('log'), START = arg('start');
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(SERVER) || !MODEL) { console.error('Usage: localchat.mjs --server http://127.0.0.1:<port> --model <name> [--log file]'); process.exit(2); }

const out = (s) => process.stdout.write(s);
const DIM = '\x1b[2m', BOLD = '\x1b[1m', RESET = '\x1b[0m', GREY = '\x1b[90m';
const history = [];   // { role, content }

// ---- the log, in Claude Code's transcript shape
function log(type, text) {
  if (!LOG) return;
  const message = type === 'user' ? { role: 'user', content: text } : { role: 'assistant', model: MODEL, content: [{ type: 'text', text }] };
  try { mkdirSync(dirname(LOG), { recursive: true }); appendFileSync(LOG, JSON.stringify({ type, uuid: randomUUID(), timestamp: new Date().toISOString(), message }) + '\n'); } catch {}
}
// Resumed: the conversation so far, from the log.
if (LOG && existsSync(LOG)) {
  for (const line of readFileSync(LOG, 'utf8').split('\n')) {
    try {
      const r = JSON.parse(line);
      const c = r.message?.content;
      const text = typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => x.text || '').join('') : '';
      if (text && (r.type === 'user' || r.type === 'assistant')) history.push({ role: r.type, content: text });
    } catch {}
  }
}

// ---- the server: answering, or started once (ollama serve / lms server start)
async function answering() {
  try { const r = await fetch(SERVER + '/v1/models', { signal: AbortSignal.timeout(2500) }); return r.ok; } catch { return false; }
}
async function ready() {
  if (await answering()) return true;
  if (START) {
    out(`${GREY}Starting ${NAME}…${RESET}\r\n`);
    const [cmd, ...args] = JSON.parse(START);
    try { spawn(cmd, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref(); } catch {}
    for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 500)); if (await answering()) return true; }
  }
  out(`${BOLD}${NAME} is not answering at ${SERVER}.${RESET} Start it (Settings, Connections, Local AI models in Switchboard), then send your message again.\r\n`);
  return false;
}

// ---- one reply, streamed
let abort = null;
async function reply() {
  if (!(await ready())) return;
  abort = new AbortController();
  let text = '', thinking = false;
  out(`\r\n${BOLD}${MODEL}${RESET}\r\n`);
  try {
    const r = await fetch(SERVER + '/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: abort.signal,
      body: JSON.stringify({ model: MODEL, messages: history, stream: true })
    });
    if (!r.ok) {
      const why = await r.text().catch(() => '');
      throw new Error(r.status === 404 ? `${NAME} has no model called ${MODEL}. Pick another in New session.` : `${NAME} answered ${r.status}${why ? ': ' + why.slice(0, 200) : ''}`);
    }
    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        let j; try { j = JSON.parse(data); } catch { continue; }
        const d = j.choices?.[0]?.delta || {};
        const think = d.reasoning_content || d.reasoning || '';
        if (think) { if (!thinking) { out(DIM); thinking = true; } out(think.replace(/\n/g, '\r\n')); }
        if (d.content) { if (thinking) { out(RESET + '\r\n'); thinking = false; } text += d.content; out(d.content.replace(/\n/g, '\r\n')); }
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') out(`${RESET}\r\n${BOLD}${e.message}${RESET}`);
    else out(`${RESET}${GREY} [stopped]${RESET}`);
  }
  abort = null;
  out(RESET + '\r\n');
  // A thinking model's <think> part is for the screen, not the record.
  const said = text.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim();
  if (said) { history.push({ role: 'assistant', content: said }); log('assistant', said); }
}

// ---- the line editor: raw keys, a multi-line buffer, redrawn on each change
let input = '', shown = 0, pasting = false, busy = false;
const PROMPT = '› ';
const rowsOf = (s) => { const w = process.stdout.columns || 80; return s.split('\n').reduce((n, l, i) => n + Math.max(1, Math.ceil(((i ? 2 : PROMPT.length) + l.length) / w)), 0); };
function draw() {
  if (shown > 1) out(`\x1b[${shown - 1}A`);
  out('\r\x1b[J' + PROMPT + input.replace(/\n/g, '\r\n  '));
  shown = rowsOf(input);
}
async function submit() {
  const text = input.trim();
  input = ''; shown = 0;
  out('\r\n');
  if (!text) { draw(); return; }
  history.push({ role: 'user', content: text }); log('user', text);
  busy = true;
  await reply();
  busy = false;
  out('\r\n'); draw();
}
function end() { out('\x1b[?2004l\r\n'); process.exit(0); }

function keys(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\x1b') {
      if (s.startsWith('[200~', i + 1)) { pasting = true; i += 5; continue; }
      if (s.startsWith('[201~', i + 1)) { pasting = false; i += 5; continue; }
      if (i === s.length - 1) { if (abort) abort.abort(); continue; }   // Esc on its own: stop the reply
      // Any other key sequence (arrows and the like): skipped.
      if (s[i + 1] === '[' || s[i + 1] === 'O') { i += 2; while (i < s.length && !/[A-Za-z~]/.test(s[i])) i++; } else i++;
      continue;
    }
    if (busy) { if (c === '\x03' && abort) abort.abort(); continue; }   // typing waits until the reply is done
    if (pasting) { input += c === '\r' ? '\n' : c; continue; }
    if (c === '\r') { submit(); return; }
    if (c === '\n') input += '\n';
    else if (c === '\x7f' || c === '\b') input = input.slice(0, -1);
    else if (c === '\x17') input = input.replace(/\s*\S+\s*$/, '');   // Ctrl+W, Ctrl+Backspace: a word
    else if (c === '\x15') input = '';                                // Ctrl+U: the line
    else if (c === '\x03') { if (!input) end(); input = ''; }
    else if (c === '\x04') { if (!input) end(); }
    else if (c >= ' ' || c === '\t') input += c;
  }
  if (!busy) draw();
}

if (!process.stdin.isTTY) { console.error('localchat needs a terminal.'); process.exit(2); }
process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
out('\x1b[?2004h');   // ask for pasted text to arrive bracketed, newlines and all
out(`${BOLD}Chat with ${MODEL}${RESET} ${GREY}on ${NAME}, on this computer. Enter sends · Shift+Enter a new line · Esc stops a reply · Ctrl+D ends.${RESET}\r\n`);
if (history.length) out(`${GREY}Carrying on: ${history.length} earlier messages.${RESET}\r\n`);
out('\r\n'); draw();
process.stdin.on('data', keys);
process.on('SIGHUP', end);
