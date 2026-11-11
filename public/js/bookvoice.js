// Listening to a book (bookreader.js): read aloud a sentence at a time, the
// words being read lit on the page, turning the page by itself; or a LibriVox
// recording, chapter by chapter, remembering where you stopped. With the
// natural voice installed (lib/tts.js, Piper) the sentences come from this
// computer; without it the browser's own voice reads. It keeps going on other
// pages, with a small player in the corner, so a book can be heard while a
// session works. Also the Settings card for the voice, and Jarvis's voice.
// One of the page's scripts in public/js, loaded in order by index.html; every
// name here starts with bv or BV.
const BV = { on: false, paused: false, lv: false, mode: '', book: null, title: '', n: 0, i: 0, list: [], open: false, carry: false, skipFirst: false, gen: 0, audio: new Audio(), wavs: new Map(), rate: Number(store.get('bvRate', 1)) || 1, saveAt: 0, pages: 0 };
const BV_RATES = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
const bvNatural = () => !!S?.voice?.installed;

// ---------- read aloud
// Play picks up at the sentence it stopped on when that is on the pages showing; otherwise it starts at
// the top of the left-hand page (with two pages up, the page number can be the right-hand one).
const bvSpotKey = (id) => 'bvSpot:' + id;
async function bvStart({ n, word } = {}) {
  if (!BK.book) return;
  if (word == null && BK.book.id === BK.open) {
    const vis = bkVisible(), spot = store.get(bvSpotKey(BK.book.id), null);
    if (spot && vis.includes(spot.n)) { n = spot.n; word = spot.w; }
    else if (n == null || vis.includes(n)) n = Math.min(...vis);
  }
  bvHalt();
  Object.assign(BV, { on: true, paused: false, lv: false, book: BK.book.id, title: BK.book.title, pages: BK.book.pages, carry: false, skipFirst: false, mode: bvNatural() ? 'natural' : 'browser' });
  const g = ++BV.gen;
  try { await bvPage(n ?? BK.n); } catch (e) { toast(e.message, { kind: 'error' }); bvStop(); return; }
  if (g !== BV.gen) return;
  BV.i = word == null ? 0 : Math.max(0, BV.list.findIndex((s) => s[1] >= word));
  if (!BV.list.length) { bvTurn(); return; }
  bvPlay();
}
async function bvPage(n) {
  const t = await bkText(n, BV.book);
  if (t.none) throw new Error('This copy of the book has page pictures only, no text to read aloud. Another copy of it on archive.org may have its text.');
  BV.n = n; BV.list = (t.said || []).slice(BV.skipFirst ? 1 : 0); BV.open = t.open; BV.skipFirst = false;
  BV.blank = BV.list.length ? 0 : (BV.blank || 0) + 1;
}
async function bvWav(text) {
  if (BV.wavs.has(text)) return BV.wavs.get(text);
  const p = fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Switchboard': '1' }, body: JSON.stringify({ text }) })
    .then(async (r) => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'The voice did not answer.'); return URL.createObjectURL(await r.blob()); });
  BV.wavs.set(text, p);
  p.catch(() => BV.wavs.delete(text));
  if (BV.wavs.size > 40) { const [k, old] = BV.wavs.entries().next().value; BV.wavs.delete(k); old.then((u) => URL.revokeObjectURL(u)).catch(() => {}); }
  return p;
}
async function bvPlay() {
  const g = BV.gen, s = BV.list[BV.i];
  if (!s) { bvTurn(); return; }
  let text = s[2];
  if (BV.i === BV.list.length - 1 && BV.open && BV.n + 1 < BV.pages) {   // the sentence runs on to the next page: read it whole
    const nx = await bkText(BV.n + 1, BV.book).catch(() => null);
    if (g !== BV.gen) return;
    if (nx?.said?.length) { text += ' ' + nx.said[0][2]; BV.carry = true; }
  }
  BK.say = { book: BV.book, n: BV.n, start: s[0], end: s[1] };
  store.set(bvSpotKey(BV.book), { n: BV.n, w: s[0] });
  if (BK.book?.id === BV.book && !bkVisible().includes(BV.n)) bkGo(BV.n, { fromVoice: true });   // the book follows the voice
  bkClasses(); bvPaint(); bkFollow();
  if (BV.mode === 'browser') {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = BV.rate;
    const v = speechSynthesis.getVoices().find((x) => x.localService && /^en/i.test(x.lang)); if (v) u.voice = v;
    u.onend = () => { if (g === BV.gen && !BV.paused) bvNext(); };
    speechSynthesis.speak(u);
    return;
  }
  try {
    const url = await bvWav(text);
    if (g !== BV.gen) return;
    BV.audio.src = url; BV.audio.playbackRate = BV.rate;
    await BV.audio.play();
    for (const k of [1, 2]) { const nx = BV.list[BV.i + k]; if (nx) bvWav(nx[2]).catch(() => {}); }
  } catch (e) {
    if (g !== BV.gen) return;
    toast(`${e.message} Reading with the built-in voice instead.`, { kind: 'error' });
    BV.mode = 'browser'; bvPlay();
  }
}
function bvNext() { BV.i++; if (BV.i >= BV.list.length) bvTurn(); else bvPlay(); }
async function bvTurn() {
  if (BV.n + 1 >= BV.pages) { bvStop(); toast(`That is the end of ${BV.title}.`); return; }
  if (BV.blank >= 4) { bvStop(); toast('No words on these pages to read (pictures or blank pages). Turn to a page of text and press Play.'); return; }   // never race through a book with no text
  const g = BV.gen;
  BV.skipFirst = BV.carry; BV.carry = false;
  try { await bvPage(BV.n + 1); } catch (e) { toast(e.message, { kind: 'error' }); bvStop(); return; }
  if (g !== BV.gen) return;
  BV.i = 0;
  if (BK.book?.id === BV.book && !bkVisible().includes(BV.n)) bkGo(BV.n, { fromVoice: true });   // the next page comes up with the voice
  if (!BV.list.length) bvTurn(); else bvPlay();
}
BV.audio.addEventListener('ended', () => {
  if (BV.lv) { const a = BK.book?.id === BV.book ? BK.book.audio : null; if (a && a.track + 1 < a.tracks.length) { a.track++; a.pos = 0; bvListen(); } else bvStop(); return; }
  if (BV.on && !BV.paused) bvNext();
});
BV.audio.addEventListener('timeupdate', () => { if (BV.lv && Date.now() - BV.saveAt > 15e3) bvSaveSpot(); });

// Stop the sound without forgetting what is open.
function bvHalt() { BV.gen++; BV.audio.pause(); if (window.speechSynthesis) speechSynthesis.cancel(); }
function bvStop() {
  if (BV.lv) bvSaveSpot();
  bvHalt();
  Object.assign(BV, { on: false, paused: false, lv: false });
  BK.say = null; bkClasses(); bvPaint();
}
function bvToggle() {
  if (!BV.on) return;
  BV.paused = !BV.paused;
  if (BV.mode === 'browser' && !BV.lv) { if (BV.paused) speechSynthesis.cancel(); else { BV.gen++; bvPlay(); } }
  else if (BV.paused) { BV.audio.pause(); if (BV.lv) bvSaveSpot(); }
  else BV.audio.play().catch(() => {});
  bvPaint();
}
function bvSkip(d) {
  if (!BV.on) return;
  if (BV.lv) { BV.audio.currentTime = Math.max(0, BV.audio.currentTime + d * 15); return; }
  BV.gen++; BV.audio.pause(); if (window.speechSynthesis) speechSynthesis.cancel();
  BV.paused = false; BV.i = Math.max(0, Math.min(BV.list.length - 1, BV.i + d)); bvPlay();
}

// ---------- LibriVox: the recording, chapter by chapter
function bvListen() {
  const b = BK.book, a = b?.audio; if (!a) return;
  bvHalt();
  Object.assign(BV, { on: true, paused: false, lv: true, mode: 'librivox', book: b.id, title: b.title });
  BK.say = null; bkClasses();
  const t = a.tracks[a.track];
  BV.audio.src = `https://archive.org/download/${encodeURIComponent(a.id)}/${encodeURIComponent(t.file)}`;
  BV.audio.playbackRate = BV.rate;
  BV.audio.addEventListener('loadedmetadata', () => { if (a.pos && a.pos < (BV.audio.duration || 1e9) - 5) BV.audio.currentTime = a.pos; }, { once: true });
  BV.audio.play().catch((e) => toast('The recording would not play: ' + e.message, { kind: 'error' }));
  bvSaveSpot(true); bvPaint();
}
function bvSaveSpot(now) {
  const a = BK.book?.id === BV.book ? BK.book?.audio : null; if (!a || !BV.lv) return;
  if (!now) a.pos = Math.round(BV.audio.currentTime || 0);
  BV.saveAt = Date.now();
  api(`/api/books/${encodeURIComponent(BV.book)}/audiobook`, { track: a.track, pos: a.pos }).catch(() => {});
}

// ---------- the player: under the book, or in the corner on other pages
const BV_I = {
  back: '<path d="M11 6 5 12l6 6M19 6l-6 6 6 6"/>', fwd: '<path d="m13 6 6 6-6 6M5 6l6 6-6 6"/>',
  play: '<path d="M7 5v14l12-7z"/>', pause: '<path d="M7 5h3v14H7zM14 5h3v14h-3z"/>', stop: '<path d="M6 6h12v12H6z"/>'
};
function bvControls() {
  const what = BV.lv ? (() => { const a = BK.book?.id === BV.book ? BK.book.audio : null; return a ? `${a.tracks[a.track].title} · LibriVox` : 'LibriVox'; })()
    : `${esc(BK.book?.id === BV.book ? bkName(BV.n) : '#' + (BV.n + 1))} · ${BV.mode === 'natural' ? esc((S.voice?.voices || []).find((v) => v.id === S.voice.voice)?.name || 'Natural voice') : 'Built-in voice'}`;
  return `<button class="bk-ib" type="button" data-bv="back" title="${BV.lv ? 'Back 15 seconds' : 'Back a sentence'}">${bkIcon(BV_I.back)}<span class="sr">Back</span></button>
    <button class="bk-ib bv-main" type="button" data-bv="toggle" title="${BV.paused ? 'Play' : 'Pause'}">${bkIcon(BV.paused ? BV_I.play : BV_I.pause)}<span class="sr">${BV.paused ? 'Play' : 'Pause'}</span></button>
    <button class="bk-ib" type="button" data-bv="fwd" title="${BV.lv ? 'Ahead 15 seconds' : 'Next sentence'}">${bkIcon(BV_I.fwd)}<span class="sr">Ahead</span></button>
    <span class="bv-what" title="${esc(what)}">${what}</span>
    <label class="sr" for="bv-rate">Speed</label><select id="bv-rate" class="field field--sm bv-rate" data-bv-rate>${BV_RATES.map((r) => `<option value="${r}" ${r === BV.rate ? 'selected' : ''}>${r}×</option>`).join('')}</select>
    <button class="bk-ib" type="button" data-bv="stop" title="Stop">${bkIcon(BV_I.stop)}<span class="sr">Stop</span></button>`;
}
// Under an open book the controls are always there: with nothing playing, Play reads from the page on screen.
function bvIdle() {
  const voice = bvNatural() ? esc((S.voice?.voices || []).find((v) => v.id === S.voice.voice)?.name || 'Natural voice') : 'Built-in voice';
  return `<button class="bk-ib" type="button" disabled title="Back a sentence">${bkIcon(BV_I.back)}<span class="sr">Back</span></button>
    <button class="bk-ib bv-main" type="button" data-bv="start" title="Read aloud from this page">${bkIcon(BV_I.play)}<span class="sr">Play</span></button>
    <button class="bk-ib" type="button" disabled title="Next sentence">${bkIcon(BV_I.fwd)}<span class="sr">Ahead</span></button>
    <span class="bv-what">${voice}</span>
    <label class="sr" for="bv-rate">Speed</label><select id="bv-rate" class="field field--sm bv-rate" data-bv-rate>${BV_RATES.map((r) => `<option value="${r}" ${r === BV.rate ? 'selected' : ''}>${r}×</option>`).join('')}</select>
    <button class="bk-ib" type="button" disabled title="Stop">${bkIcon(BV_I.stop)}<span class="sr">Stop</span></button>`;
}
function bvPaint() {
  const here = $('bk-player'), onBook = BV.on && BK.book?.id === BV.book && !!$('bk-reader');
  if (here) { here.hidden = false; bkSet(here, onBook ? bvControls() : bvIdle()); }
  const mini = $('bk-mini');
  if (!mini) return;
  const show = BV.on && !onBook;
  mini.hidden = !show;
  bkSet(mini, show ? `<button type="button" class="bv-title" data-bv="open" title="Open ${esc(BV.title)}">${esc(BV.title)}</button>${bvControls()}` : '');
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-bv]');
  if (b) {
    const w = b.dataset.bv;
    if (w === 'start') bvStart({ n: BK.n }); else if (w === 'toggle') bvToggle(); else if (w === 'stop') bvStop(); else if (w === 'back') bvSkip(-1); else if (w === 'fwd') bvSkip(1);
    else if (w === 'open') bkOpenBook(BV.book);
    return;
  }
  if (e.target.closest('[data-bv-lv]')) {
    const sel = document.querySelector('[data-bv-track]'), a = BK.book?.audio;
    if (a && sel && Number(sel.value) !== a.track) { a.track = Number(sel.value); a.pos = 0; }
    bvListen(); return;
  }
  const ins = e.target.closest('[data-bv-install]');
  if (ins) {
    const v = $('bv-pick')?.value || $('voice-pick')?.value || 'en_US-ryan-high';
    ins.disabled = true;
    try { S.voice = await api('/api/voice/install', { voice: v }); bvWatchInstall(); } catch (err) { toast(err.message, { kind: 'error' }); ins.disabled = false; }
    bkPaintSide(); renderVoiceCard(); return;
  }
  if (e.target.closest('[data-voice-hear]')) {
    const btn = e.target.closest('[data-voice-hear]'); btn.disabled = true;
    try { const a = new Audio(await bvWav('Good evening. This is how your books will sound when I read them to you.')); a.addEventListener('ended', () => { btn.disabled = false; }); await a.play(); }
    catch (err) { toast(err.message, { kind: 'error' }); btn.disabled = false; }
    return;
  }
  if (e.target.closest('[data-voice-remove]')) {
    const btn = e.target.closest('[data-voice-remove]');
    if (btn.dataset.sure !== '1') { btn.dataset.sure = '1'; btn.textContent = 'Remove the voice'; return; }
    if (BV.on && BV.mode === 'natural') bvStop();
    try { S.voice = await api('/api/voice/remove', {}); toast('The natural voice is removed. Read aloud uses the built-in voice.'); } catch (err) { toast(err.message, { kind: 'error' }); }
    renderVoiceCard(); load();
  }
});
document.addEventListener('change', async (e) => {
  const r = e.target.closest?.('[data-bv-rate]');
  if (r) { BV.rate = Number(r.value) || 1; store.set('bvRate', BV.rate); BV.audio.playbackRate = BV.rate; if (BV.mode === 'browser' && BV.on && !BV.lv && !BV.paused) { BV.gen++; speechSynthesis.cancel(); bvPlay(); } return; }
  const v = e.target.closest?.('[data-bv-voice], [data-voice-use]');
  if (v) { try { S.voice = await api('/api/voice/settings', { voice: v.value }); BV.wavs.clear(); toast('Voice changed.'); } catch (err) { toast(err.message, { kind: 'error' }); } renderVoiceCard(); return; }
  const j = e.target.closest?.('[data-voice-jarvis]');
  if (j) { try { S.voice = await api('/api/voice/settings', { jarvis: j.checked }); toast(j.checked ? 'Jarvis speaks with the natural voice now.' : 'Jarvis uses the built-in voice again.'); } catch (err) { j.checked = !j.checked; toast(err.message, { kind: 'error' }); } }
});

// While a voice installs, the board does not hear about each megabyte: ask.
function bvWatchInstall() {
  clearTimeout(BV.watch);
  BV.watch = setTimeout(async () => {
    try { S.voice = await api('/api/voice'); } catch { /* try again */ }
    renderVoiceCard(); bkPaintSide();
    if (S.voice?.installing) bvWatchInstall();
    else if (S.voice?.installed) toast('The natural voice is ready. Read aloud uses it now.');
    else if (S.voice?.error) toast(S.voice.error, { kind: 'error' });
  }, 1000);
}
function bvInstallWords(v) {
  const j = v.installing || {}, mb = (x) => Math.round(x / 1e6);
  return j.total ? `Downloading ${esc(j.what)}: ${mb(j.got)} of ${mb(j.total)} MB…` : j.what === 'unpacking' ? 'Unpacking the voice program…' : j.what === 'testing' ? 'Trying the voice…' : 'Starting the download…';
}

// ---------- Settings, Connections: the voice
function renderVoiceCard() {
  const el = $('voice-card'); if (!el || !S) return;
  const v = S.voice || {};
  const head = '<div class="acct-main"><b>Read-aloud voice</b><span class="acct-line">';
  if (!v.supported) { el.innerHTML = `${head}The natural voice is not available for this kind of computer yet; books are read with the built-in voice.</span></div>`; return; }
  if (v.installing) { el.innerHTML = `${head}${bvInstallWords(v)}</span></div>`; bvWatchInstall(); return; }
  if (!v.installed) {
    el.innerHTML = `${head}A natural voice that reads your books aloud (and can be Jarvis's voice): Piper, free and open source, runs on this computer, works offline. Pick a voice; it downloads once (60 to 145 MB).${v.error ? ` <span class="bad-text">${esc(v.error)}</span>` : ''}</span></div>
      <div class="acct-wide form-row"><select class="field field--sm" id="voice-pick" aria-label="Voice">${v.voices.map((x) => `<option value="${x.id}">${esc(x.name)}, ${esc(x.what)} (${x.mb} MB)</option>`).join('')}</select><button class="btn" type="button" data-bv-install>Install</button></div>`;
    return;
  }
  const have = v.voices.filter((x) => x.have), more = v.voices.filter((x) => !x.have);
  el.innerHTML = `${head}Installed. Books are read aloud with it${v.jarvis ? ', and Jarvis speaks with it' : ''}.</span></div>
    <div class="acct-wide form-row"><select class="field field--sm" data-voice-use aria-label="Voice in use">${have.map((x) => `<option value="${x.id}" ${x.id === v.voice ? 'selected' : ''}>${esc(x.name)}, ${esc(x.what)}</option>`).join('')}</select>
      <button class="btn btn--quiet" type="button" data-voice-hear>Hear it</button><label class="toggle-inline"><input type="checkbox" data-voice-jarvis ${v.jarvis ? 'checked' : ''}> Jarvis speaks with it</label>
      ${more.length ? `<select class="field field--sm" id="voice-pick" aria-label="Another voice">${more.map((x) => `<option value="${x.id}">${esc(x.name)}, ${esc(x.what)} (${x.mb} MB)</option>`).join('')}</select><button class="btn btn--quiet" type="button" data-bv-install>Add voice</button>` : ''}
      <button class="btn btn--quiet" type="button" data-voice-remove>Remove</button></div>`;
}

// ---------- Jarvis in the natural voice (Settings: "Jarvis speaks with it")
const JVN = { gen: 0, chain: Promise.resolve(), audio: null };
const jvNaturalOn = () => !!(S?.voice?.installed && S.voice.jarvis);
// Each sentence is asked for as soon as it is written and played in order.
function jvNatural(text, done) {
  const g = JVN.gen, wav = bvWav(text);
  JVN.chain = JVN.chain.then(async () => {
    if (g !== JVN.gen) return;
    try {
      const a = JVN.audio = new Audio(await wav);
      a.playbackRate = 1.05;
      await new Promise((res) => { a.onended = a.onerror = res; a.play().catch(res); });
    } catch { /* a sentence that fails is skipped */ }
  }).finally(done);
}
function jvNaturalStop() { JVN.gen++; JVN.audio?.pause(); JVN.chain = Promise.resolve(); }
