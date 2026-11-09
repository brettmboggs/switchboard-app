// A project's own page: its profile (about, people, links) and its files.
// Called by server.js for every request after its host and header checks;
// sends a response when the path is one of these, otherwise does nothing.
import { sendFile, keptFile } from './files.js';
import { profileOf, saveProfile, foundPeople, listFiles, addFileFrom, filePath, removeFile } from '../projects.js';
import { send, readJson } from '../http.js';
import { friendlyError } from '../friendly.js';

export async function route({ req, res, path, url, changed }) {
  const m = path.match(/^\/api\/projects\/([a-z0-9-]{1,60})(?:\/(profile|files)(?:\/([^/]+))?(\/delete|\/view|\/open)?)?$/);
  if (!m) return;
  const [, id, part, rawName, del] = m;
  let name = null;
  try { name = rawName ? decodeURIComponent(rawName) : null; } catch { return send(res, 400, { error: 'No such file.' }); }
  try {
    if (req.method === 'GET' && !part) return send(res, 200, { profile: profileOf(id), files: listFiles(id), found: foundPeople(id) });
    if (req.method === 'GET' && part === 'files' && name) {
      // Pictures can show in the page; anything else is always a download, so a
      // dropped .html or .svg cannot run as the page (routes/files.js).
      return sendFile(res, filePath(id, name), name, { download: url.searchParams.has('download'), view: url.searchParams.has('view') });
    }
    if (req.method !== 'POST') return;
    if (part === 'files' && name && (del === '/view' || del === '/open')) return keptFile(req, res, filePath(id, name), name, del.slice(1));
    if (part === 'profile') { const p = saveProfile(id, await readJson(req, 200 * 1024)); changed(); return send(res, 200, { profile: p, found: foundPeople(id) }); }
    if (part === 'files' && name && del === '/delete') { removeFile(id, name); return send(res, 200, { files: listFiles(id) }); }
    if (part === 'files' && !name) {
      // The file itself is the body, written to disk as it arrives; its name comes in a header.
      let fname = 'file';
      try { fname = decodeURIComponent(String(req.headers['x-filename'] || 'file')); } catch {}
      let saved;
      try { saved = await addFileFrom(req, id, fname); } catch (e) { return send(res, e.status || 400, { error: friendlyError(e, 'Switchboard') }); }
      return send(res, 200, { name: saved, files: listFiles(id) });
    }
  } catch (e) { return send(res, 400, { error: friendlyError(e, 'Switchboard') }); }
}
