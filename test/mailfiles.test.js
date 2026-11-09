// Pictures and files in email and Outlook (lib/mailfiles.js, lib/http.js
// sendFile, lib/microsoft.js okOutlookId): which parts of a message are files,
// what the page may ask for, and that only plain pictures ever show inline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-mailfiles-'));
const { walkStructure, okPart, okUid, SHOWABLE } = await import('../lib/mailfiles.js');
const { sendFile } = await import('../lib/http.js');
const { okOutlookId } = await import('../lib/microsoft.js');

// The shape imapflow gives for a typical email: words (plain and HTML), a
// signature logo and a photo inline in the HTML, a PDF and an SVG attached.
const message = {
  type: 'multipart/mixed', childNodes: [
    { part: '1', type: 'multipart/related', childNodes: [
      { part: '1.1', type: 'multipart/alternative', childNodes: [
        { part: '1.1.1', type: 'text/plain', size: 400 },
        { part: '1.1.2', type: 'text/html', size: 900 }
      ] },
      { part: '1.2', type: 'image/png', id: '<logo@x>', disposition: 'inline', size: 1200, parameters: { name: 'logo.png' } },
      { part: '1.3', type: 'image/jpeg', id: '<photo@x>', size: 240000, parameters: { name: 'deck.jpg' } }
    ] },
    { part: '2', type: 'application/pdf', disposition: 'attachment', dispositionParameters: { filename: 'quote "final".pdf' }, size: 88000 },
    { part: '3', type: 'image/svg+xml', disposition: 'attachment', dispositionParameters: { filename: 'plan.svg' }, size: 9000 },
    { part: '4', type: 'text/plain', disposition: 'attachment', dispositionParameters: { filename: 'notes.txt' }, size: 300 }
  ]
};

test('a message\'s files are its parts that are not its own words, small inline logos left out', () => {
  const f = walkStructure(message);
  assert.deepEqual(f.map((x) => [x.part, x.name, x.picture]), [
    ['1.3', 'deck.jpg', true],
    ['2', 'quote final.pdf', false],
    ['3', 'plan.svg', false],
    ['4', 'notes.txt', false]
  ]);
  assert.equal(f[0].cid, 'photo@x');
  assert.equal(f[0].inline, true);
});

test('a message that is only a picture is part 1; a plain email has no files', () => {
  assert.deepEqual(walkStructure({ type: 'image/jpeg', size: 50000 }).map((x) => x.part), ['1']);
  assert.deepEqual(walkStructure({ type: 'text/plain', size: 10 }), []);
  assert.deepEqual(walkStructure(null), []);
});

test('only well-formed part numbers, uids and Outlook ids are taken', () => {
  for (const p of ['1', '1.2', '2.1.3']) assert.ok(okPart(p), p);
  for (const p of ['', 'TEXT', 'HEADER', '1..2', '1.a', '../1', '1.2.']) assert.ok(!okPart(p), p);
  assert.ok(okUid('48213')); assert.ok(!okUid('-1')); assert.ok(!okUid('1,2')); assert.ok(!okUid('1:*'));
  assert.ok(okOutlookId('AAMkAGI2THVSAAA=')); assert.ok(!okOutlookId('../me')); assert.ok(!okOutlookId('a b'));
});

function fakeRes() {
  const r = { head: null, body: null, writeHead(code, h) { r.code = code; r.head = h; }, end(b) { r.body = b; } };
  return r;
}
test('a plain picture shows inline; SVG, HTML and everything else only downloads', () => {
  assert.ok(SHOWABLE.has('image/jpeg')); assert.ok(!SHOWABLE.has('image/svg+xml')); assert.ok(!SHOWABLE.has('text/html'));
  const pic = fakeRes(); sendFile(pic, { buf: Buffer.from('x'), type: 'image/jpeg', name: 'deck.jpg', picture: true });
  assert.equal(pic.head['Content-Type'], 'image/jpeg');
  assert.match(pic.head['Content-Disposition'], /^inline;/);
  assert.equal(pic.head['X-Content-Type-Options'], 'nosniff');
  const svg = fakeRes(); sendFile(svg, { buf: Buffer.from('<svg/>'), type: 'image/svg+xml', name: 'plan.svg', picture: false });
  assert.equal(svg.head['Content-Type'], 'application/octet-stream');
  assert.match(svg.head['Content-Disposition'], /^attachment;/);
  const saved = fakeRes(); sendFile(saved, { buf: Buffer.from('x'), type: 'image/jpeg', name: 'a\r\nb"c.jpg', picture: true }, true);
  assert.match(saved.head['Content-Disposition'], /^attachment; filename="a__b_c\.jpg"/);
  assert.equal(saved.head['Content-Security-Policy'], "default-src 'none'");
});

test('a file\'s name in Content-Disposition is encoded the RFC 8187 way, quotes and brackets too (review L1)', async () => {
  const { sendFile } = await import('../lib/http.js');
  let h = null;
  sendFile({ writeHead: (s, hd) => { h = hd; }, end() {} }, { buf: Buffer.from('x'), type: 'image/png', name: "Sam's plan (v2)*.png", picture: true });
  assert.match(h['Content-Disposition'], /filename\*=UTF-8''Sam%27s%20plan%20%28v2%29%2A\.png$/);
});
