// What the Chat view reads for one session on this computer: the agent's own
// transcript (by byte offset), and the question it is asking in its screen
// (read, and answered with the keys it expects). Used by the page's own
// routes (lib/routes/sessionview.js) and, for a session viewed from another
// computer, by the relay (lib/relay.js), so both get the same answers.
import { db } from './db.js';
import { existsSync } from 'node:fs';
import { claudeTranscript, readTail, readSince, readBefore } from './transcript.js';
import { AGENTS, chatLog } from './terminals.js';
import { codexLogFor, codexRecord } from './codexlog.js';
import { screenText, pressKeys, typeInto } from './terminals.js';
import { parseMenu, keysFor } from './agentmenu.js';

export const termRow = (id) => db.prepare('SELECT id, cwd, agent, claude_id, created_at FROM terms WHERE id = ? AND ended_at IS NULL').get(id);

// The transcript file of a session, { file, id }, or why there is none. id
// names the conversation, so the page knows when it is a different one.
//   Claude Code (or another command that turned out to be Claude): its own transcript.
//   A local model: the log bin/localchat.mjs keeps, in Claude's shape.
export function transcriptOf(t) {
  const agent = t.agent || 'claude';
  if (AGENTS[agent]?.local) {
    const file = chatLog(t.id, t.created_at);
    return existsSync(file) ? { file, id: `${t.id}-${t.created_at}` } : { why: 'nofile' };
  }
  // Codex: its own session log, read with its own shape (lib/codexlog.js).
  if (agent === 'codex') {
    const file = codexLogFor(t);
    return file ? { file, id: 'codex:' + file.split(/[\\/]/).pop(), norm: codexRecord } : { why: 'starting' };
  }
  if (agent !== 'claude' && !t.claude_id) return { why: 'agent' };
  if (!t.claude_id) return { why: 'starting' };
  const reported = db.prepare('SELECT transcript FROM sessions WHERE id = ?').get(t.claude_id)?.transcript;
  const file = claudeTranscript(t.cwd, t.claude_id, reported);
  return file ? { file, id: t.claude_id } : { why: 'nofile' };
}

// q: { file, from } for what is new, { file, before } for earlier, {} for the newest part.
// small: for the relay, which carries at most about 1 MB a message: a smaller
// tail, and long texts cut until the reply fits (offsets stay right, since
// only the text of a message is cut, never a message left out).
export function readChat(t, q = {}, { small = false } = {}) {
  const tr = transcriptOf(t);
  if (!tr.file) return { file: null, why: tr.why, messages: [] };
  const file = tr.file, same = q.file === tr.id;
  const norm = tr.norm;   // undefined: Claude Code's own shape
  const tail = small ? { bytes: 256 * 1024, want: 60, norm } : { norm };
  let out;
  try {
    if (same && q.before != null) {
      const r = readBefore(file, Number(q.before), small ? { ...tail, windows: 3 } : { norm });
      out = { file: tr.id, start: r.start, messages: r.messages, earlier: true };
    } else {
      const r = same && q.from != null ? readSince(file, Number(q.from), small ? { max: 512 * 1024, norm } : { norm }) : null;
      if (r) out = { file: tr.id, end: r.end, messages: r.messages };
      else { const x = readTail(file, tail); out = { file: tr.id, start: x.start, end: x.end, messages: x.messages, reset: true }; }
    }
  } catch (err) {
    return { file: null, why: 'unreadable', error: err.message, messages: [] };
  }
  if (small) fit(out, 560 * 1024);
  return { ...out, path: file };
}

export function fit(out, max) {
  for (const cut of [8000, 2000, 600, 200]) {
    if (JSON.stringify(out).length <= max) return out;
    for (const m of out.messages) for (const k of ['t', 'input']) {
      if (typeof m[k] === 'string' && m[k].length > cut) m[k] = m[k].slice(0, cut) + ' …';
    }
  }
  return out;
}

export const readMenu = async (t) => parseMenu(await screenText(t.id));

// Answer the question on screen with choice `index`, if it is still the one
// with signature `sig`. { ok, menu } or { status, error, menu }.
// `text` answers a "Type something" choice (AskUserQuestion): the cursor goes
// to it, the words are typed in place, and Enter sends them.
export const TYPE_OWN = /^Type something\b/i;
export async function answerMenu(t, sig, index, text) {
  const menu = await readMenu(t);
  if (!menu || menu.sig !== sig) return { status: 409, error: 'That question has changed while you were answering. Look at it again and pick once more.', menu };
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= menu.options.length) return { status: 400, error: 'That choice is not on the question any more. Pick again.' };
  const own = typeof text === 'string' && text.trim() && TYPE_OWN.test(menu.options[i].label) ? text.replace(/\s+/g, ' ').trim().slice(0, 2000) : null;
  try {
    if (own) { await pressKeys(t.id, keysFor(menu, i).slice(0, -1)); await typeInto(t.id, own); }
    else await pressKeys(t.id, keysFor(menu, i));
  } catch (err) { return { status: 400, error: err.message }; }
  await new Promise((r) => setTimeout(r, 450));
  const next = await readMenu(t);
  // Answered: back to work, unless it was "No" (the agent then waits for what
  // to do instead) or another question came up.
  if (!next && t.claude_id) {
    const state = /^No\b/i.test(menu.options[i].label) ? 'finished' : 'running';
    db.prepare('UPDATE sessions SET state = ?, detail = NULL, updated_at = ? WHERE id = ?').run(state, Date.now(), t.claude_id);
  }
  return { ok: true, menu: next };
}
