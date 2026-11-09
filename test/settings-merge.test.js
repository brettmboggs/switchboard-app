// Settings, Projects saves only what was changed on the page (review M7): a
// rule or project added elsewhere while Settings was open (the Add picker, ×
// on a project page, joining a shared project, another window) survives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-setmerge-'));
const { setSetting, getSetting } = await import('../lib/db.js');
const { route } = await import('../lib/routes/settings.js');

// The settings route as the page calls it, without a server.
async function call(method, body) {
  const req = { method, async *[Symbol.asyncIterator]() { if (body) yield JSON.stringify(body); } };
  let out = null;
  const res = { headersSent: false, writeHead(status) { this.status = status; this.headersSent = true; }, setHeader() {}, end(d) { out = JSON.parse(String(d || '{}')); } };
  await route({ req, res, path: '/api/settings', url: new URL('http://127.0.0.1/api/settings'), changed: () => {}, PREFS: {} });
  return out;
}

test('a rule added elsewhere while Settings was open is kept when Settings saves (review M7)', async () => {
  setSetting('spaces', [{ id: 'acme', name: 'Acme', color: '#3366AA', group: 'Work' }, { id: 'home', name: 'Home', color: '#22AA66', group: 'Mine' }]);
  setSetting('rules', [['acme.example', 'acme'], ['garden', 'home']]);
  const page = await call('GET');
  // Meanwhile: the Add picker files someone in Acme, and a shared project joins.
  setSetting('rules', [['jordan@shop.example', 'acme'], ...getSetting('rules', [])]);
  setSetting('spaces', [...getSetting('spaces', []), { id: 'sh-0123456789', name: 'Shared with you', color: '#8A8F98', group: 'Shared' }]);
  // On the page: a rule added to Home, and Acme's own rule deleted.
  const rules = [...page.rules.filter(([t]) => t !== 'acme.example'), ['shed', 'home']];
  await call('POST', { rules, rulesWas: page.rulesWas });
  assert.deepEqual(getSetting('rules', []), [['jordan@shop.example', 'acme'], ['garden', 'home'], ['shed', 'home']]);
  // Projects too: renaming Home on the page keeps the shared project that joined meanwhile.
  const spaces = page.spaces.map((s) => s.id === 'home' ? { ...s, name: 'House' } : s);
  await call('POST', { spaces, spacesWas: page.spacesWas });
  assert.deepEqual(getSetting('spaces', []).map((s) => [s.id, s.name]), [['acme', 'Acme'], ['home', 'House'], ['sh-0123456789', 'Shared with you']]);
  // And a project removed on the page is removed.
  await call('POST', { spaces: getSetting('spaces', []).filter((s) => s.id !== 'acme'), spacesWas: getSetting('spaces', []).map((s) => s.id) });
  assert.ok(!getSetting('spaces', []).some((s) => s.id === 'acme'));
});

test('a rule meant to come first stays first, and order is the page\'s (review M7)', async () => {
  setSetting('rules', [['a', 'acme'], ['b', 'home']]);
  const page = await call('GET');
  await call('POST', { rules: [['sam@shop.example', 'home'], ...page.rules], rulesWas: page.rulesWas });
  assert.deepEqual(getSetting('rules', []), [['sam@shop.example', 'home'], ['a', 'acme'], ['b', 'home']]);
  // Without what it started from (an older page), the list is taken whole, as before.
  await call('POST', { rules: [['only', 'acme']] });
  assert.deepEqual(getSetting('rules', []), [['only', 'acme']]);
});

test('a rule change from the page is only that change: a rule deleted elsewhere stays deleted (re-review M7)', async () => {
  setSetting('rules', [['a', 'acme'], ['b', 'home'], ['c', 'home']]);
  await call('GET');
  // Elsewhere: b is deleted. The page, which still shows b, adds d and takes away c.
  setSetting('rules', [['a', 'acme'], ['c', 'home']]);
  await call('POST', { rulesAdd: [['d', 'home']], rulesRemove: [] });
  await call('POST', { rulesAdd: [], rulesRemove: [['C', 'home']] });
  assert.deepEqual(getSetting('rules', []), [['a', 'acme'], ['d', 'home']]);
  // Added then taken away, in that order: gone. The same rule added again moves to the end, once.
  await call('POST', { rulesAdd: [['e', 'acme']] });
  await call('POST', { rulesRemove: [['e', 'acme']] });
  await call('POST', { rulesAdd: [['A', 'acme']] });
  assert.deepEqual(getSetting('rules', []), [['d', 'home'], ['A', 'acme']]);
});

test('a new project gets an id no other project has, and the page is told which, by its temporary id (re-review L2)', async () => {
  setSetting('spaces', [{ id: 'acme', name: 'Acme', color: '#3366AA', group: 'Work' }]);
  const page = await call('GET');
  // Meanwhile, elsewhere: a project named Garden.
  setSetting('spaces', [...getSetting('spaces', []), { id: 'garden', name: 'Garden', color: '#22AA66', group: 'Mine' }]);
  const r = await call('POST', { spaces: [...page.spaces, { tmp: 'new-abc123', name: 'Garden', color: '#7A3E9D', group: 'Mine' }], spacesWas: page.spacesWas });
  assert.deepEqual(getSetting('spaces', []).map((s) => [s.id, s.color]), [['acme', '#3366AA'], ['garden-2', '#7A3E9D'], ['garden', '#22AA66']], 'the one made elsewhere keeps its id');
  assert.deepEqual(r.made, { 'new-abc123': 'garden-2' });
  assert.ok(!getSetting('spaces', []).some((s) => 'tmp' in s), 'the temporary id is not kept');
});
