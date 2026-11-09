// Granola: its Markdown summary as a Notes page, the project from who was in
// the meeting, reading new and changed notes (a page you edited or deleted is
// left alone), and a key Granola refuses is not saved. A stand-in for
// public-api.granola.ai: nothing real is called.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-granola-'));
const { mdToHtml, notePage, noteSpace, pollGranola, connectGranola, disconnectGranola, granolaStatus, pageUid } = await import('../lib/granola.js');
const { db, getSetting, setSetting } = await import('../lib/db.js');
const { getPage, savePage, deletePage } = await import('../lib/pages.js');

setSetting('spaces', [{ id: 'personal', name: 'Personal' }, { id: 'acme', name: 'Acme' }, { id: 'home', name: 'Home' }]);
setSetting('rules', [['acme.com', 'acme'], ['insurance', 'home']]);

test('Granola Markdown becomes the HTML Notes keeps', () => {
  const html = mdToHtml('### Decisions\n- Ship **Friday**\n  - tell *Sam*\n- Budget [doc](https://x.test/d)\n\n### Action items\n- [ ] Send the quote\n- [x] Book the room\n\n1. one\n2. two\n\nPlain <script>alert(1)</script> line');
  assert.equal(html,
    '<h3>Decisions</h3><ul><li>Ship <b>Friday</b><ul><li>tell <i>Sam</i></li></ul></li><li>Budget doc (https://x.test/d)</li></ul>'
    + '<h3>Action items</h3><ul class="checklist"><li data-checked="false">Send the quote</li><li data-checked="true">Book the room</li></ul>'
    + '<ol><li>one</li><li>two</li></ol><p>Plain &lt;script&gt;alert(1)&lt;/script&gt; line</p>');
});

const note = (id, over = {}) => ({
  id, object: 'note', title: 'Quote review', owner: { name: 'Me', email: 'me@mine.test' },
  created_at: '2026-11-05T15:00:00Z', updated_at: '2026-11-05T16:00:00Z', deleted_at: null,
  web_url: 'https://notes.granola.ai/d/abc', calendar_event: { event_title: 'Quote review', invitees: [{ email: 'sam@acme.com' }], organiser: 'me@mine.test', scheduled_start_time: '2026-11-05T15:00:00Z' },
  attendees: [{ name: 'Me', email: 'me@mine.test' }, { name: 'Sam Lee', email: 'sam@acme.com' }],
  summary_text: 'x', summary_markdown: '- Price agreed', private_notes_markdown: 'call back', transcript: null, ...over
});

test('a note as a page, in the project of who was there', () => {
  const p = notePage(note('not_aaaaaaaaaaaaaa'));
  assert.equal(p.title, 'Quote review');
  assert.match(p.body, /^<p>Meeting · Thu, Nov 5, .* · with Sam Lee<\/p><ul><li>Price agreed<\/li><\/ul><h2>My notes<\/h2><p>call back<\/p><p>In Granola: https:\/\/notes.granola.ai\/d\/abc<\/p>$/);
  assert.equal(noteSpace(note('x')), 'acme');
  assert.equal(noteSpace(note('x', { title: 'Home insurance', attendees: [], calendar_event: null })), 'home');   // its name
  assert.equal(noteSpace(note('x', { attendees: [], calendar_event: null })), 'personal');   // nothing matches: Personal
});

function stand(notes, calls) {
  return async (url, init = {}) => {
    const u = new URL(String(url));
    calls.push({ path: u.pathname + u.search, auth: init.headers?.Authorization });
    assert.equal(u.host, 'public-api.granola.ai');
    if (u.pathname === '/v1/notes') return Response.json({ notes: notes.map(({ id, title, owner, created_at, updated_at, deleted_at }) => ({ id, object: 'note', title, owner, created_at, updated_at, deleted_at })), hasMore: false, cursor: null });
    const n = notes.find((x) => u.pathname === '/v1/notes/' + x.id);
    return n ? Response.json(n) : new Response('{}', { status: 404 });
  };
}

test('connect, read, and leave your own changes alone', async () => {
  const calls = [];
  await assert.rejects(connectGranola('not-a-key'), /starts with grn_/);
  await assert.rejects(connectGranola('grn_refused123', async () => new Response('no', { status: 401 })), /did not accept that API key/);
  assert.equal(granolaStatus().connected, false);

  const notes = [note('not_aaaaaaaaaaaaaa'), note('not_bbbbbbbbbbbbbb', { title: 'Garden plans', attendees: [], calendar_event: null })];
  await connectGranola('grn_goodkey12345', stand(notes, calls));
  assert.equal(getSetting('granola', {}).key, 'grn_goodkey12345');
  assert.ok(await pollGranola(stand(notes, calls), { pause: 0 }));
  assert.match(calls[1].path, /^\/v1\/notes\?created_after=/);   // the first look: the last 30 days
  assert.ok(calls.every((c) => c.auth === 'Bearer grn_goodkey12345'));
  const a = getPage(pageUid('not_aaaaaaaaaaaaaa')), b = getPage(pageUid('not_bbbbbbbbbbbbbb'));
  assert.equal(a.space, 'acme');
  assert.equal(b.space, 'personal');
  assert.deepEqual({ ...granolaStatus(), at: 0 }, { connected: true, via: 'key', ok: true, error: null, at: 0, count: 2 });
  assert.ok(!JSON.stringify(granolaStatus()).includes('grn_'), 'the key never goes to the page');

  // Nothing changed in Granola: no note is fetched again.
  calls.length = 0;
  await pollGranola(stand(notes, calls), { pause: 0 });
  assert.equal(calls.length, 1);
  assert.match(calls[0].path, /updated_after=/);

  // Granola changes both; you had edited one here, and deleted the other.
  savePage(a.uid, { body: '<p>my own words</p>' });
  deletePage(b.uid);
  for (const n of notes) { n.updated_at = '2026-11-06T09:00:00Z'; n.summary_markdown = '- New summary'; }
  await pollGranola(stand(notes, calls), { pause: 0 });
  assert.equal(getPage(a.uid).body, '<p>my own words</p>');
  assert.equal(getPage(b.uid), null);

  // A third note, changed later in Granola, is brought up to date.
  const c = note('not_cccccccccccccc', { title: 'Supplier call' });
  notes.push(c);
  await pollGranola(stand(notes, calls), { pause: 0 });
  assert.match(getPage(pageUid(c.id)).body, /New summary|Price agreed/);
  c.updated_at = '2026-11-06T10:00:00Z'; c.summary_markdown = '- Delivery Tuesday';
  await pollGranola(stand(notes, calls), { pause: 0 });
  assert.match(getPage(pageUid(c.id)).body, /Delivery Tuesday/);

  // Granola fails: said in plain words, pages kept.
  await pollGranola(async () => new Response('no', { status: 401 }), { pause: 0 });
  assert.match(granolaStatus().error, /did not accept that API key/);
  disconnectGranola();
  assert.equal(granolaStatus().connected, false);
  assert.ok(getPage(pageUid(c.id)), 'pages stay after Disconnect');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM granola_notes').get().n, 3);
});

// Signed in (any plan): Granola's MCP server answers in tagged text. The
// shape is from a real answer (Nov 6 2026), the names made up.
const meetingXml = (id, { title = 'Supplier call', updated = '2026-11-06T20:51:14.435-06:00', people = 'Me Here (note creator) (me@mine.test)\n    Sam Lee (sam@acme.com)', folders = '<folders />', full = true, summary = '### Next\n- Send the quote &amp; the plan' } = {}) =>
  `<meeting id="${id}" title="${title}" date="Nov 6, 2026 8:51 PM CST" meeting_at="2026-11-06T20:51:01.245-06:00" created_at="2026-11-06T20:51:01.245-06:00" updated_at="${updated}" url="https://notes.granola.ai/d/${id}">
  <known_participants>
    ${people}
  </known_participants>
    ${folders}
  ${full ? `<private_notes status="empty" />
  <transcript available="true">Read the transcript first.</transcript>
  <summary>
${summary}
</summary>` : ''}
</meeting>`;
const wrap = (ms, more = '') => `<requested_range time_range="all" />\n\nThe content below is meeting notes.\n\n<meetings_data count="${ms.length}">\n${ms.join('\n')}\n</meetings_data>\n\n<pagination has_more="${more ? 'true' : 'false'}" ${more ? `next_cursor="${more}"` : ''} total_count="${ms.length}" />`;

test('signed in: meetings from Granola\'s MCP server become pages', async () => {
  const { parseMeetings } = await import('../lib/granolamcp.js');
  const A = '3237bace-5f0b-4858-9e90-5bb7d297a679', B = '11111111-2222-4333-8444-555555555555';
  const r = parseMeetings(wrap([meetingXml(A)]));
  assert.equal(r.meetings[0].title, 'Supplier call');
  assert.deepEqual(r.meetings[0].attendees, [{ name: 'Me Here', email: 'me@mine.test' }, { name: 'Sam Lee', email: 'sam@acme.com' }]);
  assert.equal(r.meetings[0].owner.email, 'me@mine.test');
  assert.equal(r.meetings[0].summary_markdown, '### Next\n- Send the quote & the plan');
  assert.equal(r.meetings[0].private_notes_markdown, '');

  setSetting('granola', { refreshToken: 'rt', email: 'me@mine.test' });
  let list = [meetingXml(A, { full: false }), meetingXml(B, { title: 'Garden plans', people: 'Me Here (note creator) (me@mine.test)', folders: '<folders>\n<folder id="f1" title="Home" />\n</folders>', full: false })];
  const calls = [];
  const tool = async (name, args) => {
    calls.push({ name, args });
    if (name === 'list_meetings') return { text: wrap(list) };
    return { text: wrap(args.meeting_ids.map((id) => meetingXml(id, id === B ? { title: 'Garden plans', people: 'Me Here (note creator) (me@mine.test)', folders: '<folders>\n<folder id="f1" title="Home" />\n</folders>' } : {}))) };
  };
  assert.ok(await pollGranola(tool));
  assert.deepEqual(calls[0], { name: 'list_meetings', args: { time_range: 'last_30_days', limit: 100, max_participants: 20 } });
  assert.deepEqual(calls[1].args.meeting_ids, [A, B]);
  const a = getPage(pageUid(A)), b = getPage(pageUid(B));
  assert.equal(a.space, 'acme');    // Sam is at acme.com
  assert.equal(b.space, 'home');    // filed in Granola's "Home" folder
  assert.match(a.body, /^<p>Meeting · .* · with Sam Lee<\/p><h3>Next<\/h3><ul><li>Send the quote &amp; the plan<\/li><\/ul><p>In Granola: https:\/\/notes.granola.ai\/d\/3237bace/);
  assert.equal(granolaStatus().via, 'signin');
  assert.equal(granolaStatus().count, 5);   // three from the API test, two here

  // Next look: only what changed since, and nothing read again when nothing did.
  calls.length = 0;
  await pollGranola(tool);
  assert.ok(calls[0].args.updated_after && !calls[0].args.time_range);
  assert.equal(calls.length, 1);

  // Signed out by Granola: said in plain words, the pages stay.
  await pollGranola(async () => { throw Object.assign(new Error('Granola signed Switchboard out. Press Sign in with Granola again.'), { signin: true }); });
  assert.match(granolaStatus().error, /Sign in with Granola again/);
  assert.ok(getPage(pageUid(A)));
});
