// Updates never set aside work committed on this computer without asking:
// a throwaway "GitHub" repo and a clone with lib/update.js in it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=Sam', '-c', 'user.email=sam@example.com', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
const commit = (cwd, file, text) => { writeFileSync(join(cwd, file), text); git(cwd, 'add', '-A'); git(cwd, 'commit', '-q', '-m', 'change ' + file); };

const { localOnly } = await import('../lib/update.js');
test('only changes GitHub lacks by content count as this computer\'s own', () => {
  assert.equal(localOnly('+ abc123\n- def456\n+ 0987ff\n'), 2);
  assert.equal(localOnly(''), 0);
});

test('Update stops and asks when this computer has commits GitHub does not; Update anyway keeps them on a backup branch', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'sb-update-'));
  const hub = join(root, 'hub.git'), seed = join(root, 'seed'), here = join(root, 'here');
  git(root, 'init', '-q', '--bare', '-b', 'main', hub);
  git(root, 'clone', '-q', hub, seed);
  mkdirSync(join(seed, 'lib'));
  copyFileSync(new URL('../lib/update.js', import.meta.url), join(seed, 'lib', 'update.js'));
  writeFileSync(join(seed, 'package.json'), '{"version":"0.0.0"}');
  commit(seed, 'a.txt', 'one'); git(seed, 'push', '-q', 'origin', 'HEAD:main');
  git(root, 'clone', '-q', hub, here);
  commit(here, 'mine.txt', 'my work');                         // committed here, not pushed
  commit(seed, 'b.txt', 'two'); git(seed, 'push', '-q', 'origin', 'HEAD:main');   // GitHub moved on
  const before = git(here, 'rev-parse', 'HEAD');

  const exit = process.exit; let exited = null;
  process.exit = (c) => { exited = c; };
  t.after(() => { process.exit = exit; });
  process.env.GIT_CONFIG_COUNT = '1'; process.env.GIT_CONFIG_KEY_0 = 'commit.gpgsign'; process.env.GIT_CONFIG_VALUE_0 = 'false';
  const up = await import(join(here, 'lib', 'update.js') + '?' + Date.now());
  await assert.rejects(up.applyUpdate(), (e) => e.localCommits === 1 && /1 change that GitHub does not have/.test(e.message));
  assert.equal(git(here, 'rev-parse', 'HEAD'), before, 'nothing moved');

  await up.applyUpdate({ force: true });
  assert.equal(git(here, 'rev-parse', 'HEAD'), git(here, 'rev-parse', 'origin/main'));
  assert.equal(git(here, 'rev-parse', `before-update-${before.slice(0, 7)}`), before, 'the work is on the backup branch');
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(exited, 75);
});
