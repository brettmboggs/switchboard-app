// Files Switchboard keeps (pictures and files in notes, a project's Files) by
// their address on the page, and the same addresses in text going to an agent
// turned into where the file is on this computer, so the agent can open it.
// Used by routes/files.js, routes/sessions.js (messages to a session) and
// sorting.js (a note as text for switchboard_notes).
import { attachmentPath } from './attachments.js';
import { filePath } from './projects.js';

// A kept file by its address: { file, name, project } or throws.
export function keptAt(addr) {
  let m = String(addr || '').match(/^\/api\/projects\/([a-z0-9-]{1,60})\/files\/([^/?]+)$/);
  if (m) { const name = decodeURIComponent(m[2]); return { file: filePath(m[1], name), name, project: m[1] }; }
  m = String(addr || '').match(/^\/api\/files\/([^/?]+)$/);
  if (m) { const id = decodeURIComponent(m[1]); return { file: attachmentPath(id), name: id.slice(14) }; }
  throw new Error('That file is no longer here.');
}

// "[picture a.png: /api/files/…]" becomes "[picture a.png: '/home/…/a.png']".
// An address that is not on this computer is left as it was.
const ADDR = /\/api\/(?:files\/[a-f0-9]{12}--|projects\/[a-z0-9-]{1,60}\/files\/)[^\s\]'"?]+/g;
const quote = (p) => `'${p.replace(/'/g, "'\\''")}'`;
export function keptPaths(text) {
  return String(text || '').replace(ADDR, (a) => { try { return quote(keptAt(a).file); } catch { return a; } });
}
