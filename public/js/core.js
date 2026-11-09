// Shared state and helpers: the board state S, api(), escaping, time and money, projects, the cards model, the shell (rail, top bar) and the shared list row.
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
// Switchboard page. Four pages (Now, Inbox, Money, Notes), filtered by project.
// Fetches the whole board from /api/state and re-fetches when the server says
// something changed.
'use strict';

const $ = (id) => document.getElementById(id);
// The mark (ring, lamp, three dots), inline so its colours follow the page: dots --brand, lamp the board's state (css/brand.css). Same drawing as scripts/icons.mjs, heavy cut.
const MARK_SVG = '<svg class="mark-sym" viewBox="2 6 45 36" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="4.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 10H11.5C15.75 10 15.75 24 20 24"/><path d="M6 38H11.5C15.75 38 15.75 24 20 24"/><path d="M6 24H20"/><path d="M36 24H44"/></g><circle cx="28" cy="24" r="8" fill="none" stroke="currentColor" stroke-width="4.2"/><circle cx="6" cy="10" r="3.4" class="mk-dot"/><circle cx="6" cy="24" r="3.4" class="mk-dot"/><circle cx="6" cy="38" r="3.4" class="mk-dot"/><circle cx="28" cy="24" r="3.6" class="mk-lamp"/></svg>';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Links and colours from outside (mail, GitHub, Graph, a feed) reach the page
// only in a shape the page chose: a link is http(s) or mailto, a colour is
// #rrggbb. Anything else becomes an empty link or the grey of an unsorted project.
const safeHref = (u) => /^(https?:|mailto:)/i.test(String(u || '')) ? esc(u) : '#';
const safeColor = (c) => /^#[0-9a-f]{6}$/i.test(c) ? c : '#B9BEC6';
const store = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };

let S = null;                                   // last board state
let page = 'now';
let project = store.get('space', 'all');
let nowFilter = store.get('nowFilter', 'all'); // all | needs | others
let inboxTab = store.get('inboxTab', 'business');
let inboxSource = 'all';
let selected = null;                            // { type, key }
let draft = store.get('drafts', {});            // unsent replies and messages, by thread or session key; kept in the browser so a reload never loses them
let mergeArmed = null;
let bootSha = null;
let newPageSaid = null;   // the build the "was updated" line was shown for
let currentTerm = store.get('term', null);   // Switchboard session shown on the Sessions page

// Drafts are saved as they are typed, so nothing written is lost when the page
// reloads (an update) or the tab closes. The message bar's text is read from
// the box itself, since it is only copied into draft when switching sessions.
let lastTyped = 0, draftTimer = null;
function saveDrafts() {
  const ta = document.getElementById('q-text');
  if (ta && typeof composeFor !== 'undefined' && composeFor) draft['term:' + composeFor] = ta.value;
  store.set('drafts', Object.fromEntries(Object.entries(draft).filter(([, v]) => typeof v === 'string' && v.trim())));
}
document.addEventListener('input', () => { lastTyped = Date.now(); clearTimeout(draftTimer); draftTimer = setTimeout(saveDrafts, 400); }, true);
addEventListener('pagehide', saveDrafts);
// Typing, dictating, or a text box in use: an update's reload waits for a quiet minute.
function busyTyping() {
  if (typeof rec !== 'undefined' && rec) return true;
  if (Date.now() - lastTyped < 60e3) return true;
  const a = document.activeElement;
  return !!(a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !['checkbox', 'radio', 'button'].includes(a.type)) || a.isContentEditable) && (a.value ?? a.textContent ?? '').trim());
}

// Errors come back in words a person can act on: the server writes them (see
// lib/friendly.js); when it cannot answer at all, this says so.
async function api(path, body) {
  // The web board (public/js/web/): answered in the browser, from shared projects.
  if (window.WEB) { await window.WEB.ready; return window.WEB.api(path, body); }
  const opts = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Switchboard': '1' }, body: JSON.stringify(body) };
  let res;
  try { res = await fetch(path, opts); }
  catch { throw Object.assign(new Error('Switchboard\'s server is not answering. It may be restarting after an update: wait a few seconds and try again. If it stays like this, restart Switchboard.'), { data: { offline: true } }); }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error || HTTP_WORDS[res.status] || `Switchboard answered ${res.status} with no explanation. Copy the details from the next error, or try again.`), { data: json });
  return json;
}
// A file from the computer into Switchboard (lib/attachments.js): the file is
// the body, its name in a header. Gives { id, name, size, path, image }.
async function uploadFile(file) {
  if (window.WEB) throw new Error('Files go in from Switchboard on your computer; the web board keeps only what is shared, as text.');
  if (file.size > 1024 ** 3) throw new Error(`${file.name} is over 1 GB. Share a link to it instead, or make it smaller.`);
  let res;
  try { res = await fetch('/api/files', { method: 'POST', headers: { 'X-Switchboard': '1', 'X-Filename': encodeURIComponent(file.name || 'pasted'), 'Content-Type': 'application/octet-stream' }, body: file }); }
  catch { throw new Error('Switchboard\'s server is not answering, so the file was not added. Try again in a few seconds.'); }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || HTTP_WORDS[res.status] || 'The file was not added.');
  return j;
}
const fileUrl = (id) => '/api/files/' + encodeURIComponent(id);
const HTTP_WORDS = {
  400: 'Switchboard could not use what was sent. Check what you typed and try again.',
  403: 'Switchboard refused that because it did not come from its own page. Reload this page and try again.',
  404: 'That is not there any more. It may have been removed on another computer; the page refreshes by itself.',
  413: 'That is too big to send in one go.',
  500: 'Switchboard hit a problem doing that. Try once more; if it happens again, restart Switchboard.',
  502: 'A service Switchboard uses is having trouble. It tries again on its own.',
  503: 'Switchboard is starting up. Give it a few seconds.'
};

// ---------- dialogs
// Every dialog is a .scrim with role="dialog". openDialog remembers what had
// focus, makes the page behind it inert, puts focus inside (an [autofocus],
// else the first field, else the heading) and keeps Tab inside; closeDialog
// undoes all of it and gives focus back. Escape closes only the topmost one
// (nav.js). A dialog opened over another leaves the lower one inert too.
const dialogStack = [];
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
const focusables = (root) => [...root.querySelectorAll(FOCUSABLE)].filter((el) => !el.closest('[hidden]') && el.getClientRects().length);
const topDialog = () => dialogStack.length ? dialogStack[dialogStack.length - 1] : null;
function openDialog(id) {
  const d = $(id); if (!d) return;
  if (!d.classList.contains('open')) d._opener = document.activeElement;
  if (!dialogStack.includes(id)) dialogStack.push(id);
  d.classList.add('open');
  for (const el of document.querySelectorAll('.frame')) el.inert = true;
  for (const el of document.querySelectorAll('.scrim.open')) el.inert = el !== d;
  focusInto(d);
}
function focusInto(d) {
  const first = d.querySelector('[autofocus]') || focusables(d).find((el) => el.matches('input, textarea, select')) || d.querySelector('h1, h2, h3') || focusables(d)[0] || d;
  if (!first.matches(FOCUSABLE) && !first.hasAttribute('tabindex')) first.tabIndex = -1;
  first.focus({ preventScroll: true });
}
function closeDialog(id) {
  const d = $(id); if (!d || !d.classList.contains('open')) return;
  d.classList.remove('open');
  if (typeof rec !== 'undefined' && rec && d.contains(rec.target)) stopDictation();   // a mic in a closed box stops
  const i = dialogStack.indexOf(id); if (i >= 0) dialogStack.splice(i, 1);
  const top = topDialog() && $(topDialog());
  if (top) top.inert = false;
  else for (const el of document.querySelectorAll('.frame')) el.inert = false;
  const back = d._opener; d._opener = null;
  if (back?.isConnected && !back.closest('[inert]') && typeof back.focus === 'function') back.focus({ preventScroll: true });
  else if (top) focusInto(top);
}
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab' || !dialogStack.length) return;
  const d = $(topDialog()); if (!d) return;
  const list = focusables(d); if (!list.length) { e.preventDefault(); return; }
  const first = list[0], last = list[list.length - 1], a = document.activeElement;
  if (e.shiftKey && (a === first || !d.contains(a))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && (a === last || !d.contains(a))) { e.preventDefault(); first.focus(); }
});

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
const tag = (space) => `<span class="tag" style="background:${safeColor(spaceOf(space).color)}" title="${esc(spaceOf(space).name)}"></span>`;
// Text an agent was given can carry the wrapper Claude Code puts round pasted
// text; it means nothing on a card.
const plainLine = (t) => String(t || '')
  .replace(/<(task-id|tool-use-id|output-file|status)>[^<]*<\/\1>/g, '')   // a background task's ids
  .replace(/<\/?(pasted_content|task-notification|summary|result|system-reminder|command-[a-z]+)\b[^>]*>/g, ' ')
  .replace(/\s+/g, ' ').trim();
// A thing is in a project when that is its main project (x.space, from the
// rules) or it also belongs there (S.belongs, lib/belongs.js). keysOf says what
// a thing answers to: its repo, the person or domain it is from, its chat, its page.
function keysOf(x) {
  const k = [];
  if (!x || typeof x !== 'object') return k;
  if (x.uid && 'title' in x) k.push('page:' + x.uid);
  if (x.cwd) k.push('repo:' + String(x.cwd).split(/[\\/]/).filter(Boolean).pop());
  if (typeof x.repo === 'string' && x.repo) k.push('repo:' + x.repo.split('/').pop());
  if (typeof x.key === 'string' && x.key.startsWith('teams:')) k.push('chat:' + x.key);
  for (const a of [x.from, x.who]) {
    const m = String(a || '').toLowerCase().match(/[^\s<>"',]+@([^\s<>"',]+)/);
    if (m) { k.push('person:' + m[0], 'domain:@' + m[1]); break; }
  }
  return k;
}
let belongsMap = null, belongsFrom = null;
function alsoIn(x) {
  if (!S?.belongs?.length) return null;
  if (belongsFrom !== S.belongs) { belongsMap = new Map(); for (const b of S.belongs) { if (!belongsMap.has(b.key)) belongsMap.set(b.key, new Set()); belongsMap.get(b.key).add(b.space); } belongsFrom = S.belongs; }
  let out = null;
  for (const k of keysOf(x)) for (const sp of belongsMap.get(k) || []) (out ||= new Set()).add(sp);
  return out;
}
const inSpace = (x, id) => x.space === id || !!alsoIn(x)?.has(id);
const inProject = (x) => project === 'all' || inSpace(x, project);
// Lists are filtered from their own page's head, not the rail: one small
// picker, "All projects" unless one is picked (it is remembered).
const projectPicker = () => `<label class="proj-filter${project === 'all' ? '' : ' on'}"><span class="sr">Show project</span><select class="field field--sm" data-filter-project>
    <option value="all">All projects</option>${S.spaces.map((s) => `<option value="${esc(s.id)}" ${project === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>`;
// Where Ctrl K puts things: the project whose page is open, else the picked one.
const captureSpace = () => page === 'project' && openProject ? openProject : project;
document.addEventListener('change', (e) => {
  if (!e.target.matches?.('[data-filter-project]')) return;
  project = e.target.value; store.set('space', project); selected = null; render();
});

// ---------- the model: everything in flight, as cards with one state each
//   needs     blocked on the user
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
      where: (tt => `Claude · ${s.repo || 'unknown folder'}${tt && termLabel(tt) !== tt.name ? ' · ' + termLabel(tt) : ''}`)(s.termId && (S.terms || []).find((x) => x.id === s.termId)),
      what: s.state === 'waiting' ? (s.detail || 'Needs you') : s.state === 'finished' ? (s.lastMessage || s.prompt || 'Finished') : (s.prompt || 'Open, nothing asked yet'),
      at: s.updatedAt
    });
  }
  for (const t of (S.remoteTerms || [])) {
    const st = t.state === 'waiting' || t.state === 'finished' ? 'needs' : t.state === 'running' ? 'working' : 'idle';
    cards.push({ type: 'rterm', key: `r:${t.device}:${t.id}`, space: t.space, st, label: t.state === 'finished' ? 'Your turn' : t.state === 'waiting' ? 'Needs you' : STATE_LABEL[st],
      where: `${t.agentName} · ${termLabel(t)} · on ${t.deviceName}`, what: t.state === 'waiting' ? (t.detail || 'Needs you') : (t.prompt || 'Open'), at: t.updatedAt });
  }
  for (const g of runGroups()) {
    const st = g.state === 'failed' ? 'needs' : g.state === 'running' ? 'working' : 'done';
    cards.push({ type: 'run', key: String(g.lead.id), space: g.lead.space, st, label: g.state === 'failed' ? 'Failed' : STATE_LABEL[st], where: g.runs.length > 1 ? `${g.lead.repo} · ${g.runs.length} builds` : `${g.lead.repo} · ${g.lead.workflow}`, what: g.lead.title, at: g.at });
  }
  // Someone in a shared project asked to send to one of your sessions (lib/sessshare.js): it waits for you.
  for (const t of S.terms || []) for (const q of t.queued || []) {
    if (q.held && / asks$/.test(q.source || '')) cards.push({ type: 'rterm', key: t.id, space: t.space, st: 'needs', label: 'Asks to send', where: `${q.source.replace(/ asks$/, '')} · ${t.name}`, what: q.text, at: q.created_at });
  }
  for (const p of S.reviews) cards.push({ type: 'review', key: String(p.id), space: p.space, st: 'needs', label: 'Review', where: `${p.repo} #${p.number}`, what: p.title, at: p.updatedAt });
  for (const i of S.items) {
    if ((i.kind === 'reminder' || i.kind === 'todo') && i.due_at && i.due_at <= now) {
      cards.push({ type: 'item', key: String(i.id), space: i.space, st: 'needs', label: i.kind === 'reminder' ? 'Reminder' : 'To-do', where: 'Due ' + when(i.due_at), what: i.text, at: i.due_at });
    }
  }
  cards.push(...deliveryCards(), ...routineCards(), ...checkCards(), ...taskCards());
  for (const v of S.money.invoices) cards.push({ type: 'invoice', key: String(v.id), space: v.space, st: 'others', label: 'Invoice out', where: `${$$(v.amount)} · sent ${since(v.created_at)}`, what: v.text, at: v.created_at });
  for (const a of S.awaiting) cards.push({ type: 'awaiting', key: a.key, space: a.space, st: 'others', label: 'No reply yet', where: `Emailed ${a.who} · ${since(a.date)}`, what: a.subject, at: a.date });
  return cards;
}

function needsCount(space = 'all') {
  // An invitation to a shared project (public/js/share.js) waits for you too.
  return flight().filter((c) => c.st === 'needs' && (space === 'all' || c.space === space)).length + (space === 'all' ? (S?.share?.invites?.length || 0) : 0);
}
function inboxCount(space = 'all') {
  return S.threads.filter((t) => space === 'all' || t.space === space).length;
}

// ---------- shell: rail, status, header pill
// [id, name, parent]: a page with a parent is one of that page's tabs, not on
// the rail. Sessions has tabs for builds and browser checks; more kinds of
// session (a plain chat with your account, a desktop worker) slot in here later.
// On the web board (public/js/web/): Now, Sessions (your shared projects' sessions, websessions.js), Builds and
// Browser checks, Calendar and Money (what your shared projects share), Inbox (your own Teams and Outlook), Notes.
const PAGES = [['deck', 'Deck'], ['now', 'Now'], ['sessions', 'Sessions'], ['builds', 'Builds', 'sessions'], ['checks', 'Browser checks', 'sessions'], ['calendar', 'Calendar'], ['inbox', 'Inbox'], ['money', 'Money'], ['notes', 'Notes'], ['unsorted', 'Unsorted', 'unsorted']]
  .filter(([id]) => !window.WEB || ['deck', 'now', 'sessions', 'builds', 'checks', 'calendar', 'inbox', 'money', 'notes'].includes(id));
const PAGE_MOVED = { actions: 'builds' };   // old links keep working
// Pages with no place on the rail: opened from another page, which stays lit
// on the rail while they show. Calendar opens from Now's Today line (Nov 4).
const OFF_RAIL = { calendar: 'now' };
if (PAGE_MOVED[location.hash.slice(1)]) history.replaceState(null, '', '#' + PAGE_MOVED[location.hash.slice(1)]);
const railOf = (id) => PAGES.find((p) => p[0] === id)?.[2] || OFF_RAIL[id] || id;
// The tabs along the top of a page that has them (Sessions · Builds · Browser checks).
function subTabs() {
  const top = railOf(page), tabs = PAGES.filter((p) => p[0] === top || p[2] === top);
  const repos = (S.actions || []).filter(inProject);
  const buildLight = repos.some((a) => a.runs.some((r) => CI_ACTIVE(r.state))) ? 'running' : repos.some((a) => a.runs[0]?.state === 'failure' && Date.now() - a.runs[0].updatedAt < 2 * 86400e3) ? 'failure' : '';
  const light = { builds: buildLight, checks: checksLight() }, count = { builds: ciActiveCount() };
  return `<nav class="chips tabs sub-tabs" aria-label="${esc(PAGES.find((p) => p[0] === top)[1])}">${tabs.map(([id, name]) => `<a class="chip" href="#${id}" ${page === id ? 'aria-current="page"' : ''}>${esc(name)}${count[id] ? ` <span class="c">${count[id]} running</span>` : light[id] === 'failure' ? ` <span class="c bad">failed</span>` : ''}</a>`).join('')}</nav>`;
}

// A connection's error, in words, for the status tooltip. Most arrive plain already
// (lib/friendly.js); these are the raw ones some connections still send.
function plainConnError(name, e) {
  const t = String(e || '');
  if (/gh api failed|gh auth|not logged in|gh: command not found|gh is not/i.test(t)) return 'GitHub isn\'t signed in on this computer. Open Sessions, Builds and press Sign in to GitHub.';
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|network|fetch failed/i.test(t)) return `Couldn't reach ${name}. Check the internet connection; it tries again by itself.`;
  if (/\b401\b|unauthori[sz]ed|invalid credentials|invalid_grant/i.test(t)) return `${name} asked to sign in again. Open Settings and connect it again.`;
  return t;
}

function renderShell() {
  const counts = { now: needsCount(project), sessions: (S.terms || []).filter((t) => t.state === 'waiting' || t.state === 'finished').length, inbox: inboxCount(project), money: '', notes: '' };
  const light = { sessions: ciLight() };   // builds and browser checks live under Sessions
  $('pages').innerHTML = PAGES.filter((p) => !p[2] && !OFF_RAIL[p[0]]).map(([id, name]) => `<a class="page-link" href="#${id}" ${railOf(page) === id ? 'aria-current="page"' : ''}>${name}${light[id] ? ciDot(light[id]) : ''}<span class="n">${counts[id] || ''}</span></a>`).join('');
  // Projects open their own page; the count is what needs you there.
  const groups = [...new Set(S.spaces.map((s) => s.group || 'Mine'))];
  let html = groups.length > 1 ? '' : '<h3>Projects</h3>';
  for (const g of groups) {
    if (groups.length > 1) html += `<h3>${esc(g)}</h3>`;
    for (const s of S.spaces.filter((x) => (x.group || 'Mine') === g)) {
      html += `<a class="space" href="#project/${esc(s.id)}" ${page === 'project' && openProject === s.id ? 'aria-current="page"' : ''}><span class="dot" style="background:${safeColor(s.color)}"></span><span class="nm" title="${esc(s.name)}">${esc(s.name)}</span><span class="n">${needsCount(s.id) || ''}</span></a>`;
    }
  }
  // Unsorted: what has no project yet (public/js/unsorted.js); the count is how many.
  html += `<a class="space space--unsorted" href="#unsorted" ${page === 'unsorted' ? 'aria-current="page"' : ''}>Unsorted<span class="n">${S.unsorted || ''}</span></a>`;
  $('projects').innerHTML = html;
  updateWhatsNew();

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
  el.title = broken.map(([n, e]) => n + (e ? ': ' + plainConnError(n, e) : '')).join('\n');

  const v = S.version || {};
  $('update-btn').hidden = !v.behind;
  if (v.behind) {
    const subj = v.subjects || [];
    $('update-btn').title = 'A new version of Switchboard is ready. Click to update.'
      + (subj.length ? '\nWhat changed: ' + subj.slice(0, 4).join(' · ') + (subj.length > 4 ? ` · and ${subj.length - 4} more` : '') : '');
  }
  // The server has a new page: load it, but never in the middle of a thought.
  // While you type it waits, and says so once, with a button to load it now (drafts are kept either way).
  if (v.build && bootSha && v.build !== bootSha) {
    if (!busyTyping()) { saveDrafts(); location.reload(); }
    else if (newPageSaid !== v.build) { newPageSaid = v.build; toast('Switchboard was updated. The new version loads when you stop typing.', { action: { label: 'Load it now', run: () => { saveDrafts(); location.reload(); } }, ms: 20000 }); }
  }
  if (v.build && !bootSha) bootSha = v.build;
  const n = needsCount();
  $('needs-n').textContent = n;
  $('needs').classList.toggle('zero', n === 0);
  document.title = n ? `(${n}) Switchboard` : 'Switchboard';
  document.documentElement.dataset.board = n ? 'needs' : 'clear';   // the lamp in the mark (css/brand.css)
}

// ---------- shared row
function row({ type, key, space, title, sub, right, via, bold, cls = '' }) {
  return `<button class="item ${bold ? 'bold' : ''} ${isSel(type, key) ? 'sel' : ''} ${cls}" type="button" data-type="${type}" data-key="${esc(key)}">${tag(space)}
    <span><span class="t">${esc(title)}</span><br><span class="s">${via ? `<span class="via">${esc(via)}</span>` : ''}${esc(sub || '')}</span></span>
    <span class="r">${right || ''}</span></button>`;
}
const isSel = (type, key) => selected && selected.type === type && selected.key === key;
const empty = (t) => `<p class="empty">${t}</p>`;
