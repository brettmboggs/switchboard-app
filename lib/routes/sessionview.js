// The Sessions page's extras for one local session: its Chat view (the agent's
// own transcript, read incrementally) and the git and pull request chips on
// its bar. Both are switched on in Settings, General.
// Called by server.js for every request after its host and header checks;
// sends a response when the path is one of these, otherwise does nothing.
import { watch } from 'node:fs';
import { db } from '../db.js';
import { claudeTranscript, readTail, readSince, readBefore } from '../transcript.js';
import { gitStatus } from '../gitinfo.js';
import { prFor } from '../github.js';
import { send } from '../http.js';

const termRow = (id) => db.prepare('SELECT id, cwd, agent, claude_id FROM terms WHERE id = ? AND ended_at IS NULL').get(id);

// ---- live: while a page reads a transcript, watch the file and tell that page
// (one small "chat" event on the page's existing event stream) when it grows.
// A watch nobody has asked about for three minutes is dropped.
const watching = new Map();   // path -> { w, term, seen, timer }
let sweeper = null;
function watchFile(path, term, clients) {
  const old = watching.get(path);
  if (old) { old.seen = Date.now(); old.term = term; return; }
  let w;
  try { w = watch(path, { persistent: false }); } catch { return; }
  const entry = { w, term, seen: Date.now(), timer: null };
  w.on('change', () => {
    if (entry.timer) return;
    entry.timer = setTimeout(() => {
      entry.timer = null;
      for (const res of clients) res.write(`event: chat\ndata: ${entry.term}\n\n`);
    }, 120);
  });
  w.on('error', () => { try { w.close(); } catch {} watching.delete(path); });
  watching.set(path, entry);
  if (!sweeper) {
    sweeper = setInterval(() => {
      for (const [p, e] of watching) if (Date.now() - e.seen > 3 * 60e3) { try { e.w.close(); } catch {} clearTimeout(e.timer); watching.delete(p); }
      if (!watching.size) { clearInterval(sweeper); sweeper = null; }
    }, 60e3);
    sweeper.unref?.();
  }
}

export async function route({ req, res, path, url, clients }) {
  if (req.method !== 'GET') return;
  const m = path.match(/^\/api\/terms\/([\w-]+)\/(chat|dev)$/);
  if (!m) return;
  const t = termRow(m[1]);
  if (!t) return send(res, 404, { error: 'That session has ended.' });

  if (m[2] === 'dev') {
    const git = await gitStatus(t.cwd);
    const pr = git?.branch ? await prFor(t.cwd, git.branch) : null;
    return send(res, 200, { git, pr });
  }

  // Chat: ?file=<session id>&from=<byte offset> for what is new, ?before=<offset>
  // for earlier messages, neither for the newest part.
  if ((t.agent || 'claude') !== 'claude') return send(res, 200, { file: null, why: 'agent', messages: [] });
  if (!t.claude_id) return send(res, 200, { file: null, why: 'starting', messages: [] });
  const reported = db.prepare('SELECT transcript FROM sessions WHERE id = ?').get(t.claude_id)?.transcript;
  const file = claudeTranscript(t.cwd, t.claude_id, reported);
  if (!file) return send(res, 200, { file: null, why: 'nofile', messages: [] });
  watchFile(file, t.id, clients);
  const q = url.searchParams, same = q.get('file') === t.claude_id;
  try {
    if (same && q.has('before')) {
      const r = readBefore(file, Number(q.get('before')));
      return send(res, 200, { file: t.claude_id, start: r.start, messages: r.messages, earlier: true });
    }
    if (same && q.has('from')) {
      const r = readSince(file, Number(q.get('from')));
      if (r) return send(res, 200, { file: t.claude_id, end: r.end, messages: r.messages });
    }
    const r = readTail(file);
    return send(res, 200, { file: t.claude_id, start: r.start, end: r.end, messages: r.messages, reset: true });
  } catch (err) {
    return send(res, 200, { file: null, why: 'unreadable', error: err.message, messages: [] });
  }
}
