#!/usr/bin/env node
// A chat with a model on this computer, run as a Switchboard session.
//
//   node bin/localchat.mjs --server http://127.0.0.1:11434 --model llama3.2 --name Ollama --log <file>
//   node bin/localchat.mjs --server http://127.0.0.1:4747/api/ai --engine --model "Qwen…" --name Switchboard --log <file>
//
// --engine: Switchboard's own model (lib/engine.js, through its /api/ai/v1 routes),
// which loads on the first message. A message starting with a "/think" line lets it
// think first (Sessions' "Think first" switch); pictures whose paths are in the
// message (the message bar's paperclip) are sent to it as pictures.
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
const SERVER = arg('server') || 'http://127.0.0.1:11434', MODEL = arg('model'), NAME = arg('name') || 'the local server', LOG = arg('log'), START = arg('start'), ENGINE = process.argv.includes('--engine');
const HEADERS = { 'Content-Type': 'application/json', 'X-Switchboard': '1' };   // Switchboard takes a POST only with this
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+(\/api\/ai)?$/.test(SERVER) || !MODEL) { console.error('Usage: localchat.mjs --server http://127.0.0.1:<port> --model <name> [--log file]'); process.exit(2); }

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
let loadedNow = true;
async function answering() {
  try { const r = await fetch(SERVER + '/v1/models', { signal: AbortSignal.timeout(2500) }); if (ENGINE && r.ok) loadedNow = (await r.json()).loaded !== false; return r.ok; } catch { return false; }
}
async function ready() {
  if (await answering()) return true;
  if (ENGINE) {   // Switchboard restarting: wait for it
    for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 1000)); if (await answering()) return true; }
  }
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
// Pictures named in a message (one path on its own line, as the paperclip adds them), for a model that sees.
const PIC = /^(\/[^\n]+\.(png|jpe?g|webp|gif))$/gim;
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
function withPictures(msgs) {
  let left = 2;   // pictures go only with the last two messages that have them
  return msgs.slice().reverse().map((m) => {
    if (m.role !== 'user' || !ENGINE) return m;
    const paths = [...m.content.matchAll(PIC)].map((x) => x[1]).filter((f) => existsSync(f));
    if (!paths.length || left <= 0) return m;
    left--;
    const text = m.content.replace(PIC, '').trim() || 'What is in this picture?';
    return { role: 'user', content: [{ type: 'text', text }, ...paths.map((f) => ({ type: 'image_url', image_url: { url: `data:${MIME[f.split('.').pop().toLowerCase()]};base64,${readFileSync(f).toString('base64')}` } }))] };
  }).reverse();
}
async function reply(think = false) {
  if (!(await ready())) return;
  abort = new AbortController();
  let text = '', thinking = false;
  out(`\r\n${BOLD}${MODEL}${RESET}\r\n`);
  if (ENGINE && !loadedNow) out(`${GREY}Loading the model onto the graphics card (about 10 seconds)…${RESET}\r\n`);
  try {
    const r = await fetch(SERVER + '/v1/chat/completions', {
      method: 'POST', headers: HEADERS, signal: abort.signal,
      body: JSON.stringify({ model: MODEL, messages: withPictures(history), stream: true, ...(ENGINE ? { chat_template_kwargs: { enable_thinking: think }, ...(think ? { temperature: 0.6, top_p: 0.95, top_k: 20 } : { temperature: 0.7, top_p: 0.8, top_k: 20 }) } : {}) })
    });
    if (!r.ok) {
      const why = await r.text().catch(() => '');
      let said = ''; try { said = JSON.parse(why).error || ''; } catch {}
      throw new Error(said || (r.status === 404 ? `${NAME} has no model called ${MODEL}. Pick another in New session.` : `${NAME} answered ${r.status}${why ? ': ' + why.slice(0, 200) : ''}`));
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
  let text = input.trim();
  input = ''; shown = 0;
  out('\r\n');
  const think = /^\/think\s*(\n|$)/.test(text);
  if (think) text = text.replace(/^\/think\s*\n?/, '').trim();
  if (!text) { draw(); return; }
  history.push({ role: 'user', content: text }); log('user', text);
  if (history.filter((m) => m.role === 'user').length === 1) nameIt();
  busy = true;
  await reply(think);
  busy = false;
  out('\r\n'); draw();
}
// The session's name in Sessions: the first thing said (the terminal's title, which Switchboard reads).
const nameIt = () => { const first = history.find((m) => m.role === 'user')?.content.replace(/^\/[^\n]+\.(png|jpe?g|webp|gif)$/gim, '').replace(/\s+/g, ' ').trim(); out(`\x1b]0;${(first || 'New chat').slice(0, 60).replace(/[\x00-\x1f\x7f]/g, '')}\x07`); };
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
nameIt();
out('\r\n'); draw();
process.stdin.on('data', keys);
process.on('SIGHUP', end);
