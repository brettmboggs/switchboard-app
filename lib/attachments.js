// Files added to Switchboard: dropped or pasted into a session (chat or
// terminal) or a note. Any type, up to 1 GB, written straight to disk as it
// arrives (never held in memory). Each is kept under its own id in the data
// folder; the page shows images inline and offers everything else as a
// download, so a dropped .html or .svg can never run as the page.
// Project files (lib/projects.js) use the same streaming.
import { createWriteStream, existsSync, mkdirSync, statSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DATA_DIR } from './db.js';

export const ATTACH_MAX = 1024 * 1024 * 1024;   // one file, 1 GB
const dir = () => join(DATA_DIR, 'attachments');
export const ID = /^[a-f0-9]{12}--[^/\\]{1,140}$/;

export function safeName(name) {
  const base = String(name || '').split(/[\\/]/).pop().replace(/[\u0000-\u001f<>:"|?*]/g, '').replace(/^\.+/, '').trim().slice(0, 140);
  return base || 'file';
}

// What a file may be shown as inside the page. Only plain picture formats:
// SVG can carry script, so it is a download like everything else.
const INLINE = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp' };
export const inlineType = (name) => INLINE[String(name).toLowerCase().split('.').pop()] || null;
export const isImage = (name) => !!inlineType(name);

// The request body into a file, stopping (and removing it) past `max`.
export async function streamToFile(req, file, max) {
  if (Number(req.headers['content-length'] || 0) > max) throw Object.assign(new Error(tooBig(max)), { status: 413 });
  const out = createWriteStream(file, { mode: 0o600 });
  let size = 0;
  try {
    for await (const c of req) {
      size += c.length;
      if (size > max) throw Object.assign(new Error(tooBig(max)), { status: 413 });
      if (!out.write(c)) await new Promise((r) => out.once('drain', r));
    }
    await new Promise((ok, bad) => out.end((e) => e ? bad(e) : ok()));
    return size;
  } catch (e) {
    out.destroy();
    try { unlinkSync(file); } catch {}
    throw e;
  }
}
const tooBig = (max) => `That file is over ${max >= 1024 ** 3 ? max / 1024 ** 3 + ' GB' : Math.round(max / 1024 ** 2) + ' MB'}. Share a link to it instead, or make it smaller.`;

export async function saveAttachment(req, name) {
  mkdirSync(dir(), { recursive: true, mode: 0o700 });
  const id = `${randomBytes(6).toString('hex')}--${safeName(name)}`;
  const file = join(dir(), id);
  const size = await streamToFile(req, file, ATTACH_MAX);
  return { id, name: safeName(name), size, path: file, image: isImage(name) };
}

export function attachmentPath(id) {
  if (!ID.test(String(id))) throw new Error('No such file.');
  const p = join(dir(), id);
  if (!existsSync(p) || !statSync(p).isFile()) throw new Error('That file is not on this computer. Files added on another computer stay there.');
  return p;
}

export const attachmentCount = () => { try { return readdirSync(dir()).length; } catch { return 0; } };
