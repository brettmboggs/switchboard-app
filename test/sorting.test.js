// Sorting into projects (lib/sorting.js, lib/belongs.js): sections of a page,
// a note's text for a session, which notes show beside which session.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-sort-'));
const { setSetting, getSetting } = await import('../lib/db.js');
const { newPage, addToList } = await import('../lib/pages.js');
const { sectionsOf, noteText, notesFor, fileIn, takeOut, members, typedThing, addable } = await import('../lib/sorting.js');
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

test('a person typed into Add is filed by their address, name, or domain', () => {
  assert.deepEqual(typedThing('Sam Lee <sam@example.com>') && [typedThing('Sam Lee <sam@example.com>').label, typedThing('Sam Lee <sam@example.com>').rule], ['Sam Lee', 'sam@example.com']);
  assert.equal(typedThing('@example.org').rule, 'example.org');
  assert.equal(typedThing('Jordan Park').rule, 'Jordan Park');
  assert.equal(typedThing('x'), null);
  const hit = addable('home', 'jamie@shop.example').at(-1);
  assert.equal(hit.key, 'new:jamie@shop.example');
  assert.deepEqual(fileIn('home', { key: hit.key, label: hit.label }), { main: true });
  assert.ok(getSetting('rules', []).some(([r, s]) => r === 'jamie@shop.example' && s === 'home'));
  assert.ok(members('home').some((m) => m.rule === 'jamie@shop.example'));
  assert.ok(!addable('home', 'jamie@shop.example').some((h) => h.key.startsWith('new:')), 'not offered twice');
});

test('a page whose own project this is, and an About card person, can be taken out and put back', async () => {
  const { putBack } = await import('../lib/sorting.js');
  const { getPage } = await import('../lib/pages.js');
  const own = newPage({ title: 'Acme todo', body: '<p>x</p>', space: 'acme' });
  const m = members('acme').find((x) => x.key === 'page:' + own.uid);
  assert.equal(m.from, 'page');
  const r = takeOut('acme', { key: 'page:' + own.uid });
  assert.equal(getPage(own.uid).space, 'personal');
  putBack('acme', r.restore);
  assert.equal(getPage(own.uid).space, 'acme');
  setSetting('profiles', { acme: { people: [{ name: 'Rae Kim', email: 'rae@acme.example' }] } });
  const p = members('acme').find((x) => x.label === 'Rae Kim');
  assert.equal(p.from, 'about');
  const r2 = takeOut('acme', { key: p.key });
  assert.equal(getSetting('profiles').acme.people.length, 0);
  putBack('acme', r2.restore);
  assert.equal(getSetting('profiles').acme.people[0].email, 'rae@acme.example');
});

test('a Personal page comes off Personal\'s card, stays in Notes, and comes back', async () => {
  const { putBack } = await import('../lib/sorting.js');
  const { getPage } = await import('../lib/pages.js');
  const pg = newPage({ title: 'Groceries', body: '<p>eggs</p>', space: 'personal' });
  assert.equal(members('personal').find((x) => x.key === 'page:' + pg.uid).from, 'card');
  const r = takeOut('personal', { key: 'page:' + pg.uid });
  assert.ok(!members('personal').some((x) => x.key === 'page:' + pg.uid));
  assert.equal(getPage(pg.uid).space, 'personal');
  putBack('personal', r.restore);
  assert.ok(members('personal').some((x) => x.key === 'page:' + pg.uid));
});
