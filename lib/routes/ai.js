// Switchboard's own model (lib/engine.js): Jarvis thinks with it, and Sessions'
// "Local AI (Switchboard)" sessions chat with it (bin/localchat.mjs --engine).
//   GET  /api/ai                         the model's state, the models here, the card
//   POST /api/ai/start | stop            load or unload the model
//   POST /api/ai/settings                which model, its memory size, idle minutes
//   GET  /api/ai/v1/models, POST /api/ai/v1/chat/completions   the door Sessions' chat uses
//   GET  /api/ai/chats, POST /api/ai/chats/reopen | delete      past Local AI chats
import { send, readJson } from '../http.js';
import * as engine from '../engine.js';
import { friendlyError } from '../friendly.js';
import { listChats, deleteChats, KEEP_DAYS } from '../localchats.js';
import { startTerm } from '../terminals.js';

const full = () => engine.status();
const fail = (res, e) => send(res, e.status || 409, { error: friendlyError(e, 'the model') });

export async function route({ req, res, path, url, changed }) {
  if (path !== '/api/ai' && !path.startsWith('/api/ai/')) return;
  if (req.method === 'GET' && path === '/api/ai') return send(res, 200, await full());
  // An OpenAI-style door to the model for Sessions' local chat (bin/localchat.mjs --engine):
  // it loads the model on the first message and unloads it when idle like any other use.
  if (req.method === 'GET' && path === '/api/ai/v1/models') {
    const s = engine.config();
    return send(res, 200, { object: 'list', loaded: !!engine.enginePid(), data: s.model ? [{ id: s.model.name, object: 'model' }] : [] });
  }
  if (req.method === 'POST' && path === '/api/ai/v1/chat/completions') {
    const b = await readJson(req, 40e6);   // pictures from the message bar
    const ac = new AbortController();
    res.on('close', () => { if (!res.writableFinished) ac.abort(); });
    let r;
    try { const was = !!engine.enginePid(); r = await engine.chat({ ...b, model: undefined }, { signal: ac.signal }); if (!was) changed?.(); }
    catch (e) { return send(res, e.status || 503, { error: friendlyError(e, 'the model') }); }
    res.writeHead(200, { 'Content-Type': r.headers.get('content-type') || 'text/event-stream', 'Cache-Control': 'no-store' });
    try { for await (const chunk of r.body) { if (res.writableEnded) break; res.write(chunk); } } catch {}
    finally { engine.end(); }
    return res.end();
  }
  // Past Local AI chats (lib/localchats.js): shown in Sessions while a Local AI chat is open.
  if (req.method === 'GET' && path === '/api/ai/chats') return send(res, 200, { chats: listChats(), keepDays: KEEP_DAYS });
  if (req.method !== 'POST') return;
  if (path === '/api/ai/chats/reopen') {
    const b = await readJson(req);
    try { const id = await startTerm({ agent: 'engine', resume: String(b.id || '') }); changed?.(); return send(res, 200, { id }); }
    catch (e) { return fail(res, e); }
  }
  if (path === '/api/ai/chats/delete') {
    const b = await readJson(req);
    const n = await deleteChats(b.all ? { all: true } : { id: String(b.id || '') });
    changed?.();
    return send(res, 200, { deleted: n, chats: listChats() });
  }
  if (path === '/api/ai/start') {
    try { await engine.ensure(); changed?.(); return send(res, 200, await full()); } catch (e) { return fail(res, e); }
  }
  if (path === '/api/ai/stop') { await engine.stop('Stop pressed'); changed?.(); return send(res, 200, await full()); }
  if (path === '/api/ai/settings') {
    const b = await readJson(req);
    const before = engine.config();
    try { engine.saveConfig(b); } catch (e) { return fail(res, e); }
    const after = engine.config();
    // A new model or memory size: a running model starts again with it (it was not answering anything, or it waits).
    if (engine.enginePid() && (before.model?.path !== after.model?.path || before.ctx !== after.ctx || before.vision !== after.vision)) {
      await engine.stop('settings changed');
      try { await engine.ensure(); } catch (e) { return fail(res, e); }
    }
    return send(res, 200, await full());
  }
}
