// Email drafts (lib/drafts.js): each linked to the conversation it answers
// when Switchboard has that conversation, and never counted as mail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-drafts-'));
const { db, setSetting } = await import('../lib/db.js');
const { drafts } = await import('../lib/drafts.js');

test('a draft shows in its conversation when there is one, on its own when not', () => {
  setSetting('gmail', [{ email: 'me@example.com', password: 'x' }]);
  db.prepare(`INSERT INTO mail (account, msg_id, thread_id, from_name, from_addr, to_addrs, subject, snippet, date, inbox, unread, from_me, bulk, kind)
    VALUES ('me@example.com', 'm1', 't1', 'Pat', 'pat@x.example', 'me@example.com', 'Quote', 'hi', 1, 1, 0, 0, 0, 'mail')`).run();
  const add = (id, thread, date) => db.prepare(`INSERT INTO drafts (account, msg_id, thread_id, to_addrs, subject, text, date) VALUES ('me@example.com', ?, ?, 'pat@x.example', 'Re: Quote', 'Thanks', ?)`).run(id, thread, date);
  add('d1', 't1', 2); add('d2', 'tX', 3);
  db.prepare("INSERT INTO drafts (account, msg_id, thread_id, text, date) VALUES ('gone@example.com', 'd3', 't1', 'x', 4)").run();
  const list = drafts();
  assert.deepEqual(list.map((d) => [d.id, d.thread]), [['d2', null], ['d1', 'mail:me@example.com:t1']]);
  assert.equal(list[1].key, 'draft:me@example.com:d1');
});
