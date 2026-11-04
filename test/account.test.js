import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
process.env.SWITCHBOARD_DATA = process.env.SWITCHBOARD_DATA || '/tmp/switchboard-test';
const { wrapKey, unwrapKey, normRecovery, pairCode, sealForPair, openFromPair } = await import('../lib/sync.js');

const key = randomBytes(32).toString('hex');

test('recovery key locks and unlocks the account key', () => {
  const blob = wrapKey(key, 'K2E24QVYQG04SJVZ25CFN7J7T');
  assert.equal(unwrapKey(blob, 'K2E24QVYQG04SJVZ25CFN7J7T'), key);
  assert.throws(() => unwrapKey(blob, 'K2E24QVYQG04SJVZ25CFN7J7X'));
});

test('recovery key forgives how it is typed', () => {
  assert.equal(normRecovery('k2e24-qvyqg o4sjv z25cf n7j7t'), 'K2E24QVYQG04SJVZ25CFN7J7T');
  assert.equal(normRecovery('ILO'), '110');
});

test('pairing: only the asking computer can open the key', () => {
  const ask = generateKeyPairSync('x25519');
  const pub = ask.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const { pub2, box } = sealForPair(key, pub);
  assert.equal(openFromPair(ask.privateKey, pub, pub2, box), key);
  const other = generateKeyPairSync('x25519');
  const otherPub = other.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  assert.throws(() => openFromPair(other.privateKey, otherPub, pub2, box));
});

test('pairing code is six digits and follows the key', () => {
  const a = generateKeyPairSync('x25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const b = generateKeyPairSync('x25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  assert.match(pairCode(a), /^\d{6}$/);
  assert.equal(pairCode(a), pairCode(a));
  assert.notEqual(pairCode(a), pairCode(b));
});
