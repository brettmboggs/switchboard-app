// Talk to type: Live (the browser's speech) or Private (Whisper on this computer).
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
// ---------- talk to type
// The page records the microphone (any browser allows that) and this computer's
// Switchboard turns speech into text with Whisper: nothing goes to Google, so it
// works in Brave too. Speech is cut at pauses and each piece is typed in as soon
// as it is ready, in order.
// The last dictation's unfinished words: sending waits for them.
let rec = null, dictated = Promise.resolve();
const WORKLET = `registerProcessor('sb-tap', class extends AudioWorkletProcessor {
  constructor() { super(); this.buf = []; this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) { this.buf.push(new Float32Array(ch)); this.n += ch.length; }
    if (this.n >= sampleRate / 10) { const out = new Float32Array(this.n); let o = 0; for (const b of this.buf) { out.set(b, o); o += b.length; } this.port.postMessage(out, [out.buffer]); this.buf = []; this.n = 0; }
    return true;
  }
});`;

function toWav16k(chunks, rate) {
  const len = chunks.reduce((n, c) => n + c.length, 0);
  const all = new Float32Array(len); let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
  const ratio = rate / 16000, n = Math.floor(len / ratio);
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * ratio), b = Math.min(len, Math.floor((i + 1) * ratio));
    let s = 0; for (let j = a; j < b; j++) s += all[j];
    const v = Math.max(-1, Math.min(1, s / Math.max(1, b - a)));
    pcm[i] = v < 0 ? v * 0x8000 : v * 0x7FFF;
  }
  const buf = new ArrayBuffer(44 + pcm.length * 2), d = new DataView(buf);
  const w = (p, s) => [...s].forEach((ch, i) => d.setUint8(p + i, ch.charCodeAt(0)));
  w(0, 'RIFF'); d.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true); d.setUint32(24, 16000, true);
  d.setUint32(28, 32000, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true); w(36, 'data'); d.setUint32(40, pcm.length * 2, true);
  new Int16Array(buf, 44).set(pcm);
  let bin = ''; const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// Where the words go. A text box: its value, after what was there. The
// notebook's page editor (a contenteditable; editor.js hangs `dictation` on
// it): at the caret, through the editor's own insert path, so one undo takes
// the words out and the sanitiser applies when the page is saved. set() shows
// the words so far (replacing the last call's); end() finishes.
function dictSink(target) {
  if (target.dictation) {
    if (!target.dictation.start()) return null;
    return { set: (text) => target.dictation.show(text), end: () => target.dictation.end() };
  }
  const base = target.value && !/\s$/.test(target.value) ? target.value + ' ' : target.value;
  return {
    set(text) {
      target.value = base + text;
      if (target.id === 'q-text') { draft['term:' + currentTerm] = target.value; growText(target); }
      if (target.id === 'r-text' && selected) draft[selected.key] = target.value;
      target.scrollTop = target.scrollHeight;
    },
    end() {}
  };
}

// Without Whisper (not set up, or a work laptop that blocks it), the browser's
// own speech recognition is the fallback: Chrome, Edge and Safari have it.
// Brave switches it off.
const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
const browserSpeech = !!Speech && !navigator.brave;
function startBrowserSpeech(btn, target) {
  const sink = dictSink(target); if (!sink) return false;
  const r = new Speech();
  r.continuous = true; r.interimResults = true; r.lang = navigator.language || 'en-US';
  let finals = '';
  r.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) finals += t; else interim += t; }
    sink.set((finals + interim).replace(/\s+([,.?!])/g, '$1'));
  };
  r.onerror = (e) => { if (e.error === 'not-allowed') toast('Allow the microphone for Switchboard to talk to type.'); else if (e.error !== 'aborted' && e.error !== 'no-speech') toast('This browser could not do talk to type. Set it up in Settings, General.'); };
  r.onend = () => { btn.classList.remove('on'); if (rec?.r === r) rec = null; sink.end(); };
  try { r.start(); } catch { sink.end(); return false; }
  rec = { btn, r, target, stop() { try { r.stop(); } catch {} } };
  btn.classList.add('on'); target.focus();
  return true;
}

function stopDictation() { rec?.stop(); }
async function startDictation(btn) {
  const target = $(btn.dataset.mic);
  if (!target) return;
  if (rec) { const same = rec.btn === btn; rec.stop(); if (same) return; }
  const v = S?.voice || {};
  const live = (S?.prefs?.voice || 'live') === 'live';
  if (live && browserSpeech && startBrowserSpeech(btn, target)) return;   // Private never sends audio to the browser's service
  if (!v.ready) {
    if (v.running) { toast(`Talk to type is still setting up: ${v.step || 'starting'}${v.progress ? ' ' + v.progress + '%' : ''}.`); return; }
    toast('Setting up talk to type: a one-time download, about 500 MB. The mic works as soon as it finishes.');
    api('/api/voice/setup', {}).then(load).catch((err) => toast(err.message, { kind: 'error' }));
    return;
  }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } }); }
  catch { toast('Allow the microphone for Switchboard to talk to type.'); return; }
  const ctx = new AudioContext();
  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
  await ctx.audioWorklet.addModule(url); URL.revokeObjectURL(url);
  const src = ctx.createMediaStreamSource(stream), tap = new AudioWorkletNode(ctx, 'sb-tap');
  src.connect(tap);
  const sink = dictSink(target);
  if (!sink) { stream.getTracks().forEach((t) => t.stop()); ctx.close(); return; }
  // Each piece of speech (cut at a pause of about 0.7 s, or 20 s of talking)
  // has its own place in the box. While you talk, the piece so far is
  // transcribed again every moment, so words show as you say them; at the
  // pause the finished piece replaces that draft.
  const pieces = [];
  let cur = null, chunks = [], speech = 0, quiet = 0, floor = 0.004, inflight = 0, finals = new Set();
  const show = () => sink.set(pieces.map((p) => p.text).filter(Boolean).join(' '));
  const ask = (wav) => { inflight++; btn.classList.add('busy'); return api('/api/transcribe', { wav }).finally(() => { if (--inflight === 0) btn.classList.remove('busy'); }); };
  const flush = (force) => {
    const enough = speech >= (force ? 2 : 3);   // in tenths of a second
    const piece = cur, audio = chunks;
    cur = null; chunks = []; speech = 0; quiet = 0;
    if (!piece) return;
    if (!enough) { piece.text = ''; show(); return; }
    piece.final = true;
    const job = ask(toWav16k(audio, ctx.sampleRate)).then((r) => { piece.text = r.text; show(); }).catch((err) => toast(err.message, { kind: 'error' })).finally(() => finals.delete(job));
    finals.add(job);
  };
  const draftNow = () => {
    if (!cur || cur.final || speech < 5 || inflight) return;   // one request at a time keeps slow computers keeping up
    const piece = cur;
    ask(toWav16k(chunks, ctx.sampleRate)).then((r) => { if (!piece.final) { piece.text = r.text; show(); } }).catch(() => {});
  };
  const timer = setInterval(draftNow, 700);
  tap.port.onmessage = (e) => {
    const block = e.data;
    let sum = 0; for (let i = 0; i < block.length; i++) sum += block[i] * block[i];
    const rms = Math.sqrt(sum / block.length);
    const talking = rms > Math.max(0.012, floor * 3);
    if (!talking) floor = floor * 0.95 + rms * 0.05;
    if (talking) {
      if (!cur) { cur = { text: '', final: false }; pieces.push(cur); }
      speech++; quiet = 0; chunks.push(block);
    }
    else if (cur) { quiet++; chunks.push(block); if (quiet >= 7) flush(false); }
    else { chunks = [block]; }   // keep a breath of lead-in
    if (chunks.length >= 200) flush(false);
  };
  rec = {
    btn, target,
    stop() {
      if (rec !== this) return;
      rec = null;
      clearInterval(timer);
      flush(true);
      try { src.disconnect(); tap.disconnect(); } catch {}
      stream.getTracks().forEach((t) => t.stop());
      ctx.close();
      btn.classList.remove('on');
      // The last piece is still being transcribed: the words land, then the editor's marker comes off.
      dictated = Promise.allSettled([...finals]).then(() => sink.end());
    }
  };
  btn.classList.add('on'); target.focus();
}
document.addEventListener('click', (e) => { const b = e.target.closest('[data-mic]'); if (b) { e.preventDefault(); startDictation(b); } });

async function addToComposer(textOrPromise) {
  const ta = $('q-text'); if (!ta) return;
  const before = ta.placeholder; ta.placeholder = 'Getting the message…';
  const text = await textOrPromise;
  ta.placeholder = before;
  if (!text) return;
  ta.value = (ta.value ? ta.value.trimEnd() + '\n\n' : '') + text;
  draft['term:' + currentTerm] = ta.value;
  ta.focus();
}

async function queueAct(kind, btn) {
  const t = termByKey(currentTerm); if (!t) return;
  stopDictation();
  if (btn) btn.disabled = true;
  try {
    if (kind === 'close') { await api(termPath(t, 'close'), {}); closeTerminal(); currentTerm = null; toast('Session ended.'); }
    else if (kind === 'interrupt') { await api(termPath(t, 'interrupt'), {}); toast('Stopped.'); }
    else {
      await dictated;
      const imgs = images['term:' + t.key] || [];
      const text = [$('q-text').value.trim(), ...imgs.map((x) => x.path)].filter(Boolean).join('\n');
      if (!text) { toast('Write something first.'); return; }
      // The agent is asking permission in the Chat view: a message is the
      // answer "No, do this instead", so say No first and send it straight in.
      let instead = false;
      if (kind !== 'hold' && chatOn(t.key) && cv?.menu && menuNoIndex() >= 0) {
        await api(termPath(t, 'menu'), { sig: cv.menu.sig, index: menuNoIndex() });
        cv.menu = null; renderChatLive();
        await new Promise((r) => setTimeout(r, 300));
        instead = true;
      }
      await api(termPath(t, 'queue'), { text, now: kind === 'now' || instead, held: kind === 'hold' });
      delete draft['term:' + t.key]; $('q-text').value = ''; growText($('q-text'));
      delete images['term:' + t.key]; renderImages();
      // In a chat the message itself shows up; only say something when it waits.
      const free = t.state === 'finished' || t.state === 'idle';
      if (kind === 'hold') toast('Held in the queue.');
      else if (!chatOn(t.key) || (!free && !instead && kind !== 'now')) toast(kind === 'now' || instead ? 'Sent.' : free ? 'Sent.' : 'Queued. It goes in when the agent is free.');
    }
    await load();
  } catch (e) { toast(e.message, { kind: 'error' }); }
  finally { if (btn && btn.isConnected) btn.disabled = false; }
}

document.addEventListener('click', (e) => {
  const tt = e.target.closest('[data-term]');
  if (tt) {
    const same = tt.dataset.term === currentTerm;
    currentTerm = tt.dataset.term; store.set('term', currentTerm);
    // Clicking the open tab again reconnects it if its connection dropped.
    if (same && tv.ws && tv.ws.readyState !== 1) closeTerminal();
    render(); return;
  }
  if (e.target.closest('[data-new-term]')) { openNewTerm(); return; }
  const qa = e.target.closest('[data-qact]');
  if (qa) { queueAct(qa.dataset.qact, qa); return; }
  const qi = e.target.closest('[data-qa]');
  if (qi) {
    const t = termByKey(currentTerm);
    const req = t?.remote ? api(termPath(t, qi.dataset.qa), { qid: Number(qi.dataset.q) }) : api(`/api/queue/${qi.dataset.q}/${qi.dataset.qa}`, {});
    req.then(load).catch((err) => toast(err.message, { kind: 'error' })); return;
  }
  const ul = e.target.closest('[data-unlink]');
  if (ul) { api('/api/links', { chatKey: ul.dataset.unlink, unlink: true }).then(load); return; }
  const ba = e.target.closest('[data-bring-add]');
  if (ba) { addToComposer(bringText(ba.dataset.bringAdd)); return; }
  const bm = e.target.closest('[data-bring-more]');
  if (bm) { toggleBring(bm.dataset.bringMore); return; }
}, true);
document.addEventListener('change', (e) => {
  if (e.target.dataset?.auto) api('/api/links', { chatKey: e.target.dataset.auto, auto: e.target.checked }).then(load);
});
document.addEventListener('dragstart', (e) => { const b = e.target.closest?.('[data-bring]'); if (b) e.dataTransfer.setData('application/x-switchboard-thread', b.dataset.bring); });
// Drop a conversation, text or an image anywhere on the terminal or the prompt.
const dropZone = (el) => el?.closest?.('#q-prompt, #term-host');
document.addEventListener('dragover', (e) => { if (dropZone(e.target)) { e.preventDefault(); $('q-prompt')?.classList.add('drop'); } });
document.addEventListener('dragleave', (e) => { if (dropZone(e.target) && !dropZone(e.relatedTarget)) $('q-prompt')?.classList.remove('drop'); });
document.addEventListener('drop', (e) => {
  if (!dropZone(e.target)) return;
  e.preventDefault(); $('q-prompt')?.classList.remove('drop');
  const key = e.dataTransfer.getData('application/x-switchboard-thread');
  addToComposer(key ? bringText(key) : e.dataTransfer.getData('text/plain'));
});
document.addEventListener('input', (e) => { if (e.target.id === 'q-text' && currentTerm) draft['term:' + currentTerm] = e.target.value; });
