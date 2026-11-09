// Jarvis, the voice of Switchboard (lib/jarvis.js).
//   POST /api/jarvis         what was said; the whole answer comes back at once.
//   POST /api/jarvis/stream  the same, streamed as lines of JSON while the model
//                            talks: {say} pieces to speak a sentence at a time,
//                            {act} things for the page to do, then {done}. The
//                            page closing the request (you spoke over Jarvis)
//                            stops the model.
//   POST /api/jarvis/warm    load the model now (Ctrl+Space went down).
//   GET  /api/jarvis/memory  what Jarvis knows (lib/jarvismemory.js); POST it to
//                            change it; POST …/memory/undo, …/memory/tidy.
// Called by server.js for every request after its host and header checks;
// sends a response when the path is one of these, otherwise does nothing.
import { ask, warm, tidyNow } from '../jarvis.js';
import { cardState, setCard, undoCard } from '../jarvismemory.js';
import { send, readJson } from '../http.js';
import { friendlyError } from '../friendly.js';

function question(b) {
  const text = String(b.text || '').trim().slice(0, 2000);
  const history = (Array.isArray(b.history) ? b.history : []).filter((m) => m && ['user', 'assistant'].includes(m.role)).map((m) => ({ role: m.role, content: String(m.content || '').slice(0, 2000) })).slice(-8);
  return { text, history, ctx: { page: String(b.page || ''), session: String(b.session || '') }, model: b.model ? String(b.model) : null };
}

export async function route({ req, res, path, PORT }) {
  if (path === '/api/jarvis/memory' && req.method === 'GET') return send(res, 200, cardState());
  if (req.method === 'POST' && path.startsWith('/api/jarvis/memory')) {
    const b = await readJson(req);
    if (path === '/api/jarvis/memory') { setCard(b.card); return send(res, 200, cardState()); }
    if (path === '/api/jarvis/memory/undo') { if (undoCard() === null) return send(res, 400, { error: 'There is no earlier version to go back to.' }); return send(res, 200, cardState()); }
    if (path === '/api/jarvis/memory/tidy') {
      try { const r = await tidyNow(); if (r.error) return send(res, 400, { error: r.error }); return send(res, 200, { ...cardState(), changed: r.changed }); }
      catch (e) { return send(res, 400, { error: friendlyError(e, 'the local model') }); }
    }
  }
  if (req.method !== 'POST' || !['/api/jarvis', '/api/jarvis/stream', '/api/jarvis/warm'].includes(path)) return;
  const b = await readJson(req);
  if (path === '/api/jarvis/warm') {
    warm(b.model ? String(b.model) : null).catch(() => {});
    return send(res, 200, { ok: true });
  }
  const q = question(b);
  if (!q.text) return send(res, 400, { error: 'Say or type something for Jarvis first.' });
  if (path === '/api/jarvis') {
    try { return send(res, 200, await ask({ ...q, port: PORT })); }
    catch (e) { return send(res, 200, { say: friendlyError(e, 'the local model'), actions: [], by: 'error' }); }
  }
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  const ac = new AbortController();
  res.on('close', () => { if (!res.writableFinished) ac.abort(); });
  const line = (o) => { if (!res.writableEnded) res.write(JSON.stringify(o) + '\n'); };
  try {
    const r = await ask({ ...q, port: PORT, signal: ac.signal, onSay: (say) => line({ say }), onAct: (act) => line({ act }) });
    line({ done: true, say: r.say, by: r.by, model: r.model || null, models: r.models || null, noBrain: !!r.noBrain });
  } catch (e) {
    if (!ac.signal.aborted) { const say = friendlyError(e, 'the local model'); line({ say }); line({ done: true, say, by: 'error' }); }
  }
  res.end();
}
