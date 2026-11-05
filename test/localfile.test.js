// Files named in a session's chat (lib/localfile.js): found in the session's
// folder first, line numbers read off, and keys and secrets never shown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { splitLine, locate, describe, check, remoteFiles } from '../lib/localfile.js';
import { opensAsProgram } from '../lib/desktop.js';
import { normalize } from '../lib/transcript.js';

const cwd = mkdtempSync(join(tmpdir(), 'sb-lf-'));
mkdirSync(join(cwd, 'docs'));
writeFileSync(join(cwd, 'docs', 'PITCH.md'), '# Hello\n\nWorld');
writeFileSync(join(cwd, 'app.js'), 'one\ntwo\nthree');
writeFileSync(join(cwd, 'shot.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0]));
writeFileSync(join(cwd, 'data.bin'), Buffer.from([1, 0, 2, 0]));
writeFileSync(join(cwd, '.env'), 'SECRET=1');
mkdirSync(join(cwd, '.ssh'));
writeFileSync(join(cwd, '.ssh', 'id_ed25519'), 'key');

test('line numbers come off the name', () => {
  assert.deepEqual(splitLine('lib/a.js:12'), { file: 'lib/a.js', line: 12 });
  assert.deepEqual(splitLine('lib/a.js:12:5'), { file: 'lib/a.js', line: 12 });
  assert.deepEqual(splitLine('lib/a.js#L7'), { file: 'lib/a.js', line: 7 });
  assert.deepEqual(splitLine('`README.md`'), { file: 'README.md', line: null });
});

test('found in the session folder; each kind described', () => {
  const md = describe('docs/PITCH.md', cwd);
  assert.equal(md.kind, 'markdown');
  assert.equal(md.text, '# Hello\n\nWorld');
  const js = describe('app.js:2', cwd);
  assert.equal(js.kind, 'text'); assert.equal(js.line, 2);
  assert.equal(describe('shot.png', cwd).kind, 'image');
  assert.equal(describe('data.bin', cwd).kind, 'other');
  assert.equal(describe('docs', cwd).kind, 'folder');
  assert.equal(describe(join(cwd, 'app.js'), '/').kind, 'text');
});

test('missing files, secrets and places outside are refused in plain words', () => {
  assert.match(describe('nope.md', cwd).error, /no nope\.md/);
  assert.match(describe('.env', cwd).error, /keys or passwords/);
  assert.match(describe('.ssh/id_ed25519', cwd).error, /keys or passwords/);
  assert.match(describe('/etc/hostname', cwd).error || 'missing', /home folder|no hostname|missing/);
  assert.match(describe('/tmp/claude-1000/x/scratchpad/a.png', cwd).error, /private scratch folder/);
  assert.deepEqual(check(['docs/PITCH.md', 'nope.md', '.env', 'docs/'], cwd), [true, false, false, true]);
  assert.ok(locate('app.js', cwd).path.endsWith('app.js'));
});

test('programs and scripts are shown in their folder, never opened', () => {
  assert.ok(opensAsProgram('/x/run.sh'));
  assert.ok(opensAsProgram('C:\\x\\setup.EXE'));
  assert.ok(!opensAsProgram('/x/PITCH.md'));
  assert.ok(!opensAsProgram('/x/shot.png'));
});

test('files Claude sends come through the transcript with their caption', () => {
  const rec = { type: 'assistant', uuid: 'u1', timestamp: '2026-11-05T10:00:00Z', message: { content: [{ type: 'tool_use', id: 't1', name: 'SendUserFile', input: { files: ['a.png', 7, 'docs/PITCH.md'], caption: 'Before and after', status: 'normal' } }] } };
  const [item] = normalize(rec);
  assert.deepEqual(item.files, ['a.png', 'docs/PITCH.md']);
  assert.equal(item.caption, 'Before and after');
});

test('another computer asks: names checked, text and pictures sent back, nothing opened', () => {
  assert.deepEqual(remoteFiles({ op: 'check', paths: ['docs/PITCH.md', 'nope.md'] }, cwd), { ok: [true, false] });
  assert.equal(remoteFiles({ op: 'view', path: 'docs/PITCH.md' }, cwd).text, '# Hello\n\nWorld');
  const pic = remoteFiles({ op: 'raw', path: 'shot.png' }, cwd);
  assert.equal(pic.type, 'image/png');
  assert.equal(Buffer.from(pic.b64, 'base64').length, 7);
  assert.equal(remoteFiles({ op: 'raw', path: 'app.js' }, cwd).status, 415);
  assert.equal(remoteFiles({ op: 'view', path: '.env' }, cwd).status, 404);
  assert.equal(remoteFiles({ op: 'open', path: 'app.js' }, cwd).status, 400);
});
