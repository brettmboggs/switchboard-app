// Team chat (lib/chat.js) on the page: a chat opens in the Inbox's conversation
// view like any other, so this answers the shared conversation routes for
// "team:" keys (and leaves every other key to lib/routes/board.js and
// inbox.js), plus what only team chat has: edit, delete, react, pin, seen,
// typing, and its pictures.
// Called by server.js for every request after its host and header checks,
// before the board's own routes; sends a response when the path and key are
// its own, otherwise does nothing.
import { isChatKey, chatConversation, sendChat, chatAct, markSeen, sendTyping, chatPicture, syncChat } from '../chat.js';
import { clear } from '../db.js';
import { friendlyError } from '../friendly.js';
import { send, readJson } from '../http.js';

const fail = (res, e) => send(res, 400, { error: friendlyError(e, 'the sync service') });

export async function route({ req, res, path, url, changed }) {
  if (req.method === 'GET' && path === '/api/conversation' && isChatKey(url.searchParams.get('key'))) {
    try { return send(res, 200, await chatConversation(url.searchParams.get('key'), url.searchParams.get('limit'))); } catch (e) { return fail(res, e); }
  }
  if (req.method === 'GET' && path === '/api/chat/picture') {
    const p = chatPicture(url.searchParams.get('key'), url.searchParams.get('id') || '', url.searchParams.get('n'));
    if (!p) return send(res, 404, { error: 'That picture is gone.' });
    res.writeHead(200, { 'Content-Type': p.type, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
    return res.end(p.data);
  }
  if (req.method !== 'POST') return;
  // The Inbox's reply, Done and Mark read, for a team chat.
  if (['/api/reply', '/api/archive', '/api/read'].includes(path)) {
    const b = await readJson(req, path === '/api/reply' ? 26e6 : undefined);   // the same room board.js gives pictures
    if (!isChatKey(b.key)) return;   // someone else's: board.js gets the same body from readJson
    try {
      if (path === '/api/reply') { const r = await sendChat(b.key, { text: b.text, images: b.images, reply: b.replyTo }); clear(b.key); changed(); return send(res, 200, { ok: true, id: r.id }); }
      if (path === '/api/archive') { clear(b.key); await markSeen(b.key).catch(() => {}); changed(); return send(res, 200, { ok: true }); }
      await markSeen(b.key); changed();
      return send(res, 200, { ok: true });
    } catch (e) { return fail(res, e); }
  }
  if (!path.startsWith('/api/chat/')) return;
  const b = await readJson(req);
  try {
    if (path === '/api/chat/act') { const r = await chatAct(b.key, { what: b.what, id: b.id, text: b.text, emoji: b.emoji, on: b.on }); changed(); return send(res, 200, r); }
    if (path === '/api/chat/seen') return send(res, 200, await markSeen(b.key));
    if (path === '/api/chat/typing') { await sendTyping(b.key); return send(res, 200, { ok: true }); }
    if (path === '/api/chat/refresh') { await syncChat(); changed(); return send(res, 200, { ok: true }); }
  } catch (e) { return fail(res, e); }
  return send(res, 404, { error: 'Switchboard does not have that. Reload the page and try again.' });
}
