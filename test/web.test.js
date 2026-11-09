// The web board (public/js/web/, public/js/shared/share-core.js,
// sync-worker/src/board.js), in Node where WebCrypto is the browser's: its
// cryptography against the app's own code; Jordan's own Switchboard in a
// browser against Sam's in the app (lib/share.js, this process) through a
// stand-in sync service (test/fake-sync.mjs): signing up from the invite link
// is joining; his own projects, pages and to-dos stay his, synced to his
// account (a second browser signs in and has them), never in Sam's; the
// shared page edited both ways; a See-only kind he cannot change; Sam's change
// over the relay in seconds; builds from Sam's GitHub; his own project shared
// from the browser; and what the worker serves for the board.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, scryptSync, generateKeyPairSync, sign as nodeSign } from 'node:crypto';
import { WebSocket as WsClient } from 'ws';

process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-web-'));
const { db, setSetting } = await import('../lib/db.js');
const { newPage, savePage } = await import('../lib/pages.js');
const sync = await import('../lib/sync.js');
const share = await import('../lib/share.js');
const wc = await import('../public/js/web/crypto.js');
const { scrypt } = await import('../public/js/web/scrypt.js');
const { makeClient } = await import('../public/js/web/client.js');
const { makeAdapter } = await import('../public/js/web/adapter.js');
const { startFakeSync } = await import('./fake-sync.mjs');

test('scrypt and the account keys match the app', async () => {
  const enc = new TextEncoder();
  assert.equal(Buffer.from(await scrypt(enc.encode('pässwörd'), enc.encode('salt'), 1024, 8, 1, 64)).toString('hex'), scryptSync('pässwörd', 'salt', 64, { N: 1024, r: 8, p: 1 }).toString('hex'));
  const salt = randomBytes(16).toString('hex');
  const out = scryptSync('correct horse battery'.normalize('NFKC'), Buffer.from(salt, 'hex'), 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  assert.deepEqual(await wc.deriveKeys('correct horse battery', salt), { auth: out.subarray(0, 32).toString('hex'), key: out.subarray(32).toString('hex') });
});

test('sealed documents, locked keys and signatures open both ways', async () => {
  const key = randomBytes(32).toString('hex');
  assert.deepEqual(sync.unseal(await wc.seal({ a: 1, t: 'é' }, key), key), { a: 1, t: 'é' });
  assert.deepEqual(await wc.unseal(sync.seal({ b: [2] }, key), key), { b: [2] });
  await assert.rejects(wc.unseal(sync.seal({ b: 1 }, key), randomBytes(32).toString('hex')));
  const web = await wc.newKeyPair('X25519'), webPriv = await wc.importPriv(web.priv, 'X25519');
  const { pub2, box } = sync.sealForPair('secret-from-app', web.pub);
  assert.equal(await wc.openFromPair(webPriv, web.pub, pub2, box), 'secret-from-app');
  const app = generateKeyPairSync('x25519'), appPub = app.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const back = await wc.sealForPair('secret-from-web', appPub);
  assert.equal(sync.openFromPair(app.privateKey, appPub, back.pub2, back.box), 'secret-from-web');
  const ed = generateKeyPairSync('ed25519'), edPub = ed.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const obj = { z: 1, a: { y: 2, b: [3, { d: 4, c: 5 }] } };
  assert.ok(await wc.verifyObj(obj, nodeSign(null, Buffer.from(wc.stable(obj)), ed.privateKey).toString('base64'), edPub));
  assert.ok(!(await wc.verifyObj({ ...obj, z: 2 }, nodeSign(null, Buffer.from(wc.stable(obj)), ed.privateKey).toString('base64'), edPub)));
  assert.equal(await wc.emailHash(' Jordan@Example.com '), share.emailHash('jordan@example.com'));
});

// ---- Sam (an app, in this process) shares Acme with Jordan (a browser, also here)
const svc = await startFakeSync();
const sam = svc.account('a-sam', 'sam@example.com');
setSetting('sync', sam);
setSetting('spaces', [{ id: 'acme', name: 'Acme', color: '#3366AA', group: 'Work' }]);
setSetting('profiles', { acme: { about: 'Construction software', people: [], links: [] } });
share.setRepoSource(() => ['owner/acme-core']);
share.setActivitySource(() => [{ kind: 'session', name: 'fix-1105', state: 'working', at: Date.now() - 60e3 }]);
share.setCiSource(() => ({ runs: [{ id: 7, fullName: 'owner/acme-core', workflow: 'CI', title: 'Fix login', branch: 'main', state: 'failed', url: 'https://github.com/owner/acme-core/actions/runs/7', updatedAt: Date.now() - 1000, secret: 'x' }], prs: [{ id: 9, number: 42, title: 'Fix the redirect', repo: 'owner/acme-core', url: 'https://github.com/owner/acme-core/pull/42', author: 'sam', updatedAt: Date.now() }] }));
const plan = newPage({ title: 'Launch plan', body: '<ul class="checklist"><li data-checked="false">Pick a date</li></ul>', space: 'acme' });
db.prepare("INSERT INTO items (kind, text, space, created_at) VALUES ('todo', 'Call the printer', 'acme', 1)").run();
const jordan = makeClient({ base: svc.base, WS: WsClient, persist: false });
const api = makeAdapter(jordan);
const other = makeClient({ base: svc.base, WS: null, persist: false });   // Jordan on a second browser, later
after(async () => { await jordan.signOut().catch(() => {}); await other.signOut().catch(() => {}); svc.close(); });
let space, mine;

test('Jordan follows the link and signs up in the browser: that is joining', async () => {
  const r = await share.shareProject('acme', 'jordan@example.com', 'Jordan', { kinds: { pages: 'edit', tasks: 'see', repos: 'see', activity: 'see', about: 'see' } });
  const token = new URLSearchParams(r.link.slice(r.link.indexOf('#join?') + 6)).get('t');
  await api('/api/share/link', { token, project: 'Acme' });
  await api('/api/account/signup', { email: 'jordan@example.com', password: 'a long enough password' });
  assert.deepEqual((await api('/api/state')).share.joining.map((j) => j.project), ['Acme'], '"You\'re in", while Sam\'s computer hands over the keys');
  await share.syncShares();
  await jordan.sync();
  const st = await api('/api/state');
  space = Object.keys(st.share.projects)[0];
  assert.ok(space, 'in');
  assert.deepEqual(st.spaces.map((s) => [s.name, s.group]), [['Personal', 'Mine'], ['Acme', 'Shared']], 'his own Personal, and Acme beside it');
  assert.equal(st.share.projects[space].ownerName, 'Sam');
  assert.deepEqual(st.share.projects[space].kinds, { pages: 'edit', tasks: 'see', repos: 'see', activity: 'see', about: 'see', checks: 'none', sessions: 'none', conversations: 'none', calendar: 'none', money: 'none', files: 'none' });
  assert.deepEqual(st.pages.map((p) => p.title), ['Launch plan']);
  assert.deepEqual(st.items.map((i) => i.text), ['Call the printer']);
  assert.equal(st.profiles[space].about, 'Construction software');
  assert.deepEqual(st.runs.map((x) => [x.fullName, x.state, x.secret]), [['owner/acme-core', 'failed', undefined]], 'only the fields that travel');
  assert.deepEqual(st.sharedPrs.map((x) => x.number), [42]);
  assert.deepEqual(st.share.projects[space].activity.map((a) => [a.who, a.name, a.state]), [['Sam', 'fix-1105', 'working']]);
});

test('his own Switchboard: his own project, a private note and a to-do, which never reach Sam', async () => {
  const set = await api('/api/settings');
  await api('/api/settings', { spaces: [...set.spaces, { name: 'Side project', color: '#22AA66', group: 'Mine' }] });
  mine = (await api('/api/state')).spaces.find((s) => s.name === 'Side project').id;
  const note = await api('/api/pages', { title: 'My private plans', body: '<p>only mine</p>', space: mine });
  await api('/api/capture', { line: 'todo renew my passport', space: mine });
  await api('/api/projects/' + mine + '/profile', { about: 'A thing of my own', people: [], links: [] });
  await jordan.sync(); await share.syncShares();
  assert.ok(!db.prepare('SELECT 1 FROM pages WHERE uid = ?').get(note.uid), 'not in Sam\'s Switchboard');
  assert.ok(!db.prepare("SELECT 1 FROM items WHERE text LIKE '%passport%'").get());
  for (const row of svc.sdb.prepare('SELECT body FROM shares').all()) for (const s of ['My private plans', 'passport', 'Side project', 'A thing of my own']) assert.ok(!row.body.includes(s));
  // It is in his account, sealed: another browser where he signs in has it all.
  assert.ok(svc.sdb.prepare("SELECT 1 FROM docs d JOIN accounts a ON a.id = d.account_id WHERE a.email = 'jordan@example.com' AND d.name = 'pages'").get());
  for (const row of svc.sdb.prepare('SELECT body FROM docs').all()) assert.ok(!row.body.includes('private plans'), 'sealed');
  await other.signIn('jordan@example.com', 'a long enough password');
  const o = makeAdapter(other), ost = await o('/api/state');
  assert.ok(ost.spaces.some((s) => s.name === 'Side project'));
  assert.ok(ost.pages.some((p) => p.title === 'My private plans'));
  assert.ok(ost.items.some((i) => /passport/.test(i.text)));
  assert.ok(ost.pages.some((p) => p.title === 'Launch plan'), 'and the shared project, from his account too');
  assert.equal(ost.profiles[mine].about, 'A thing of my own');
});

test('Jordan edits the shared page in the browser; Sam sees it, signed by Jordan', async () => {
  await api('/api/pages/' + plan.uid, { body: '<ul class="checklist"><li data-checked="true">Pick a date</li><li data-checked="false">Book the hall</li></ul>' });
  await jordan.sync(); await share.syncShares();
  assert.match(db.prepare('SELECT body FROM pages WHERE uid = ?').get(plan.uid).body, /Book the hall/);
  assert.equal(share.changedBy()[plan.uid], 'Jordan');
  const p = await api('/api/pages', { title: 'From the browser', body: '<p>hello</p>', space });
  await jordan.sync(); await share.syncShares();
  assert.ok(db.prepare('SELECT 1 FROM pages WHERE uid = ? AND space = ?').get(p.uid, 'acme'));
});

test('a kind Jordan may only see cannot be changed from the browser', async () => {
  await assert.rejects(api('/api/capture', { line: 'todo sneaky', space }), /only people who may edit/);
  const id = (await api('/api/state')).items.find((i) => i.space === space).id;
  await assert.rejects(api(`/api/items/${id}/done`, {}), /only people who may edit/);
  await assert.rejects(api(`/api/projects/${space}/profile`, { about: 'x' }), /only people who may edit/);
});

test('Sam\'s change shows in Jordan\'s browser within seconds, over the relay', async () => {
  await new Promise((ok) => setTimeout(ok, 300));
  const seen = new Promise((ok) => jordan.onChange(() => { if (jordan.data.page(plan.uid)?.body.includes('Sam was here')) ok(Date.now()); }));
  const t0 = Date.now();
  savePage(plan.uid, { body: '<p>Sam was here</p>' }, Date.now() + 100);
  await share.syncShares();
  const at = await Promise.race([seen, new Promise((_, no) => setTimeout(() => no(new Error('not within 5 seconds')), 5000))]);
  assert.ok(at - t0 < 5000);
});

test('Jordan shares his own project from the browser; Sam joins it in the app', async () => {
  const r = await api('/api/share', { space: mine, email: 'sam@example.com', name: 'Sam', kinds: { pages: 'edit', tasks: 'none', repos: 'none', activity: 'none', about: 'see' }, existing: 'private' });
  assert.equal(r.account, true);
  await share.syncShares();
  const inv = share.shareState().invites.find((v) => v.from === 'jordan@example.com');
  assert.ok(inv, 'Sam sees the invitation');
  await share.acceptShare(inv.id);
  const shared = await api('/api/pages', { title: 'For Sam', body: '<p>ours</p>', space: mine });
  await jordan.sync(); await share.syncShares();
  assert.ok(db.prepare('SELECT 1 FROM pages WHERE uid = ?').get(shared.uid), 'the new page went to Sam');
  assert.ok(!db.prepare("SELECT 1 FROM pages WHERE title = 'My private plans'").get(), 'the page from before stays Only me');
  assert.ok(!db.prepare("SELECT 1 FROM items WHERE text LIKE '%passport%'").get(), 'to-dos are not shared with him');
  assert.ok((await api('/api/state')).share.team.some((p) => p.email === 'sam@example.com'));
});

test('signing out clears the browser; signing in again opens it all', async () => {
  await jordan.signOut();
  const st = await api('/api/state');
  assert.deepEqual([st.pages.length, st.items.length, st.account.signedIn, Object.keys(st.share.projects).length], [0, 0, false, 0]);
  await jordan.signIn('jordan@example.com', 'a long enough password');
  const back = await api('/api/state');
  assert.ok(back.pages.some((p) => p.title === 'My private plans'));
  assert.ok(back.pages.some((p) => p.title === 'Launch plan'));
});

test('Settings on the board sends a rule change as just that change (re-review M7)', async () => {
  await api('/api/settings', { rules: [['a', 'personal'], ['b', 'personal']] });
  await api('/api/settings', { rulesAdd: [['c', 'personal']], rulesRemove: [['B', 'personal']] });
  assert.deepEqual((await api('/api/settings')).rules, [['a', 'personal'], ['c', 'personal']]);
  await api('/api/settings', { rulesRemove: [['a', 'personal'], ['c', 'personal']] });
  assert.deepEqual((await api('/api/settings')).rules, []);
});

test('moving a page Sam shared to another project on the board gives Jordan a copy, and Sam keeps his (review H4)', async () => {
  const p = newPage({ title: 'Supplier list', body: '<p>Sam wrote this</p>', space: 'acme' });
  await share.syncShares(); await jordan.sync();
  assert.ok(jordan.data.page(p.uid), 'Jordan has it');
  const r = await api('/api/pages/' + p.uid, { space: 'personal' });
  assert.ok(r.copy?.uid && r.copy.uid !== p.uid, 'a copy of his own');
  assert.equal(r.sharedBy, 'Sam');
  await jordan.sync(); await share.syncShares(); await jordan.sync();
  assert.ok(db.prepare("SELECT 1 FROM pages WHERE uid = ? AND space = 'acme'").get(p.uid), 'Sam still has it, in Acme');
  assert.equal(jordan.data.page(p.uid)?.space, space, 'and it stays in the shared project on the board');
  assert.deepEqual([jordan.data.page(r.copy.uid)?.space, jordan.data.page(r.copy.uid)?.body], ['personal', '<p>Sam wrote this</p>'], 'the copy is in the project he picked');
});

test('what the worker serves for the board: the page with its mark, integrity hashes, a strict policy, and nothing of the app\'s server', async () => {
  const res = await fetch(svc.base + '/');
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(html, /<meta name="switchboard-board" content="1">/);
  assert.match(html, /<script src="\/js\/core\.js" integrity="sha384-[A-Za-z0-9+/=]+"><\/script>/);
  assert.ok(!html.includes('/vendor/'), 'no terminal files');
  assert.equal((await fetch(svc.base + '/api/state')).status, 404);
  const js = await fetch(svc.base + '/js/shared/share-core.js');
  assert.equal(js.status, 200, 'the shared core is served to the browser');
});

test('the board\'s Money, Calendar, Builds and Browser checks show what shared projects share', async () => {
  const projects = { 'sh-x': { role: 'member', ownerName: 'Sam', kinds: { calendar: 'see', checks: 'see', money: 'see' },
    runs: [{ id: 5, fullName: 'owner/acme-core', workflow: 'CI', title: 'Fix login', branch: 'main', state: 'failed', url: 'https://github.com/owner/acme-core/actions/runs/5', updatedAt: Date.now() - 1000 }], prs: [],
    published: {
      money: [{ kind: 'bill', text: 'Hosting', amount: 20, due_at: Date.now() - 40 * 86400e3, at: 1, cadence: 'monthly' }, { kind: 'invoice', text: 'Acme', amount: 1500, due_at: null, at: 2, cadence: null }, { kind: 'paid', text: 'Acme paid', amount: 900, due_at: null, at: 3, cadence: null }],
      calendar: [{ title: 'Site visit', start: Date.now() + 3600e3, end: Date.now() + 7200e3, where: 'Main St', allDay: false }],
      checks: [{ name: 'Home page', state: 'failed', at: Date.now(), detail: 'Login button missing' }]
    } } };
  const stub = { session: null, error: null, syncedAt: 0, connect: null,
    data: { spaces: () => [], allPages: () => [], allItems: () => [], getSetting: (k, d) => d },
    core: { shareState: () => ({ projects, team: [], invites: [], joining: [] }), changedBy: () => ({}), sharedBy: () => ({}) } };
  const a = makeAdapter(stub), st = await a('/api/state');
  assert.deepEqual(st.money.bills.map((b) => [b.text, b.space, b.shared, b.next > Date.now() - 86400e3]), [['Hosting', 'sh-x', true, true]], 'with its next date worked out');
  assert.deepEqual(st.money.invoices.map((b) => b.text), ['Acme']);
  assert.deepEqual(st.money.paid.map((b) => b.text), ['Acme paid']);
  assert.equal(st.calendars.length, 1);
  assert.deepEqual(st.events.map((e) => [e.title, e.location, e.space, e.canWrite]), [['Site visit', 'Main St', 'sh-x', false]]);
  const cal = await a(`/api/calendar?from=${Date.now()}&to=${Date.now() + 86400e3}`);
  assert.deepEqual(cal.events.map((e) => e.title), ['Site visit']);
  assert.deepEqual(st.actions.map((r) => [r.fullName, r.space, r.runs.map((x) => x.state)]), [['owner/acme-core', 'sh-x', ['failure']]]);
  assert.deepEqual(st.sharedChecks.map((c) => [c.name, c.state, c.from]), [['Home page', 'failed', 'Sam']]);
});
