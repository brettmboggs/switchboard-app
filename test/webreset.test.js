// A teammate forgets their password (sync-worker/src/reset.js, share-core.js
// relockAfterReset): Sam (the app, this process) shares Acme with Jordan (the
// web board, also here) through the stand-in sync service; Sam makes Jordan a
// reset code in Team; Jordan sets a new password in a fresh browser; Sam's
// computer locks Acme to Jordan's new keys by itself; Jordan sees everything
// again, with the same access, without a new invite, and his edits still count.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-webreset-'));
const { db, setSetting } = await import('../lib/db.js');
const { newPage } = await import('../lib/pages.js');
const share = await import('../lib/share.js');
const { makeClient } = await import('../public/js/web/client.js');
const { makeAdapter } = await import('../public/js/web/adapter.js');
const { startFakeSync } = await import('./fake-sync.mjs');

const svc = await startFakeSync();
setSetting('sync', svc.account('a-sam', 'sam@example.com'));
setSetting('spaces', [{ id: 'acme', name: 'Acme', color: '#3366AA', group: 'Work' }]);
share.setRepoSource(() => []);
share.setActivitySource(() => []);
const plan = newPage({ title: 'Launch plan', body: '<p>Pick a date</p>', space: 'acme' });
db.prepare("INSERT INTO items (kind, text, space, created_at) VALUES ('todo', 'Call the printer', 'acme', 1)").run();

const jordan = makeClient({ base: svc.base, WS: null, persist: false });
const fresh = makeClient({ base: svc.base, WS: null, persist: false });   // Jordan later, in a private window
after(async () => { await fresh.signOut().catch(() => {}); svc.close(); });
const EVERYTHING = { pages: 'edit', tasks: 'edit', repos: 'edit', activity: 'see', about: 'edit', checks: 'see', sessions: 'send', conversations: 'see', calendar: 'see', money: 'see', files: 'edit' };

test('the whole way: reset from Team keeps Jordan in Acme with everything he had', async () => {
  const api = makeAdapter(jordan);
  const r = await share.shareProject('acme', 'jordan@example.com', 'Jordan', { kinds: EVERYTHING });
  await api('/api/share/link', { token: new URLSearchParams(r.link.slice(r.link.indexOf('#join?') + 6)).get('t'), project: 'Acme' });
  await api('/api/account/signup', { email: 'jordan@example.com', password: 'the first password' });
  await share.syncShares(); await jordan.sync();
  const before = await api('/api/state');
  const space = Object.keys(before.share.projects)[0];
  assert.deepEqual(before.pages.map((p) => p.title), ['Launch plan']);
  const kinds = before.share.projects[space].kinds;

  // Sam: Team, Jordan's card, Reset their password.
  const code = await share.resetCodeFor('jordan@example.com');
  assert.match(code, /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);

  // Jordan, in a private window: Forgot password?, the code, a new password.
  const api2 = makeAdapter(fresh);
  svc.notices.length = 0;
  await api2('/api/account/reset-finish', { email: 'jordan@example.com', code, password: 'a brand new password' });
  assert.ok(svc.notices.some(([id, t]) => id === 'a-sam' && t === 'shares'), 'Sam\'s computer is told at once, so it locks Acme again within seconds');
  assert.equal(fresh.error, null, 'no error while Acme waits to be locked to his new keys');
  assert.deepEqual((await api2('/api/state')).pages, [], 'nothing opens until Sam locks it again');
  const epoch = svc.sdb.prepare('SELECT epoch FROM shares').get().epoch;
  await assert.rejects(jordan.sync().then(() => { if (jordan.error) throw new Error(jordan.error); }), /Signed out/, 'the old browser is signed out');

  // Sam's computer, on its next sync, locks Acme to Jordan's new keys: no check codes, no new invite.
  await share.syncShares();
  assert.ok(svc.sdb.prepare('SELECT epoch FROM shares').get().epoch > epoch, 'a new key, locked to his new keys');
  const team = share.shareState().team;
  assert.deepEqual(team.map((p) => [p.email, p.projects.map((x) => x.space)]), [['jordan@example.com', ['acme']]], 'still on the team, still in Acme');
  assert.deepEqual(share.shareState().keys.changed || [], [], 'nothing to compare: Sam started the reset');

  await fresh.sync(); await fresh.sync();
  assert.equal(fresh.error, null);
  const after1 = await api2('/api/state');
  const space2 = Object.keys(after1.share.projects)[0];
  assert.ok(space2, 'Acme is back');
  assert.deepEqual(after1.share.projects[space2].kinds, kinds, 'with the same access');
  assert.deepEqual(after1.pages.map((p) => p.title), ['Launch plan']);
  assert.deepEqual(after1.items.map((i) => i.text), ['Call the printer']);

  // And his changes still count on Sam's side (signed with his new key).
  await api2('/api/pages/' + plan.uid, { body: '<p>Pick a date: the 14th</p>' });
  await fresh.sync(); await share.syncShares();
  assert.match(db.prepare('SELECT body FROM pages WHERE uid = ?').get(plan.uid).body, /the 14th/);
});

test('a code is only for someone in a project you run', async () => {
  await assert.rejects(share.resetCodeFor('stranger@example.com'), /only for someone/);
});
