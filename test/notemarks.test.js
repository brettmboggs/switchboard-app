// Note lines a Claude Code session was sent (however: Send to session, the
// queue, a paste) are marked; the mark says finished once that session's turn
// ends. Short lines never match, and a line is marked once per page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-marks-'));
const { notePrompt, noteFinished, noteMarks, clearNoteMark, lineKey } = await import('../lib/notemarks.js');
const { newPage } = await import('../lib/pages.js');

test('sent lines are marked, then finished', () => {
  const p = newPage({ title: 'Build notes', body: '<ul><li>Granola connection<ul><li>pick the project from who was in the meeting</li></ul></li><li>Ideas</li><li>Attachments open in the app, not as a download</li></ul>' });
  const pasted = 'From my notes, “Build notes”:\n- Attachments open in the app, NOT as a download!\nthanks';
  assert.equal(notePrompt('s1', 'sb-a', pasted, 1000), 1);
  assert.equal(notePrompt('s2', 'sb-b', 'Ideas', 1100), 0);   // too short to mean anything
  let m = noteMarks(2000);
  assert.equal(m.length, 1);
  assert.deepEqual({ page: m[0].page, line: m[0].line, term: m[0].term, sent: m[0].sent, finished: m[0].finished }, { page: p.uid, line: lineKey('Attachments open in the app, not as a download'), term: 'sb-a', sent: 1000, finished: null });

  // Another session's turn ending says nothing about this one.
  noteFinished('s2', 1500);
  assert.equal(noteMarks(2000)[0].finished, null);
  noteFinished('s1', 1600);
  assert.equal(noteMarks(2000)[0].finished, 1600);

  // Sent again (a nested bullet too): the mark starts over.
  notePrompt('s1', 'sb-a', '- Granola connection\n  - pick the project from who was in the meeting\n- Attachments open in the app, not as a download', 1700);
  m = noteMarks(2000);
  assert.equal(m.length, 2);   // "Granola connection" is two words: not marked
  assert.ok(m.every((x) => x.finished === null && x.sent === 1700));

  clearNoteMark(p.uid, lineKey('Attachments open in the app, not as a download'));
  assert.equal(noteMarks(2000).length, 1);
  assert.equal(noteMarks(1700 + 31 * 86400e3).length, 0);   // a month on, gone
});
