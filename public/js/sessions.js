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
// A session goes by your name for it if you gave one, else by what it is
// working on (Claude Code's title for it), else by its folder.
const termLabel = (t) => (!t.named && t.title) || t.name;
const termPath = (t, act) => t.remote ? `/api/remote/${t.device}/${encodeURIComponent(t.id)}/${act}` : `/api/terms/${encodeURIComponent(t.id)}/${act}`;

function openTerm(id) {
  currentTerm = id; store.set('term', id);
  if (location.hash !== '#sessions') location.hash = '#sessions'; else render();
}

// Sessions follow the project picked on the rail; the one open stays listed.
const visibleTerms = () => allTerms().filter((t) => inProject(t) || t.key === currentTerm);

function renderSessions() {
  const terms = allTerms();
  if (currentTerm && !terms.some((t) => t.key === currentTerm)) currentTerm = null;
  if (currentTerm && project !== 'all' && !inProject(termByKey(currentTerm))) currentTerm = null;
  if (!currentTerm) currentTerm = (terms.find(inProject) || terms[0])?.key || null;
  let html = `<div class="sessions-head"><h1 class="page-title">Sessions</h1>${subTabs()}<span class="grow"></span>${projectPicker()}</div>
    <div class="lines-strip">${visibleTerms().map((t) => `<button type="button" class="strip-line ${esc(t.state)}" data-term="${esc(t.key)}" aria-pressed="${t.key === currentTerm}" title="${esc(t.name)}">${esc(termLabel(t))}<span>${esc(TERM_STATE[t.state] || t.state)}</span></button>`).join('')}<button class="btn" type="button" data-new-term>New</button></div>`;
  if (!terms.length) html += `<section class="card"><p class="empty">No sessions yet. Start one here; sessions on your other computers show up here too when they are on and signed in.</p><div class="actions"><button class="btn btn--primary" type="button" data-new-term>New session</button></div></section>`;
  $('page').innerHTML = html;
}

// The lines: the panel's one job is picking a session. Each is one row in a
// list grouped under its repo: the name (without the repo's name repeated),
// then what it is doing, in a column of its own so the eye can run down it.
// The order never shuffles, so a session stays where you last saw it. Orange
// is kept for the one thing that asks for you, as on Now; a second line shows
// only when there is something more to know (a queue, a build gone wrong).
const shortAgo = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'now' : m < 60 ? m + 'm' : m < 1440 ? Math.round(m / 60) + 'h' : Math.round(m / 1440) + 'd'; };
function lineGroup(t) { return t.ci?.fullName?.split('/')[1] || (t.cwd || '').split(/[\\/]/).filter(Boolean).pop() || t.name; }
function sessionLines() {
  const terms = visibleTerms();
  const groups = new Map();
  for (const t of terms) { const g = lineGroup(t); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(t); }
  const hidden = allTerms().length - terms.length;
  const line = (t, g, list) => {
    const p = g + '-';
    let name = termLabel(t);
    if (name === t.name) {
      // A folder name: without the repo's name repeated, and two alike told apart by their id.
      if (name.startsWith(p) && name.length > p.length) name = name.slice(p.length);
      if (list.filter((o) => termLabel(o) === t.name).length > 1) name = t.id.replace(/^sb-/, '') || name;
    }
    const ask = t.state === 'waiting' || t.state === 'finished';
    const more = [t.queued.length ? `${t.queued.length} queued` : '', sessionBuildWord(t), t.agent !== 'claude' ? esc(t.agentName) : '', t.remote ? 'on ' + esc(t.deviceName) : ''].filter(Boolean).join(' · ');
    return `<button class="line ${esc(t.state)}" type="button" data-term="${esc(t.key)}" aria-pressed="${t.key === currentTerm}" title="${esc([t.name, t.ci?.branch, t.remote ? '' : 'double-click to rename'].filter(Boolean).join(' · '))}">
      <span class="l-name">${esc(name)}</span><span class="l-state">${esc(TERM_STATE[t.state] || t.state)}${ask && t.updatedAt ? ` <span class="l-ago">${shortAgo(t.updatedAt)}</span>` : ''}</span>${more ? `<span class="l-more">${more}</span>` : ''}</button>`;
  };
  return `<nav class="lines" aria-label="Sessions">${[...groups].map(([g, list]) => `<div class="line-group" role="group" aria-label="${esc(g)}"><div class="lg-name">${esc(g)}</div>${list.map((t) => line(t, g, list)).join('')}</div>`).join('')}
    <button class="line-new" type="button" data-new-term><span aria-hidden="true">+</span> New session</button>
    ${hidden ? `<p class="lines-note">${hidden} more in other projects. <button class="btn btn--ghost" type="button" data-show-all>Show all</button></p>` : ''}</nav>`;
}

// The console's look: JetBrains Mono, and the sixteen terminal colours tuned to
// the counter (ink background, signal-orange cursor), soft enough to read all day.
// The background, foreground, cursor and selection come from the --con-* tokens
// (public/css/tokens.css) so the terminal and the Chat view share one palette;
// the literals are the fallback if a token is ever empty.
const TERM_FONT = '"JetBrains Mono", "DejaVu Sans Mono", "Ubuntu Mono", ui-monospace, Menlo, Consolas, monospace';
const cssVar = (name, fallback) => (getComputedStyle(document.documentElement).getPropertyValue(name) || '').trim() || fallback;
const TERM_THEME = {
  background: cssVar('--con-bg', '#121418'), foreground: cssVar('--con-fg', '#E4E6E9'), cursor: cssVar('--accent', '#FF4F00'), cursorAccent: cssVar('--con-bg', '#121418'),
  selectionBackground: cssVar('--con-selection', 'rgba(255, 79, 0, 0.30)'), selectionInactiveBackground: cssVar('--con-thumb', 'rgba(255, 255, 255, 0.12)'),
  scrollbarSliderBackground: 'rgba(255, 255, 255, 0.10)', scrollbarSliderHoverBackground: 'rgba(255, 255, 255, 0.18)', scrollbarSliderActiveBackground: 'rgba(255, 79, 0, 0.45)',
  black: '#1D2027', red: cssVar('--con-bad', '#EF6F68'), green: cssVar('--con-ok', '#5FC98E'), yellow: cssVar('--con-warn', '#E6B657'), blue: cssVar('--con-info', '#78A5DE'), magenta: '#C395E6', cyan: '#57C3CD', white: cssVar('--con-fg-soft', '#C8CBD0'),
  brightBlack: '#626873', brightRed: cssVar('--con-bad-2', '#FF8B82'), brightGreen: cssVar('--con-ok-2', '#80DEA9'), brightYellow: '#FFD07A', brightBlue: cssVar('--con-info-2', '#9BC1F1'), brightMagenta: '#DBB2F4', brightCyan: '#80D9E2', brightWhite: '#FCFCFA'
};
const TERM_STATE = { running: 'Working', waiting: 'Needs you', finished: 'Your turn', idle: 'Ready', starting: 'Starting' };

// The bar over the terminal: what it is, how long it has been doing it, and the
// controls a terminal window would have.
function renderTermBar() {
  const t = termByKey(currentTerm), el = $('term-bar');
  if (!t || !el) return;
  const branch = t.ci?.branch || '';
  const size = Number(S?.prefs?.termSize) || 13.5;
  const meta = [
    t.agent !== 'claude' ? `<span>${esc(t.agentName)}</span>` : '',
    liveReadout(t),
    branch ? `<span class="mono" title="Branch">⎇ ${esc(branch)}</span>` : '',
    devChips(t),
    t.queued.length ? `<span class="hot">${t.queued.length} queued</span>` : '',
    t.remote ? `<span>on ${esc(t.deviceName)}</span>` : '',
    termBuild(t),
    ...(t.links || []).map((l) => `<span title="${l.auto ? 'New messages go in by themselves' : 'Linked; new messages wait for you'}">with ${esc(l.who || 'Teams chat')}${l.auto ? ' (auto)' : ''}</span>`),
    t.mode === 'direct' ? `<span title="This session ends if Switchboard restarts or updates.${S.platform === 'darwin' ? ' Install tmux (brew install tmux) to keep it running.' : ''}">ends on restart</span>` : '',
    `<span class="tb-path mono" title="${esc(t.cwd || '')}">${esc((t.cwd || '').replace(/^\/home\/[^/]+|^\/Users\/[^/]+|^[A-Za-z]:\\Users\\[^\\]+/, '~'))}</span>`].filter(Boolean).join('');
  const html = `<div class="tb-id"><b class="tb-name" title="${esc(t.name)}">${esc(termLabel(t))}</b>
      <span class="tb-state ${esc(t.state)}">${esc(TERM_STATE[t.state] || t.state)}${t.updatedAt ? ` · <span data-tick="${Number(t.updatedAt) || 0}">${dur(Date.now() - t.updatedAt)}</span>` : ''}</span></div>
    <div class="tb-meta">${meta}</div>
    <div class="tb-actions">
      ${chatToggle(t)}
      <button class="tb-btn" type="button" data-tsize="-1" title="Smaller text" ${size <= 11 ? 'disabled' : ''}>A−</button>
      <button class="tb-btn" type="button" data-tsize="1" title="Bigger text" ${size >= 18 ? 'disabled' : ''}>A+</button>
      <button class="tb-btn" type="button" data-tcopy title="Copy what is selected">Copy</button>
      ${endAsk === t.key ? `<span class="tb-ask" role="group" aria-label="End this session?"><span>End this session?</span><button class="tb-btn danger" type="button" data-end-yes>End it</button><button class="tb-btn" type="button" data-end-no>Keep</button></span>` : `
      <button class="tb-btn stop" type="button" data-qact="interrupt" ${t.state === 'running' || t.state === 'waiting' ? '' : 'disabled'} title="Stop what it is doing right now, like pressing Esc. The session stays open and you can keep talking to it.">Stop</button>
      <button class="tb-btn end" type="button" data-end-session title="Close this session for good">End</button>`}
      <details class="tb-more"><summary class="tb-btn" title="More">More</summary><div class="tb-menu">
        ${t.remote ? '' : `<button type="button" data-rename="${esc(t.key)}">Rename</button>`}
        ${t.mode === 'tmux' && !t.remote ? `<button type="button" data-tcopy-attach="${esc(t.id)}">Copy tmux attach</button>` : ''}
        ${(t.links || []).map((l) => `<label class="tb-check"><input type="checkbox" data-auto="${esc(l.chat_key)}" ${l.auto ? 'checked' : ''}> Send ${esc(l.who || 'chat')}'s new messages in</label><button type="button" data-unlink="${esc(l.chat_key)}">Unlink ${esc(l.who || 'chat')}</button>`).join('')}
      </div></details></div>`;
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
    cursorBlink: true, cursorStyle: 'bar', cursorWidth: 2, scrollback: 10000, allowProposedApi: false, macOptionClickForcesSelection: true, altClickMovesCursor: false, theme: TERM_THEME });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(host);
  // File names on the screen open the reader (fileview.js), here or from the computer the session runs on.
  termFileLinks(term, currentTerm);
  // Selecting text belongs to this screen. A session's tmux takes the mouse
  // (for the wheel), so a plain drag would be tmux's selection: drawn on every
  // computer showing the session, and copied on the one it runs on. Here a
  // plain left drag is made the browser's own (as Shift-drag, or Option-drag
  // on a Mac, is in xterm), so it shows only on this screen, and letting go
  // copies it to this computer's clipboard. The wheel still scrolls in tmux.
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  host.addEventListener('mousedown', (e) => {
    if (e.sbLocal || e.button !== 0 || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
    if (!term.element?.contains(e.target) || term.modes.mouseTrackingMode === 'none') return;
    e.stopImmediatePropagation(); e.preventDefault();
    term.clearSelection();
    const copy = new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, detail: e.detail, button: 0, buttons: e.buttons, clientX: e.clientX, clientY: e.clientY, screenX: e.screenX, screenY: e.screenY, shiftKey: !isMac, altKey: isMac });
    copy.sbLocal = true;
    e.target.dispatchEvent(copy);
    term.focus();
  }, true);
  host.addEventListener('mouseup', (e) => {
    if (e.button !== 0) return;
    setTimeout(() => {
      const sel = term.hasSelection() ? term.getSelection() : '';
      if (sel.trim()) navigator.clipboard.writeText(sel).then(() => toast('Copied.'), () => {});
    }, 0);
  });
  // Cmd C on a Mac copies the selection here; Ctrl C stays the terminal's (it stops the agent).
  term.attachCustomKeyEventHandler((e) => {
    if (e.type === 'keydown' && e.metaKey && (e.key === 'c' || e.key === 'C') && term.hasSelection()) {
      navigator.clipboard.writeText(term.getSelection()).then(() => toast('Copied.'), () => {});
      return false;
    }
    // Ctrl+Backspace deletes the word before the cursor, as in every text box.
    // The terminal would send ^H (one character back); ^W is "delete a word" in
    // Claude Code, Codex and any shell.
    if (e.key === 'Backspace' && e.ctrlKey && !e.altKey && !e.metaKey) {
      if (e.type === 'keydown') { e.preventDefault(); term.input('\x17'); }
      return false;
    }
    // In a Claude session, the keys Claude Code itself uses: Shift+Enter is a
    // new line (its Ctrl+J), Ctrl+Enter sends now even while it works (its
    // Ctrl+X Ctrl+S). Anywhere else Enter stays Enter.
    if (e.key === 'Enter' && !e.altKey && !e.metaKey && (e.shiftKey !== e.ctrlKey)) {
      const t = termByKey(currentTerm);
      if (t && (t.agent === 'claude' || t.claude_id)) {
        if (e.type === 'keydown') { e.preventDefault(); term.input(e.shiftKey ? '\n' : '\x18\x13'); }
        return false;
      }
    }
    return true;
  });
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
  // JetBrains Mono (shipped in public/fonts) can arrive a moment after the page: measure again once it has.
  document.fonts?.load(`400 ${term.options.fontSize}px "JetBrains Mono"`).then(() => { if (tv.term === term) { term.options.fontFamily = TERM_FONT; claim(); } }).catch(() => {});
  term.parser.registerOscHandler(7747, (data) => {
    const [c, r] = data.split('x').map(Number);
    if (!(c > 0 && r > 0)) return true;
    win = { c, r };
    if (c !== term.cols || r !== term.rows) term.resize(c, r);
    requestAnimationFrame(scaleToFit);
    return true;
  });
  // A copy made inside the session (Claude Code's copy, tmux's mouse select)
  // comes down the stream as OSC 52; it goes on the clipboard of the computer
  // looking at it, not the one the session runs on. Only the window in use
  // takes it, so two computers showing one session do not both get it; a
  // request to read the clipboard ("?") is never answered.
  term.parser.registerOscHandler(52, (data) => {
    const b64 = data.slice(data.indexOf(';') + 1);
    if (!b64 || b64 === '?' || !document.hasFocus()) return true;
    try {
      const text = new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
      if (text) navigator.clipboard.writeText(text).then(() => toast('Copied.'), () => {});
    } catch {}
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
  // Coming back to this computer often fires no focus (its window was already
  // in front), so the mouse resting on the terminal also takes the size back:
  // 400 ms inside it, in the window in use, so a mouse only passing over a
  // computer nobody is using does not flip the size back and forth.
  let dwell = null;
  term.element?.addEventListener('pointermove', () => {
    if (dwell || holds()) return;
    dwell = setTimeout(() => { dwell = null; if (tv.term === term && document.hasFocus() && !holds()) claim(); }, 400);
  }, { passive: true });
  term.element?.addEventListener('pointerleave', () => { clearTimeout(dwell); dwell = null; });
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
  if (!t) return `${allTerms().length ? sessionLines() : ''}<div class="lines-empty"><h2>Claude, inside Switchboard</h2><p class="muted">Start a session and it shows here: type in the terminal like always, or queue messages so they go in when Claude is free.</p></div>`;
  const rename = renaming === t.key ? `<form class="rename-form" id="rename-form"><label for="rename-input" class="sr">Session name</label><input id="rename-input" type="text" maxlength="60" value="${esc(renameVal ?? (t.named ? t.name : ''))}" placeholder="${esc(termLabel(t))}" autocomplete="off"><button class="btn btn--primary" type="submit">Save</button><button class="btn" type="button" data-rename-cancel>Cancel</button></form>` : '';
  return rename + sessionLines() + sessionMessages(t);
}

// End session: End on the bar, then "End it" in the same place. The question
// stays until it is answered (no timer), and a click anywhere else, or another
// session, puts the buttons back.
let endAsk = null;
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-end-session]')) { endAsk = currentTerm; renderTermBar(); return; }
  if (e.target.closest('[data-end-yes]')) { if (termByKey(endAsk)) queueAct('close', null); endAsk = null; return; }
  if (e.target.closest('[data-end-no]') || (endAsk && !e.target.closest('.tb-ask'))) { endAsk = null; renderTermBar(); }
  if (e.target.closest('[data-show-all]')) { project = 'all'; store.set('space', project); render(); return; }
  const at = e.target.closest('[data-tcopy-attach]');
  if (at) { e.target.closest('details')?.removeAttribute('open'); navigator.clipboard.writeText(`tmux attach -t ${at.dataset.tcopyAttach}`).then(() => toast('Copied.'), () => toast('Could not copy.')); return; }
  // A click anywhere else closes the More menu.
  for (const d of document.querySelectorAll('.tb-more[open]')) if (!d.contains(e.target)) d.removeAttribute('open');
});

// The docked message bar under the terminal. The textarea stays put across
// refreshes (so typing and dictation are never interrupted); its draft follows
// whichever session is open.
let composeFor = null;
function renderTermCompose() {
  const t = termByKey(currentTerm);
  if (!t) return;
  renderTermBar();
  renderBringPop();
  const ta = $('q-text');
  if (composeFor !== t.key) {
    if (composeFor) draft['term:' + composeFor] = ta.value;
    ta.value = draft['term:' + t.key] || '';
    composeFor = t.key;
    growText(ta);
    slashUpdate();   // the "/" menu follows the draft shown
  }
  // Claude asking a question in the Chat view counts as free: a message then answers No and goes straight in.
  const asking = chatOn(t.key) && !!cv?.menu && menuNoIndex() >= 0;
  const free = t.state === 'finished' || t.state === 'idle' || asking;
  // One button: an arrow when the agent is free (it types in now); "Queue" while it works.
  const qs = $('q-send');
  qs.classList.toggle('queue', !free);
  qs.title = free ? 'Send (Enter)' : `Queue: goes in the moment ${t.agentName} is free (Enter)`;
  qs.querySelector('.sr').textContent = free ? 'Send' : 'Queue';
  if (!free && !qs.querySelector('.ql')) qs.insertAdjacentHTML('afterbegin', '<span class="ql">Queue</span>');
  if (free) qs.querySelector('.ql')?.remove();
  $('q-hint').textContent = asking ? 'Enter sends this instead (answers No)' : free ? 'Enter to send · Shift+Enter for a new line' : `${t.agentName} is working · Enter queues it`;
  $('term-queue').innerHTML = t.queued.map((q, i) => `<div class="qline ${q.held ? 'held' : ''}" title="${esc(q.text)}"><span class="qn">${q.held ? 'Held' : 'Next' + (i ? ' +' + i : '')}</span><span class="txt">${esc(q.text)}</span><span class="src">${esc(q.source)}</span>${q.held ? `<button type="button" class="go" data-q="${esc(q.id)}" data-qa="release">Send when free</button>` : ''}<button type="button" data-q="${esc(q.id)}" data-qa="drop" title="Remove from the queue">Remove</button></div>`).join('');
}
function growText(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 2, 180) + 'px'; }
document.addEventListener('input', (e) => { if (e.target.id === 'q-text') growText(e.target); });

// ---------- files in the message bar: paste, drop or pick any file, it goes
// with the message as its location on this computer, which is how Claude Code
// and Codex take files (pictures, PDFs, spreadsheets, code, anything). In the
// Terminal view a dropped file's location is typed where the cursor is.
const images = {};   // 'term:<key>' -> [{ path, name, url (pictures only) }]
function renderImages() {
  const host = $('q-images'); if (!host) return;
  const list = images['term:' + currentTerm] || [];
  host.innerHTML = list.map((x, i) => x.url
    ? `<span class="q-img" title="${esc(x.name)}"><img src="${esc(x.url)}" alt="${esc(x.name)}"><button type="button" data-img-del="${i}" aria-label="Remove ${esc(x.name)}">×</button></span>`
    : `<span class="q-file" title="${esc(x.path)}"><span class="q-file-name">${esc(x.name)}</span><span class="q-file-size">${fmtSize(x.size)}</span><button type="button" data-img-del="${i}" aria-label="Remove ${esc(x.name)}">×</button></span>`).join('');
}
function fileTarget() {
  const t = termByKey(currentTerm);
  if (!t) return null;
  if (t.remote) { toast(`Files go to sessions on this computer. This one runs on ${t.deviceName || 'another computer'}: add the file there.`); return null; }
  return t;
}
async function addImage(file) {
  const t = fileTarget(); if (!t) return;
  try {
    const f = await uploadFile(file);
    (images['term:' + t.key] ||= []).push({ path: f.path, name: f.name, size: f.size, url: f.image ? URL.createObjectURL(file) : null });
    renderImages(); $('q-text').focus();
  } catch (err) { toast(err.message, { kind: 'error' }); }
}
// Terminal view: the file's location goes in at the cursor, quoted, nothing sent.
async function fileIntoTerminal(files) {
  const t = fileTarget(); if (!t || !tv.term) return;
  for (const file of files) {
    try { const f = await uploadFile(file); tv.term.paste(" '" + f.path.replace(/'/g, "'\\''") + "' "); }
    catch (err) { toast(err.message, { kind: 'error' }); }
  }
  tv.term.focus();
}
// The paperclip: pick files from the computer.
document.addEventListener('click', (e) => { if (e.target.closest('#q-attach')) $('q-file').click(); });
document.addEventListener('change', (e) => {
  if (e.target.id !== 'q-file') return;
  [...e.target.files].forEach(addImage);
  e.target.value = '';
});
// Clicking the prompt's empty space puts the cursor in it, like a chat app.
document.addEventListener('mousedown', (e) => { if (e.target.id === 'q-prompt' || e.target.classList?.contains('prompt-tools')) { e.preventDefault(); $('q-text').focus(); } });
document.addEventListener('paste', (e) => {
  if (e.target.id !== 'q-text') return;
  const files = [...(e.clipboardData?.files || [])];
  if (!files.length) return;
  e.preventDefault();
  files.forEach(addImage);
});
document.addEventListener('drop', (e) => {
  if (!e.target.closest?.('#q-prompt, #term-host, #chat-host')) return;
  const files = [...(e.dataTransfer?.files || [])];
  if (!files.length) return;
  e.stopImmediatePropagation(); e.preventDefault(); $('q-prompt')?.classList.remove('drop');
  if (e.target.closest('#term-host') && !$('term-host').hidden && tv.term) fileIntoTerminal(files);
  else files.forEach(addImage);
}, true);
document.addEventListener('click', (e) => {
  const d = e.target.closest('[data-img-del]');
  if (!d) return;
  const list = images['term:' + currentTerm] || [];
  const [gone] = list.splice(Number(d.dataset.imgDel), 1);
  if (gone?.url) URL.revokeObjectURL(gone.url);
  renderImages();
});
// Enter: while dictating, stops dictation; in the message bar, sends.
// Shift+Enter is a new line.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
  if (rec && rec.target === e.target) { e.preventDefault(); stopDictation(); return; }
  if (e.target.id === 'q-text') {
    e.preventDefault();
    // The "/" menu open: Enter picks the command; the next Enter sends it.
    if (slash.open && slashPick() !== 'same') return;
    queueAct('queue', null);
  }
}, true);

// ---------- the session's readout: model, effort, context used and cost, as
// Claude Code reports them live (its status line and hooks, lib/claude.js);
// before it has, what the session was started with.
const modelWord = (id) => { const m = String(id || '').match(/^(sonnet|opus|haiku|fable)(\[1m\])?$/i); return m ? m[1][0].toUpperCase() + m[1].slice(1) + (m[2] ? ' 1M' : '') : String(id || ''); };
function liveReadout(t) {
  const l = t.live || {};
  const parts = [l.model || modelWord(t.model), l.effort || t.effort, l.context != null ? `${l.context}%` : '', l.cost != null ? `$${Number(l.cost).toFixed(2)}` : ''].filter(Boolean);
  if (!parts.length) return '';
  const title = t.live ? 'Model · effort · context used · cost this session, from Claude Code' : 'Model and effort asked for at start';
  return `<span class="mono tb-live" title="${title}">${esc(parts.join(' · '))}</span>`;
}

// ---------- the "/" menu in the message bar. A message that starts with "/"
// is a command to Claude Code; typing one lists what it can be: Claude's own
// commands, and the folder's skills (GET /api/terms/<id>/slash), filtered by
// what is typed. Arrows move, Enter or Tab picks (the box then holds the
// command, and Enter sends it like any message), Esc closes. The menu never
// changes what Enter does when the text does not start with "/".
const SLASH_BUILTIN = [
  ['model', 'Pick the model (Claude\'s picker, shown as buttons in Chat)'],
  ['effort', 'How hard it thinks: /effort low, medium, high, xhigh or max (the slider opens in the terminal)'],
  ['clear', 'Start the conversation over, same folder'],
  ['compact', 'Fold the conversation down to a summary to free context'],
  ['context', 'What is taking up the context window'],
  ['cost', 'What this session has cost so far'],
  ['rename', 'Name this conversation (the session\'s name here follows its title)'],
  ['plan', 'Plan first: it works out an approach before changing anything'],
  ['resume', 'Pick an earlier conversation to continue'],
  ['help', 'Claude Code\'s own help'],
  ['status', 'Version, model, account and what is connected'],
  ['diff', 'What has changed in the working tree'],
  ['review', 'Review a pull request or the changes'],
  ['security-review', 'Look over the changes for security problems']
].map(([name, description]) => ({ name, description, where: '' }));
const slashCache = {};   // term id -> { at, list, busy }
let slash = { open: false, items: [], at: 0, picked: '', html: '' };

function slashHost() {
  let el = $('slash-pop');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'slash-pop'; el.className = 'slash-pop'; el.hidden = true;
  el.setAttribute('role', 'listbox'); el.setAttribute('aria-label', 'Commands');
  $('q-prompt').before(el);
  return el;
}
// The folder's skills, fetched at most every 30 s per session (the server caches too).
function slashFetch(t) {
  const c = slashCache[t.id] || (slashCache[t.id] = { at: 0, list: [], busy: false });
  if (c.busy || Date.now() - c.at < 30e3) return;
  c.busy = true;
  api(`/api/terms/${encodeURIComponent(t.id)}/slash`).then((list) => { c.list = Array.isArray(list) ? list : []; c.at = Date.now(); slashUpdate(); })
    .catch(() => { c.at = Date.now(); }).finally(() => { c.busy = false; });
}
function slashClose(picked) {
  const ta = $('q-text'), el = $('slash-pop');
  slash = { ...slash, open: false, items: [], at: 0, picked: picked ?? '', html: '' };
  if (el) { el.hidden = true; el.innerHTML = ''; }
  if (ta) { ta.removeAttribute('aria-activedescendant'); ta.removeAttribute('aria-controls'); ta.removeAttribute('aria-expanded'); }
}
function slashUpdate() {
  const ta = $('q-text'), t = termByKey(currentTerm);
  const v = ta?.value || '';
  if (!t || t.agent !== 'claude' || !v.startsWith('/') || v.includes('\n') || v === slash.picked) { if (slash.open) slashClose(slash.picked); return; }
  if (!t.remote) slashFetch(t);
  const q = v.slice(1).toLowerCase();
  const all = [...SLASH_BUILTIN, ...(t.remote ? [] : (slashCache[t.id]?.list || []))];
  const items = [...all.filter((c) => c.name.toLowerCase().startsWith(q)), ...all.filter((c) => !c.name.toLowerCase().startsWith(q) && c.name.toLowerCase().includes(q))].slice(0, 60);
  const same = slash.open && items.length === slash.items.length && items.every((c, i) => c === slash.items[i]);
  slash.items = items;
  if (!same) slash.at = 0;
  slash.open = true;
  slashRender();
}
function slashRender() {
  const el = slashHost(), ta = $('q-text');
  const html = slash.items.length
    ? slash.items.map((c, i) => `<button type="button" role="option" id="slash-opt-${i}" class="slash-opt" aria-selected="${i === slash.at}" data-slash="${i}"><span class="sl-name">/${esc(c.name)}</span><span class="sl-desc">${esc(c.description || '')}</span><span class="sl-where">${esc(c.where || '')}</span></button>`).join('')
    : `<p class="slash-none">No command starts like that. Enter sends it as written.</p>`;
  if (slash.html !== html) { el.innerHTML = html; slash.html = html; }
  el.hidden = false;
  ta.setAttribute('aria-controls', 'slash-pop'); ta.setAttribute('aria-expanded', 'true');
  if (slash.items.length) { ta.setAttribute('aria-activedescendant', `slash-opt-${slash.at}`); el.querySelector(`#slash-opt-${slash.at}`)?.scrollIntoView({ block: 'nearest' }); }
  else ta.removeAttribute('aria-activedescendant');
}
// Put the command in the box. Returns 'same' when it was already there in full (so Enter sends).
function slashPick(i = slash.at) {
  const c = slash.items[i], ta = $('q-text');
  if (!c || !ta) { slashClose(ta?.value); return 'none'; }
  const cmd = '/' + c.name;
  if (ta.value === cmd) { slashClose(cmd); return 'same'; }
  ta.value = cmd;
  slashClose(cmd);
  draft['term:' + currentTerm] = cmd;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  ta.focus(); ta.setSelectionRange(cmd.length, cmd.length);
  return 'picked';
}
document.addEventListener('input', (e) => { if (e.target.id === 'q-text') slashUpdate(); });
document.addEventListener('keydown', (e) => {
  if (!slash.open || e.target.id !== 'q-text' || e.isComposing) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!slash.items.length) return;
    e.preventDefault();
    slash.at = (slash.at + (e.key === 'ArrowDown' ? 1 : slash.items.length - 1)) % slash.items.length;
    slashRender();
  } else if (e.key === 'Tab') { e.preventDefault(); slashPick(); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); slashClose(e.target.value); }
}, true);
// Clicks: the mouse picks without taking focus from the box; a click elsewhere closes it.
document.addEventListener('mousedown', (e) => { if (e.target.closest('#slash-pop')) e.preventDefault(); });
document.addEventListener('mouseover', (e) => { const o = e.target.closest('[data-slash]'); if (o && slash.open) { const i = Number(o.dataset.slash); if (i !== slash.at) { slash.at = i; slashRender(); } } });
document.addEventListener('click', (e) => {
  const o = e.target.closest('[data-slash]');
  if (o) { slashPick(Number(o.dataset.slash)); return; }
  if (slash.open && e.target.isConnected && !e.target.closest('#q-prompt')) slashClose($('q-text')?.value);
});

// New session. The agents come from the server with the choices each takes
// (Claude: a model and an effort, and a 1M-context form of some models; Codex: any
// model name); the last choice is remembered per folder and agent, in the browser.
let ntAgents = [];
const ntKey = () => $('nt-folder').value + '|' + $('nt-agent').value;
const ntAgent = () => ntAgents.find((a) => a.id === $('nt-agent').value) || {};
async function openNewTerm() {
  const [list, agents] = await Promise.all([api('/api/folders'), api('/api/agents')]);
  ntAgents = agents;
  // Your folders first; the agents' side copies of a repo (git worktrees) in a group of their own at the end.
  const mains = list.filter((f) => !f.copyOf), copies = list.filter((f) => f.copyOf);
  $('nt-folder').innerHTML = mains.map((f) => `<option value="${esc(f.path)}">${esc(f.name)}</option>`).join('')
    + (copies.length ? `<optgroup label="Agents' work copies (${copies.length})">${copies.map((f) => `<option value="${esc(f.path)}">${esc(f.name)} · copy of ${esc(f.copyOf)}</option>`).join('')}</optgroup>` : '');
  $('nt-agent').innerHTML = agents.map((a) => `<option value="${esc(a.id)}" ${a.installed ? '' : 'disabled'}>${esc(a.name)}${a.installed ? '' : ' (not installed)'}</option>`).join('');
  $('nt-agent').value = store.get('lastAgent', 'claude');
  if ($('nt-agent').selectedOptions[0]?.disabled) $('nt-agent').value = 'claude';
  syncAgentFields();
  $('nt-msg').textContent = '';
  openDialog('newterm-scrim');
}
function syncAgentFields() {
  const a = ntAgent(), custom = $('nt-agent').value === 'custom';
  document.querySelectorAll('.nt-custom').forEach((el) => { el.hidden = !custom; });
  document.querySelectorAll('.nt-model').forEach((el) => { el.hidden = !a.models; });
  document.querySelectorAll('.nt-effort').forEach((el) => { el.hidden = !a.efforts; });
  document.querySelectorAll('.nt-free').forEach((el) => { el.hidden = !a.modelFree; });
  const mem = store.get('ntChoices', {})[ntKey()] || {};
  if (a.models) { $('nt-model').innerHTML = a.models.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join(''); $('nt-model').value = mem.model || ''; }
  if (a.efforts) { $('nt-effort').innerHTML = a.efforts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join(''); $('nt-effort').value = mem.effort || ''; }
  if (a.modelFree) $('nt-free').value = mem.model || '';
  $('nt-1m').checked = !!mem.long;
  syncLongBox();
  $('nt-note').textContent = $('nt-agent').value === 'claude'
    ? 'Runs Claude Code in that folder, inside Switchboard. Switchboard knows exactly when it is busy or free. Default keeps the model and effort you set in Claude Code itself.'
    : 'Runs it in that folder, signed in with your own account for it. Switchboard treats it as busy while it prints and free after a few quiet seconds.';
}
// The 1M box only for models that have a 1M form (Sonnet and Opus); Default keeps Claude's own choice.
function syncLongBox() {
  const a = ntAgent(), v = $('nt-model').value;
  const ok = !!a.long && !!(a.models || []).find(([id, , long]) => id === v && long);
  const box = $('nt-1m');
  box.disabled = !ok;
  if (!ok) box.checked = false;
  box.parentElement.title = ok ? 'The 1M-token context window' : 'Pick Sonnet or Opus for the 1M-token context window';
}
$('nt-agent').addEventListener('change', syncAgentFields);
$('nt-folder').addEventListener('change', syncAgentFields);
$('nt-model').addEventListener('change', syncLongBox);
$('newterm-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('nt-msg').textContent = 'Starting…';
  try {
    const a = ntAgent(), agent = $('nt-agent').value;
    store.set('lastAgent', agent);
    const picked = a.models ? $('nt-model').value : a.modelFree ? $('nt-free').value.trim() : '';
    const long = !!(a.long && picked && !$('nt-1m').disabled && $('nt-1m').checked);
    const effort = a.efforts ? $('nt-effort').value : '';
    const mem = store.get('ntChoices', {});
    mem[ntKey()] = { model: picked, long, effort };
    store.set('ntChoices', mem);
    const r = await api('/api/terms', { cwd: $('nt-folder').value, agent, command: $('nt-command').value, model: picked + (long ? a.long : ''), effort });
    closeDialog('newterm-scrim'); openTerm(r.id); await load();
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
  catch (err) { toast(err.message, { kind: 'error' }); }
});
