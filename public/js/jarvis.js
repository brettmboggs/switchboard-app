// Jarvis: the core at the centre of the Deck (deck.js), and the small core in
// the ring at the top of every other page, whose panel drops down under it.
// Hold Ctrl+Space anywhere and talk (or tap a core, or type); let go and it
// answers out loud and does it: shows a page,
// opens a session, adds a reminder, sends a session a job (lib/jarvis.js).
// Hearing is talk to type (voice.js: Live or Private, as set in Settings);
// speaking is this browser's own voice, so it costs nothing.
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
const jv = { open: false, holding: false, busy: false, history: [], log: [], muted: store.get('jv.muted', false), model: store.get('jv.model', ''), brain: null, models: [] };
const JV_MIC = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';

function jvMount() {
  if ($('jv-orb')) return;
  ($('ring-jarvis') || document.body).insertAdjacentHTML('beforeend', `<button class="jv-orb" id="jv-orb" type="button" data-state="idle" aria-label="Jarvis" title="Jarvis: click to talk or type, or hold ${MOD === '⌘' ? '⌘' : 'Ctrl'}+Space anywhere"></button>`);
  document.body.insertAdjacentHTML('beforeend', `
    <section class="jv-panel" id="jv-panel" hidden aria-label="Jarvis">
      <div class="jv-head"><h2>Jarvis</h2><span class="jv-brain" id="jv-brain"></span><span class="grow"></span>
        <select class="jv-model" id="jv-model" hidden title="Which model on this computer does the thinking"></select>
        <button class="jv-icon" type="button" id="jv-new" title="Start afresh: forget this conversation">New</button>
        <button class="jv-icon" type="button" id="jv-mute" aria-pressed="${jv.muted}" title="Answer out loud, or only in writing">${jv.muted ? 'Muted' : 'Voice on'}</button>
        <button class="jv-icon" type="button" id="jv-close" title="Close (Esc)">✕</button></div>
      <div class="jv-log" id="jv-log" aria-live="polite"></div>
      <div class="jv-input"><label for="jv-text" class="sr">Ask Jarvis</label><textarea id="jv-text" rows="1" placeholder="Ask or tell me anything…"></textarea>
        <button class="mic" type="button" id="jv-mic" data-mic="jv-text" title="Talk">${JV_MIC}<span class="sr">Talk</span></button>
        <button class="jv-send" type="button" id="jv-send">Go</button></div>
    </section>`);
  jvRender();
}

function jvState(s) {
  const o = $('jv-orb'); if (!o || o.dataset.state === s) return;
  o.dataset.state = s;
  // The wave along the bottom (jarviswave.js): your voice while it listens, its words while it speaks.
  if (s === 'listening') jvWave.start('listen'); else if (s === 'speaking') jvWave.start('speak'); else jvWave.stop();
}
function jvRender() {
  const log = $('jv-log'); if (!log) return;
  log.innerHTML = jv.log.length ? jv.log.map((m) => `<div class="jv-say ${m.who}">${esc(m.text)}${m.note ? `<small>${esc(m.note)}</small>` : ''}</div>`).join('')
    : `<p class="jv-hint">Hold <kbd>${MOD === '⌘' ? '⌘' : 'Ctrl'}</kbd> + <kbd>Space</kbd> anywhere and talk, then let go. Try "what needs me", "go to builds", "open the switchboard session", "remind me tomorrow at 9 to call the bank", or ask a session to do something.</p>`;
  log.scrollTop = log.scrollHeight;
  if (page === 'deck') deckTalk();
  $('jv-brain').textContent = jv.brain ? `· ${jv.brain}` : '';
  const sel = $('jv-model');
  if (jv.models.length > 1) {
    sel.hidden = false;
    sel.innerHTML = `<option value="">Quickest</option>` + jv.models.map((m) => `<option value="${esc(m)}" ${m === jv.model ? 'selected' : ''}>${esc(modelName(m))}</option>`).join('');
  }
}
function jvOpen(on = true) {
  jvMount(); jv.open = on;
  $('jv-panel').hidden = !on;
  if (on) setTimeout(() => $('jv-text')?.focus(), 0);
  else { stopDictation(); jvStop(); jvState('idle'); }
}

// ---- speaking: the browser's own voice; a deeper English one if there is one.
let jvVoice = null;
function pickVoice() {
  const vs = speechSynthesis?.getVoices?.() || [];
  jvVoice = vs.find((v) => /Daniel|Google UK English Male|Ryan|Guy/i.test(v.name)) || vs.find((v) => /en-GB/i.test(v.lang)) || vs.find((v) => /^en/i.test(v.lang)) || null;
}
if (window.speechSynthesis) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
// The answer arrives in pieces (POST /api/jarvis/stream) and is spoken a
// sentence at a time as each one completes, so the first words come while the
// model is still writing the rest. A long first sentence is cut at a comma so
// it starts sooner.
const jvSay = { buf: '', pending: 0, done: true };
const jvSpoken = (t) => String(t).replace(/<think>[\s\S]*?<\/think>/g, '').replace(/[*_`#>]+/g, '').replace(/\p{Extended_Pictographic}/gu, '').replace(/\s+/g, ' ').trim();
function jvUtter(text) {
  text = jvSpoken(text);
  if (!text || jv.muted) return;
  if (jvNaturalOn()) {   // the natural voice, when chosen in Settings (bookvoice.js)
    jvSay.pending++; jvState('speaking');
    jvNatural(text, () => { jvSay.pending = Math.max(0, jvSay.pending - 1); if (!jvSay.pending && jvSay.done) jvState('idle'); });
    return;
  }
  if (!window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(text);
  if (jvVoice) u.voice = jvVoice;
  u.rate = 1.05; u.pitch = 0.95;
  jvSay.pending++;
  u.onstart = () => jvState('speaking');
  u.onboundary = () => jvWave.pulse();
  u.onend = u.onerror = () => { jvSay.pending = Math.max(0, jvSay.pending - 1); if (!jvSay.pending && jvSay.done) jvState('idle'); };
  speechSynthesis.speak(u);
}
function jvSayStart() { jvSay.buf = ''; jvSay.pending = 0; jvSay.done = false; }
function jvFeed(piece) {
  jvSay.buf += piece;
  for (;;) {
    const m = jvSay.buf.match(/^([\s\S]*?[.!?…])\s+/) || (jvSay.buf.length > 110 && jvSay.buf.slice(40).includes(', ') ? [null, jvSay.buf.slice(0, jvSay.buf.lastIndexOf(', ') + 1)] : null);
    if (!m) break;
    jvUtter(m[1]); jvSay.buf = jvSay.buf.slice(m[1].length).replace(/^\s+/, '');
  }
}
function jvSayEnd() {
  if (jvSay.buf) jvUtter(jvSay.buf);
  jvSay.buf = ''; jvSay.done = true;
  if (!jvSay.pending) jvState('idle');
}
function jvSpeak(text) { jvSayStart(); jvFeed(text); jvSayEnd(); }

// Talking over Jarvis stops him: the voice goes quiet and the model stops writing.
function jvStop() {
  if (jv.ac) { jv.ac.abort(); jv.ac = null; }
  jvSay.buf = ''; jvSay.pending = 0; jvSay.done = true;
  speechSynthesis?.cancel();
  jvNaturalStop();
}
// Ctrl+Space down: have the model loaded by the time you let go (once a minute at most).
function jvWarm() {
  if (Date.now() - (jv.warmAt || 0) < 60e3) return;
  jv.warmAt = Date.now();
  api('/api/jarvis/warm', { model: jv.model || null }).catch(() => {});
}
// Two short tones, made here (no sound files): up when it starts listening,
// down when it has your words, so a pause never feels like it froze.
let jvAudio = null;
function jvTone(kind) {
  try {
    jvAudio ||= new AudioContext();
    const t = jvAudio.currentTime;
    ({ listen: [660, 990], heard: [990, 660] })[kind].forEach((f, i) => {
      const o = jvAudio.createOscillator(), g = jvAudio.createGain(), at = t + i * 0.07;
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(0.06, at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);
      o.connect(g).connect(jvAudio.destination); o.start(at); o.stop(at + 0.13);
    });
  } catch { /* no sound is fine */ }
}

// ---- doing what it said
function jvAct(a) {
  if (a.go === 'settings') { openSettings(); return; }
  if (a.go === 'monitor') { openMonitor(); return; }
  if (a.go === 'network') { stOpen(); return; }
  if (a.window === 'speedtest') { stOpen({ announce: !!a.announce }); return; }
  if (a.book) { bkOpenBook(a.book, { read: !!a.read }); return; }
  if (a.readStop) { bvStop(); return; }
  if (a.bookmark) { if (bkOn()) bkToggleBookmark(); else toast('Open a book first: Inbox, Reading.'); return; }
  if (a.reading) { inboxTab = 'reading'; store.set('inboxTab', inboxTab); BK.what = 'books'; }
  if (a.go) { location.hash = '#' + a.go; return; }
  if (a.open) { currentTerm = a.open; store.set('term', currentTerm); if (location.hash !== '#sessions') location.hash = '#sessions'; else render(); }
}

// A fresh start after a few quiet minutes: Jarvis is for quick things, and an
// old exchange only slows the model down (lib/jarvis.js keeps it short too).
const JV_FRESH = 3 * 60e3;
function jvNew() { jv.history = []; jv.log = []; jvRender(); }
async function jvAsk(text) {
  text = String(text || '').trim();
  if (!text) return;
  if (jv.busy) jvStop();
  // "Brief me" / "good morning": the morning brief, any time (jarvisspeak.js), with no model.
  if (/^(hey jarvis,? )?(brief me|morning brief|give me the brief|good morning|catch me up)[.!?]*$/i.test(text)) { jv.log.push({ who: 'you', text }); jvBrief('Brief'); return; }
  if (jv.lastAt && Date.now() - jv.lastAt > JV_FRESH) { jv.history = []; jv.log.push({ who: 'me', text: 'Fresh start.', note: 'A few quiet minutes clear what came before' }); }
  jv.lastAt = Date.now();
  jv.busy = true; jvState('thinking');
  jv.log.push({ who: 'you', text }); jvRender();
  const t = currentTerm && termByKey(currentTerm);
  const ac = new AbortController(); jv.ac = ac;
  const me = { who: 'me', text: '' };
  let drew = 0;
  const draw = () => { if (Date.now() - drew > 80) { drew = Date.now(); jvRender(); } };
  jvSayStart();
  try {
    let res;
    try { res = await fetch('/api/jarvis/stream', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Switchboard': '1' }, body: JSON.stringify({ text, history: jv.history, page, session: t ? termLabel(t) : '', model: jv.model || null }), signal: ac.signal }); }
    catch (e) { if (ac.signal.aborted) throw e; throw new Error('Switchboard\'s server is not answering. It may be restarting after an update: wait a few seconds and try again.'); }
    if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'Jarvis could not answer just now. Try again.'); }
    const dec = new TextDecoder(); let buf = '', end = null;
    for await (const chunk of res.body) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let o; try { o = JSON.parse(line); } catch { continue; }
        if (o.act) jvAct(o.act);
        else if (o.done) end = o;
        else if (o.say) { if (!me.text) jv.log.push(me); me.text += o.say; jvFeed(o.say); draw(); }
      }
    }
    if (!end) throw new Error('Jarvis stopped before finishing. Try again.');
    if (end.model) jv.brain = modelName(end.model);
    if (end.models) jv.models = end.models;
    me.text = jvSpoken(me.text) || end.say;
    if (!jv.log.includes(me)) jv.log.push(me);
    if (end.noBrain) me.note = 'Quick commands only';
    jv.history.push({ role: 'user', content: text }, { role: 'assistant', content: me.text });
    jv.history = jv.history.slice(-6);
  } catch (e) {
    if (ac.signal.aborted) { if (me.text) me.note = 'Stopped'; }
    else { me.text = e.message; if (!jv.log.includes(me)) jv.log.push(me); jvSpeak('That did not work.'); }
  } finally {
    jv.log = jv.log.slice(-30); jvRender();
    if (jv.ac === ac) { jv.ac = null; jv.busy = false; jvSayEnd(); }
    else if (!jv.ac) jv.busy = false;   // stopped by talking over it, with nothing new asked yet
  }
}

// Where your words go: the Deck's command line on the Deck, the panel's box elsewhere.
const jvBox = () => (page === 'deck' && $('deck-text') ? { text: $('deck-text'), mic: $('deck-mic') } : { text: $('jv-text'), mic: $('jv-mic') });
// The words are in once talk to type has finished and the box has stopped changing.
async function jvSettled() {
  await dictated;
  const box = jvBox().text;
  let last = null, same = 0;
  for (let i = 0; i < 30 && same < 4; i++) { await new Promise((r) => setTimeout(r, 150)); const v = box.value; same = v === last ? same + 1 : 0; last = v; }
}
async function jvSendBox() {
  const box = jvBox().text; const text = box.value; box.value = '';
  await jvAsk(text);
}

// Nothing came through: say so, rather than going quiet.
function jvHeardNothing() {
  const msg = 'I didn\'t catch that. Hold Ctrl and Space while you talk, and let go when you finish. If it keeps happening, check that the right microphone is picked on this computer.';
  jv.log.push({ who: 'me', text: msg }); jv.log = jv.log.slice(-30); jvRender(); jvSpeak('I didn\'t catch that.');
}

// ---- hold Ctrl+Space (⌘+Space is the Mac's Spotlight, so Ctrl there too) to talk.
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || !e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
  e.preventDefault(); e.stopPropagation();
  if (e.repeat || jv.holding) return;
  jv.holding = true;
  if (page !== 'deck') jvOpen(true);
  jvStop(); jvWarm(); jvTone('listen');
  const box = jvBox(); box.text.value = '';
  // The microphone takes a moment to open: letting go before it has must still stop it.
  jv.starting = rec ? Promise.resolve() : Promise.resolve(startDictation(box.mic, { hold: true, private: micPicked() })).catch((err) => console.warn('[Jarvis] microphone', err));
  jvState('listening');
}, true);
window.addEventListener('keyup', async (e) => {
  if (!jv.holding || (e.code !== 'Space' && e.key !== 'Control')) return;
  e.preventDefault(); e.stopPropagation();
  jv.holding = false;
  await jv.starting; stopDictation(); jvState('thinking');
  await jvSettled();
  if (jvBox().text.value.trim()) { jvTone('heard'); jvSendBox(); } else jvHeardNothing();
}, true);

document.addEventListener('click', (e) => {
  if (e.target.closest('#jv-orb')) { jvOpen(!jv.open); return; }
  if (e.target.closest('#jv-close')) { jvOpen(false); return; }
  if (e.target.closest('#jv-send')) { jvSendBox(); return; }
  if (e.target.closest('#jv-new')) { jvNew(); return; }
  if (e.target.closest('#jv-mute')) {
    jv.muted = !jv.muted; store.set('jv.muted', jv.muted);
    const b = $('jv-mute'); b.setAttribute('aria-pressed', jv.muted); b.textContent = jv.muted ? 'Muted' : 'Voice on';
    if (jv.muted) { speechSynthesis?.cancel(); jvSay.pending = 0; if (!jv.busy) jvState('idle'); }
  }
});
document.addEventListener('change', (e) => { if (e.target.id === 'jv-model') { jv.model = e.target.value; store.set('jv.model', jv.model); } });
document.addEventListener('keydown', (e) => {
  if (e.target.id === 'jv-text' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); jvSendBox(); }
  if (e.key === 'Escape' && jv.open && (e.target.closest?.('#jv-panel') || e.target === document.body)) jvOpen(false);
});
// The orb's glow follows the mic while talk to type listens.
setInterval(() => { if (!jv.holding && !jv.busy && ['jv-mic', 'deck-mic'].includes(rec?.btn?.id)) jvState('listening'); else if (!jv.holding && !jv.busy && $('jv-orb')?.dataset.state === 'listening' && !rec) jvState('idle'); }, 300);
if (!window.WEB) jvMount();
