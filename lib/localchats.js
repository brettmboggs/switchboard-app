// Past Local AI chats (Sessions, Agent: Local AI (Switchboard); lib/engine.js).
// Each chat is a log file bin/localchat.mjs keeps in Switchboard's data folder
// (chats/local). The history is those files, not session records: a record
// can be replaced or swept, a file stays until it is deleted (Nov 13 2026: a
// chat vanished from the history when a new session reused its record).
// An ended chat stays KEEP_DAYS after its last message, then clears itself;
// Reopen carries it on in a new session; Delete and Delete all remove it at
// once. Sessions shows the list only while a Local AI chat is open.
import { existsSync, readFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { db } from './db.js';
import { closeTerm, LOCAL_CHATS } from './terminals.js';

export const KEEP_DAYS = 30;

// The first thing said, as the chat's name.
export function titleFrom(text) {
  for (const line of String(text || '').split('\n')) {
    let r; try { r = JSON.parse(line); } catch { continue; }
    if (r.type !== 'user') continue;
    const c = r.message?.content;
    const t = (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => x.text || '').join(' ') : '').replace(/^\/[^\n]+\.(png|jpe?g|webp|gif)$/gim, '').replace(/\s+/g, ' ').trim();
    if (t) return t.slice(0, 80);
  }
  return null;
}

const files = () => { try { return readdirSync(LOCAL_CHATS).filter((f) => f.endsWith('.jsonl')).map((f) => join(LOCAL_CHATS, f)); } catch { return []; } };
// The sessions open on a chat's file right now.
const openOn = (file) => db.prepare("SELECT id FROM terms WHERE agent = 'engine' AND ended_at IS NULL AND chat = ?").all(file).map((r) => r.id);

// Every chat with something said, newest first. id: the file's name (what Reopen and Delete take).
export function listChats() {
  const out = [];
  for (const file of files()) {
    let text = '', at = 0;
    try { text = readFileSync(file, 'utf8'); at = statSync(file).mtimeMs; } catch { continue; }
    const title = titleFrom(text);
    if (!title) continue;
    out.push({ id: basename(file), title, at: Math.round(at), open: openOn(file).length > 0, messages: text.split('\n').filter(Boolean).length });
  }
  return out.sort((a, b) => b.at - a.at);
}

// Delete one chat (an open one is ended first) or all past ones (never one open right now).
export async function deleteChats({ id, all } = {}) {
  const pick = all ? files().filter((f) => !openOn(f).length) : files().filter((f) => basename(f) === basename(String(id || '')));
  for (const f of pick) {
    for (const t of openOn(f)) await closeTerm(t).catch(() => {});
    db.prepare("DELETE FROM terms WHERE agent = 'engine' AND chat = ?").run(f);
    rmSync(f, { force: true });
  }
  return pick.length;
}

// Ended chats untouched for KEEP_DAYS clear themselves (server.js runs this each hour).
export function sweepChats(now = Date.now()) {
  let n = 0;
  for (const f of files()) {
    if (openOn(f).length) continue;
    let at = 0; try { at = statSync(f).mtimeMs; } catch { continue; }
    if (now - at < KEEP_DAYS * 86400e3) continue;
    db.prepare("DELETE FROM terms WHERE agent = 'engine' AND chat = ?").run(f);
    rmSync(f, { force: true });
    n++;
  }
  return n;
}
export const chatExists = (id) => existsSync(join(LOCAL_CHATS, basename(String(id || ''))));
