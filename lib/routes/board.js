// The board itself: Claude hook events, live updates, the board state, windows, conversations (read, reply, archive), compose, GitHub actions, focus, seen and cleared, quick capture and items.
// Called by server.js for every request after its host and header checks;
// sends a response when the path is one of these, otherwise does nothing.
import { join } from 'node:path';
import { db, clear, onLocalChange } from '../db.js';
import { handleHook, handleStatus, sessionEvents, markSeen, onLaterChange } from '../claude.js';
import { pollGithub, github, rerunFailed, cancelRun, approvePr, mergePr, kick, repoFor } from '../github.js';
import { pollGmail, threadMessages, archiveThread, markThreadRead, replyThread, composeMail, fullThread } from '../gmail.js';
import { listWindows, focusWindow, activeWindow } from '../desktop.js';
import { capture } from '../capture.js';
import { providers } from '../sync.js';
import { bindClaude, deliver } from '../terminals.js';
import { gitTouched } from '../gitinfo.js';
import { microsoft, chatMessages, sendChat, outlookMessages, replyOutlook, archiveOutlook, readOutlook, fullChat, fullOutlook } from '../microsoft.js';
import { send, readJson } from '../http.js';
import { forget } from '../conversation.js';

export async function route({ req, res, path, url, changed, boardState, clients }) {
    // Claude Code's status line (bin/statusline.sh): the session's model, effort,
    // context used and cost, shown on its bar. The page is told only when they change.
    if (req.method === 'POST' && path === '/hook/claude/status') {
      const body = await readJson(req);
      const term = url.searchParams.get('term') || null;
      bindClaude(term, body.session_id);
      if (handleStatus(term, body)) changed();
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && path === '/hook/claude') {
      const body = await readJson(req);
      // When the last helper is back a little later, the board and the queue hear of it then.
      onLaterChange(() => { changed(); setTimeout(() => deliver().then((n) => n && changed()).catch(() => {}), 400); });
      bindClaude(url.searchParams.get('term'), body.session_id);
      const r = handleHook(body, url.searchParams);
      if (['PostToolUse', 'Stop'].includes(body.hook_event_name)) gitTouched(body.cwd);   // the git chips look again soon
      // The window the user just typed in is the one in front: remember it for jump-to-window.
      if (['UserPromptSubmit', 'SessionStart'].includes(body.hook_event_name) && body.session_id && !url.searchParams.get('term')) {
        activeWindow().then((w) => { if (w) db.prepare('UPDATE sessions SET window_id = ? WHERE id = ?').run(w, body.session_id); }).catch(() => {});
      }
      if (r?.changed !== false) changed();
      // A push from a session starts a run: look at its repo on the next live check.
      if (body.hook_event_name === 'Stop' || /\bgit\s+push\b/.test(body.tool_input?.command || '')) kick(repoFor(body.cwd)?.fullName);
      if (['Stop', 'Notification', 'SessionStart'].includes(body.hook_event_name)) setTimeout(() => deliver().then((n) => n && changed()).catch(() => {}), 400);
      return send(res, 200, { ok: true });
    }

    if (req.method === 'GET' && path === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write('retry: 2000\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    if (req.method === 'GET' && path === '/api/state') return send(res, 200, await boardState());
    if (req.method === 'GET' && path === '/api/account/providers') return send(res, 200, { providers: await providers() });

    if (req.method === 'GET' && path === '/api/windows') return send(res, 200, await listWindows());

    if (req.method === 'GET' && path.startsWith('/api/session/')) {
      return send(res, 200, { events: sessionEvents(decodeURIComponent(path.split('/').pop())) });
    }

    // A conversation in full, ready to hand to an agent.
    if (req.method === 'GET' && path === '/api/thread/full') {
      const key = url.searchParams.get('key') || '';
      const [kind, ...rest] = key.split(':');
      let msgs = [];
      if (kind === 'mail') msgs = await fullThread(rest[0], rest.slice(1).join(':'));
      if (kind === 'teams') msgs = await fullChat(rest.join(':'));
      if (kind === 'outlook') msgs = await fullOutlook(rest.join(':'));
      return send(res, 200, { messages: msgs });
    }

    if (req.method === 'GET' && path === '/api/thread') {
      const key = url.searchParams.get('key') || '';
      const [kind, ...rest] = key.split(':');
      let messages = [];
      if (kind === 'mail') { const account = rest[0], thread = rest.slice(1).join(':'); messages = threadMessages(account, thread); }
      if (kind === 'teams') messages = await chatMessages(rest.join(':'));
      if (kind === 'outlook') messages = await outlookMessages(rest.join(':'));
      return send(res, 200, { messages });
    }

    // Reply, archive, mark read: one route per verb, keyed by the thread key.
    if (req.method === 'POST' && ['/api/reply', '/api/archive', '/api/read'].includes(path)) {
      const b = await readJson(req);
      const key = b.key || '';
      const [kind, ...rest] = key.split(':');
      const thread = [...microsoft().threads].find((t) => t.key === key);
      if (path === '/api/reply') {
        const body = (b.text || '').trim();
        if (!body) return send(res, 400, { error: 'Write something first.' });
        let sent = null;
        if (kind === 'mail') sent = await replyThread(rest[0], rest.slice(1).join(':'), body, b.from);
        else if (kind === 'teams') sent = await sendChat(rest.join(':'), body);
        else if (kind === 'outlook') await replyOutlook(b.messageId || thread?.messageId, body);
        else return send(res, 400, { error: 'Unknown conversation.' });
        clear(key);
        forget(key);
        changed();
        return send(res, 200, { ok: true, id: sent?.id || null });
      } else if (path === '/api/archive') {
        if (kind === 'mail') await archiveThread(rest[0], rest.slice(1).join(':'));
        if (kind === 'outlook' && (b.messageId || thread?.messageId)) await archiveOutlook(b.messageId || thread.messageId);
        clear(key);
      } else {
        if (kind === 'mail') await markThreadRead(rest[0], rest.slice(1).join(':'));
        if (kind === 'outlook' && (b.messageId || thread?.messageId)) await readOutlook(b.messageId || thread.messageId);
      }
      changed();
      return send(res, 200, { ok: true });
    }

    if (req.method === 'POST' && path === '/api/compose') {
      const b = await readJson(req);
      if (!b.to || !(b.text || '').trim()) return send(res, 400, { error: 'Who to, and what to say.' });
      await composeMail(b.from, b.to, b.subject || '', b.text.trim());
      pollGmail().then(changed);
      return send(res, 200, { ok: true });
    }

    if (req.method === 'POST' && path.startsWith('/api/github/')) {
      const b = await readJson(req);
      const act = path.split('/').pop();
      if (act === 'rerun') await rerunFailed(b.fullName, b.runId);
      else if (act === 'cancel') await cancelRun(b.fullName, b.runId);
      else if (act === 'approve') await approvePr(b.repo, b.number);
      else if (act === 'merge') await mergePr(b.repo, b.number);
      else return send(res, 404, { error: 'unknown action' });
      kick(b.fullName);
      pollGithub().then(changed);
      return send(res, 200, { ok: true });
    }

    if (req.method === 'POST' && path === '/api/focus') {
      const b = await readJson(req);
      if (b.sessionId) markSeen(b.sessionId);
      const ok = await focusWindow(b.windowId);
      changed();
      return send(res, 200, { ok });
    }

    if (req.method === 'POST' && path === '/api/seen') {
      const b = await readJson(req);
      markSeen(b.sessionId);
      changed();
      return send(res, 200, { ok: true });
    }

    if (req.method === 'POST' && path === '/api/clear') {
      const b = await readJson(req);
      if (!b.key) return send(res, 400, { error: 'key' });
      clear(b.key, b.until || null);
      changed();
      return send(res, 200, { ok: true });
    }

    if (req.method === 'POST' && path === '/api/capture') {
      const b = await readJson(req);
      const item = capture(b.line, b.space);
      if (!item) return send(res, 400, { error: 'Type something first.' });
      if (item.error) return send(res, 400, item);
      onLocalChange();
      changed();
      return send(res, 200, item);
    }

    const itemMatch = path.match(/^\/api\/items\/(\d+)\/(done|snooze|undo|delete|paid)$/);
    if (req.method === 'POST' && itemMatch) {
      const [, id, act] = itemMatch;
      const b = await readJson(req);
      if (act === 'done') db.prepare('UPDATE items SET done_at = ? WHERE id = ?').run(Date.now(), id);
      if (act === 'undo') db.prepare('UPDATE items SET done_at = NULL WHERE id = ?').run(id);
      if (act === 'delete') db.prepare('DELETE FROM items WHERE id = ?').run(id);
      if (act === 'paid') {
        const inv = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
        if (inv) {
          db.prepare('UPDATE items SET done_at = ? WHERE id = ?').run(Date.now(), id);
          db.prepare('INSERT INTO items (kind, text, space, amount, created_at) VALUES (?, ?, ?, ?, ?)').run('paid', inv.text.split(' · ')[0] + ' paid', inv.space, inv.amount, Date.now());
        }
      }
      if (act === 'snooze') db.prepare('UPDATE items SET due_at = ?, notified_at = NULL WHERE id = ?').run(b.until, id);
      onLocalChange();
      changed();
      return send(res, 200, { ok: true });
    }
}
