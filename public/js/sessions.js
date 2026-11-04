// The Sessions page: live terminals, the message bar and its queue, and images pasted into it.
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
// ---------- Sessions page
// Sessions on this computer use their tmux name as key; sessions on another of
// your computers use "r:<device>:<name>" and go through the relay.
function allTerms() {
  return [...(S.terms || []).map((t) => ({ ...t, key: t.id })),
    ...(S.remoteTerms || []).map((t) => ({ ...t, key: `r:${t.device}:${t.id}` }))];
}
const termByKey = (k) => allTerms().find((t) => t.key === k);
const termPath = (t, act) => t.remote ? `/api/remote/${t.device}/${encodeURIComponent(t.id)}/${act}` : `/api/terms/${encodeURIComponent(t.id)}/${act}`;

function openTerm(id) {
  currentTerm = id; store.set('term', id);
  if (location.hash !== '#sessions') location.hash = '#sessions'; else render();
}

function renderSessions() {
  const terms = allTerms();
  if (currentTerm && !terms.some((t) => t.key === currentTerm)) currentTerm = terms[0]?.key || null;
  if (!currentTerm && terms[0]) currentTerm = terms[0].key;
  const label = (st) => ({ running: 'Working', waiting: 'Needs you', finished: 'Your turn', idle: 'Ready', starting: 'Starting' }[st] || st);
  const tab = (t) => {
    const branch = t.ci?.branch && !['main', 'master'].includes(t.ci.branch) ? t.ci.branch : '';
    return `<button class="term-tab" type="button" data-term="${esc(t.key)}" aria-pressed="${t.key === currentTerm}" title="${esc([t.name, TERM_STATE[t.state] || t.state, t.agentName, t.cwd].filter(Boolean).join(' · '))}${t.remote ? '' : ' · double-click to rename'}"><span class="st ${esc(t.state)}"></span>${esc(t.name)}<span class="meta">${[branch ? '⎇ ' + esc(branch) : '', t.agent !== 'claude' ? esc(t.agentName) : '', t.remote ? 'on ' + esc(t.deviceName) : '', label(t.state)].filter(Boolean).join(' · ')}</span>${t.queued.length ? `<span class="q">${t.queued.length} queued</span>` : ''}${sessionCiDot(t)}</button>`;
  };
  // Sessions grouped under the repo they work in (worktrees and clones of one
  // repo together), like a project tree.
  const groups = new Map();
  for (const t of terms) {
    const g = t.ci?.fullName?.split('/')[1] || (t.cwd || '').split(/[\\/]/).filter(Boolean).pop() || t.name;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(t);
  }
  let html = `<div class="sessions-head"><h1 class="page-title">Sessions</h1>${subTabs()}</div>
    <div class="sessions-head sessions-row"><div class="term-tabs">${[...groups].map(([g, list]) => `<div class="term-group" role="group" aria-label="${esc(g)}"><span class="g-name">${esc(g)}${list.length > 1 ? ` <span class="g-n">${list.length}</span>` : ''}</span><div class="g-tabs">${list.map(tab).join('')}</div></div>`).join('')}</div>
    <button class="btn go" type="button" id="new-term">New session</button></div>`;
  if (!terms.length) html += `<section class="card"><p class="empty">No sessions yet. Start one here; sessions on your other computers show up here too when they are on and signed in.</p></section>`;
  $('page').innerHTML = html;
}

// The console's look: JetBrains Mono, and the sixteen terminal colours tuned to
// the counter (ink background, signal-orange cursor), soft enough to read all day.
const TERM_FONT = '"JetBrains Mono", "DejaVu Sans Mono", "Ubuntu Mono", ui-monospace, Menlo, Consolas, monospace';
const TERM_THEME = {
  background: '#121418', foreground: '#E4E6E9', cursor: '#FF4F00', cursorAccent: '#121418',
  selectionBackground: 'rgba(255, 79, 0, 0.30)', selectionInactiveBackground: 'rgba(255, 255, 255, 0.12)',
  scrollbarSliderBackground: 'rgba(255, 255, 255, 0.10)', scrollbarSliderHoverBackground: 'rgba(255, 255, 255, 0.18)', scrollbarSliderActiveBackground: 'rgba(255, 79, 0, 0.45)',
  black: '#1D2027', red: '#EF6F68', green: '#5FC98E', yellow: '#E6B657', blue: '#78A5DE', magenta: '#C395E6', cyan: '#57C3CD', white: '#C8CBD0',
  brightBlack: '#626873', brightRed: '#FF8B82', brightGreen: '#80DEA9', brightYellow: '#FFD07A', brightBlue: '#9BC1F1', brightMagenta: '#DBB2F4', brightCyan: '#80D9E2', brightWhite: '#FCFCFA'
};
const TERM_STATE = { running: 'Working', waiting: 'Needs you', finished: 'Your turn', idle: 'Ready', starting: 'Starting' };

// The bar over the terminal: what it is, how long it has been doing it, and the
// controls a terminal window would have.
function renderTermBar() {
  const t = termByKey(currentTerm), el = $('term-bar');
  if (!t || !el) return;
  const branch = t.ci?.branch || '';
  const size = Number(S?.prefs?.termSize) || 13.5;
  const html = `<div class="tb-id"><span class="tb-dot ${esc(t.state)}"></span><b class="tb-name">${esc(t.name)}</b>
      <span class="tb-state ${esc(t.state)}">${esc(TERM_STATE[t.state] || t.state)}${t.updatedAt ? ` · <span data-tick="${t.updatedAt}">${dur(Date.now() - t.updatedAt)}</span>` : ''}</span></div>
    <div class="tb-meta">
      <span class="tb-chip">${esc(t.agentName)}</span>
      ${devChips(t)}
      ${branch ? `<span class="tb-chip mono" title="Branch">⎇ ${esc(branch)}</span>` : ''}
      ${sessionCiDot(t) ? `<span class="tb-chip" title="Newest build on this branch">${sessionCiDot(t)} build</span>` : ''}
      ${t.queued.length ? `<span class="tb-chip hot">${t.queued.length} queued</span>` : ''}
      ${t.remote ? `<span class="tb-chip">on ${esc(t.deviceName)}</span>` : ''}
      <span class="tb-path mono" title="${esc(t.cwd || '')}">${esc((t.cwd || '').replace(/^\/home\/[^/]+|^\/Users\/[^/]+|^[A-Za-z]:\\Users\\[^\\]+/, '~'))}</span></div>
    <div class="tb-actions">
      ${chatToggle(t)}
      <button class="tb-btn" type="button" data-tsize="-1" title="Smaller text" ${size <= 11 ? 'disabled' : ''}>A−</button>
      <button class="tb-btn" type="button" data-tsize="1" title="Bigger text" ${size >= 18 ? 'disabled' : ''}>A+</button>
      <button class="tb-btn" type="button" data-tcopy title="Copy what is selected">Copy</button>
      <button class="tb-btn stop" type="button" data-qact="interrupt" title="Stop what the agent is doing (Esc)">Stop</button></div>`;
  if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
}
const TERM_SIZES = [11, 12, 13, 13.5, 14, 15, 16, 18];
document.addEventListener('click', (e) => {
  const z = e.target.closest('[data-tsize]');
  if (z) {
    const cur = Number(S.prefs.termSize) || 13.5, i = TERM_SIZES.indexOf(cur);
    const v = TERM_SIZES[Math.max(0, Math.min(TERM_SIZES.length - 1, (i < 0 ? 3 : i) + Number(z.dataset.tsize)))];
    S.prefs = { ...S.prefs, termSize: v }; applyPrefs(S.prefs); renderTermBar(); chatFont();
    api('/api/settings', { prefs: { termSize: v } }).catch(() => {});
    tv.term?.focus(); return;
  }
  if (e.target.closest('[data-tcopy]')) {
    const sel = chatOn(currentTerm) ? String(getSelection() || '') : tv.term?.getSelection();
    if (!sel) { toast('Select some text first.'); return; }
    navigator.clipboard.writeText(sel).then(() => toast('Copied.'), () => toast('Could not copy.'));
  }
});

let tv = { id: null, term: null, fit: null, ws: null, ro: null };
function closeTerminal() { closeChat(); closeXterm(); }
function closeXterm() {
  if (!tv.term && !tv.ws) return;
  try { tv.ws?.close(); } catch {}
  try { tv.ro?.disconnect(); } catch {}
  if (tv.ro?.front) { window.removeEventListener('focus', tv.ro.front); document.removeEventListener('visibilitychange', tv.ro.front); }
  try { tv.term?.dispose(); } catch {}
  tv = { id: null, term: null, fit: null, ws: null, ro: null };
  $('term-host').innerHTML = '';
}
function syncTerminal() {
  if (!currentTerm) { closeTerminal(); return; }
  // The Chat view (chat.js) replaces the terminal; the terminal's connection
  // closes while it shows, and opens again on Terminal.
  if (chatOn(currentTerm)) { closeXterm(); $('term-host').hidden = true; openChat(currentTerm); return; }
  closeChat();
  $('term-host').hidden = false;
  if (tv.id === currentTerm) return;
  closeXterm();
  const host = $('term-host');
  host.innerHTML = '';
  host.hidden = false;
  const term = new Terminal({ fontFamily: TERM_FONT, fontSize: Number(S?.prefs?.termSize) || 13.5, lineHeight: 1.18, fontWeightBold: 700,
    cursorBlink: true, cursorStyle: 'bar', cursorWidth: 2, scrollback: 10000, allowProposedApi: false, theme: TERM_THEME });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(host);
  termGpu(term);
  try { fit.fit(); } catch {}
  const t0 = termByKey(currentTerm);
  const wsPath = t0?.remote ? `/term/r/${t0.device}/${encodeURIComponent(t0.id)}` : `/term/${encodeURIComponent(currentTerm)}`;
  const ws = new WebSocket(`ws://${location.host}${wsPath}?cols=${term.cols}&rows=${term.rows}`);
  ws.onmessage = (e) => { if (typeof e.data === 'string') term.write(e.data); else e.data.text?.().then((t) => term.write(t)); };
  ws.onclose = () => { if (tv.term === term) term.write('\r\n\x1b[90m[disconnected: the session ended, or Switchboard restarted. Click its tab to reconnect.]\x1b[0m\r\n'); };
  // One session, one size. This view claims it when it is in use (opened,
  // resized, brought to the front, clicked or typed in). When another view
  // holds it, this one shows the same screen at that size, scaled to fit,
  // so nothing is clipped or jumbled on either computer.
  let sizeTimer = null, win = null;
  const scaleToFit = () => {
    const el = term.element, screen = host.querySelector('.xterm-screen');
    if (!el || !screen) return;
    if (!win || holds()) { el.style.transform = ''; return; }
    const cs = getComputedStyle(host);
    const w = host.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const h = host.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const k = Math.min(w / screen.offsetWidth, h / screen.offsetHeight, 1.3);
    el.style.transformOrigin = '0 0';
    el.style.transform = `scale(${k})`;
  };
  // What this view would be on its own, and whether the session is that size.
  const own = () => { try { const d = fit.proposeDimensions(); return d && d.cols > 0 ? { c: d.cols, r: d.rows } : null; } catch { return null; } };
  const holds = () => { const o = own(); return !o || (win && o.c === win.c && o.r === win.r); };
  const claim = () => {
    try { fit.fit(); } catch {}
    win = { c: term.cols, r: term.rows };
    scaleToFit();
    if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'size', c: term.cols, r: term.rows }));
  };
  // JetBrains Mono arrives from the font service a moment after the page: measure again once it has.
  document.fonts?.load(`400 ${term.options.fontSize}px "JetBrains Mono"`).then(() => { if (tv.term === term) { term.options.fontFamily = TERM_FONT; claim(); } }).catch(() => {});
  term.parser.registerOscHandler(7747, (data) => {
    const [c, r] = data.split('x').map(Number);
    if (!(c > 0 && r > 0)) return true;
    win = { c, r };
    if (c !== term.cols || r !== term.rows) term.resize(c, r);
    requestAnimationFrame(scaleToFit);
    return true;
  });
  term.onData((d) => {
    if (!holds()) claim();
    if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'in', d }));
  });
  term.textarea?.addEventListener('focus', () => { host.classList.add('focused'); if (!holds()) claim(); });
  term.textarea?.addEventListener('blur', () => host.classList.remove('focused'));
  const ro = new ResizeObserver(() => { clearTimeout(sizeTimer); sizeTimer = setTimeout(claim, 80); });
  ro.observe(host);
  ws.onopen = claim;
  ro.front = () => { if (!document.hidden) claim(); };
  window.addEventListener('focus', ro.front);
  document.addEventListener('visibilitychange', ro.front);
  ro.claim = claim;
  tv = { id: currentTerm, term, fit, ws, ro };
  setTimeout(() => term.focus(), 50);
}

// The graphics card draws the terminal (xterm's WebGL renderer) when the
// browser has WebGL2 and Settings allow it. If it fails, or the GPU drops the
// context more than once, terminals go back to the normal renderer.
let gpuLosses = 0;
const gpuAvailable = (() => { let v; return () => v ??= (() => { try { const g = document.createElement('canvas').getContext('webgl2'); g?.getExtension('WEBGL_lose_context')?.loseContext(); return !!g; } catch { return false; } })(); })();
function termGpu(term) {
  if (S?.prefs?.termGpu === false || gpuLosses > 1 || typeof WebglAddon === 'undefined' || !gpuAvailable()) return;
  try {
    const gl = new WebglAddon.WebglAddon();
    gl.onContextLoss(() => {
      gpuLosses++;
      try { gl.dispose(); } catch {}
      if (gpuLosses <= 1) setTimeout(() => { if (tv.term === term) termGpu(term); }, 1000);
    });
    term.loadAddon(gl);
    term.gpu = gl;
  } catch { gpuLosses = 2; }
}

function termDetail() {
  const t = termByKey(currentTerm);
  if (!t) return `<div class="kicker">Sessions</div><h2>Claude, inside Switchboard</h2><p class="muted">Start a session and it shows here: type in the terminal like always, or queue messages from this panel so they go in when Claude is free.</p>`;
  const label = { running: 'Working', waiting: 'Needs you', finished: 'Your turn', idle: 'Ready', starting: 'Starting' }[t.state] || t.state;
  return `<div class="kicker">${tag(t.space)}${esc(spaceOf(t.space).name)} · ${esc(t.agentName)} · ${esc(label)}</div>${renaming === t.key ? `<form class="rename-form" id="rename-form"><label for="rename-input" class="sr">Session name</label><input id="rename-input" type="text" maxlength="60" value="${esc(renameVal ?? t.name)}" autocomplete="off"><button class="btn go" type="submit">Save</button><button class="btn" type="button" data-rename-cancel>Cancel</button></form>` : `<h2 class="term-title">${esc(t.name)}${t.remote ? '' : ` <button class="icon-btn" type="button" data-rename="${esc(t.key)}">Rename</button>`}</h2>`}
    <p class="note-line mono">${t.remote ? `On ${esc(t.deviceName)} · ` : ''}${esc(t.cwd)}${t.mode === 'tmux' && !t.remote ? ` · tmux attach -t ${esc(t.id)}` : ''}</p>
    ${t.mode === 'direct' ? `<p class="note-line">This session ends if Switchboard restarts or updates.${S.platform === 'darwin' ? ' Install tmux (brew install tmux) to keep sessions running through restarts.' : ''}</p>` : ''}
    ${(t.links || []).length ? `<div class="section-label">Linked chats</div>${t.links.map((l) => `<div class="queue-item"><span>${esc(l.who || 'Teams chat')}</span><label class="check small"><input type="checkbox" data-auto="${esc(l.chat_key)}" ${l.auto ? 'checked' : ''}> Send new messages automatically</label><div class="row"><button class="btn" type="button" data-unlink="${esc(l.chat_key)}">Unlink</button></div></div>`).join('')}` : ''}
    ${sessionCi(t)}
    ${bringList(t)}
    <div class="actions"><button class="btn" type="button" data-qact="interrupt">Stop (Esc)</button><button class="btn danger" type="button" data-qact="close">End session</button></div>`;
}

// The docked message bar under the terminal. The textarea stays put across
// refreshes (so typing and dictation are never interrupted); its draft follows
// whichever session is open.
let composeFor = null;
function renderTermCompose() {
  const t = termByKey(currentTerm);
  if (!t) return;
  renderTermBar();
  const ta = $('q-text');
  if (composeFor !== t.key) {
    if (composeFor) draft['term:' + composeFor] = ta.value;
    ta.value = draft['term:' + t.key] || '';
    composeFor = t.key;
    growText(ta);
  }
  const free = t.state === 'finished' || t.state === 'idle';
  // One button: an arrow when the agent is free (it types in now); "Queue" while it works.
  const qs = $('q-send');
  qs.classList.toggle('queue', !free);
  qs.title = free ? 'Send (Enter)' : `Queue: goes in the moment ${t.agentName} is free (Enter)`;
  qs.querySelector('.sr').textContent = free ? 'Send' : 'Queue';
  if (!free && !qs.querySelector('.ql')) qs.insertAdjacentHTML('afterbegin', '<span class="ql">Queue</span>');
  if (free) qs.querySelector('.ql')?.remove();
  $('q-hint').textContent = free ? 'Enter to send · Shift+Enter for a new line' : `${t.agentName} is working · Enter queues it`;
  $('term-queue').innerHTML = t.queued.map((q) => `<span class="qchip ${q.held ? 'held' : ''}" title="${esc(q.text)}"><span class="src">${esc(q.source)}${q.held ? ' · held' : ''}</span><span class="txt">${esc(q.text)}</span>${q.held ? `<button type="button" class="go" data-q="${q.id}" data-qa="release">Send when free</button>` : ''}<button type="button" data-q="${q.id}" data-qa="drop" aria-label="Remove">✕</button></span>`).join('');
}
function growText(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 2, 180) + 'px'; }
document.addEventListener('input', (e) => { if (e.target.id === 'q-text') growText(e.target); });

// ---------- images in the message bar: paste or drop one, it goes with the message
const images = {};   // 'term:<key>' -> [{ path, url }]
function renderImages() {
  const host = $('q-images'); if (!host) return;
  const list = images['term:' + currentTerm] || [];
  host.innerHTML = list.map((x, i) => `<span class="q-img"><img src="${x.url}" alt=""><button type="button" data-img-del="${i}" aria-label="Remove image">×</button></span>`).join('');
}
async function addImage(file) {
  const t = termByKey(currentTerm);
  if (!t) return;
  if (t.remote) { toast('Images can go to sessions on this computer for now.'); return; }
  const data = await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.readAsDataURL(file); });
  try {
    const { path } = await api('/api/paste', { type: file.type, data });
    (images['term:' + t.key] ||= []).push({ path, url: URL.createObjectURL(file) });
    renderImages(); $('q-text').focus();
  } catch (err) { toast(err.message); }
}
// The paperclip: pick images from the computer.
document.addEventListener('click', (e) => { if (e.target.closest('#q-attach')) $('q-file').click(); });
document.addEventListener('change', (e) => {
  if (e.target.id !== 'q-file') return;
  [...e.target.files].filter((f) => f.type.startsWith('image/')).forEach(addImage);
  e.target.value = '';
});
// Clicking the prompt's empty space puts the cursor in it, like a chat app.
document.addEventListener('mousedown', (e) => { if (e.target.id === 'q-prompt' || e.target.classList?.contains('prompt-tools')) { e.preventDefault(); $('q-text').focus(); } });
document.addEventListener('paste', (e) => {
  if (e.target.id !== 'q-text') return;
  const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
  if (!files.length) return;
  e.preventDefault();
  files.forEach(addImage);
});
document.addEventListener('drop', (e) => {
  if (!e.target.closest?.('#q-prompt, #term-host')) return;
  const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'));
  if (files.length) { e.stopImmediatePropagation(); e.preventDefault(); $('q-prompt')?.classList.remove('drop'); files.forEach(addImage); }
}, true);
document.addEventListener('click', (e) => {
  const d = e.target.closest('[data-img-del]');
  if (!d) return;
  const list = images['term:' + currentTerm] || [];
  const [gone] = list.splice(Number(d.dataset.imgDel), 1);
  if (gone) URL.revokeObjectURL(gone.url);
  renderImages();
});
// Enter: while dictating, stops dictation; in the message bar, sends.
// Shift+Enter is a new line.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
  if (rec && rec.target === e.target) { e.preventDefault(); stopDictation(); return; }
  if (e.target.id === 'q-text') { e.preventDefault(); queueAct('queue', null); }
}, true);

async function openNewTerm() {
  const [list, agents] = await Promise.all([api('/api/folders'), api('/api/agents')]);
  $('nt-folder').innerHTML = list.map((f) => `<option value="${esc(f.path)}">${esc(f.name)}</option>`).join('');
  $('nt-agent').innerHTML = agents.map((a) => `<option value="${esc(a.id)}" ${a.installed ? '' : 'disabled'}>${esc(a.name)}${a.installed ? '' : ' (not installed)'}</option>`).join('');
  $('nt-agent').value = store.get('lastAgent', 'claude');
  if ($('nt-agent').selectedOptions[0]?.disabled) $('nt-agent').value = 'claude';
  syncAgentFields();
  $('nt-msg').textContent = '';
  $('newterm-scrim').classList.add('open');
}
function syncAgentFields() {
  const custom = $('nt-agent').value === 'custom';
  document.querySelectorAll('.nt-custom').forEach((el) => { el.hidden = !custom; });
  $('nt-note').textContent = $('nt-agent').value === 'claude'
    ? 'Runs Claude Code in that folder, inside Switchboard. Switchboard knows exactly when it is busy or free.'
    : 'Runs it in that folder, signed in with your own account for it. Switchboard treats it as busy while it prints and free after a few quiet seconds.';
}
$('nt-agent').addEventListener('change', syncAgentFields);
$('newterm-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('nt-msg').textContent = 'Starting…';
  try {
    store.set('lastAgent', $('nt-agent').value);
    const r = await api('/api/terms', { cwd: $('nt-folder').value, agent: $('nt-agent').value, command: $('nt-command').value });
    $('newterm-scrim').classList.remove('open'); openTerm(r.id); await load();
  } catch (err) { $('nt-msg').textContent = err.message; }
});

// Renaming a session: Rename in the panel, or double-click its tab. Sessions on
// another computer are renamed there.
let renaming = null, renameVal = null;
document.addEventListener('input', (e) => { if (e.target.id === 'rename-input') renameVal = e.target.value; });
function startRename(key) {
  const t = termByKey(key); if (!t || t.remote) return;
  renaming = key; renameVal = null; renderDetail();
  const i = $('rename-input'); if (i) { i.focus(); i.select(); }
}
document.addEventListener('click', (e) => {
  const r = e.target.closest('[data-rename]');
  if (r) { startRename(r.dataset.rename); return; }
  if (e.target.closest('[data-rename-cancel]')) { renaming = null; renameVal = null; renderDetail(); }
});
document.addEventListener('dblclick', (e) => { const tt = e.target.closest('[data-term]'); if (tt) startRename(tt.dataset.term); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && renaming && e.target.id === 'rename-input') { renaming = null; renameVal = null; renderDetail(); } });
document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'rename-form') return;
  e.preventDefault();
  const t = termByKey(renaming); if (!t) return;
  try { await api(`/api/terms/${encodeURIComponent(t.id)}/rename`, { name: $('rename-input').value }); renaming = null; renameVal = null; await load(); toast('Renamed.'); }
  catch (err) { toast(err.message); }
});
