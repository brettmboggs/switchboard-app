// The command bar (lib/capture.js): one line in, one thing out. The notebook
// lines ("today", "log", "shopping") land on pages; anything else is a note.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-capture-'));
const { capture } = await import('../lib/capture.js');
const { getPage, newPage, pageList, dayTitle } = await import('../lib/pages.js');
const { db } = await import('../lib/db.js');

test('today: a timed line on the day\'s page in this project, made on first use', () => {
  const r = capture('today fed the goats', 'personal');
  assert.equal(r.kind, 'today');
  assert.equal(r.text, dayTitle(Date.now()));                      // "Tue Nov 4"
  assert.match(r.text, /^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2}$/);
  assert.equal(r.space, 'personal');
  let p = getPage(r.uid);
  assert.match(p.body, /^<p>\d{1,2}:\d{2} [AP]M · fed the goats<\/p>$/);
  // The colon form, and the next line goes under the first, on the same page.
  const r2 = capture('today: call <b>Sam</b> back', 'personal');
  assert.equal(r2.uid, r.uid);
  p = getPage(r.uid);
  assert.match(p.body, /^<p>[^<]+ · fed the goats<\/p><p>[^<]+ · call &lt;b&gt;Sam&lt;\/b&gt; back<\/p>$/);
  // Another project gets its own page for the day; no project picked means personal.
  const r3 = capture('today moved the fence', 'farm');
  assert.notEqual(r3.uid, r.uid);
  assert.equal(getPage(r3.uid).space, 'farm');
  assert.equal(capture('today checked the mail', 'all').uid, r.uid);
  // "today" with nothing after it is just a note that says today.
  assert.equal(capture('today', 'personal').kind, 'note');
  // The page shows in the list with its lines readable.
  const l = pageList().find((x) => x.uid === r.uid);
  assert.match(l.preview, /fed the goats$/);
});

test('log: an entry on the "<name> log" page, newest first', () => {
  const r = capture('log eggs 14', 'personal');
  assert.deepEqual([r.kind, r.text, r.amount], ['log', 'Eggs log', '14']);
  capture('log eggs 9 two cracked', 'personal');
  assert.match(getPage(r.uid).body, /^<ul class="log"><li data-at="\d+">[^<]+ · 9 · two cracked<\/li><li data-at="\d+">[^<]+ · 14<\/li><\/ul>$/);
});

test('shopping: items onto the list page by that name', () => {
  const shop = newPage({ title: 'Shopping', body: '<ul class="checklist"><li data-checked="false">eggs</li></ul>', space: 'personal' });
  const r = capture('shopping milk and bread', 'personal');
  assert.deepEqual([r.kind, r.text, r.count], ['list', 'Shopping', 2]);
  assert.equal(getPage(shop.uid).body, '<ul class="checklist"><li data-checked="false">eggs</li><li data-checked="false">milk</li><li data-checked="false">bread</li></ul>');
  assert.equal(capture('add butter to the shopping list', 'personal').count, 1);
});

test('a plain line is a note, in the project you are in', () => {
  const r = capture('gate code 4411', 'personal');
  assert.deepEqual([r.kind, r.text, r.space], ['note', 'gate code 4411', 'personal']);
  assert.equal(capture('note today was long', 'personal').text, 'today was long');   // "note" forces a note
  assert.ok(db.prepare('SELECT 1 FROM items WHERE id = ? AND kind = ?').get(r.id, 'note'));
});
