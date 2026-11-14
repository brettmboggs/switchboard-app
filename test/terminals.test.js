// Sessions: what may be typed into a terminal (prose, never control codes) and
// which sessions a viewer may attach to (only Switchboard's own, still open).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-terms-'));   // its own database
process.env.SWITCHBOARD_SESSIONS = 'direct';                                // no tmux from the tests
const { db } = await import('../lib/db.js');
const { cleanForTerminal, attach, enqueue } = await import('../lib/terminals.js');

test('text for a terminal keeps prose and drops control codes', () => {
  assert.equal(cleanForTerminal('plain text'), 'plain text');
  assert.equal(cleanForTerminal('two\nlines\twith a tab'), 'two\nlines\twith a tab');
  assert.equal(cleanForTerminal('windows\r\nlines\rtoo'), 'windows\nlines\ntoo');
  // ESC and every other C0 control, DEL and C1 go; the text around them stays.
  assert.equal(cleanForTerminal('red \x1b[31mtext\x1b[0m'), 'red [31mtext[0m');
  assert.equal(cleanForTerminal('a\x00b\x07c\x08d\x7fe\x9bf'), 'abcdef');
  assert.equal(cleanForTerminal('title \x1b]0;evil\x07 set'), 'title ]0;evil set');
  // The end-of-paste marker, which would turn the rest into keystrokes.
  assert.equal(cleanForTerminal('ok\x1b[201~rm -rf /\n'), 'ok[201~rm -rf /\n'.replace('[201~', ''));
  assert.ok(!/\x1b/.test(cleanForTerminal('\x1b\x1b[201~\x1b')));
  // Not a string: nothing, not a crash.
  assert.equal(cleanForTerminal(null), '');
  assert.equal(cleanForTerminal(42), '42');
  // Letters outside ASCII (accents, emoji, CJK) are untouched.
  assert.equal(cleanForTerminal('café ✓ 日本'), 'café ✓ 日本');
});

test('queued text is cleaned when it is stored', () => {
  const id = enqueue('sb-x', 'hi\x1b[2J there\r\n', { source: 'test' });
  assert.equal(db.prepare('SELECT text FROM queue WHERE id = ?').get(id).text, 'hi[2J there\n');
});

test('attach: only sb-* sessions with an open record', () => {
  const now = Date.now();
  db.prepare('INSERT OR REPLACE INTO terms (id, name, cwd, space, claude_id, created_at, ended_at) VALUES (?, ?, ?, ?, NULL, ?, ?)').run('other', 'other', '/tmp', 'personal', now, null);
  db.prepare('INSERT OR REPLACE INTO terms (id, name, cwd, space, claude_id, created_at, ended_at) VALUES (?, ?, ?, ?, NULL, ?, ?)').run('sb-gone', 'gone', '/tmp', 'personal', now, now);
  assert.throws(() => attach('other', 80, 24), /closed/);        // a tmux session Switchboard did not make
  assert.throws(() => attach('sb-gone', 80, 24), /closed/);      // one Switchboard made and closed
  assert.throws(() => attach('sb-unknown', 80, 24), /closed/);   // no record at all
  assert.throws(() => attach('=sb-x', 80, 24), /closed/);        // tmux target syntax
  assert.throws(() => attach('', 80, 24), /closed/);
});

test('folders: an agent\'s git worktree is marked as a copy of its repo', async () => {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { setSetting } = await import('../lib/db.js');
  const { folders } = await import('../lib/terminals.js');
  const root = mkdtempSync(join(tmpdir(), 'sb-code-'));
  mkdirSync(join(root, 'shop', '.git', 'worktrees', 'shop-fix'), { recursive: true });
  mkdirSync(join(root, 'shop-fix'));
  writeFileSync(join(root, 'shop-fix', '.git'), `gitdir: ${join(root, 'shop', '.git', 'worktrees', 'shop-fix')}\n`);
  mkdirSync(join(root, 'notes'));
  setSetting('codeRoot', root);
  const mine = folders().filter((f) => f.path.startsWith(root));
  assert.deepEqual(Object.fromEntries(mine.map((f) => [f.name, f.copyOf || null])), { shop: null, 'shop-fix': 'shop', notes: null });
});

test('a long message to Claude is typed in, not folded into "[Pasted text #1 +22 lines]"', async () => {
  const { typedPieces, TYPE_PIECE } = await import('../lib/terminals.js');
  assert.equal(typedPieces('one line'), null);
  assert.equal(typedPieces('a\nb\nc'), null);                       // up to two breaks Claude shows as text
  assert.equal(typedPieces('/compact\n1\n2\n3'), null);              // a command stays a paste
  const long = Array.from({ length: 22 }, (_, i) => 'row ' + i + '\t' + 'x'.repeat(900)).join('\n');
  const p = typedPieces(long);
  assert.ok(p.every((x) => x.length <= TYPE_PIECE));
  assert.equal(p.filter((x) => x === '\n').length, 21);
  assert.ok(!p.join('').includes('\t'));
  assert.equal(p.at(-1), ' ');
  assert.equal(p.join('').trim(), long.replace(/\t/g, '    '));
});
