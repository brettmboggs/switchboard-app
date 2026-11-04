// The setup registry (public/setup.js) drives the welcome and "New in
// Switchboard". A connection without an entry would be skipped by both, so
// these checks fail until it has one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';

const here = new URL('..', import.meta.url);
const win = {};
vm.runInNewContext(readFileSync(new URL('public/setup.js', here), 'utf8'), { window: win });
const { SETUP, USES } = win;
const ids = SETUP.map((e) => e.id);
// Every server-side source file, including lib/routes/.
const libFiles = () => readdirSync(new URL('lib/', here), { recursive: true }).filter((f) => f.endsWith('.js')).map((f) => 'lib/' + f);

test('every entry is complete', () => {
  const uses = new Set(USES.map((u) => u.id));
  for (const e of SETUP) {
    assert.match(e.id, /^[a-z][a-z0-9-]*$/, e.id);
    assert.ok(['connect', 'feature'].includes(e.kind), `${e.id}: kind`);
    assert.ok(e.title && e.why, `${e.id}: title and why`);
    assert.ok(e.uses === 'all' || (Array.isArray(e.uses) && e.uses.every((u) => uses.has(u))), `${e.id}: uses`);
    assert.match(e.added || '', /^\d{4}-\d{2}-\d{2}$/, `${e.id}: added`);
    if (e.kind === 'connect') assert.equal(typeof e.done, 'function', `${e.id}: done`);
    assert.ok(e.open && (e.open.pane || e.open.go), `${e.id}: open`);
  }
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
});

test('every connection in lib/ has an entry', () => {
  for (const f of libFiles()) {
    const src = readFileSync(new URL(f, here), 'utf8');
    for (const [, name] of src.matchAll(/export async function poll([A-Z]\w*)/g)) {
      assert.ok(ids.includes(name.toLowerCase()), `${f} polls ${name}: add a "${name.toLowerCase()}" entry to public/setup.js`);
    }
  }
});

test('every coding agent has an entry', () => {
  const src = readFileSync(new URL('lib/terminals.js', here), 'utf8');
  const block = src.slice(src.indexOf('export const AGENTS = {'), src.indexOf('};', src.indexOf('export const AGENTS = {')));
  for (const [, id] of block.matchAll(/^\s+(\w+): \{ name/gm)) {
    if (id === 'custom' || id === 'aider') continue;
    assert.ok(ids.includes(id), `agent ${id}: add an entry to public/setup.js`);
  }
});

// SQL injection guard: values always go in as ? parameters, never pasted into
// the query text. A template literal with ${...} inside prepare() fails here.
test('no query is built from pasted text', () => {
  const files = ['server.js', ...libFiles(), 'sync-worker/src/index.js'];
  for (const f of files) {
    const src = readFileSync(new URL(f, here), 'utf8');
    for (const m of src.matchAll(/prepare\(`([^`]*)`/g)) assert.ok(!m[1].includes('${'), `${f}: a query is built with \${...}; pass the value as a ? parameter`);
    assert.ok(!/prepare\([^)`'"]*\+/.test(src), `${f}: a query is built by joining strings; use ? parameters`);
  }
});
