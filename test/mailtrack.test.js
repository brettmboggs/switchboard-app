// Mail tracking (lib/mailtrack.js): the tracker's address, the tracked HTML of
// a sent email, and what a received email carries for the tracker's detector.
// No network: the tracker itself is not called here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-mailtrack-'));
const { trackerOrigin, linkify, pixelHtml, trackOutgoing, mailtrackForBoard } = await import('../lib/mailtrack.js');
const { mailParts } = await import('../lib/gmail.js');
const { quick } = await import('../lib/jarvistools.js');

test('the tracker address: https only, except a tracker on this computer', () => {
  assert.equal(trackerOrigin('t.example.com'), 'https://t.example.com');
  assert.equal(trackerOrigin('https://t.example.com/app/'), 'https://t.example.com');
  assert.equal(trackerOrigin('http://t.example.com'), null);
  assert.equal(trackerOrigin('http://localhost:8799'), 'http://localhost:8799');
  assert.equal(trackerOrigin(''), null);
});

test('a tracked email: its links point at the tracker, the pixel goes last, the plain text is untouched', () => {
  const t = { pixelUrl: 'https://t.example.com/p/abc.gif', links: new Map([['https://example.com/a?x=1&y=2', 'https://t.example.com/l/abc/0']]) };
  const text = 'Hi Pat,\n\nThe plan: https://example.com/a?x=1&y=2 and https://example.com/other.\n\nSam';
  const b = mailParts.bodyFor('sam@example.com', text, t);
  assert.equal(b.text, text);
  assert.match(b.html, /<a href="https:\/\/t\.example\.com\/l\/abc\/0">https:\/\/example\.com\/a\?x=1&amp;y=2<\/a>/);
  assert.match(b.html, /https:\/\/example\.com\/other\./);          // a link it was not told about stays as it was
  assert.ok(b.html.trimEnd().endsWith(pixelHtml(t.pixelUrl)));
  assert.equal(mailParts.bodyFor('sam@example.com', 'one line').html, undefined);   // untracked, one line: plain text as before
  assert.equal(linkify('no links here', t.links), 'no links here');
});

test('not connected: nothing is registered and the board says so', async () => {
  assert.equal(await trackOutgoing({ to: 'pat@example.org', subject: 'Hi', text: 'Hi' }), null);
  assert.deepEqual(mailtrackForBoard(), { connected: false });
});

test('Jarvis: did they open it', () => {
  assert.deepEqual(quick('did Pat open my email'), ['email_opens', { who: 'pat' }]);
  assert.deepEqual(quick('who opened my emails'), ['email_opens', {}]);
});
