// A project's own page: the profile is cleaned, and the people found in its
// mail are only people you actually write to (never strangers, robots or yourself).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-projects-'));
const { db, setSetting } = await import('../lib/db.js');
const { cleanProfile, foundPeople, saveProfile, safeName } = await import('../lib/projects.js');

test('profile: only web, mail and phone links; empty people dropped', () => {
  const p = cleanProfile({ links: [{ url: 'example.com/wp-admin' }, { url: 'javascript:alert(1)' }, { url: 'data:text/html,x' }, { url: 'mailto:a@b.co' }], people: [{}, { name: 'Pat' }] });
  assert.deepEqual(p.links.map((l) => l.url), ['https://example.com/wp-admin', 'mailto:a@b.co']);
  assert.equal(p.people.length, 1);
});

test('file names cannot leave the folder', () => {
  assert.equal(safeName('../../etc/passwd'), 'passwd');
  assert.equal(safeName('..\\..\\x.txt'), 'x.txt');
  assert.equal(safeName('.hidden'), 'hidden');
  assert.equal(safeName(''), 'file');
});

test('people found in the mail', () => {
  setSetting('spaces', [{ id: 'personal', name: 'Personal' }, { id: 'acme', name: 'Acme' }]);
  setSetting('gmail', [{ email: 'me@mine.test', aliases: ['also@mine.test'] }]);
  const add = db.prepare(`INSERT INTO mail (account, msg_id, from_name, from_addr, to_addrs, date, from_me, bulk, kind, space) VALUES ('me@mine.test', ?, ?, ?, ?, ?, ?, 0, 'mail', ?)`);
  add.run('1', 'Me', 'me@mine.test', 'Pat Owner <pat@acme.test>, also@mine.test', 1000, 1, 'acme');     // I wrote to Pat
  add.run('2', 'Pat Owner', 'pat@acme.test', 'me@mine.test', 2000, 0, 'acme');                         // Pat wrote back
  add.run('3', 'Sam Office', 'sam@acme.test', 'me@mine.test', 3000, 0, 'acme');                         // Sam wrote, I have written to Sam elsewhere
  add.run('4', 'Stranger', 'cold@pitch.test', 'me@mine.test', 4000, 0, 'acme');                        // never written to
  add.run('5', 'Acme', 'no-reply@acme.test', 'me@mine.test', 5000, 0, 'acme');                         // a robot
  add.run('6', 'Me', 'me@mine.test', 'bob@other.test', 6000, 1, 'personal');                            // another project
  db.prepare('INSERT INTO contacts (addr, last_at) VALUES (?, ?)').run('sam@acme.test', 1);
  db.prepare('INSERT INTO contacts (addr, last_at) VALUES (?, ?)').run('pat@acme.test', 1000);
  let f = foundPeople('acme');
  assert.deepEqual(f.map((x) => x.email), ['sam@acme.test', 'pat@acme.test']);
  assert.equal(f[1].name, 'Pat Owner');
  assert.equal(f[1].count, 2);
  // Added to People, or hidden: no longer offered.
  saveProfile('acme', { people: [{ name: 'Pat Owner', email: 'pat@acme.test' }], hidden: ['sam@acme.test'] });
  assert.deepEqual(foundPeople('acme'), []);
});
