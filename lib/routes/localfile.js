// Files a session's agent names in its chat: which are real (so the page makes
// them links), what one holds (the reader on the page), its picture, and Open
// or Show in folder on this computer. All POST, so the header and host checks
// in server.js guard them like every other change; a name is looked for in the
// session's own folder first (lib/localfile.js decides what may be shown).
import { createReadStream } from 'node:fs';
import { extname } from 'node:path';
import { termRow } from '../chatview.js';
import { check, describe, locate, IMAGES, IMAGE_MAX } from '../localfile.js';
import { openPath, revealPath, opensAsProgram } from '../desktop.js';
import { askRemote } from '../relay.js';
import { send, readJson } from '../http.js';
import { friendlyError } from '../friendly.js';

export async function route({ req, res, path }) {
  // A session on another computer: that computer looks, and sends the answer back.
  const rm = path.match(/^\/api\/remote\/([0-9a-f]{8,64})\/([\w-]+)\/files\/(check|view|raw|open)$/);
  if (rm && req.method === 'POST') {
    if (rm[3] === 'open') return send(res, 400, { error: 'This file is on the other computer. Open it there, or Copy where it is.' });
    const body = await readJson(req).catch(() => ({}));
    try {
      const r = await askRemote(rm[1], rm[2], { what: 'files', op: rm[3], path: body.path, paths: body.paths });
      if (r.status) return send(res, r.status, { error: r.error });
      if (rm[3] !== 'raw') return send(res, 200, rm[3] === 'view' ? { ...r, remote: true } : r);
      const buf = Buffer.from(String(r.b64 || ''), 'base64');
      const type = Object.values(IMAGES).includes(r.type) ? r.type : 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': buf.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'" });
      return res.end(buf);
    } catch (err) { return send(res, 502, { error: friendlyError(err, 'the other computer') }); }
  }
  const m = path.match(/^\/api\/terms\/([\w-]+)\/files\/(check|view|raw|open)$/);
  if (!m || req.method !== 'POST') return;
  const t = termRow(m[1]);
  if (!t) return send(res, 404, { error: 'That session has ended, so its files can no longer be found from here.' });
  const body = await readJson(req).catch(() => ({}));
  const cwd = t.cwd || null;
  if (m[2] === 'check') return send(res, 200, { ok: check(body.paths, cwd) });
  if (m[2] === 'view') { const d = describe(body.path, cwd); return send(res, d.error ? 404 : 200, d); }
  const f = locate(body.path, cwd);
  if (f.error) return send(res, 404, f);
  if (m[2] === 'raw') {
    const type = IMAGES[extname(f.path).toLowerCase()];
    if (!type || f.dir || f.size > IMAGE_MAX) return send(res, 415, { error: 'Only pictures are shown this way.' });
    // A picture only: nothing in it can run, even an SVG opened on its own.
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': f.size, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'" });
    return createReadStream(f.path).pipe(res);
  }
  if (body.how === 'reveal') return send(res, 200, { ok: revealPath(f.path, f.dir) });
  if (!f.dir && opensAsProgram(f.path)) return send(res, 400, { error: 'This is a program or script, and opening it would run it. Show in folder instead.' });
  const ok = f.dir ? revealPath(f.path, true) : openPath(f.path);
  return send(res, ok ? 200 : 500, ok ? { ok } : { error: 'This computer has no app set to open that kind of file. Show in folder, then open it from there.' });
}
