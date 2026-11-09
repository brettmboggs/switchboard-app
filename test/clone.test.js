// "Clone to this computer" (lib/clone.js): the repo name comes from a shared
// project, so it is checked before it becomes an argument (review L1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-clone-'));
const { setSetting } = await import('../lib/db.js');
const { cloneRepo } = await import('../lib/clone.js');
const { okRepo } = await import('../public/js/shared/share-core.js');
setSetting('codeRoot', mkdtempSync(join(tmpdir(), 'sb-clone-root-')));

test('a repo name that would read as an option is refused before anything runs (review L1)', async () => {
  for (const r of ['-u/x', 'acme/-help', '--upstream-remote-name=x/y', '-c/core'])
    await assert.rejects(cloneRepo(r, null), /not a GitHub repo name/, r);
  for (const r of ['-u/x', 'acme/-help']) assert.equal(okRepo(r), false, r);
  assert.equal(okRepo('acme/site.web'), true);
});
