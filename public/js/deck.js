// The Deck: Switchboard's home. Jarvis at the centre as a living core (it
// breathes when idle, listens with your voice, spins while it thinks and
// ripples while it speaks), what it last said underneath, a command line, and
// every system around it as a live module. A module opens into its full panel
// (the page it always was), zooming out of its tile; Esc or the core comes back.
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
const DECK_MODS = ['now', 'sessions', 'builds', 'inbox', 'calendar', 'money', 'notes', 'checks', 'projects'];

function deckGreeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Working late.' : h < 12 ? 'Good morning.' : h < 17 ? 'Good afternoon.' : 'Good evening.';
}

// One module: its title, the big readout, a word under it, and up to four lines.
function deckMod(id, title, big, word, lines, { hot = false, live = false, href = '#' + id } = {}) {
  return `<a class="mod ${hot ? 'mod--hot' : ''} ${live ? 'mod--live' : ''}" href="${href}" data-mod="${id}" style="view-transition-name: mod-${id}">
    <span class="mod-head"><span class="mod-t">${esc(title)}</span><span class="mod-go" aria-hidden="true">↗</span></span>
    <span class="mod-big">${big}</span><span class="mod-word">${esc(word)}</span>
    <span class="mod-lines">${lines.slice(0, 4).map((l) => `<span class="mod-l"><i class="${l.cls || ''}"></i><span>${esc(l.t)}</span>${l.r ? `<em>${esc(l.r)}</em>` : ''}</span>`).join('') || '<span class="mod-l mod-quiet">All quiet.</span>'}</span>
  </a>`;
}

function deckModules() {
  const cards = flight();
  const needs = cards.filter((c) => c.st === 'needs');
  const terms = allTerms();
  const working = terms.filter((t) => t.state === 'running').length, waiting = terms.filter((t) => t.state === 'waiting' || t.state === 'finished').length;
  const repos = S.actions || [];
  const running = ciActiveCount(), failed = repos.filter((a) => a.runs[0]?.state === 'failure' && Date.now() - a.runs[0].updatedAt < 2 * 86400e3);
  const now = Date.now(), evs = (S.events || []).filter((e) => e.end > now).sort((a, b) => a.start - b.start);
  const owed = (S.money?.invoices || []).reduce((n, v) => n + (Number(v.amount) || 0), 0);
  const paid30 = (S.money?.paid || []).filter((p) => now - p.created_at < 30 * 86400e3).reduce((n, v) => n + (Number(v.amount) || 0), 0);
  const checks = (S.checks || []), cFail = checks.filter((c) => bcLast(c)?.state === 'failure' && !c.cleared);
  const STW = { running: 'working', waiting: 'needs you', finished: 'your turn', idle: 'ready', starting: 'starting' };
  const dot = (st) => ({ running: 'run', waiting: 'hot', finished: 'hot', failure: 'bad', success: 'ok', queued: 'run' })[st] || '';
  return {
    now: deckMod('now', 'Needs you', needs.length, needs.length === 1 ? 'thing waiting on you' : 'things waiting on you', needs.map((c) => ({ t: c.what || c.where, r: c.label, cls: 'hot' })), { hot: needs.length > 0 }),
    sessions: deckMod('sessions', 'Sessions', terms.length, `${working} working · ${waiting} your turn`, terms.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).map((t) => ({ t: termLabel(t), r: STW[t.state] || t.state, cls: dot(t.state) })), { live: working > 0, hot: waiting > 0 }),
    builds: deckMod('builds', 'Builds', running || failed.length, running ? (running === 1 ? 'build running' : 'builds running') : failed.length ? 'failed lately' : 'all green', repos.slice(0, 4).map((a) => ({ t: a.name, r: CI_LABEL[a.runs[0]?.state] || '', cls: dot(a.runs[0]?.state) })), { live: running > 0, hot: failed.length > 0 }),
    inbox: deckMod('inbox', 'Inbox', inboxCount('all'), 'waiting on a reply', (S.threads || []).map((t) => ({ t: `${t.who || t.from || ''}: ${t.subject || t.snippet || ''}`, cls: 'run' }))),
    calendar: deckMod('calendar', 'Calendar', evs.length ? new Date(evs[0].start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—', evs.length ? 'next up' : 'nothing coming up', evs.map((e) => ({ t: e.title, r: e.allDay ? 'all day' : new Date(e.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }))),
    money: deckMod('money', 'Money', $$(owed), 'owed to you', [{ t: 'Paid to you, 30 days', r: $$(paid30) }, ...(S.money?.invoices || []).map((v) => ({ t: v.text, r: $$(v.amount) }))]),
    notes: deckMod('notes', 'Notes', (S.pages || []).length, 'pages', (S.pages || []).slice().sort((a, b) => b.updated_at - a.updated_at).map((p) => ({ t: p.title || 'Untitled', r: since(p.updated_at) }))),
    checks: deckMod('checks', 'Browser checks', checks.length, cFail.length ? `${cFail.length} failing` : 'checks', checks.map((c) => ({ t: c.name, r: CI_LABEL[bcLast(c)?.state] || 'not run yet', cls: dot(bcLast(c)?.state) })), { hot: cFail.length > 0 }),
    projects: deckMod('projects', 'Projects', S.spaces.length, 'projects', S.spaces.map((s) => ({ t: s.name, r: needsCount(s.id) ? needsCount(s.id) + ' need you' : '' })), { href: '#project/' + (S.spaces[0]?.id || 'personal') })
  };
}

// What Jarvis last heard and said, under the core, in plain large type.
function deckTalk() {
  const el = $('deck-talk'); if (!el) return;
  const you = [...jv.log].reverse().find((m) => m.who === 'you'), me = [...jv.log].reverse().find((m) => m.who === 'me');
  el.innerHTML = me || you ? `${you ? `<p class="dk-you">${esc(you.text)}</p>` : ''}${me ? `<p class="dk-me">${esc(me.text)}</p>` : ''}`
    : `<p class="dk-me">${esc(deckGreeting())} Hold <kbd>Ctrl</kbd> <kbd>Space</kbd> or tap the core, and tell me what you need.</p>`;
}

function renderDeck() {
  const m = deckModules();
  const w = S.weather?.ok && S.weather.now;
  const date = `${esc(new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }))}${w ? ` · ${Math.round(w.temp)}° ${esc(String(w.text || '').toLowerCase())}` : ''}`;
  // The board refreshes often: only the modules and the date are redrawn, so the
  // core keeps turning and the command line keeps what you are saying or typing.
  const deck = $('page').querySelector('.deck');
  if (deck) {
    const put = (sel, html) => { const el = deck.querySelector(sel); if (el && el.innerHTML !== html) el.innerHTML = html; };
    put('.deck-left', m.now + m.sessions + m.builds); put('.deck-right', m.inbox + m.calendar + m.money); put('.deck-bottom', usageCard('deck') + m.notes + m.checks + m.projects); put('.deck-date', date);
    deckCore.start(); return;
  }
  $('page').innerHTML = `<section class="deck" aria-label="Deck">
    <div class="deck-side deck-left">${m.now}${m.sessions}${m.builds}</div>
    <div class="deck-center">
      <div class="deck-clock"><span id="deck-time"></span><span class="deck-date">${date}</span></div>
      <button class="deck-core" id="deck-core" type="button" aria-label="Jarvis: tap to talk, tap again to send"><canvas id="deck-canvas" aria-hidden="true"></canvas><span class="deck-core-word" id="deck-core-word">JARVIS</span></button>
      <div class="deck-talk" id="deck-talk" aria-live="polite"></div>
      <form class="deck-cmd" id="deck-form"><span class="deck-prompt" aria-hidden="true">❯</span><label for="deck-text" class="sr">Tell Jarvis</label><input id="deck-text" autocomplete="off" placeholder="Tell me what you need…"><button class="mic" type="button" id="deck-mic" data-mic="deck-text" title="Talk">${JV_MIC}<span class="sr">Talk</span></button></form>
    </div>
    <div class="deck-side deck-right">${m.inbox}${m.calendar}${m.money}</div>
    <div class="deck-bottom">${usageCard('deck')}${m.notes}${m.checks}${m.projects}</div>
  </section>`;
  deckTalk(); deckClock(); deckCore.start();
}

function deckClock() { const t = $('deck-time'); if (t) t.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
setInterval(() => { if (page === 'deck') deckClock(); }, 5000);

// ---- the core: rings, arcs and a ring of light that follows the voice
const deckCore = (() => {
  let raf = 0, t = 0, lvl = 0;
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  function frame() {
    const cv = $('deck-canvas');
    if (!cv || page !== 'deck') { raf = 0; return; }
    const r = devicePixelRatio || 1, size = cv.clientWidth;
    if (cv.width !== Math.round(size * r)) { cv.width = cv.height = Math.round(size * r); }
    const g = cv.getContext('2d'); g.setTransform(r, 0, 0, r, 0, 0); g.clearRect(0, 0, size, size);
    const st = $('jv-orb')?.dataset.state || 'idle';
    const want = st === 'listening' ? Math.min(1, micLevel * 7) : st === 'speaking' ? jvWave.level() : st === 'thinking' ? 0.35 : 0.08 + Math.sin(t / 40) * 0.04;
    lvl += (want - lvl) * 0.15; t += st === 'thinking' ? 3 : 1;
    const c = size / 2, R = size * 0.46, hud = css('--hud'), hud2 = css('--hud-2'), vio = css('--jv-wave-3'), fg = css('--fg');
    g.lineCap = 'round';
    // outer rings: thin, dashed, turning at their own speeds
    const ring = (rad, w, dash, speed, color, alpha) => { g.save(); g.translate(c, c); g.rotate(t * speed); g.setLineDash(dash); g.lineWidth = w; g.strokeStyle = color; g.globalAlpha = alpha; g.beginPath(); g.arc(0, 0, rad, 0, Math.PI * 2); g.stroke(); g.restore(); };
    ring(R, 1, [2, 6], 0.002, hud, 0.5);
    ring(R * 0.92, 2, [R * 0.5, R * 0.25], -0.006, hud, 0.8);
    ring(R * 0.84, 1, [1, 3], 0.01, hud2, 0.6);
    ring(R * 0.62, 3, [R * 0.15, R * 0.08], -0.012, hud2, 0.7);
    // the voice: a ring of rays whose length follows the level
    const n = 96, base = R * 0.66;
    g.save(); g.translate(c, c);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const wob = (Math.sin(a * 3 + t / 9) + Math.sin(a * 5 - t / 13) + Math.sin(a * 2 + t / 17)) / 3;
      const len = 3 + (0.5 + wob * 0.5) * lvl * R * 0.16;
      g.strokeStyle = i % 3 === 0 ? vio : hud; g.globalAlpha = 0.35 + lvl * 0.6; g.lineWidth = 2;
      g.beginPath(); g.moveTo(Math.cos(a) * base, Math.sin(a) * base); g.lineTo(Math.cos(a) * (base + len), Math.sin(a) * (base + len)); g.stroke();
    }
    g.restore();
    // the heart: a glowing disc that swells with the voice
    const hr = R * (0.3 + lvl * 0.12);
    const grad = g.createRadialGradient(c, c, 0, c, c, hr);
    grad.addColorStop(0, fg); grad.addColorStop(0.25, hud); grad.addColorStop(0.7, hud2); grad.addColorStop(1, 'transparent');
    g.globalAlpha = 0.9; g.fillStyle = grad; g.shadowColor = hud; g.shadowBlur = 30 + lvl * 40;
    g.beginPath(); g.arc(c, c, hr, 0, Math.PI * 2); g.fill(); g.shadowBlur = 0; g.globalAlpha = 1;
    const word = $('deck-core-word'); if (word) word.textContent = { listening: 'LISTENING', thinking: 'THINKING', speaking: 'JARVIS' }[st] || 'JARVIS';
    raf = requestAnimationFrame(frame);
  }
  return { start() { if (!raf && !matchMedia('(prefers-reduced-motion: reduce)').matches) raf = requestAnimationFrame(frame); else if (!raf) frame(); } };
})();

// Tap the core: start listening; tap again: stop and send.
document.addEventListener('click', async (e) => {
  if (!e.target.closest('#deck-core')) return;
  if (rec?.btn?.id === 'deck-mic') { stopDictation(); jvState('thinking'); await jvSettled(); const box = $('deck-text'); const text = box.value; box.value = ''; if (text.trim()) { jvTone('heard'); jvAsk(text); } else jvHeardNothing(); return; }
  jvStop(); jvWarm(); jvTone('listen'); $('deck-text').value = ''; startDictation($('deck-mic'), { hold: true, private: micPicked() }); jvState('listening');
});
document.addEventListener('submit', (e) => {
  if (e.target.id !== 'deck-form') return;
  e.preventDefault(); const box = $('deck-text'); const text = box.value; box.value = ''; jvAsk(text);
});
// Esc from any module comes back to the Deck (when nothing else is open or being typed in).
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.defaultPrevented || page === 'deck' || topDialog() || CV || jv.open) return;
  if (document.activeElement && document.activeElement !== document.body) return;
  location.hash = '#deck';
});
