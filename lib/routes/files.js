// Files added to sessions and notes (lib/attachments.js): POST the file itself
// as the body with its name in X-Filename; GET it back by id. Pictures are
// shown inline; a PDF too when the reader asks (?view); anything else is
// always a download, sandboxed. POST …/view says what the reader shows, and
// …/open opens it in its own app or shows it in its folder. A project's files
// (routes/projects.js) use the same three.
// Called by server.js for every request after its host and header checks;
// sends a response when the path is one of these, otherwise does nothing.
import { createReadStream, statSync } from 'node:fs';
import { saveAttachment, attachmentPath, inlineType, copyToAttachment } from '../attachments.js';
import { addFileCopy, removeFile } from '../projects.js';
import { getPage, savePage } from '../pages.js';
import { describeKept } from '../localfile.js';
import { keptAt } from '../keptpaths.js';
import { openPath, revealPath, opensAsProgram } from '../desktop.js';
import { send, readJson } from '../http.js';
import { friendlyError } from '../friendly.js';

// download: always a download (the reader's Download button). view: a PDF is
// shown too, by the browser's own PDF viewer, which a sandbox would block; a
// PDF cannot reach the page around it.
export function sendFile(res, file, name, { download = false, view = false } = {}) {
  const pdf = view && !download && /\.pdf$/i.test(name);
  const type = download ? null : pdf ? 'application/pdf' : inlineType(name);
  res.writeHead(200, {
    'Content-Type': type || 'application/octet-stream', 'Content-Length': statSync(file).size, 'Cache-Control': 'private, max-age=86400',
    'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': pdf ? "default-src 'none'; frame-ancestors 'self'" : "sandbox; default-src 'none'",
    'Content-Disposition': `${type ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`
  });
  createReadStream(file).pipe(res);
}

// The reader's view and Open / Show in folder, for a file Switchboard keeps.
export async function keptFile(req, res, file, name, op) {
  if (op === 'view') return send(res, 200, describeKept(file, name));
  const { how } = await readJson(req, 8 * 1024).catch(() => ({}));
  if (how === 'reveal') return send(res, 200, { ok: revealPath(file) });
  if (opensAsProgram(name)) return send(res, 400, { error: 'This is a program or script, and opening it would run it. Download it or Show in folder instead.' });
  return openPath(file) ? send(res, 200, { ok: true }) : send(res, 500, { error: 'This computer has no app set to open that kind of file. Download it, or Show in folder and open it from there.' });
}

const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Put a kept file somewhere else in Switchboard: { from, to: { project } | { page }, move }.
// Always a copy; move takes it out of the project it came from once the copy is made.
// A file in a note stays in the note (taking it out is editing the note, done there).
export function putKept({ from, to = {}, move = false }) {
  const src = keptAt(from);
  let where;
  if (to.project) {
    if (move && src.project === to.project) throw new Error('It is already in that project.');
    const name = addFileCopy(String(to.project), src.file, src.name);
    where = { project: to.project, name };
  } else if (to.page) {
    const p = getPage(String(to.page));
    if (!p) throw new Error('That note is gone.');
    const a = copyToAttachment(src.file, src.name);
    const href = '/api/files/' + encodeURIComponent(a.id);
    const html = a.image ? `<p><img src="${escHtml(href)}" alt="${escHtml(a.name)}"></p>` : `<p><a class="file-link" href="${escHtml(href)}">${escHtml(a.name)}</a></p>`;
    savePage(p.uid, { body: p.body + html });
    where = { page: p.uid, title: p.title || 'Untitled' };
  } else throw new Error('Pick where it goes.');
  if (move && src.project) removeFile(src.project, src.name);
  return where;
}

export async function route({ req, res, path, url, changed }) {
  if (req.method === 'POST' && path === '/api/files/put') {
    try { const r = putKept(await readJson(req, 8 * 1024)); changed?.(); return send(res, 200, r); }
    catch (e) { return send(res, 400, { error: friendlyError(e, 'Switchboard') }); }
  }
  if (req.method === 'POST' && path === '/api/files') {
    let name = 'file';
    try { name = decodeURIComponent(String(req.headers['x-filename'] || 'file')); } catch {}
    try { return send(res, 200, await saveAttachment(req, name)); }
    catch (e) { return send(res, e.status || 400, { error: friendlyError(e, 'Switchboard') }); }
  }
  const m = path.match(/^\/api\/files\/([^/]+?)(?:\/(view|open))?$/);
  if (m && (m[2] ? req.method === 'POST' : req.method === 'GET')) {
    let id = '';
    try { id = decodeURIComponent(m[1]); } catch {}
    let file;
    try { file = attachmentPath(id); } catch (e) { return send(res, 404, { error: 'That file is no longer here.' }); }
    if (m[2]) return keptFile(req, res, file, id.slice(14), m[2]);
    return sendFile(res, file, id.slice(14), { download: url.searchParams.has('download'), view: url.searchParams.has('view') });
  }
}
