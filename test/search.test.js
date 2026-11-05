// Ctrl K's conversation search (lib/search.js): every word must match, in any
// order and any case; a match on who it is ranks above one in the subject; mail
// results carry what the Inbox needs to open them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-search-'));
const { matcher, searchConversations } = await import('../lib/search.js');

const list = [
  { key: 'mail:me@example.com:t1', kind: 'mail', who: 'Pat Doe', from: 'pat@client.example', subject: 'Invoice for Sam', snippet: 'Here it is', date: 3 },
  { key: 'teams:19:abc', kind: 'teams', who: 'Sam Rivera', from: '', subject: '', snippet: 'Build is red', date: 1 },
  { key: 'mail:me@example.com:t2', kind: 'mail', who: 'José', from: 'jose@example.com', subject: 'Gate code', snippet: '', date: 2 }
];

test('every word, any order, any case, accents ignored', () => {
  assert.equal(matcher('')?.('x') ?? null, null);
  assert.ok(matcher('red build')('Build is RED'));
  assert.ok(!matcher('red build blue')('Build is red'));
  assert.ok(matcher('jose')('José'));
});

test('who it is ranks first; mail carries account, thread and link', () => {
  const r = searchConversations('sam', { list });
  assert.deepEqual(r.map((x) => x.who), ['Sam Rivera', 'Pat Doe']);
  assert.equal(r[1].account, 'me@example.com');
  assert.equal(r[1].threadId, 't1');
  assert.ok(!('account' in r[0]), 'Teams has no mail account');
  assert.deepEqual(searchConversations('   ', { list }), []);
  assert.equal(searchConversations('gate', { list }).length, 1);
});

test('older mail: people only, every word, newest thread first', async () => {
  const { db } = await import('../lib/db.js');
  const { olderConversations } = await import('../lib/search.js');
  const old = Date.now() - 200 * 86400e3;
  db.prepare("INSERT INTO contacts (addr, last_at) VALUES ('pat@client.example', 1)").run();
  const add = (id, thread, from, name, subject, date, bulk = 0) => db.prepare(`INSERT INTO mail (account, msg_id, thread_id, from_name, from_addr, to_addrs, subject, snippet, date, inbox, unread, from_me, bulk, kind)
    VALUES ('me@example.com', ?, ?, ?, ?, 'me@example.com', ?, 'about the fence', ?, 0, 0, 0, ?, 'mail')`).run(id, thread, name, from, subject, date, bulk);
  add('o1', 'ot1', 'pat@client.example', 'Pat', 'Fence quote', old);
  add('o2', 'ot1', 'pat@client.example', 'Pat', 'Re: Fence quote', old + 1000);
  add('o3', 'ot2', 'deals@shop.example', 'Shop', 'Fence sale', old, 1);
  add('o4', 'ot3', 'stranger@x.example', 'Someone', 'Fence', old);
  add('o5', 'ot4', 'pat@client.example', 'Pat', 'Fence this week', Date.now());
  const r = olderConversations('fence pat');
  assert.deepEqual(r.map((t) => [t.key, t.subject]), [['mail:me@example.com:ot1', 'Re: Fence quote']]);
  assert.equal(r[0].threadId, 'ot1');
  assert.deepEqual(olderConversations('fence pat zebra'), []);
  assert.deepEqual(olderConversations('%'), []);
});
