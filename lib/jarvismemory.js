// Jarvis remembers, without filling the model up. Three parts:
//  - The card: who the person is and what lasts ("my son is Sam", "the gate
//    code is 4411"), at most CARD_MAX characters (about 400 tokens, 5% of the
//    8k the model gets), put in front of every question. "Remember that…" adds
//    to it, "forget…" takes out; Settings shows it, to edit by hand.
//  - The log: every exchange, kept 90 days and searched (SQLite full-text,
//    nothing extra installed) only when Jarvis needs it ("what did I say about
//    the bank?"); only the few matching lines go to the model.
//  - The nightly tidy: once a day, when Jarvis has been quiet a while, the
//    local model folds the day's exchanges into the card (new lasting facts in,
//    stale ones out, still under the cap). Every version is kept, so Undo in
//    Settings puts the last one back.
// All of it stays in Switchboard's database on this computer.
import { db, getSetting, setSetting } from './db.js';

db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS jarvis_log USING fts5(text, role UNINDEXED, at UNINDEXED)`);
db.exec(`CREATE TABLE IF NOT EXISTS jarvis_cards (at INTEGER PRIMARY KEY, card TEXT NOT NULL, why TEXT NOT NULL)`);
export const CARD_MAX = 1600;
const KEEP_LOG = 90 * 86400e3, KEEP_CARDS = 30;
const oneLine = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

// ---- the card: lines of plain facts
export function card() { return String(getSetting('jvCard', '') || ''); }
function keep(text, why) {
  const prev = card();
  if (prev === text) return text;
  db.prepare('INSERT OR REPLACE INTO jarvis_cards (at, card, why) VALUES (?, ?, ?)').run(Date.now(), prev, why);   // what it was, for Undo
  db.prepare('DELETE FROM jarvis_cards WHERE at NOT IN (SELECT at FROM jarvis_cards ORDER BY at DESC LIMIT ?)').run(KEEP_CARDS);
  setSetting('jvCard', text);
  return text;
}
// Facts are lines; a new one that says the same as an old one replaces it.
export function remember(fact) {
  const f = oneLine(fact, 200).replace(/^(that|to)\s+/i, '');
  if (f.length < 3) return { ok: false, say: 'Tell me what to remember.' };
  const lines = card().split('\n').filter(Boolean);
  const key = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(' ').slice(0, 4).join(' ');
  const rest = lines.filter((l) => key(l) !== key(f));
  const next = [...rest, f].join('\n');
  if (next.length > CARD_MAX) return { ok: false, say: 'My notes about you are full. Ask me to forget something, or trim them in Settings, General, What Jarvis knows.' };
  keep(next, 'remembered');
  return { ok: true, say: `I'll remember that ${f.replace(/\.$/, '')}.` };
}
export function forget(what) {
  const w = oneLine(what, 120).toLowerCase().replace(/^(that|about)\s+/, '');
  const words = w.split(/\s+/).filter((x) => x.length > 2);
  const lines = card().split('\n').filter(Boolean);
  const hit = lines.filter((l) => words.length && words.every((x) => l.toLowerCase().includes(x)));
  if (!hit.length) return { ok: false, say: `I had nothing noted about ${w}.` };
  keep(lines.filter((l) => !hit.includes(l)).join('\n'), 'forgot');
  return { ok: true, say: hit.length === 1 ? `Forgotten: ${hit[0].replace(/\.$/, '')}.` : `Forgotten ${hit.length} notes about ${w}.` };
}
export function setCard(text) { return keep(String(text || '').split('\n').map((l) => oneLine(l, 200)).filter(Boolean).join('\n').slice(0, CARD_MAX), 'edited'); }
export function undoCard() {
  const last = db.prepare('SELECT at, card FROM jarvis_cards ORDER BY at DESC LIMIT 1').get();
  if (!last) return null;
  db.prepare('DELETE FROM jarvis_cards WHERE at = ?').run(last.at);
  setSetting('jvCard', last.card);
  return last.card;
}
export function cardState() {
  const last = db.prepare('SELECT at, why FROM jarvis_cards ORDER BY at DESC LIMIT 1').get();
  return { card: card(), max: CARD_MAX, canUndo: !!last, lastChange: last ? { at: last.at, why: last.why } : null, tidiedAt: getSetting('jvTidiedAt', null) };
}

// ---- the log
export function logTurn(role, text, at = Date.now()) {
  const t = oneLine(text, 1000);
  if (!t) return;
  db.prepare('INSERT INTO jarvis_log (text, role, at) VALUES (?, ?, ?)').run(t, role, at);
}
export function pruneLog(now = Date.now()) { db.prepare('DELETE FROM jarvis_log WHERE CAST(at AS INTEGER) < ?').run(now - KEEP_LOG); }
// The few past lines that match, newest first among the best, with their day.
export function recall(query, n = 6) {
  const words = String(query || '').toLowerCase().match(/[a-z0-9]{3,}/g) || [];
  const stop = new Set(['the', 'and', 'what', 'did', 'say', 'about', 'that', 'this', 'you', 'was', 'for', 'with', 'when', 'have']);
  const q = [...new Set(words.filter((w) => !stop.has(w)))].map((w) => `"${w}"*`).join(' OR ');
  if (!q) return [];
  return db.prepare('SELECT text, role, CAST(at AS INTEGER) AS at FROM jarvis_log WHERE jarvis_log MATCH ? ORDER BY bm25(jarvis_log) LIMIT ?').all(q, n)
    .map((r) => ({ text: r.text, role: r.role, at: r.at }));
}
export function logSince(at) { return db.prepare('SELECT text, role, CAST(at AS INTEGER) AS at FROM jarvis_log WHERE CAST(at AS INTEGER) > ? ORDER BY CAST(at AS INTEGER)').all(at); }

// ---- the nightly tidy. ask(messages) is the model call (lib/jarvis.js gives it).
export const TIDY_PROMPT = (cardNow, lines) => `You keep a short card of lasting facts about the person you assist: who they are, people and places in their life, preferences, standing arrangements. Here is the card now, one fact per line:
${cardNow || '(empty)'}

Here is what was said with them since the last tidy:
${lines}

Write the card again: keep what still holds, add any new lasting fact from the conversation (not passing requests or one-off questions), drop what is clearly out of date, and merge repeats. One short fact per line, plain words, at most ${CARD_MAX} characters in all. Reply with only the card.`;
export async function tidy(askModel, now = Date.now()) {
  const since = Number(getSetting('jvTidiedAt', 0)) || now - 7 * 86400e3;
  const turns = logSince(since);
  if (!turns.length) { setSetting('jvTidiedAt', now); return { changed: false }; }
  const lines = turns.slice(-80).map((t) => `${t.role === 'user' ? 'Them' : 'You'}: ${t.text}`).join('\n').slice(-6000);
  const out = await askModel([{ role: 'user', content: TIDY_PROMPT(card(), lines) }]);
  const next = String(out || '').replace(/<think>[\s\S]*?<\/think>/g, '').split('\n').map((l) => oneLine(l.replace(/^[-*•\d.)\s]+/, ''), 200)).filter((l) => l.length > 2 && !/^(here is|the card|card:)/i.test(l)).join('\n').slice(0, CARD_MAX);
  setSetting('jvTidiedAt', now);
  if (!next || next === card()) return { changed: false };
  keep(next, 'nightly tidy');
  pruneLog(now);
  return { changed: true, card: next };
}
