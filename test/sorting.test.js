// Sorting into projects (lib/sorting.js, lib/belongs.js): sections of a page,
// a note's text for a session, which notes show beside which session.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-sort-'));
const { setSetting } = await import('../lib/db.js');
const { newPage, addToList } = await import('../lib/pages.js');
const { sectionsOf, noteText, notesFor, fileIn, takeOut, members } = await import('../lib/sorting.js');
const { belongsAll } = await import('../lib/belongs.js');

setSetting('spaces', [{ id: 'acme', name: 'Acme website' }, { id: 'home', name: 'Home' }, { id: 'personal', name: 'Personal' }]);
const body = '<h2>Launch</h2><ul class="checklist"><li data-checked="true">Pick a name</li><li data-checked="false">Order cards</li></ul><h2>Ideas</h2><p>A blog &amp; a shop</p>';
const page = newPage({ title: 'Plans', body, space: 'acme' });

test('a page\'s sections are its headings', () => {
  assert.deepEqual(sectionsOf(body), ['Launch', 'Ideas']);
  assert.deepEqual(sectionsOf('# One\ntext\n## Two'), ['One', 'Two']);
});

test('a note reads as plain text with its checkboxes, whole or one section', () => {
  assert.equal(noteText(page.uid, 'Launch').text, '## Launch\n- [x] Pick a name\n- [ ] Order cards');
  assert.match(noteText(page.uid).text, /## Ideas\nA blog & a shop/);
  assert.equal(noteText(page.uid, 'Nope'), null);
});

test('a page shows beside its project\'s sessions; a section filed elsewhere shows there too', () => {
  assert.deepEqual(notesFor({ space: 'acme', repo: 'acme-site' }).map((n) => n.key), ['page:' + page.uid]);
  assert.equal(fileIn('home', { key: `section:${page.uid}#Ideas` }).main, false);
  assert.deepEqual(notesFor({ space: 'home', repo: 'garden' }).map((n) => n.section), ['Ideas']);
  assert.ok(members('home').some((m) => m.kind === 'section' && m.label === 'Plans → Ideas'));
  takeOut('home', { key: `section:${page.uid}#Ideas` });
  assert.equal(belongsAll().length, 0);
});

test('a note tied to one repo shows only in that repo\'s sessions', () => {
  fileIn('acme', { key: 'page:' + page.uid, repo: 'acme-site' });
  assert.equal(notesFor({ space: 'acme', repo: 'acme-site' }).length, 1);
  assert.equal(notesFor({ space: 'acme', repo: 'acme-app' }).length, 0);
});

test('a checkbox added from Ctrl K goes at the bottom of the last checklist', () => {
  addToList(page.uid, ['Book the printer']);
  assert.match(noteText(page.uid, 'Launch').text, /- \[ \] Order cards\n- \[ \] Book the printer$/);
});

test('filing in a project that is gone says so', () => {
  assert.throws(() => fileIn('gone', { key: 'page:' + page.uid }), /That project is gone/);
});
