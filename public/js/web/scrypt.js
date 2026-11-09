// scrypt (RFC 7914) for the web board: WebCrypto has no scrypt, and the page
// has no npm dependencies, so this is a small one of our own. PBKDF2-HMAC-SHA256
// comes from WebCrypto; the memory-hard middle (ROMix over Salsa20/8) is here.
// It gives the same bytes as Node's crypto.scryptSync (test/web.test.js checks).
// N = 32768, r = 8 uses 32 MB and about a second; it yields to the page now and then.

function salsa208(B) {   // B: Uint32Array(16), in place
  const x = B.slice();
  const R = (a, b) => (a << b) | (a >>> (32 - b));
  for (let i = 0; i < 8; i += 2) {
    x[4] ^= R(x[0] + x[12], 7); x[8] ^= R(x[4] + x[0], 9); x[12] ^= R(x[8] + x[4], 13); x[0] ^= R(x[12] + x[8], 18);
    x[9] ^= R(x[5] + x[1], 7); x[13] ^= R(x[9] + x[5], 9); x[1] ^= R(x[13] + x[9], 13); x[5] ^= R(x[1] + x[13], 18);
    x[14] ^= R(x[10] + x[6], 7); x[2] ^= R(x[14] + x[10], 9); x[6] ^= R(x[2] + x[14], 13); x[10] ^= R(x[6] + x[2], 18);
    x[3] ^= R(x[15] + x[11], 7); x[7] ^= R(x[3] + x[15], 9); x[11] ^= R(x[7] + x[3], 13); x[15] ^= R(x[11] + x[7], 18);
    x[1] ^= R(x[0] + x[3], 7); x[2] ^= R(x[1] + x[0], 9); x[3] ^= R(x[2] + x[1], 13); x[0] ^= R(x[3] + x[2], 18);
    x[6] ^= R(x[5] + x[4], 7); x[7] ^= R(x[6] + x[5], 9); x[4] ^= R(x[7] + x[6], 13); x[5] ^= R(x[4] + x[7], 18);
    x[11] ^= R(x[10] + x[9], 7); x[8] ^= R(x[11] + x[10], 9); x[9] ^= R(x[8] + x[11], 13); x[10] ^= R(x[9] + x[8], 18);
    x[12] ^= R(x[15] + x[14], 7); x[13] ^= R(x[12] + x[15], 9); x[14] ^= R(x[13] + x[12], 13); x[15] ^= R(x[14] + x[13], 18);
  }
  for (let i = 0; i < 16; i++) B[i] = (B[i] + x[i]) | 0;
}

// BlockMix with Salsa20/8: B (2r blocks of 16 words) -> Y.
function blockMix(B, Y, r) {
  const X = B.slice((2 * r - 1) * 16, 2 * r * 16);
  for (let i = 0; i < 2 * r; i++) {
    for (let j = 0; j < 16; j++) X[j] ^= B[i * 16 + j];
    salsa208(X);
    // Even blocks first, then odd.
    Y.set(X, ((i & 1) * r + (i >> 1)) * 16);
  }
}

async function pbkdf2(pass, salt, len) {
  const key = await crypto.subtle.importKey('raw', pass, 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 1 }, key, len * 8));
}

const yieldNow = () => new Promise((ok) => setTimeout(ok, 0));

export async function scrypt(password, salt, N, r, p, dkLen) {
  if (N < 2 || (N & (N - 1))) throw new Error('scrypt N must be a power of two.');
  const words = 32 * r;   // one block of 128r bytes, as 32-bit words
  const B = await pbkdf2(password, salt, p * 128 * r);
  const out = new Uint8Array(B.length);
  const V = new Uint32Array(words * N), X = new Uint32Array(words), Y = new Uint32Array(words);
  for (let k = 0; k < p; k++) {
    const dv = new DataView(B.buffer, B.byteOffset + k * 128 * r, 128 * r);
    for (let i = 0; i < words; i++) X[i] = dv.getUint32(i * 4, true);
    for (let i = 0; i < N; i++) {
      V.set(X, i * words);
      blockMix(X, Y, r); X.set(Y);
      if ((i & 4095) === 4095) await yieldNow();
    }
    for (let i = 0; i < N; i++) {
      const j = X[(2 * r - 1) * 16] & (N - 1);
      for (let w = 0; w < words; w++) X[w] ^= V[j * words + w];
      blockMix(X, Y, r); X.set(Y);
      if ((i & 4095) === 4095) await yieldNow();
    }
    const ov = new DataView(out.buffer, k * 128 * r, 128 * r);
    for (let i = 0; i < words; i++) ov.setUint32(i * 4, X[i], true);
  }
  return pbkdf2(password, out, dkLen);
}
