// Bring in a message (lib/bring.js): recent conversations, one per thread,
// newest first, newsletters and senders never written to left out, each in the project its rules give it,
// so a new rule moves a person's conversations at once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-bring-'));
const { db, setSetting } = await import('../lib/db.js');
const { recentConversations } = await import('../lib/bring.js');

const now = Date.now();
const add = (id, thread, from, to, date, extra = {}) => db.prepare(`INSERT INTO mail (account, msg_id, thread_id, from_name, from_addr, to_addrs, subject, snippet, date, inbox, unread, from_me, bulk, kind)
  VALUES ('me@example.com', ?, ?, ?, ?, ?, 'Subject', 'Words', ?, 1, 0, ?, ?, 'mail')`).run(id, thread, extra.name || '', from, to, date, extra.me ? 1 : 0, extra.bulk ? 1 : 0);

add('1', 't1', 'pat@client.example', 'me@example.com', now - 3000, { name: 'Pat' });
add('2', 't1', 'pat@client.example', 'me@example.com', now - 1000, { name: 'Pat' });
add('3', 't2', 'me@example.com', 'sam@other.example', now - 2000, { me: true });
add('4', 't3', 'news@shop.example', 'me@example.com', now - 500, { bulk: true });
add('5', 't4', 'old@client.example', 'me@example.com', now - 90 * 86400e3);
add('6', 't5', 'alerts@bank.example', 'me@example.com', now - 400, { name: 'Bank' });
db.prepare('INSERT INTO contacts (addr, last_at) VALUES (?, ?)').run('pat@client.example', now);

test('one row per conversation, newest first: no newsletters, no senders never written to, nothing older than 60 days', () => {
  const list = recentConversations(now);
  assert.deepEqual(list.map((x) => x.key), ['mail:me@example.com:t1', 'mail:me@example.com:t2']);
  assert.equal(list[0].who, 'Pat');
  assert.equal(list[1].who, 'sam@other.example');
  assert.match(list[1].snippet, /^You: /);
});

test('a rule puts a person\'s conversations in a project straight away, written either way', () => {
  assert.equal(recentConversations(now)[0].space, 'personal');
  setSetting('rules', [['client.example', 'acme'], ['sam@other.example', 'acme']]);
  const list = recentConversations(now);
  assert.equal(list[0].space, 'acme');
  assert.equal(list[1].space, 'acme');
});
