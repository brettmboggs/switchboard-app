// Claude Code sessions report themselves through hooks (bin/hook.sh posts each
// event here). This turns the stream into one state per session:
//   running   Brett asked something and Claude is working
//   waiting   Claude needs permission or has a question
//   finished  Claude replied and it is Brett's turn
//   idle      open, nothing asked yet
//   ended     the session was closed
import { openSync, readSync, closeSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { db, getSetting } from './db.js';
import { spaceFor } from './spaces.js';
import { listWindows } from './desktop.js';
import { alert } from './notify.js';

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

export function handleHook(body, query) {
  const event = body.hook_event_name || query.get('event');
  const id = body.session_id;
  if (!id || !event) return;
  const now = Date.now();
  const win = parseInt(query.get('win'), 10) || null;
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

  switch (event) {
    case 'SessionStart':
      s.state = 'idle';
      if (win) s.window_id = win;
      break;
    case 'UserPromptSubmit':
      s.state = 'running';
      s.prompt = short((body.prompt || '').replace(/\s+/g, ' ').trim(), 220);
      s.detail = null;
      s.seen = 1;
      if (win) s.window_id = win;     // the window Brett just typed in
      info = s.prompt;
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
    case 'Stop':
      s.state = 'finished';
      s.detail = null;
      s.seen = 0;
      s.last_message = lastAssistantText(body.transcript_path || s.transcript) || s.last_message;
      break;
    case 'SessionEnd':
      s.state = 'ended';
      break;
    default:
      break;
  }

  s.updated_at = now;
  if (body.transcript_path) s.transcript = body.transcript_path;
  db.prepare(`UPDATE sessions SET state = ?, detail = ?, prompt = ?, last_message = ?, transcript = ?, window_id = ?, updated_at = ?, seen = ? WHERE id = ?`)
    .run(s.state, s.detail, s.prompt, s.last_message, s.transcript, s.window_id, s.updated_at, s.seen, id);
  if (event !== 'PostToolUse' || prev !== s.state) {
    db.prepare('INSERT INTO session_events (session_id, at, event, info) VALUES (?, ?, ?, ?)').run(id, now, event, info);
  }

  if (prev !== s.state) {
    const name = s.repo || 'Claude';
    if (s.state === 'waiting') alert('waiting', `${name} needs you`, s.detail || '');
    if (s.state === 'finished' && prev === 'running') alert('finished', `${name} finished`, short(s.last_message || s.prompt || '', 140));
  }
  return { changed: prev !== s.state || event === 'UserPromptSubmit' || event === 'Stop' };
}

export async function sessionsForBoard() {
  const cutoff = Date.now() - 12 * 3600e3;
  const rows = db.prepare(`SELECT * FROM sessions WHERE updated_at > ? AND state != 'ended' ORDER BY updated_at DESC`).all(cutoff);
  const wins = await listWindows();
  const byId = new Map(wins.map((w) => [w.id, w]));
  return rows.map((s) => {
    let w = s.window_id ? byId.get(s.window_id) : null;
    if (!w && s.repo) w = wins.find((x) => x.folder === s.repo) || null;
    // Finished work Brett has not looked at for 3 hours fades back to idle.
    let state = s.state;
    if (state === 'finished' && s.seen) state = 'idle';
    if (state === 'finished' && Date.now() - s.updated_at > 3 * 3600e3) state = 'idle';
    return {
      id: s.id, repo: s.repo, cwd: s.cwd, space: s.space, state, detail: s.detail,
      prompt: s.prompt, lastMessage: s.last_message, updatedAt: s.updated_at,
      startedAt: s.started_at, windowId: w?.id || null, windowTitle: w?.title || null
    };
  });
}

export function sessionEvents(id) {
  return db.prepare('SELECT at, event, info FROM session_events WHERE session_id = ? ORDER BY at DESC LIMIT 40').all(id);
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
