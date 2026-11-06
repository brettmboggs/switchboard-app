// "Bring in a message" on a session: the recent conversations it can pick
// from, each in the project the rules (Settings, Projects) put it in. Not just
// what waits in the Inbox: mail written either way in the last 60 days (not
// newsletters or senders never written to), and Teams chats. The page lists the session's project first.
import { db } from './db.js';
import { spaceForAddress, spaceForPhone } from './spaces.js';
import { microsoft } from './microsoft.js';

const DAYS = 60, MAX = 300;
const first = (list) => String(list || '').split(',').map((a) => a.trim()).find(Boolean) || '';

export function recentConversations(now = Date.now()) {
  const rows = db.prepare(`SELECT account, thread_id, from_name, from_addr, to_addrs, subject, snippet, date, from_me, kind
    FROM mail WHERE date > ? AND bulk = 0 AND thread_id IS NOT NULL AND (kind = 'mail' OR kind LIKE 'voice%')
    ORDER BY date DESC LIMIT 4000`).all(now - DAYS * 86400e3);
  // People, not senders: someone written to (contacts), or anyone a rule puts in a project.
  const known = new Set(db.prepare('SELECT addr FROM contacts').all().map((c) => String(c.addr).toLowerCase()));
  const seen = new Set(), out = [];
  for (const r of rows) {
    const key = `mail:${r.account}:${r.thread_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const voice = r.kind.startsWith('voice');
    const them = r.from_me ? first(r.to_addrs) : r.from_addr;
    if (!them) continue;
    const space = voice ? (spaceForPhone(r.from_name, r.from_me ? r.to_addrs : r.from_addr) || 'personal') : spaceForAddress(r.from_me ? r.to_addrs : r.from_addr, r.from_me ? '' : r.to_addrs) || 'personal';
    if (!voice && !r.from_me && space === 'personal' && !known.has(String(them).toLowerCase())) continue;
    out.push({
      key, kind: voice ? r.kind : 'mail', who: voice ? 'Text conversation' : (r.from_me ? them : r.from_name || r.from_addr),
      from: them, subject: r.subject, snippet: (r.from_me ? 'You: ' : '') + (r.snippet || ''), date: r.date,
      space
    });
    if (out.length >= MAX) break;
  }
  const m = microsoft() || {};
  for (const t of [...(m.threads || []), ...(m.recent || [])]) {
    if (seen.has(t.key)) continue;
    seen.add(t.key);
    out.push({ key: t.key, kind: t.kind, who: t.who, from: t.from, subject: t.subject, snippet: t.snippet, date: t.date, space: t.space || 'personal' });
  }
  return out.sort((a, b) => b.date - a.date);
}
