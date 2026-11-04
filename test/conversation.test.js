import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.SWITCHBOARD_DATA = process.env.SWITCHBOARD_DATA || '/tmp/switchboard-test';
const { htmlToText, tidy, fromTeams, fromOutlook, fromMail, parseKey, conversation } = await import('../lib/conversation.js');

test('Teams HTML keeps words, line breaks and links', () => {
  assert.equal(htmlToText('<p>Hi&nbsp;Brett,</p><p>see <a href="https://x.com/a?b=1&amp;c=2">the doc</a></p>'), 'Hi Brett,\nsee the doc (https://x.com/a?b=1&c=2)');
  assert.equal(htmlToText('one<br>two<br/>three'), 'one\ntwo\nthree');
  assert.equal(htmlToText('<a href="https://a.io">https://a.io</a>'), 'https://a.io');
  assert.equal(htmlToText('<ul><li>eggs</li><li>milk</li></ul>'), '• eggs\n• milk');
  assert.equal(htmlToText('&lt;b&gt; &#39;q&#39; &#x2713; &quot;'), '<b> \'q\' ✓ "');
  assert.equal(htmlToText('<style>p{}</style><div>ok</div>'), 'ok');
  assert.equal(htmlToText(''), '');
});

test('tidy sorts oldest first, drops duplicates, keeps the newest few', () => {
  const l = [{ id: 'c', text: 'c', date: 3 }, { id: 'a', text: 'a', date: 1 }, { id: 'b', text: 'b', date: 2 }, { id: 'a', text: 'a', date: 1 }];
  assert.deepEqual(tidy(l, 10).map((m) => m.id), ['a', 'b', 'c']);
  assert.deepEqual(tidy(l, 2).map((m) => m.id), ['b', 'c']);
});

test('a local stand-in for a sent reply goes once the real copy arrives', () => {
  const local = { id: 'local-1', from_me: 1, text: 'Sounds good, see you Thursday.', date: 10 };
  const them = { id: 'm1', from_me: 0, text: 'Thursday?', date: 5 };
  assert.deepEqual(tidy([them, local], 10).map((m) => m.id), ['m1', 'local-1']);
  const real = { id: 'm2', from_me: 1, text: 'Sounds good, see you Thursday. Brett', date: 12 };
  assert.deepEqual(tidy([them, local, real], 10).map((m) => m.id), ['m1', 'm2']);
});

test('Teams messages: system events and deletions skipped, mine marked, files listed', () => {
  const raw = [
    { id: '1', messageType: 'message', from: { user: { id: 'me', displayName: 'Brett' } }, body: { contentType: 'html', content: '<p>On it</p>' }, createdDateTime: '2026-11-03T10:00:00Z' },
    { id: '2', messageType: 'systemEventMessage', createdDateTime: '2026-11-03T10:01:00Z' },
    { id: '3', messageType: 'message', deletedDateTime: '2026-11-03T10:02:00Z', createdDateTime: '2026-11-03T10:02:00Z' },
    { id: '4', messageType: 'message', from: { user: { id: 'sam', displayName: 'Sam' } }, body: { contentType: 'text', content: '' }, attachments: [{ contentType: 'reference', name: 'plan.pdf', contentUrl: 'https://sp/plan.pdf' }], createdDateTime: '2026-11-03T10:03:00Z', lastEditedDateTime: '2026-11-03T10:04:00Z' }
  ];
  const out = fromTeams(raw, 'me');
  assert.equal(out.length, 2);
  assert.deepEqual([out[0].from_me, out[0].text, out[0].from_name], [1, 'On it', 'Brett']);
  assert.deepEqual([out[1].from_me, out[1].text], [0, 'Attachment: plan.pdf https://sp/plan.pdf']);
  assert.ok(out[1].edited > out[1].date);
});

test('Outlook and mail rows become the same shape', () => {
  const o = fromOutlook([{ id: 'x', from: { emailAddress: { name: 'Me', address: 'Me@Datum.com' } }, uniqueBody: { contentType: 'text', content: 'a\r\n\r\n\r\n\r\nb' }, receivedDateTime: '2026-11-03T10:00:00Z' }], 'me@datum.com');
  assert.deepEqual([o[0].from_me, o[0].text], [1, 'a\n\nb']);
  const m = fromMail([{ msg_id: 'g1', from_name: 'Sam', from_addr: 's@x.com', snippet: 'hi', date: 5, from_me: 0, subject: 'Hello' }]);
  assert.deepEqual(m[0], { id: 'g1', from_name: 'Sam', from_addr: 's@x.com', from_me: 0, subject: 'Hello', text: 'hi', date: 5 });
});

test('keys, and unknown ones refused', async () => {
  assert.deepEqual(parseKey('mail:a@b.com:t:1'), { kind: 'mail', account: 'a@b.com', id: 't:1' });
  assert.deepEqual(parseKey('teams:19:abc@thread.v2'), { kind: 'teams', id: '19:abc@thread.v2' });
  assert.equal(parseKey('nope:1'), null);
  await assert.rejects(conversation('nope:1'), /Unknown conversation/);
});
