// Shared projects and your team (lib/share.js, sync-worker/src/shares.js), end
// to end: the real service code over a stand-in for its database, this process
// as the owner (the owner's role: "owner@example.com") and child processes
// (test/share-peer.mjs) as Jordan, Sam and Riley, each with their own account
// and data. People are added to projects with See or Edit per kind; a kind
// they cannot see is a box they cannot open; a See-only person's changes are
// refused by everyone else, even from a Switchboard that cheats; invites by
// email with a one-use link (signing up with that address is joining, and it
// finishes by itself when the owner's computer comes online); roles with a
// roster the service cannot forge or roll back; projects shared before the
// team move over by themselves.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes, sign } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const here = dirname(fileURLToPath(import.meta.url));
process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-share-a-'));
const { db, setSetting, getSetting } = await import('../lib/db.js');
const { newPage, savePage, deletePage } = await import('../lib/pages.js');
const { seal, unseal, sealForPair, openFromPair } = await import('../lib/sync.js');
const share = await import('../lib/share.js');
const { shareRoute } = await import('../sync-worker/src/shares.js');

// ---- the sync service: its share routes over node:sqlite, shaped like Cloudflare D1
const sdb = new DatabaseSync(':memory:');
for (const f of ['schema.sql', 'schema-v5.sql', 'schema-v6.sql']) sdb.exec(readFileSync(join(here, '../sync-worker', f), 'utf8'));
const stmt = (sql, args = []) => ({
  bind: (...a) => stmt(sql, a),
  first: async () => sdb.prepare(sql).get(...args) ?? null,
  all: async () => ({ results: sdb.prepare(sql).all(...args) }),
  run: async () => ({ meta: { changes: Number(sdb.prepare(sql).run(...args).changes) } }),
  now: () => sdb.prepare(sql).run(...args)
});
const env = { DB: { prepare: (sql) => stmt(sql), batch: async (list) => { sdb.exec('BEGIN'); try { for (const s of list) s.now(); sdb.exec('COMMIT'); } catch (e) { sdb.exec('ROLLBACK'); throw e; } } } };
const tokens = new Map(), notices = [];
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
const server = createServer(async (req, res) => {
  let text = ''; for await (const c of req) text += c;
  const url = new URL(req.url, 'http://127.0.0.1');
  const acct = tokens.get((req.headers.authorization || '').replace(/^Bearer /, ''));
  const r = !acct ? json({ error: 'Signed out.' }, 401)
    : await shareRoute({ req, env, path: url.pathname, url, body: text ? JSON.parse(text) : {}, acct: { id: acct }, json, bad: (error, status = 400) => json({ error }, status),
      notice: async (e, id, msg) => notices.push([id, msg.type]), limited: async () => false, maxDoc: 900 * 1024 }) || json({ error: 'Not found.' }, 404);
  res.writeHead(r.status, { 'Content-Type': 'application/json' }); res.end(await r.text());
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
after(() => server.close());
const SERVER = `http://127.0.0.1:${server.address().port}`;
function account(id, email) {
  sdb.prepare("INSERT INTO accounts (id, email, salt, auth_hash, auth_salt, created_at) VALUES (?, ?, '', '', '', 0)").run(id, email);
  const token = randomBytes(32).toString('hex');
  tokens.set(token, id);
  return { server: SERVER, token, key: randomBytes(32).toString('hex'), email };
}
const owner = account('a-owner', 'owner@example.com');
const peers = {
  jordan: { acct: account('a-jordan', 'jordan@example.com'), data: mkdtempSync(join(tmpdir(), 'sb-share-b-')) },
  sam: { acct: account('a-sam', 'sam@example.com'), data: mkdtempSync(join(tmpdir(), 'sb-share-c-')) },
  riley: { acct: null, data: mkdtempSync(join(tmpdir(), 'sb-share-d-')) }   // no account until they follow the link
};
const run = promisify(execFile);
async function as(who, ...steps) {
  const p = peers[who];
  const { stdout } = await run(process.execPath, ['--disable-warning=ExperimentalWarning', join(here, 'share-peer.mjs'), JSON.stringify([['account', p.acct], ...steps])], { env: { ...process.env, SWITCHBOARD_DATA: p.data } });
  return JSON.parse(stdout).slice(1);
}
const ok = (r) => { if (r && r.error) throw new Error(r.error); return r; };
const tokenOf = (link) => new URLSearchParams(link.slice(link.indexOf('#join?') + 6)).get('t');
// The project's document as the service has it, opened with the owner's keys.
async function docNow(id) {
  const row = sdb.prepare('SELECT body FROM shares WHERE id = ?').get(id);
  const k = share._test.keys().get(id);
  const outer = unseal(row.body, k.k);
  const open = (kind) => outer.sec?.[kind] ? unseal(outer.sec[kind], k.kinds[kind]) : null;
  return { outer, open, body: row.body };
}

// ---- the owner's Switchboard: an Acme project with notes, a to-do, a bill, an About card, and a personal page
setSetting('sync', owner);
setSetting('spaces', [{ id: 'acme', name: 'Acme', color: '#3366AA', group: 'Work' }, { id: 'home', name: 'Home', color: '#22AA66', group: 'Mine' }, { id: 'personal', name: 'Personal', color: '#8A8F98', group: 'Mine' }]);
setSetting('rules', [['acme.example', 'acme'], ['secret-client@example.com', 'acme']]);
setSetting('profiles', { acme: { about: 'Construction software', people: [{ name: 'Ana Ruiz', role: 'Client', email: 'ana@client.example' }], links: [], hidden: ['spam@x.example'] } });
share.setRepoSource((space) => space === 'acme' ? ['owner/acme-core'] : []);
share.setActivitySource(() => []);
const plan = newPage({ title: 'Launch plan', body: '<ul class="checklist"><li data-checked="false">Pick a date</li></ul>', space: 'acme' });
newPage({ title: 'Diary', body: '<p>Private</p>', space: 'personal' });
db.prepare("INSERT INTO items (kind, text, space, created_at) VALUES ('todo', 'Call the printer', 'acme', 1)").run();
db.prepare("INSERT INTO items (kind, text, space, amount, created_at) VALUES ('bill', 'Office rent', 'acme', 900, 1)").run();
let shareId, jordanSpace, rileyLink;

test('a few plain mistakes say what to do', async () => {
  await assert.rejects(share.shareProject('acme', 'owner@example.com'), /your own account/);
  await assert.rejects(share.shareProject('acme', 'not an email'), /email address/);
});

test('add Jordan to Acme: following the link is joining, with the kinds the owner chose', async () => {
  await as('jordan', ['sources', { repos: ['jordan/acme-mobile'], activity: [{ kind: 'session', name: 'fix-1105', state: 'working', prompt: 'SECRET PROMPT', detail: 'terminal text: rm -rf' }] }], ['sync']);
  await as('sam', ['sync']);
  const r = await share.shareProject('acme', 'jordan@example.com', 'Jordan', { kinds: { pages: 'edit', tasks: 'edit', repos: 'edit', activity: 'none', about: 'see' } });
  shareId = r.id;
  assert.equal(r.account, true);
  assert.ok(r.link.startsWith(SERVER + '/join#join?email=jordan%40example.com&t='), r.link);
  assert.match(r.link, /&t=[0-9a-f]{64}&p=Acme$/);
  assert.ok(notices.some(([id, t]) => id === 'a-jordan' && t === 'shares'), 'Jordan is told at once');
  const [, , st, pages, items, profile, kinds] = await as('jordan', ['link', tokenOf(r.link), 'Acme'], ['sync'], ['state'], ['pages'], ['items'], ['profile', 'sh-' + shareId.slice(0, 10)], ['kinds', shareId]);
  jordanSpace = 'sh-' + shareId.slice(0, 10);
  assert.ok(st.projects[jordanSpace], 'in, with no Join to press');
  assert.deepEqual(st.invites, []);
  assert.deepEqual(st.projects[jordanSpace].kinds, { pages: 'edit', tasks: 'edit', repos: 'edit', activity: 'none', about: 'see', checks: 'none', sessions: 'none', conversations: 'none', calendar: 'none', money: 'none', files: 'none' });
  assert.deepEqual(pages.map((p) => [p.title, p.space]), [['Launch plan', jordanSpace]]);
  assert.deepEqual(items.map((i) => [i.kind, i.text]), [['todo', 'Call the printer']], 'no bill');
  assert.equal(profile.about, 'Construction software');
  assert.equal(profile.hidden, undefined, 'who the owner waved away stays theirs');
  assert.deepEqual(kinds, ['about', 'pages', 'repos', 'tasks'], 'no key for Activity');
  await share.syncShares();
  assert.deepEqual(share.sharedRepos().map((x) => x.fullName).sort(), ['jordan/acme-mobile', 'owner/acme-core']);
  const team = share.shareState().team;
  assert.deepEqual(team.map((p) => [p.email, p.role, p.projects.map((x) => x.space)]), [['jordan@example.com', 'member', ['acme']]]);
});

test('the service keeps sealed boxes: nothing readable, and nothing that was never shared', async () => {
  const { outer, open, body } = await docNow(shareId);
  for (const plain of ['Launch plan', 'Pick a date', 'printer', 'Diary', 'acme.example', 'secret-client', 'Office rent', 'Construction', 'fix-1105']) assert.ok(!body.includes(plain), plain);
  assert.equal(outer.v, 3);
  assert.deepEqual(Object.keys(outer.sec).sort(), ['about', 'activity', 'calendar', 'checks', 'conversations', 'files', 'money', 'pages', 'repos', 'tasks'], 'every kind its own box; sessions never in it');
  for (const k of Object.keys(outer.sec)) assert.ok(!outer.sec[k].includes('Launch'), 'each kind is its own box');
  const text = JSON.stringify([open('pages'), open('tasks'), open('about'), open('repos'), open('activity')]);
  for (const never of ['acme.example', 'secret-client', 'Diary', 'Office rent', 'spam@x.example', 'SECRET PROMPT']) assert.ok(!text.includes(never), never);
  assert.ok(open('pages').rows.every((r) => r.sig && r.by), 'every row is signed by its writer');
});

test('both edit: each sees the other\'s changes, and who made them', async () => {
  await as('jordan', ['edit', plan.uid, '<ul class="checklist"><li data-checked="true">Pick a date</li><li data-checked="false">Book the hall</li></ul>'], ['todo', 'Send the invites', jordanSpace], ['sync']);
  await share.syncShares();
  assert.match(db.prepare('SELECT body FROM pages WHERE uid = ?').get(plan.uid).body, /Book the hall/);
  assert.ok(db.prepare("SELECT 1 FROM items WHERE text = 'Send the invites' AND space = 'acme'").get());
  assert.equal(share.changedBy()[plan.uid], 'Jordan');
  savePage(plan.uid, { body: '<ul class="checklist"><li data-checked="true">Pick a date</li><li data-checked="true">Book the hall</li></ul>' }, Date.now() + 50);
  await share.syncShares();
  const [, pages, by] = await as('jordan', ['sync'], ['pages'], ['changedBy']);
  assert.match(pages[0].body, /data-checked="true">Book the hall/);
  assert.equal(by[plan.uid], 'Owner');
});

test('a page added to the project from Personal (In this project) is shared, and stays in Personal for its owner', async () => {
  const { addBelongs } = await import('../lib/belongs.js');
  const notes = newPage({ title: 'Build notes', body: '<ul class="checklist"><li data-checked="false">Ship it</li></ul>', space: 'personal' });
  addBelongs({ space: 'acme', key: 'page:' + notes.uid, label: 'Build notes' });
  await share.syncShares();
  const [, pages] = await as('jordan', ['sync'], ['pages']);
  assert.ok(pages.some((p) => p.uid === notes.uid && /Ship it/.test(p.body)), 'Jordan has the added page');
  await as('jordan', ['edit', notes.uid, '<ul class="checklist"><li data-checked="true">Ship it</li></ul>'], ['sync']);
  await share.syncShares();
  const mine = db.prepare('SELECT space, body FROM pages WHERE uid = ?').get(notes.uid);
  assert.match(mine.body, /data-checked="true">Ship it/, 'his edit came back');
  assert.equal(mine.space, 'personal', 'and the page did not move out of Personal');
});

test('See only: Jordan\'s changes stay on his computer, and a cheating Switchboard is refused by everyone', async () => {
  await share.setAccess('acme', 'jordan@example.com', { pages: 'see', about: 'edit' });
  const before = db.prepare('SELECT body FROM pages WHERE uid = ?').get(plan.uid).body;
  await as('jordan', ['sync'], ['edit', plan.uid, '<p>Jordan was here</p>'], ['sync']);
  await share.syncShares();
  assert.equal(db.prepare('SELECT body FROM pages WHERE uid = ?').get(plan.uid).body, before, 'not sent');
  // Now a Switchboard that gives itself Edit: it signs and sends, and the owner's turns it away.
  const refusedBefore = share._test.refused();
  await as('jordan', ['cheat', shareId, 'pages'], ['edit', plan.uid, '<p>Jordan forced this</p>'], ['sync']);
  await share.syncShares();
  assert.equal(db.prepare('SELECT body FROM pages WHERE uid = ?').get(plan.uid).body, before, 'refused');
  assert.ok(share._test.refused() > refusedBefore);
  // And the About card he may now edit comes through.
  await as('jordan', ['sync'], ['setProfile', jordanSpace, { about: 'Construction software for small builders', people: [], links: [] }], ['sync']);
  await share.syncShares();
  assert.equal(getSetting('profiles', {}).acme.about, 'Construction software for small builders');
  assert.deepEqual(getSetting('profiles', {}).acme.hidden, ['spam@x.example']);
  await share.setAccess('acme', 'jordan@example.com', { pages: 'edit' });
  await as('jordan', ['sync']);
  await share.syncShares();
});

test('a See-only member cannot pass off a document in the old shape to get Edit for everyone (review H1)', async () => {
  await share.setAccess('acme', 'jordan@example.com', { pages: 'see' });
  const before = db.prepare('SELECT body FROM pages WHERE uid = ?').get(plan.uid).body;
  const refusedBefore = share._test.refused();
  const [, status] = await as('jordan', ['sync'], ['forgeLegacy', shareId, plan.uid, '<p>Forged by a See-only member</p>']);
  assert.equal(status, 200, 'the service takes any member\'s document');
  await share.syncShares();
  assert.equal(db.prepare('SELECT body FROM pages WHERE uid = ?').get(plan.uid).body, before, 'the unsigned edit is not merged');
  assert.equal(share._test.policyOf(shareId).grants['jordan@example.com'].kinds.pages, 'see', 'nobody was given Edit');
  assert.equal(share._test.policyOf(shareId).grants['jordan@example.com'].kinds.activity, 'none');
  assert.ok(share._test.refused() > refusedBefore, 'counted as refused');
  const { outer } = await docNow(shareId);
  assert.equal(outer.v, 3, 'the owner\'s computer put a proper document back');
  await share.setAccess('acme', 'jordan@example.com', { pages: 'edit' });
  await as('jordan', ['sync']);
  await share.syncShares();
});

test('Activity, when given, says only a session\'s name and state', async () => {
  await share.setAccess('acme', 'jordan@example.com', { activity: 'edit' });
  const [, kinds] = await as('jordan', ['sync'], ['kinds', shareId]);
  assert.ok(kinds.includes('activity'), 'the new key arrived');
  await as('jordan', ['sync']);
  await share.syncShares();
  const { open } = await docNow(shareId);
  const mine = open('activity')['jordan@example.com'];
  assert.deepEqual(Object.keys(mine.list[0]).sort(), ['at', 'kind', 'name', 'state']);
  assert.ok(!JSON.stringify(open('activity')).match(/SECRET PROMPT|terminal text|rm -rf/));
  assert.deepEqual(share.shareState().projects.acme.activity.map((a) => [a.who, a.name, a.state]), [['Jordan', 'fix-1105', 'working']]);
});

test('Only me: a private page never leaves; taking one back removes it for the others; nobody takes yours', async () => {
  const secret = newPage({ title: 'Salary notes', body: '<p>numbers</p>', space: 'acme' });
  savePage(secret.uid, { private: true }, Date.now() + 10);
  const budget = newPage({ title: 'Budget', body: '<p>totals</p>', space: 'acme' });
  await share.syncShares();
  assert.ok(!JSON.stringify((await docNow(shareId)).open('pages')).includes('Salary'));
  assert.ok((await as('jordan', ['sync'], ['pages']))[1].some((x) => x.title === 'Budget'));
  savePage(budget.uid, { private: true }, Date.now() + 100);
  await share.syncShares();
  const [, pages] = await as('jordan', ['sync'], ['pages']);
  assert.ok(!pages.some((x) => x.title === 'Budget' || x.title === 'Salary notes'));
  await as('jordan', ['private', plan.uid, true], ['sync']);
  await share.syncShares();
  assert.ok(db.prepare('SELECT 1 FROM pages WHERE uid = ?').get(plan.uid));
  assert.ok((await docNow(shareId)).open('pages').rows.some((p) => p.uid === plan.uid));
});

test('a page deleted or moved out goes for both', async () => {
  const p = newPage({ title: 'Moving', body: '<p>x</p>', space: 'acme' });
  const q = newPage({ title: 'Scratch', body: '<p>x</p>', space: 'acme' });
  await share.syncShares();
  assert.ok((await as('jordan', ['sync'], ['pages']))[1].some((x) => x.title === 'Scratch'));
  savePage(p.uid, { space: 'personal' }, Date.now() + 150);
  deletePage(q.uid, Date.now() + 200);
  await share.syncShares();
  const [, pages] = await as('jordan', ['sync'], ['pages']);
  assert.ok(!pages.some((x) => x.title === 'Moving' || x.title === 'Scratch'));
});

test('a shared edit never reaches a row that is not in the project: moved out, or a bill (review H3)', async () => {
  await share.setAccess('acme', 'jordan@example.com', { tasks: 'edit', pages: 'edit' });
  db.prepare("INSERT INTO items (kind, text, space, created_at) VALUES ('todo', 'Order paper', 'acme', 1)").run();
  const todo = db.prepare("SELECT uid FROM items WHERE text = 'Order paper'").get().uid;
  const page = newPage({ title: 'Plans for Sam', body: '<p>shared</p>', space: 'acme' });
  await share.syncShares();
  await as('jordan', ['sync']);
  // The owner moves both out of the project and writes something private in them.
  db.prepare("UPDATE items SET space = 'personal', text = 'Order paper (and the gift)', updated_at = ? WHERE uid = ?").run(Date.now() + 100, todo);
  savePage(page.uid, { space: 'personal', body: '<p>private now</p>' }, Date.now() + 100);
  await share.syncShares();
  // Jordan's computer edits them later than that (it was offline), and sends.
  await as('jordan', ['editItem', todo, 'Order paper, Jordan'], ['edit', page.uid, '<p>Jordan edited</p>'], ['sync']);
  await share.syncShares();
  const it = { ...db.prepare('SELECT space, text FROM items WHERE uid = ?').get(todo) };
  assert.deepEqual(it, { space: 'personal', text: 'Order paper (and the gift)' }, 'the to-do stays out of the project, as the owner wrote it');
  const pg = { ...db.prepare('SELECT space, body FROM pages WHERE uid = ?').get(page.uid) };
  assert.deepEqual(pg, { space: 'personal', body: '<p>private now</p>' }, 'the page too');
  // A member's to-do with the uid of the owner's bill: the bill is untouched.
  const bill = db.prepare("SELECT uid FROM items WHERE kind = 'bill'").get().uid;
  await as('jordan', ['todoUid', bill, 'Not a bill any more', jordanSpace], ['sync']);
  await share.syncShares();
  assert.deepEqual({ ...db.prepare('SELECT kind, text, space FROM items WHERE uid = ?').get(bill) }, { kind: 'bill', text: 'Office rent', space: 'acme' });
  // And when he deletes that to-do, its signed gone mark does not delete the bill (re-review H3).
  await as('jordan', ['dropItem', bill], ['sync']);
  await share.syncShares();
  assert.deepEqual({ ...db.prepare('SELECT kind, text, space FROM items WHERE uid = ?').get(bill) || {} }, { kind: 'bill', text: 'Office rent', space: 'acme' }, 'the bill is still there');
});

test('× on a shared page someone else wrote leaves it in the project for everyone (review H4)', async () => {
  const p = newPage({ title: 'Site visit notes', body: '<p>owner wrote this</p>', space: 'acme' });
  await share.syncShares();
  const [, r] = await as('jordan', ['sync'], ['takeOut', jordanSpace, p.uid], ['sync']);
  await share.syncShares();
  assert.ok(db.prepare("SELECT 1 FROM pages WHERE uid = ? AND space = 'acme'").get(p.uid), 'the owner still has it');
  assert.ok(r.restore?.onCard, 'off his card only');
  assert.match(r.sharedBy || '', /Owner/, 'and he is told who shared it');
  const [, pages] = await as('jordan', ['sync'], ['pages']);
  assert.equal(pages.find((x) => x.uid === p.uid)?.space, jordanSpace, 'and Jordan still has it, in the project');
  // Your own page: × moves it to Personal, which takes it out of the share, and says so.
  const { takeOut } = await import('../lib/sorting.js');
  const mine = takeOut('acme', { key: 'page:' + p.uid, rule: null });
  assert.equal(mine.restore?.page, p.uid);
  assert.ok(mine.unshared > 0, 'the page says it is no longer shared');
  await share.syncShares();
});

test('a computer whose clock is far ahead cannot freeze or wipe shared pages (review M1)', async () => {
  await share.setAccess('acme', 'jordan@example.com', { pages: 'edit' });
  const p = newPage({ title: 'Clock test', body: '<p>owner</p>', space: 'acme' });
  await share.syncShares();
  await as('jordan', ['sync'], ['editFuture', p.uid, '<p>from next year</p>'], ['sync']);
  await share.syncShares();
  assert.equal(db.prepare('SELECT body FROM pages WHERE uid = ?').get(p.uid).body, '<p>owner</p>', 'a change dated a year ahead is not taken');
  assert.ok(share.shareState().clockAhead?.some((c) => c.email === 'jordan@example.com'), 'and the owner is told whose clock is ahead');
  // The owner's own edit still works.
  savePage(p.uid, { body: '<p>owner again</p>' }, Date.now() + 10);
  await share.syncShares();
  assert.equal(db.prepare('SELECT body FROM pages WHERE uid = ?').get(p.uid).body, '<p>owner again</p>');
  deletePage(p.uid, Date.now() + 20);
  await as('jordan', ['sync']);
  await share.syncShares();
});

test('an About card from someone else is cleaned: text fields, and web, mail and phone links only (review M2)', async () => {
  await share.setAccess('acme', 'jordan@example.com', { about: 'edit' });
  await as('jordan', ['sync'], ['setProfile', jordanSpace, { about: 'Card', people: [{ name: 'Riley Stone', role: { x: 1 }, email: 'riley@example.com', emails: ['riley@example.com', 'riley.s@mail.example', { bad: 1 }] }, 'not a person'], links: [{ label: 'Bad', url: 'javascript:alert(1)' }, { label: 'Site', url: 'https://acme.example/' }, { label: 'Mail', url: 'mailto:hello@acme.example' }, { label: 'Phone', url: 'tel:+15550100' }, { label: 'Data', url: 'data:text/html,hi' }, { label: 'Odd', url: ' JavaScript:alert(1)' }] }], ['sync']);
  await share.syncShares();
  const card = getSetting('profiles', {}).acme;
  assert.deepEqual(card.people.find((x) => x.name === 'Riley Stone'), { name: 'Riley Stone', role: '', email: 'riley@example.com', phone: '', emails: ['riley@example.com', 'riley.s@mail.example'], phones: [] }, 'every address kept, as text');
  assert.ok(!card.people.includes('not a person'));
  assert.deepEqual(card.links, [{ label: 'Site', url: 'https://acme.example/' }, { label: 'Mail', url: 'mailto:hello@acme.example' }, { label: 'Phone', url: 'tel:+15550100' }], 'web, mail and phone links, as the About form keeps them (re-review M2)');
});

test('people\'s keys are pinned on first sight: a key swapped on the service is refused, shown, and the check codes match (review M3)', async () => {
  const { generateKeyPairSync } = await import('node:crypto');
  const real = sdb.prepare("SELECT pub FROM share_keys WHERE account_id = 'a-jordan'").get().pub;
  const fake = generateKeyPairSync('x25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  sdb.prepare("UPDATE share_keys SET pub = ? WHERE account_id = 'a-jordan'").run(fake);
  // Changing who can open a kind gives everyone new keys: nothing may be locked to the swapped one.
  await assert.rejects(share.setAccess('acme', 'jordan@example.com', { money: 'see' }), /keys/i);
  const lock = sdb.prepare(`SELECT m.lock FROM share_members m WHERE m.account_id = 'a-jordan' AND m.share_id = ?`).get(shareId).lock;
  assert.ok(!lock.includes(fake), 'no lock for the swapped key');
  const st = share.shareState();
  assert.ok(st.keys.changed.some((c) => c.email === 'jordan@example.com'), 'and Team shows that his keys changed');
  // The service puts it back: all is well again.
  sdb.prepare("UPDATE share_keys SET pub = ? WHERE account_id = 'a-jordan'").run(real);
  await share.setAccess('acme', 'jordan@example.com', { money: 'see' });
  await share.setAccess('acme', 'jordan@example.com', { money: 'none' });
  // Check codes: what the owner's computer shows for Jordan is what Jordan's shows as his own.
  const [, js] = await as('jordan', ['sync'], ['state']);
  const mineForJordan = share.shareState().keys.people.find((x) => x.email === 'jordan@example.com')?.code;
  assert.match(js.keys.mine, /^\d{4}( \d{4}){5}$/);
  assert.equal(mineForJordan, js.keys.mine);
  assert.equal(js.keys.people.find((x) => x.email === 'owner@example.com')?.code, share.shareState().keys.mine, 'and the other way round');
});

test('"the codes match" takes only the code that was shown, and never drops a kept key (re-review M3)', async () => {
  const { generateKeyPairSync } = await import('node:crypto');
  const x25519 = () => generateKeyPairSync('x25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const real = sdb.prepare("SELECT pub FROM share_keys WHERE account_id = 'a-jordan'").get().pub;
  const kept = getSetting('peerKeys', {})['jordan@example.com'];
  assert.equal(kept.pub, real);
  try {
    sdb.prepare("UPDATE share_keys SET pub = ? WHERE account_id = 'a-jordan'").run(x25519());
    await assert.rejects(share.setAccess('acme', 'jordan@example.com', { money: 'see' }), /keys/i);
    const shown = share.shareState().keys.changed.find((c) => c.email === 'jordan@example.com').code;
    assert.match(shown, /^\d{4}( \d{4}){5}$/);
    // The service swaps again after the codes were compared: approving the code shown keeps nothing.
    sdb.prepare("UPDATE share_keys SET pub = ? WHERE account_id = 'a-jordan'").run(x25519());
    await assert.rejects(share.setAccess('acme', 'jordan@example.com', { calendar: 'see' }), /keys/i);
    const now = share.shareState().keys.changed.find((c) => c.email === 'jordan@example.com').code;
    assert.notEqual(now, shown, 'Team shows the new code');
    await assert.rejects(share.trustNewKeys('jordan@example.com', shown), /changed again/);
    await assert.rejects(share.trustNewKeys('jordan@example.com'), /changed again/, 'no code, no change');
    assert.equal(getSetting('peerKeys', {})['jordan@example.com'].pub, real, 'the kept key stays');
    // A change seen only as a new signing key (a roster's) has no pair to compare: it never replaces the kept keys.
    setSetting('keyChanged', { 'jordan@example.com': { pub: null, signPub: kept.signPub + 'x', code: null, at: Date.now() } });
    await assert.rejects(share.trustNewKeys('jordan@example.com', ''), /no check code/);
    assert.deepEqual([getSetting('peerKeys', {})['jordan@example.com'].pub, getSetting('peerKeys', {})['jordan@example.com'].signPub], [real, kept.signPub]);
  } finally {
    sdb.prepare("UPDATE share_keys SET pub = ? WHERE account_id = 'a-jordan'").run(real);
    setSetting('keyChanged', {});
    setSetting('peerKeys', { ...getSetting('peerKeys', {}), 'jordan@example.com': kept });
  }
  await share.setAccess('acme', 'jordan@example.com', { money: 'none', calendar: 'none' });
});

test('a roster that does not check names nobody as owner, whoever the service says it is (review L1)', async () => {
  const row = sdb.prepare('SELECT roster, roster_sig FROM shares WHERE id = ?').get(shareId);
  sdb.prepare('UPDATE shares SET roster = ?, roster_sig = ? WHERE id = ?').run('null', 'x', shareId);
  sdb.prepare("UPDATE share_members SET role = 'member' WHERE share_id = ? AND account_id = 'a-owner'").run(shareId);
  sdb.prepare("UPDATE share_members SET role = 'owner' WHERE share_id = ? AND account_id = 'a-jordan'").run(shareId);
  try {
    const [, st] = await as('jordan', ['sync'], ['state']);
    const p = Object.values(st.projects).find((x) => x.id === shareId);
    assert.equal(p.rosterOk, false);
    assert.notEqual(p.owner, 'jordan@example.com', 'not the service\'s pick');
    assert.equal(p.owner, null);
    assert.notEqual(p.role, 'owner', 'Jordan is not told he runs it');
    assert.equal(p.canManage, false);
  } finally {
    sdb.prepare('UPDATE shares SET roster = ?, roster_sig = ? WHERE id = ?').run(row.roster, row.roster_sig, shareId);
    sdb.prepare("UPDATE share_members SET role = 'owner' WHERE share_id = ? AND account_id = 'a-owner'").run(shareId);
    sdb.prepare("UPDATE share_members SET role = 'member' WHERE share_id = ? AND account_id = 'a-jordan'").run(shareId);
  }
});

test('moving a page someone else shared to another project from the menu leaves theirs where it is (review H4)', async () => {
  const p = newPage({ title: 'Supplier list', body: '<p>owner wrote this</p>', space: 'acme' });
  await share.syncShares();
  const [, r, pages] = await as('jordan', ['sync'], ['menuMove', p.uid, 'personal'], ['pages'], ['sync']);
  await share.syncShares();
  assert.ok(db.prepare("SELECT 1 FROM pages WHERE uid = ? AND space = 'acme'").get(p.uid), 'the owner still has it, in Acme');
  assert.equal(r.status, 200);
  assert.ok(r.copy?.uid && r.copy.uid !== p.uid, 'Jordan gets a copy of his own');
  assert.match(r.sharedBy || '', /Owner/);
  const copy = pages.find((x) => x.uid === r.copy.uid);
  assert.deepEqual([copy?.space, copy?.body], ['personal', '<p>owner wrote this</p>'], 'in the project he picked');
  assert.equal(pages.find((x) => x.uid === p.uid)?.space, jordanSpace, 'and the shared one stays in the project');
  const [, again] = await as('jordan', ['sync'], ['pages']);
  assert.ok(again.some((x) => x.uid === p.uid), 'still there after he syncs');
});

test('invite by email before they have an account: the link makes them a member in one step, once, for that address only', async () => {
  const r = await share.shareProject('acme', 'riley@example.com', 'Riley', { kinds: { pages: 'see', tasks: 'none', repos: 'none', activity: 'none', about: 'see' } });
  rileyLink = r.link;
  assert.equal(r.account, false);
  const pend = sdb.prepare('SELECT * FROM share_pending').all();
  assert.equal(pend.length, 1);
  assert.ok(!JSON.stringify(pend).includes('riley@example.com'), 'the service keeps only a hash of the address');
  assert.ok(share.shareState().team.some((p) => p.email === 'riley@example.com' && p.projects[0].status === 'invited by email'));
  // Sam follows Riley's link: a different address does not get in.
  const [samTry] = await as('sam', ['link', tokenOf(rileyLink)], ['sync'], ['state']).then((x) => x.slice(2));
  assert.match(samTry.joinError, /different email address/);
  // Riley makes an account and follows the link. The owner's computer is "offline" (not syncing yet).
  peers.riley.acct = account('a-riley', 'riley@example.com');
  const [, , waiting] = await as('riley', ['link', tokenOf(rileyLink), 'Acme'], ['sync'], ['state']);
  assert.deepEqual(waiting.joining.map((j) => [j.project, j.inviterName]), [['Acme', 'Owner']]);
  assert.ok(notices.some(([id, t]) => id === 'a-owner' && t === 'shares'), 'the owner\'s computer is nudged');
  // The owner's Switchboard comes online: it hands over the keys, and Riley is in without pressing anything.
  await share.syncShares();
  const [, st, pages, items] = await as('riley', ['sync'], ['state'], ['pages'], ['items']);
  const space = Object.keys(st.projects)[0];
  assert.ok(space, 'in');
  assert.deepEqual(st.joining, []);
  assert.deepEqual(st.projects[space].kinds, { pages: 'see', tasks: 'none', repos: 'none', activity: 'none', about: 'see', checks: 'none', sessions: 'none', conversations: 'none', calendar: 'none', money: 'none', files: 'none' });
  assert.ok(pages.some((p) => p.title === 'Launch plan'));
  assert.deepEqual(items, [], 'no key for to-dos, so none');
  assert.equal(sdb.prepare('SELECT COUNT(*) AS n FROM share_pending').get().n, 0, 'the link is done with');
  // Used once: following it again does nothing more.
  const [again] = (await as('sam', ['link', tokenOf(rileyLink)], ['sync'], ['state'])).slice(2);
  assert.match(again.joinError, /ran out|already used|cancelled/);
});

test('an invitation taken without its link waits for the owner to let them in (review H2)', async () => {
  // Anyone can make an account with an address (the service does not check it), so the address alone is not enough.
  const r = await share.shareProject('acme', 'newhire@example.com', 'New hire', { kinds: { pages: 'see', tasks: 'none', repos: 'none', activity: 'none', about: 'none' } });
  assert.equal(r.account, false);
  peers.newhire = { acct: account('a-newhire', 'newhire@example.com'), data: mkdtempSync(join(tmpdir(), 'sb-share-e-')) };
  const [, st] = await as('newhire', ['sync'], ['state']);
  const inv = st.invites.find((i) => i.pending);
  assert.ok(inv, 'the invitation shows for that address');
  await as('newhire', ['answer', inv.id, true]);
  await share.syncShares();
  const x = share.shareState();
  const id = x.projects.acme.id;
  assert.equal(sdb.prepare("SELECT COUNT(*) AS n FROM share_members WHERE account_id = 'a-newhire'").get().n, 0, 'not a member: no link was used');
  const row = x.team.find((p) => p.email === 'newhire@example.com')?.projects.find((p) => p.pending);
  assert.equal(row?.status, 'asks to join', 'the owner sees them asking');
  const [, none] = await as('newhire', ['sync'], ['kinds', id]);
  assert.deepEqual(none, [], 'no keys');
  // The owner looks at the address and lets them in.
  await share.admitInvite('acme', row.pending);
  assert.equal(sdb.prepare("SELECT COUNT(*) AS n FROM share_members WHERE account_id = 'a-newhire'").get().n, 1, 'in once let in');
  await share.removeMember('acme', 'newhire@example.com');
});

test('roles: the owner makes Jordan an admin; he adds Sam with his own choices; he cannot make admins', async () => {
  await share.setRole('jordan@example.com', 'admin');
  const [, st] = await as('jordan', ['sync'], ['state']);
  assert.deepEqual([st.projects[jordanSpace].role, st.projects[jordanSpace].canManage], ['admin', true]);
  const [inv] = await as('jordan', ['invite', jordanSpace, 'sam@example.com', 'Sam', { kinds: { pages: 'edit', tasks: 'none' } }]);
  ok(inv);
  await as('sam', ['link', tokenOf(inv.link)], ['sync']);
  await share.syncShares();
  const [, samSt, samItems] = await as('sam', ['sync'], ['state'], ['items']);
  const samSpace = Object.keys(samSt.projects)[0];
  assert.equal(samSt.projects[samSpace].kinds.tasks, 'none');
  assert.deepEqual(samItems, []);
  assert.match((await as('jordan', ['role', 'sam@example.com', 'admin']))[0].error, /not in any project you shared/);
  assert.match((await as('jordan', ['remove', jordanSpace, 'owner@example.com']))[0].error, /cannot be removed/);
});

test('the service cannot make someone an admin, or bring back an old roster', async () => {
  const asAdmin = sdb.prepare('SELECT roster, roster_sig FROM shares WHERE id = ?').get(shareId);
  await share.setRole('jordan@example.com', 'member');
  await as('jordan', ['sync']);
  const now = sdb.prepare('SELECT roster, roster_sig FROM shares WHERE id = ?').get(shareId);
  const forged = JSON.parse(now.roster);
  forged.admins = { 'jordan@example.com': 'x' }; forged.seq += 5;
  sdb.prepare('UPDATE shares SET roster = ? WHERE id = ?').run(JSON.stringify(forged), shareId);
  sdb.prepare("UPDATE share_members SET role = 'admin' WHERE share_id = ? AND account_id = 'a-jordan'").run(shareId);
  await share.syncShares();
  assert.equal(share._test.rosterOf(shareId).ok, false);
  assert.equal((await as('jordan', ['sync'], ['state']))[1].projects[jordanSpace].canManage, false);
  sdb.prepare('UPDATE shares SET roster = ?, roster_sig = ? WHERE id = ?').run(asAdmin.roster, asAdmin.roster_sig, shareId);
  await share.syncShares();
  assert.equal(share._test.rosterOf(shareId).ok, false, 'an older roster is not believed');
  sdb.prepare('UPDATE shares SET roster = ?, roster_sig = ? WHERE id = ?').run(now.roster, now.roster_sig, shareId);
  sdb.prepare("UPDATE share_members SET role = 'member' WHERE share_id = ? AND account_id = 'a-jordan'").run(shareId);
  await share.syncShares();
  assert.equal(share._test.rosterOf(shareId).ok, true);
});

test('a project shared before the team moves over by itself, keeping who was in it', async () => {
  // Built the way 0.2.6 did: one key, one document, one switch per kind for everyone.
  setSetting('spaces', [...getSetting('spaces', []), { id: 'garden', name: 'Garden', color: '#22AA66', group: 'Mine' }]);
  newPage({ title: 'Seed list', body: '<p>beans</p>', space: 'garden' });
  const k = await share.myKey(), key = randomBytes(32).toString('hex');
  const id = randomBytes(12).toString('hex');
  const roster = { share: id, owner: { email: 'owner@example.com', signPub: k.signPub }, admins: {}, seq: 1, at: 1 };
  const stableSig = (o) => sign(null, Buffer.from(JSON.stringify(o, (kk, v) => (v && typeof v === 'object' && !Array.isArray(v)) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : 1)) : v)), k.signPriv).toString('base64');
  const jordanPub = sdb.prepare("SELECT pub FROM share_keys WHERE account_id = 'a-jordan'").get().pub;
  const policy = { shares: { pages: true, tasks: false, repos: true, activity: false, about: true }, at: 5, by: 'owner@example.com' };
  policy.sig = stableSig({ share: id, shares: policy.shares, at: policy.at, by: policy.by });
  const doc = { v: 2, meta: { name: 'Garden', policy }, pages: [{ uid: 'p-old', title: 'From before', body: '<p>old</p>', pinned: 0, created_at: 1, updated_at: 2, by: 'jordan@example.com' }], items: [], dead: [], repos: {}, activity: {}, about: null };
  const now = Date.now();
  sdb.prepare('INSERT INTO shares (id, owner_id, epoch, needs_rekey, version, body, roster, roster_sig, created_at, updated_at) VALUES (?, ?, 1, 0, 1, ?, ?, ?, ?, ?)').run(id, 'a-owner', seal(doc, key), JSON.stringify(roster), stableSig(roster), now, now);
  sdb.prepare("INSERT INTO share_members (share_id, account_id, role, status, lock, created_at) VALUES (?, 'a-owner', 'owner', 'joined', ?, ?)").run(id, JSON.stringify(sealForPair(key, k.pub)), now);
  sdb.prepare("INSERT INTO share_members (share_id, account_id, role, status, lock, created_at) VALUES (?, 'a-jordan', 'member', 'joined', ?, ?)").run(id, JSON.stringify(sealForPair(key, jordanPub)), now);
  setSetting('shareMap', { ...getSetting('shareMap', {}), [id]: 'garden' });
  await share.syncShares();
  const { outer, open } = await docNow(id);
  assert.equal(outer.v, 3);
  assert.deepEqual(share._test.policyOf(id).grants['jordan@example.com'].kinds, { pages: 'edit', tasks: 'none', repos: 'edit', activity: 'none', about: 'edit', checks: 'none', sessions: 'none', conversations: 'none', calendar: 'none', money: 'none', files: 'none' });
  assert.deepEqual(open('pages').rows.map((r) => r.title).sort(), ['From before', 'Seed list']);
  assert.ok(db.prepare("SELECT 1 FROM pages WHERE uid = 'p-old' AND space = 'garden'").get(), 'what Jordan wrote before is kept');
  const [, st, kinds] = await as('jordan', ['sync'], ['state'], ['kinds', id]);
  const gs = Object.entries(st.projects).find(([, p]) => p.id === id)?.[0];
  assert.ok(gs, 'Jordan is still in it');
  assert.deepEqual(kinds, ['about', 'pages', 'repos'], 'no key for to-dos: they were off');
  // An old lock no longer opens the new document.
  assert.throws(() => unseal(sdb.prepare('SELECT body FROM shares WHERE id = ?').get(id).body, key));
  await share.stopSharing('garden');
});

test('take someone off the team, leave, stop: copies stay, keys change', async () => {
  const before = sdb.prepare('SELECT epoch FROM shares WHERE id = ?').get(shareId).epoch;
  assert.equal(await share.removePerson('sam@example.com'), 1);
  assert.ok(sdb.prepare('SELECT epoch FROM shares WHERE id = ?').get(shareId).epoch > before);
  const [, map, pages] = await as('sam', ['sync'], ['shareMap'], ['pages']);
  assert.deepEqual(map, {});
  assert.ok(pages.some((p) => p.title === 'Launch plan'), 'Sam keeps the copy he had');
  const [, st] = await as('riley', ['sync'], ['state']);
  await as('riley', ['leave', Object.keys(st.projects)[0]]);
  assert.equal(sdb.prepare('SELECT needs_rekey FROM shares WHERE id = ?').get(shareId).needs_rekey, 1);
  await share.syncShares();
  assert.equal(sdb.prepare('SELECT needs_rekey FROM shares WHERE id = ?').get(shareId).needs_rekey, 0);
  await share.stopSharing('acme');
  assert.equal(sdb.prepare('SELECT COUNT(*) AS n FROM shares').get().n, 0);
  assert.deepEqual(getSetting('shareMap', {}), {});
  assert.ok(db.prepare("SELECT COUNT(*) AS n FROM pages WHERE space = 'acme'").get().n >= 3, 'nothing deleted');
  void openFromPair;
});
