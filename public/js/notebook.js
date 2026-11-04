// The Notes page: the notebook (pages, in your projects, with #tags), quick
// notes, reminders and to-dos, and routines, as tabs. Plus search in Ctrl K.
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
let notesTab = store.get('notesTab', 'pages');
let openUid = store.get('page', null);
let editor = null, edUid = null, edLoaded = 0, edLine = null;
let nbQuery = '', nbTag = null, nbResults = null, nbTimer = null, delArmed = false;

const TEMPLATES = [
  ['Shopping list', 'Shopping', '<ul class="checklist"><li data-checked="false"><br></li></ul>'],
  ['Packing list', 'Packing', '<h2>Clothes</h2><ul class="checklist"><li data-checked="false"><br></li></ul><h2>Toiletries</h2><ul class="checklist"><li data-checked="false"><br></li></ul><h2>Other</h2><ul class="checklist"><li data-checked="false"><br></li></ul>'],
  ['Meeting notes', 'Meeting', '<h2>Who</h2><ul><li><br></li></ul><h2>Notes</h2><p><br></p><h2>To do</h2><ul class="checklist"><li data-checked="false"><br></li></ul>'],
  ['Recipe', 'Recipe', '<p>#recipes</p><h2>Ingredients</h2><ul><li><br></li></ul><h2>Steps</h2><ol><li><br></li></ol>'],
  ['A log', 'Eggs log', '<p>Each line is one entry. Add with the box above, or from Ctrl K: "log eggs 14".</p><ul class="log"></ul>']
];

function notesHead() { return `<div class="page-head"><h1>Notes</h1>${notesTabs()}</div>`; }
function notesTabs() {
  const n = {
    pages: (S.pages || []).filter(inProject).length,
    quick: S.items.filter((i) => i.kind === 'note').filter(inProject).length,
    tasks: S.items.filter((i) => i.kind === 'reminder' || i.kind === 'todo').filter(inProject).length,
    routines: (S.routines || []).filter(inProject).length
  };
  return `<div class="chips" id="notes-tabs">${[['pages', 'Pages'], ['quick', 'Quick notes'], ['tasks', 'Reminders and to-dos'], ['routines', 'Routines']]
    .map(([k, l]) => `<button class="chip" type="button" data-notes-tab="${k}" aria-pressed="${notesTab === k}">${l} <span class="c">${n[k] || ''}</span></button>`).join('')}</div>`;
}

function renderNotes() {
  document.body.classList.toggle('nb-writing', notesTab === 'pages');
  if (notesTab !== 'pages') { leaveEditor(); return renderNoteLists(); }
  // Already showing this page: refresh the list and leave the editor (and the caret) alone.
  if ($('nb-main') && editor && edUid === openUid && $('page').contains($('nb-main'))) {
    $('notes-tabs').outerHTML = notesTabs();
    $('nb-list').innerHTML = listHtml(); $('nb-tags').innerHTML = tagsHtml();
    const meta = (S.pages || []).find((p) => p.uid === edUid);
    if (!meta) { openUid = null; editor = null; return renderNotes(); }
    if (meta.updated_at > edLoaded && !editor.focused() && document.activeElement?.id !== 'ed-title') reloadPage();
    return;
  }
  leaveEditor();
  const keepQ = nbQuery;
  $('page').innerHTML = notesHead() + `<div class="nb">
    <aside class="nb-side card"><div class="nb-tools"><label for="nb-q" class="sr">Search pages</label><input id="nb-q" type="search" placeholder="Search pages" value="${esc(keepQ)}" autocomplete="off"><button class="btn go" type="button" data-nb-new>New page</button></div>
      <div id="nb-tags" class="nb-tags">${tagsHtml()}</div><div id="nb-list" class="nb-list">${listHtml()}</div></aside>
    <section class="nb-main card" id="nb-main"></section></div>`;
  mountPage();
}

const visiblePages = () => (S.pages || []).filter(inProject).filter((p) => !nbTag || p.tags.includes(nbTag));
function tagsHtml() {
  const tags = [...new Set((S.pages || []).filter(inProject).flatMap((p) => p.tags))].sort();
  return tags.map((t) => `<button class="nb-tag" type="button" data-nb-tag="${esc(t)}" aria-pressed="${nbTag === t}">#${esc(t)}</button>`).join('');
}
function listHtml() {
  let list = visiblePages();
  const lines = new Map();
  if (nbQuery && nbResults) { const hits = nbResults.filter((r) => r.type === 'page'); list = hits.map((r) => list.find((p) => p.uid === r.uid)).filter(Boolean); hits.forEach((r) => lines.set(r.uid, r.line)); }
  if (!list.length) return nbQuery ? empty('No page has that.') : nbTag ? empty('No page here has that tag.') : empty('No pages here yet.');
  return list.map((p) => `<button class="nb-item ${p.uid === openUid ? 'on' : ''}" type="button" data-nb-page="${p.uid}">${tag(p.space)}<span class="nb-t">${p.pinned ? '<span class="nb-pin" title="Pinned">•</span> ' : ''}${esc(p.title || 'Untitled')}</span>
    <span class="nb-s">${esc(lines.get(p.uid) || p.preview || 'Empty')}</span><span class="nb-m mono">${p.checks.total ? `${p.checks.done}/${p.checks.total} · ` : ''}${ago(p.updated_at)}</span></button>`).join('');
}

// ---- the open page
let mountSeq = 0;
async function mountPage() {
  const seq = ++mountSeq;
  let main = $('nb-main');
  const list = visiblePages();
  if (!openUid || !(S.pages || []).some((p) => p.uid === openUid)) openUid = list[0]?.uid || null;
  if (!openUid) { main.innerHTML = `<div class="nb-blank"><h2>Your notebook</h2><p class="muted">Make a page, or start from one of these. Type <b>-</b> for a list, <b>[]</b> for a checkbox, <b>#</b> for a heading; #words anywhere become tags.</p><div class="rt-chips">${TEMPLATES.map(([l], i) => `<button class="rt-idea" type="button" data-nb-tpl="${i}">${esc(l)}</button>`).join('')}<button class="rt-idea" type="button" data-nb-new>Blank page</button></div></div>`; return; }
  store.set('page', openUid);
  const uid = openUid;
  let p;
  try { p = await api('/api/pages/' + uid); } catch (err) { main.innerHTML = `<p class="note-line">${esc(err.message)}</p>`; return; }
  // Only the latest load counts (the board can redraw twice while this one waits).
  if (seq !== mountSeq || uid !== openUid || !(main = $('nb-main'))) return;
  main.innerHTML = `<div class="ed-head"><label for="ed-title" class="sr">Title</label><input id="ed-title" class="ed-title" value="${esc(p.title)}" placeholder="Untitled" maxlength="200" autocomplete="off">
    <div class="ed-meta"><label for="ed-space" class="sr">Project</label><select id="ed-space">${S.spaces.map((x) => `<option value="${esc(x.id)}" ${x.id === p.space ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
      <button class="icon-btn" type="button" id="ed-pin" aria-pressed="${!!p.pinned}">${p.pinned ? 'Pinned' : 'Pin'}</button><span id="ed-saved" class="small muted" aria-live="polite"></span><span class="grow"></span>
      <button class="icon-btn" type="button" id="ed-del">Delete</button></div></div><div class="ed-body" id="ed-body"></div>`;
  edUid = uid; edLoaded = p.updated_at; delArmed = false;
  editor = makeEditor($('ed-body'), p.body, { onSave: (body) => savePage({ body }) });
  if (edLine != null) { editor.focusText(edLine); edLine = null; }
  else if (!p.title && !p.body) $('ed-title').focus();
}
async function reloadPage() {
  try {
    const p = await api('/api/pages/' + edUid);
    if (editor && !editor.focused()) { editor.load(p.body); $('ed-title').value = p.title; edLoaded = p.updated_at; }
  } catch {}
}
let saving = Promise.resolve();
function savePage(fields) {
  const uid = edUid;
  if (!uid) return;
  if ($('ed-saved')) $('ed-saved').textContent = 'Saving…';
  saving = saving.then(() => api('/api/pages/' + uid, fields)).then((r) => { if (uid === edUid) { edLoaded = Math.max(edLoaded, r.updated_at); if ($('ed-saved')) $('ed-saved').textContent = 'Saved'; } })
    .catch((err) => { if ($('ed-saved')) { $('ed-saved').textContent = err.message; $('ed-saved').className = 'small bad-text'; } });
  return saving;
}
function leaveEditor() { if (editor) editor.flush(); editor = null; edUid = null; }
function openPage(uid, line = null) {
  leaveEditor(); openUid = uid; edLine = line; notesTab = 'pages'; store.set('notesTab', 'pages');
  if (page !== 'notes') location.hash = '#notes'; else render();
}
window.addEventListener('hashchange', () => { if (location.hash !== '#notes') { leaveEditor(); document.body.classList.remove('nb-writing'); } });
window.addEventListener('beforeunload', () => { if (editor) editor.flush(); });

let titleTimer = null;
document.addEventListener('input', (e) => {
  if (e.target.id === 'ed-title') { clearTimeout(titleTimer); titleTimer = setTimeout(() => savePage({ title: e.target.value }), 450); }
  if (e.target.id === 'nb-q') {
    nbQuery = e.target.value.trim();
    clearTimeout(nbTimer);
    nbTimer = setTimeout(async () => {
      nbResults = nbQuery ? (await api('/api/search?q=' + encodeURIComponent(nbQuery)).catch(() => ({ results: [] }))).results : null;
      if ($('nb-list')) $('nb-list').innerHTML = listHtml();
    }, 150);
  }
});
document.addEventListener('keydown', (e) => {
  if (e.target.id === 'ed-title' && (e.key === 'Enter' || e.key === 'ArrowDown')) { e.preventDefault(); editor?.focusStart(); }
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'ed-space') savePage({ space: e.target.value });
});
document.addEventListener('click', async (e) => {
  const tb = e.target.closest('[data-notes-tab]');
  if (tb) { notesTab = tb.dataset.notesTab; store.set('notesTab', notesTab); selected = null; render(); return; }
  const pg = e.target.closest('[data-nb-page]');
  if (pg) { if (pg.dataset.nbPage !== openUid) { leaveEditor(); openUid = pg.dataset.nbPage; render(); } return; }
  const tg = e.target.closest('[data-nb-tag]');
  if (tg) { nbTag = nbTag === tg.dataset.nbTag ? null : tg.dataset.nbTag; $('nb-tags').innerHTML = tagsHtml(); $('nb-list').innerHTML = listHtml(); return; }
  const nw = e.target.closest('[data-nb-new], [data-nb-tpl]');
  if (nw) {
    const t = nw.dataset.nbTpl != null ? TEMPLATES[+nw.dataset.nbTpl] : null;
    try { const p = await api('/api/pages', { title: t ? t[1] : '', body: t ? t[2] : '', space: project }); await load(); openPage(p.uid); if (t) setTimeout(() => (t[1].endsWith('log') ? $('ls-n') : null)?.focus() ?? editor?.focusStart(), 300); }
    catch (err) { toast(err.message); }
    return;
  }
  if (e.target.closest('#ed-pin')) { const on = $('ed-pin').getAttribute('aria-pressed') !== 'true'; $('ed-pin').setAttribute('aria-pressed', on); $('ed-pin').textContent = on ? 'Pinned' : 'Pin'; savePage({ pinned: on }); return; }
  if (e.target.closest('#ed-del')) {
    if (!delArmed) { delArmed = true; $('ed-del').textContent = 'Delete this page?'; $('ed-del').classList.add('danger'); return; }
    const uid = edUid; editor = null; edUid = null;
    try { await api(`/api/pages/${uid}/delete`, {}); openUid = null; toast('Page deleted.'); await load(); } catch (err) { toast(err.message); }
  }
});

// ---- the other tabs: quick notes, reminders and to-dos, routines
function renderNoteLists() {
  const now = Date.now();
  const keep = document.activeElement?.id === 'notes-input' ? $('notes-input').value : '';
  const add = `<form class="inline-add" id="notes-add"><label for="notes-input" class="sr">Add</label><input id="notes-input" type="text" placeholder="remind fri 9am call the bank · feed the animals every day at 6am · or just a note" autocomplete="off"><button class="btn go" type="submit">Add</button></form>`;
  let body = '';
  if (notesTab === 'quick') {
    const notes = S.items.filter((i) => i.kind === 'note').filter(inProject).sort((a, b) => b.created_at - a.created_at);
    body = `<section class="card"><div class="list">${notes.map((i) => row({ type: 'item', key: String(i.id), space: i.space, title: i.text, sub: when(i.created_at) })).join('') || empty('Anything typed in Ctrl K that is not a reminder, a to-do or money lands here.')}</div></section>`;
  } else if (notesTab === 'tasks') {
    const tasks = S.items.filter((i) => i.kind === 'reminder' || i.kind === 'todo').filter(inProject);
    const done = S.recentDone.filter(inProject);
    body = `<section class="card"><div class="list">${tasks.map((i) => row({ type: 'item', key: String(i.id), space: i.space, title: i.text, via: i.kind === 'reminder' ? 'Reminder' : 'To-do', sub: i.due_at ? when(i.due_at) : 'No date', right: i.due_at && i.due_at <= now ? '<span class="mono late">due</span>' : '' })).join('') || empty('Nothing scheduled.')}</div></section>
      ${done.length ? `<section class="card"><h2>Done, last 3 days</h2><div class="list">${done.map((i) => row({ type: 'done', key: String(i.id), space: i.space, title: i.text, sub: 'Done ' + when(i.done_at) })).join('')}</div></section>` : ''}`;
  } else body = routinesCard();
  $('page').innerHTML = notesHead() + add + body;
  if (keep) { $('notes-input').value = keep; $('notes-input').focus(); }
}

// ---- Ctrl K: search everything as you type; Enter still adds what was typed unless a result is picked
let cmdHits = [], cmdSel = -1, cmdTimer = null;
function drawCmdResults() {
  const host = $('cmd-results');
  if (!host) return;
  const label = { page: 'Page', note: 'Note', todo: 'To-do', reminder: 'Reminder', routine: 'Routine' };
  host.innerHTML = cmdHits.map((r, i) => `<li><button type="button" class="cmd-hit ${i === cmdSel ? 'sel' : ''}" data-cmd-hit="${i}">${tag(r.space)}<span class="k">${label[r.type] || ''}</span><span class="t">${esc(r.title)}${r.line && r.line !== r.title ? `<span class="muted"> · ${esc(r.line)}</span>` : ''}</span></button></li>`).join('');
  host.hidden = !cmdHits.length;
}
function cmdOpen(r) {
  $('cmd-scrim').classList.remove('open');
  if (r.type === 'page') return openPage(r.uid, r.line && r.line !== r.title ? r.line : null);
  notesTab = r.type === 'note' ? 'quick' : r.type === 'routine' ? 'routines' : 'tasks';
  store.set('notesTab', notesTab);
  keepSel = { type: r.type === 'routine' ? 'routine' : 'item', key: String(r.id) };
  if (page !== 'notes') location.hash = '#notes'; else { selected = keepSel; keepSel = null; render(); }
}
// nav.js asks this first on Enter: true when a result was picked and opened.
function cmdPick() { if (cmdSel < 0 || !cmdHits[cmdSel]) return false; cmdOpen(cmdHits[cmdSel]); return true; }
$('cmd-input').addEventListener('input', (e) => {
  const q = e.target.value.trim();
  clearTimeout(cmdTimer);
  if (q.length < 2) { cmdHits = []; cmdSel = -1; drawCmdResults(); return; }
  cmdTimer = setTimeout(async () => {
    const r = await api('/api/search?q=' + encodeURIComponent(q)).catch(() => ({ results: [] }));
    if ($('cmd-input').value.trim() !== q) return;
    cmdHits = r.results.slice(0, 8); cmdSel = -1; drawCmdResults();
  }, 120);
});
$('cmd-input').addEventListener('keydown', (e) => {
  if (!cmdHits.length || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
  e.preventDefault();
  cmdSel = e.key === 'ArrowDown' ? Math.min(cmdHits.length - 1, cmdSel + 1) : Math.max(-1, cmdSel - 1);
  drawCmdResults();
});
document.addEventListener('click', (e) => { const h = e.target.closest('[data-cmd-hit]'); if (h) cmdOpen(cmdHits[+h.dataset.cmdHit]); });
