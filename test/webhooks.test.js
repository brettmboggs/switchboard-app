// Webhooks: what the sync service seals, this computer opens; every shape of
// message (JSON, IFTTT's form, a phone shortcut's multipart form, plain text)
// becomes the right item in the right project.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-hooks-'));   // its own database
const { setSetting } = await import('../lib/db.js');
const { openBlob, readFields, toItem, readDue } = await import('../lib/webhooks.js');
const { sealForHook } = await import('../sync-worker/src/hookbox.js');

setSetting('spaces', [{ id: 'personal', name: 'Personal' }, { id: 'farm', name: 'The Farm' }, { id: 'work', name: 'Work' }]);
const hook = { id: 'h1', space: 'farm', kind: 'needs' };
const NOW = new Date(2026, 10, 3, 14, 0).getTime();   // Tue Nov 3 2026, 2pm local

function keys() {
  const kp = generateKeyPairSync('x25519');
  return { priv: kp.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'), pub: kp.publicKey.export({ type: 'spki', format: 'der' }).subarray(12).toString('base64') };
}

test('a message sealed by the service opens here, and only with its own key', async () => {
  const k = keys();
  const env = { type: 'application/json', query: '', body: '{"text":"Gate open ✓"}', at: 1 };
  const blob = await sealForHook(k.pub, JSON.stringify(env));
  assert.deepEqual(openBlob(k, blob), env);
  assert.throws(() => openBlob(keys(), blob));                      // another webhook's key
  const b = Buffer.from(blob, 'base64'); b[b.length - 1] ^= 1;      // tampered with
  assert.throws(() => openBlob(k, b.toString('base64')));
  // Two seals of the same message differ (a fresh key and iv each time).
  assert.notEqual(await sealForHook(k.pub, 'x'), await sealForHook(k.pub, 'x'));
  // The largest body the service takes still seals.
  const big = await sealForHook(k.pub, JSON.stringify({ body: '\u0001'.repeat(16 * 1024) }));
  assert.equal(openBlob(k, big).body.length, 16 * 1024);
});

test('JSON with every field', () => {
  const f = readFields('application/json', JSON.stringify({ text: 'Call the vet', kind: 'reminder', project: 'work', due: '2026-11-04T09:30:00' }));
  assert.deepEqual(toItem(f, hook, NOW), { kind: 'reminder', text: 'Call the vet', space: 'work', due_at: new Date(2026, 10, 4, 9, 30).getTime() });
});

test('IFTTT form post: value1, value2, value3', () => {
  const f = readFields('application/x-www-form-urlencoded', 'value1=Freezer&value2=above+10%C2%B0F&value3=');
  assert.deepEqual(toItem(f, hook, NOW), { kind: 'todo', text: 'Freezer · above 10°F', space: 'farm', due_at: NOW });
});

test('plain text, and JSON sent as plain text', () => {
  assert.equal(toItem(readFields('text/plain', '  Gate left\nopen  '), hook, NOW).text, 'Gate left open');
  assert.equal(toItem(readFields('text/plain', '{"message":"Hi","kind":"note"}'), hook, NOW).kind, 'note');
  assert.equal(toItem(readFields('', '"just a string"'), hook, NOW).text, 'just a string');
});

test('curl -d with plain words (sent as a form) is text, not a field name', () => {
  assert.equal(toItem(readFields('application/x-www-form-urlencoded', 'Gate left open'), hook, NOW).text, 'Gate left open');
  assert.equal(toItem(readFields('application/x-www-form-urlencoded', 'text=Gate+left+open&kind=note'), hook, NOW).kind, 'note');
});

test('a phone shortcut\'s multipart form', () => {
  const body = '--XyZ\r\nContent-Disposition: form-data; name="text"\r\n\r\nPick up feed\r\n--XyZ\r\nContent-Disposition: form-data; name="kind"\r\n\r\ntodo\r\n--XyZ\r\nContent-Disposition: form-data; name="photo"; filename="a.jpg"\r\n\r\nBINARY\r\n--XyZ--\r\n';
  const f = readFields('multipart/form-data; boundary=XyZ', body);
  assert.equal(f.photo, undefined);
  assert.deepEqual(toItem(f, hook, NOW), { kind: 'todo', text: 'Pick up feed', space: 'farm', due_at: null });
});

test('fields in the address too, and title with text', () => {
  const f = readFields('application/json', '{"title":"Build failed","body":"main, 3 tests"}', 'kind=note&project=The%20Farm');
  assert.deepEqual(toItem(f, hook, NOW), { kind: 'note', text: 'Build failed: main, 3 tests', space: 'farm', due_at: null });
});

test('project by id or name; unknown falls back to the webhook\'s; a removed project to Personal', () => {
  assert.equal(toItem({ text: 'x', project: 'WORK' }, hook, NOW).space, 'work');
  assert.equal(toItem({ text: 'x', project: '@thefarm' }, hook, NOW).space, 'farm');
  assert.equal(toItem({ text: 'x', project: 'nope' }, hook, NOW).space, 'farm');
  assert.equal(toItem({ text: 'x' }, { ...hook, space: 'deleted' }, NOW).space, 'personal');
});

test('kinds: words people use, and the webhook\'s own default', () => {
  assert.equal(toItem({ text: 'x', kind: 'Task' }, hook, NOW).kind, 'todo');
  assert.equal(toItem({ text: 'x', kind: 'urgent' }, hook, NOW).due_at, NOW);
  assert.equal(toItem({ text: 'x', kind: 'whatever' }, { ...hook, kind: 'note' }, NOW).kind, 'note');
  assert.equal(toItem({ text: 'x', kind: 'reminder' }, hook, NOW).due_at, NOW);   // no time given: now
});

test('something with no text (Home Assistant state) still says what it was', () => {
  const f = readFields('application/json', '{"entity_id":"binary_sensor.gate","state":"on","attributes":{"friendly_name":"Gate"}}');
  assert.match(toItem(f, hook, NOW).text, /^entity_id: binary_sensor\.gate · state: on · attributes: /);
  assert.ok(toItem({}, hook, NOW).error);
  assert.ok(toItem(readFields('text/plain', '   '), hook, NOW).error);
});

test('text is one clean line, at most 500 characters, with no hidden control characters', () => {
  const t = toItem({ text: 'a\u0000b‮c​d' + 'x'.repeat(900) }, hook, NOW).text;
  assert.equal(t.length, 500);
  assert.ok(t.startsWith('a b c d'));
  // HTML is kept as text; the page escapes it when it shows it.
  assert.equal(toItem({ text: '<img src=x onerror=alert(1)>' }, hook, NOW).text, '<img src=x onerror=alert(1)>');
});

test('due: dates, epoch seconds and milliseconds, and words', () => {
  const now = new Date(NOW);
  assert.equal(readDue('2026-11-05', now), new Date(2026, 10, 5, 9, 0).getTime());
  assert.equal(readDue('2026-11-05T15:00:00Z', now), Date.parse('2026-11-05T15:00:00Z'));
  assert.equal(readDue('1793000000', now), 1793000000000);
  assert.equal(readDue('1793000000123', now), 1793000000123);
  assert.equal(readDue('tomorrow 9am', now), new Date(2026, 10, 4, 9, 0).getTime());
  assert.equal(readDue('in 2h', now), NOW + 7200e3);
  assert.equal(readDue('someday', now), null);
  assert.equal(readDue('', now), null);
});

test('odd input never throws', () => {
  for (const [t, b] of [['application/json', '{bad'], ['application/json', '[1,2]'], ['application/json', 'null'], ['multipart/form-data', 'x'], ['application/x-www-form-urlencoded', '%%%'], [undefined, undefined]]) {
    assert.doesNotThrow(() => toItem(readFields(t, b), hook, NOW));
  }
});
