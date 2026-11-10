// Jarvis can do anything Switchboard can (lib/jarvisapi.js, lib/jarvisactions.js):
// every route in lib/routes has a catalogue entry, actions are found by plain
// words, a delete waits for a yes, and a send to another person never goes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACTIONS } from '../lib/jarvisactions.js';
import { findActions, runAction } from '../lib/jarvisapi.js';
import { quick } from '../lib/jarvistools.js';

const ROUTES = join(import.meta.dirname, '..', 'lib', 'routes');
const sources = readdirSync(ROUTES).filter((f) => f.endsWith('.js')).map((f) => [f, readFileSync(join(ROUTES, f), 'utf8')]);
// A catalogue path with sample ids: a number, a hex id, a word, in every mix.
function samples(p) {
  let out = [p];
  while (out[0].includes(':')) out = out.flatMap((x) => ['12', 'abcdef12', 'x1'].map((v) => x.replace(/:(\w+)/, v)));
  return out;
}

test('every route in lib/routes has an entry Jarvis can find', () => {
  const paths = new Set(ACTIONS.map((a) => a.path));
  const missing = [];
  for (const [f, src] of sources) {
    for (const m of src.matchAll(/path\s*[!=]==\s*'(\/(?:api|hook)\/[^']*)'/g)) if (!paths.has(m[1])) missing.push(`${f}: ${m[1]}`);
    for (const m of src.matchAll(/path\.match\(\/(\^\\\/(?:api|hook).*?\$)\/[a-z]*\)/g)) {
      const re = new RegExp(m[1]);
      if (![...paths].some((p) => samples(p).some((x) => re.test(x)))) missing.push(`${f}: /${m[1]}/`);
    }
  }
  assert.deepEqual(missing, [], 'Add these to lib/jarvisactions.js so Jarvis can use them (kind internal if only the page may)');
});

test('the catalogue is well formed', () => {
  const ids = new Set();
  for (const a of ACTIONS) {
    assert.ok(!ids.has(a.id), `duplicate id ${a.id}`); ids.add(a.id);
    assert.ok(['GET', 'POST'].includes(a.method), a.id);
    assert.ok(['read', 'change', 'delete', 'send', 'internal'].includes(a.kind), a.id);
    assert.ok(a.does && a.path.startsWith('/'), a.id);
    for (const p of a.path.matchAll(/:(\w+)/g)) assert.ok(p[1] in a.args, `${a.id} describes its ${p[1]}`);
  }
});

test('actions are found by the words a person would use', () => {
  const top = (q) => findActions(q, 3).map((a) => a.id);
  assert.ok(top('start a speed test').includes('speedtest.start'));
  assert.ok(findActions('weather units', 5).some((a) => a.id === 'weather.units'));
  assert.ok(!findActions('anything at all', 50).some((a) => a.kind === 'internal'));
  assert.deepEqual(findActions(''), []);
});

test('run: path inputs fill the path, the rest is the body or the query', async () => {
  const calls = [];
  const api = async (path, body) => { calls.push([path, body]); return { ok: true }; };
  const q = ACTIONS.find((a) => a.method === 'POST' && a.path === '/api/terms/:id/queue');
  await runAction(api, q.id, { id: 'abc', text: 'hello' });
  assert.deepEqual(calls.pop(), ['/api/terms/abc/queue', { text: 'hello' }]);
  await runAction(api, 'speedtest.status', { history: 1 });
  assert.deepEqual(calls.pop(), ['/api/speedtest?history=1', undefined]);
  const r = await runAction(api, q.id, { text: 'no id' });
  assert.match(r.say, /needs id/);
});

test('a delete waits for a yes; a send to another person never goes', async () => {
  const calls = [];
  const api = async (path, body) => { calls.push(path); return { ok: true }; };
  const del = ACTIONS.find((a) => a.kind === 'delete'), send = ACTIONS.find((a) => a.kind === 'send');
  const args = Object.fromEntries([...del.path.matchAll(/:(\w+)/g)].map((m) => [m[1], 'x1']));
  const asked = await runAction(api, del.id, args);
  assert.ok(asked.needsYes); assert.equal(calls.length, 0);
  await runAction(api, del.id, args, true);
  assert.equal(calls.length, 1);
  const sent = await runAction(api, send.id, {}, true);
  assert.match(sent.say, /Not sent/); assert.equal(calls.length, 1);
  assert.match((await runAction(api, 'no.such')).say, /no action called/);
});

test('quick words for the network test', () => {
  for (const t of ['test my internet', 'Jarvis, how fast is my internet?', 'run a speed test', 'speed test', 'check my connection speed']) assert.deepEqual(quick(t), ['network_test', { when: 'now' }], t);
  for (const t of ['what was my last speed test', 'how fast was my internet']) assert.deepEqual(quick(t), ['network_test', { when: 'last' }], t);
  assert.deepEqual(quick('open the network test'), ['show_page', { page: 'network' }]);
});
