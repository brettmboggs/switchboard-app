// Ctrl K's search beyond the notebook: conversations from the last 60 days of
// mail (people, not newsletters) and Teams, the same list Messages on a
// session picks from (lib/bring.js), then older mail from the same kind of
// people, straight from the mail table. Sessions, projects, people and
// Switchboard's own features are on the page already and are searched there
// (public/js/search.js). Nothing leaves the computer: this reads the local
// mail table and what Teams last sent.
import { recentConversations } from './bring.js';
import { db } from './db.js';
import { mailLink } from './gmail.js';
import { parseKey } from './conversation.js';

// Every word must appear somewhere, in any order, ignoring case and accents.
export function matcher(q) {
  const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const words = fold(q).split(/\s+/).filter(Boolean);
  return words.length ? (text) => { const t = fold(text); return words.every((w) => t.includes(w)); } : null;
}

// Newest first. A match on who it is with scores above a match in the subject
// or the last message, so "sam" finds Sam before every mail that mentions him.
export function searchConversations(q, { limit = 8, list = recentConversations() } = {}) {
  const hit = matcher(q);
  if (!hit) return [];
  const out = [];
  for (const t of list) {
    const score = hit(`${t.who} ${t.from}`) ? 2 : hit(`${t.who} ${t.from} ${t.subject} ${t.snippet}`) ? 1 : 0;
    if (!score) continue;
    const k = parseKey(t.key);
    const extra = k?.kind === 'mail' ? { account: k.account, threadId: k.id, link: safeLink(k.account, k.id) } : {};
    out.push({ ...t, ...extra, score });
  }
  return out.sort((a, b) => b.score - a.score || b.date - a.date).slice(0, limit);
}

function safeLink(account, threadId) {
  try { return mailLink(account, threadId); } catch { return null; }
}

// Mail older than the 60 days above: one row per thread, people you have
// written to (or who wrote to you and were answered), newest first. The
// database narrows by the longest word; every word is then checked here.
export function olderConversations(q, { limit = 4, now = Date.now() } = {}) {
  const hit = matcher(q);
  if (!hit) return [];
  const longest = String(q).trim().split(/\s+/).sort((a, b) => b.length - a.length)[0].replace(/[%_\\]/g, '');
  if (longest.length < 2) return [];
  const like = `%${longest}%`;
  const known = new Set(db.prepare('SELECT addr FROM contacts').all().map((c) => String(c.addr).toLowerCase()));
  const rows = db.prepare(`SELECT account, thread_id, from_name, from_addr, to_addrs, subject, snippet, date, from_me, kind FROM mail
    WHERE date <= ? AND bulk = 0 AND thread_id IS NOT NULL AND (kind = 'mail' OR kind LIKE 'voice%')
      AND (subject LIKE ? OR snippet LIKE ? OR from_name LIKE ? OR from_addr LIKE ? OR to_addrs LIKE ?)
    ORDER BY date DESC LIMIT 400`).all(now - 60 * 86400e3, like, like, like, like, like);
  const seen = new Set(), out = [];
  for (const r of rows) {
    const key = `mail:${r.account}:${r.thread_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const them = r.from_me ? String(r.to_addrs || '').split(',')[0].trim() : r.from_addr;
    if (!r.from_me && !known.has(String(them).toLowerCase())) continue;   // people, not senders
    const voice = String(r.kind).startsWith('voice');
    const t = { key, kind: voice ? r.kind : 'mail', who: voice ? 'Text conversation' : (r.from_me ? them : r.from_name || r.from_addr), from: them, subject: r.subject, snippet: (r.from_me ? 'You: ' : '') + (r.snippet || ''), date: r.date, space: 'personal', older: true };
    if (!hit(`${t.who} ${t.from} ${t.subject} ${t.snippet}`)) continue;
    out.push({ ...t, account: r.account, threadId: r.thread_id, link: safeLink(r.account, r.thread_id) });
    if (out.length >= limit) break;
  }
  return out;
}
