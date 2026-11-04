// The slash commands a session's folder offers: Claude Code skills
// (.claude/skills/<name>/SKILL.md in the project and in the person's home) and
// the older commands (.claude/commands/<name>.md). The message bar lists them
// when a message starts with "/", with each one's description from its YAML
// front matter, so a person sees what the project can do without opening it.
// Read only, cheap on purpose: the first 4 KB of each file, at most 200
// entries, cached for 30 seconds per folder, and never through a symlink that
// points outside its folder (a link in a cloned repo must not read elsewhere).
import { readdirSync, openSync, readSync, closeSync, lstatSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';

const TTL = 30e3, CAP = 200, HEAD = 4096;
const cache = new Map();   // cwd -> { at, list }

function head(file) {
  const fd = openSync(file, 'r');
  try { const buf = Buffer.alloc(HEAD); const n = readSync(fd, buf, 0, HEAD, 0); return buf.toString('utf8', 0, n); }
  finally { closeSync(fd); }
}
// Inside the folder, even through a symlink; false for anything that leads out of it.
function within(path, root) {
  try {
    const real = realpathSync(path), base = realpathSync(root);
    return real === base || real.startsWith(base + sep);
  } catch { return false; }
}
const isMd = (name) => /^[\w.-]+\.md$/i.test(name);
const clean = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

// name and description from YAML front matter ("---" ... "---"); the body's
// first line stands in for a missing description.
export function frontMatter(text) {
  const out = { name: '', description: '' };
  const m = String(text).match(/^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  let body = String(text);
  if (m) {
    body = text.slice(m[0].length);
    const lines = m[1].split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const kv = lines[i].match(/^(name|description)\s*:\s*(.*)$/);
      if (!kv) continue;
      let v = kv[2].trim();
      if (v === '>' || v === '|' || v === '>-' || v === '|-' || v === '') {   // a block or a wrapped value: the indented lines under it
        const parts = [];
        while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) parts.push(lines[++i].trim());
        v = parts.join(' ');
      }
      v = v.replace(/^(["'])([\s\S]*)\1$/, '$2');
      out[kv[1]] = v;
    }
  }
  if (!out.description) out.description = body.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !/^#/.test(l) && !/^---/.test(l)) || '';
  return out;
}

function readSkills(root, where, list) {
  const dir = join(root, '.claude', 'skills');
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const d of entries) {
    if (list.length >= CAP) return;
    if (!/^[\w.-]+$/.test(d.name) || d.name.startsWith('.')) continue;
    const folder = join(dir, d.name), file = join(folder, 'SKILL.md');
    try {
      if (!(d.isDirectory() || (d.isSymbolicLink() && within(folder, dir)))) continue;
      if (lstatSync(file).isSymbolicLink() && !within(file, dir)) continue;
      const fm = frontMatter(head(file));
      list.push({ name: clean(fm.name, 60) || d.name, description: clean(fm.description, 160), where });
    } catch { /* no SKILL.md, or unreadable: not a skill */ }
  }
}
function readCommands(root, where, list) {
  const dir = join(root, '.claude', 'commands');
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const d of entries) {
    if (list.length >= CAP) return;
    if (!isMd(d.name) || !(d.isFile() || (d.isSymbolicLink() && within(join(dir, d.name), dir)))) continue;
    try {
      const fm = frontMatter(head(join(dir, d.name)));
      list.push({ name: d.name.replace(/\.md$/i, ''), description: clean(fm.description, 160), where });
    } catch { /* unreadable: skip */ }
  }
}

// [{ name, description, where: 'project' | 'personal' }], the project's first.
export function slashCommands(cwd, { home = homedir(), now = Date.now() } = {}) {
  const key = cwd ? resolve(cwd) : '';
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL) return hit.list;
  const list = [];
  if (key) { readSkills(key, 'project', list); readCommands(key, 'project', list); }
  if (home && resolve(home) !== key) readSkills(home, 'personal', list);
  const seen = new Set();
  const out = list.filter((c) => { const k = c.where + '/' + c.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, CAP);
  cache.set(key, { at: now, list: out });
  if (cache.size > 50) for (const [k, v] of cache) if (now - v.at >= TTL) cache.delete(k);
  return out;
}
export const forgetSlash = () => cache.clear();
