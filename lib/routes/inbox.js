// The Inbox's conversation view: the newest messages of one open conversation.
// Called by server.js for every request after its host and header checks;
// sends a response when the path is one of these, otherwise does nothing.
import { conversation, forget } from '../conversation.js';
import { send, readJson } from '../http.js';
import { hostedBytes, reactChat, outlookFiles, outlookFile, okOutlookId } from '../microsoft.js';
import { threadFiles, mailFile, SHOWABLE } from '../mailfiles.js';
import { sendFile } from '../http.js';
import { friendlyError } from '../friendly.js';

// Teams pictures already fetched, kept in memory a while (a chat is redrawn every few seconds).
const pics = new Map();

// Who a conversation's key belongs to, for an error in plain words.
const whoFor = (key) => ({ teams: 'Teams', outlook: 'Outlook' })[String(key || '').split(':')[0]] || 'your mail';

export async function route({ req, res, path, url }) {
  // A picture in a Teams message: Graph only gives it to this sign-in, so it comes through here.
  if (req.method === 'GET' && path === '/api/teams/picture') {
    const u = url.searchParams.get('u') || '';
    try {
      let hit = pics.get(u);
      if (!hit) {
        hit = await hostedBytes(u);
        pics.set(u, hit);
        let total = 0; for (const v of pics.values()) total += v.buf.length;
        while (pics.size > 1 && (pics.size > 200 || total > 80e6)) { const [k, v] = pics.entries().next().value; pics.delete(k); total -= v.buf.length; }
      }
      res.writeHead(200, { 'Content-Type': hit.type, 'Content-Length': hit.buf.length, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" });
      return res.end(hit.buf);
    } catch (e) { return send(res, e.status || 502, { error: friendlyError(e, 'Teams') }); }
  }
  // Files in an email conversation (and Google Voice texts): ?key=mail:<account>:<thread>.
  if (req.method === 'GET' && path === '/api/mail/files') {
    const [kind, account, ...rest] = String(url.searchParams.get('key') || '').split(':');
    if (kind !== 'mail' || !account || !rest.length) return send(res, 400, { error: 'Pick an email conversation.' });
    try { return send(res, 200, await threadFiles(account, rest.join(':'))); }
    catch (e) { return send(res, e.status || 502, { error: friendlyError(e, 'your mail') }); }
  }
  // One file from an email: ?a=<account>&u=<uid>&p=<part>, &dl=1 to save it.
  if (req.method === 'GET' && path === '/api/mail/file') {
    try {
      const f = await mailFile(url.searchParams.get('a') || '', url.searchParams.get('u') || '', url.searchParams.get('p') || '');
      return sendFile(res, f, url.searchParams.get('dl') === '1');
    } catch (e) { return send(res, e.status || 502, { error: friendlyError(e, 'your mail') }); }
  }
  // Files on Outlook messages: ?ids=<id>,<id> (those the conversation marked hasFiles).
  if (req.method === 'GET' && path === '/api/outlook/files') {
    const ids = String(url.searchParams.get('ids') || '').split(',').filter(okOutlookId).slice(0, 20);
    const out = {};
    try {
      for (const id of ids) {
        const list = await outlookFiles(id);
        if (list.length) out[id] = list.filter((f) => !(f.inline && f.type.startsWith('image/') && f.size < 3072)).map((f) => {
          const u = `/api/outlook/file?m=${encodeURIComponent(id)}&f=${encodeURIComponent(f.id)}`;
          return { name: f.name, type: f.type, size: f.size, picture: SHOWABLE.has(f.type), url: u, download: u + '&dl=1' };
        });
      }
      return send(res, 200, out);
    } catch (e) { return send(res, e.status || 502, { error: friendlyError(e, 'Outlook') }); }
  }
  if (req.method === 'GET' && path === '/api/outlook/file') {
    const m = url.searchParams.get('m') || '', f = url.searchParams.get('f') || '';
    try {
      const k = `outlook|${m}|${f}`;
      let hit = pics.get(k);
      if (!hit) {
        // Its type and name as Microsoft lists them for that message, never from the address (review L1).
        const meta = (await outlookFiles(m)).find((x) => x.id === f);
        if (!meta) return send(res, 404, { error: 'That file is not on that message any more.' });
        const type = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(meta.type) ? meta.type : 'application/octet-stream';
        hit = { buf: await outlookFile(m, f), type, name: meta.name || 'file', picture: SHOWABLE.has(type) };
        pics.set(k, hit);
      }
      return sendFile(res, hit, url.searchParams.get('dl') === '1');
    } catch (e) { return send(res, e.status || 502, { error: friendlyError(e, 'Outlook') }); }
  }
  // An emoji reaction on a Teams message: { key: "teams:<chat>", id, emoji, on }.
  if (req.method === 'POST' && path === '/api/teams/react') {
    const b = await readJson(req);
    const [kind, ...rest] = String(b.key || '').split(':');
    const emoji = String(b.emoji || '');
    if (kind !== 'teams' || !b.id || !emoji || emoji.length > 16) return send(res, 400, { error: 'Pick a message and an emoji.' });
    try { await reactChat(rest.join(':'), String(b.id), emoji, b.on !== false); forget(b.key); return send(res, 200, { ok: true }); }
    catch (e) { return send(res, 502, { error: friendlyError(e, 'Teams') }); }
  }
  if (req.method !== 'GET' || path !== '/api/conversation') return;
  try {
    return send(res, 200, await conversation(url.searchParams.get('key') || '', url.searchParams.get('limit')));
  } catch (e) {
    return send(res, e.status || 502, { error: friendlyError(e, whoFor(url.searchParams.get('key'))) });
  }
}
