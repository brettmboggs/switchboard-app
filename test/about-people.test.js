// People on a project's About card sort its messages (lib/spaces.js): their
// email, their full name (Teams), their phone (texts). Someone on two cards,
// and your own address, sort nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import vm from 'node:vm';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-about-'));
const { setSetting } = await import('../lib/db.js');
const { spaceFor, spaceForAddress, spaceForPhone, knowOwnAddresses } = await import('../lib/spaces.js');
const { members } = await import('../lib/sorting.js');
const { cleanProfile } = await import('../lib/projects.js');
const page = { module: { exports: {} } };
vm.runInNewContext(readFileSync(new URL('../public/js/people.js', import.meta.url), 'utf8'), page);
Object.assign(page, page.module.exports);
const wait = async () => {};

setSetting('spaces', [{ id: 'shop', name: 'Shop' }, { id: 'site', name: 'Site' }, { id: 'personal', name: 'Personal' }]);
setSetting('rules', [['acme-site', 'site']]);
setSetting('profiles', {
  shop: { people: [{ name: 'Jordan Park', email: 'Jordan@Example.com', phone: '(201) 555-0134' }, { name: 'Me Myself', email: 'me@example.org' }, { name: 'Sam Lee', email: 'sam@both.example' }] },
  site: { people: [{ name: 'Sam Lee', email: 'sam@both.example' }, { name: 'Ana', email: 'ana@site.example' }] }
});
knowOwnAddresses(() => ['me@example.org']);

test('an About card person brings their mail, Teams chats and texts', async () => {
  await wait();
  assert.equal(spaceForAddress('jordan@example.com'), 'shop');
  assert.equal(spaceFor('Jordan Park microsoft teams'), 'shop');
  assert.equal(spaceForPhone('(201) 555-0134'), 'shop');
  assert.equal(spaceForPhone('12015550000.12015550134.abc@txt.voice.google.com'), 'shop');
  assert.equal(spaceForAddress('ana@site.example'), 'site');
  assert.equal(spaceFor('Ana says hi'), null, 'a first name alone pulls in nothing');
});

test('someone on two cards, and your own address, sort nothing', async () => {
  await wait();
  assert.equal(spaceForAddress('sam@both.example'), null);
  assert.equal(spaceForAddress('me@example.org'), null);
});

test('rules still come first, and the card\'s people show in the project', async () => {
  setSetting('rules', [['jordan@example.com', 'site']]);
  await wait();
  assert.equal(spaceForAddress('jordan@example.com'), 'site');
  setSetting('rules', []);
  await wait();
  const m = members('shop').find((x) => x.label === 'Jordan Park');
  assert.ok(m && m.own, 'Jordan is in Shop, from its About card');
  assert.match(m.line, /About card/);
});

// A person can hold several addresses and numbers (Nov 5 2026): a work email
// and a Gmail on one person, both sorting, and one line for them in the project.
test('a person with several emails and phones sorts them all', async () => {
  setSetting('profiles', {
    shop: cleanProfile({ people: [
      { name: 'Riley Stone', emails: ['riley@acme.example', 'Riley.Stone@gmail.example'], phones: ['201 555 0101', '(201) 555-0102'] },
      { name: 'Sam Lee', emails: ['sam@both.example', 'sam@shop.example'] }
    ] }),
    site: { people: [{ name: 'Sammy', email: 'sam@both.example' }] }
  });
  assert.equal(spaceForAddress('riley@acme.example'), 'shop');
  assert.equal(spaceForAddress('riley.stone@gmail.example'), 'shop');
  assert.equal(spaceForPhone('2015550102'), 'shop');
  assert.equal(spaceForAddress('sam@both.example'), null, 'an address on two cards sorts nothing');
  assert.equal(spaceForAddress('sam@shop.example'), 'shop', 'their other address still sorts');
  const m = members('shop').filter((x) => x.label === 'Riley Stone');
  assert.equal(m.length, 1, 'one row for Riley');
  assert.match(m[0].line, /riley@acme\.example.*riley\.stone@gmail\.example/i);
  assert.match(m[0].line, /\(201\) 555-0101.*\(201\) 555-0102/);
});

test('the first address is also the old single field, and old cards still work', () => {
  const two = cleanProfile({ people: [{ name: 'Riley', emails: ['', 'riley@acme.example', 'RILEY@acme.example', 'r@gmail.example'] }] }).people[0];
  assert.equal(two.email, 'riley@acme.example', 'older copies read the first address');
  assert.deepEqual(two.emails, ['riley@acme.example', 'r@gmail.example'], 'blanks and repeats dropped');
  const old = cleanProfile({ people: [{ name: 'Jordan Park', email: 'jordan@example.com', phone: '(201) 555-0134' }] }).people[0];
  assert.deepEqual(old.emails, ['jordan@example.com']);
  assert.deepEqual(old.phones, ['(201) 555-0134']);
  // A card exactly as an older copy saved it: single fields only.
  setSetting('profiles', { shop: { people: [{ name: 'Jordan Park', email: 'jordan@example.com', phone: '(201) 555-0134' }] } });
  assert.equal(spaceForAddress('jordan@example.com'), 'shop');
  assert.equal(spaceForPhone('(201) 555-0134'), 'shop');
  assert.deepEqual([...page.emailsOf({ email: 'jordan@example.com' })], ['jordan@example.com']);
});

test('Merge with… folds two people into one and keeps every address', () => {
  const people = [
    { name: 'Riley Stone', role: 'Co-founder', email: 'riley@acme.example', phone: '201 555 0101', emails: ['riley@acme.example'], phones: ['201 555 0101'] },
    { name: 'Sam Lee', email: 'sam@shop.example' },
    { name: '', role: '', email: 'riley.s@gmail.example', phone: '(201) 555-0101' }
  ];
  const out = page.mergePeople(people, 0, 2);
  assert.equal(out.length, 2);
  assert.equal(out[0].name, 'Riley Stone');
  assert.deepEqual([...out[0].emails], ['riley@acme.example', 'riley.s@gmail.example']);
  assert.deepEqual([...out[0].phones], ['201 555 0101'], 'the same number twice is kept once');
  assert.equal(out[1].name, 'Sam Lee');
  const saved = cleanProfile({ people: out }).people[0];
  assert.deepEqual(saved.emails, ['riley@acme.example', 'riley.s@gmail.example'], 'and Save keeps them');
});

test('a shared project\'s card sorts messages, but never your notes, sessions or repos into it (review M2)', async () => {
  const { capture } = await import('../lib/capture.js');
  setSetting('shareMap', { 'aaaaaaaaaaaaaaaaaaaaaaaa': 'shop' });
  await wait();
  // Messages from the card's people still go there (they never leave this computer).
  assert.equal(spaceForAddress('jordan@example.com'), 'shop');
  assert.equal(spaceForPhone('(201) 555-0134'), 'shop');
  // But a note typed in All, a session's folder or a repo name is not sent to the shared project by a card someone else can write.
  assert.equal(spaceFor('ask Jordan Park for the keys'), null);
  assert.equal(spaceFor('/home/me/dev/jordan@example.com-notes'), null);
  const it = capture('todo ask Jordan Park for the keys', 'all');
  assert.equal(it.space, 'personal', 'the to-do stays out of the shared project');
  const { spaceForPeople } = await import('../lib/spaces.js');
  assert.equal(spaceForPeople('Jordan Park'), 'shop', 'a Teams chat by its name still goes there');
  setSetting('shareMap', {});
});
