// Claude Code sessions report themselves through hooks (bin/hook.sh posts each
// event here). This turns the stream into one state per session:
//   running   the user asked something and Claude is working
//   waiting   Claude needs permission or has a question
//   finished  Claude replied and it is the user's turn
//   idle      open, nothing asked yet
//   ended     the session was closed
import { openSync, readSync, closeSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { db, getSetting } from './db.js';
import { spaceFor } from './spaces.js';
import { listWindows } from './desktop.js';
import { alert } from './notify.js';
import { notePrompt, noteFinished } from './notemarks.js';
import { plainPrompt, plainEvent } from './plainwords.js';

const repoCache = new Map();
function repoRoot(cwd) {
  if (!cwd) return null;
  if (repoCache.has(cwd)) return repoCache.get(cwd);
  let root = cwd;
  try { root = execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { timeout: 1000 }).toString().trim(); } catch {}
  repoCache.set(cwd, root);
  return root;
}

// The end of Claude's last reply, read from the transcript file Claude Code keeps.
function lastAssistantText(path) {
  if (!path) return null;
  try {
    const size = statSync(path).size;
    const len = Math.min(size, 256 * 1024);
    const buf = Buffer.alloc(len);
    const fd = openSync(path, 'r');
    readSync(fd, buf, 0, len, size - len);
    closeSync(fd);
    const lines = buf.toString('utf8').split('\n').reverse();
    for (const line of lines) {
      if (!line.startsWith('{')) continue;
      let j; try { j = JSON.parse(line); } catch { continue; }
      if (j.type !== 'assistant') continue;
      const parts = (j.message?.content || []).filter((c) => c.type === 'text').map((c) => c.text);
      if (parts.length) return tidy(parts.join('\n'));
    }
  } catch {}
  return null;
}

function tidy(text) {
  const t = text.replace(/```[\s\S]*?```/g, ' ').replace(/[#*_`>|]/g, '').replace(/\s+/g, ' ').trim();
  return t.length > 320 ? '…' + t.slice(-320) : t;
}

const short = (s, n = 160) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s);

// ---- what Claude Code says about itself as it runs: the model, effort,
// context used and cost from its status line (bin/statusline.sh posts the JSON
// Claude Code feeds it to /hook/claude/status), and the model from the
// SessionStart and PostModelSwitch hooks for anyone whose status line is their
// own. Kept in memory, by terminal (SWITCHBOARD_TERM) or by session id; shown
// on the session's bar.
const status = new Map();   // term id or session id -> { model, effort, context, cost, at }
const readout = (x) => [x.model, x.effort, x.context != null ? x.context + '%' : '', x.cost != null ? '$' + x.cost.toFixed(2) : ''].filter(Boolean).join(' · ');
// "claude-opus-5-5" / "opus[1m]" / "claude-sonnet-4-5-20250929" as a person says it: "Opus 5.5", "Opus 1M".
export function prettyModel(id) {
  const s = String(id || '').trim();
  if (!s) return '';
  const m = s.match(/(opus|sonnet|haiku|fable)(?:-(\d+)(?:-(\d+))?)?/i);
  if (!m) return s;
  const name = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
  const ver = m[2] ? (m[3] && m[3].length < 3 ? `${m[2]}.${m[3]}` : m[2]) : '';
  return [name, ver, /\[1m\]|-1m\b/i.test(s) ? '1M' : ''].filter(Boolean).join(' ');
}
function noteStatus(key, patch) {
  if (!key) return false;
  const cur = status.get(key) || {};
  const next = { ...cur, ...patch, at: Date.now() };
  status.set(key, next);
  return readout(cur) !== readout(next);
}
// The status-line JSON (model.display_name, effort.level, context_window.used_percentage,
// cost.total_cost_usd). Returns true when what shows on the bar changed.
export function handleStatus(term, body) {
  if (!body || typeof body !== 'object') return false;
  const key = term || body.session_id;
  const num = (v, max) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(v, max) : null);
  const str = (v, n) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
  const patch = {};
  const model = str(body.model?.display_name, 40) || prettyModel(str(body.model?.id, 80));
  if (model) patch.model = model;
  const effort = str(body.effort?.level, 10).toLowerCase();
  if (effort) patch.effort = effort;
  const pct = num(body.context_window?.used_percentage, 100);
  if (pct != null) patch.context = Math.round(pct);
  const cost = num(body.cost?.total_cost_usd, 1e6);
  if (cost != null) patch.cost = Math.round(cost * 100) / 100;
  return noteStatus(key, patch);
}
// For the terms payload: by terminal first, else by the Claude session bound to it.
export function termStatus(termId, claudeId) {
  const x = status.get(termId) || (claudeId && status.get(claudeId)) || null;
  return x ? { model: x.model || null, effort: x.effort || null, context: x.context ?? null, cost: x.cost ?? null, at: x.at } : null;
}

// Helpers (subagents) a session has running, by session id: agent id -> start
// time. Claude Code fires Stop when the main agent's turn ends, even while
// helpers it sent off in the background keep working, so "Your turn" waits
// until the last one is back. In memory only: after a restart the next Stop
// counts as done, and a helper not heard from in 2 hours is dropped.
const helpers = new Map();
const stopped = new Set();   // sessions whose main turn ended while helpers were out
const HELPER_MAX = 2 * 3600e3;
const GRACE = Number(process.env.SWITCHBOARD_HELPER_GRACE) || 20e3;   // after the last helper: time for the main agent to pick its result up (tests shorten it)
let later = () => {};
export function onLaterChange(fn) { later = fn; }
function helpersOf(id) {
  const m = helpers.get(id); if (!m) return 0;
  for (const [k, at] of m) if (Date.now() - at > HELPER_MAX) m.delete(k);
  if (!m.size) helpers.delete(id);
  return m.size;
}
const helperWord = (n) => `${n} helper${n === 1 ? '' : 's'} still working`;
export function helperCount(id) { return helpersOf(id); }

export function handleHook(body, query) {
  const event = body.hook_event_name || query.get('event');
  const id = body.session_id;
  if (!id || !event) return;
  const now = Date.now();
  const win = parseInt(query.get('win'), 10) || null;
  // The model, from the hooks that carry it (exact where there is no status line).
  const model = event === 'SessionStart' ? body.model : event === 'PostModelSwitch' ? body.to_model : null;
  if (model && typeof model === 'string') noteStatus(query.get('term') || id, { model: prettyModel(model.slice(0, 80)) });
  let s = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);

  if (!s) {
    const root = repoRoot(body.cwd);
    s = {
      id, cwd: body.cwd || null, repo: root ? basename(root) : null,
      space: spaceFor(body.cwd, root && basename(root)) || 'personal',
      state: 'idle', detail: null, prompt: null, last_message: null,
      transcript: body.transcript_path || null, window_id: win,
      started_at: now, updated_at: now, seen: 1
    };
    db.prepare(`INSERT INTO sessions (id, cwd, repo, space, state, detail, prompt, last_message, transcript, window_id, started_at, updated_at, seen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(s.id, s.cwd, s.repo, s.space, s.state, s.detail, s.prompt, s.last_message, s.transcript, s.window_id, s.started_at, s.updated_at, s.seen);
  }

  const prev = s.state;
  let info = null;
  // Any sign of the main agent working again means its turn is not over.
  if (['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'SessionStart', 'SessionEnd'].includes(event)) stopped.delete(id);
  if (event === 'SessionStart' || event === 'SessionEnd') helpers.delete(id);

  switch (event) {
    case 'SessionStart':
      s.state = 'idle';
      if (win) s.window_id = win;
      break;
    case 'UserPromptSubmit':
      s.state = 'running';
      s.prompt = short(plainPrompt(body.prompt), 220);
      s.detail = null;
      s.seen = 1;
      if (win) s.window_id = win;     // the window the user just typed in
      info = short((body.prompt || '').replace(/\s+/g, ' ').trim(), 220);   // as sent; sessionEvents says it plainly
      break;
    case 'PreToolUse':
      if (body.tool_name === 'AskUserQuestion') {
        s.state = 'waiting';
        const q = body.tool_input?.questions?.[0]?.question;
        s.detail = short(q ? 'Question: ' + q : 'Has a question for you');
        s.seen = 0;
        info = s.detail;
      }
      break;
    case 'PostToolUse':
      if (s.state === 'waiting') { s.state = 'running'; s.detail = null; }
      break;
    case 'Notification': {
      const type = body.notification_type || '';
      const msg = body.message || '';
      if (type === 'idle_prompt' || /waiting for your input/i.test(msg)) {
        if (s.state !== 'finished') { s.state = 'finished'; s.seen = 0; }
      } else if (type === 'auth_success') {
        // nothing to show
      } else {
        s.state = 'waiting';
        s.detail = short(msg || 'Needs you');
        s.seen = 0;
      }
      info = msg;
      break;
    }
    case 'SubagentStart': {
      if (!helpers.has(id)) helpers.set(id, new Map());
      helpers.get(id).set(String(body.agent_id || now), now);
      info = body.agent_type ? `Helper: ${short(String(body.agent_type), 60)}` : null;
      if (s.state === 'finished' || s.state === 'idle') { s.state = 'running'; s.detail = helperWord(helpersOf(id)); }
      break;
    }
    case 'SubagentStop': {
      helpers.get(id)?.delete(String(body.agent_id || ''));
      const n = helpersOf(id);
      if (s.state === 'running' && stopped.has(id)) {
        s.detail = n ? helperWord(n) : null;
        // The main agent's turn already ended: give it a moment to take the
        // result up (it starts a new turn), then it really is your turn.
        if (!n) { const at = now; setTimeout(() => settle(id, at), GRACE); }
      }
      break;
    }
    case 'Stop':
      if (helpersOf(id)) {
        // Its turn ended, but helpers are still out: not your turn yet.
        s.state = 'running';
        s.detail = helperWord(helpersOf(id));
        stopped.add(id);
        s.last_message = lastAssistantText(body.transcript_path || s.transcript) || s.last_message;
        break;
      }
      s.state = 'finished';
      s.detail = null;
      s.seen = 0;
      s.last_message = lastAssistantText(body.transcript_path || s.transcript) || s.last_message;
      break;
    case 'SessionEnd':
      s.state = 'ended';
      break;
    case 'PostModelSwitch':
      info = model ? `Model: ${prettyModel(model)}` : null;
      break;
    default:
      break;
  }

  s.updated_at = now;
  if (body.transcript_path) s.transcript = body.transcript_path;
  db.prepare(`UPDATE sessions SET state = ?, detail = ?, prompt = ?, last_message = ?, transcript = ?, window_id = ?, updated_at = ?, seen = ? WHERE id = ?`)
    .run(s.state, s.detail, s.prompt, s.last_message, s.transcript, s.window_id, s.updated_at, s.seen, id);
  if ((event !== 'PostToolUse' || prev !== s.state) && event !== 'PreModelSwitch') {
    db.prepare('INSERT INTO session_events (session_id, at, event, info) VALUES (?, ?, ?, ?)').run(id, now, event, info);
  }

  // Notes it was sent are marked on the note, and marked finished when its turn ends (lib/notemarks.js).
  if (event === 'UserPromptSubmit') { try { notePrompt(id, query.get('term') || null, body.prompt || '', now); } catch {} }
  if (s.state === 'finished' && prev !== 'finished') { try { noteFinished(id, now); } catch {} }

  if (prev !== s.state) {
    const name = s.repo || 'Claude';
    if (s.state === 'waiting') alert('waiting', `${name} needs you`, s.detail || '');
    if (s.state === 'finished' && prev === 'running') alert('finished', `${name} finished`, short(s.last_message || s.prompt || '', 140));
  }
  return { changed: prev !== s.state || event === 'UserPromptSubmit' || event === 'Stop' };
}

// The last helper came back and nothing has happened since: now it is your turn.
function settle(id, at) {
  const s = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  if (!s || s.state !== 'running' || s.updated_at !== at || !stopped.has(id) || helpersOf(id)) return;
  stopped.delete(id);
  const now = Date.now();
  db.prepare(`UPDATE sessions SET state = 'finished', detail = NULL, seen = 0, updated_at = ? WHERE id = ?`).run(now, id);
  db.prepare('INSERT INTO session_events (session_id, at, event, info) VALUES (?, ?, ?, ?)').run(id, now, 'HelpersDone', null);
  try { noteFinished(id, now); } catch {}
  alert('finished', `${s.repo || 'Claude'} finished`, short(s.last_message || s.prompt || '', 140));
  later();
}

export async function sessionsForBoard() {
  const cutoff = Date.now() - 12 * 3600e3;
  const rows = db.prepare(`SELECT * FROM sessions WHERE updated_at > ? AND state != 'ended' ORDER BY updated_at DESC`).all(cutoff);
  const wins = await listWindows();
  const byId = new Map(wins.map((w) => [w.id, w]));
  return rows.map((s) => {
    let w = s.window_id ? byId.get(s.window_id) : null;
    if (!w && s.repo) w = wins.find((x) => x.folder === s.repo) || null;
    const state = boardState(s);
    return {
      id: s.id, repo: s.repo, cwd: s.cwd, space: s.space, state, detail: s.detail,
      prompt: s.prompt && plainPrompt(s.prompt), lastMessage: s.last_message, updatedAt: s.updated_at,
      startedAt: s.started_at, windowId: w?.id || null, windowTitle: w?.title || null
    };
  });
}

// What Now shows for a session. "Your turn" and "Needs you" ask for the user
// only until they have dealt with it: looked at it (jumped to its window, had
// it open on Sessions) or pressed Clear. Anything new the session asks puts it
// back (every Stop, question or permission prompt sets seen to 0). Finished
// work nobody looked at fades on its own after 3 hours.
const FADE = 3 * 3600e3;
export function boardState(s) {
  if ((s.state === 'finished' || s.state === 'waiting') && s.seen) return 'idle';
  if (s.state === 'finished' && Date.now() - s.updated_at > FADE) return 'idle';
  return s.state;
}

export function sessionEvents(id) {
  return db.prepare('SELECT at, event, info FROM session_events WHERE session_id = ? ORDER BY at DESC LIMIT 40').all(id)
    .map((e) => ({ at: e.at, ...plainEvent(e.event, e.info) }));
}

export function markSeen(id) {
  db.prepare('UPDATE sessions SET seen = 1 WHERE id = ?').run(id);
}

export function lastHookAt() {
  return db.prepare('SELECT MAX(at) AS at FROM session_events').get()?.at || null;
}

// The folders of sessions still open, for watching their GitHub Actions.
export function sessionFolders() {
  return db.prepare(`SELECT DISTINCT cwd FROM sessions WHERE updated_at > ? AND state != 'ended' AND cwd IS NOT NULL`).all(Date.now() - 12 * 3600e3).map((r) => r.cwd);
}
