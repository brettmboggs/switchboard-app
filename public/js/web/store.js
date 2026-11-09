// What the web board keeps in this browser (IndexedDB): the signed-in session
// (server, email, token, account key) sealed with a key the browser cannot
// export, so the file on disk is useless elsewhere; the owner keys and roster
// numbers it has pinned for each shared project; invite links waiting to be
// used. Sign out wipes all of it. Where IndexedDB is not there (some private
// windows, Node in tests) it lives in memory for this tab only.
const DB = 'switchboard-web', STORE = 'kv';
let mem = new Map(), dbp = null;
function open() {
  if (!globalThis.indexedDB) return null;
  return dbp ||= new Promise((ok) => {
    try {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ok(null);
    } catch { ok(null); }
  });
}
const tx = async (mode, fn) => {
  const db = await open();
  if (!db) return fn(null);
  return new Promise((ok, no) => { const t = db.transaction(STORE, mode), s = t.objectStore(STORE); const r = fn(s); t.oncomplete = () => ok(r?.result); t.onerror = () => no(t.error); });
};
export async function get(k) { const db = await open(); if (!db) return mem.get(k); return tx('readonly', (s) => s.get(k)); }
export async function put(k, v) { const db = await open(); if (!db) { mem.set(k, v); return; } return tx('readwrite', (s) => s.put(v, k)); }
export async function wipe() { mem = new Map(); const db = await open(); if (db) await tx('readwrite', (s) => s.clear()); }

// The session, sealed with a non-extractable AES key that lives only in this browser.
const subtle = globalThis.crypto.subtle, enc = new TextEncoder(), dec = new TextDecoder();
async function wrapKey() {
  let k = await get('wrap');
  if (!k) { k = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); await put('wrap', k); }
  return k;
}
export async function saveSession(s) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, await wrapKey(), enc.encode(JSON.stringify(s)));
  await put('session', { iv, ct });
}
export async function loadSession() { return loadSealed('session'); }
// Anything else kept between visits (your data: public/js/web/data.js), sealed the same way.
export async function saveSealed(k, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, await wrapKey(), enc.encode(JSON.stringify(obj)));
  await put(k, { iv, ct });
}
export async function loadSealed(k) {
  const v = await get(k);
  if (!v) return null;
  try { return JSON.parse(dec.decode(await subtle.decrypt({ name: 'AES-GCM', iv: v.iv }, await wrapKey(), v.ct))); } catch { return null; }
}
