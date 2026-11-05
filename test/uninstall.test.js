// Remove Switchboard (lib/uninstall.js) never touches the real computer from a test copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-remove-'));
const { removeParts } = await import('../lib/uninstall.js');

test('a copy on another port refuses, in plain words', async () => {
  await assert.rejects(removeParts({ data: true, port: 4801 }), /test copy of Switchboard/);
});
