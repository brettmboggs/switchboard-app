import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-secrets-'));   // its own database
const { db, getSetting, setSetting, setCipher, lockSecrets, hasLockedSecrets } = await import('../lib/db.js');
const { makeCipher } = await import('../lib/secrets.js');
const raw = (k) => db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value;

test('plain secrets already on disk get locked; other settings stay as they are', () => {
  setCipher(null);
  setSetting('gmail', [{ email: 'a@example.com', password: 'app-pass-1234' }]);
  setSetting('spaces', [{ id: 'personal', name: 'Personal' }]);
  assert.match(raw('gmail'), /app-pass-1234/);
  const key = randomBytes(32).toString('hex');
  setCipher(makeCipher(key));
  assert.equal(lockSecrets(), 1);
  assert.ok(raw('gmail').startsWith('enc1:'));
  assert.doesNotMatch(raw('gmail'), /app-pass/);
  assert.match(raw('spaces'), /Personal/);
  assert.equal(getSetting('gmail')[0].password, 'app-pass-1234');
  assert.ok(hasLockedSecrets());
});

test('new secrets are written locked', () => {
  setSetting('microsoft', { refreshToken: 'rt-secret' });
  assert.ok(raw('microsoft').startsWith('enc1:'));
  assert.equal(getSetting('microsoft').refreshToken, 'rt-secret');
});

test('without the key, or with the wrong one, a secret reads as not there', () => {
  setCipher(null);
  assert.equal(getSetting('gmail', 'none'), 'none');
  setCipher(makeCipher(randomBytes(32).toString('hex')));
  assert.equal(getSetting('gmail', 'none'), 'none');
});
