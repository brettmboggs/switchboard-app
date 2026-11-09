// New folder from New session (lib/newfolder.js): made in a code folder, a git
// repo unless unticked; a bad name, a taken name or a folder outside your code
// folders is refused. (GitHub is not called here.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-newfolder-'));
const { makeFolder, folderName } = await import('../lib/newfolder.js');
const hasGit = (() => { try { execFileSync('git', ['--version']); return true; } catch { return false; } })();

test('names: spaces become dashes; options, hidden folders and paths are refused', () => {
  assert.equal(folderName(' Acme website '), 'Acme-website');
  for (const bad of ['', '-rf', '.git', '../x', 'a/b', 'a\\b', 'x'.repeat(70)]) assert.equal(folderName(bad), null, bad);
});

test('a new folder in your code folder, a git repo; the same name twice is refused', { skip: !hasGit }, async () => {
  const home = mkdtempSync(join(tmpdir(), 'sb-nf-home-')), root = join(home, 'dev');
  mkdirSync(root);
  const f = await makeFolder({ name: 'Acme website' }, { roots: [root], home });
  assert.equal(f.path, join(root, 'Acme-website'));
  assert.equal(f.git, true);
  assert.ok(existsSync(join(f.path, '.git')));
  await assert.rejects(makeFolder({ name: 'Acme website' }, { roots: [root], home }), /already a folder/);
  const plain = await makeFolder({ name: 'notes', git: false }, { roots: [root], home });
  assert.equal(plain.git, false);
  assert.ok(!existsSync(join(plain.path, '.git')));
  await assert.rejects(makeFolder({ name: 'x', root: '/etc' }, { roots: [root], home }), /code folders/);
});

test('no code folder yet: ~/dev is made for it', { skip: !hasGit }, async () => {
  const home = mkdtempSync(join(tmpdir(), 'sb-nf-home-'));
  const f = await makeFolder({ name: 'first' }, { roots: [], home });
  assert.equal(f.path, join(home, 'dev', 'first'));
});
