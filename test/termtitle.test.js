// Session names from what the agent is working on (lib/termtitle.js). The
// titles are shaped like Claude Code's own (checked against real ones, Nov 3 2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OSC_TITLE, cleanTitle } from '../lib/termtitle.js';

test('the status glyph in front goes, the words stay', () => {
  assert.equal(cleanTitle('✳ Union city picker in Estimating'), 'Union city picker in Estimating');
  assert.equal(cleanTitle('⠐ PLT-120 field planning screens'), 'PLT-120 field planning screens');
  assert.equal(cleanTitle('  ✶   Fix   the  login  '), 'Fix the login');
});

test('a title that says nothing about the work is no name', () => {
  assert.equal(cleanTitle('my-laptop', 'my-laptop'), '');
  assert.equal(cleanTitle('my-laptop.local', 'my-laptop'), '');
  assert.equal(cleanTitle('✳ Claude Code'), '');
  assert.equal(cleanTitle('bash'), '');
  assert.equal(cleanTitle(''), '');
  assert.equal(cleanTitle(null), '');
});

test('long titles are cut to a line', () => {
  assert.equal(cleanTitle('x'.repeat(200)).length, 80);
});

test('titles are read off a program\'s output, BEL or ST ended', () => {
  const out = 'hello\x1b]0;✳ First\x07more\x1b]2;⠂ Second thing\x1b\\done';
  assert.deepEqual([...out.matchAll(OSC_TITLE)].map((m) => cleanTitle(m[1])), ['First', 'Second thing']);
});
