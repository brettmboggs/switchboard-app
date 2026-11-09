// Team chat (lib/chat.js, sync-worker/src/chat.js), end to end: the real
// service code over a stand-in for its database, this process as the owner of
// a shared project ("owner@example.com") and child processes
// (test/chat-peer.mjs) as Jordan and Sam, who join it, and Riley, who has an
// account and is in no project. A message in the project channel reaches the
// others, and live (the service's relay notice fetches it, here handed
// straight to the owner's lib/chat.js); seen, typing, edit and delete your own
// (and nobody else's, even from a Switchboard that cheats), reply, react, pin,
// @mention alerts; one-to-one chats; someone outside, or removed, reads
// nothing; and the service only ever holds ciphertext.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const here = dirname(fileURLToPath(import.meta.url));
process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-chat-a-'));
const { db, setSetting } = await import('../lib/db.js');
const { unseal } = await import('../lib/sync.js');
const share = await import('../lib/share.js');
const chat = await import('../lib/chat.js');
const { shareRoute } = await import('../sync-worker/src/shares.js');
const { chatRoute } = await import('../sync-worker/src/chat.js');

// ---- the sync service: its share and chat routes over node:sqlite, shaped like Cloudflare D1
const sdb = new DatabaseSync(':memory:');
for (const f of ['schema.sql', 'schema-v5.sql', 'schema-v6.sql', 'schema-v8.sql']) sdb.exec(readFileSync(join(here, '../sync-worker', f), 'utf8'));
const stmt = (sql, args = []) => ({
  bind: (...a) => stmt(sql, a),
  first: async () => sdb.prepare(sql).get(...args) ?? null,
  all: async () => ({ results: sdb.prepare(sql).all(...args) }),
  run: async () => ({ meta: { changes: Number(sdb.prepare(sql).run(...args).changes) } }),
  now: () => sdb.prepare(sql).run(...args)
});
const env = { DB: { prepare: (sql) => stmt(sql), batch: async (list) => { sdb.exec('BEGIN'); try { for (const s of list) s.now(); sdb.exec('COMMIT'); } catch (e) { sdb.exec('ROLLBACK'); throw e; } } } };
const tokens = new Map(), notices = [], live = [];
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
// The relay: every notice is recorded; the owner's are handed to the owner's Switchboard as its relay would.
const notice = async (e, id, msg) => { notices.push([id, msg]); if (id === 'a-owner' && msg.type === 'chat') live.push(chat.chatNotice(msg)); };
const server = createServer(async (req, res) => {
  let text = ''; for await (const c of req) text += c;
  const url = new URL(req.url, 'http://127.0.0.1');
  const acct = tokens.get((req.headers.authorization || '').replace(/^Bearer /, ''));
  const ctx = { req, env, path: url.pathname, url, body: text ? JSON.parse(text) : {}, acct: { id: acct }, json, bad: (error, status = 400) => json({ error }, status), notice, limited: async () => false, maxDoc: 900 * 1024 };
  const r = !acct ? json({ error: 'Signed out.' }, 401) : (await shareRoute(ctx)) || (await chatRoute(ctx)) || json({ error: 'Not found.' }, 404);
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
  jordan: { acct: account('a-jordan', 'jordan@example.com'), data: mkdtempSync(join(tmpdir(), 'sb-chat-b-')) },
  sam: { acct: account('a-sam', 'sam@example.com'), data: mkdtempSync(join(tmpdir(), 'sb-chat-c-')) },
  riley: { acct: account('a-riley', 'riley@example.com'), data: mkdtempSync(join(tmpdir(), 'sb-chat-d-')) }
};
const run = promisify(execFile);
// Each person's steps start by catching up: shares, then chat.
async function as(who, ...steps) {
  const p = peers[who];
  const { stdout } = await run(process.execPath, ['--disable-warning=ExperimentalWarning', join(here, 'chat-peer.mjs'), JSON.stringify([['account', p.acct], ['sync'], ...steps])], { env: { ...process.env, SWITCHBOARD_DATA: p.data } });
  return JSON.parse(stdout).slice(2);
}
const ok = (r) => { if (r && r.error) throw new Error(r.error); return r; };
const tokenOf = (link) => new URLSearchParams(link.slice(link.indexOf('#join?') + 6)).get('t');
const svc = async (who, path, body) => { const r = await fetch(SERVER + path, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${peers[who].acct.token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json() }; };
const ownerAlerts = [];
chat.onChatAlert((kind, title, body) => ownerAlerts.push([kind, title, body]));
const catchUp = async () => { await share.syncShares(); await chat.syncChat(); };
const settle = async () => { while (live.length) await live.shift(); };

setSetting('sync', owner);
setSetting('spaces', [{ id: 'acme', name: 'Acme', color: '#3366AA', group: 'Work' }, { id: 'personal', name: 'Personal', color: '#8A8F98', group: 'Mine' }]);
share.setRepoSource(() => []);
share.setActivitySource(() => []);
// The shared "conversations" kind is on, publishing one of the owner's mail threads; team chat must never join it.
share.setSource('conversations', (space) => space === 'acme' ? [{ key: 'mail:owner@example.com:t1', kind: 'mail', who: 'Acme supplier', subject: 'Paper order', date: Date.now(), snippet: 'The paper ships Monday', messages: [] }] : []);
let shareId, project, dmJordan, hello;
const said = [];   // every word said, to look for in what the service keeps

test('Jordan and Sam join Acme: a channel for the project, and a one-to-one chat with each', async () => {
  await as('jordan'); await as('sam'); await as('riley');   // each opens Switchboard once: their sharing keys
  for (const [who, name] of [['jordan', 'Jordan'], ['sam', 'Sam']]) {
    const r = await share.shareProject('acme', `${who}@example.com`, name, { kinds: { pages: 'edit', tasks: 'edit', repos: 'see', activity: 'none', about: 'see', conversations: 'see' } });
    shareId = r.id;
    await as(who, ['link', tokenOf(r.link), 'Acme'], ['sync']);
  }
  await catchUp();
  project = 'team:p' + shareId;
  const board = chat.chatBoard();
  assert.deepEqual(board.channels.map((c) => [c.kind, c.who, c.space]), [['project', 'Acme', 'acme'], ['direct', 'Jordan', 'acme'], ['direct', 'Sam', 'acme']]);
  assert.equal(board.channels[0].key, project);
  dmJordan = board.channels[1].key;
  const [jb] = await as('jordan', ['board']);
  assert.deepEqual(jb.channels.map((c) => [c.kind, c.who]), [['project', 'Acme'], ['direct', 'Owner'], ['direct', 'Sam']]);
  assert.equal(jb.channels.find((c) => c.who === 'Owner').key, dmJordan, 'the same chat from both ends');
});

test('someone in no project of yours sees no chat of it, and the service turns them away', async () => {
  const [rb] = await as('riley', ['board']);
  assert.deepEqual(rb.channels, []);
  assert.equal((await svc('riley', '/v1/chat')).json.channels.length, 0);
  assert.equal((await svc('riley', `/v1/chat/p${shareId}?after=0`)).status, 404);
  assert.equal((await svc('riley', `/v1/chat/p${shareId}`, { body: '1.xxxx' })).status, 404);
  assert.equal((await svc('riley', `/v1/chat/${dmJordan.slice(5)}?after=0`)).status, 404, 'nor anyone else\'s one-to-one');
  assert.equal((await svc('sam', `/v1/chat/${dmJordan.slice(5)}?after=0`)).status, 404, 'not even a teammate');
});

test('send in the channel: everyone in the project gets it, an @mention alerts only the one mentioned', async () => {
  hello = ok(await chat.sendChat(project, { text: 'Morning both. @Jordan the launch plan is ready' }));
  said.push('Morning both', 'launch plan is ready');
  assert.ok(notices.some(([id, m]) => id === 'a-jordan' && m.type === 'chat' && m.chan === project.slice(5) && m.seq === hello.seq), 'Jordan is told at once');
  assert.ok(!notices.some(([, m]) => m.type === 'chat' && JSON.stringify(m).includes('Morning')), 'the notice carries no words');
  const [threads, convo, alerts] = await as('jordan', ['threads'], ['convo', project], ['alerts']);
  const t = threads.waiting.find((x) => x.key === project);
  assert.ok(t, 'waiting in Jordan\'s Inbox');
  assert.equal(t.kind, 'team'); assert.equal(t.who, 'Acme'); assert.equal(t.unread, true);
  assert.equal(t.snippet, 'Owner: Morning both. @Jordan the launch plan is ready');
  const m = convo.messages.at(-1);
  assert.equal(m.from_name, 'Owner'); assert.equal(m.from_me, 0); assert.equal(m.mention, true);
  assert.deepEqual(alerts, [['chat', 'Owner · Acme', 'Morning both. @Jordan the launch plan is ready']]);
  const [samAlerts] = await as('sam', ['alerts']);
  assert.deepEqual(samAlerts, [], 'no alert for every line in a channel');
  assert.ok(chat.chatThreads().recent.some((x) => x.key === project), 'yours: in Replied');
});

test('received live: the service\'s relay notice fetches the new line, no sync needed', async () => {
  const before = db.prepare('SELECT COUNT(*) AS n FROM chat_lines WHERE chan = ?').get(project.slice(5)).n;
  ok((await as('jordan', ['send', project, { text: 'Great, reading it now' }]))[0]);
  said.push('reading it now');
  await settle();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM chat_lines WHERE chan = ?').get(project.slice(5)).n, before + 1);
  const t = chat.chatThreads().waiting.find((x) => x.key === project);
  assert.equal(t.snippet, 'Jordan: Great, reading it now');
});

test('typing and seen: Jordan types and you see it; you read and Jordan sees "Seen"', async () => {
  await as('jordan', ['typing', project]);
  await settle();
  assert.deepEqual((await chat.chatConversation(project)).typing, ['Jordan']);
  assert.ok(!notices.some(([id, m]) => id === 'a-jordan' && m.typing), 'not told to the one typing');
  ok(await chat.markSeen(project));
  assert.equal(chat.chatThreads().waiting.find((x) => x.key === project).unread, false);
  const [convo] = await as('jordan', ['convo', project]);
  const mine = convo.messages.find((m) => m.text === 'Great, reading it now');
  assert.deepEqual(mine.seen, ['Owner']);
  assert.deepEqual(mine.seenBy, ['Owner']);
  assert.deepEqual(convo.messages.find((m) => m.id === hello.id).seen, [], 'only under your own messages');
});

test('edit and delete your own; nobody can change someone else\'s, even a Switchboard that cheats', async () => {
  ok(await chat.chatAct(project, { what: 'edit', id: hello.id, text: 'Morning both. @Jordan the launch plan is ready, page 2 changed' }));
  said.push('page 2 changed');
  let [convo] = await as('jordan', ['convo', project]);
  let m = convo.messages.find((x) => x.id === hello.id);
  assert.match(m.text, /page 2 changed/); assert.ok(m.edited > 0);
  const [refused, forged] = await as('jordan', ['act', project, { what: 'edit', id: hello.id, text: 'hacked' }], ['forge', project, { t: 'edit', ref: hello.id, text: 'Forged words' }]);
  assert.match(refused.error, /only change your own/);
  assert.equal(typeof forged, 'number', 'the service took it: it cannot tell');
  await catchUp();
  assert.match((await chat.chatConversation(project)).messages.find((x) => x.id === hello.id).text, /page 2 changed/, 'and nobody believes it');
  [convo] = await as('sam', ['convo', project]);
  assert.match(convo.messages.find((x) => x.id === hello.id).text, /page 2 changed/);
  const extra = ok(await chat.sendChat(project, { text: 'Typo, ignore' }));
  ok(await chat.chatAct(project, { what: 'delete', id: extra.id }));
  [convo] = await as('jordan', ['convo', project]);
  m = convo.messages.find((x) => x.id === extra.id);
  assert.equal(m.deleted, true); assert.equal(m.text, '');
});

test('reply, react and pin: Sam answers a message, reacts and pins it; everyone sees it', async () => {
  const [r] = await as('sam', ['send', project, { text: 'I can do the printing', reply: hello.id }], ['act', project, { what: 'react', id: hello.id, emoji: '👍', on: true }], ['act', project, { what: 'pin', id: hello.id, on: true }]);
  ok(r);
  said.push('do the printing');
  await settle();
  const c = await chat.chatConversation(project);
  const ans = c.messages.find((x) => x.text === 'I can do the printing');
  assert.equal(ans.reply.id, hello.id); assert.equal(ans.reply.from_name, 'You');
  const h = c.messages.find((x) => x.id === hello.id);
  assert.deepEqual(h.reactions, [{ emoji: '👍', n: 1, mine: false, who: ['Sam'] }]);
  assert.equal(h.pinned, true);
  assert.deepEqual(c.pins.map((p) => [p.id, p.by]), [[hello.id, 'Sam']]);
  assert.deepEqual(c.members.map((x) => x.name).sort(), ['Jordan', 'Sam']);
});

test('one-to-one: only the two of you, and a message to you alerts (and pushes) you', async () => {
  ok(await chat.sendChat(dmJordan, { text: 'Can we talk about the budget?' }));
  said.push('talk about the budget');
  const [threads, alerts] = await as('jordan', ['threads'], ['alerts']);
  const t = threads.waiting.find((x) => x.key === dmJordan);
  assert.equal(t.who, 'Owner'); assert.equal(t.snippet, 'Can we talk about the budget?');
  assert.deepEqual(alerts.at(-1), ['chat', 'Owner', 'Can we talk about the budget?']);
  ok((await as('jordan', ['send', dmJordan, { text: 'Yes, at three' }]))[0]);
  said.push('Yes, at three');
  await settle();
  assert.deepEqual(ownerAlerts.at(-1), ['chat', 'Jordan', 'Yes, at three'], 'live, and alerted');
  const [samBoard] = await as('sam', ['board']);
  assert.ok(!samBoard.channels.some((c) => c.key === dmJordan));
});

test('removed from the project: Sam reads nothing new, the others still do', async () => {
  await share.removeMember('acme', 'sam@example.com');
  ok(await chat.sendChat(project, { text: 'Sam has moved on to another job' }));
  said.push('moved on to another job');
  assert.equal((await svc('sam', `/v1/chat/p${shareId}?after=0`)).status, 404);
  const [board] = await as('sam', ['board']);
  assert.deepEqual(board.channels, []);
  const [convo] = await as('jordan', ['convo', project]);
  assert.equal(convo.messages.at(-1).text, 'Sam has moved on to another job', 'sealed with the new key, and Jordan has it');
  assert.equal(convo.unreadable, 0);
  const row = sdb.prepare('SELECT body FROM chat_log WHERE chan = ? ORDER BY seq DESC').get('p' + shareId);
  assert.ok(Number(row.body.split('.')[0]) > 1, 'a new epoch');
});

test('the service only ever holds ciphertext', async () => {
  const rows = sdb.prepare('SELECT chan, sender_id, body FROM chat_log').all();
  assert.ok(rows.length >= 10);
  const all = rows.map((r) => r.body).join('\n');
  for (const words of [...said, 'Forged words', 'Typo', '👍', 'jordan@example.com', 'owner@example.com', 'Acme']) assert.ok(!all.includes(words), words);
  for (const r of rows) {
    const [epoch, sealed] = r.body.split('.');
    assert.match(epoch, /^\d+$/);
    assert.match(sealed, /^[A-Za-z0-9+/=]+$/);
    assert.throws(() => JSON.parse(Buffer.from(sealed, 'base64').toString('utf8')), 'not readable as it is');
  }
  // What else it keeps: who read how far, and which two accounts a chat is between. No words.
  assert.deepEqual(Object.keys(sdb.prepare('SELECT * FROM chat_seen LIMIT 1').get()).sort(), ['account_id', 'at', 'chan', 'seq']);
  assert.ok(!JSON.stringify(sdb.prepare('SELECT * FROM chat_direct').all()).includes('@'));
});

test('team chat is its own Inbox kind, never part of the project\'s shared conversations', async () => {
  await share.syncShares();
  const row = sdb.prepare('SELECT body FROM shares WHERE id = ?').get(shareId);
  const k = share._test.keys().get(shareId);
  const outer = unseal(row.body, k.k);
  const open = (kind) => outer.sec?.[kind] ? unseal(outer.sec[kind], k.kinds[kind]) : null;
  const doc = JSON.stringify([outer.meta, ...Object.keys(outer.sec || {}).map(open)]);
  assert.match(doc, /Paper order/, 'the shared conversations box is there, and open');
  for (const words of said) assert.ok(!doc.includes(words), words);
  assert.ok(!doc.includes('team:'), 'no team chat key in it');
  const [threads] = await as('jordan', ['threads']);
  assert.ok([...threads.waiting, ...threads.recent].every((t) => t.kind === 'team' && t.key.startsWith('team:')));
});
