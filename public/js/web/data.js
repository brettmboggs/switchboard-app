// The web board's own Switchboard data, in this browser: your settings
// (projects, rules, prefs, About cards…), pages, to-dos and reminders, the
// same rows as the app keeps in SQLite, plus the share tables the shared core
// asks for (public/js/shared/share-core.js). They sync with your account
// through the same encrypted documents as the app ("settings", "pages",
// "items", "cleared"; lib/sync.js): opened and re-sealed here, never readable
// by the service. Kept between visits sealed in IndexedDB (public/js/web/store.js).
//
// makeData() -> the store the core wants, plus what the page's adapter uses.

// Settings that belong to one computer and never travel (lib/sync.js keeps the same list).
export const LOCAL_ONLY = (k) => k === 'sync' || k === 'syncServer' || k === 'boardUrl' || k === 'inviteTokens' || k === 'deviceId' || k === 'codeRoot' || k === 'rules_v2' || k === 'allowRemote' || k.startsWith('contacts_seeded:');
// The app syncs every setting as its JSON text; the page keeps real values.
const fromWire = (v) => { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return v; } };
const DEFAULT_SPACES = [{ id: 'personal', name: 'Personal', color: '#8A8F98', group: 'Mine' }];
const ITEM_COLS = ['uid', 'kind', 'text', 'space', 'due_at', 'amount', 'cadence', 'created_at', 'done_at', 'notified_at', 'updated_at'];

export function makeData() {
  const settings = new Map();    // key -> { v, at }
  const pages = new Map(), pageTombs = new Map();
  const items = new Map(), itemTombs = new Map();
  let cleared = [];              // passed on as it came: the app's done and snoozed conversations
  const rows = new Map(), kv = new Map();   // the share tables, keyed "share\nuid" and "share\nk"
  let nextId = 1;
  const listeners = new Set();
  const changed = (what) => { for (const f of listeners) try { f(what); } catch {} };
  const now = () => Date.now();

  const D = {
    onLocalChange: () => changed('local'),
    onChange: (f) => listeners.add(f),
    // ---- settings
    getSetting: (k, d) => settings.has(k) ? settings.get(k).v : d,
    setSetting: (k, v) => { settings.set(k, { v, at: Math.max(now(), (settings.get(k)?.at || 0) + 1) }); changed(LOCAL_ONLY(k) ? 'local-only' : 'settings'); },
    spaces: () => D.getSetting('spaces', DEFAULT_SPACES),
    saveSpaces: (list) => D.setSetting('spaces', list),
    // ---- the share tables
    kvGet: (id, k) => kv.has(id + '\n' + k) ? structuredClone(kv.get(id + '\n' + k)) : null,
    kvSet: (id, k, v) => { kv.set(id + '\n' + k, structuredClone(v)); changed('share'); },
    kvClear: (id) => { for (const k of [...kv.keys()]) if (k.startsWith(id + '\n')) kv.delete(k); },
    tracked: (id) => [...rows.values()].filter((r) => r.share_id === id).map((r) => ({ ...r })),
    trackedGet: (id, uid) => rows.has(id + '\n' + uid) ? { ...rows.get(id + '\n' + uid) } : null,
    trackedAll: () => [...rows.values()].map((r) => ({ ...r })),
    trackUpsert: (id, uid, t) => { const k = id + '\n' + uid, cur = rows.get(k); rows.set(k, { share_id: id, uid, kind: t.kind, by: t.by ?? null, at: t.at ?? null, gone_at: t.gone_at ?? null, origin: cur ? cur.origin : (t.origin ?? null), sig: t.sig ?? null }); changed('share'); },
    trackGone: (id, uid, at, by, sig) => { const r = rows.get(id + '\n' + uid); if (r) Object.assign(r, { gone_at: at, by, sig }); changed('share'); },
    trackPrune: (id, before) => { for (const [k, r] of rows) if (r.share_id === id && r.gone_at && r.gone_at < before) rows.delete(k); },
    trackClear: (id) => { for (const [k, r] of rows) if (r.share_id === id) rows.delete(k); },
    trackResign: (id, me) => { for (const r of rows.values()) if (r.share_id === id) { r.sig = null; if (!r.gone_at) r.by = me; } },
    // ---- pages and items, as the core asks for them
    sharePages: (space) => [...pages.values()].filter((p) => p.space === space).map((p) => ({ ...p })),
    shareItems: (space) => [...items.values()].filter((i) => i.space === space && ['note', 'todo', 'reminder'].includes(i.kind)).map((i) => ({ ...i })),
    pageMeta: (uid) => pages.has(uid) ? { updated_at: pages.get(uid).updated_at, space: pages.get(uid).space } : null,
    pageLinked: () => false,   // no "In this project" on the web board
    pageTomb: (uid) => pageTombs.get(uid) || null,
    pageInsert: (p) => { pages.set(p.uid, { private: 0, ...p }); changed('pages'); },
    pageUpdate: (uid, f) => { const p = pages.get(uid); if (p) pages.set(uid, { ...p, ...f }); changed('pages'); },
    pageDelete: (uid, at = now()) => { pages.delete(uid); pageTombs.set(uid, at); changed('pages'); },
    itemMeta: (uid) => items.has(uid) ? { updated_at: items.get(uid).updated_at, space: items.get(uid).space, kind: items.get(uid).kind } : null,
    itemTomb: (uid) => itemTombs.get(uid) || null,
    itemInsert: (i) => { items.set(i.uid, { amount: null, cadence: null, notified_at: null, ...i, id: nextId++ }); changed('items'); },
    itemUpdate: (uid, f) => { const i = items.get(uid); if (i) items.set(uid, { ...i, ...f }); changed('items'); },
    itemDelete: (uid, at = now()) => { items.delete(uid); itemTombs.set(uid, at); changed('items'); },
    pagesHere: (space) => [...pages.values()].filter((p) => p.space === space && !p.private).length,
    makePagesPrivate: (space) => { for (const p of pages.values()) if (p.space === space && !p.private) { p.private = 1; p.updated_at += 1; } changed('pages'); },

    // ---- for the page: everything of yours
    allPages: () => [...pages.values()].map((p) => ({ ...p })),
    page: (uid) => pages.has(uid) ? { ...pages.get(uid) } : null,
    allItems: () => [...items.values()].map((i) => ({ ...i })),
    itemById: (id) => [...items.values()].find((i) => i.id === Number(id)) || null,

    // ---- your account's documents, as lib/sync.js reads and merges them
    docs: {
      pages: {
        read: () => ({ rows: [...pages.values()].map((p) => ({ uid: p.uid, title: p.title, body: p.body, space: p.space, pinned: p.pinned ? 1 : 0, private: p.private ? 1 : 0, created_at: p.created_at, updated_at: p.updated_at })), dead: [...pageTombs].map(([uid, at]) => ({ uid, at })) }),
        merge(remote) {
          let n = 0;
          for (const t of remote?.dead || []) { pageTombs.set(t.uid, t.at); const cur = pages.get(t.uid); if (cur && cur.updated_at <= t.at) { pages.delete(t.uid); n++; } }
          for (const r of remote?.rows || []) {
            const dead = pageTombs.get(r.uid);
            if (dead && dead >= r.updated_at) continue;
            const cur = pages.get(r.uid);
            const priv = r.private === undefined ? (cur?.private || 0) : (r.private ? 1 : 0);
            if (!cur || cur.updated_at < r.updated_at) { pages.set(r.uid, { uid: r.uid, title: r.title, body: r.body, space: r.space, pinned: r.pinned ? 1 : 0, private: priv, created_at: r.created_at, updated_at: r.updated_at }); n++; }
          }
          for (const [uid, at] of pageTombs) if (now() - at > 60 * 86400e3) pageTombs.delete(uid);
          return n;
        }
      },
      settings: {
        read: () => Object.fromEntries([...settings].filter(([k]) => !LOCAL_ONLY(k)).map(([k, v]) => [k, { v: v.v, at: v.at }])),
        merge(remote, preferRemote) {
          let n = 0;
          for (const [k, { v, at }] of Object.entries(remote || {})) {
            if (LOCAL_ONLY(k)) continue;
            const cur = settings.get(k);
            if (!cur || preferRemote || (cur.at || 0) < at) { settings.set(k, { v: fromWire(v), at: Math.max(at, 1) }); n++; }
          }
          return n;
        }
      },
      items: {
        read: () => ({ rows: [...items.values()].map((i) => Object.fromEntries(ITEM_COLS.map((c) => [c, i[c] ?? null]))), dead: [...itemTombs].map(([uid, at]) => ({ uid, at })) }),
        merge(remote) {
          let n = 0;
          for (const t of remote?.dead || []) { itemTombs.set(t.uid, t.at); const cur = items.get(t.uid); if (cur && cur.updated_at <= t.at) { items.delete(t.uid); n++; } }
          for (const r of remote?.rows || []) {
            const dead = itemTombs.get(r.uid);
            if (dead && dead >= r.updated_at) continue;
            const cur = items.get(r.uid);
            if (!cur) { items.set(r.uid, { ...Object.fromEntries(ITEM_COLS.map((c) => [c, r[c] ?? null])), id: nextId++ }); n++; }
            else if (cur.updated_at < r.updated_at) { items.set(r.uid, { ...cur, ...Object.fromEntries(ITEM_COLS.map((c) => [c, r[c] ?? null])) }); n++; }
          }
          for (const [uid, at] of itemTombs) if (now() - at > 60 * 86400e3) itemTombs.delete(uid);
          return n;
        }
      },
      cleared: {
        read: () => cleared.filter((c) => c.at > now() - 30 * 86400e3),
        merge(remote) {
          let n = 0;
          const by = new Map(cleared.map((c) => [c.key, c]));
          for (const r of remote || []) { const cur = by.get(r.key); if (!cur || (cur.updated_at || 0) < (r.updated_at || r.at)) { by.set(r.key, { ...r, updated_at: r.updated_at || r.at }); n++; } }
          cleared = [...by.values()];
          return n;
        }
      }
    },

    // ---- kept between visits (sealed by the caller), and forgotten on sign out
    dump: () => ({ settings: [...settings], pages: [...pages.values()], pageTombs: [...pageTombs], items: [...items.values()], itemTombs: [...itemTombs], cleared, rows: [...rows.values()], kv: [...kv] }),
    load(d) {
      D.clear();
      for (const [k, v] of d?.settings || []) settings.set(k, v);
      for (const p of d?.pages || []) pages.set(p.uid, p);
      for (const [k, v] of d?.pageTombs || []) pageTombs.set(k, v);
      for (const i of d?.items || []) items.set(i.uid, { ...i, id: nextId++ });
      for (const [k, v] of d?.itemTombs || []) itemTombs.set(k, v);
      cleared = d?.cleared || [];
      for (const r of d?.rows || []) rows.set(r.share_id + '\n' + r.uid, r);
      for (const [k, v] of d?.kv || []) kv.set(k, v);
    },
    clear() { settings.clear(); pages.clear(); pageTombs.clear(); items.clear(); itemTombs.clear(); cleared = []; rows.clear(); kv.clear(); }
  };
  return D;
}
