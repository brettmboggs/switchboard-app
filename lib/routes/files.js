// Files added to sessions and notes (lib/attachments.js): POST the file itself
// as the body with its name in X-Filename; GET it back by id. Pictures are
// shown inline; anything else is always a download, sandboxed.
// Called by server.js for every request after its host and header checks;
// sends a response when the path is one of these, otherwise does nothing.
import { createReadStream, statSync } from 'node:fs';
import { saveAttachment, attachmentPath, inlineType } from '../attachments.js';
import { send } from '../http.js';

export function sendFile(res, file, name) {
  const type = inlineType(name);
  res.writeHead(200, {
    'Content-Type': type || 'application/octet-stream', 'Content-Length': statSync(file).size, 'Cache-Control': 'private, max-age=86400',
    'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'",
    'Content-Disposition': `${type ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`
  });
  createReadStream(file).pipe(res);
}

export async function route({ req, res, path }) {
  if (req.method === 'POST' && path === '/api/files') {
    let name = 'file';
    try { name = decodeURIComponent(String(req.headers['x-filename'] || 'file')); } catch {}
    try { return send(res, 200, await saveAttachment(req, name)); }
    catch (e) { return send(res, e.status || 400, { error: String(e.message || e) }); }
  }
  const m = path.match(/^\/api\/files\/([^/]+)$/);
  if (req.method === 'GET' && m) {
    let id = '';
    try { id = decodeURIComponent(m[1]); } catch {}
    try { const file = attachmentPath(id); return sendFile(res, file, id.slice(14)); }
    catch (e) { return send(res, 404, { error: String(e.message || e) }); }
  }
}
