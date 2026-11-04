// The relay between computers: a sealed message says who sent it, who it is
// for and carries a nonce, so the sync operator can pass messages on but not
// send an old one again or to someone else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-relay-'));
process.env.SWITCHBOARD_SESSIONS = 'direct';
const { sealFor, openFrom } = await import('../lib/relay.js');
const { seal } = await import('../lib/sync.js');

const key = randomBytes(32).toString('hex');
const A = 'aaaaaaaaaaaaaaaaaaaaaaaa', B = 'bbbbbbbbbbbbbbbbbbbbbbbb', C = 'cccccccccccccccccccccccc';

test('a sealed message opens once, for its recipient, from its sender', () => {
  const now = 1_800_000_000_000;
  const blob = sealFor({ t: 'queue', term: 'sb-app', text: 'deploy' }, key, A, B, now);
  const m = openFrom(blob, key, B, A, now + 1000);
  assert.equal(m.t, 'queue'); assert.equal(m.text, 'deploy'); assert.equal(m.from, A); assert.equal(m.to, B);
  assert.equal(openFrom(blob, key, B, A, now + 2000), null, 'the same message again is a replay');
  assert.equal(openFrom(sealFor({ t: 'x' }, key, A, B, now), key, C, A, now), null, 'for another device');
  assert.equal(openFrom(sealFor({ t: 'x' }, key, A, B, now), key, B, C, now), null, 'relay says it came from someone else');
  assert.equal(openFrom(sealFor({ t: 'x' }, key, A, B, now), key, B, A, now + 11 * 60e3), null, 'older than the window');
  assert.equal(openFrom(sealFor({ t: 'x' }, key, A, B, now), key, B, A, now - 11 * 60e3), null, 'from the future');
  assert.throws(() => openFrom(sealFor({ t: 'x' }, key, A, B, now), randomBytes(32).toString('hex'), B, A, now), 'another account');
});

test('a broadcast opens on every device, once each', () => {
  const now = 1_800_000_000_000;
  const blob = sealFor({ t: 'terms', terms: [] }, key, A, '*', now);
  assert.equal(openFrom(blob, key, B, A, now).t, 'terms');
  assert.equal(openFrom(blob, key, B, A, now), null);
});

test('nonces are kept per peer, the newest 2000', () => {
  const now = 1_800_000_000_000;
  const first = sealFor({ t: 'x' }, key, C, B, now);
  assert.ok(openFrom(first, key, B, C, now));
  for (let i = 0; i < 2000; i++) assert.ok(openFrom(sealFor({ t: 'x', i }, key, C, B, now), key, B, C, now));
  assert.ok(openFrom(first, key, B, C, now), 'the oldest nonce has been forgotten; the time window still bounds it');
});

test('a computer on an older Switchboard (no sender, recipient or nonce) is still heard', () => {
  const old = seal({ t: 'terms', terms: [] }, key);   // how messages were sealed before Nov 4 2026
  assert.equal(openFrom(old, key, B, A).t, 'terms');
});
