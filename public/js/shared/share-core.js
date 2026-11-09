// Shared projects and your team: the one implementation, for the app (lib/share.js,
// over SQLite and node:crypto) and the web board (public/js/web/client.js, over
// the browser's store and WebCrypto). Plain ES module, no imports: what differs
// between the two is handed in.
//
// People first: you add someone to your team once, by their Switchboard
// account's email, then choose which of your projects they are in, whether
// they are an admin, and for each kind of thing whether they can see it, edit
// it, or neither:
//   pages     pages and their checklists (a page set to Only me never leaves)
//   tasks     to-dos, reminders and quick notes
//   repos     the project's repo names (and, for the web board, their builds and pull requests)
//   activity  what each person is working on: a session's name and state, pushes and pull requests
//   about     the project's About card
// Never shared: mail, Teams, texts, terminals or what is in them, prompts,
// connections, accounts, tokens, signatures, bills or the rules that sort things.
//
// How it holds (sync-worker/src/shares.js says what the service keeps):
// - Each shared project has a key, and each kind in it a key of its own. A
//   person gets, locked to their X25519 public key, the project key and the
//   keys of the kinds they may see. Changing who sees a kind, or removing
//   someone, gives everything new keys (a new epoch).
// - Every page, to-do, deletion, About card, repo list and activity line is
//   signed (Ed25519) by whoever wrote it, and believed only if the policy lets
//   that person edit that kind.
// - The policy is signed by the owner or an admin; the roster (who the admins
//   are) by the owner alone, whose key is pinned the first time it is seen and
//   whose roster number never goes back.
//
// makeShareCore({ store, crypto, call, friendlyError, inviteBaseDefault, askProviders })
//   store   synchronous: settings, the per-share tables, pages and items (see lib/share.js for SQLite, public/js/web/store.js for the browser)
//   crypto  asynchronous: seal, unseal, sealForPair, openFromPair, sign, verify, sha256hex, randomHex, newKeyPairs, importBoxPriv, importSignPriv
//   call    (server, path, { method, body, token }) -> { status, json }

// Everything a project has, each its own sealed box and its own key. Pages, to-dos and the About card
// are written by anyone who may edit them; the rest is published by the computer that has it (the
// owner's, mostly): repos with their builds and pull requests, browser checks' results, activity,
// the project's conversations, calendar events, money and files. Sessions come live, not in the box.
export const SHARE_KINDS = ['pages', 'tasks', 'repos', 'checks', 'activity', 'sessions', 'conversations', 'calendar', 'money', 'files', 'about'];
export const PUBLISHED = ['checks', 'conversations', 'calendar', 'money', 'files'];
export const LEVELS = ['none', 'see', 'edit', 'send'];
// The levels each kind can have: published ones can only be seen; a session can also be sent to (with Approve).
export const LEVELS_OF = (kind) => PUBLISHED.includes(kind) ? ['none', 'see'] : kind === 'sessions' ? ['none', 'see', 'send'] : ['none', 'see', 'edit'];
// What a newly added person gets in a project until you change it: the first five as before, everything new off.
export const DEFAULT_KINDS = { pages: 'edit', tasks: 'edit', repos: 'see', checks: 'none', activity: 'none', sessions: 'none', conversations: 'none', calendar: 'none', money: 'none', files: 'none', about: 'see' };
// "Give everything" (a co-founder): the most each kind allows.
export const ALL_KINDS = Object.fromEntries(SHARE_KINDS.map((k) => [k, LEVELS_OF(k).at(-1)]));
const KEEP_GONE = 60 * 86400e3, ACTIVITY_AGE = 2 * 86400e3, ACTIVITY_MAX = 8;
const ITEM_KINDS = ['note', 'todo', 'reminder'];
export const lc = (s) => String(s || '').trim().toLowerCase();
// A section of a page shared on its own travels as a read-only page with an id of its own (lib/share.js sharePages).
export const isSection = (uid) => /^sec[0-9a-f]{21}$/.test(String(uid || ''));
// The same key order everywhere, so a signature over an object checks on any computer.
export const stable = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v)) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : 1)) : v);
export const cleanKinds = (k = {}) => Object.fromEntries(SHARE_KINDS.map((x) => [x, LEVELS_OF(x).includes(k[x]) ? k[x] : DEFAULT_KINDS[x]]));
// owner/name as GitHub makes them; never starting with "-" (it becomes an argument to gh and git; review L1).
export const okRepo = (r) => typeof r === 'string' && /^[A-Za-z0-9][\w.-]{0,99}\/(?!-)[\w.-]{1,100}$/.test(r) && !r.includes('..');
// Activity carries these fields and nothing else, whatever the source gives: no
// terminal text, no prompt, no message, no detail line.
const ACT_STATES = new Set(['working', 'waiting', 'done', 'idle']);
export function cleanActivity(list) {
  return (Array.isArray(list) ? list : []).map((a) => {
    const at = Number(a?.at) || 0;
    if (Date.now() - at > ACTIVITY_AGE) return null;
    if (a?.kind === 'session') return ACT_STATES.has(a.state) ? { kind: 'session', name: String(a.name || 'A session').replace(/\s+/g, ' ').slice(0, 60), state: a.state, at } : null;
    if ((a?.kind === 'push' || a?.kind === 'pr') && okRepo(a.repo)) return { kind: a.kind, repo: a.repo, branch: String(a.branch || '').replace(/[^\w./-]/g, '').slice(0, 80), at };
    return null;
  }).filter(Boolean).sort((x, y) => y.at - x.at).slice(0, ACTIVITY_MAX);
}
// Builds and pull requests: only these fields, so nothing else of anyone's GitHub travels.
const ciText = (s, n) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').slice(0, n);
const okGhUrl = (u) => typeof u === 'string' && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(actions\/runs|pull)\/\d+/.test(u) ? u : null;
export function cleanCi(ci) {
  if (!ci) return null;
  const runs = (ci.runs || []).filter((r) => okRepo(r.fullName)).slice(0, 12).map((r) => ({ id: Number(r.id) || 0, fullName: r.fullName, workflow: ciText(r.workflow, 80), title: ciText(r.title, 120), branch: ciText(r.branch, 80), state: ['running', 'failed', 'done'].includes(r.state) ? r.state : 'done', url: okGhUrl(r.url), updatedAt: Number(r.updatedAt) || 0 }));
  const prs = (ci.prs || []).filter((x) => okRepo(x.repo)).slice(0, 12).map((x) => ({ id: Number(x.id) || 0, number: Number(x.number) || 0, title: ciText(x.title, 120), repo: x.repo, url: okGhUrl(x.url), author: ciText(x.author, 40), updatedAt: Number(x.updatedAt) || 0 }));
  return runs.length || prs.length ? { runs, prs } : null;
}

// What each published kind carries, and nothing more.
const txt = (v, n) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, n);
const num = (v) => Number.isFinite(Number(v)) ? Number(v) : null;
const CLEAN = {
  checks: (c) => ({ name: txt(c.name, 120), state: ['passed', 'failed', 'running', 'never'].includes(c.state) ? c.state : 'never', at: num(c.at), detail: txt(c.detail, 200) }),
  conversations: (c) => ({ key: txt(c.key, 200), kind: ['mail', 'teams', 'outlook', 'voice'].includes(c.kind) ? c.kind : 'mail', who: txt(c.who, 120), subject: txt(c.subject, 200), date: num(c.date), snippet: txt(c.snippet, 300),
    messages: (Array.isArray(c.messages) ? c.messages : []).slice(-8).map((m) => ({ from: txt(m.from, 120), date: num(m.date), text: txt(m.text, 4000) })) }),
  calendar: (e) => ({ title: txt(e.title, 200), start: num(e.start), end: num(e.end), where: txt(e.where, 200), allDay: !!e.allDay }),
  money: (m) => ({ kind: ['bill', 'invoice', 'paid'].includes(m.kind) ? m.kind : 'paid', text: txt(m.text, 200), amount: num(m.amount), due_at: num(m.due_at), at: num(m.at), cadence: ['weekly', 'monthly', 'quarterly', 'yearly'].includes(m.cadence) ? m.cadence : null }),
  files: (f) => ({ name: txt(f.name, 200), size: num(f.size), at: num(f.at) })
};
const LIMIT = { checks: 30, conversations: 15, calendar: 60, money: 60, files: 100 };
export const cleanPublished = (kind, list) => (Array.isArray(list) ? list : []).slice(0, LIMIT[kind] || 30).map(CLEAN[kind]);

// ---- what gets signed (the protocol: change these and every Switchboard disagrees)
const rowContent = (kind, r) => kind === 'pages' ? { t: r.title, b: r.body, p: r.pinned ? 1 : 0, c: r.created_at } : { k: r.kind, t: r.text, d: r.due_at ?? null, c: r.created_at, x: r.done_at ?? null };
const deadBody = (id, kind, d) => ({ s: id, k: 'gone:' + kind, uid: d.uid, at: d.at, by: lc(d.by) });
const mapBody = (id, kind, email, e) => ({ s: id, k: kind, by: email, list: e.list, at: e.at, ...(e.ci ? { ci: e.ci } : {}) });
const aboutBody = (id, a) => ({ s: id, k: 'about', profile: a.profile, at: a.at, by: lc(a.by) });
const policyBody = (id, p) => ({ share: id, grants: p.grants, at: p.at, by: p.by });
const pendingBody = (g) => ({ share: g.share, emailHash: g.emailHash, kinds: g.kinds, at: g.at, by: g.by });

export function makeShareCore({ store: S, crypto: C, call, friendlyError = (e) => e?.message || String(e), inviteBaseDefault = '', askProviders = async () => {}, openSocket = null }) {
  const digest = (o) => C.sha256hex(stable(o));
  const rowBody = async (id, kind, r) => ({ s: id, k: kind, uid: r.uid, at: r.updated_at, by: lc(r.by), h: await digest(rowContent(kind, r)) });
  const emailHashOf = (email) => C.sha256hex('switchboard-invite:' + lc(email));
  const tokenHash = (t) => C.sha256hex(String(t));

  // ---- what this computer knows about the project (the app's server.js says; the browser has none)
  let repoSource = () => [], activitySource = () => [], ciSource = () => null, publishes = false;
  const sources = {};   // published kind -> (space) -> list, from the app's server.js

  // ---- the account's sharing keys
  let mine = null;   // { pub, priv, signPub, signPriv, forToken }
  function account() {
    const s = S.getSetting('sync', null);
    if (!s?.token) throw new Error('Sharing needs a Switchboard account. Make one, or sign in, in Settings, Account.');
    if (!s.key) throw new Error('This computer is signed in but does not have your account key yet. Finish signing in, in Settings, Account.');
    return s;
  }
  const req = async (path, opts = {}) => {
    const s = account();
    const r = await call(s.server, path, { ...opts, token: s.token });
    if (r.status === 401) throw new Error('Signed out on the sync service. Sign in again in Settings, Account.');
    return r;
  };
  async function myKey() {
    const s = account();
    if (mine && mine.forToken === s.token) return mine;
    const r = await req('/v1/share-key');
    if (r.status !== 200) throw new Error(r.json.error || 'Could not reach the sync service.');
    if (r.json.pub) {
      let w;
      try { w = await C.unseal(r.json.wrapped, s.key); } catch { throw new Error('Your sharing key could not be unlocked with this account key.'); }
      mine = { pub: r.json.pub, priv: await C.importBoxPriv(w.priv), signPub: r.json.signPub, signPriv: await C.importSignPriv(w.sign), forToken: s.token };
      mine.code = await codeOf(mine.pub, mine.signPub);
      return mine;
    }
    const kp = await C.newKeyPairs();
    const wrapped = await C.seal({ priv: kp.priv, sign: kp.signPriv }, s.key);
    const put = await req('/v1/share-key', { method: 'PUT', body: { pub: kp.pub, signPub: kp.signPub, wrapped } });
    if (put.status === 409) { mine = null; return myKey(); }   // another of your computers set it first
    if (put.status !== 200) throw new Error(put.json.error || 'Could not set up sharing.');
    mine = { pub: kp.pub, priv: await C.importBoxPriv(kp.priv), signPub: kp.signPub, signPriv: await C.importSignPriv(kp.signPriv), forToken: s.token };
    mine.code = await codeOf(mine.pub, mine.signPub);
    return mine;
  }
  // A person's keys for a project: the project key, and the keys of the kinds they may see.
  const lockFor = async (bundle, pub) => JSON.stringify(await C.sealForPair(JSON.stringify(bundle), pub));
  async function openLock(lock) {
    const k = await myKey(), { pub2, box } = JSON.parse(lock);
    let raw;
    // Locked to keys this account had before a password reset: the owner's (or an admin's) computer locks it again soon.
    try { raw = await C.openFromPair(k.priv, k.pub, pub2, box); } catch { throw Object.assign(new Error('This project is waiting to be locked to your new password. It opens by itself once the person who runs it is online.'), { lockStale: true }); }
    // Before the team, a lock held the project key alone.
    if (!raw.startsWith('{')) return { k: raw, kinds: null, legacy: true };
    const b = JSON.parse(raw);
    return { k: b.k, kinds: b.kinds || {}, legacy: false };
  }
  const signed = async (obj) => C.sign((await myKey()).signPriv, obj);
  const checks = (obj, sig, signPub) => signPub && sig ? C.verify(obj, sig, signPub) : false;
  async function lookup(email) {
    const r = await req(`/v1/share-key/lookup?email=${encodeURIComponent(email)}`);
    if (r.status !== 200) throw new Error(r.json.error || 'Could not find their account.');
    return r.json;
  }

  // ---- people's keys, pinned the first time this account sees them (docs/REVIEW-2026-11-05.md M3).
  // The sync service hands out everyone's public keys; one it swapped would let it open what is locked
  // to them from then on. So each person's keys are kept (peerKeys, which follows you to your own
  // computers), nothing is ever locked to a key that differs from the kept one, and Team says so.
  // A check code (from both keys) lets two people compare, by phone or in person, that the keys are theirs.
  const peerKeys = () => S.getSetting('peerKeys', {}) || {};
  const keyChanges = () => S.getSetting('keyChanged', {}) || {};
  const codeOf = async (pub, signPub) => {
    const h = await C.sha256hex('switchboard-check-code\n' + pub + '\n' + signPub);
    return [0, 1, 2, 3, 4, 5].map((i) => String(parseInt(h.slice(i * 7, i * 7 + 7), 16) % 10000).padStart(4, '0')).join(' ');
  };
  async function pinKeys(email, keys) {
    const e = lc(email), all = peerKeys(), cur = all[e] || {};
    const next = { ...cur, ...(keys.pub && !cur.pub ? { pub: keys.pub } : {}), ...(keys.signPub && !cur.signPub ? { signPub: keys.signPub } : {}) };
    if (next.pub && next.signPub && !next.code) next.code = await codeOf(next.pub, next.signPub);
    if (JSON.stringify(next) !== JSON.stringify(cur)) S.setSetting('peerKeys', { ...all, [e]: { ...next, at: cur.at || Date.now() } });
  }
  // A change is kept with both keys the service shows and the code they make, so what Team shows is
  // exactly what "the codes match" takes. The same keys seen again leave it as it is; new ones replace it
  // (and its code), so an approval of the code shown before is refused (trustNewKeys).
  async function noteChange(e, got) {
    const pub = typeof got?.pub === 'string' ? got.pub : null, signPub = typeof got?.signPub === 'string' ? got.signPub : null;
    const was = keyChanges()[e];
    if (was && was.pub === pub && was.signPub === signPub) return;
    S.setSetting('keyChanged', { ...keyChanges(), [e]: { pub, signPub, code: pub && signPub ? await codeOf(pub, signPub) : null, at: Date.now() } });
  }
  const keyChangedError = (email) => Object.assign(new Error(`${nameIn(null, email)}'s keys on the sync service are not the ones this computer knows for them, so nothing new is locked to them. Compare check codes with them in Settings, Team before going on.`), { keyChanged: true });
  // Someone's keys from the service, only if they are the ones kept (or the first seen); expectSign: the signing key a signed roster or policy names.
  async function keysOf(email, expectSign = null) {
    const e = lc(email), got = await lookup(e), cur = peerKeys()[e] || {};
    const differs = (cur.pub && cur.pub !== got.pub) || (cur.signPub && cur.signPub !== got.signPub) || (expectSign && expectSign !== got.signPub);
    if (differs) { await noteChange(e, got); throw keyChangedError(e); }
    await pinKeys(e, got);
    return got;
  }
  // Everyone in a project you are in, kept once with both keys (so each has a check code): checked against
  // the signing key the signed roster or policy names. Asked once per person, not every round.
  async function completeKeys(me) {
    const seen = new Set();
    for (const x of list) {
      if (x.status !== 'joined') continue;
      for (const m of x.members) {
        const e = lc(m.email);
        if (e === me || seen.has(e) || peerKeys()[e]?.code || keyChanges()[e]) continue;
        seen.add(e);
        try { await keysOf(e, signPubOf(x.id, e)); } catch {}
      }
    }
  }
  // After comparing check codes: use their new keys from now on. code: the one Team showed, which has to be
  // the one kept now (keys that changed again since are not what was compared). The kept keys are only ever
  // replaced by a whole pair whose code was compared, never dropped.
  async function trustNewKeys(email, code) {
    const e = lc(email), ch = keyChanges()[e];
    if (!ch) throw new Error('Their keys have not changed.');
    if (!ch.pub || !ch.signPub || !ch.code || ch.code !== (await codeOf(ch.pub, ch.signPub))) throw new Error('There is no check code to compare for them yet. Wait for the next sync, then compare the code Team shows.');
    if (String(code || '').trim() !== ch.code) throw new Error('Their keys changed again since that check code was shown. Compare the new code Team shows now before using it.');
    S.setSetting('peerKeys', { ...peerKeys(), [e]: { pub: ch.pub, signPub: ch.signPub, code: ch.code, at: Date.now() } });
    const rest = { ...keyChanges() }; delete rest[e]; S.setSetting('keyChanged', rest);
    return { email: e };
  }
  // You compared codes with them and they matched (or you take it back).
  function markChecked(email, yes = true) {
    const e = lc(email), all = peerKeys();
    if (!all[e]) throw new Error('This computer does not have their keys yet.');
    S.setSetting('peerKeys', { ...all, [e]: { ...all[e], checked: !!yes } });
  }

  // ---- which local project each share is: the owner's own project; for a member, one made on joining
  const shareMap = () => S.getSetting('shareMap', {});
  const spaceOfShare = (id) => shareMap()[id] || null;
  const shareOfSpace = (space) => Object.entries(shareMap()).find(([, s]) => s === space)?.[0] || null;
  const mapShare = (id, space) => S.setSetting('shareMap', { ...shareMap(), [id]: space });
  function unmapShare(id) {
    const m = { ...shareMap() }; delete m[id]; S.setSetting('shareMap', m);
    S.trackClear(id); S.kvClear(id);
  }
  // Where an invite link opens: the inviteBase setting, the web board the sync service serves, or its /join page.
  const inviteBase = () => String(S.getSetting('inviteBase', null) || inviteBaseDefault || (S.getSetting('boardUrl', null) ? S.getSetting('boardUrl', null).replace(/\/$/, '') + '/' : '') || ((S.getSetting('sync', null)?.server || '').replace(/\/$/, '') + '/join'));
  const inviteLink = (email, token, project = '') => `${inviteBase()}#join?email=${encodeURIComponent(lc(email))}&t=${token}${project ? '&p=' + encodeURIComponent(project) : ''}`;
  let pendingMine = [];        // invites for this account that came without their link
  const pendingOf = new Map(); // share id -> invites by email for projects you run
  let joinError = null;
  const joining = () => S.getSetting('acceptedInvites', {});
  const trustedTeams = () => S.getSetting('trustedTeams', {});

  // ---- roles: the roster the owner signed
  const rosters = new Map();
  async function readRoster(x) {
    let r = null;
    try { r = JSON.parse(x.roster || 'null'); } catch {}
    const pin = S.kvGet(x.id, 'ownerSign');
    const seq = S.kvGet(x.id, 'rosterSeq') || 0;
    // A roster that does not check names nobody: the service's own list could name anyone owner (review L1).
    const fallback = { ok: false, owner: null, ownerSign: pin, admins: {} };
    if (!r || r.share !== x.id || !r.owner?.signPub) return fallback;
    if (pin && pin !== r.owner.signPub) return fallback;
    if (!(await checks(r, x.rosterSig, r.owner.signPub)) || (r.seq || 0) < seq) return fallback;
    // The owner's signing key, across projects: a new project in their name with another key is not believed (M3).
    const ownerE = lc(r.owner.email), me = lc(S.getSetting('sync', null)?.email), kept = peerKeys()[ownerE];
    if (ownerE !== me && kept?.signPub && kept.signPub !== r.owner.signPub) {
      // Both keys and their code, as the service shows them (they should be the ones the roster names), so it can be compared.
      let got = null;
      try { got = await lookup(ownerE); } catch {}
      await noteChange(ownerE, got?.signPub === r.owner.signPub ? got : { pub: null, signPub: r.owner.signPub });
      return fallback;
    }
    if (ownerE !== me) await pinKeys(ownerE, { signPub: r.owner.signPub });
    if (!pin) S.kvSet(x.id, 'ownerSign', r.owner.signPub);
    S.kvSet(x.id, 'rosterSeq', r.seq || 0);
    return { ok: true, owner: lc(r.owner.email), ownerSign: r.owner.signPub, admins: Object.fromEntries(Object.entries(r.admins || {}).map(([e, k]) => [lc(e), k])), seq: r.seq || 0 };
  }
  const rosterOf = (id) => rosters.get(id) || { ok: false, owner: null, admins: {} };
  const roleOf = (id, email) => { const r = rosterOf(id); return lc(email) === r.owner ? 'owner' : r.admins[lc(email)] ? 'admin' : 'member'; };
  const canManage = (id, email) => ['owner', 'admin'].includes(roleOf(id, email));

  // ---- the policy: who is in, their signing key, and what each may see or edit
  async function policyValid(id, p) {
    if (!p?.grants || !p.by) return false;
    const r = rosterOf(id), by = lc(p.by);
    const key = by === r.owner ? r.ownerSign : r.admins[by];
    return checks(policyBody(id, p), p.sig, key);
  }
  const policyOf = (id) => S.kvGet(id, 'policy') || { grants: {}, at: 0, by: null };
  async function adoptPolicy(id, p) {
    if (!(await policyValid(id, p))) return false;
    if (tooNew(p.by, p.at)) return false;
    if ((p.at || 0) <= (policyOf(id).at || 0)) return false;
    S.kvSet(id, 'policy', { grants: p.grants, at: p.at, by: lc(p.by), sig: p.sig });
    // Keys named in a policy the owner or an admin signed count as first sight for this computer.
    for (const [e, g] of Object.entries(p.grants || {})) if (!peerKeys()[lc(e)]) await pinKeys(e, { pub: typeof g?.pub === 'string' ? g.pub : null, signPub: typeof g?.signPub === 'string' ? g.signPub : null });
    return true;
  }
  async function makePolicy(id, grants, me) {
    const clean = Object.fromEntries(Object.entries(grants).map(([e, g]) => [lc(e), { signPub: g.signPub, ...(typeof g.pub === 'string' ? { pub: g.pub } : {}), kinds: cleanKinds(g.kinds) }]));
    const p = { grants: clean, at: Math.max(Date.now(), (policyOf(id).at || 0) + 1), by: me };
    return { ...p, sig: await signed(policyBody(id, p)) };
  }
  const levelOf = (id, email, kind) => canManage(id, email) ? 'edit' : (policyOf(id).grants[lc(email)]?.kinds?.[kind] || 'none');
  const kindsOf = (id, email) => Object.fromEntries(SHARE_KINDS.map((k) => [k, levelOf(id, email, k)]));
  const signPubOf = (id, email) => { const r = rosterOf(id), e = lc(email); return e === r.owner ? r.ownerSign : r.admins[e] || policyOf(id).grants[e]?.signPub || null; };
  const believe = async (id, kind, obj, by, sig) => levelOf(id, by, kind) === 'edit' && checks(obj, sig, signPubOf(id, by));

  // ---- the About card (Settings' profiles, minus who was waved away there)
  const profiles = () => S.getSetting('profiles', {});
  const aboutOf = (space) => { const p = profiles()[space] || {}; return { about: p.about || '', people: p.people || [], links: p.links || [] }; };

  // ---- the document
  const others = new Map();
  let refused = 0;
  // Every change carries its writer's clock. One far ahead would win every conflict for as long as it is
  // ahead (a page nobody else can change, a deletion that cannot be undone), so it waits until it is
  // no longer in the future here; whose clock it was is shown in Team (docs/REVIEW-2026-11-05.md M1).
  const SKEW = 10 * 60e3;
  const ahead = new Map();   // email -> { at, seen }
  const tooNew = (by, at) => {
    if (!(Number(at) > Date.now() + SKEW)) return false;
    refused++; ahead.set(lc(by), { at: Number(at), seen: Date.now() });
    return true;
  };
  // A project seen in the team's shape (v3) never goes back to the old one (H1).
  const v3Seen = (id) => !!S.kvGet(id, 'v3');
  const markV3 = (id) => { if (!v3Seen(id)) S.kvSet(id, 'v3', true); };

  // Pages or to-dos as this computer has them, each signed: by its writer as merged, or by you when you changed it.
  async function rowsSection(id, space, kind, me, signPriv, now) {
    const tracked = new Map(S.tracked(id).map((r) => [r.uid, r]));
    const tk = kind === 'pages' ? 'page' : 'item';
    const own = (uid) => { const t = tracked.get(uid); return !t || !t.origin || lc(t.origin) === me; };
    const local = kind === 'pages'
      ? S.sharePages(space).filter((p) => !(p.private && own(p.uid))).map((p) => ({ uid: p.uid, title: p.title, body: p.body, pinned: p.pinned ? 1 : 0, created_at: p.created_at, updated_at: p.updated_at }))
      : S.shareItems(space).map((i) => ({ uid: i.uid, kind: i.kind, text: i.text, due_at: i.due_at ?? null, created_at: i.created_at, done_at: i.done_at ?? null, updated_at: i.updated_at }));
    const rows = [];
    for (const r of local) {
      const t = tracked.get(r.uid);
      if (t && t.at === r.updated_at && !t.gone_at && t.sig && t.by) { rows.push({ ...r, by: t.by, sig: t.sig }); continue; }
      const sig = await C.sign(signPriv, await rowBody(id, kind, { ...r, by: me }));
      S.trackUpsert(id, r.uid, { kind: tk, by: me, at: r.updated_at, gone_at: null, origin: t?.origin || me, sig });
      rows.push({ ...r, by: me, sig });
    }
    // Something that was in the share and is not any more (deleted, moved to
    // another project, or made Only me) goes out as gone, signed, once.
    const here = new Set(rows.map((x) => x.uid));
    for (const t of tracked.values()) {
      if (t.kind !== tk || here.has(t.uid) || t.gone_at) continue;
      const deadAt = tk === 'page' ? S.pageTomb(t.uid) : S.itemTomb(t.uid);
      const at = Math.max(deadAt || now, (t.at || 0) + 1);
      S.trackGone(id, t.uid, at, me, await C.sign(signPriv, deadBody(id, kind, { uid: t.uid, at, by: me })));
    }
    S.trackPrune(id, now - KEEP_GONE);
    const dead = S.tracked(id).filter((t) => t.kind === tk && t.gone_at && t.sig).map((t) => ({ uid: t.uid, at: t.gone_at, by: t.by, sig: t.sig }));
    return { rows, dead };
  }

  const inShare = (id, space, tk, uid, cur) => tk === 'page'
    ? cur.space === space || !!S.pageLinked?.(space, uid)
    : cur.space === space && (!cur.kind || ITEM_KINDS.includes(cur.kind));
  async function mergeRows(id, space, kind, sec) {
    let n = 0;
    const tk = kind === 'pages' ? 'page' : 'item';
    for (const d of sec?.dead || []) {
      if (!(await believe(id, kind, deadBody(id, kind, d), d.by, d.sig))) { refused++; continue; }
      if (tooNew(d.by, d.at)) continue;
      const t = S.trackedGet(id, d.uid);
      if (t?.gone_at && t.gone_at >= d.at) continue;
      const cur = tk === 'page' ? S.pageMeta(d.uid) : S.itemMeta(d.uid);
      // Only what is in this project here, as for an edit: never a bill or anything else of that uid (re-review H3).
      // A page filed in from another project stays there: a deletion in the share does not reach into another project.
      const here = cur && inShare(id, space, tk, d.uid, cur) && cur.space === space;
      if (here && cur.updated_at > d.at) continue;
      if (here) { if (tk === 'page') S.pageDelete(d.uid, d.at); else S.itemDelete(d.uid, d.at); n++; }
      S.trackUpsert(id, d.uid, { kind: tk, by: d.by, at: t?.at || d.at, gone_at: d.at, origin: t?.origin || null, sig: d.sig });
    }
    const meNow = lc(S.getSetting('sync', null)?.email);
    for (const r of sec?.rows || []) {
      if (kind === 'tasks' && !ITEM_KINDS.includes(r.kind)) continue;
      // A section of a page, shared on its own: read-only, so only the owner's copy is believed, and the owner keeps none.
      if (isSection(r.uid) && (lc(r.by) !== rosterOf(id).owner || meNow === rosterOf(id).owner)) { if (lc(r.by) !== rosterOf(id).owner) refused++; continue; }
      if (!(await believe(id, kind, await rowBody(id, kind, r), r.by, r.sig))) { refused++; continue; }
      if (tooNew(r.by, r.updated_at)) continue;
      const t = S.trackedGet(id, r.uid);
      if (t?.gone_at && t.gone_at >= r.updated_at) continue;
      const deadAt = tk === 'page' ? S.pageTomb(r.uid) : S.itemTomb(r.uid);
      if (deadAt && deadAt >= r.updated_at) continue;
      const cur = tk === 'page' ? S.pageMeta(r.uid) : S.itemMeta(r.uid);
      // Only a row that is in this project here: never one moved out of it, or anything else that happens to
      // carry that uid (a bill, another project's page). A page added from another project is in it (review H3).
      if (cur && !inShare(id, space, tk, r.uid, cur)) continue;
      if (!cur) {
        if (tk === 'page') S.pageInsert({ uid: r.uid, title: String(r.title || ''), body: String(r.body || ''), space, pinned: r.pinned ? 1 : 0, created_at: r.created_at, updated_at: r.updated_at });
        else S.itemInsert({ uid: r.uid, kind: r.kind, text: String(r.text || ''), space, due_at: r.due_at ?? null, created_at: r.created_at, done_at: r.done_at ?? null, updated_at: r.updated_at });
      } else if (cur.updated_at < r.updated_at) {
        // An edit leaves a page in the project it is in here: a page added from Personal stays in Personal.
        if (tk === 'page') S.pageUpdate(r.uid, { title: String(r.title || ''), body: String(r.body || ''), pinned: r.pinned ? 1 : 0, updated_at: r.updated_at });
        else S.itemUpdate(r.uid, { kind: r.kind, text: String(r.text || ''), space: cur.space, due_at: r.due_at ?? null, done_at: r.done_at ?? null, updated_at: r.updated_at });
      } else {
        if (cur.updated_at === r.updated_at && !t?.sig) S.trackUpsert(id, r.uid, { kind: tk, by: r.by, at: r.updated_at, gone_at: null, origin: t?.origin || r.by, sig: r.sig });
        continue;
      }
      S.trackUpsert(id, r.uid, { kind: tk, by: r.by, at: r.updated_at, gone_at: null, origin: t?.origin || r.by, sig: r.sig });
      n++;
    }
    return n;
  }

  async function believedMap(id, kind, sec) {
    const out = {};
    for (const [email, e] of Object.entries(sec || {})) {
      if (!e || !Array.isArray(e.list)) continue;
      if (!(await believe(id, kind, mapBody(id, kind, lc(email), e), lc(email), e.sig))) { refused++; continue; }
      if (tooNew(email, e.at)) continue;
      out[lc(email)] = e;
    }
    return out;
  }
  async function ownEntry(id, kind, list, signPriv, me, ci = null) {
    const h = await digest({ list, ci }), k = 'mine:' + kind;
    let e = S.kvGet(id, k);
    if (!e || e.h !== h) { const at = Date.now(); e = { h, list, ci, at, sig: await C.sign(signPriv, mapBody(id, kind, me, { list, at, ci })) }; S.kvSet(id, k, e); }
    return { list: e.list, at: e.at, ...(e.ci ? { ci: e.ci } : {}), sig: e.sig };
  }
  async function mergeAbout(id, space, a) {
    if (!a?.profile || !(await believe(id, 'about', aboutBody(id, a), a.by, a.sig))) { if (a) refused++; return 0; }
    if (tooNew(a.by, a.at)) return 0;
    const known = S.kvGet(id, 'about');
    if (known && known.at >= a.at) return 0;
    // Only plain text fields and links, whatever the writer's computer sent (M2): the links the About form
    // keeps (lib/projects.js okUrl), web, mail and phone, and nothing else (never javascript:).
    const str = (v, n) => typeof v === 'string' ? v.slice(0, n) : '';
    const okLink = (u) => {
      const s = str(u, 2000).trim();
      if (!s) return '';
      if (/^(mailto:|tel:)/i.test(s)) return s;
      try { const x = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : 'https://' + s); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : ''; } catch { return ''; }
    };
    // A person may hold several addresses and numbers (emails, phones); each kept as short text, ten at most.
    const strs = (list, n) => (Array.isArray(list) ? list : []).map((v) => str(v, n)).filter(Boolean).slice(0, 10);
    const people = (Array.isArray(a.profile.people) ? a.profile.people : []).slice(0, 50).map((x) => ({ name: str(x?.name, 120), role: str(x?.role, 120), email: str(x?.email, 200), phone: str(x?.phone, 60), emails: strs(x?.emails, 200), phones: strs(x?.phones, 60) }))
      .filter((x) => x.name || x.email || x.phone || x.emails.length || x.phones.length);
    const links = (Array.isArray(a.profile.links) ? a.profile.links : []).slice(0, 50).map((x) => ({ label: str(x?.label, 120), url: okLink(x?.url) })).filter((x) => x.url);
    const p = { about: str(a.profile.about, 4000), people, links };
    const all = profiles();
    S.setSetting('profiles', { ...all, [space]: { ...(all[space] || {}), ...p } });
    S.kvSet(id, 'about', { hash: await digest(aboutOf(space)), at: a.at, by: a.by, sig: a.sig });
    return 1;
  }
  async function aboutSection(id, space, me, signPriv) {
    const p = aboutOf(space), h = await digest(p);
    let known = S.kvGet(id, 'about');
    if (!known || known.hash !== h || !known.sig) {
      const at = Date.now();
      known = { hash: h, at, by: me, sig: await C.sign(signPriv, aboutBody(id, { profile: p, at, by: me })) };
      S.kvSet(id, 'about', known);
    }
    return { profile: p, at: known.at, by: known.by, sig: known.sig };
  }
  const openSec = async (doc, kind, kk) => { try { return doc?.sec?.[kind] && kk ? await C.unseal(doc.sec[kind], kk) : null; } catch { return null; } };

  async function mergeDoc(id, space, doc, kk) {
    let n = 0;
    for (const kind of ['pages', 'tasks']) { const s = await openSec(doc, kind, kk?.[kind]); if (s) n += await mergeRows(id, space, kind, s); }
    const o = { repos: await believedMap(id, 'repos', await openSec(doc, 'repos', kk?.repos)), activity: await believedMap(id, 'activity', await openSec(doc, 'activity', kk?.activity)) };
    for (const kind of PUBLISHED) o[kind] = await believedMap(id, kind, await openSec(doc, kind, kk?.[kind]));
    for (const [k, v] of Object.entries(o.activity)) o.activity[k] = { ...v, list: cleanActivity(v.list) };
    others.set(id, o);
    const a = await openSec(doc, 'about', kk?.about);
    if (a) n += await mergeAbout(id, space, a);
    return n;
  }
  // The kinds you may edit rebuilt from your copy (and signed where you changed
  // something); the kinds you may only see, or not open at all, passed on as they came.
  async function buildDoc(id, space, meta, me, signPriv, kk, prev, members, now = Date.now()) {
    const sec = {};
    for (const kind of SHARE_KINDS) {
      const lvl = levelOf(id, me, kind), key = kk?.[kind];
      if (kind === 'sessions') continue;   // live, through the relay: never in the box
      if (lvl !== 'edit' || !key) { if (prev?.sec?.[kind]) sec[kind] = prev.sec[kind]; continue; }
      let body;
      if (PUBLISHED.includes(kind)) {
        // What this computer has of the project (the owner's, usually); a computer with nothing passes the others' on.
        const was = others.get(id)?.[kind] || {};
        const keep = Object.fromEntries(Object.entries(was).filter(([e]) => e !== me && (!members || members.includes(e))));
        const src = sources[kind];
        const own = src ? await ownEntry(id, kind, cleanPublished(kind, src(space)), signPriv, me) : was[me];
        sec[kind] = await C.seal({ ...keep, ...(own ? { [me]: own } : {}) }, key);
        continue;
      }
      if (kind === 'pages' || kind === 'tasks') body = await rowsSection(id, space, kind, me, signPriv, now);
      else if (kind === 'about') body = await aboutSection(id, space, me, signPriv);
      else {
        const was = others.get(id)?.[kind] || {};
        const keep = Object.fromEntries(Object.entries(was).filter(([e]) => e !== me && (!members || members.includes(e))));
        const list = kind === 'repos' ? [...new Set((repoSource(space) || []).filter(okRepo))].slice(0, 40) : cleanActivity(activitySource(space));
        // A Switchboard with nothing of its own to say (the web board) passes its earlier entry on.
        const own = publishes || !was[me] ? await ownEntry(id, kind, list, signPriv, me, kind === 'repos' ? cleanCi(ciSource(space, list)) : null) : was[me];
        body = { ...keep, [me]: own };
      }
      sec[kind] = await C.seal(body, key);
    }
    return { v: 3, meta, sec };
  }

  // ---- before the team: one document of everything, one key, one switch per kind for everyone.
  function mergeLegacy(id, space, doc) {
    let n = 0;
    for (const p of doc?.pages || []) {
      const cur = S.pageMeta(p.uid);
      if (cur && !inShare(id, space, 'page', p.uid, cur)) continue;
      if (!cur) { S.pageInsert({ uid: p.uid, title: String(p.title || ''), body: String(p.body || ''), space, pinned: p.pinned ? 1 : 0, created_at: p.created_at, updated_at: p.updated_at }); n++; }
      else if (cur.updated_at < p.updated_at) { S.pageUpdate(p.uid, { title: String(p.title || ''), body: String(p.body || ''), pinned: p.pinned ? 1 : 0, updated_at: p.updated_at }); n++; }
    }
    for (const i of doc?.items || []) {
      if (!ITEM_KINDS.includes(i.kind)) continue;
      const cur = S.itemMeta(i.uid);
      if (cur && !inShare(id, space, 'item', i.uid, cur)) continue;
      if (!cur) { S.itemInsert({ uid: i.uid, kind: i.kind, text: String(i.text || ''), space, due_at: i.due_at ?? null, created_at: i.created_at, done_at: i.done_at ?? null, updated_at: i.updated_at }); n++; }
      else if (cur.updated_at < i.updated_at) { S.itemUpdate(i.uid, { kind: i.kind, text: String(i.text || ''), space: cur.space, due_at: i.due_at ?? null, done_at: i.done_at ?? null, updated_at: i.updated_at }); n++; }
    }
    return n;
  }

  // ---- what the page shows
  let list = [];
  const keys = new Map();
  const metas = new Map();
  let state = { at: 0, ok: null, error: null };
  const nameIn = (id, email) => metas.get(id)?.names?.[lc(email)] || S.getSetting('teamNames', {})[lc(email)] || String(email || '').split('@')[0].replace(/^\w/, (c) => c.toUpperCase());

  // Check codes, for Team: yours, everyone this account shares with, and anyone whose keys changed.
  function keysState(me) {
    const people = Object.entries(peerKeys()).filter(([e, k]) => e !== me && k.code).map(([email, k]) => ({ email, name: nameIn(null, email), code: k.code, checked: !!k.checked }));
    const changed = Object.entries(keyChanges()).map(([email, c]) => ({ email, name: nameIn(null, email), code: c.code || null, was: peerKeys()[email]?.code || null, at: c.at }));
    return { mine: mine?.code || null, people: people.sort((a, b) => a.name.localeCompare(b.name)), changed };
  }
  function shareState() {
    const s = S.getSetting('sync', null), me = lc(s?.email);
    const projects = {};
    for (const x of list) {
      const space = spaceOfShare(x.id);
      if (!space || x.status !== 'joined') continue;
      const mineK = kindsOf(x.id, me), o = others.get(x.id) || {};
      const activity = mineK.activity === 'none' ? [] : Object.entries(o.activity || {}).filter(([e]) => e !== me)
        .flatMap(([e, v]) => cleanActivity(v.list).map((a) => ({ ...a, who: nameIn(x.id, e), email: e }))).sort((a, b) => b.at - a.at).slice(0, 12);
      const ci = mineK.repos === 'none' ? [] : Object.values(o.repos || {}).map((v) => v.ci).filter(Boolean);
      projects[space] = {
        id: x.id, role: roleOf(x.id, me), canManage: canManage(x.id, me), rosterOk: rosterOf(x.id).ok, waiting: !!keys.get(x.id)?.legacy && !canManage(x.id, me),
        owner: rosterOf(x.id).owner, ownerName: rosterOf(x.id).owner ? nameIn(x.id, rosterOf(x.id).owner) : null, kinds: mineK, activity,
        repos: mineK.repos === 'none' ? [] : [...new Set(Object.values(o.repos || {}).flatMap((v) => v.list || []).filter(okRepo))],
        runs: ci.flatMap((c) => c.runs || []).filter((r) => okRepo(r.fullName)), prs: ci.flatMap((c) => c.prs || []).filter((p) => okRepo(p.repo)),
        // Published kinds, each from whoever has it, as you may see them.
        published: Object.fromEntries(PUBLISHED.filter((k) => mineK[k] !== 'none').map((k) => [k, Object.values(o[k] || {}).flatMap((v) => cleanPublished(k, v.list))])),
        members: x.members.filter((m) => m.email !== me).map((m) => ({ email: m.email, name: nameIn(x.id, m.email), status: m.status, role: roleOf(x.id, m.email), kinds: kindsOf(x.id, m.email) }))
      };
    }
    const invites = list.filter((x) => x.status === 'invited' && !joining()[x.id]).map((x) => {
      const from = rosterOf(x.id).owner || x.members.find((m) => m.role === 'owner')?.email || '';
      return { id: x.id, from, fromName: nameIn(x.id, from), name: metas.get(x.id)?.name || 'A project', color: metas.get(x.id)?.color || null, kinds: kindsOf(x.id, me) };
    });
    for (const p of pendingMine) invites.push({ id: p.id, pending: true, from: p.inviter, fromName: nameIn(p.share, p.inviter), name: 'a shared project', kinds: p.kinds });
    const ids = new Set(list.filter((x) => x.status === 'joined' && spaceOfShare(x.id)).map((x) => x.id));
    const waiting = Object.entries(joining()).filter(([id]) => !ids.has(id)).map(([id, j]) => ({ id, inviter: j.inviter, inviterName: j.inviter ? nameIn(id, j.inviter) : 'the person who invited you', project: j.project || 'The project', ...(j.asked ? { asked: true } : {}) }));
    return { ready: !!(s?.token && s?.key), signedIn: !!s?.token, me, invites, joining: waiting, joinError, projects, team: teamOf(me), keys: keysState(me), refused, clockAhead: [...ahead].filter(([, v]) => Date.now() - v.seen < 3600e3 && v.at > Date.now() + SKEW).map(([email, v]) => ({ email, name: nameIn(null, email), aheadBy: v.at - Date.now() })), ok: state.ok, error: state.error, at: state.at };
  }
  function teamOf(me) {
    const people = new Map();
    for (const x of list) {
      const space = spaceOfShare(x.id);
      if (!space || !canManage(x.id, me)) continue;
      for (const m of x.members) {
        if (m.email === me || roleOf(x.id, m.email) === 'owner') continue;
        const p = people.get(m.email) || { email: m.email, name: nameIn(x.id, m.email), role: 'member', projects: [] };
        if (roleOf(x.id, m.email) === 'admin') p.role = 'admin';
        p.projects.push({ space, status: m.status, kinds: kindsOf(x.id, m.email), mine: roleOf(x.id, me) === 'owner' });
        people.set(m.email, p);
      }
    }
    const typed = S.getSetting('pendingEmails', {});
    for (const [sid, ps] of pendingOf) {
      const space = spaceOfShare(sid);
      if (!space) continue;
      for (const p of ps) {
        const email = typed[p.id] || p.acceptedBy || 'someone invited by email';
        const person = people.get(email) || { email, name: nameIn(sid, email), role: 'member', projects: [] };
        person.projects.push({ space, status: p.asked ? 'asks to join' : p.status === 'accepted' ? 'joining' : 'invited by email', ...(p.asked ? { asked: true, askedBy: p.acceptedBy } : {}), kinds: cleanKinds(p.kinds), pending: p.id, expires: p.expires });
        people.set(email, person);
      }
    }
    return [...people.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  function changedBy() {
    const me = lc(S.getSetting('sync', null)?.email), out = {};
    for (const r of S.trackedAll()) if (!r.gone_at && r.by && lc(r.by) !== me) out[r.uid] = nameIn(r.share_id, r.by);
    return out;
  }
  function sharedBy() {
    const me = lc(S.getSetting('sync', null)?.email), out = {};
    for (const r of S.trackedAll()) if (!r.gone_at && r.origin && lc(r.origin) !== me) out[r.uid] = nameIn(r.share_id, r.origin);
    return out;
  }
  // Moving a page to another project sends it as gone to everyone in the one it leaves, so a page someone
  // else shared is never moved: the app (lib/sorting.js moveOwnCopy) and the web board (public/js/web/adapter.js)
  // both make a copy of your own in the project picked instead, and theirs stays (review H4).
  // Who shared it, when this move must be a copy; null when it is an ordinary move.
  const moveIsCopy = (uid, from, to) => (!to || to === from) ? null : sharedBy()[uid] || null;
  function sharedRepos() {
    const out = [];
    for (const [space, p] of Object.entries(shareState().projects)) for (const r of p.repos) out.push({ fullName: r, space });
    return out;
  }

  async function keyOf(x) {
    const k = keys.get(x.id);
    if (k && k.epoch === x.epoch) return k;
    const b = await openLock(x.lock);
    const v = { epoch: x.epoch, k: b.k, kinds: b.kinds, legacy: b.legacy };
    keys.set(x.id, v);
    return v;
  }
  async function refreshList() {
    const r = await req('/v1/shares');
    if (r.status !== 200) throw new Error(r.json.error || 'Could not reach the sync service.');
    list = r.json.shares || [];
    for (const x of list) rosters.set(x.id, await readRoster(x));
    return list;
  }
  const metaFor = (space, names = {}) => { const sp = S.spaces().find((s) => s.id === space) || {}; return { name: sp.name || 'Shared project', color: sp.color || null, names }; };

  async function syncOne(x, me) {
    const space = spaceOfShare(x.id);
    if (!space || x.status !== 'joined') return 0;
    let merged = 0;
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = await req(`/v1/shares/${x.id}/doc`);
      if (r.status !== 200) throw new Error(r.json.error || 'Could not get the shared project.');
      if (r.json.epoch !== x.epoch) { await refreshList(); x = list.find((y) => y.id === x.id); if (!x) return merged; continue; }
      const k = await keyOf(x);
      let outer = r.json.body ? await C.unseal(r.json.body, k.k) : null;
      // Shared before the team: the owner's (or an admin's) computer moves it over; the others wait for that.
      // Only a project this computer knows only in the old shape (its lock holds a bare key) is one: every
      // member has the project key, so a document's own shape proves nothing (docs/REVIEW-2026-11-05.md H1).
      if (k.legacy && !v3Seen(x.id)) {
        if (!canManage(x.id, me)) return merged;
        if (outer && outer.v !== 3) merged += mergeLegacy(x.id, space, outer);
        await migrate(x, me, outer);
        return merged;
      }
      if (k.legacy || (outer && outer.v !== 3)) {
        // An old-shape document (or lock) in a project already moved over: refused. Whoever runs it puts a proper one back.
        refused++;
        if (k.legacy || !canManage(x.id, me)) return merged;
        outer = null;
      }
      if (outer) markV3(x.id);
      if (outer?.meta?.policy) await adoptPolicy(x.id, outer.meta.policy);
      if (outer) merged += await mergeDoc(x.id, space, outer, k.kinds);
      const names = { ...(outer?.meta?.names || {}), ...(metas.get(x.id)?.names || {}) };
      const policy = policyOf(x.id);
      const meta = canManage(x.id, me) ? metaFor(space, names) : { ...metaFor(space), ...(outer?.meta || {}), names };
      meta.policy = policy.sig ? policy : outer?.meta?.policy || null;
      metas.set(x.id, meta);
      const doc = await buildDoc(x.id, space, meta, me, (await myKey()).signPriv, k.kinds, outer, x.members.map((m) => m.email));
      const view = async (d) => digest({ m: d.meta, s: await Promise.all(SHARE_KINDS.map((kk) => openSec(d, kk, k.kinds?.[kk]))) });
      if (outer && await view(outer) === await view(doc)) return merged;
      const put = await req(`/v1/shares/${x.id}/doc`, { method: 'PUT', body: { body: await C.seal(doc, k.k), baseVersion: r.json.version, epoch: x.epoch } });
      if (put.status === 200) return merged;
      if (put.status !== 409) throw new Error(put.json.error || 'Could not save the shared project.');
      if (put.json.error === 'rekeyed') { await refreshList(); x = list.find((y) => y.id === x.id); if (!x) return merged; }
    }
    return merged;
  }

  async function rekey(x, me, { remove = null, grants = null } = {}) {
    const space = spaceOfShare(x.id);
    const cur = await req(`/v1/shares/${x.id}/doc`);
    let prev = null;
    const old = await keyOf(x);
    if (cur.json.body) {
      try {
        prev = await C.unseal(cur.json.body, old.k);
        if (prev.v === 3) { if (prev.meta?.policy) await adoptPolicy(x.id, prev.meta.policy); await mergeDoc(x.id, space, prev, old.kinds); }
        else if (old.legacy && !v3Seen(x.id)) mergeLegacy(x.id, space, prev);
      } catch {}
    }
    const stay = x.members.filter((m) => m.email !== remove);
    const g = { ...(grants || policyOf(x.id).grants) };
    for (const e of Object.keys(g)) if (!stay.some((m) => m.email === e)) delete g[e];
    const policy = await makePolicy(x.id, g, me);
    S.kvSet(x.id, 'policy', policy);
    const key = await C.randomHex(32);
    const kinds = {};
    for (const k of SHARE_KINDS) kinds[k] = await C.randomHex(32);
    const locks = {};
    for (const m of stay) {
      const pub = m.email === me ? (await myKey()).pub : (await keysOf(m.email, signPubOf(x.id, m.email))).pub;
      const mk = Object.fromEntries(SHARE_KINDS.filter((k) => levelOf(x.id, m.email, k) !== 'none').map((k) => [k, kinds[k]]));
      locks[m.email] = await lockFor({ k: key, kinds: mk }, pub);
    }
    const names = { ...(metas.get(x.id)?.names || {}) };
    if (remove) delete names[remove];
    const meta = { ...metaFor(space, names), policy };
    const doc = await buildDoc(x.id, space, meta, me, (await myKey()).signPriv, kinds, null, stay.map((m) => m.email));
    const r = await req(`/v1/shares/${x.id}/rekey`, { method: 'POST', body: { epoch: x.epoch + 1, locks, body: await C.seal(doc, key), baseVersion: cur.json.version, ...(remove ? { remove } : {}) } });
    if (r.status !== 200) throw new Error(r.json.error === 'conflict' || r.json.error === 'rekeyed' ? 'Someone saved at the same moment. Try again.' : (r.json.error || 'Could not change the key.'));
    keys.set(x.id, { epoch: r.json.epoch, k: key, kinds, legacy: false });
    metas.set(x.id, meta);
    markV3(x.id);
  }

  async function migrate(x, me, outer) {
    // The old switches, only as the owner signed them (0.2.6 signed its policy); otherwise each kind's default.
    const lp = outer?.meta?.policy, r0 = rosterOf(x.id);
    const signedOld = lp?.shares && lc(lp.by) === r0.owner && await checks({ share: x.id, shares: lp.shares, at: lp.at, by: lp.by }, lp.sig, r0.ownerSign);
    const old = signedOld ? lp.shares : {};
    const grants = {};
    for (const m of x.members) {
      if (m.email === me || roleOf(x.id, m.email) === 'owner') continue;
      let signPub;
      try { signPub = (await keysOf(m.email)).signPub; } catch { continue; }
      grants[m.email] = { signPub, kinds: Object.fromEntries(SHARE_KINDS.map((k) => [k, old[k] === undefined ? DEFAULT_KINDS[k] : old[k] ? 'edit' : 'none'])) };
    }
    S.trackResign(x.id, me);
    if (outer?.meta?.names) metas.set(x.id, { ...(metas.get(x.id) || {}), names: outer.meta.names });
    await rekey(x, me, { grants });
  }

  let busy = null, boardAsked = 0;
  async function syncShares() {
    const s = S.getSetting('sync', null);
    if (!s?.token || !s.key) return 0;
    if (busy) return busy;
    if (Date.now() - boardAsked > 3600e3) { boardAsked = Date.now(); askProviders().catch(() => {}); }
    busy = (async () => {
      let merged = 0;
      try {
        const me = lc(s.email);
        await myKey();
        await refreshList();
        const ids = new Set(list.map((x) => x.id));
        for (const id of Object.keys(shareMap())) if (!ids.has(id)) unmapShare(id);
        await pendingRound(me);
        for (const x of list) {
          if (x.status === 'invited') {
            if (!metas.has(x.id)) {
              const r = await req(`/v1/shares/${x.id}/doc`);
              try { const k = await keyOf(x); if (r.json.body) { const d = await C.unseal(r.json.body, k.k); metas.set(x.id, d.meta || {}); if (d.meta?.policy) await adoptPolicy(x.id, d.meta.policy); } } catch {}
            }
            const r = rosterOf(x.id), t = trustedTeams()[r.owner];
            if (r.ok && ((t && t === r.ownerSign) || joining()[x.id])) {
              try { await joinShare(x.id); S.setSetting('trustedTeams', { ...trustedTeams(), [r.owner]: r.ownerSign }); } catch {}
            }
            continue;
          }
          if (x.status === 'joined' && roleOf(x.id, me) !== 'owner' && !spaceOfShare(x.id)) { try { await makeLocal(x); } catch (e) { if (!e.lockStale) throw e; } }
          if (x.status === 'joined' && joining()[x.id]) { const j = { ...joining() }; delete j[x.id]; S.setSetting('acceptedInvites', j); }
          if (x.needsRekey && canManage(x.id, me) && spaceOfShare(x.id)) { try { await rekey(x, me); } catch {} }
        }
        if (await relockAfterReset(me).catch(() => false) || list.some((x) => x.needsRekey || x.status === 'invited')) await refreshList();
        // A project still locked to keys from before your password reset is skipped until it is locked again.
        for (const x of list) { try { merged += await syncOne(x, me); } catch (e) { if (!e.lockStale) throw e; } }
        await completeKeys(me);
        await serveLive();
        if (merged) S.onLocalChange();
        state = { at: Date.now(), ok: true, error: null };
      } catch (e) {
        state = { at: Date.now(), ok: false, error: friendlyError(e, 'the sync service') };
      } finally { busy = null; }
      return merged;
    })();
    return busy;
  }

  async function makeLocal(x) {
    let meta = metas.get(x.id);
    if (!meta) {
      const r = await req(`/v1/shares/${x.id}/doc`);
      meta = r.json.body ? (await C.unseal(r.json.body, (await keyOf(x)).k)).meta || {} : {};
      metas.set(x.id, meta);
    }
    const id = 'sh-' + x.id.slice(0, 10);
    const all = S.spaces();
    if (!all.some((s) => s.id === id)) S.saveSpaces([...all, { id, name: meta.name || 'Shared project', color: /^#[0-9a-f]{6}$/i.test(meta.color || '') ? meta.color : '#8A8F98', group: 'Shared' }]);
    mapShare(x.id, id);
    return id;
  }

  // ---- invites by email
  function keepInviteLink(token, project = '') {
    if (!/^[0-9a-f]{64}$/.test(String(token))) throw new Error('That invitation link is not complete. Copy the whole link from the email.');
    S.setSetting('inviteTokens', { ...S.getSetting('inviteTokens', {}), [token]: { project: String(project).slice(0, 80), at: Date.now() } });
    joinError = null;
  }
  async function pendingRound(me) {
    const tokens = S.getSetting('inviteTokens', {});
    for (const [t, v] of Object.entries(tokens)) {
      const r = await req('/v1/share-invites/redeem', { method: 'POST', body: { token: t } }).catch(() => null);
      if (!r) continue;
      if (r.status === 200) { S.setSetting('acceptedInvites', { ...joining(), [r.json.share]: { at: Date.now(), inviter: lc(r.json.inviter || '') || null, project: v.project } }); joinError = null; }
      else joinError = r.json.error || 'That invitation link did not work.';
      const left = { ...S.getSetting('inviteTokens', {}) }; delete left[t]; S.setSetting('inviteTokens', left);
    }
    const r = await req('/v1/share-invites').catch(() => null);
    pendingMine = (r?.json?.invites || []).filter((p) => p.status === 'waiting').map((p) => { let g = {}; try { g = JSON.parse(p.grant); } catch {} return { id: p.id, share: p.share, inviter: lc(p.inviter), kinds: cleanKinds(g.kinds) }; });
    pendingOf.clear();
    for (const x of list) {
      if (!spaceOfShare(x.id) || !canManage(x.id, me)) continue;
      const q = await req(`/v1/shares/${x.id}/pending`).catch(() => null);
      const rows = [];
      for (const p of q?.json?.pending || []) {
        let g = null; try { g = JSON.parse(p.grant); } catch {}
        if (!g || g.share !== x.id || !['owner', 'admin'].includes(roleOf(x.id, g.by)) || !(await checks(pendingBody(g), p.sig, signPubOf(x.id, g.by)))) continue;
        if (p.status === 'accepted' && p.acceptedBy && await emailHashOf(p.acceptedBy) === g.emailHash) {
          try {
            if (!x.members.some((m) => m.email === lc(p.acceptedBy))) await addMember(x, me, lc(p.acceptedBy), cleanKinds(g.kinds));
            await req(`/v1/shares/${x.id}/pending/${p.id}/cancel`, { method: 'POST', body: {} });
            continue;
          } catch {}
        }
        // 'asked': taken without the link, so only by an account with that address, which proves nothing; the owner decides (admitInvite).
        rows.push({ id: p.id, status: p.status, acceptedBy: p.acceptedBy, expires: p.expires, kinds: g.kinds, ...(p.status === 'asked' && p.acceptedBy && await emailHashOf(p.acceptedBy) === g.emailHash ? { asked: true } : {}) });
      }
      pendingOf.set(x.id, rows);
    }
  }
  async function answerInvite(pid, yes) {
    const p = pendingMine.find((x) => x.id === pid);
    const r = await req(`/v1/share-invites/${pid}/${yes ? 'accept' : 'decline'}`, { method: 'POST', body: {} });
    if (r.status !== 200) throw new Error(r.json.error || 'Could not answer that invitation.');
    if (yes && p) S.setSetting('acceptedInvites', { ...joining(), [p.share]: { at: Date.now(), inviter: p.inviter, project: '', asked: true } });
    pendingMine = pendingMine.filter((x) => x.id !== pid);
    await syncShares();
    return { joining: yes };
  }
  // Let in someone who answered an invitation without its link (on Now), once you have checked it is them.
  async function admitInvite(space, pid) {
    const me = lc(account().email), x = await findShare(space);
    if (!x) throw new Error('This project is not shared.');
    if (!canManage(x.id, me)) throw new Error('Only the person who shared this project, or an admin, can let people in.');
    const q = await req(`/v1/shares/${x.id}/pending`);
    const p = (q.json?.pending || []).find((y) => y.id === pid);
    let g = null; try { g = JSON.parse(p?.grant); } catch {}
    if (!p || p.status !== 'asked' || !p.acceptedBy || !g || g.share !== x.id) throw new Error('That invitation is gone, or they have not answered it yet.');
    if (!['owner', 'admin'].includes(roleOf(x.id, g.by)) || !(await checks(pendingBody(g), p.sig, signPubOf(x.id, g.by))) || await emailHashOf(p.acceptedBy) !== g.emailHash) throw new Error('That invitation is not one this project made. Invite them again.');
    if (!x.members.some((m) => m.email === lc(p.acceptedBy))) await addMember(x, me, lc(p.acceptedBy), cleanKinds(g.kinds));
    await req(`/v1/shares/${x.id}/pending/${p.id}/cancel`, { method: 'POST', body: {} });
    pendingOf.set(x.id, (pendingOf.get(x.id) || []).filter((y) => y.id !== pid));
    await syncShares();
    return { email: lc(p.acceptedBy) };
  }
  async function cancelInvite(space, pid) {
    const x = await findShare(space);
    if (!x) throw new Error('This project is not shared.');
    const r = await req(`/v1/shares/${x.id}/pending/${pid}/cancel`, { method: 'POST', body: {} });
    if (r.status !== 200) throw new Error(r.json.error || 'Could not cancel that invitation.');
    pendingOf.set(x.id, (pendingOf.get(x.id) || []).filter((p) => p.id !== pid));
  }

  // ---- what the buttons do
  async function findShare(space) {
    const id = shareOfSpace(space);
    if (!id) return null;
    await refreshList();
    const x = list.find((y) => y.id === id);
    if (!x) { unmapShare(id); return null; }
    return x;
  }

  async function shareProject(space, email, name = '', { kinds, existing = 'share' } = {}) {
    const s = account(), me = lc(s.email);
    const who = lc(email);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(who)) throw new Error('Type the email address of their Switchboard account.');
    if (who === me) throw new Error('That is your own account. Type the other person\'s.');
    if (!S.spaces().some((x) => x.id === space)) throw new Error('That project is gone.');
    let them = null;
    try { them = await keysOf(who); } catch (e) { if (!/No Switchboard account|has not been updated/.test(e.message)) throw e; }
    const k = await myKey();
    if (name.trim()) S.setSetting('teamNames', { ...S.getSetting('teamNames', {}), [who]: name.trim().slice(0, 60) });
    let x = await findShare(space), id = x?.id || null;
    if (x && !canManage(id, me)) throw new Error('Only the person who shared this project, or an admin, can add people to it.');
    if (x?.members.some((m) => m.email === who && m.status === 'joined')) throw new Error('They are in this project already. Change what they can do in Settings, Team.');
    const names = { ...(id ? metas.get(id)?.names || {} : {}), ...(name.trim() ? { [who]: name.trim().slice(0, 60) } : {}) };
    if (!x) {
      if (existing === 'private') S.makePagesPrivate(space);
      const key = await C.randomHex(32);
      const kk = {};
      for (const k2 of SHARE_KINDS) kk[k2] = await C.randomHex(32);
      const r0 = await req('/v1/shares', { method: 'POST', body: { lock: await lockFor({ k: key, kinds: kk }, k.pub), body: await C.seal({ v: 3, meta: metaFor(space, names), sec: {} }, key), roster: '{}', rosterSig: 'x' } });
      if (r0.status !== 200) throw new Error(r0.json.error || 'Could not share the project.');
      id = r0.json.id;
      const roster = { share: id, owner: { email: me, signPub: k.signPub }, admins: {}, seq: 1, at: Date.now() };
      const rr = await req(`/v1/shares/${id}/roster`, { method: 'POST', body: { roster: JSON.stringify(roster), rosterSig: await signed(roster), admins: [] } });
      if (rr.status !== 200) throw new Error(rr.json.error || 'Could not share the project.');
      S.kvSet(id, 'ownerSign', k.signPub);
      markV3(id);
      mapShare(id, space);
      keys.set(id, { epoch: 1, k: key, kinds: kk, legacy: false });
      metas.set(id, metaFor(space, names));
      await refreshList();
      x = list.find((y) => y.id === id);
      S.kvSet(id, 'policy', await makePolicy(id, {}, me));
      await syncOne(x, me);
    } else if (name.trim()) metas.set(id, { ...(metas.get(id) || metaFor(space)), names });
    const project = S.spaces().find((s2) => s2.id === space)?.name || '';
    const token = await C.randomHex(32);
    const g = { share: id, emailHash: await emailHashOf(who), kinds: cleanKinds(kinds), at: Date.now(), by: me };
    const r = await req(`/v1/shares/${id}/pending`, { method: 'POST', body: { emailHash: g.emailHash, tokenHash: await tokenHash(token), grant: JSON.stringify(g), sig: await signed(pendingBody(g)) } });
    if (r.status !== 200) throw new Error(r.json.error || 'Could not save the invitation.');
    S.setSetting('pendingEmails', { ...S.getSetting('pendingEmails', {}), [r.json.id]: who });
    if (them) await addMember(x, me, who, cleanKinds(kinds), them);
    await syncShares();
    return { id, pending: r.json.id, account: !!them, link: inviteLink(who, token, project), project };
  }
  async function addMember(x, me, who, kinds, them = null) {
    them = them || await keysOf(who);
    S.kvSet(x.id, 'policy', await makePolicy(x.id, { ...policyOf(x.id).grants, [who]: { signPub: them.signPub, pub: them.pub, kinds } }, me));
    await syncOne(x, me);
    x = list.find((y) => y.id === x.id) || x;
    const kx = await keyOf(x);
    const mk = Object.fromEntries(SHARE_KINDS.filter((k2) => kinds[k2] !== 'none').map((k2) => [k2, kx.kinds[k2]]));
    const inv = await req(`/v1/shares/${x.id}/invite`, { method: 'POST', body: { email: who, lock: await lockFor({ k: kx.k, kinds: mk }, them.pub), epoch: x.epoch } });
    if (inv.status !== 200) throw new Error(inv.json.error === 'rekeyed' ? 'The project\'s key just changed. Try again.' : (inv.json.error || 'Could not invite them.'));
  }
  async function setAccess(space, email, kinds) {
    const me = lc(account().email), x = await findShare(space), who = lc(email);
    if (!x) throw new Error('This project is not shared.');
    if (!canManage(x.id, me)) throw new Error('Only the person who shared this project, or an admin, can change what someone can do.');
    const g = policyOf(x.id).grants[who];
    if (!g) throw new Error('They are not in this project.');
    const next = cleanKinds({ ...g.kinds, ...kinds });
    const readersChange = SHARE_KINDS.some((k) => (g.kinds[k] === 'none') !== (next[k] === 'none'));
    const grants = { ...policyOf(x.id).grants, [who]: { ...g, kinds: next } };
    if (readersChange) await rekey(x, me, { grants });
    else S.kvSet(x.id, 'policy', await makePolicy(x.id, grants, me));
    await syncShares();
    return next;
  }
  async function setRole(email, role, spacesList = null) {
    const me = lc(account().email), who = lc(email);
    await refreshList();
    const mineX = list.filter((x) => spaceOfShare(x.id) && roleOf(x.id, me) === 'owner' && x.members.some((m) => m.email === who) && (!spacesList || spacesList.includes(spaceOfShare(x.id))));
    if (!mineX.length) throw new Error('They are not in any project you shared.');
    const signPub = role === 'admin' ? (await keysOf(who)).signPub : null;
    for (const x of mineX) {
      const admins = { ...rosterOf(x.id).admins };
      if (role === 'admin') admins[who] = signPub; else delete admins[who];
      await postRoster(x, me, admins);
    }
    await syncShares();
  }
  async function postRoster(x, me, admins) {
    const k = await myKey(), r = rosterOf(x.id);
    const roster = { share: x.id, owner: { email: me, signPub: k.signPub }, admins, seq: (r.seq || S.kvGet(x.id, 'rosterSeq') || 1) + 1, at: Date.now() };
    const res = await req(`/v1/shares/${x.id}/roster`, { method: 'POST', body: { roster: JSON.stringify(roster), rosterSig: await signed(roster), admins: Object.keys(admins) } });
    if (res.status !== 200) throw new Error(res.json.error || 'Could not change their role.');
    rosters.set(x.id, { ok: true, owner: me, ownerSign: k.signPub, admins, seq: roster.seq });
    S.kvSet(x.id, 'rosterSeq', roster.seq);
  }
  async function joinShare(id) {
    const r = await req(`/v1/shares/${id}/accept`, { method: 'POST', body: {} });
    if (r.status !== 200) throw new Error(r.json.error || 'Could not join the project.');
    await refreshList();
    const x = list.find((y) => y.id === id);
    if (x) await makeLocal(x);
    return x;
  }
  async function acceptShare(id) {
    const x = await joinShare(id);
    const r = x && rosterOf(x.id);
    if (r?.ok && r.owner) S.setSetting('trustedTeams', { ...trustedTeams(), [r.owner]: r.ownerSign });
    await syncShares();
    return { space: spaceOfShare(id) };
  }
  async function leaveShare(id) {
    const r = await req(`/v1/shares/${id}/leave`, { method: 'POST', body: {} });
    if (r.status !== 200) throw new Error(r.json.error || 'Could not leave the project.');
    unmapShare(id); list = list.filter((x) => x.id !== id); metas.delete(id); keys.delete(id); others.delete(id);
  }
  async function leaveSpace(space) {
    const id = shareOfSpace(space);
    if (!id) throw new Error('This project is not shared.');
    return leaveShare(id);
  }
  async function removeMember(space, email) {
    const me = lc(account().email), x = await findShare(space);
    if (!x) throw new Error('This project is not shared.');
    if (!canManage(x.id, me)) throw new Error('Only the person who shared this project, or an admin, can remove people.');
    const who = lc(email), m = x.members.find((y) => y.email === who);
    if (!m) throw new Error('They are not in this project.');
    if (roleOf(x.id, who) === 'owner') throw new Error('The person who shared this project cannot be removed from it.');
    if (roleOf(x.id, who) === 'admin' && roleOf(x.id, me) !== 'owner') throw new Error('Only the person who shared this project can remove an admin.');
    await rekey(x, me, { remove: who });
    if (rosterOf(x.id).admins[who]) { const a = { ...rosterOf(x.id).admins }; delete a[who]; await postRoster(x, me, a); }
    await syncShares();
  }
  // A one-time code to give someone in a project you own or run, who forgot their password (sync-worker/src/reset.js).
  // The reset keeps them in your projects; relockAfterReset gives them the keys again once they have set the new password.
  async function resetCodeFor(email) {
    const r = await req('/v1/reset/issue', { method: 'POST', body: { email: lc(email) } });
    if (r.status !== 200) throw new Error(r.json.error || 'Could not make a reset code.');
    S.setSetting('resetIssued', { ...resetsIssued(), [lc(email)]: Date.now() });
    return r.json.code;
  }
  // Someone you made a reset code for gets new keys when they set their new password. You started it, so
  // this computer takes the new keys without comparing check codes, and locks every project of yours they
  // are in to them again, with the same access as before. Kept for a week, then forgotten.
  const resetsIssued = () => S.getSetting('resetIssued', {}) || {};
  async function relockAfterReset(me) {
    let did = false;
    for (const [e, at] of Object.entries(resetsIssued())) {
      const drop = () => { const rest = { ...resetsIssued() }; delete rest[e]; S.setSetting('resetIssued', rest); };
      if (Date.now() - at > 7 * 86400e3) { drop(); continue; }
      let got;
      try { got = await lookup(e); } catch { continue; }
      const cur = peerKeys()[e] || {};
      if (!got.pub || !got.signPub || (got.pub === cur.pub && got.signPub === cur.signPub)) continue;   // not reset yet
      S.setSetting('peerKeys', { ...peerKeys(), [e]: { pub: got.pub, signPub: got.signPub, code: await codeOf(got.pub, got.signPub), at: Date.now() } });
      const changes = { ...keyChanges() }; delete changes[e]; S.setSetting('keyChanged', changes);
      let left = false;
      for (const x of list.filter((y) => y.status === 'joined' && spaceOfShare(y.id) && canManage(y.id, me) && y.members.some((m) => lc(m.email) === e))) {
        try {
          const r = rosterOf(x.id);
          if (r.admins[e] && r.admins[e] !== got.signPub && roleOf(x.id, me) === 'owner') await postRoster(x, me, { ...r.admins, [e]: got.signPub });
          const g = { ...policyOf(x.id).grants };
          if (g[e]) g[e] = { ...g[e], signPub: got.signPub, pub: got.pub };
          await rekey(x, me, { grants: g });
          did = true;
        } catch { left = true; }
      }
      if (!left) drop();
    }
    return did;
  }
  async function removePerson(email) {
    const me = lc(account().email), who = lc(email);
    await refreshList();
    const spacesIn = list.filter((x) => spaceOfShare(x.id) && canManage(x.id, me) && x.members.some((m) => m.email === who)).map((x) => spaceOfShare(x.id));
    for (const sp of spacesIn) await removeMember(sp, who);
    return spacesIn.length;
  }
  async function stopSharing(space) {
    const id = shareOfSpace(space);
    if (!id) return;
    const r = await req(`/v1/shares/${id}/stop`, { method: 'POST', body: {} });
    if (r.status !== 200 && r.status !== 404) throw new Error(r.json.error || 'Could not stop sharing.');
    unmapShare(id); list = list.filter((x) => x.id !== id); metas.delete(id); keys.delete(id); others.delete(id);
  }
  // ---- live: a project's sessions, from the owner's computer while it is online (never in the box).
  // One relay room per shared project (sync-worker/src/shares.js "live"). A member's request is signed
  // with their key (the policy, signed by the owner, says which) and sealed to the owner's key; the
  // answer is sealed to the key the member signed for. The owner's computer answers only for sessions
  // in that project, and only with the Chat view (lib/share.js); a message to send waits for Approve.
  const lives = new Map();   // share id -> { ws, devices, waiters, opened }
  let liveHandler = null;    // the owner's side: async ({ share, space, email, name, level, req }) -> answer
  const LIVE_AGE = 120e3;
  async function liveOpen(id) {
    const cur = lives.get(id);
    if (cur && cur.ws && cur.ws.readyState <= 1) return cur.opened;
    if (!openSocket) throw new Error('Live sessions are not available here.');
    const s = account();
    const url = s.server.replace(/^http/, 'ws') + `/v1/shares/${id}/live?suffix=${await C.randomHex(5)}`;
    const L = { ws: openSocket(url, s.token), devices: [], waiters: new Map() };
    L.opened = new Promise((ok, no) => { L.ws.onopen = () => ok(L); L.ws.onerror = () => no(new Error('Could not reach the live link.')); setTimeout(() => no(new Error('The live link did not open.')), 8000)?.unref?.(); });
    L.opened.catch(() => {});
    L.ws.onmessage = (ev) => { let m; try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch { return; } if (m.type === 'presence') { L.devices = m.devices || []; return; } if (m.p && m.from) onLive(id, L, m).catch(() => {}); };
    L.ws.onclose = () => { if (lives.get(id) === L) lives.delete(id); for (const w of L.waiters.values()) w.no(new Error('The live link closed.')); };
    lives.set(id, L);
    return L.opened;
  }
  async function onLive(id, L, m) {
    const k = await myKey(), { pub2, box } = JSON.parse(m.p);
    let msg; try { msg = JSON.parse(await C.openFromPair(k.priv, k.pub, pub2, box)); } catch { return; }
    if (msg.res !== undefined || msg.err !== undefined) { const w = L.waiters.get(msg.n); if (w) { L.waiters.delete(msg.n); msg.err ? w.no(new Error(msg.err)) : w.ok(msg.res); } return; }
    // A request, on the owner's (or an admin's) computer.
    const b = msg.body, me = lc(S.getSetting('sync', null)?.email);
    if (!liveHandler || !b || b.share !== id || Math.abs(Date.now() - (b.at || 0)) > LIVE_AGE || !canManage(id, me)) return;
    const from = lc(b.from), dev = L.devices.find((d) => d.device === m.from);
    if (!dev || lc(dev.name) !== from) return;                                 // the service says who connected; it must agree
    if (!(await checks(b, msg.sig, signPubOf(id, from)))) return;            // and the person signed it with the key the owner signed for
    const level = levelOf(id, from, 'sessions');
    const reply = async (o) => L.ws.send(JSON.stringify({ to: m.from, p: JSON.stringify(await C.sealForPair(JSON.stringify({ n: b.n, ...o }), b.pub)) }));
    if (level === 'none') return reply({ err: 'Sessions are not shared with you in this project.' });
    if (b.req?.t === 'send' && level !== 'send' && level !== 'edit') return reply({ err: 'You can watch these sessions, but not send to them.' });
    try { await reply({ res: await liveHandler({ share: id, space: spaceOfShare(id), email: from, name: nameIn(id, from), level, req: b.req || {} }) }); }
    catch (e) { await reply({ err: friendlyError(e, 'the session') }); }
  }
  // A member asks the owner's computer: the list of sessions, one's Chat view, or a message to send.
  async function liveAsk(space, req) {
    const id = shareOfSpace(space);
    if (!id) throw new Error('This project is not shared.');
    const L = await liveOpen(id);
    const owner = rosterOf(id).owner, me = lc(S.getSetting('sync', null)?.email);
    if (!owner) throw new Error('The project\'s owner could not be checked.');
    await new Promise((ok) => setTimeout(ok, L.devices.length ? 0 : 400));
    const dev = L.devices.filter((d) => lc(d.name) === owner).sort((a, b) => b.since - a.since)[0];
    if (!dev) throw Object.assign(new Error(`${nameIn(id, owner)}'s computer is offline. Sessions show here while it is on.`), { offline: true });
    const k = await myKey(), n = await C.randomHex(8);
    const body = { share: id, from: me, pub: k.pub, n, at: Date.now(), req };
    const ownerPub = (await keysOf(owner, rosterOf(id).ownerSign)).pub;
    const p = JSON.stringify(await C.sealForPair(JSON.stringify({ body, sig: await signed(body) }), ownerPub));
    return new Promise((ok, no) => {
      L.waiters.set(n, { ok, no });
      setTimeout(() => { if (L.waiters.delete(n)) no(new Error(`${nameIn(id, owner)}'s computer did not answer. It may be busy or going to sleep.`)); }, 10000)?.unref?.();
      L.ws.send(JSON.stringify({ to: dev.device, p }));
    });
  }
  // The owner's side: stay in the rooms of the projects you run where someone may see sessions.
  async function serveLive() {
    if (!liveHandler || !openSocket) return;
    const me = lc(S.getSetting('sync', null)?.email);
    for (const x of list) {
      if (x.status !== 'joined' || !spaceOfShare(x.id) || !canManage(x.id, me)) continue;
      if (!x.members.some((m) => m.email !== me && levelOf(x.id, m.email, 'sessions') !== 'none')) continue;
      try { await liveOpen(x.id); } catch {}
    }
  }

  // Signed out: nothing of the account stays in memory.
  function forget() {
    for (const L of lives.values()) { try { L.ws.close(); } catch {} }
    lives.clear(); mine = null; list = []; keys.clear(); metas.clear(); others.clear(); rosters.clear(); pendingMine = []; pendingOf.clear(); joinError = null; refused = 0; }

  return {
    setRepoSource: (fn) => { repoSource = fn; publishes = true; }, setActivitySource: (fn) => { activitySource = fn; publishes = true; }, setCiSource: (fn) => { ciSource = fn; },
    setSource: (kind, fn) => { if (PUBLISHED.includes(kind)) sources[kind] = fn; },
    setLiveHandler: (fn) => { liveHandler = fn; },
    sessions: (space) => liveAsk(space, { t: 'list' }),
    sessionChat: (space, term, q = {}) => liveAsk(space, { t: 'chat', term, q }),
    sessionSend: (space, term, text) => liveAsk(space, { t: 'send', term, text: String(text || '').slice(0, 8000) }),
    myKey, emailHash: emailHashOf, inviteBase, inviteLink, shareState, changedBy, sharedBy, moveIsCopy, sharedRepos, syncShares, mergeDoc, buildDoc, keepInviteLink, answerInvite, admitInvite, cancelInvite, trustNewKeys, markChecked,
    pagesHere: (space) => S.pagesHere(space), shareProject, setAccess, setRole, acceptShare, leaveShare, leaveSpace, removeMember, removePerson, resetCodeFor, stopSharing, forget,
    // For team chat (lib/chat.js, its own log and keys, never part of a project's document):
    // each project you are in, its current key, and its joined people's names and signing keys.
    chatAccess: () => list.filter((x) => x.status === 'joined' && spaceOfShare(x.id) && keys.get(x.id)?.epoch === x.epoch && !keys.get(x.id).legacy)
      .map((x) => ({ id: x.id, space: spaceOfShare(x.id), epoch: x.epoch, key: keys.get(x.id).k, members: x.members.filter((m) => m.status === 'joined').map((m) => ({ email: m.email, name: nameIn(x.id, m.email), signPub: signPubOf(x.id, m.email) })) })),
    levelFor: (space, kind) => { const id = shareOfSpace(space), me = lc(S.getSetting('sync', null)?.email); return id ? levelOf(id, me, kind) : null; },
    _test: { shareMap, spaceOfShare, policyOf, rosterOf, levelOf, keys: () => keys, refused: () => refused, reset: forget, closeLive: () => { for (const L of lives.values()) { try { L.ws.close(); } catch {} } lives.clear(); } }
  };
}
