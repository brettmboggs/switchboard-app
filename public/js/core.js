// Shared state and helpers: the board state S, api(), escaping, time and money, projects, the cards model, the shell (rail, top bar) and the shared list row.
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
// Switchboard page. Four pages (Now, Inbox, Money, Notes), filtered by project.
// Fetches the whole board from /api/state and re-fetches when the server says
// something changed.
'use strict';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };

let S = null;                                   // last board state
let page = 'now';
let project = store.get('space', 'all');
let nowFilter = store.get('nowFilter', 'all'); // all | needs | others
let inboxTab = store.get('inboxTab', 'business');
let inboxSource = 'all';
let selected = null;                            // { type, key }
let draft = {};                                 // unsent replies, by thread key
let mergeArmed = null;
let bootSha = null;
let currentTerm = store.get('term', null);   // Switchboard session shown on the Sessions page

async function api(path, body) {
  const opts = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Switchboard': '1' }, body: JSON.stringify(body) };
  const res = await fetch(path, opts);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
}

// ---------- time and money
function ago(t) {
  if (!t) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return Math.floor(s / 60) + ' min';
  if (s < 86400) return Math.floor(s / 3600) + ' h';
  return Math.floor(s / 86400) + ' d';
}
function when(t) {
  const d = new Date(t), today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const diff = Math.round((day - today) / 86400e3);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(':00', '').toLowerCase().replace(' ', '');
  const label = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : diff > 1 && diff < 7 ? d.toLocaleDateString([], { weekday: 'short' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${label} ${time}`;
}
// "4 min ago", or "just now".
const since = (t) => { const a = ago(t); return a === 'now' ? 'just now' : a + ' ago'; };
const dayOnly = (t) => new Date(t).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
const $$ = (n) => '$' + (Math.round((n || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

// ---------- projects
const spaceOf = (id) => S.spaces.find((s) => s.id === id) || { id, name: id === 'personal' ? 'Personal' : (id || 'Unsorted'), color: '#B9BEC6' };
const tag = (space) => `<span class="tag" style="background:${esc(spaceOf(space).color)}" title="${esc(spaceOf(space).name)}"></span>`;
const inProject = (x) => project === 'all' || x.space === project;

// ---------- the model: everything in flight, as cards with one state each
//   needs     blocked on Brett
//   working   moving without him
//   others    waiting on someone else
//   done      finished recently
//   idle      open, nothing happening
const STATE_LABEL = { needs: 'Needs you', working: 'Working', others: 'Waiting on them', done: 'Done', idle: 'Idle' };

function runGroups() {
  const rank = { failed: 0, running: 1, done: 2 };
  const map = new Map();
  for (const r of S.runs) {
    const k = r.repo + '|' + r.title;
    const g = map.get(k) || { runs: [], state: 'done', at: 0, lead: r };
    g.runs.push(r);
    if (rank[r.state] < rank[g.state]) { g.state = r.state; g.lead = r; }
    g.at = Math.max(g.at, r.updatedAt);
    map.set(k, g);
  }
  const seenDone = new Set();
  return [...map.values()].sort((a, b) => b.at - a.at).filter((g) => {
    if (g.state !== 'done') return true;
    if (seenDone.has(g.lead.repo)) return false;
    seenDone.add(g.lead.repo);
    return true;
  });
}

function flight() {
  const now = Date.now();
  const cards = [];
  for (const s of S.sessions) {
    const st = s.state === 'waiting' || s.state === 'finished' ? 'needs' : s.state === 'running' ? 'working' : 'idle';
    cards.push({
      type: 'session', key: s.id, space: s.space, st,
      label: s.state === 'finished' ? 'Your turn' : s.state === 'waiting' ? 'Needs you' : STATE_LABEL[st],
      where: `Claude · ${s.repo || 'unknown folder'}`,
      what: s.state === 'waiting' ? (s.detail || 'Needs you') : s.state === 'finished' ? (s.lastMessage || s.prompt || 'Finished') : (s.prompt || 'Open, nothing asked yet'),
      at: s.updatedAt
    });
  }
  for (const t of (S.remoteTerms || [])) {
    const st = t.state === 'waiting' || t.state === 'finished' ? 'needs' : t.state === 'running' ? 'working' : 'idle';
    cards.push({ type: 'rterm', key: `r:${t.device}:${t.id}`, space: t.space, st, label: t.state === 'finished' ? 'Your turn' : t.state === 'waiting' ? 'Needs you' : STATE_LABEL[st],
      where: `${t.agentName} · ${t.name} · on ${t.deviceName}`, what: t.state === 'waiting' ? (t.detail || 'Needs you') : (t.prompt || 'Open'), at: t.updatedAt });
  }
  for (const g of runGroups()) {
    const st = g.state === 'failed' ? 'needs' : g.state === 'running' ? 'working' : 'done';
    cards.push({ type: 'run', key: String(g.lead.id), space: g.lead.space, st, label: g.state === 'failed' ? 'Failed' : STATE_LABEL[st], where: g.runs.length > 1 ? `${g.lead.repo} · ${g.runs.length} workflows` : `${g.lead.repo} · ${g.lead.workflow}`, what: g.lead.title, at: g.at });
  }
  for (const p of S.reviews) cards.push({ type: 'review', key: String(p.id), space: p.space, st: 'needs', label: 'Review', where: `${p.repo} #${p.number}`, what: p.title, at: p.updatedAt });
  for (const i of S.items) {
    if ((i.kind === 'reminder' || i.kind === 'todo') && i.due_at && i.due_at <= now) {
      cards.push({ type: 'item', key: String(i.id), space: i.space, st: 'needs', label: i.kind === 'reminder' ? 'Reminder' : 'To-do', where: 'Due ' + when(i.due_at), what: i.text, at: i.due_at });
    }
  }
  cards.push(...deliveryCards(), ...routineCards(), ...checkCards());
  for (const v of S.money.invoices) cards.push({ type: 'invoice', key: String(v.id), space: v.space, st: 'others', label: 'Invoice out', where: `${$$(v.amount)} · sent ${since(v.created_at)}`, what: v.text, at: v.created_at });
  for (const a of S.awaiting) cards.push({ type: 'awaiting', key: a.key, space: a.space, st: 'others', label: 'No reply yet', where: `Emailed ${a.who} · ${since(a.date)}`, what: a.subject, at: a.date });
  return cards;
}

function needsCount(space = 'all') {
  return flight().filter((c) => c.st === 'needs' && (space === 'all' || c.space === space)).length;
}
function inboxCount(space = 'all') {
  return S.threads.filter((t) => space === 'all' || t.space === space).length;
}

// ---------- shell: rail, status, header pill
// [id, name, parent]: a page with a parent is one of that page's tabs, not on
// the rail. Sessions has tabs for builds and browser checks; more kinds of
// session (a plain chat with your account, a desktop worker) slot in here later.
const PAGES = [['now', 'Now'], ['sessions', 'Sessions'], ['builds', 'Builds', 'sessions'], ['checks', 'Browser checks', 'sessions'], ['inbox', 'Inbox'], ['money', 'Money'], ['notes', 'Notes']];
const PAGE_MOVED = { actions: 'builds' };   // old links keep working
if (PAGE_MOVED[location.hash.slice(1)]) history.replaceState(null, '', '#' + PAGE_MOVED[location.hash.slice(1)]);
const railOf = (id) => PAGES.find((p) => p[0] === id)?.[2] || id;
// The tabs along the top of a page that has them (Sessions · Builds · Browser checks).
function subTabs() {
  const top = railOf(page), tabs = PAGES.filter((p) => p[0] === top || p[2] === top);
  const repos = (S.actions || []).filter(inProject);
  const buildLight = repos.some((a) => a.runs.some((r) => CI_ACTIVE(r.state))) ? 'running' : repos.some((a) => a.runs[0]?.state === 'failure' && Date.now() - a.runs[0].updatedAt < 2 * 86400e3) ? 'failure' : '';
  const light = { builds: buildLight, checks: checksLight() }, count = { builds: ciActiveCount() };
  return `<nav class="chips sub-tabs" aria-label="${esc(PAGES.find((p) => p[0] === top)[1])}">${tabs.map(([id, name]) => `<a class="chip" href="#${id}" ${page === id ? 'aria-current="page"' : ''}>${esc(name)}${light[id] ? ciDot(light[id]) : ''}${count[id] ? ` <span class="c">${count[id]}</span>` : ''}</a>`).join('')}</nav>`;
}

function renderShell() {
  const counts = { now: needsCount(project), sessions: (S.terms || []).filter((t) => t.state === 'waiting' || t.state === 'finished').length, inbox: inboxCount(project), money: '', notes: '' };
  const light = { sessions: ciLight() };   // builds and browser checks live under Sessions
  $('pages').innerHTML = PAGES.filter((p) => !p[2]).map(([id, name]) => `<a class="page-link" href="#${id}" ${railOf(page) === id ? 'aria-current="page"' : ''}>${name}${light[id] ? ciDot(light[id]) : ''}<span class="n">${counts[id] || ''}</span></a>`).join('');
  const per = (id) => page === 'inbox' ? inboxCount(id) : needsCount(id);
  const groups = [...new Set(S.spaces.map((s) => s.group || 'Mine'))];
  let html = `<h3>Projects</h3><button class="space" type="button" data-space="all" aria-pressed="${project === 'all'}"><span class="dot" style="background:var(--ink)"></span>Everything<span class="n">${per('all') || ''}</span></button>`;
  for (const g of groups) {
    if (groups.length > 1) html += `<h3>${esc(g)}</h3>`;
    for (const s of S.spaces.filter((x) => (x.group || 'Mine') === g)) {
      html += `<button class="space" type="button" data-space="${esc(s.id)}" aria-pressed="${project === s.id}"><span class="dot" style="background:${esc(s.color)}"></span>${esc(s.name)}<span class="n">${per(s.id) || ''}</span></button>`;
    }
  }
  $('projects').innerHTML = html;

  // Connections stay out of sight while they work; only a broken one is named.
  const st = S.status, broken = [];
  if (st.secrets?.waiting) broken.push(['Keychain', 'Waiting for this computer\'s keychain to unlock. Connections start as soon as it does.']);
  if (st.secrets?.lost) broken.push(['Saved passwords', 'This computer\'s keychain was reset, so passwords saved here could not be unlocked. Sign in to your Switchboard account, or add them again.']);
  if (st.github.ok === false) broken.push(['GitHub', st.github.error]);
  for (const g of st.gmail) if (g.ok === false) broken.push([st.gmail.length > 1 ? g.email : (g.name || 'Email'), g.error]);
  if (S.account?.signedIn && S.account.ok === false) broken.push(['Sync', S.account.error]);
  if (st.microsoft?.connected && st.microsoft.ok === false) broken.push(['Microsoft', st.microsoft.error]);
  const el = $('status');
  el.hidden = !broken.length;
  el.textContent = broken.length ? broken.map(([n]) => n).join(', ') + (broken.length > 1 ? ' aren\'t connecting' : ' isn\'t connecting') : '';
  el.title = broken.map(([n, e]) => n + (e ? ': ' + e : '')).join('\n');

  const v = S.version || {};
  $('update-btn').hidden = !v.behind;
  if (v.behind) $('update-btn').title = 'New: ' + (v.subjects || []).join(' · ');
  if (v.build && bootSha && v.build !== bootSha) location.reload();   // the server has a new page: load it
  if (v.build && !bootSha) bootSha = v.build;
  const n = needsCount();
  $('needs-n').textContent = n;
  $('needs').classList.toggle('zero', n === 0);
  document.title = n ? `(${n}) Switchboard` : 'Switchboard';
}

// ---------- shared row
function row({ type, key, space, title, sub, right, via, bold, cls = '' }) {
  return `<button class="item ${bold ? 'bold' : ''} ${isSel(type, key) ? 'sel' : ''} ${cls}" type="button" data-type="${type}" data-key="${esc(key)}">${tag(space)}
    <span><span class="t">${esc(title)}</span><br><span class="s">${via ? `<span class="via">${esc(via)}</span>` : ''}${esc(sub || '')}</span></span>
    <span class="r">${right || ''}</span></button>`;
}
const isSel = (type, key) => selected && selected.type === type && selected.key === key;
const empty = (t) => `<p class="empty">${t}</p>`;
