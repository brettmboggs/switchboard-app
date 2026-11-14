import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.SWITCHBOARD_DATA = process.env.SWITCHBOARD_DATA || '/tmp/switchboard-test';
const { setSetting } = await import('../lib/db.js');
const { pushPhone, PUSH_KINDS } = await import('../lib/push.js');

function spyFetch() {
  const calls = [];
  globalThis.fetch = async (url, opts) => { calls.push({ url, opts }); return new Response('{}'); };
  return calls;
}

test('does nothing while signed out', () => {
  setSetting('sync', null);
  const calls = spyFetch();
  pushPhone('waiting');
  assert.equal(calls.length, 0);
});

test('sends only the kind, with the account token', () => {
  setSetting('sync', { server: 'https://sync.example/', token: 'tok123', key: 'k' });
  const calls = spyFetch();
  pushPhone('waiting');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://sync.example/v1/push');
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer tok123');
  assert.deepEqual(JSON.parse(calls[0].opts.body), { kind: 'waiting' });
});

test('only phone-worthy kinds are pushed', () => {
  setSetting('sync', { server: 'https://sync.example', token: 'tok123', key: 'k' });
  const calls = spyFetch();
  for (const k of ['finished', 'email', 'teams', 'reminders', 'nonsense']) pushPhone(k);
  assert.equal(calls.length, 0);
  assert.deepEqual([...PUSH_KINDS].sort(), ['builds', 'chat', 'flips', 'waiting']);
});

test('a teammate writing to you pushes "chat" and nothing of what they wrote (lib/chat.js)', () => {
  setSetting('sync', { server: 'https://sync.example', token: 'tok123', key: 'k' });
  const calls = spyFetch();
  pushPhone('chat');
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].opts.body), { kind: 'chat' });
});

test('a failing network never throws', async () => {
  setSetting('sync', { server: 'https://sync.example', token: 'tok123', key: 'k' });
  globalThis.fetch = async () => { throw new Error('offline'); };
  pushPhone('builds');
  await new Promise((r) => setTimeout(r, 10));
});
