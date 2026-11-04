// This computer's own key for the passwords, tokens and private links in its
// database (db.js SECRET_SETTINGS). The key lives in the OS keychain (see
// desktop.js); the database holds only what it locks. Synced copies are sealed
// separately with the account key, so other computers never need this one.
//
// At login the keychain can answer a moment after Switchboard starts, so "no
// answer" is never taken as "no key": while locked data exists, it waits and
// asks again. Only a keychain that answers "there is no key" (it was reset)
// means the old secrets are gone; signing in to the account brings them back.
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, setCipher, lockSecrets, hasLockedSecrets } from './db.js';
import { keychainGet, keychainSet } from './desktop.js';

let state = { ready: false, where: null, lost: false, waiting: false };
export const secretsState = () => state;

const KEY_FILE = () => join(DATA_DIR, 'local.key');
const writeKeyFile = (hex) => writeFileSync(KEY_FILE(), hex, { mode: 0o600 });

export function makeCipher(hex) {
  const key = Buffer.from(hex, 'hex');
  return {
    encode(text) {
      const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([c.update(text, 'utf8'), c.final()]);
      return 'enc1:' + Buffer.concat([iv, c.getAuthTag(), data]).toString('base64');
    },
    decode(stored) {
      const b = Buffer.from(stored.slice(5), 'base64');
      const d = createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
      d.setAuthTag(b.subarray(12, 28));
      return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
    }
  };
}

function obtainKey(tries) {
  // A computer without a keychain (chosen earlier): its key is a private file.
  if (existsSync(KEY_FILE())) return { hex: readFileSync(KEY_FILE(), 'utf8').trim(), where: 'file' };
  const got = keychainGet('local-key', DATA_DIR);
  if (got && /^[0-9a-f]{64}$/.test(got)) return { hex: got, where: 'keychain' };
  if (got === undefined) {
    // No answer. Locked data means wait for it; with nothing locked yet, give a
    // slow keychain a minute, then use a private file (a computer with none).
    if (hasLockedSecrets() || tries < 6) return null;
    const hex = randomBytes(32).toString('hex'); writeKeyFile(hex);
    return { hex, where: 'file' };
  }
  // The keychain says there is no key: first run here, or it was reset.
  const hex = randomBytes(32).toString('hex');
  const lost = hasLockedSecrets();
  if (keychainSet('local-key', hex, DATA_DIR)) return { hex, where: 'keychain', lost };
  writeKeyFile(hex);
  return { hex, where: 'file', lost };
}

export function startSecrets(onReady) {
  const attempt = (tries) => {
    const k = obtainKey(tries);
    if (!k) { state = { ...state, waiting: true }; setTimeout(() => attempt(tries + 1), 10000); return; }
    setCipher(makeCipher(k.hex));
    const locked = lockSecrets();
    state = { ready: true, where: k.where, lost: !!k.lost, waiting: false };
    if (locked) console.log(`Locked ${locked} saved setting(s) with this computer's key (${k.where}).`);
    onReady();
  };
  attempt(0);
}
