// The web board's api(): the page's calls (public/js/core.js) answered in the
// browser, from your own Switchboard here (public/js/web/client.js): your
// projects, pages, to-dos and reminders, About cards and settings, the shared
// projects you are in or run (and your team, for the ones you run), your
// account. Anything that needs a computer (sessions, terminals, local mail,
// files) says so in plain words.
// makeAdapter(client) -> api(path, body)

const NOT_HERE = 'That is part of Switchboard on a computer, not the web board. Open Switchboard on your own computer to use it.';
const lc = (s) => String(s || '').trim().toLowerCase();
const rid = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
const textLines = (body) => String(body || '').replace(/<(br|hr)\b[^>]*>/gi, '\n').replace(/<(li|p|h[1-3]|blockquote|ul|ol)\b[^>]*>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
const checks = (body) => { let total = 0, done = 0; for (const m of String(body || '').matchAll(/<li\b[^>]*\bdata-checked="(true|false)"/g)) { total++; if (m[1] === 'true') done++; } return { total, done }; };
const tagsOf = (text) => [...new Set([...String(text || '').matchAll(/(^|[\s(])#([a-z][\w-]{0,30})\b/gi)].map((m) => m[2].toLowerCase()))];
const pageItem = (p) => ({ uid: p.uid, title: p.title, space: p.space, pinned: !!p.pinned, private: !!p.private, created_at: p.created_at, updated_at: p.updated_at, tags: tagsOf(p.title + '\n' + textLines(p.body).join('\n')), preview: (textLines(p.body)[0] || '').slice(0, 140), checks: checks(p.body), size: String(p.body || '').length });
// Settings, Projects as the app cleans them (lib/spaces.js cleanSpaces): a new project never takes an id
// another has; made gets each new one's temporary id from the page and the id it got.
const slugOf = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function cleanSpaces(list, made = null) {
  const seen = new Set(), taken = new Set(list.map((x) => slugOf(x?.id)).filter(Boolean));
  return list.map((x) => {
    const name = String(x?.name || '').trim(), given = slugOf(x?.id);
    let id = given || slugOf(name);
    if (!name || !id) return null;
    while (seen.has(id) || (!given && taken.has(id))) id += '-2';
    seen.add(id);
    if (!given && made && /^new-[a-z0-9]{1,24}$/.test(String(x.tmp || ''))) made[x.tmp] = id;
    return { name, id, color: /^#[0-9a-f]{6}$/i.test(x.color) ? x.color : '#8A8F98', group: String(x.group || '').trim() || 'Mine', ...(x.from ? { from: String(x.from).toLowerCase() } : {}) };
  }).filter(Boolean);
}
const cleanProfile = (p = {}) => ({
  about: String(p.about || '').slice(0, 4000),
  people: (Array.isArray(p.people) ? p.people : []).slice(0, 50).map((x) => ({ name: String(x?.name || '').slice(0, 120), role: String(x?.role || '').slice(0, 120), email: String(x?.email || '').slice(0, 200), phone: String(x?.phone || '').slice(0, 60) })).filter((x) => x.name || x.email || x.phone),
  links: (Array.isArray(p.links) ? p.links : []).slice(0, 50).map((x) => ({ label: String(x?.label || '').slice(0, 120), url: /^(https?:|mailto:|tel:)/i.test(String(x?.url || '')) ? String(x.url).slice(0, 2000) : '' })).filter((x) => x.url),
  hidden: (Array.isArray(p.hidden) ? p.hidden : []).slice(0, 500).map((a) => lc(a))
});

// "todo call the printer", "remind me to …", "note …": what kind, and the rest.
function parseLine(line) {
  const t = String(line || '').trim();
  const m = t.match(/^(todo|to-do|task|remind me to|remind|reminder|note)\b[:\s]*(.*)$/i);
  if (!m) return { kind: 'note', text: t };
  const w = m[1].toLowerCase();
  return { kind: w.startsWith('remind') ? 'reminder' : w === 'note' ? 'note' : 'todo', text: m[2].trim() || t };
}

// The board's shape (as the app's server gives it), empty.
const EMPTY = () => ({
  now: Date.now(), spaces: [], profiles: {}, reading: [], feedCount: 0, tasks: [], taskStatus: {}, belongs: [], unsorted: 0,
  share: { ready: false, signedIn: false, me: '', invites: [], joining: [], joinError: null, projects: {}, team: [], refused: 0 },
  changedBy: {}, sharedBy: {}, sharedPrs: [], voice: { ready: false, running: false, step: '', progress: 0, error: null }, agents: [], webhooks: 0, deliveries: [], routines: [], pages: [], checks: [],
  events: [], calendars: [], weather: null, sessions: [], runs: [], reviews: [], actions: [], threads: [], email: [], awaiting: [], recent: [], drafts: [], terms: [], links: [], remoteTerms: [],
  relay: { connected: false, removed: false, allowRemote: false, device: '', devices: [] }, items: [], recentDone: [], money: { mail: [], bills: [], paid: [], invoices: [], guesses: [] }, sendAs: [], windows: [],
  version: { build: 'web', pkg: '', sha: '', channel: null, behind: 0, subjects: [], error: null, busy: false, app: false }, platform: 'web', sessionMode: 'web',
  status: { secrets: { ready: true, where: '', lost: false, waiting: false }, hooks: null, github: { at: null, ok: null, error: null }, gmail: [], microsoft: { connected: false, email: null, at: null, ok: null, error: null, signIn: null, canWrite: false } },
  web: true
});
const PREFS = { theme: 'light', textSize: 'm', startPage: 'now', welcome: { done: true, seen: [], uses: [] }, rundown: true, sessionView: 'chat', msgHidden: {} };   // the app's defaults (server.js PREFS)

// A bill's next date from its first one and how often it comes (lib/capture.js nextDue).
function nextBill(b, now = Date.now()) {
  if (!b.due_at) return null;
  const d = new Date(b.due_at), today = new Date(now); today.setHours(0, 0, 0, 0);
  for (let i = 0; d < today && i < 600; i++) {
    if (b.cadence === 'weekly') d.setDate(d.getDate() + 7);
    else if (b.cadence === 'yearly') d.setFullYear(d.getFullYear() + 1);
    else if (b.cadence === 'quarterly') d.setMonth(d.getMonth() + 3);
    else d.setMonth(d.getMonth() + 1);
  }
  return d.getTime();
}
const RUN_STATE = { failed: 'failure', done: 'success' };
// What your shared projects publish (money, calendar, browser checks) and their builds, shaped as the
// app's own pages read them, so Money, Calendar, Builds and Browser checks work on the board. Read only:
// they come from the computer that has them.
function sharedViews(st, share) {
  let n = 0;
  const events = [], checks = [];
  for (const [space, p] of Object.entries(share.projects || {})) {
    const pub = p.published || {};
    for (const m of pub.money || []) {
      const row = { id: 'sh' + (++n), kind: m.kind, text: m.text, amount: m.amount, due_at: m.due_at, created_at: m.at || 0, cadence: m.cadence || 'monthly', space, shared: true };
      if (m.kind === 'bill') st.money.bills.push({ ...row, next: nextBill(row) });
      else if (m.kind === 'invoice') st.money.invoices.push(row);
      else st.money.paid.push(row);
    }
    for (const e of pub.calendar || []) events.push({ uid: 'sh' + (++n), title: e.title, start: e.start, end: e.end || e.start, location: e.where, allDay: e.allDay, space, calendar: 'shared', calendarName: p.ownerName ? p.ownerName + '\'s calendar' : 'Shared', canWrite: false });
    for (const c of pub.checks || []) checks.push({ ...c, space, from: p.ownerName || '' });
  }
  st.sharedEvents = [...events, ...(st.ownEvents || [])];
  if ((st.ownEvents || []).length || st.webConnect?.google?.connected) st.calendars = [{ id: 'mine', name: 'Your calendars', canWrite: false }];
  st.events = st.sharedEvents.filter((e) => e.end > Date.now() && e.start < Date.now() + 7 * 86400e3);
  if (!st.calendars.length) st.calendars = Object.values(share.projects || {}).some((p) => p.kinds?.calendar && p.kinds.calendar !== 'none') ? [{ id: 'shared', name: 'Shared projects', canWrite: false }] : [];
  st.sharedChecks = checks;
  // Builds: the runs your projects share, and your own GitHub's, by repo.
  const repos = new Map();
  for (const r of st.runs) {
    if (!r.fullName) continue;
    const a = repos.get(r.fullName) || { fullName: r.fullName, name: r.fullName.split('/')[1], space: r.space, runs: [] };
    if (!a.runs.some((x) => x.id === r.id)) a.runs.push({ ...r, state: RUN_STATE[r.state] || r.state, startedAt: r.updatedAt, number: 0, event: '' });
    repos.set(r.fullName, a);
  }
  st.actions = [...repos.values()].map((a) => ({ ...a, runs: a.runs.sort((x, y) => y.updatedAt - x.updatedAt) }));
}

export function makeAdapter(client, { extra = null } = {}) {
  const D = client.data, core = client.core;
  // A shared project you may only see (or not at all) cannot be changed from here; your own can.
  function may(space, kind) {
    const lvl = core.levelFor(space, kind);
    if (lvl === null || lvl === 'edit') return;
    throw new Error(lvl === 'see' ? 'You can see this, but only people who may edit can change it. Ask whoever runs the project.' : 'This is not shared with you.');
  }
  const spaceOr = (space) => (space && space !== 'all' && D.spaces().some((s) => s.id === space)) ? space : (D.spaces()[0]?.id || 'personal');
  function state() {
    const s = client.session, st = EMPTY(), share = core.shareState();
    st.spaces = D.spaces();
    st.pages = D.allPages().map(pageItem).sort((a, b) => (b.pinned - a.pinned) || b.updated_at - a.updated_at);
    const items = D.allItems().filter((i) => ['note', 'todo', 'reminder'].includes(i.kind));
    st.items = items.filter((i) => !i.done_at);
    st.recentDone = items.filter((i) => i.done_at && Date.now() - i.done_at < 3 * 86400e3);
    st.profiles = D.getSetting('profiles', {});
    st.belongs = [];
    st.prefs = { ...PREFS, ...D.getSetting('prefs', {}), welcome: PREFS.welcome };
    st.share = share; st.changedBy = core.changedBy(); st.sharedBy = core.sharedBy();
    for (const [space, p] of Object.entries(share.projects)) {
      for (const r of p.runs || []) st.runs.push({ ...r, space, repo: r.fullName.split('/')[1] });
      for (const x of p.prs || []) st.sharedPrs.push({ ...x, space });
    }
    st.account = { signedIn: !!s, email: s?.email || null, server: s?.server || '', ownServer: false, at: client.syncedAt || null, ok: !client.error, error: client.error || null, busy: false, locked: false, info: s ? { email: s.email, hasPassword: true, hasRecovery: false, hasData: true, identities: [] } : null, pairing: null, asks: [], recoveryKey: null, web: true };
    // Your own connections, in this browser: Teams and Outlook in Inbox, your builds and the reviews waiting on you.
    const cx = client.connect;
    if (cx) {
      // Gmail sorted into Personal goes under Inbox, Personal, as in the app; the rest under Business.
      const personal = (t) => t.key.startsWith('gmail:') && t.space === 'personal';
      st.threads = cx.cache.threads.filter((t) => !personal(t)); st.recent = []; st.email = cx.cache.threads.filter(personal);
      st.runs = [...st.runs, ...cx.cache.runs]; st.reviews = cx.cache.reviews; st.ownEvents = cx.cache.events || [];
      st.webConnect = { ...cx.status(), notice: globalThis.window?.WEB?.connected || null };
      const ms = st.webConnect.microsoft;
      st.status.microsoft = { connected: !!ms.connected, email: ms.email || null, at: cx.cache.at || null, ok: !ms.error, error: ms.error || null, signIn: null, canWrite: !!ms.connected };
      st.status.github = { at: cx.cache.at || null, ok: st.webConnect.github.connected ? !st.webConnect.github.error : null, error: st.webConnect.github.error || null };
    }
    sharedViews(st, share);
    if (extra) Object.assign(st, extra(st));
    return st;
  }
  const settingsView = () => ({
    spaces: D.spaces(), rules: D.getSetting('rules', []), gmail: [], notify: { waiting: true, builds: true, finished: true, reminders: true, events: true, weather: true, email: true, teams: true, deliveries: true, quiet: { on: false, from: '22:00', to: '07:00' }, ...D.getSetting('notify', {}) },
    prefs: { ...PREFS, ...D.getSetting('prefs', {}) }, agents: [], signatures: {}, calendars: [], google: { configured: false, email: null, connected: false },
    localAI: { at: 0, ollamaInstalled: false, lmstudio: null, servers: [], starters: [] }, webhooks: [], sendAs: [], microsoft: null
  });
  const page = (uid) => { const p = D.page(uid); if (!p) throw Object.assign(new Error('That page is gone. It may have been deleted on another computer, or by someone in a shared project.'), { status: 404 }); return p; };
  const after = () => client.sync().catch(() => {});

  return async function api(path, body) {
    const url = new URL(path, 'https://board.invalid');
    const p = url.pathname, post = body !== undefined;
    let m;
    if (!post && p === '/api/state') return state();
    // Calendar: your shared projects' events in the weeks asked for.
    if (!post && p === '/api/calendar') {
      const from = Number(url.searchParams.get('from')) || 0, to = Number(url.searchParams.get('to')) || Infinity;
      return { events: state().sharedEvents.filter((e) => e.end >= from && e.start < to), problems: [] };
    }
    // ---- Settings: your projects, rules and preferences (synced with your account)
    if (!post && p === '/api/settings') return settingsView();
    if (post && p === '/api/settings') {
      const made = {};
      if (Array.isArray(body.spaces)) { const list = cleanSpaces(body.spaces, made); if (list.length) D.saveSpaces(list); }
      // A change to the rules, as Settings sends it: these taken away, these added at the end, the rest as they are.
      if (Array.isArray(body.rulesAdd) || Array.isArray(body.rulesRemove)) {
        const clean = (l) => (Array.isArray(l) ? l : []).filter((r) => Array.isArray(r) && r[0] && r[1]).map(([a, s]) => [String(a).trim(), String(s)]).filter(([a]) => a);
        const key = ([t, s]) => lc(t) + '\n' + s, plus = clean(body.rulesAdd), gone = new Set([...clean(body.rulesRemove), ...plus].map(key));
        D.setSetting('rules', [...D.getSetting('rules', []).filter((r) => !gone.has(key(r))), ...plus]);
      }
      if (Array.isArray(body.rules)) D.setSetting('rules', body.rules.filter((r) => Array.isArray(r) && r[0] && r[1]).map(([a, s]) => [String(a).trim(), String(s)]));
      if (body.prefs && typeof body.prefs === 'object') D.setSetting('prefs', { ...D.getSetting('prefs', {}), ...body.prefs });
      if (body.notify && typeof body.notify === 'object') D.setSetting('notify', body.notify);
      return { ok: true, ...settingsView(), made };
    }
    // ---- your account
    if (!post && p === '/api/account/providers') return { providers: [] };
    if (post && (m = p.match(/^\/api\/account\/(signup|signin|signout)$/))) {
      if (m[1] === 'signup') await client.signUp(String(body.email || ''), String(body.password || ''));
      else if (m[1] === 'signin') await client.signIn(String(body.email || ''), String(body.password || ''));
      else await client.signOut();
      return { ok: true, account: state().account };
    }
    if (post && p === '/api/account/reset-start') { await client.resetStart(String(body.email || '')); return { ok: true }; }
    if (post && p === '/api/account/reset-finish') { await client.resetFinish(String(body.email || ''), String(body.code || ''), String(body.password || '')); return { ok: true, account: state().account }; }
    if (post && p === '/api/account/sync') { await client.sync(); return { ok: true }; }
    if (post && p.startsWith('/api/account/')) throw new Error('On the web board, sign in with your email and password. Pairing a computer and recovery keys are in Switchboard on a computer.');
    // ---- pages
    if (p === '/api/pages' && post) {
      const space = spaceOr(body.space); may(space, 'pages');
      const now = Date.now(), pg = { uid: rid(12), title: String(body.title || '').slice(0, 200), body: String(body.body || ''), space, pinned: 0, private: 0, created_at: now, updated_at: now };
      D.pageInsert(pg); after();
      return pg;
    }
    if ((m = p.match(/^\/api\/pages\/((?:sec)?[0-9a-f]{6,40})$/))) {
      const cur = page(m[1]);
      if (!post) return cur;
      may(cur.space, 'pages');
      // A section of someone's page, shared on its own, is theirs to change.
      if (/^sec[0-9a-f]{21}$/.test(m[1])) throw new Error('This is a section of a page in the project, shared on its own: it is read-only here. Its owner changes it on their page.');
      if (body.space !== undefined && body.space !== cur.space) { may(body.space, 'pages'); if (!D.spaces().some((s) => s.id === body.space)) throw new Error('That project is gone. Pick another one.'); }
      // A page someone else shared, moved to another project: a copy of your own goes there, theirs stays (review H4).
      const by = body.space !== undefined ? core.moveIsCopy(cur.uid, cur.space, body.space) : null;
      let own = null;
      if (by) {
        const now = Date.now(), copy = { uid: rid(12), title: cur.title, body: cur.body, space: body.space, pinned: 0, private: 0, created_at: now, updated_at: now };
        D.pageInsert(copy); after();
        own = { copy: { uid: copy.uid, space: body.space }, sharedBy: by, stays: cur.space };
      }
      const next = { title: body.title !== undefined ? String(body.title).replace(/\s+/g, ' ').slice(0, 200) : cur.title, body: body.body !== undefined ? String(body.body) : cur.body, space: body.space !== undefined && !own ? body.space : cur.space, pinned: body.pinned !== undefined ? (body.pinned ? 1 : 0) : cur.pinned, private: body.private !== undefined ? (body.private ? 1 : 0) : (cur.private || 0) };
      if (next.body.length > 200 * 1024) throw new Error('This page is too long to save (200,000 characters). Split it into two pages.');
      if (next.title === cur.title && next.body === cur.body && next.space === cur.space && next.pinned === cur.pinned && next.private === (cur.private || 0)) return { ...cur, ...(own || {}) };
      D.pageUpdate(m[1], { ...next, updated_at: Math.max(Date.now(), cur.updated_at + 1) }); after();
      return { ...D.page(m[1]), ...(own || {}) };
    }
    if (post && (m = p.match(/^\/api\/pages\/((?:sec)?[0-9a-f]{6,40})\/delete$/))) { const cur = page(m[1]); may(cur.space, 'pages'); D.pageDelete(m[1]); after(); return { ok: true }; }
    if (!post && p === '/api/search') {
      const q = lc(url.searchParams.get('q'));
      const results = !q ? [] : [...D.allPages().filter((x) => lc(x.title + ' ' + textLines(x.body).join(' ')).includes(q)).map((x) => ({ type: 'page', uid: x.uid, space: x.space, title: x.title || 'Untitled', line: (textLines(x.body)[0] || '').slice(0, 140), score: lc(x.title).includes(q) ? 3 : 2 })),
        ...D.allItems().filter((i) => !i.done_at && ['note', 'todo', 'reminder'].includes(i.kind) && lc(i.text).includes(q)).map((i) => ({ type: i.kind, id: i.id, space: i.space, title: i.text, due_at: i.due_at, score: 1 }))].sort((a, b) => b.score - a.score).slice(0, 12);
      return { results, convos: [] };
    }
    // ---- to-dos, reminders, quick notes
    if (post && p === '/api/capture') {
      const { kind, text } = parseLine(body.line);
      if (!text) throw new Error('Type what to add first.');
      const space = spaceOr(body.space); may(space, 'tasks');
      const now = Date.now(), uid = rid(16);
      D.itemInsert({ uid, kind, text: text.slice(0, 2000), space, due_at: kind === 'note' ? null : now, created_at: now, done_at: null, updated_at: now }); after();
      return D.allItems().find((i) => i.uid === uid);
    }
    if (post && (m = p.match(/^\/api\/items\/(\d+)\/(done|delete|undo|snooze)$/))) {
      const i = D.itemById(m[1]);
      if (!i) throw new Error('That is gone. It may have been done on another computer.');
      may(i.space, 'tasks');
      if (m[2] === 'delete') D.itemDelete(i.uid);
      else D.itemUpdate(i.uid, { done_at: m[2] === 'done' ? Date.now() : m[2] === 'undo' ? null : i.done_at, due_at: m[2] === 'snooze' ? Number(body.until) || i.due_at : i.due_at, updated_at: Math.max(Date.now(), i.updated_at + 1) });
      after(); return { ok: true };
    }
    // ---- a project's page: its About card (files and people found in mail are on computers)
    if ((m = p.match(/^\/api\/projects\/([a-z0-9-]{1,60})$/)) && !post) return { profile: cleanProfile(D.getSetting('profiles', {})[m[1]] || {}), files: [], found: [] };
    if (post && (m = p.match(/^\/api\/projects\/([a-z0-9-]{1,60})\/profile$/))) {
      may(m[1], 'about');
      const all = D.getSetting('profiles', {});
      D.setSetting('profiles', { ...all, [m[1]]: cleanProfile(body) });
      after(); return { profile: D.getSetting('profiles', {})[m[1]], found: [] };
    }
    if (!post && /^\/api\/projects\/[a-z0-9-]{1,60}\/(members|addable)$/.test(p)) return [];
    if (!post && p === '/api/costs') return {};
    // ---- sharing, and your team (lib/routes/share.js does the same in the app)
    if (!post && p === '/api/share') return core.shareState();
    if (!post && p === '/api/share/pages') return { count: core.pagesHere(String(url.searchParams.get('space') || '')) };
    // A shared project's sessions, from its owner's computer while it is online.
    if (!post && p === '/api/share/sessions') { try { return { sessions: await core.sessions(String(url.searchParams.get('space') || '')) }; } catch (e) { if (e.offline) return { offline: e.message }; throw e; } }
    if (!post && p === '/api/share/session') return core.sessionChat(String(url.searchParams.get('space') || ''), String(url.searchParams.get('term') || ''), { file: url.searchParams.get('file') || undefined, from: url.searchParams.get('from') ?? undefined, before: url.searchParams.get('before') ?? undefined });
    if (post && p === '/api/share/session-send') return core.sessionSend(String(body.space || ''), String(body.term || ''), String(body.text || ''));
    if (post && (m = p.match(/^\/api\/share(?:\/([a-z-]+))?$/))) {
      const act = m[1] || 'invite', space = String(body.space || ''), id = String(body.id || '');
      const kinds = body.kinds && typeof body.kinds === 'object' ? body.kinds : undefined;
      let out = {};
      if (act === 'invite') out = await core.shareProject(space, String(body.email || ''), String(body.name || ''), { kinds, existing: body.existing === 'private' ? 'private' : 'share' });
      else if (act === 'access') out = { kinds: await core.setAccess(space, String(body.email || ''), kinds || {}) };
      else if (act === 'role') await core.setRole(String(body.email || ''), body.role === 'admin' ? 'admin' : 'member');
      else if (act === 'accept') out = await core.acceptShare(id);
      else if (act === 'answer') out = await core.answerInvite(id, !!body.yes);
      else if (act === 'admit') out = await core.admitInvite(space, id);
      else if (act === 'keys-trust') out = await core.trustNewKeys(String(body.email || ''), String(body.code || ''));
      else if (act === 'keys-checked') core.markChecked(String(body.email || ''), !!body.yes);
      else if (act === 'decline') await core.leaveShare(id);
      else if (act === 'leave') await core.leaveSpace(space);
      else if (act === 'remove') await core.removeMember(space, String(body.email || ''));
      else if (act === 'remove-person') out = { projects: await core.removePerson(String(body.email || '')) };
      else if (act === 'reset-code') out = { code: await core.resetCodeFor(String(body.email || '')) };
      else if (act === 'cancel-invite') await core.cancelInvite(space, id);
      else if (act === 'stop') await core.stopSharing(space);
      else if (act === 'link') { core.keepInviteLink(String(body.token || ''), String(body.project || '')); if (client.session) after(); }
      // The invite email: on the web board you send the link yourself (Copy link), unless Outlook is connected (public/js/web/connect.js).
      else if (act === 'mail-preview') { const ms = client.connect?.status().microsoft; out = { to: lc(body.to), from: ms?.connected ? ms.email : null, fromName: '', subject: `You are invited to ${body.project || 'a project'} on Switchboard`, text: `Join ${body.project || 'the project'} on Switchboard: ${body.link}\n\nThe link works once, for 14 days, and only for this email address.`, html: '', canSend: !!ms?.connected }; }
      // From your own Outlook, on the Send click; without it, Copy link.
      else if (act === 'mail-send') { if (!client.connect?.status().microsoft.connected) throw new Error('Connect Microsoft 365 to send it from Outlook, or Copy link and send it yourself.'); out = { sent: true, from: await client.connect.sendMail(lc(body.to), `You are invited to ${body.project || 'a project'} on Switchboard`, `Join ${body.project || 'the project'} on Switchboard: ${body.link}\n\nThe link works once, for 14 days, and only for this email address.`) }; }
      else throw new Error(NOT_HERE);
      if (!['link', 'reset-code'].includes(act)) await client.sync();
      return { ok: true, ...out, share: core.shareState() };
    }
    // ---- your own connections (public/js/web/connect.js)
    if (post && p === '/api/web/connect') {
      const cx = client.connect, what = String(body.service || '');
      if (body.disconnect) { cx.disconnect(what); after(); return { ok: true }; }
      await cx.cfg();
      if (what === 'microsoft') await cx.startMicrosoft(); else if (what === 'github') await cx.startGithub(); else if (what === 'google') await cx.startGoogle(); else throw new Error(NOT_HERE);
      return { ok: true, leaving: true };
    }
    if (!post && p === '/api/conversation') { const r = await client.connect?.conversation(url.searchParams.get('key') || ''); if (r) return r; throw new Error('That conversation is not open here.'); }
    if (!post && p === '/api/thread/full') { const r = await client.connect?.conversation(url.searchParams.get('key') || ''); return { messages: (r?.messages || []).map((m) => ({ from: m.from_me ? 'You' : m.from_name, date: m.date, text: m.text })) }; }
    if (post && p === '/api/reply') {
      const text = String(body.text || '').trim();
      if (!text) throw new Error('Write something first.');
      if (Array.isArray(body.images) && body.images.length) throw new Error('Pictures go from Switchboard on your computer for now; send the text here.');
      if (!(await client.connect?.reply(String(body.key || ''), text))) throw new Error('Replies to this conversation are sent from Switchboard on a computer.');
      client.connect.refresh().then(() => client.sync()).catch(() => {});
      return { ok: true, sent: { text, date: Date.now() } };
    }
    // Quiet no-ops the page sends as it goes.
    if (post && /^\/api\/(seen|focus|clear|read|links)\b/.test(p)) return { ok: true };
    throw new Error(NOT_HERE);
  };
}
