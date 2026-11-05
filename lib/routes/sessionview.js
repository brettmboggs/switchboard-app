// The Sessions page's extras for one local session: its Chat view (the agent's
// own transcript, read incrementally), the question it is asking in its own
// screen (read, and answered with the keys it expects), and the git and pull
// request chips on its bar (switched on in Settings, General).
// Called by server.js for every request after its host and header checks;
// sends a response when the path is one of these, otherwise does nothing.
// A session on another computer gets the same Chat view through the relay:
// /api/remote/<device>/<id>/chat and /menu ask that computer (lib/relay.js).
import { watch } from 'node:fs';
import { gitStatus } from '../gitinfo.js';
import { prFor } from '../github.js';
import { termRow, readChat, readMenu, answerMenu } from '../chatview.js';
import { askRemote } from '../relay.js';
import { send, readJson } from '../http.js';

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

export async function route({ req, res, path, url, clients, changed }) {
  // Another computer's session: the same questions, asked over the relay.
  const rm = path.match(/^\/api\/remote\/([0-9a-f]{8,64})\/([\w-]+)\/(chat|menu)$/);
  if (rm && (req.method === 'GET' || (req.method === 'POST' && rm[3] === 'menu'))) {
    const q = Object.fromEntries(url.searchParams);
    const ask = rm[3] === 'chat' ? { what: 'chat', q }
      : req.method === 'GET' ? { what: 'menu' } : await readJson(req).then((b) => ({ what: 'answer', sig: b.sig, index: b.index, text: b.text }));
    try {
      const r = await askRemote(rm[1], rm[2], ask);
      if (r.status) return send(res, r.status, { error: r.error, menu: r.menu });
      if (ask.what === 'answer') changed?.();
      return send(res, 200, r);
    } catch (err) { return send(res, 502, { error: err.message }); }
  }

  const m = path.match(/^\/api\/terms\/([\w-]+)\/(chat|dev|menu)$/);
  if (!m || (req.method !== 'GET' && !(req.method === 'POST' && m[2] === 'menu'))) return;
  const t = termRow(m[1]);
  if (!t) return send(res, 404, { error: 'That session has ended.' });

  // The question the agent is asking in its own screen, as buttons in the Chat
  // view. GET reads it; POST { sig, index } answers it: the screen is read
  // again first, and the keys go in only if it is still the same question.
  if (m[2] === 'menu') {
    if (req.method === 'GET') return send(res, 200, { menu: await readMenu(t) });
    const b = await readJson(req);
    const r = await answerMenu(t, b.sig, b.index, b.text);
    if (r.status) return send(res, r.status, { error: r.error, menu: r.menu });
    changed?.();
    return send(res, 200, r);
  }

  if (m[2] === 'dev') {
    const git = await gitStatus(t.cwd);
    const pr = git?.branch ? await prFor(t.cwd, git.branch) : null;
    return send(res, 200, { git, pr });
  }

  // Chat: ?file=<session id>&from=<byte offset> for what is new, ?before=<offset>
  // for earlier messages, neither for the newest part.
  const { path: file, ...out } = readChat(t, Object.fromEntries(url.searchParams));
  if (file) watchFile(file, t.id, clients);
  return send(res, 200, out);
}
