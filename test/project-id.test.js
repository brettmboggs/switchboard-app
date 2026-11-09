// A new project's id fits the page's address (#project/<id> takes up to 60
// characters), however long its name; ids already saved are kept as they are.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-projid-'));
const { cleanSpaces } = await import('../lib/spaces.js');

test('a long name gives an id of 40 characters at most; a saved id stays', () => {
  const long = 'Acme Construction Company Quarterly Planning And Budget Review 2027';
  const [a, b, c] = cleanSpaces([{ name: long }, { name: long }, { id: 'kept-' + 'x'.repeat(50), name: 'Old' }]);
  assert.ok(a.id.length <= 40 && !a.id.endsWith('-'), a.id);
  assert.match(a.id, /^acme-construction-company-quarterly/);
  assert.equal(b.id, a.id + '-2');
  assert.ok(/^[a-z0-9-]{1,60}$/.test(b.id), 'opens at #project/<id>');
  assert.equal(c.id, 'kept-' + 'x'.repeat(50));
});
