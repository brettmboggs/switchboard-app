// The open book, in Inbox's right column (books.js puts the shell there): the
// page scan as archive.org has it, with an invisible layer of its words (from
// archive.org's OCR) on top, so a drag across words selects them like text.
// A selection offers Highlight (four colours), Note, Read from here and Copy.
// Fit width (the default: small print stays readable) or Fit page, which shows
// two pages side by side like an open book when the column is wide enough;
// Text shows the page's words as plain text instead of the scan. Night dims the
// white paper. Arrow keys turn pages, B bookmarks, the ⤢ button gives the book
// the whole width. Notes opens the side: shelf, tags, listening, and every
// bookmark, highlight and note, each a click from its page.
// Painting is in parts (head, stage, side, foot), each redrawn only when its
// HTML changes; selections and the sentence being read only switch classes on
// the word boxes, so the page picture never reloads under you.
// One of the page's scripts in public/js, loaded in order by index.html.
const BK_COLORS = ['yellow', 'green', 'blue', 'pink'];

async function bkLoad() {
  const id = BK.open;
  if (!id || BK.loading === id) return;
  BK.loading = id; BK.err = '';
  try {
    const b = await api('/api/books/' + encodeURIComponent(id));
    if (BK.open !== id) return;
    BK.book = b; BK.n = b.page; BK.text = new Map();
  } catch (e) { BK.err = e.message; }
  BK.loading = '';
  bkSync();
}
// One page's words: { w, h, words: [[x0, y0, x1, y1, text]], br, pe, skip, said }.
function bkText(n, id = BK.open) {
  const key = id + ':' + n;
  if (!BK.text.has(key)) BK.text.set(key, api(`/api/books/${encodeURIComponent(id)}/text/${n}`).catch((e) => { BK.text.delete(key); throw e; }));
  return BK.text.get(key);
}
const bkTextNow = (n) => BK.text.get(BK.open + ':' + n)?.done;
// Two numbers for a page: where it is in the scan (1 to N, what the box and slider count) and the
// number printed on it, which front matter does not have (a book's printed page 2 can be its 14th page).
const bkLabel = (n) => BK.book?.leaves[n]?.p || '';
const bkName = (n) => bkLabel(n) ? `p. ${bkLabel(n)}` : `#${n + 1}`;
const bkMarks = (n) => (BK.book?.marks || []).filter((m) => m.page === n);
const bkBookmarked = (n) => bkMarks(n).some((m) => m.kind === 'bookmark');

// ---------- paint
function bkSync() {
  const host = $('bk-reader');
  document.body.toggleAttribute('data-bk-focus', !!host && !!BK.focus);   // always true or false: undefined would toggle it on every redraw
  if (!host) return;
  if (!BK.book || BK.book.id !== BK.open) {
    const msg = BK.err ? `<p class="cv-note bad-text">${esc(BK.err)}</p>` : '<p class="cv-note">Opening the book…</p>';
    if (host.dataset.msg !== msg) { host.innerHTML = msg; host.dataset.msg = msg; }
    if (!BK.err) bkLoad();
    return;
  }
  if (!host.querySelector('.bk-head')) {
    host.dataset.msg = '';
    host.innerHTML = `<header class="bk-head" id="bk-head"></header><div class="bk-body"><div class="bk-stagewrap"><div class="bk-stage" id="bk-stage"></div>
      <button class="bk-turn bk-turn-prev" type="button" data-bk="prev" tabindex="-1" aria-hidden="true"></button><button class="bk-turn bk-turn-next" type="button" data-bk="next" tabindex="-1" aria-hidden="true"></button></div>
      <aside class="bk-side" id="bk-side" hidden></aside></div><footer class="bk-foot" id="bk-foot"></footer>`;
    new ResizeObserver(() => bkPaintStage()).observe($('bk-stage'));
  }
  bkPaintHead(); bkPaintStage(); bkPaintSide(); bkPaintFoot();
}
const bkSet = (el, html) => { if (el && el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; } };
const bkIcon = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const BK_I = {
  prev: '<path d="m15 5-7 7 7 7"/>', next: '<path d="m9 5 7 7-7 7"/>', mark: '<path d="M6 3h12v18l-6-4.5L6 21z"/>',
  night: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>', wide: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>', close: '<path d="m6 6 12 12M18 6 6 18"/>',
  speak: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>'
};

function bkPaintHead() {
  const b = BK.book, n = BK.n, vis = bkVisible();
  const marked = vis.some(bkBookmarked), notes = b.marks.filter((m) => m.kind !== 'bookmark').length;
  bkSet($('bk-head'), `<div class="bk-title"><b title="${esc(b.title)}">${esc(b.title)}</b><span title="${esc(b.author)}">${esc(b.author.replace(/,\s*\d{4}-.*$/, ''))}</span></div>
    <div class="bk-nav"><button class="bk-ib" type="button" data-bk="prev" title="Previous page (←)" ${n <= 0 ? 'disabled' : ''}>${bkIcon(BK_I.prev)}<span class="sr">Previous page</span></button>
      <label class="bk-pgl"><span class="sr">Page</span><input class="field field--sm bk-pg" data-bk-goto value="${n + 1}" autocomplete="off" spellcheck="false" title="Type a page in the scan (1 to ${b.pages}), or p 14 for the book's printed page 14"></label><span class="bk-of">of ${b.pages}${bkLabel(n) ? ` · <span title="The page number printed in the book">p. ${esc(bkLabel(n))}</span>` : ''}</span>
      <button class="bk-ib" type="button" data-bk="next" title="Next page (→)" ${n >= b.pages - 1 ? 'disabled' : ''}>${bkIcon(BK_I.next)}<span class="sr">Next page</span></button></div>
    <div class="bk-acts"><button class="bk-ib" type="button" data-bk="mark" aria-pressed="${marked}" title="${marked ? 'Remove the bookmark' : 'Bookmark this page'} (B)">${bkIcon(BK_I.mark)}<span class="sr">Bookmark</span></button>
      <div class="seg bk-seg" role="group" aria-label="Show"><button type="button" data-bk-view="width" aria-pressed="${BK.view === 'scan' && !BK.fitPage}">Width</button><button type="button" data-bk-view="page" aria-pressed="${BK.view === 'scan' && !!BK.fitPage}">Page</button><button type="button" data-bk-view="text" aria-pressed="${BK.view === 'text'}">Text</button></div>
      <button class="bk-ib" type="button" data-bk="night" aria-pressed="${BK.night}" title="Night: dim the paper">${bkIcon(BK_I.night)}<span class="sr">Night</span></button>
      <button class="btn btn--sm" type="button" data-bk="read" title="Read aloud from this page">${bkIcon(BK_I.speak)}Read aloud</button>
      <button class="btn btn--quiet btn--sm" type="button" data-bk="side" aria-pressed="${BK.side}">Notes${notes ? ` <span class="c">${notes}</span>` : ''}</button>
      <button class="bk-ib" type="button" data-bk="focus" aria-pressed="${BK.focus}" title="${BK.focus ? 'Back to the list' : 'Give the book the whole width'}">${bkIcon(BK_I.wide)}<span class="sr">Whole width</span></button>
      <button class="bk-ib" type="button" data-bk="close" title="Close the book">${bkIcon(BK_I.close)}<span class="sr">Close</span></button></div>`);
}

// Which pages show: one, or two side by side (Fit page in a wide column), like an open book.
// Decided on the book's usual page shape, not this page's, so turning never flips between one and two.
const bkShape = (b) => b.shape || (b.shape = (() => { const r = b.leaves.map((p) => p.w / p.h).filter((x) => x > 0).sort((x, y) => x - y); return r[r.length >> 1] || 0.7; })());
function bkVisible() {
  const b = BK.book, n = BK.n, st = $('bk-stage');
  if (BK.view !== 'scan' || !BK.fitPage || !st || n === 0) return [n];
  const H = st.clientHeight - 16, W = st.clientWidth - 16;
  if (W < H * bkShape(b) * 2 + 12) return [n];
  const left = n % 2 ? n : n - 1, pair = [left, left + 1].filter((i) => i < b.pages);
  return b.rtl ? pair.reverse() : pair;
}
function bkPaintStage() {
  const st = $('bk-stage'); if (!st || !BK.book) return;
  const b = BK.book, vis = bkVisible();
  st.classList.toggle('night', !!BK.night);
  st.classList.toggle('bk-textview', BK.view === 'text');
  if (BK.view === 'text') {
    const t = bkTextNow(BK.n);
    const key = `text|${BK.n}|${!!t}`;
    if (st.dataset.key !== key) {
      st.dataset.key = key;
      st.innerHTML = t ? `<article class="bk-text" data-n="${BK.n}">${bkTextHtml(t) || '<p class="muted">No text was read from this page (a picture, or a blank page).</p>'}</article>` : '<p class="cv-note">Reading the page…</p>';
      st.scrollTop = 0;
    }
    if (!t) bkFetch(BK.n);
    bkClasses(); return;
  }
  const W = st.clientWidth - 16, H = st.clientHeight - 16, gap = 12;
  const asp = vis.map((i) => b.leaves[i].w / b.leaves[i].h);
  const h = Math.max(200, Math.min(H, (W - gap * (vis.length - 1)) / asp.reduce((x, y) => x + y, 0)));
  const sizes = BK.fitPage ? asp.map((a) => [Math.round(h * a), Math.round(h)]) : asp.map((a) => { const w = Math.max(200, Math.min(W, 1400)); return [w, Math.round(w / a)]; });
  // archive.org's half-size picture (about 950 pixels wide) is sharp enough unless the page is shown wider than that.
  const big = Math.max(...sizes.map((x) => x[0])) * (devicePixelRatio || 1) > b.leaves[vis[0]].w / 2 * 1.15;
  const key = `scan|${vis.join(',')}|${sizes.flat().join(',')}|${big}`;
  if (st.dataset.key !== key) {
    const same = (st.dataset.key || '').startsWith(`scan|${vis.join(',')}|`), old = st.querySelector('.bk-pages');
    st.dataset.key = key;
    if (same && old && old.dataset.big === String(big)) {   // the same pages, a new size: no reload
      old.querySelectorAll('.bk-page').forEach((el, k) => { el.style.width = sizes[k][0] + 'px'; el.style.height = sizes[k][1] + 'px'; });
    } else bkPutPages(st, old, vis, sizes, big, same);
  }
  for (const i of vis) {
    const layer = st.querySelector(`[data-layer="${i}"]`), t = bkTextNow(i);
    if (t && layer && layer.dataset.filled !== '1') { layer.innerHTML = bkLayerHtml(t); layer.dataset.filled = '1'; }
    if (!t) bkFetch(i);
    const rib = st.querySelector(`.bk-page[data-n="${i}"] .bk-ribbon`); if (rib) rib.hidden = !bkBookmarked(i);
  }
  bkClasses();
}
const bkSrc = (i, big, again) => `/api/books/${encodeURIComponent(BK.book.id)}/page/${i}${big ? '?big=1' : ''}${again ? (big ? '&' : '?') + 'r=' + Date.now() : ''}`;
// New pages go in behind the ones showing and take their place once their pictures are in (at most a
// third of a second: after that the new page shows, saying it is loading), so a turn never flashes blank paper.
function bkPutPages(st, old, vis, sizes, big, same) {
  if (!old) st.replaceChildren();   // coming from Text, or the first page
  const el = document.createElement('div');
  el.className = 'bk-pages' + (vis.length > 1 ? ' two' : '');
  el.dataset.big = String(big);
  el.innerHTML = vis.map((i, k) => `<div class="bk-page loading" data-n="${i}" style="width:${sizes[k][0]}px;height:${sizes[k][1]}px">
      <span class="bk-pload">Loading page…</span><span class="bk-pfail">This page did not load. <button class="btn btn--sm" type="button" data-bk-retry>Try again</button></span>
      <img src="${bkSrc(i, big)}" alt="${esc(bkName(i))}" draggable="false" decoding="async">
      <div class="bk-layer" data-layer="${i}"></div><span class="bk-ribbon" hidden></span></div>`).join('');
  const imgs = [...el.querySelectorAll('img')];
  let shown = false;
  const show = () => {
    if (shown) return; shown = true;
    if (old?.isConnected) old.remove();
    el.classList.remove('bk-next');
    if (!same) st.scrollTop = 0;
  };
  const settle = () => { if (imgs.every((im) => !im.closest('.loading'))) { show(); bkPreload(vis, big); } };
  for (const im of imgs) {
    const pg = im.closest('.bk-page');
    im.addEventListener('load', () => { pg.classList.remove('loading', 'failed'); settle(); });
    im.addEventListener('error', () => { pg.classList.remove('loading'); pg.classList.add('failed'); settle(); });
  }
  if (old) {   // the old pages stay a moment as a picture only: their word boxes and numbers are the new pages' now
    old.querySelectorAll('[data-n], [data-layer]').forEach((x) => { x.removeAttribute('data-n'); x.removeAttribute('data-layer'); });
    old.querySelectorAll('.bk-layer, .bk-tool').forEach((x) => x.remove());
    el.classList.add('bk-next');
    setTimeout(show, 350);
  }
  st.appendChild(el);
  if (!old) show();
  for (const im of imgs) if (im.complete && im.naturalWidth) im.dispatchEvent(new Event('load'));
}
// The pages either side, into the browser's cache (the server fetches them from archive.org ahead too).
function bkPreload(vis, big) {
  const b = BK.book, step = vis.length, lo = Math.min(...vis), hi = Math.max(...vis), want = [];
  for (let k = 1; k <= step * 2; k++) want.push(hi + k);
  for (let k = 1; k <= step; k++) want.push(lo - k);
  BK.pre = want.filter((i) => i >= 0 && i < b.pages).map((i) => { const im = new Image(); im.decoding = 'async'; im.src = bkSrc(i, big); return im; });
}
function bkFetch(n) {
  const key = BK.open + ':' + n, p = bkText(n);
  if (p.wired) return;
  p.wired = true;
  p.then((t) => { const e = BK.text.get(key); if (e) e.done = t; bkPaintStage(); bkPaintSide(); }).catch((e) => { toast(e.message, { kind: 'error' }); });
}
// The invisible word boxes over the scan. A box reaches to the next word on its line, so a highlight has no gaps.
function bkLayerHtml(t) {
  const br = new Set(t.br), W = t.w || 1, H = t.h || 1;
  return t.words.map((w, i) => {
    const next = !br.has(i) && t.words[i + 1];
    const x1 = next && next[0] > w[2] && next[0] - w[2] < W * 0.05 ? next[0] : w[2];
    return `<span class="bk-w" data-w="${i}" style="left:${(w[0] / W * 100).toFixed(2)}%;top:${(w[1] / H * 100).toFixed(2)}%;width:${((x1 - w[0]) / W * 100).toFixed(2)}%;height:${((w[3] - w[1]) / H * 100).toFixed(2)}%"></span>`;
  }).join('');
}
// The page as text: paragraphs, a word broken at a line's end joined again, the running head left out.
function bkTextHtml(t) {
  const br = new Set(t.br), pe = new Set(t.pe), skip = new Set(t.skip);
  let html = '<p>', open = false;
  t.words.forEach((w, i) => {
    if (skip.has(i)) return;
    let s = w[4];
    const nx = t.words[i + 1]?.[4] || '', broken = br.has(i) && !pe.has(i) && /[a-z]-$/i.test(s) && /^[a-z]/.test(nx);
    if (broken) s = s.slice(0, -1);
    html += `<span class="bk-w" data-w="${i}">${esc(s)}${broken ? '' : ' '}</span>`; open = true;   // the space inside, so a highlight has no gaps
    if (pe.has(i)) { html += '</p><p>'; open = false; }
  });
  html += '</p>';
  return open || html.length > 7 ? html.replace(/<p><\/p>/g, '') : '';
}
// Highlights, the selection, the sentence being read and notes: classes on the word boxes.
function bkClasses() {
  const st = $('bk-stage'); if (!st || !BK.book) return;
  for (const host of st.querySelectorAll('[data-n]')) {
    const n = Number(host.dataset.n), ms = bkMarks(n).filter((m) => m.start != null);
    const sel = BK.sel && BK.sel.n === n ? BK.sel : null, say = BK.say && BK.say.book === BK.open && BK.say.n === n ? BK.say : null;
    for (const el of host.querySelectorAll('.bk-w')) {
      const i = Number(el.dataset.w);
      const hl = ms.find((m) => i >= m.start && i <= m.end && m.kind === 'highlight') || ms.find((m) => i >= m.start && i <= m.end);
      const cls = 'bk-w' + (hl ? ` hl hl-${hl.color || 'yellow'}` : '') + (ms.some((m) => m.note && m.end === i) ? ' noted' : '') + (sel && i >= sel.start && i <= sel.end ? ' sel' : '') + (say && i >= say.start && i <= say.end ? ' say' : '');
      if (el.className !== cls) el.className = cls;
    }
  }
  bkTool();
}
// The sentence being read stays in sight: the page scrolls with the voice (Width and Text, where a page is taller than the window).
function bkFollow() {
  const st = $('bk-stage'), s = BK.say;
  if (!st || !s || s.book !== BK.open || BK.drag || BK.sel) return;
  const w = st.querySelector(`[data-n="${s.n}"] .bk-w[data-w="${s.start}"]`), end = st.querySelector(`[data-n="${s.n}"] .bk-w[data-w="${s.end}"]`);
  if (!w) return;
  const box = st.getBoundingClientRect(), a = w.getBoundingClientRect(), z = (end || w).getBoundingClientRect();
  if (a.top < box.top + box.height * 0.12 || z.bottom > box.bottom - box.height * 0.2) st.scrollTo({ top: st.scrollTop + a.top - box.top - box.height * 0.3, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

// The small bar under a selection.
function bkTool() {
  document.querySelector('.bk-tool')?.remove();
  const s = BK.sel; if (!s || BK.drag) return;
  const host = $('bk-stage')?.querySelector(`[data-n="${s.n}"]`), last = host?.querySelector(`.bk-w[data-w="${s.end}"]`);
  if (!host || !last) return;
  const tool = document.createElement('div');
  tool.className = 'bk-tool'; tool.setAttribute('role', 'toolbar'); tool.setAttribute('aria-label', 'Selection');
  tool.innerHTML = BK_COLORS.map((c) => `<button type="button" class="bk-sw sw-${c}" data-bk-hl="${c}" title="Highlight ${c}"><span class="sr">Highlight ${c}</span></button>`).join('')
    + '<button type="button" class="btn btn--sm" data-bk="note">Note</button><button type="button" class="btn btn--sm" data-bk="readhere">Read from here</button><button type="button" class="btn btn--quiet btn--sm" data-bk="copy">Copy</button>';
  if (BK.view === 'text') { last.after(tool); tool.classList.add('inline'); return; }
  tool.style.left = `min(${last.style.left}, calc(100% - 22rem))`;
  tool.style.top = `calc(${parseFloat(last.style.top) + parseFloat(last.style.height)}% + var(--sp-1))`;
  host.appendChild(tool);
}

function bkPaintFoot() {
  const b = BK.book, n = BK.n;
  bkSet($('bk-foot'), `<div class="bk-player" id="bk-player"></div><label class="sr" for="bk-scrub">Page</label><input id="bk-scrub" class="bk-scrub" type="range" min="0" max="${b.pages - 1}" value="${n}" data-bk-scrub>
    <span class="bk-where mono">${Math.round((n + 1) / b.pages * 100)}%</span>`);
  if ($('bk-scrub') && document.activeElement !== $('bk-scrub')) $('bk-scrub').value = n;
  bvPaint();
}

function bkPaintSide() {
  const el = $('bk-side'); if (!el || !BK.book) return;
  el.hidden = !BK.side;
  if (!BK.side || el.contains(document.activeElement) && document.activeElement.matches('input, textarea')) return;
  const b = BK.book, bm = b.marks.filter((m) => m.kind === 'bookmark'), rest = b.marks.filter((m) => m.kind !== 'bookmark');
  const markHtml = (m) => {
    const editing = BK.editMark === m.id;
    return `<div class="bk-m${editing ? ' editing' : ''}" data-mark="${m.id}"><button type="button" class="bk-m-go" data-bk-go="${m.page}"><span class="bk-dot hl-${esc(m.color || 'none')}"></span><span class="mono">${esc(bkName(m.page))}</span>${m.quote ? `<span class="bk-q">${esc(m.quote)}</span>` : '<span class="bk-q muted">Note on the page</span>'}</button>
      ${editing ? `<label class="sr" for="bk-note-${m.id}">Note</label><textarea id="bk-note-${m.id}" class="field bk-note-in" rows="3" placeholder="Your note">${esc(m.note)}</textarea>
        <label class="sr" for="bk-mtags-${m.id}">Tags</label><input id="bk-mtags-${m.id}" class="field field--sm" placeholder="Tags, comma separated" value="${esc(m.tags.join(', '))}">
        <div class="bk-m-acts">${m.kind === 'highlight' ? BK_COLORS.map((c) => `<button type="button" class="bk-sw sw-${c}" data-bk-recolor="${c}" aria-pressed="${m.color === c}" title="${c}"><span class="sr">${c}</span></button>`).join('') : ''}<span class="grow"></span><button class="btn btn--primary btn--sm" type="button" data-bk-msave="${m.id}">Save</button><button class="btn btn--quiet btn--sm" type="button" data-bk-mdel="${m.id}">Delete</button></div>`
      : `${m.note ? `<p class="bk-m-note">${esc(m.note)}</p>` : ''}${m.tags.length ? `<div class="bk-m-tags">${m.tags.map((t) => `<span class="chip">#${esc(t)}</span>`).join('')}</div>` : ''}<button type="button" class="bk-m-edit" data-bk-medit="${m.id}">Edit</button>`}</div>`;
  };
  const v = S.voice || {};
  const listen = `<div class="section-label">Listen</div>
    ${v.installed ? `<p class="bk-line">Read aloud with the natural voice: <select class="field field--sm" data-bv-voice aria-label="Voice">${v.voices.filter((x) => x.have).map((x) => `<option value="${x.id}" ${x.id === v.voice ? 'selected' : ''}>${esc(x.name)}, ${esc(x.what)}</option>`).join('')}</select></p>`
      : v.installing ? `<p class="bk-line muted">${bvInstallWords(v)}</p>` : v.supported ? `<p class="bk-line muted">Read aloud uses the computer's built-in voice. The natural voice sounds like a person and runs on this computer.</p><div class="form-row"><select class="field field--sm" id="bv-pick" aria-label="Voice">${(v.voices || []).map((x) => `<option value="${x.id}">${esc(x.name)}, ${esc(x.what)} (${x.mb} MB)</option>`).join('')}</select><button class="btn btn--sm" type="button" data-bv-install>Install</button></div>${v.error ? `<p class="bad-text small">${esc(v.error)}</p>` : ''}` : ''}
    ${b.audio ? `<p class="bk-line">Audiobook: <b>${esc(b.audio.title)}</b> (LibriVox, read by volunteers)</p><div class="form-row"><select class="field field--sm" data-bv-track aria-label="Chapter">${b.audio.tracks.map((t, i) => `<option value="${i}" ${i === b.audio.track ? 'selected' : ''}>${esc(t.title)}</option>`).join('')}</select><button class="btn btn--sm" type="button" data-bv-lv>Play</button><button class="btn btn--quiet btn--sm" type="button" data-bk-noaudio>Drop</button></div>`
      : BK.found ? (BK.found.length ? `<div class="bk-found">${BK.found.map((f) => `<div class="bk-f"><span title="${esc(f.title)}">${esc(f.title)}</span><button class="btn btn--sm" type="button" data-bk-useaudio="${esc(f.id)}">Use</button></div>`).join('')}</div>` : '<p class="bk-line muted">No LibriVox recording of this book.</p>')
      : '<button class="btn btn--quiet btn--sm" type="button" data-bk="findaudio">Find an audiobook (LibriVox)</button>'}`;
  bkSet(el, `<div class="section-label">This book</div>
    <label class="sr" for="bk-mt">Title</label><input id="bk-mt" class="field field--sm bk-meta" data-bk-meta="title" value="${esc(b.title)}" placeholder="Title" title="The title as it shows in your library">
    <label class="sr" for="bk-ma">Author</label><input id="bk-ma" class="field field--sm bk-meta" data-bk-meta="author" value="${esc(b.author)}" placeholder="Author">
    <div class="form-row"><select class="field field--sm" data-bk-shelfset aria-label="Shelf">${Object.entries(BK_SHELF).map(([k, n]) => `<option value="${k}" ${b.shelf === k ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <label class="sr" for="bk-tags">Tags</label><input id="bk-tags" class="field field--sm bk-tags" placeholder="Tags, comma separated" value="${esc(b.tags.join(', '))}" data-bk-tags></div>
    ${listen}
    <div class="section-label">Bookmarks <span class="c">${bm.length || ''}</span></div>
    ${bm.length ? `<div class="bk-bms">${bm.map((m) => `<button type="button" class="chip" data-bk-go="${m.page}">${esc(bkName(m.page))}</button>`).join('')}</div>` : '<p class="bk-line muted">B, or the ribbon at the top, bookmarks a page.</p>'}
    <div class="section-label">Highlights and notes <span class="c">${rest.length || ''}</span><button class="btn btn--quiet btn--sm bk-pnote" type="button" data-bk="pagenote" title="A note on this page">Page note</button></div>
    ${rest.map(markHtml).join('') || '<p class="bk-line muted">Drag across words on the page to highlight them or add a note.</p>'}
    <div class="bk-remove"><button class="btn btn--quiet btn--sm" type="button" data-bk="remove">${BK.sureRemove ? 'Remove it, with its notes' : 'Remove from library'}</button></div>`);
  const ed = BK.editMark && el.querySelector(`#bk-note-${BK.editMark}`);
  if (ed && BK.focusNote) { ed.focus(); BK.focusNote = false; }
}

// ---------- doing things
function bkGo(n, { fromVoice = false } = {}) {
  const b = BK.book; if (!b) return;
  n = Math.max(0, Math.min(b.pages - 1, n));
  if (n === BK.n && !fromVoice) return;
  BK.n = n; BK.sel = null; BK.sureRemove = false;
  const row = (S.books || []).find((x) => x.id === b.id); if (row) { row.page = n; row.label = bkLabel(n); }
  clearTimeout(BK.saveT);
  BK.saveT = setTimeout(() => api(`/api/books/${encodeURIComponent(b.id)}/progress`, { page: n }).catch(() => {}), 700);
  bkSync();
}
// A page at a time, or two when two are showing.
const bkStep = (d) => { const vis = bkVisible(); bkGo(d > 0 ? Math.max(...vis) + 1 : Math.min(...vis) - (vis.length > 1 ? 2 : 1)); };
async function bkRefreshMarks() {
  try { const b = await api('/api/books/' + encodeURIComponent(BK.open)); if (BK.book && b.id === BK.book.id) BK.book.marks = b.marks; } catch { /* the next open reads them */ }
  bkSync(); load();
}
async function bkAddMark(m) {
  try { const r = await api(`/api/books/${encodeURIComponent(BK.open)}/marks`, m); BK.sel = null; await bkRefreshMarks(); return r; }
  catch (e) { toast(e.message, { kind: 'error' }); return null; }
}
async function bkToggleBookmark() {
  if (!BK.book) return;
  const n = BK.n, had = bkMarks(n).find((m) => m.kind === 'bookmark');
  if (had) { await api(`/api/books/marks/${had.id}/remove`, {}).catch((e) => toast(e.message, { kind: 'error' })); await bkRefreshMarks(); }
  else await bkAddMark({ kind: 'bookmark', page: n });
}
function bkQuote(s) {
  const t = bkTextNow(s.n); if (!t) return '';
  return t.words.slice(s.start, s.end + 1).map((w) => w[4]).join(' ').replace(/(\w)- (\w)/g, '$1$2');
}
// A plain number is a page in the scan (as the slider counts); "p 14" or "page 14" (or a roman numeral) is the printed one.
function bkGotoLabel(v) {
  const b = BK.book, s = String(v).trim().toLowerCase(), printed = s.match(/^(?:p\.?|page)\s*(\S+)$/);
  let i = -1;
  if (printed || !/^\d+$/.test(s)) i = b.leaves.findIndex((p) => String(p.p).toLowerCase() === (printed ? printed[1] : s));
  else i = Number(s) - 1;
  if (!(i >= 0 && i < b.pages)) toast(printed || !/^\d+$/.test(s) ? `The book has no printed page ${v}.` : `This book has pages 1 to ${b.pages}.`);
  else bkGo(i);
  $('bk-head').dataset.html = ''; bkPaintHead();   // the box shows where you are, whatever was typed
}

document.addEventListener('click', async (e) => {
  if (!e.target.closest('#bk-reader')) return;
  const go = e.target.closest('[data-bk-go]'); if (go) { bkGo(Number(go.dataset.bkGo)); return; }
  const again = e.target.closest('[data-bk-retry]');
  if (again) { const pg = again.closest('.bk-page'), im = pg?.querySelector('img'); if (im) { pg.classList.remove('failed'); pg.classList.add('loading'); im.src = bkSrc(Number(pg.dataset.n), pg.parentElement.dataset.big === 'true', true); } return; }
  const vw = e.target.closest('[data-bk-view]');
  if (vw) { const v = vw.dataset.bkView; BK.view = v === 'text' ? 'text' : 'scan'; BK.fitPage = v === 'page'; store.set('bkView', BK.view); store.set('bkFit', BK.fitPage ? 'page' : 'width'); BK.sel = null; bkSync(); return; }
  const hl = e.target.closest('[data-bk-hl]');
  if (hl && BK.sel) { await bkAddMark({ kind: 'highlight', page: BK.sel.n, start: BK.sel.start, end: BK.sel.end, color: hl.dataset.bkHl, quote: bkQuote(BK.sel) }); return; }
  const rc = e.target.closest('[data-bk-recolor]');
  if (rc) { await api(`/api/books/marks/${rc.closest('[data-mark]').dataset.mark}/edit`, { color: rc.dataset.bkRecolor }).catch((err) => toast(err.message, { kind: 'error' })); await bkRefreshMarks(); return; }
  const me = e.target.closest('[data-bk-medit]'); if (me) { BK.editMark = Number(me.dataset.bkMedit); BK.focusNote = true; bkPaintSide(); return; }
  const ms = e.target.closest('[data-bk-msave]');
  if (ms) {
    const id = ms.dataset.bkMsave;
    await api(`/api/books/marks/${id}/edit`, { note: $('bk-note-' + id)?.value ?? '', tags: $('bk-mtags-' + id)?.value ?? '' }).catch((err) => toast(err.message, { kind: 'error' }));
    BK.editMark = null; document.activeElement?.blur(); await bkRefreshMarks(); return;
  }
  const md = e.target.closest('[data-bk-mdel]');
  if (md) { await api(`/api/books/marks/${md.dataset.bkMdel}/remove`, {}).catch((err) => toast(err.message, { kind: 'error' })); BK.editMark = null; await bkRefreshMarks(); return; }
  const ua = e.target.closest('[data-bk-useaudio]');
  if (ua) { ua.disabled = true; try { const r = await api(`/api/books/${encodeURIComponent(BK.open)}/audiobook`, { recording: ua.dataset.bkUseaudio }); BK.book.audio = r.audio; BK.found = null; bkPaintSide(); load(); } catch (err) { toast(err.message, { kind: 'error' }); ua.disabled = false; } return; }
  if (e.target.closest('[data-bk-noaudio]')) { if (BV.lv) bvStop(); await api(`/api/books/${encodeURIComponent(BK.open)}/audiobook`, { recording: null }).catch(() => {}); BK.book.audio = null; bkPaintSide(); load(); return; }
  const b = e.target.closest('[data-bk]'); if (!b) return;
  const what = b.dataset.bk;
  if (what === 'prev') bkStep(-1);
  else if (what === 'next') bkStep(1);
  else if (what === 'mark') bkToggleBookmark();
  else if (what === 'night') { BK.night = !BK.night; store.set('bkNight', BK.night); bkSync(); }
  else if (what === 'side') { BK.side = !BK.side; store.set('bkSide', BK.side); bkSync(); }
  else if (what === 'focus') { BK.focus = !BK.focus; bkSync(); }
  else if (what === 'close') { BK.open = null; store.set('bkOpen', null); BK.book = null; BK.focus = false; render(); }
  else if (what === 'read') bvStart({ n: BK.n });
  else if (what === 'readhere' && BK.sel) { const s = BK.sel; BK.sel = null; bkClasses(); bvStart({ n: s.n, word: s.start }); }
  else if (what === 'copy' && BK.sel) { navigator.clipboard?.writeText(bkQuote(BK.sel)).then(() => toast('Copied.')).catch(() => toast('Could not copy here.')); BK.sel = null; bkClasses(); }
  else if (what === 'note' && BK.sel) { const r = await bkAddMark({ kind: 'highlight', page: BK.sel.n, start: BK.sel.start, end: BK.sel.end, color: 'yellow', quote: bkQuote(BK.sel) }); if (r) { BK.side = true; BK.editMark = r.id; BK.focusNote = true; bkSync(); } }
  else if (what === 'pagenote') { const r = await bkAddMark({ kind: 'note', page: BK.n }); if (r) { BK.editMark = r.id; BK.focusNote = true; bkPaintSide(); } }
  else if (what === 'findaudio') { b.disabled = true; b.textContent = 'Looking…'; try { BK.found = (await api(`/api/books/${encodeURIComponent(BK.open)}/audiobook`)).found; } catch (err) { toast(err.message, { kind: 'error' }); } bkPaintSide(); }
  else if (what === 'remove') {
    if (!BK.sureRemove) { BK.sureRemove = true; bkPaintSide(); return; }
    const title = BK.book.title; if (BV.book === BK.open) bvStop();
    await api(`/api/books/${encodeURIComponent(BK.open)}/remove`, {}).catch((err) => toast(err.message, { kind: 'error' }));
    BK.open = null; BK.book = null; BK.sureRemove = false; store.set('bkOpen', null); toast(`${title} is out of your library.`); await load();
  }
});
document.addEventListener('change', async (e) => {
  if (!e.target.closest?.('#bk-reader')) return;
  if (e.target.matches('[data-bk-goto]')) { bkGotoLabel(e.target.value); return; }
  if (e.target.matches('[data-bk-scrub]')) { bkGo(Number(e.target.value)); return; }
  if (e.target.matches('[data-bk-shelfset], [data-bk-tags], [data-bk-meta]')) {
    const t = e.target, body = t.matches('[data-bk-tags]') ? { tags: t.value } : t.matches('[data-bk-meta]') ? { [t.dataset.bkMeta]: t.value.trim() } : { shelf: t.value };
    if (t.dataset.bkMeta === 'title' && !body.title) { t.value = BK.book.title; return; }
    try { const r = await api(`/api/books/${encodeURIComponent(BK.open)}/edit`, body); Object.assign(BK.book, { shelf: r.shelf, tags: r.tags, title: r.title, author: r.author }); t.blur(); bkPaintHead(); load(); } catch (err) { toast(err.message, { kind: 'error' }); }
  }
});
document.addEventListener('input', (e) => { if (e.target.matches?.('[data-bk-scrub]')) { const w = document.querySelector('.bk-where'); if (w) w.textContent = `${bkName(Number(e.target.value))} · ${Number(e.target.value) + 1} of ${BK.book.pages}`; } });

// Selecting words: press on a word and drag; a click on a highlight opens it in Notes.
document.addEventListener('pointerdown', (e) => {
  const st = e.target.closest?.('#bk-stage'); if (!st || e.button !== 0) return;
  if (e.target.closest('.bk-tool')) return;
  const w = e.target.closest('.bk-w'), host = w?.closest('[data-n]');
  if (!w || !host) { if (BK.sel) { BK.sel = null; bkClasses(); } return; }
  e.preventDefault();
  const n = Number(host.dataset.n), i = Number(w.dataset.w);
  BK.drag = { n, a: i, hl: w.classList.contains('hl') }; BK.sel = { n, start: i, end: i };
  bkClasses();
});
document.addEventListener('pointermove', (e) => {
  if (!BK.drag) return;
  const w = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.bk-w');
  const host = w?.closest('[data-n]');
  if (!w || Number(host?.dataset.n) !== BK.drag.n) return;
  const i = Number(w.dataset.w), s = { n: BK.drag.n, start: Math.min(BK.drag.a, i), end: Math.max(BK.drag.a, i) };
  if (s.start !== BK.sel.start || s.end !== BK.sel.end) { BK.sel = s; BK.drag.moved = true; bkClasses(); }
});
document.addEventListener('pointerup', () => {
  if (!BK.drag) return;
  const d = BK.drag; BK.drag = null;
  if (!d.moved && d.hl) {
    const m = bkMarks(d.n).find((x) => x.start != null && d.a >= x.start && d.a <= x.end);
    if (m) { BK.sel = null; BK.side = true; BK.editMark = m.id; bkSync(); return; }
  }
  bkClasses();
});

// Keys while a book is on screen: ← → turn the page, B bookmarks, Esc lets go of a selection or the whole width.
const bkOn = () => bkShowing() && !!BK.book && !!$('bk-reader');
document.addEventListener('keydown', (e) => {
  if (!bkOn() || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('.scrim.open') || jv?.open) return;
  const typing = e.target.closest?.('input, textarea, select, [contenteditable="true"]');
  if (e.key === 'Escape') {
    if (typing) { e.target.blur(); e.preventDefault(); return; }
    if (BK.sel) { BK.sel = null; bkClasses(); e.preventDefault(); return; }
    if (BK.focus) { BK.focus = false; bkSync(); e.preventDefault(); }
    return;
  }
  if (typing) return;
  if (e.key === 'ArrowRight' || e.key === 'PageDown') { bkStep(1); e.preventDefault(); }
  else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { bkStep(-1); e.preventDefault(); }
  else if (e.key === 'b' || e.key === 'B') { bkToggleBookmark(); e.preventDefault(); }
});
