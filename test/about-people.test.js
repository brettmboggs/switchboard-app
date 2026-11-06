// People on a project's About card sort its messages (lib/spaces.js): their
// email, their full name (Teams), their phone (texts). Someone on two cards,
// and your own address, sort nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-about-'));
const { setSetting } = await import('../lib/db.js');
const { spaceFor, spaceForAddress, spaceForPhone, knowOwnAddresses } = await import('../lib/spaces.js');
const { members } = await import('../lib/sorting.js');
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
