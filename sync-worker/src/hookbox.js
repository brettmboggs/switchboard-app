// Sealing a webhook message so only the account's computers can open it.
//
// Each webhook has an X25519 key pair made on the user's computer; this service
// holds only the public half. A message is sealed the moment it arrives: a fresh
// key pair per message, X25519 with the webhook's public key, HKDF-SHA256 to an
// AES-256-GCM key. What is stored is
//   1 | this message's public key (32) | iv (12) | ciphertext and tag
// in base64. Plain WebCrypto, so the same file runs in the Worker and in Node's
// tests (lib/webhooks.js opens it with node:crypto).

const INFO = 'switchboard-hook';
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode(...u8.subarray(i, i + 8192)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const join = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

// pubB64: the webhook's raw 32-byte public key. message: a string.
export async function sealForHook(pubB64, message) {
  const hookRaw = unb64(pubB64);
  if (hookRaw.length !== 32) throw new Error('bad key');
  const hookKey = await crypto.subtle.importKey('raw', hookRaw, { name: 'X25519' }, false, []);
  const eph = await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
  const ephRaw = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const shared = await crypto.subtle.deriveBits({ name: 'X25519', public: hookKey }, eph.privateKey, 256);
  const hk = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: join(new TextEncoder().encode(INFO), ephRaw, hookRaw) },
    hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(message)));
  return b64(join(new Uint8Array([1]), ephRaw, iv, data));
}
