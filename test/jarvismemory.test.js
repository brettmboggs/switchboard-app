// Jarvis's memory: a short card of lasting facts (capped so it never crowds the
// model), every exchange in a searchable log, and versions kept for Undo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-jvmem-'));
const mem = await import('../lib/jarvismemory.js');
const { quick, speakable, firstSentences } = await import('../lib/jarvistools.js');

test('remember adds a line, the same subject replaces it, forget and undo work', () => {
  mem.remember('my son is Sam');
  mem.remember('the gate code is 4411');
  mem.remember('the gate code is 5522');
  assert.equal(mem.card(), 'my son is Sam\nthe gate code is 5522');
  assert.match(mem.forget('gate code').say, /Forgotten/);
  assert.equal(mem.card(), 'my son is Sam');
  mem.undoCard();
  assert.equal(mem.card(), 'my son is Sam\nthe gate code is 5522');
  assert.match(mem.forget('the weather').say, /nothing noted/);
});

test('the card never grows past its cap', () => {
  mem.setCard('');
  let r;
  for (let i = 0; i < 40 && (!r || r.ok); i++) r = mem.remember(`fact number ${i} is about something worth keeping for a while, item ${i}`);
  assert.equal(r.ok, false);
  assert.ok(mem.card().length <= mem.CARD_MAX);
});

test('recall finds earlier words, and only matching ones', () => {
  mem.logTurn('user', 'I need to call the bank about the mortgage on Friday');
  mem.logTurn('user', 'add eggs to shopping');
  const hits = mem.recall('what did I say about the bank?');
  assert.equal(hits.length, 1);
  assert.match(hits[0].text, /mortgage/);
  assert.deepEqual(mem.recall('the and what'), []);
});

test('the tidy keeps a version and cleans the model\'s reply into lines', async () => {
  mem.setCard('my son is Sam');
  const r = await mem.tidy(async () => 'Here is the card:\n- my son is Sam\n- my sister Ana lives in Denver\n<think>hm</think>');
  assert.equal(r.changed, true);
  assert.equal(mem.card(), 'my son is Sam\nmy sister Ana lives in Denver');
  mem.undoCard();
  assert.equal(mem.card(), 'my son is Sam');
});

test('quick words for memory and reading a session out', () => {
  assert.deepEqual(quick('Remember that my son is Sam.'), ['remember', { fact: 'my son is Sam' }]);
  assert.deepEqual(quick('forget about the gate code'), ['forget', { what: 'the gate code' }]);
  assert.deepEqual(quick('what do you know about me'), ['what_i_know', {}]);
  assert.deepEqual(quick('read it all'), ['read_all', {}]);
  assert.deepEqual(quick('remind me to call Sam'), ['add', { line: 'remind me to call Sam' }]);   // a reminder, not a memory
});

test('a session\'s words are made speakable: no code, links or full paths, two sentences', () => {
  assert.equal(speakable('Changed `lib/x.js` and /home/someone/dev/app/public/js/usage.js. See https://example.com/a. ```js\nx\n``` Done.'), 'Changed lib/x.js and usage.js. See a link. (some code) Done.');
  assert.equal(firstSentences('One. Two! Three? Four.'), 'One. Two!');
});
