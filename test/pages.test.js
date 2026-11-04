// The notebook's pages: tags and checkboxes read from the text, search, and
// sync between computers (the newest edit wins; a deletion sticks).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-pages-'));
const { tagsOf, checks, newPage, savePage, getPage, deletePage, pageList, search, pagesDoc } = await import('../lib/pages.js');
const { db } = await import('../lib/db.js');

test('tags: #words anywhere, not headings, numbers or colours', () => {
  assert.deepEqual(tagsOf('# Recipes\nbuy #Groceries and #vet-visit (#farm) today #5 #ff4f00x'), ['groceries', 'vet-visit', 'farm', 'ff4f00x']);
  assert.deepEqual(tagsOf('order #7310000017'), []);
});

test('checkboxes counted, at any indent', () => {
  assert.deepEqual(checks('- [ ] eggs\n  - [x] milk\n- [X] bread\n- not a box\n[ ] nor this'), { total: 3, done: 2 });
});

test('make, save, list, search, delete', () => {
  const p = newPage({ title: 'Shopping', body: '- [ ] eggs\n- [ ] chicken feed #farm', space: 'home' }, 1000);
  const q = newPage({ title: 'Fence plan', body: 'Posts every 8 ft\n## Costs\n- t-posts 40', space: 'farm' }, 2000);
  savePage(p.uid, { body: '- [x] eggs\n- [ ] chicken feed #farm' }, 3000);
  const l = pageList();
  assert.equal(l[0].uid, p.uid);                                  // newest first
  assert.deepEqual(l[0].checks, { total: 2, done: 1 });
  assert.deepEqual(l[0].tags, ['farm']);
  assert.equal(l[1].preview, 'Posts every 8 ft');
  assert.equal(search('feed')[0].uid, p.uid);
  assert.equal(search('feed')[0].line, 'chicken feed #farm');
  assert.equal(search('fence')[0].score, 3);                       // a title hit first
  assert.equal(search('t-posts')[0].line, 't-posts 40');
  assert.deepEqual(search(''), []);
  savePage(q.uid, { pinned: true }, 4000);
  assert.equal(pageList()[0].uid, q.uid);                          // pinned first
  assert.throws(() => savePage(p.uid, { body: 'x'.repeat(210 * 1024) }), /too long/);
  deletePage(q.uid, 5000);
  assert.equal(getPage(q.uid), null);
  assert.throws(() => savePage(q.uid, { title: 'x' }), /gone/);
});

test('sync: newest edit wins, older ones do not overwrite, deletions stick', () => {
  const T = Date.now();   // real times: deletions older than 60 days are swept
  const p = newPage({ title: 'Packing', body: '- [ ] tent' }, T + 10_000);
  const remote = JSON.parse(JSON.stringify(pagesDoc.read()));
  const mine = remote.rows.find((r) => r.uid === p.uid);
  // Another computer edited it later: theirs wins.
  pagesDoc.merge({ rows: [{ ...mine, body: '- [x] tent\n- [ ] stove', updated_at: T + 20_000 }], dead: [] });
  assert.equal(getPage(p.uid).body, '- [x] tent\n- [ ] stove');
  // An older copy arriving later changes nothing.
  pagesDoc.merge({ rows: [{ ...mine, body: 'old', updated_at: T + 15_000 }], dead: [] });
  assert.equal(getPage(p.uid).body, '- [x] tent\n- [ ] stove');
  // A page made on the other computer arrives.
  pagesDoc.merge({ rows: [{ uid: 'a'.repeat(24), title: 'From the Mac', body: 'hi', space: 'personal', pinned: 0, created_at: 1, updated_at: T + 30_000 }], dead: [] });
  assert.equal(getPage('a'.repeat(24)).title, 'From the Mac');
  // Deleted there after the last edit here: gone, and it does not come back from an old copy.
  pagesDoc.merge({ rows: [], dead: [{ uid: p.uid, at: T + 40_000 }] });
  assert.equal(getPage(p.uid), null);
  pagesDoc.merge({ rows: [{ ...mine, updated_at: T + 20_000 }], dead: [] });
  assert.equal(getPage(p.uid), null);
  assert.ok(db.prepare('SELECT 1 FROM page_tombstones WHERE uid = ?').get(p.uid));
});

test('pages written by the formatting editor (HTML): text, tags, boxes, search', async () => {
  const { textLines } = await import('../lib/pages.js');
  const body = '<h1>Trip</h1><p>Leave <b>Friday</b> &amp; back Sunday #camping</p><ul class="checklist"><li data-checked="true">tent</li><li data-checked="false">stove<ul><li>fuel</li></ul></li></ul><ol><li>pack</li></ol>';
  assert.deepEqual(textLines(body), ['Trip', 'Leave Friday & back Sunday #camping', 'tent', 'stove', 'fuel', 'pack']);
  const p = newPage({ title: 'Trip', body });
  const l = pageList().find((x) => x.uid === p.uid);
  assert.deepEqual([l.tags, l.checks, l.preview], [['camping'], { total: 2, done: 1 }, 'Trip']);
  assert.equal(search('stove')[0].line, 'stove');
});

test('Ctrl K: lists and logs', async () => {
  const { capture } = await import('../lib/capture.js');
  const shop = newPage({ title: 'Shopping', body: '<ul class="checklist"><li data-checked="false">eggs</li></ul><p>after</p>' });
  let r = capture('shopping milk, bread and <b>butter</b>', 'all');
  assert.deepEqual([r.kind, r.text, r.count], ['list', 'Shopping', 3]);
  assert.equal(getPage(shop.uid).body, '<ul class="checklist"><li data-checked="false">eggs</li><li data-checked="false">milk</li><li data-checked="false">bread</li><li data-checked="false">&lt;b&gt;butter&lt;/b&gt;</li></ul><p>after</p>');
  r = capture('add feed to the shopping list', 'all');
  assert.equal(r.kind, 'list');
  assert.match(getPage(shop.uid).body, /<li data-checked="false">feed<\/li><\/ul>/);
  // An old-style page gets old-style lines.
  const old = newPage({ title: 'Hardware', body: '- [ ] screws' });
  capture('hardware hinges', 'all');
  assert.equal(getPage(old.uid).body, '- [ ] screws\n- [ ] hinges');
  // No list page by that name: a note, as before.
  assert.equal(capture('groceries eggs', 'all').kind, 'note');
  // Logs: made on first use, newest first, totals read from the amounts.
  r = capture('log eggs 14', 'all');
  assert.deepEqual([r.kind, r.text, r.amount], ['log', 'Eggs log', '14']);
  capture('log eggs 11 one cracked', 'all');
  const log = getPage(r.uid).body;
  assert.match(log, /^<ul class="log"><li data-at="\d+">[^<]+ · 11 · one cracked<\/li><li data-at="\d+">[^<]+ · 14<\/li><\/ul>$/);
  assert.equal(capture('log miles $42.50 feed store', 'all').text, 'Miles log');
});
