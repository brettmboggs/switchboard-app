// Files an agent names in a session's chat ("docs/PITCH.md", a screenshot it
// took, "lib/search.js:12"): which of them are real, and what one holds, so the
// page can make them clickable and show them. Read only; the page shows the
// file and offers Open (its own app) or Show in folder (lib/desktop.js).
//
// A name is looked for in the session's folder first, then as written (an
// absolute path or ~/...). Only files in your home folder, the temp folder or
// the session's folder are shown, and never keys or secrets: ~/.ssh, ~/.gnupg,
// Switchboard's own settings and data, .env files, .pem and similar.
import { statSync, realpathSync, openSync, readSync, closeSync, readFileSync } from 'node:fs';
import { resolve, isAbsolute, basename, dirname, extname, sep, join } from 'node:path';
import { homedir, tmpdir } from 'node:os';

export const TEXT_MAX = 1024 * 1024;          // a text file shown up to this; longer ones are cut
export const IMAGE_MAX = 30 * 1024 * 1024;    // a picture shown up to this
export const IMAGES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.avif': 'image/avif' };
const MARKDOWN = new Set(['.md', '.markdown', '.mdx']);

const DATA = process.env.SWITCHBOARD_DATA || join(homedir(), '.local/share/switchboard');
const PRIVATE = [
  /[\\/]\.ssh([\\/]|$)/, /[\\/]\.gnupg([\\/]|$)/, /[\\/]\.aws([\\/]|$)/, /[\\/]\.config[\\/]switchboard([\\/]|$)/,
  /[\\/]\.env(\.[\w-]+)?$/, /\.(pem|key|p12|pfx|kdbx|keystore|jks)$/i, /[\\/]\.netrc$/, /[\\/]\.git-credentials$/,
  /[\\/]\.npmrc$/, /[\\/]id_(rsa|ed25519|ecdsa|dsa)(\.pub)?$/, /[\\/]\.claude[\\/]\.credentials\.json$/
];
const inside = (p, root) => !!root && (p === root || p.startsWith(root.endsWith(sep) ? root : root + sep));
const real = (p) => { try { return realpathSync(p); } catch { return null; } };

// "lib/search.js:12", "lib/search.js:12:5" or "lib/search.js#L12": the file and the line.
export function splitLine(spec) {
  const s = String(spec || '').trim().replace(/^["'`]|["'`]$/g, '');
  const m = s.match(/^(.*?)(?::(\d+)(?::\d+)?|#L(\d+))$/);
  if (m && m[1] && !/^[a-z]$/i.test(m[1])) return { file: m[1], line: Number(m[2] || m[3]) };
  return { file: s, line: null };
}

// Where a name in the chat points: { path, line, dir } for a file or folder
// that may be shown, or { error } in plain words.
export function locate(spec, cwd) {
  const { file, line } = splitLine(spec);
  if (!file || file.length > 1024 || /[\0\n]/.test(file)) return { error: 'That is not a file name.' };
  const expanded = file === '~' || file.startsWith('~/') ? join(homedir(), file.slice(2)) : file;
  const tries = isAbsolute(expanded) ? [expanded] : [cwd && resolve(cwd, expanded), resolve(homedir(), expanded)].filter(Boolean);
  let path = null;
  for (const t of tries) { path = real(t); if (path) break; }
  if (!path) {
    if (/claude-\d+[\\/]/.test(file)) return { error: 'Claude kept this in its own private scratch folder, which other apps cannot see. Ask it to save the file in the project, or to send it to you.' };
    return { error: `There is no ${basename(file)} there any more. It may have been moved or deleted.` };
  }
  const roots = [real(homedir()), real(tmpdir()), cwd && real(cwd)];
  if (!roots.some((r) => inside(path, r))) return { error: 'Switchboard only opens files in your home folder or the session\'s folder.' };
  if (PRIVATE.some((re) => re.test(path)) || inside(path, real(DATA))) return { error: 'That file holds keys or passwords, so Switchboard does not show it.' };
  let st;
  try { st = statSync(path); } catch { return { error: 'Switchboard could not read that file.' }; }
  return { path, line, dir: st.isDirectory(), size: st.size, mtime: st.mtimeMs };
}

// Text, if the start of the file has no zero bytes (what most tools check).
function looksText(path) {
  const buf = Buffer.alloc(8192);
  let n = 0, fd;
  try { fd = openSync(path, 'r'); n = readSync(fd, buf, 0, buf.length, 0); } catch { return false; } finally { if (fd !== undefined) closeSync(fd); }
  return !buf.subarray(0, n).includes(0);
}
function readHead(path, max) {
  const buf = Buffer.alloc(max);
  const fd = openSync(path, 'r');
  try { const n = readSync(fd, buf, 0, max, 0); return buf.subarray(0, n).toString('utf8'); } finally { closeSync(fd); }
}

// What the page needs to show one file: its kind, and for text and markdown the text.
export function describe(spec, cwd) {
  const f = locate(spec, cwd);
  if (f.error) return f;
  const ext = extname(f.path).toLowerCase();
  const base = { name: basename(f.path), path: f.path, folder: dirname(f.path), line: f.line, size: f.size, mtime: f.mtime };
  if (f.dir) return { ...base, kind: 'folder' };
  if (IMAGES[ext]) return { ...base, kind: f.size <= IMAGE_MAX ? 'image' : 'other' };
  if (!looksText(f.path)) return { ...base, kind: 'other' };
  return { ...base, kind: MARKDOWN.has(ext) ? 'markdown' : 'text', text: readHead(f.path, Math.min(f.size, TEXT_MAX)), cut: f.size > TEXT_MAX };
}

// A file Switchboard keeps itself (a project's files, a file added to a note),
// in its data folder, so locate()'s rule against showing that folder does not
// apply: the caller has already found the file by its own id. `name` is the
// name it was added under (an attachment's file name carries an id in front).
export function describeKept(path, name) {
  const st = statSync(path), ext = extname(name).toLowerCase();
  const base = { name, path, folder: dirname(path), size: st.size, mtime: st.mtimeMs, kept: true };
  if (IMAGES[ext] && ext !== '.svg' && ext !== '.ico') return { ...base, kind: st.size <= IMAGE_MAX ? 'image' : 'other' };
  if (ext === '.pdf') return { ...base, kind: 'pdf' };
  if (!looksText(path)) return { ...base, kind: 'other' };
  return { ...base, kind: MARKDOWN.has(ext) ? 'markdown' : 'text', text: readHead(path, Math.min(st.size, TEXT_MAX)), cut: st.size > TEXT_MAX };
}

// Which of these names are files or folders the page may link: true or false each.
export function check(specs, cwd) {
  return (Array.isArray(specs) ? specs : []).slice(0, 200).map((s) => !locate(s, cwd).error);
}

// The same, asked by another computer showing one of this computer's sessions
// (lib/relay.js). One relay message carries the answer, so text is cut shorter
// and a picture travels as base64 only up to REMOTE_IMAGE_MAX. Nothing is
// opened here for them: a file on this computer opens on this computer.
export const REMOTE_TEXT_MAX = 400 * 1024, REMOTE_IMAGE_MAX = 450 * 1024;
export function remoteFiles(m, cwd) {
  if (m.op === 'check') return { ok: check(m.paths, cwd) };
  if (m.op === 'view') {
    const d = describe(m.path, cwd);
    if (d.error) return { status: 404, error: d.error };
    if (d.text && d.text.length > REMOTE_TEXT_MAX) return { ...d, text: d.text.slice(0, REMOTE_TEXT_MAX), cut: true };
    return d;
  }
  if (m.op === 'raw') {
    const f = locate(m.path, cwd);
    const type = !f.error && !f.dir && IMAGES[extname(f.path).toLowerCase()];
    if (f.error) return { status: 404, error: f.error };
    if (!type) return { status: 415, error: 'Only pictures are shown this way.' };
    if (f.size > REMOTE_IMAGE_MAX) return { status: 413, error: 'This picture is too big to show from the other computer. Open it there.' };
    return { type, b64: readFileSync(f.path).toString('base64') };
  }
  return { status: 400, error: 'Unknown question.' };
}
