// The Notes page: the notebook (pages, in your projects, with #tags), quick
// notes, reminders and to-dos, and routines, as tabs. Plus
// Send to session: a page or a quick note into a session's message bar.
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

function notesHead() { return `<div class="page-head"><h1>Notes</h1>${notesTabs()}<span class="grow"></span>${projectPicker()}</div>`; }
function notesTabs() {
  const n = {
    pages: (S.pages || []).filter(inProject).length,
    quick: S.items.filter((i) => i.kind === 'note').filter(inProject).length,
    tasks: S.items.filter((i) => i.kind === 'reminder' || i.kind === 'todo').filter(inProject).length,
    routines: (S.routines || []).filter(inProject).length
  };
  return `<div class="chips tabs" id="notes-tabs">${[['pages', 'Pages'], ['quick', 'Quick notes'], ['tasks', 'Reminders and to-dos'], ['routines', 'Routines']]
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
    <aside class="nb-side card"><div class="nb-tools"><label for="nb-q" class="sr">Search pages</label><input id="nb-q" type="search" placeholder="Search pages" value="${esc(keepQ)}" autocomplete="off"><button class="btn btn--primary" type="button" data-nb-new>New page</button></div>
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
      <button class="btn btn--quiet" type="button" id="ed-pin" aria-pressed="${!!p.pinned}">${p.pinned ? 'Pinned' : 'Pin'}</button>
      <button class="btn btn--quiet" type="button" id="ed-send" title="${SEND_TITLE}">Send to session</button><span id="ed-saved" class="small muted" aria-live="polite"></span><span class="grow"></span>
      <button class="btn btn--quiet" type="button" id="ed-del">Delete</button></div></div><div class="ed-body" id="ed-body"></div>`;
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
    catch (err) { toast(err.message, { kind: 'error' }); }
    return;
  }
  if (e.target.closest('#ed-send') && editor) { sendPick({ title: $('ed-title').value.trim() || 'Untitled', text: pageText(editor.html()), parts: edSendParts }); edSendParts = null; return; }
  const sn = e.target.closest('[data-send-note]');
  if (sn) { const i = S.items.find((x) => String(x.id) === sn.dataset.sendNote); if (i) sendPick({ title: '', text: i.text }); return; }
  if (e.target.closest('#ed-pin')) { const on = $('ed-pin').getAttribute('aria-pressed') !== 'true'; $('ed-pin').setAttribute('aria-pressed', on); $('ed-pin').textContent = on ? 'Pinned' : 'Pin'; savePage({ pinned: on }); return; }
  if (e.target.closest('#ed-del')) {
    if (!delArmed) { delArmed = true; $('ed-del').textContent = 'Delete this page?'; $('ed-del').classList.add('btn--danger'); return; }
    const uid = edUid; editor = null; edUid = null;
    try { await api(`/api/pages/${uid}/delete`, {}); openUid = null; toast('Page deleted.'); await load(); } catch (err) { toast(err.message, { kind: 'error' }); }
  }
});

// ---- the other tabs: quick notes, reminders and to-dos, routines
function renderNoteLists() {
  const now = Date.now();
  const keep = document.activeElement?.id === 'notes-input' ? $('notes-input').value : '';
  const add = `<form class="inline-add" id="notes-add"><label for="notes-input" class="sr">Add</label><input id="notes-input" type="text" placeholder="remind fri 9am call the bank · feed the animals every day at 6am · or just a note" autocomplete="off"><button class="mic" type="button" data-mic="notes-input" title="Talk to type"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg><span class="sr">Dictate</span></button><button class="btn btn--primary" type="submit">Add</button></form>`;
  let body = '';
  if (notesTab === 'quick') {
    const notes = S.items.filter((i) => i.kind === 'note').filter(inProject).sort((a, b) => b.created_at - a.created_at);
    body = `<section class="card"><div class="list qn-list">${notes.map((i) => `<div class="qn">${row({ type: 'item', key: String(i.id), space: i.space, title: i.text, sub: when(i.created_at) })}<button class="btn btn--quiet btn--sm qn-send" type="button" data-send-note="${i.id}" title="${SEND_TITLE}">Send to session</button></div>`).join('') || empty('Anything typed in Ctrl K that is not a reminder, a to-do or money lands here.')}</div></section>`;
  } else if (notesTab === 'tasks') {
    const tasks = S.items.filter((i) => i.kind === 'reminder' || i.kind === 'todo').filter(inProject);
    const done = S.recentDone.filter(inProject);
    body = `<section class="card"><div class="list">${tasks.map((i) => row({ type: 'item', key: String(i.id), space: i.space, title: i.text, via: i.kind === 'reminder' ? 'Reminder' : 'To-do', sub: i.due_at ? when(i.due_at) : 'No date', right: i.due_at && i.due_at <= now ? '<span class="mono late">due</span>' : '' })).join('') || empty('Nothing scheduled.')}</div></section>
      ${done.length ? `<section class="card"><h2>Done, last 3 days</h2><div class="list">${done.map((i) => row({ type: 'done', key: String(i.id), space: i.space, title: i.text, sub: 'Done ' + when(i.done_at) })).join('')}</div></section>` : ''}`;
  } else body = routinesCard();
  $('page').innerHTML = notesHead() + add + body;
  if (keep) { $('notes-input').value = keep; $('notes-input').focus(); }
}

// ---- Send to session: a page, part of one, or a quick note into a session.
// The dialog shows exactly what goes (and it can be edited there); Send puts
// it in now if the session is free, or queues it until it is. "Edit in the
// message bar" is for when it needs more than a line of instruction.
const SEND_TITLE = 'Send this page, the selected text, or the line you are on to a session.';
const SEND_PROMPTS = ['Just the notes', 'Summarise these notes into to-dos', 'Turn this into a plan'];
let sendTo = null;      // { title, parts: { sel, line, page }, part, text, key, prompt } while the picker is open
let edSendParts = null; // what was selected on the page, read before the button takes focus

// A page as plain text an agent can read: headings marked, bullets and boxes
// as lines, a nested list indented.
function pageText(html) {
  const root = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html').body;
  root.querySelectorAll('br').forEach((b) => b.replaceWith('\n'));
  const own = (el) => [...el.childNodes].filter((n) => !(n.nodeType === 1 && /^(UL|OL)$/.test(n.tagName))).map((n) => n.textContent).join('').replace(/[ \t\u00a0]+/g, ' ').trim();
  const lines = [];
  (function walk(el, depth) {
    for (const n of el.children) {
      const t = n.tagName;
      if (t === 'UL' || t === 'OL') {
        let i = 0;
        for (const li of n.children) {
          const mark = t === 'OL' ? `${++i}. ` : n.classList.contains('checklist') ? (li.dataset.checked === 'true' ? '- [x] ' : '- [ ] ') : '- ';
          lines.push('  '.repeat(depth) + mark + own(li));
          walk(li, depth + 1);
        }
      }
      else if (/^H[1-3]$/.test(t)) lines.push('#'.repeat(+t[1]) + ' ' + own(n));
      else if (t === 'BLOCKQUOTE') lines.push('> ' + own(n));
      else if (t === 'HR') lines.push('---');
      else lines.push(own(n));
    }
  })(root, 0);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// The selection on the page and the line the caret is on, as text. Read on
// mousedown of Send to session, while the selection is still the page's.
function pageParts() {
  const body = $('ed-body'), s = getSelection();
  if (!body || !s.rangeCount || !body.contains(s.getRangeAt(0).commonAncestorContainer)) return null;
  const r = s.getRangeAt(0), out = {};
  if (!r.collapsed) {
    const box = document.createElement('div');
    box.appendChild(r.cloneContents());
    // A selection inside one line comes out as bare text; keep it as one line.
    out.sel = (box.querySelector('p, h1, h2, h3, li, blockquote, ul, ol') ? pageText(box.innerHTML) : box.textContent.replace(/\s+/g, ' ')).trim();
  }
  let n = r.startContainer; if (n.nodeType === 3) n = n.parentElement;
  const line = n?.closest?.('li, p, h1, h2, h3, blockquote');
  if (line && body.contains(line)) {
    // A bullet keeps its kind (and the bullets under it) by sending its own list around it.
    const list = line.tagName === 'LI' ? line.parentElement : null;
    const html = list ? `<${list.tagName.toLowerCase()} class="${esc(list.className)}">${line.outerHTML}</${list.tagName.toLowerCase()}>` : line.outerHTML;
    out.line = pageText(html);
  }
  return out.sel || out.line ? out : null;
}
document.addEventListener('mousedown', (e) => { if (e.target.closest('#ed-send')) edSendParts = pageParts(); });

const SEND_PARTS = [['sel', 'Selected text'], ['line', 'The line you are on'], ['page', 'Whole page']];
function sendPick({ title, text, parts }) {
  const terms = allTerms();
  if (!terms.length) { toast('No session is open. Start one on Sessions first.'); return; }
  if (!text.trim()) { toast('Nothing on this page yet.'); return; }
  let scrim = $('send-scrim');
  if (!scrim) {
    scrim = document.createElement('div');
    scrim.id = 'send-scrim'; scrim.className = 'scrim';
    scrim.setAttribute('role', 'dialog'); scrim.setAttribute('aria-modal', 'true'); scrim.setAttribute('aria-label', 'Send to a session');
    document.body.appendChild(scrim);
  }
  const key = terms.length === 1 ? terms[0].key : terms.some((t) => t.key === currentTerm) ? currentTerm : null;
  const all = { ...(title ? parts || {} : {}), page: text };
  const part = all.sel ? 'sel' : 'page';
  sendTo = { title, parts: all, part, text: all[part], key, prompt: '' };
  drawSendPick(terms);
  openDialog('send-scrim');
  $('send-text').focus();
}
function drawSendPick(terms = allTerms()) {
  const one = terms.length === 1;
  const what = sendTo.title ? `from “${esc(sendTo.title)}”` : 'this note';
  const offered = SEND_PARTS.filter(([k]) => sendTo.parts[k]);
  $('send-scrim').innerHTML = `<div class="palette send-pal">
    <h2>Send to a session</h2>
    <p class="send-why">Sends ${what} to ${one ? `<b>${esc(termLabel(terms[0]))}</b>` : 'the session you pick'}. If it is busy, it waits in the queue and goes in when it is free.</p>
    ${one ? '' : `<div class="send-terms" role="radiogroup" aria-label="Session">${terms.map((t) => `<button type="button" class="send-term" role="radio" data-send-term="${esc(t.key)}" aria-checked="${t.key === sendTo.key}">${tag(t.space)}<span class="t">${esc(termLabel(t))}</span><span class="s">${esc(t.agentName || '')}${termLabel(t) !== t.name ? ' · ' + esc(t.name) : ''}${t.remote ? ' · on ' + esc(t.deviceName || t.device) : ''} · ${esc(TERM_STATE[t.state] || t.state || '')}</span></button>`).join('')}</div>`}
    ${offered.length > 1 ? `<div class="send-parts" role="radiogroup" aria-label="What to send">${offered.map(([k, l]) => `<button type="button" class="rt-idea" role="radio" data-send-part="${k}" aria-checked="${sendTo.part === k}" aria-pressed="${sendTo.part === k}">${l}</button>`).join('')}</div>` : ''}
    <label for="send-text" class="send-label">What goes <span class="muted">(you can change it here)</span></label>
    <textarea id="send-text" class="send-text" rows="6">${esc(sendTo.text)}</textarea>
    <label for="send-prompt" class="send-label">What to do with it</label>
    <div class="rt-chips send-chips">${SEND_PROMPTS.map((p) => `<button type="button" class="rt-idea" data-send-chip="${esc(p)}" aria-pressed="${(p === 'Just the notes' ? '' : p) === sendTo.prompt}">${esc(p)}</button>`).join('')}</div>
    <input id="send-prompt" type="text" value="${esc(sendTo.prompt)}" placeholder="Nothing: just the notes" autocomplete="off">
    <div class="actions"><button class="btn btn--primary" type="button" data-send-go ${sendTo.key ? '' : 'disabled'}>Send</button><button class="btn" type="button" data-send-edit ${sendTo.key ? '' : 'disabled'}>Edit in the message bar</button><button class="btn btn--quiet" type="button" data-close="send-scrim">Cancel</button></div>
  </div>`;
}
const sendMessage = () => {
  const prompt = $('send-prompt').value.trim(), text = $('send-text').value.trim();
  const head = sendTo.title ? (sendTo.part === 'page' ? sendTo.title : `From my notes, “${sendTo.title}”:`) : '';
  return [prompt, [head, text].filter(Boolean).join('\n')].filter(Boolean).join('\n\n');
};
async function sendToSession(edit) {
  const key = sendTo.key, t = termByKey(key);
  if (!t) { toast('That session is gone.'); return; }
  if (!$('send-text').value.trim()) { toast('Nothing to send.'); return; }
  const msg = sendMessage();
  if (!edit) {
    const btn = $('send-scrim').querySelector('[data-send-go]');
    btn.disabled = true;
    try { await api(termPath(t, 'queue'), { text: msg, source: 'Notebook' }); }
    catch (err) { btn.disabled = false; toast(err.message, { kind: 'error' }); return; }
    closeDialog('send-scrim'); sendTo = null;
    const free = t.state === 'finished' || t.state === 'idle';
    toast(free ? `Sent to ${termLabel(t)}.` : `Queued for ${termLabel(t)}. It goes in when the agent is free.`);
    load().catch(() => {});
    return;
  }
  closeDialog('send-scrim'); sendTo = null;
  currentTerm = key; store.set('term', key);
  if (!inProject(t)) { project = 'all'; store.set('space', project); }
  if (location.hash !== '#sessions') location.hash = '#sessions'; else render();
  // The message bar holds this session's draft once Sessions has drawn with it open (composeFor, sessions.js).
  for (let i = 0; i < 60 && !(page === 'sessions' && composeFor === key && $('q-text')); i++) await new Promise((r) => setTimeout(r, 50));
  await addToComposer(msg);
  growText($('q-text'));
  toast('In the message bar. Nothing is sent until you press Enter there.');
}
document.addEventListener('click', (e) => {
  if (!sendTo || !$('send-scrim')?.classList.contains('open')) return;
  const st = e.target.closest('[data-send-term]');
  if (st) { sendTo.key = st.dataset.sendTerm; document.querySelectorAll('[data-send-term]').forEach((b) => b.setAttribute('aria-checked', b === st)); $('send-scrim').querySelectorAll('[data-send-go], [data-send-edit]').forEach((b) => { b.disabled = false; }); return; }
  const sp = e.target.closest('[data-send-part]');
  if (sp) { sendTo.part = sp.dataset.sendPart; sendTo.text = sendTo.parts[sendTo.part]; $('send-text').value = sendTo.text; document.querySelectorAll('[data-send-part]').forEach((b) => { b.setAttribute('aria-checked', b === sp); b.setAttribute('aria-pressed', b === sp); }); return; }
  const ch = e.target.closest('[data-send-chip]');
  if (ch) { const p = ch.dataset.sendChip === 'Just the notes' ? '' : ch.dataset.sendChip; sendTo.prompt = p; $('send-prompt').value = p; document.querySelectorAll('[data-send-chip]').forEach((b) => b.setAttribute('aria-pressed', b === ch)); $('send-prompt').focus(); return; }
  if (e.target.closest('[data-send-go]')) sendToSession(false);
  if (e.target.closest('[data-send-edit]')) sendToSession(true);
});
document.addEventListener('keydown', (e) => {
  if (e.target.id === 'send-prompt' && e.key === 'Enter' && sendTo?.key) { e.preventDefault(); sendToSession(false); }
});
document.addEventListener('input', (e) => {
  if (!sendTo) return;
  if (e.target.id === 'send-text') sendTo.text = e.target.value;
  if (e.target.id === 'send-prompt') { sendTo.prompt = e.target.value.trim(); document.querySelectorAll('[data-send-chip]').forEach((b) => b.setAttribute('aria-pressed', (b.dataset.sendChip === 'Just the notes' ? '' : b.dataset.sendChip) === sendTo.prompt)); }
});

