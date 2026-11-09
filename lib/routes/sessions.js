// Sessions: folders, agents, talk to type, pasted images, starting and acting on terminals here and on other computers, the queue, linked chats.
// Called by server.js for every request after its host and header checks;
// sends a response when the path is one of these, otherwise does nothing.
import { makeFolder } from '../newfolder.js';
import { codeRoots } from '../clone.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '../db.js';
import { setupVoice, transcribe } from '../voice.js';
import { remoteAction } from '../relay.js';
import { installedAgents, folders, listTerms, startTerm, closeTerm, renameTerm, enqueue, releaseItem, dropItem, editItem, sendItemNow, deliver, sendNow, interrupt, link, unlink, setAuto } from '../terminals.js';
import { recentConversations } from '../bring.js';
import { spaceFor } from '../spaces.js';
import { keptPaths } from '../keptpaths.js';
import { send, readJson } from '../http.js';
import { friendlyError } from '../friendly.js';

export async function route({ req, res, path, url, changed }) {
    // ---- Switchboard's own Claude sessions
    // Each with the project it belongs to (null: Unsorted), so Notes can offer a project's own folders.
    if (req.method === 'GET' && path === '/api/folders') return send(res, 200, folders().map((f) => ({ ...f, space: spaceFor(f.path, f.name) || null })));
    // New session's New folder: where it can go, and making it (lib/newfolder.js).
    if (req.method === 'GET' && path === '/api/folders/roots') return send(res, 200, { roots: codeRoots() });
    if (req.method === 'POST' && path === '/api/folders/new') {
      const b = await readJson(req);
      try { return send(res, 200, await makeFolder({ name: b.name, root: b.root, git: b.git !== false, github: !!b.github })); }
      catch (e) { return send(res, 400, { error: friendlyError(e, 'Switchboard') }); }
    }
    if (req.method === 'GET' && path === '/api/agents') return send(res, 200, installedAgents());
    // Bring in a message: recent conversations, each with its project (lib/bring.js).
    if (req.method === 'GET' && path === '/api/bring') return send(res, 200, { list: recentConversations() });
    // An image pasted into the message bar: saved here, and its path goes in the
    // message, which is how Claude Code (and Codex) take images.
    if (req.method === 'POST' && path === '/api/voice/setup') { setupVoice(changed); return send(res, 200, { ok: true }); }
    if (req.method === 'POST' && path === '/api/transcribe') {
      const b = await readJson(req, 30e6);
      try { return send(res, 200, { text: await transcribe(String(b.wav || '')) }); }
      catch (err) { return send(res, 400, { error: friendlyError(err, 'Talk to type') }); }
    }

    if (req.method === 'POST' && path === '/api/paste') {
      const b = await readJson(req, 30e6);
      const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }[b.type];
      if (!ext || typeof b.data !== 'string') return send(res, 400, { error: 'Only PNG, JPEG, GIF or WebP images.' });
      const dir = join(DATA_DIR, 'pastes');
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `image-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`);
      writeFileSync(file, Buffer.from(b.data, 'base64'));
      return send(res, 200, { path: file });
    }

    if (req.method === 'POST' && path === '/api/terms') {
      const b = await readJson(req);
      // openedBy: an agent's session opening this one (bin/mcp.mjs). Kept only
      // when that session is open here, so only it can end this one later.
      const openedBy = b.openedBy && listTerms().some((t) => t.id === b.openedBy) ? b.openedBy : null;
      const id = await startTerm({ cwd: b.cwd, resume: b.resume, agent: b.agent || 'claude', command: b.command, setup: b.setup === 'app' ? 'app' : !!b.setup, model: b.model, effort: b.effort, openedBy });
      // A first message goes in once the agent is ready, like any queued one.
      const first = keptPaths(String(b.text || '').trim());   // a picture from a note: where it is on this computer
      if (first) enqueue(id, first, { source: String(b.source || 'You').slice(0, 80), held: false });
      changed();
      return send(res, 200, { id });
    }
    const renameMatch = path.match(/^\/api\/terms\/([\w-]+)\/rename$/);
    if (req.method === 'POST' && renameMatch) {
      const b = await readJson(req);
      if (!renameTerm(renameMatch[1], b.name)) return send(res, 404, { error: 'That session has ended.' });
      changed();
      return send(res, 200, { ok: true });
    }
    const termMatch = path.match(/^\/api\/terms\/([\w-]+)\/(close|queue|interrupt)$/);
    if (req.method === 'POST' && termMatch) {
      const [, id, act] = termMatch;
      const b = await readJson(req);
      if (act === 'close') {
        // From an agent (by: its own session): only a session it opened.
        if (b.by) {
          const t = listTerms().find((x) => x.id === id);
          if (!t) return send(res, 404, { error: 'That session has already ended.' });
          if (t.opened_by !== b.by) return send(res, 403, { error: 'You can only end a session you opened. Ask the user to end this one.' });
        }
        await closeTerm(id);
      }
      if (act === 'interrupt') await interrupt(id);
      if (act === 'queue') {
        const text = keptPaths((b.text || '').trim());
        if (!text) return send(res, 400, { error: 'Write something first.' });
        if (b.now) await sendNow(id, text);
        else { enqueue(id, text, { source: b.source || 'You', held: !!b.held }); await deliver(); }
      }
      changed();
      return send(res, 200, { ok: true });
    }
    // Sessions on another of your computers: actions go through the relay.
    const rMatch = path.match(/^\/api\/remote\/([0-9a-f]{8,64})\/([\w-]+)\/(queue|interrupt|close|release|drop|now)$/);
    if (req.method === 'POST' && rMatch) {
      const [, device, term, act] = rMatch;
      const b = await readJson(req);
      if (act === 'queue' && !(b.text || '').trim()) return send(res, 400, { error: 'Write something first.' });
      remoteAction(device, { t: act, term, text: (b.text || '').trim(), now: !!b.now, held: !!b.held, source: b.source, qid: b.qid });
      return send(res, 200, { ok: true });
    }

    const qMatch = path.match(/^\/api\/queue\/(\d+)\/(release|drop|edit|now)$/);
    if (req.method === 'POST' && qMatch) {
      const [, id, act] = qMatch;
      const b = await readJson(req);
      if (act === 'release') { releaseItem(id); await deliver(); }
      if (act === 'drop') dropItem(id);
      if (act === 'now') await sendItemNow(id).catch(() => {});
      if (act === 'edit') editItem(id, String(b.text || ''));
      changed();
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && path === '/api/links') {
      const b = await readJson(req);
      if (b.unlink) unlink(b.chatKey);
      else if (typeof b.auto === 'boolean') setAuto(b.chatKey, b.auto);
      else link(b.chatKey, b.termId, b.who);
      changed();
      return send(res, 200, { ok: true });
    }
}
