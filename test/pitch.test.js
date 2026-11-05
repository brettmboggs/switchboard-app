// docs/PITCH.md and the pitch at the top of README.md are made from
// docs/headlines.json and the setup registry (npm run pitch). These fail when
// someone edits one without the other, or a headline points at a feature that
// is gone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load, pitchPage, readmeBlock, readmeWith } from '../scripts/pitch.mjs';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const data = load();

test('every headline is complete and points at real features', () => {
  const ids = new Set(data.SETUP.map((e) => e.id));
  assert.match(data.H.reviewed, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(data.H.oneLine && data.H.pitch);
  assert.ok(data.H.headlines.length >= 3 && data.H.headlines.length <= 8, 'three to eight headlines: more and none stands out');
  for (const h of data.H.headlines) {
    assert.ok(h.title && h.cool && h.show?.length, `${h.title}: title, cool and show`);
    for (const id of h.ids || []) assert.ok(ids.has(id), `${h.title}: "${id}" is not in public/setup.js`);
  }
});

test('PITCH.md and the README are up to date (npm run pitch)', () => {
  assert.equal(read('docs/PITCH.md'), pitchPage(data), 'docs/PITCH.md is out of date: run npm run pitch');
  const readme = read('README.md');
  assert.equal(readme, readmeWith(readme, readmeBlock(data)), 'README.md pitch is out of date: run npm run pitch');
});
