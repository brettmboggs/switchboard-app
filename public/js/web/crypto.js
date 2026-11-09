// The web board's cryptography, in the browser with WebCrypto, byte for byte
// the same as the app's (lib/sync.js, lib/share.js): the account key from the
// password (scrypt), sealed documents (AES-256-GCM, "v1 | iv | tag | data"),
// keys locked to someone's public key (X25519 + HKDF-SHA256 + AES-GCM, the
// pairing box), and signatures (Ed25519) over a stable JSON form.
// test/web.test.js runs this in Node and checks it against the app's own code.
import { scrypt } from './scrypt.js';

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder(), dec = new TextDecoder();
export const toB64 = (u8) => { let s = ''; const b = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
export const fromB64 = (s) => Uint8Array.from(atob(String(s)), (c) => c.charCodeAt(0));
export const toHex = (u8) => [...new Uint8Array(u8)].map((b) => b.toString(16).padStart(2, '0')).join('');
export const fromHex = (h) => Uint8Array.from(String(h).match(/../g) || [], (x) => parseInt(x, 16));
export const randomHex = (n) => toHex(crypto.getRandomValues(new Uint8Array(n)));
const cat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

// The same key order everywhere, so a signature over an object checks on any computer.
export const stable = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v)) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : 1)) : v);
export const sha256hex = async (text) => toHex(await subtle.digest('SHA-256', enc.encode(text)));
export const digest = (o) => sha256hex(stable(o));

// ---- the account: auth key (sent, the service keeps a slow hash) and account key (never leaves the browser)
export async function deriveKeys(password, saltHex) {
  const out = await scrypt(enc.encode(String(password).normalize('NFKC')), fromHex(saltHex), 32768, 8, 1, 64);
  return { auth: toHex(out.subarray(0, 32)), key: toHex(out.subarray(32)) };
}

// ---- sealed documents
const aes = (keyHex) => subtle.importKey('raw', fromHex(keyHex), 'AES-GCM', false, ['encrypt', 'decrypt']);
export async function seal(obj, keyHex) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, await aes(keyHex), enc.encode(JSON.stringify(obj))));
  // WebCrypto puts the tag last; the format puts it before the data.
  return toB64(cat(new Uint8Array([1]), iv, ct.subarray(ct.length - 16), ct.subarray(0, ct.length - 16)));
}
export async function unseal(b64, keyHex) {
  const b = fromB64(b64);
  if (b[0] !== 1) throw new Error('Unknown sync format.');
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv: b.subarray(1, 13) }, await aes(keyHex), cat(b.subarray(29), b.subarray(13, 29)));
  return JSON.parse(dec.decode(pt));
}

// ---- key pairs: X25519 (receive keys) and Ed25519 (sign), as SPKI / PKCS8 DER in base64, the app's format
export const importPub = (b64, alg) => subtle.importKey('spki', fromB64(b64), { name: alg }, true, alg === 'X25519' ? [] : ['verify']);
export const importPriv = (b64, alg) => subtle.importKey('pkcs8', fromB64(b64), { name: alg }, false, alg === 'X25519' ? ['deriveBits'] : ['sign']);
export async function newKeyPair(alg) {
  const kp = await subtle.generateKey({ name: alg }, true, alg === 'X25519' ? ['deriveBits'] : ['sign', 'verify']);
  return { pub: toB64(await subtle.exportKey('spki', kp.publicKey)), priv: toB64(await subtle.exportKey('pkcs8', kp.privateKey)) };
}

// ---- the pairing box: a secret locked to one public key
async function boxKey(privateKey, otherPubB64, pubA, pubB) {
  const shared = await subtle.deriveBits({ name: 'X25519', public: await importPub(otherPubB64, 'X25519') }, privateKey, 256);
  const ikm = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode(pubA + pubB), info: enc.encode('switchboard-pair') }, ikm, 256);
  return subtle.importKey('raw', bits, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function sealForPair(text, askPub) {
  const mine = await subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
  const pub2 = toB64(await subtle.exportKey('spki', mine.publicKey));
  const k = await boxKey(mine.privateKey, askPub, askPub, pub2);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, k, enc.encode(text)));
  return { pub2, box: toB64(cat(iv, ct.subarray(ct.length - 16), ct.subarray(0, ct.length - 16))) };
}
export async function openFromPair(privateKey, myPub, pub2, box) {
  const k = await boxKey(privateKey, pub2, myPub, pub2);
  const b = fromB64(box);
  return dec.decode(await subtle.decrypt({ name: 'AES-GCM', iv: b.subarray(0, 12) }, k, cat(b.subarray(28), b.subarray(12, 28))));
}

// ---- signatures
export const signObj = async (privKey, obj) => toB64(await subtle.sign({ name: 'Ed25519' }, privKey, enc.encode(stable(obj))));
const pubCache = new Map();
export async function verifyObj(obj, sigB64, pubB64) {
  if (!pubB64 || !sigB64) return false;
  try {
    let k = pubCache.get(pubB64);
    if (!k) { k = await importPub(pubB64, 'Ed25519'); pubCache.set(pubB64, k); }
    return await subtle.verify({ name: 'Ed25519' }, k, fromB64(sigB64), enc.encode(stable(obj)));
  } catch { return false; }
}

// ---- invites
export const emailHash = (email) => sha256hex('switchboard-invite:' + String(email || '').trim().toLowerCase());
