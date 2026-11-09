// Everything a project has, shared kind by kind (public/js/shared/share-core.js,
// lib/share.js, lib/sessshare.js): Sam (the app, this process) gives Jordan (a
// browser, here too, through test/fake-sync.mjs) everything in Acme. Each
// published kind arrives, and only Acme's; a section of a page arrives as a
// read-only page; sessions come live from Sam's computer: only Acme's, only the
// Chat view (no terminal bytes, no file paths), a message waits for Approve
// unless Sam lets Jordan straight in, See cannot send, None gets nothing, and
// "Sam's computer is offline" when it is.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket as WsClient } from 'ws';

process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-kinds-'));
const { db, setSetting, getSetting } = await import('../lib/db.js');
const { newPage } = await import('../lib/pages.js');
const { addBelongs } = await import('../lib/belongs.js');
const share = await import('../lib/share.js');
const { makeSessionHandler } = await import('../lib/sessshare.js');
const { makeClient } = await import('../public/js/web/client.js');
const { makeAdapter } = await import('../public/js/web/adapter.js');
const { startFakeSync } = await import('./fake-sync.mjs');

const svc = await startFakeSync();
setSetting('sync', svc.account('a-sam', 'sam@example.com'));
setSetting('spaces', [{ id: 'acme', name: 'Acme', color: '#3366AA', group: 'Work' }, { id: 'home', name: 'Home', color: '#22AA66', group: 'Mine' }]);
// What Sam's computer has, in Acme and in Home (Home must never show).
const both = (acme, home) => (space) => space === 'acme' ? acme : space === 'home' ? home : [];
share.setSource('checks', both([{ name: 'Sign-in page loads', state: 'failed', at: Date.now(), detail: 'Timed out', password: 'x' }], [{ name: 'Home check', state: 'passed' }]));
share.setSource('conversations', both([{ key: 'mail:a:t1', kind: 'mail', who: 'Ana Ruiz', subject: 'Contract', date: Date.now(), snippet: 'See attached', messages: [{ from: 'Ana Ruiz', date: Date.now(), text: 'Here is the contract.' }] }], [{ key: 'mail:a:t2', who: 'Mum', subject: 'Dinner' }]));
share.setSource('calendar', both([{ title: 'Site visit', start: Date.now() + 86400e3, end: Date.now() + 90000e3, where: 'Main St' }], [{ title: 'Dentist', start: Date.now() }]));
share.setSource('money', both([{ kind: 'invoice', text: 'Acme deposit', amount: 1500, at: Date.now() }], [{ kind: 'bill', text: 'Rent', amount: 900 }]));
share.setSource('files', both([{ name: 'brief.pdf', size: 1200, at: Date.now() }], [{ name: 'taxes.pdf', size: 99 }]));
// Sam's sessions: one in Acme, one in Home. The Chat view as lib/chatview.js gives it, with things that must not travel.
const queued = [];
const terms = [{ id: 'sb-acme1', name: 'fix-1105', agentName: 'Claude', state: 'running', space: 'acme', created_at: 1 }, { id: 'sb-home1', name: 'family-photos', agentName: 'Claude', state: 'idle', space: 'home', created_at: 1 }];
share.setLiveHandler(makeSessionHandler({
  listTerms: () => terms, termRow: (id) => ({ id }), getSetting, changed: () => {},
  readChat: () => ({ file: 'f1', path: '/home/sam/.claude/projects/acme/f1.jsonl', start: 0, end: 10, reset: true, raw: '\u001b[31mTERMINAL BYTES\u001b[0m', messages: [{ k: 'user', id: 1, t: 'Fix the login' }, { k: 'tool', id: 2, name: 'Bash', sum: 'npm test', input: 'secret input' }, { k: 'text', id: 3, t: 'Done: the tests pass.' }] }),
  enqueue: (term, text, opts) => { queued.push({ term, text, ...opts }); return queued.length; }
}));
newPage({ title: 'Launch plan', body: '<p>dates</p>', space: 'acme' });
const notes = newPage({ title: 'Founders notes', body: '<h2>Hiring</h2><p>two people</p><h2>Salaries</h2><p>secret numbers</p>', space: 'home' });
addBelongs({ space: 'acme', key: `section:${notes.uid}#Hiring` });
const jordan = makeClient({ base: svc.base, WS: WsClient, persist: false });
const api = makeAdapter(jordan);
after(async () => { share._test.closeLive?.(); await jordan.signOut().catch(() => {}); svc.close(); });
let space;

test('"Give everything": every kind at its most, and each published kind from Acme only', async () => {
  assert.deepEqual(share.ALL_KINDS, { pages: 'edit', tasks: 'edit', repos: 'edit', checks: 'see', activity: 'edit', sessions: 'send', conversations: 'see', calendar: 'see', money: 'see', files: 'see', about: 'edit' });
  const r = await share.shareProject('acme', 'jordan@example.com', 'Jordan', { kinds: share.ALL_KINDS });
  await api('/api/share/link', { token: new URLSearchParams(r.link.slice(r.link.indexOf('#join?') + 6)).get('t'), project: 'Acme' });
  await api('/api/account/signup', { email: 'jordan@example.com', password: 'a long enough password' });
  await share.syncShares(); await jordan.sync();
  const st = await api('/api/state');
  space = Object.keys(st.share.projects)[0];
  const pub = st.share.projects[space].published;
  assert.deepEqual(pub.checks.map((c) => [c.name, c.state, c.password]), [['Sign-in page loads', 'failed', undefined]], 'only the fields that travel');
  assert.deepEqual(pub.conversations.map((c) => [c.who, c.messages[0].text]), [['Ana Ruiz', 'Here is the contract.']]);
  assert.deepEqual(pub.calendar.map((e) => e.title), ['Site visit']);
  assert.deepEqual(pub.money.map((m) => [m.text, m.amount]), [['Acme deposit', 1500]]);
  assert.deepEqual(pub.files.map((f) => f.name), ['brief.pdf']);
  const text = JSON.stringify(st);
  for (const never of ['Home check', 'Mum', 'Dentist', 'Rent', 'taxes.pdf', 'family-photos']) assert.ok(!text.includes(never), never);
});

test('a section of a page arrives on its own, read-only; the rest of the page never', async () => {
  const st = await api('/api/state');
  const sec = st.pages.find((p) => p.title === 'Founders notes → Hiring');
  assert.ok(sec, 'the section, as its own page');
  assert.match((await api('/api/pages/' + sec.uid)).body, /two people/);
  assert.ok(!JSON.stringify(st).includes('secret numbers'), 'not the section that was not shared');
  // Jordan cannot change it from the board; and a Switchboard that sends a change anyway is refused by Sam's.
  await assert.rejects(api('/api/pages/' + sec.uid, { body: '<h2>Hiring</h2><p>ten people</p>' }), /read-only/);
  jordan.data.pageUpdate(sec.uid, { body: '<h2>Hiring</h2><p>ten people</p>', updated_at: Date.now() + 1000 });
  const before = share._test.refused();
  await jordan.sync(); await share.syncShares();
  assert.ok(share._test.refused() > before, 'refused');
  assert.match(db.prepare('SELECT body FROM pages WHERE uid = ?').get(notes.uid).body, /two people/);
  assert.ok(!db.prepare('SELECT 1 FROM pages WHERE uid = ?').get(sec.uid), 'and keeps no copy of it');
});

test('sessions: only Acme\'s, only the Chat view, and a message waits for Approve', async () => {
  const list = await api('/api/share/sessions?space=' + space);
  assert.ok(list.sessions, JSON.stringify(list));
  assert.deepEqual(list.sessions.map((x) => [x.name, x.state]), [['fix-1105', 'working']], 'not the Home session');
  const chat = await api(`/api/share/session?space=${space}&term=sb-acme1`);
  assert.deepEqual(chat.messages.map((m) => m.k), ['user', 'tool', 'text']);
  const text = JSON.stringify(chat);
  for (const never of ['TERMINAL BYTES', '\u001b', '/home/sam', 'secret input', '.jsonl']) assert.ok(!text.includes(never), never);
  await assert.rejects(api(`/api/share/session?space=${space}&term=sb-home1`), /not in this project/);
  const sent = await api('/api/share/session-send', { space, term: 'sb-acme1', text: 'Can you also check the logout?' });
  assert.equal(sent.held, true, 'held until Sam releases it');
  assert.deepEqual(queued.at(-1), { term: 'sb-acme1', text: 'Can you also check the logout?', source: 'Jordan asks', held: true });
  // Sam lets Jordan straight into that session: the next one goes in.
  setSetting('sessionAuto', { 'jordan@example.com': { 'sb-acme1': true } });
  assert.equal((await api('/api/share/session-send', { space, term: 'sb-acme1', text: 'Thanks' })).held, false);
  await assert.rejects(api('/api/share/session-send', { space, term: 'sb-home1', text: 'x' }), /not in this project/);
});

test('See can watch but not send; None gets nothing', async () => {
  await share.setAccess('acme', 'jordan@example.com', { sessions: 'see' });
  await jordan.sync();
  assert.equal((await api('/api/share/sessions?space=' + space)).sessions.length, 1);
  await assert.rejects(api('/api/share/session-send', { space, term: 'sb-acme1', text: 'x' }), /not send/);
  await share.setAccess('acme', 'jordan@example.com', { sessions: 'none' });
  await jordan.sync();
  await assert.rejects(api('/api/share/sessions?space=' + space), /not shared with you/);
});

test('when Sam\'s computer is not online: "offline", in plain words', async () => {
  await share.setAccess('acme', 'jordan@example.com', { sessions: 'see' });
  await jordan.sync();
  share._test.closeLive();
  await new Promise((ok) => setTimeout(ok, 200));
  const r = await api('/api/share/sessions?space=' + space);
  assert.match(r.offline, /Sam's computer is offline/);
});

test('a kind turned off stops arriving', async () => {
  await share.setAccess('acme', 'jordan@example.com', { conversations: 'none', money: 'none' });
  await jordan.sync();
  const pub = (await api('/api/state')).share.projects[space].published;
  assert.equal(pub.conversations, undefined);
  assert.equal(pub.money, undefined);
  assert.ok(pub.calendar.length, 'the rest stays');
});
