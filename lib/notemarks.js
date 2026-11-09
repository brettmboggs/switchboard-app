// Notes sent to a session, marked on the note. Every prompt a Claude Code
// session takes (its UserPromptSubmit hook: Send to session, the queue, or a
// note pasted in by hand) is matched against the lines of your notes; a line
// it holds gets a mark: sent to which session, when. When that session's turn
// then ends, the mark says Claude finished. That is all it claims: Claude can
// stop without having done it, so ticking the line off stays your click
// (public/js/notemarks.js). Kept on this computer, where the sessions are; a
// mark is dropped once its line is gone from the note or it is 30 days old.
import { db } from './db.js';
import { textLines } from './pages.js';

db.exec(`CREATE TABLE IF NOT EXISTS note_marks (
  page_uid TEXT NOT NULL, line TEXT NOT NULL, session_id TEXT, term_id TEXT,
  sent_at INTEGER NOT NULL, finished_at INTEGER, PRIMARY KEY (page_uid, line)
)`);
const KEEP = 30 * 86400e3;

// A line as it is compared: lower case, letters and digits only, one space between words.
export const lineKey = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
// Short lines ("Ideas", "Done") are in too many prompts to mean anything.
const worth = (k) => k.length >= 14 && k.split(' ').length >= 3;

// A prompt went in: mark every note line it holds. Returns how many.
export function notePrompt(sessionId, termId, prompt, now = Date.now()) {
  const p = ' ' + lineKey(prompt) + ' ';
  if (p.length < 16) return 0;
  let n = 0;
  const put = db.prepare(`INSERT INTO note_marks (page_uid, line, session_id, term_id, sent_at, finished_at) VALUES (?, ?, ?, ?, ?, NULL)
    ON CONFLICT(page_uid, line) DO UPDATE SET session_id = excluded.session_id, term_id = excluded.term_id, sent_at = excluded.sent_at, finished_at = NULL`);
  for (const pg of db.prepare('SELECT uid, body FROM pages').all()) {
    const seen = new Set();
    for (const l of textLines(pg.body)) {
      const k = lineKey(l);
      if (!worth(k) || seen.has(k) || !p.includes(' ' + k + ' ')) continue;
      seen.add(k);
      put.run(pg.uid, k, sessionId || null, termId || null, now);
      n++;
    }
  }
  return n;
}

// That session's turn ended: what it was sent before now is marked finished.
export function noteFinished(sessionId, now = Date.now()) {
  if (!sessionId) return 0;
  return Number(db.prepare('UPDATE note_marks SET finished_at = ? WHERE session_id = ? AND finished_at IS NULL AND sent_at <= ?').run(now, sessionId, now).changes);
}

// For the page: the marks of the last 30 days, with the session's state now.
export function noteMarks(now = Date.now()) {
  db.prepare('DELETE FROM note_marks WHERE sent_at < ?').run(now - KEEP);
  return db.prepare(`SELECT m.page_uid AS page, m.line, m.term_id AS term, m.sent_at AS sent, m.finished_at AS finished, s.state, s.repo AS name
    FROM note_marks m LEFT JOIN sessions s ON s.id = m.session_id ORDER BY m.sent_at DESC LIMIT 2000`).all()
    .map((r) => ({ ...r }));
}
export function clearNoteMark(page, line) {
  return Number(db.prepare('DELETE FROM note_marks WHERE page_uid = ? AND line = ?').run(String(page), String(line)).changes);
}
