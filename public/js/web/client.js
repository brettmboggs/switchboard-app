// The web board's own Switchboard: your account, your projects, pages and
// to-dos (public/js/web/data.js), synced with your account through the same
// encrypted documents as the app, and the shared projects you are in or run,
// through the same shared core as the app (public/js/shared/share-core.js).
// Everything is opened, checked, re-sealed and signed here in the browser
// (public/js/web/crypto.js); the sync service never has anything readable.
// makeClient({ base, fetchFn, WS, persist }) so tests can run it in Node.
import { seal, unseal, deriveKeys, randomHex, newKeyPair, importPriv, sealForPair, openFromPair, signObj, verifyObj, sha256hex, stable } from './crypto.js';
import { makeShareCore } from '../shared/share-core.js';
import { makeData } from './data.js';
import * as store from './store.js';
import { makeConnect } from './connect.js';

const lc = (s) => String(s || '').trim().toLowerCase();
const DOCS = ['pages', 'settings', 'items', 'cleared'];

export function makeClient({ base = '', fetchFn = globalThis.fetch, WS = globalThis.WebSocket, persist = true } = {}) {
  const data = makeData();
  const C = {
    seal, unseal, sealForPair, openFromPair, sha256hex, randomHex: async (n) => randomHex(n),
    sign: (priv, obj) => signObj(priv, obj), verify: (obj, sig, pub) => verifyObj(obj, sig, pub),
    newKeyPairs: async () => { const box = await newKeyPair('X25519'), sig = await newKeyPair('Ed25519'); return { pub: box.pub, priv: box.priv, signPub: sig.pub, signPriv: sig.priv }; },
    importBoxPriv: (b64) => importPriv(b64, 'X25519'), importSignPriv: (b64) => importPriv(b64, 'Ed25519')
  };
  async function call(server, path, { method = 'GET', body, token } = {}) {
    const res = await fetchFn((server || base) + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  }
  const session = () => data.getSetting('sync', null);
  const askProviders = async () => {
    const r = await call(base, '/v1/providers').catch(() => null);
    const board = /^https?:\/\/[a-z0-9.-]+(:\d+)?\/?$/i.test(r?.json?.board || '') ? r.json.board : null;
    if (r?.status === 200 && data.getSetting('boardUrl', null) !== board) data.setSetting('boardUrl', board);
  };
  // The live link for shared sessions: the token rides in the subprotocol (a browser cannot set headers there).
  const core = makeShareCore({ store: data, crypto: C, call, askProviders, openSocket: WS ? (url, token) => new WS(url, ['switchboard', 'tok.' + token]) : null });
  const listeners = new Set();
  let lastError = null, accountAt = 0;
  // Your own Microsoft 365 and GitHub, in this browser (public/js/web/connect.js).
  const connect = makeConnect({ data, call, base, fetchFn });
  const changed = () => { for (const f of listeners) try { f(); } catch {} };

  // ---- kept between visits, sealed with this browser's own key
  let saveTimer = null;
  const keep = () => { if (!persist) return; clearTimeout(saveTimer); saveTimer = setTimeout(() => store.saveSealed('data', data.dump()).catch(() => {}), 400); saveTimer?.unref?.(); };
  // A change you made: saved here at once, sent a moment later.
  let soon = null;
  data.onChange((what) => {
    keep();
    if (what === 'settings' || what === 'pages' || what === 'items' || what === 'local') { clearTimeout(soon); soon = setTimeout(() => sync().catch(() => {}), 1200); soon?.unref?.(); }
  });

  // ---- your account's documents, as the app syncs them (lib/sync.js syncNow)
  async function syncAccount({ preferRemote = false } = {}) {
    const s = session();
    if (!s?.token || !s.key) return 0;
    let merged = 0;
    for (const name of DOCS) {
      const doc = data.docs[name];
      for (let attempt = 0; attempt < 3; attempt++) {
        const r = await call(s.server, `/v1/docs/${name}`, { token: s.token });
        if (r.status === 401) throw new Error('Signed out on the sync service. Sign in again.');
        if (r.status !== 200) throw new Error(r.json.error || `Sync failed (${r.status}).`);
        let remote = null;
        if (r.json.body) {
          try { remote = await unseal(r.json.body, s.key); } catch { throw new Error('Your account\'s data could not be unlocked with this password.'); }
          merged += doc.merge(remote, preferRemote && attempt === 0);
        }
        const local = doc.read();
        if (remote && stable(local) === stable(remote)) break;
        if (!remote && (name === 'cleared' ? !local.length : name === 'settings' ? !Object.keys(local).length : !local.rows.length && !local.dead.length)) break;
        const put = await call(s.server, `/v1/docs/${name}`, { method: 'PUT', token: s.token, body: { body: await seal(local, s.key), baseVersion: r.json.version || 0 } });
        if (put.status === 200) break;
        if (put.status !== 409) throw new Error(put.json.error || 'Sync failed.');
      }
    }
    accountAt = Date.now();
    return merged;
  }

  let busy = null;
  async function sync({ preferRemote = false } = {}) {
    if (!session()?.token) return 0;
    if (busy) return busy;
    busy = (async () => {
      let n = 0;
      try { n += await syncAccount({ preferRemote }); n += await core.syncShares(); if (n) n += await syncAccount(); lastError = null; }
      catch (e) { lastError = e.message; }
      busy = null; keep(); changed();
      return n;
    })();
    return busy;
  }

  // ---- signing up and in
  async function started(s, { preferRemote = false } = {}) {
    data.setSetting('sync', s);
    if (persist) await store.saveSession(s);
    connectRelay();
    await sync({ preferRemote });
    if (lastError) throw new Error(lastError);
  }
  async function signUp(email, password) {
    if (String(password || '').length < 10) throw new Error('Use a password of at least 10 characters. It also unlocks your data, so keep it somewhere safe.');
    const salt = randomHex(16);
    const { auth, key } = await deriveKeys(password, salt);
    const r = await call(base, '/v1/signup', { method: 'POST', body: { email, salt, auth, device: 'Web board' } });
    if (r.status !== 200) throw new Error(r.json.error || 'Could not create the account.');
    await started({ server: base, email: lc(email), token: r.json.token, key });
  }
  async function signIn(email, password) {
    const s = await call(base, '/v1/salt', { method: 'POST', body: { email } });
    if (s.status !== 200) throw new Error(s.json.error || 'Could not reach the sync service.');
    const { auth, key } = await deriveKeys(password, s.json.salt);
    const r = await call(base, '/v1/login', { method: 'POST', body: { email, auth, device: 'Web board' } });
    if (r.status !== 200) throw new Error(r.json.error || 'Could not sign in.');
    // Signing in: what the account already has wins over anything typed here before.
    await started({ server: base, email: lc(email), token: r.json.token, key }, { preferRemote: true });
  }
  // Forgot password (sync-worker/src/reset.js): a code by email, then a new password.
  // What this browser has goes up again, locked with the new password.
  async function resetStart(email) {
    const r = await call(base, '/v1/reset/start', { method: 'POST', body: { email } });
    if (r.status !== 200) throw new Error(r.json.error || 'Could not reach the sync service.');
  }
  async function resetFinish(email, code, password) {
    if (String(password || '').length < 10) throw new Error('Use a password of at least 10 characters. It also unlocks your data, so keep it somewhere safe.');
    const salt = randomHex(16);
    const { auth, key } = await deriveKeys(password, salt);
    const r = await call(base, '/v1/reset/finish', { method: 'POST', body: { email, code, salt, auth, device: 'Web board' } });
    if (r.status !== 200) throw new Error(r.json.error || 'Could not set the new password.');
    await started({ server: base, email: lc(email), token: r.json.token, key });
  }
  async function signOut() {
    const s = session();
    if (s?.token) await call(s.server, '/v1/logout', { method: 'POST', token: s.token }).catch(() => {});
    clearTimeout(soon); clearTimeout(saveTimer);
    core.forget(); data.clear();
    try { ws?.close(); } catch {}
    ws = null;
    if (persist) await store.wipe();
    changed();
  }
  async function resume() {
    if (!persist) return false;
    const d = await store.loadSealed('data');
    if (d) data.load(d);
    const s = await store.loadSession();
    if (!s) { data.clear(); return false; }
    data.setSetting('sync', s);
    connectRelay();
    sync().catch(() => {});
    return true;
  }

  // ---- live: the service says when one of your computers or someone in a shared project saved
  let ws = null, wsRetry = 2000;
  function connectRelay() {
    const s = session();
    if (!WS || !s?.token || ws) return;
    const url = (s.server || base).replace(/^http/, 'ws') + `/v1/relay?device=web-${randomHex(6)}&name=${encodeURIComponent('Web board')}`;
    try { ws = new WS(url, ['switchboard', 'tok.' + s.token]); } catch { ws = null; return; }
    ws.onopen = () => { wsRetry = 2000; };
    ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } if (m.from === 'service' && (m.type === 'shares' || m.type === 'docs')) sync(); };
    ws.onclose = () => { ws = null; if (session()?.token) setTimeout(connectRelay, wsRetry = Math.min(wsRetry * 2, 60000))?.unref?.(); };
  }

  return {
    data, core, connect, sync, signUp, signIn, resetStart, resetFinish, signOut, resume,
    onChange: (f) => listeners.add(f),
    get session() { return session(); },
    get error() { return lastError; },
    get syncedAt() { return accountAt; }
  };
}
