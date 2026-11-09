// The page editor: formatted text, like writing an email.
// A toolbar for text style (normal, headings), size, bold, italic, underline,
// strikethrough, bullets, numbers, checklists, quote, a line across, indent,
// clear formatting, undo and redo. Ctrl+B / I / U work; typing "- ", "1. ",
// "[] " or "# " at the start of a line also starts a list or heading.
// A line ending in "=" shows its answer (calc.js); a log page shows its
// totals and an Add box.
//
// A page is stored as HTML; sanitizeHtml (sanitize.js, loaded before this)
// keeps only the tags the editor makes, on load, on paste and on save. Pages
// from the first notebook (plain "- [ ] " lines) are turned into HTML when opened.
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.

const ED_SIZES = { s: 'fs-s', l: 'fs-l', xl: 'fs-xl' };

// The first notebook's plain lines, as HTML.
function linesToHtml(body) {
  const esc1 = (s) => esc(s);
  let html = '', stack = [];   // open lists: { tag, cls, indent }
  const close = (to) => { while (stack.length > to) html += `</li></${stack.pop().tag}>`; };
  for (const raw of String(body || '').split('\n')) {
    const ind = Math.min(4, Math.floor(raw.match(/^ */)[0].length / 2)), l = raw.replace(/^ +/, '');
    let m, item = null;
    if ((m = l.match(/^- \[( |x)\] ?(.*)$/i))) item = { tag: 'ul', cls: 'checklist', html: `<li data-checked="${m[1] !== ' '}">${esc1(m[2])}` };
    else if ((m = l.match(/^[-*] (.*)$/))) item = { tag: 'ul', cls: '', html: `<li>${esc1(m[1])}` };
    else if ((m = l.match(/^\d+[.)] (.*)$/))) item = { tag: 'ol', cls: '', html: `<li>${esc1(m[1])}` };
    if (item) {
      if (stack.length > ind + 1) close(ind + 1);
      const top = stack[ind];
      if (top && (top.tag !== item.tag || top.cls !== item.cls)) close(ind);
      if (stack.length === ind + 1) html += '</li>';
      while (stack.length < ind + 1) { stack.push({ tag: item.tag, cls: item.cls }); html += `<${item.tag}${item.cls ? ` class="${item.cls}"` : ''}>`; }
      html += item.html;
      continue;
    }
    close(0);
    if ((m = l.match(/^(#{1,3}) (.*)$/))) html += `<h${m[1].length}>${esc1(m[2])}</h${m[1].length}>`;
    else if ((m = l.match(/^> ?(.*)$/))) html += `<blockquote>${esc1(m[1])}</blockquote>`;
    else if (/^-{3,}$/.test(l)) html += '<hr>';
    else html += `<p>${esc1(raw) || '<br>'}</p>`;
  }
  close(0);
  return html;
}
const isHtmlBody = (b) => /^\s*</.test(b || '');

const ICON = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ED_BUTTONS = [
  ['bold', 'Bold (Ctrl+B)', '<span class="tb-b">B</span>'], ['italic', 'Italic (Ctrl+I)', '<span class="tb-i">I</span>'], ['underline', 'Underline (Ctrl+U)', '<span class="tb-u">U</span>'], ['strikeThrough', 'Strikethrough', '<span class="tb-s">S</span>'], ['|'],
  ['insertUnorderedList', 'Bullets', ICON('<circle cx="5" cy="7" r="1.6"/><circle cx="5" cy="12" r="1.6"/><circle cx="5" cy="17" r="1.6"/><path d="M10 7h10M10 12h10M10 17h10"/>')],
  ['insertOrderedList', 'Numbered list', ICON('<path d="M4 5h2v5M4 10h3M10 7h10M10 12h10M10 17h10M4 15h3l-3 4h3"/>')],
  ['checklist', 'Checklist', ICON('<rect x="3" y="4" width="6" height="6" rx="1.5"/><path d="m4.5 7 1.2 1.2L8 6M3 15h6v5H3zM12 7h9M12 17h9"/>')],
  ['outdent', 'Less indent (Shift+Tab)', ICON('<path d="M10 6h10M10 12h10M10 18h10M7 9l-3 3 3 3"/>')], ['indent', 'More indent (Tab)', ICON('<path d="M10 6h10M10 12h10M10 18h10M4 9l3 3-3 3"/>')], ['|'],
  ['quote', 'Quote', ICON('<path d="M7 7h4v4H8c0 3-1 4-3 5M14 7h4v4h-3c0 3-1 4-3 5"/>')], ['insertHorizontalRule', 'A line across', ICON('<path d="M3 12h18"/>')],
  ['removeFormat', 'Clear formatting', ICON('<path d="M5 6h12M11 6l-3 13M15 15l5 5M20 15l-5 5"/>')], ['|'],
  ['undo', 'Undo (Ctrl+Z)', ICON('<path d="M9 7 4 12l5 5M4 12h11a5 5 0 0 1 0 10h-2"/>')], ['redo', 'Redo (Ctrl+Shift+Z)', ICON('<path d="m15 7 5 5-5 5M20 12H9a5 5 0 0 0 0 10h2"/>')]
];

function makeEditor(host, body, { onSave } = {}) {
  host.innerHTML = `<div class="ed-bar" role="toolbar" aria-label="Formatting">
      <label class="sr" for="ed-style">Text style</label><select id="ed-style" class="ed-sel" title="Text style"><option value="p">Normal text</option><option value="h1">Heading</option><option value="h2">Subheading</option><option value="h3">Small heading</option></select>
      <label class="sr" for="ed-size">Size</label><select id="ed-size" class="ed-sel" title="Size"><option value="s">Small</option><option value="n" selected>Normal size</option><option value="l">Large</option><option value="xl">Huge</option></select>
      ${ED_BUTTONS.map(([cmd, label, icon]) => cmd === '|' ? '<span class="tb-sep"></span>' : `<button type="button" class="tb" data-ed="${cmd}" title="${label}" aria-label="${label}">${icon}</button>`).join('')}
      <button type="button" class="tb" data-ed="attach" title="Add a picture or file" aria-label="Add a picture or file">${ICON('<path d="M21 11.5l-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l7.9-7.9"/>')}</button><input type="file" multiple hidden class="ed-file">
      <button type="button" class="tb mic" data-mic="ed-doc" title="Talk to type: the words go in where the caret is" aria-label="Talk to type">${ICON('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>')}</button>
    </div><div class="ed-logsum" hidden></div>
    <div class="ed-doc" id="ed-doc" contenteditable="true" spellcheck="true" role="textbox" aria-multiline="true" aria-label="Page"></div>`;
  const doc = host.querySelector('.ed-doc'), bar = host.querySelector('.ed-bar'), logsum = host.querySelector('.ed-logsum');
  let saveTimer = null, calcTimer = null;

  function setBody(b) {
    doc.innerHTML = sanitizeHtml(isHtmlBody(b) ? b : linesToHtml(b)) || '<p><br></p>';
    if (!doc.firstElementChild) doc.innerHTML = '<p><br></p>';
    refresh();
  }
  const html = () => {
    const clone = doc.cloneNode(true);
    clone.querySelectorAll('[data-calc]').forEach((e) => e.removeAttribute('data-calc'));
    const out = sanitizeHtml(clone.innerHTML);
    return /^(<p><br><\/p>)?$/.test(out) ? '' : out;
  };
  function changed() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { saveTimer = null; onSave?.(html()); }, 500); clearTimeout(calcTimer); calcTimer = setTimeout(refresh, 250); }
  // Menus and buttons take focus from the page; put the selection back first.
  let lastRange = null;
  function refocus() {
    if (doc.contains(document.activeElement) && getSelection().rangeCount && doc.contains(getSelection().getRangeAt(0).startContainer)) return;
    doc.focus();
    if (lastRange && doc.contains(lastRange.startContainer)) { const s = getSelection(); s.removeAllRanges(); s.addRange(lastRange); }
  }
  const keepRange = () => { const s = getSelection(); if (s.rangeCount && doc.contains(s.getRangeAt(0).startContainer)) lastRange = s.getRangeAt(0).cloneRange(); };
  const exec = (cmd, val = null) => { refocus(); document.execCommand(cmd, false, val); keepRange(); };
  try { document.execCommand('defaultParagraphSeparator', false, 'p'); document.execCommand('styleWithCSS', false, false); } catch {}

  // ---- where the caret is
  // The element the selection starts in (a selected span counts as itself).
  const selEl = () => {
    const s = getSelection(); if (!s.rangeCount) return null;
    const r = s.getRangeAt(0); let n = r.startContainer;
    if (n.nodeType === 1 && !r.collapsed && n.childNodes[r.startOffset]) n = n.childNodes[r.startOffset];
    if (n?.nodeType === 3) n = n.parentElement;
    return n && doc.contains(n) ? n : null;
  };
  // The caret as a count of characters into an element, and back.
  const caretOffset = (el) => { const s = getSelection(); if (!s.rangeCount || !el.contains(s.getRangeAt(0).endContainer)) return null; const r = document.createRange(); r.selectNodeContents(el); r.setEnd(s.getRangeAt(0).endContainer, s.getRangeAt(0).endOffset); return r.toString().length; };
  function setCaret(el, off) {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), r = document.createRange();
    let left = off, done = false;
    while (w.nextNode()) { const t = w.currentNode; if (left <= t.length) { r.setStart(t, left); done = true; break; } left -= t.length; }
    if (!done) { r.selectNodeContents(el); r.collapse(false); } else r.collapse(true);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }
  const blockOf = (n) => n?.closest?.('p, h1, h2, h3, li, blockquote');
  const listOf = (n) => n?.closest?.('ul, ol');
  function placeAtStart(el) { const r = document.createRange(); r.setStart(el, 0); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }

  // ---- text size: execCommand makes <font size>; turn those into our classes
  function setSize(size) {
    refocus(); remember();
    document.execCommand('fontSize', false, '7');
    const made = [];
    doc.querySelectorAll('font[size="7"]').forEach((f) => {
      f.querySelectorAll('span[class^="fs-"]').forEach((s) => s.replaceWith(...s.childNodes));
      const kids = [...f.childNodes];
      if (size === 'n') { f.replaceWith(...kids); made.push(...kids); return; }
      const span = document.createElement('span'); span.className = 'fs-' + size;
      span.append(...kids); f.replaceWith(span); made.push(span);
    });
    // Keep the same text selected, to carry on formatting it.
    if (made.length) { const r = document.createRange(); r.setStartBefore(made[0]); r.setEndAfter(made.at(-1)); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
    changed(); updateBar();
    bar.querySelector('#ed-size').value = size;
  }
  // A heading has its own size: picking one clears sizes inside it.
  function setStyle(tag) {
    refocus(); remember(); caretIntoLine();
    const cur = blockOf(selEl());
    if (cur && cur.tagName.toLowerCase() === tag) return updateBar();   // already that: the browser would only rebuild the line
    exec('formatBlock', tag);
    const h = selEl()?.closest('h1, h2, h3');
    if (h) {
      const off = caretOffset(h);
      h.querySelectorAll('span[class^="fs-"], span[style]').forEach((x) => x.replaceWith(...x.childNodes));
      h.normalize();
      setCaret(h, off ?? h.textContent.length);
    }
    changed(); updateBar();
  }

  // ---- undo and redo: our own, so list changes undo like typing does
  const past = [], future = [];
  let burst = false, burstTimer = null;
  const state = () => ({ html: doc.innerHTML, off: caretOffset(doc) });
  function remember() { const st = state(); if (past.at(-1)?.html !== st.html) { past.push(st); if (past.length > 300) past.shift(); future.length = 0; } }
  function restore(st) { doc.innerHTML = st.html; doc.focus(); setCaret(doc, st.off ?? 0); keepRange(); refresh(); changed(); }
  function undo() { const st = past.pop(); if (!st) return; future.push(state()); burst = false; restore(st); }
  function redo() { const st = future.pop(); if (!st) return; past.push(state()); burst = false; restore(st); }
  doc.addEventListener('beforeinput', (e) => {
    if (e.inputType === 'historyUndo') { e.preventDefault(); undo(); return; }
    if (e.inputType === 'historyRedo') { e.preventDefault(); redo(); return; }
    // The page as it was before a run of typing: one undo step per run.
    if (!burst || !/^insertText|^deleteContent/.test(e.inputType)) remember();
    burst = /^insertText|^deleteContent/.test(e.inputType);
    clearTimeout(burstTimer); burstTimer = setTimeout(() => { burst = false; }, 900);
  });

  // ---- lists, done here: the browser's own list command nests lists inside lines
  const LISTS = /^(UL|OL)$/;
  const kindOf = (L) => !L ? null : L.tagName === 'OL' ? 'ol' : L.classList.contains('checklist') ? 'check' : 'ul';
  const ownNodes = (el) => [...el.childNodes].filter((n) => !(n.nodeType === 1 && LISTS.test(n.tagName)));
  // The lines the selection touches (a list item counts by its own text, not its sub-list).
  function selectedBlocks() {
    const s = getSelection(); if (!s.rangeCount) return [];
    const r = s.getRangeAt(0);
    const all = [...doc.querySelectorAll('p, h1, h2, h3, blockquote, li')].filter((el) => {
      const own = ownNodes(el);
      return own.length ? own.some((n) => r.intersectsNode(n)) : r.intersectsNode(el);
    });
    if (!all.length) { const b = blockOf(selEl()); return b ? [b] : []; }
    return all.filter((el) => !all.some((o) => o !== el && o.contains(el) && o.tagName !== 'LI'));
  }
  function newList(kind) { const L = document.createElement(kind === 'ol' ? 'ol' : 'ul'); if (kind === 'check') L.className = 'checklist'; return L; }
  function fixChecks() {
    doc.querySelectorAll('ul.checklist > li:not([data-checked])').forEach((li) => { li.dataset.checked = 'false'; });
    doc.querySelectorAll('li[data-checked]').forEach((li) => { if (!li.parentElement?.classList.contains('checklist')) li.removeAttribute('data-checked'); });
    doc.querySelectorAll('ul:empty, ol:empty').forEach((L) => L.remove());
    if (!doc.firstElementChild) doc.innerHTML = '<p><br></p>';
  }
  function retype(L, kind) {
    let el = L;
    if ((kind === 'ol') !== (L.tagName === 'OL')) { el = newList(kind); el.append(...L.childNodes); L.replaceWith(el); }
    el.classList.toggle('checklist', kind === 'check');
    if (!el.className) el.removeAttribute('class');
    return el;
  }
  function mergeAround(L) {
    const k = kindOf(L), prev = L.previousElementSibling, next = L.nextElementSibling;
    if (prev && LISTS.test(prev.tagName) && kindOf(prev) === k) { prev.append(...L.childNodes); L.remove(); L = prev; }
    if (next && LISTS.test(next.tagName) && kindOf(next) === k) { L.append(...next.childNodes); next.remove(); }
    return L;
  }
  // A list item back to a plain line (splitting its list there).
  function unlist(li) {
    while (li.parentElement?.parentElement?.tagName === 'LI') outdent(li);
    const L = li.parentElement, p = document.createElement('p');
    p.append(...ownNodes(li));
    if (!p.childNodes.length || !p.textContent.length && !p.querySelector('br')) p.innerHTML = '<br>';
    const subs = [...li.children].filter((c) => LISTS.test(c.tagName));
    const after = [];
    for (let n = li.nextElementSibling; n; n = n.nextElementSibling) after.push(n);
    let at = L;
    at.after(p); at = p;
    for (const sub of subs) { at.after(sub); at = sub; }
    if (after.length) { const L2 = L.cloneNode(false); L2.append(...after); at.after(L2); }
    li.remove();
    return p;
  }
  function indent(li) {
    const prev = li.previousElementSibling;
    if (!prev || prev.tagName !== 'LI') return;
    let sub = prev.lastElementChild;
    if (!sub || !LISTS.test(sub.tagName)) { sub = li.parentElement.cloneNode(false); prev.appendChild(sub); }
    sub.appendChild(li);
  }
  function outdent(li) {
    const L = li.parentElement, up = L.parentElement;
    if (up?.tagName !== 'LI') { unlist(li); return; }
    const after = [];
    for (let n = li.nextElementSibling; n; n = n.nextElementSibling) after.push(n);
    if (after.length) { let sub = [...li.children].find((c) => LISTS.test(c.tagName)); if (!sub) { sub = L.cloneNode(false); li.appendChild(sub); } sub.append(...after); }
    up.after(li);
    if (!L.children.length) L.remove();
  }
  // Bullets, numbers or checklist on the selected lines; again to take it off.
  // The caret, kept by the text it is in (text is moved, never remade); an empty line maps to what replaced it.
  // Plain positions, not a live Range: the browser moves a live one when its line is rebuilt.
  const holdCaret = () => { const s = getSelection(); if (!s.rangeCount) return null; const r = s.getRangeAt(0); return { sc: r.startContainer, so: r.startOffset, ec: r.endContainer, eo: r.endOffset, blk: blockOf(selEl()) }; };
  function putCaret(h, made) {
    if (!h) return;
    const { sc, so, ec, eo, blk } = h, s = getSelection();
    // Inside text: that text was moved, not remade, so the same spot is still right.
    if (sc.nodeType === 3 && doc.contains(sc) && doc.contains(ec)) { const r = document.createRange(); r.setStart(sc, Math.min(so, sc.length)); r.setEnd(ec, Math.min(eo, ec.length ?? eo)); s.removeAllRanges(); s.addRange(r); return; }
    // An empty line: the line it became, or the same line where it went.
    const to = (blk && made.get(blk)) || blk;
    if (to?.isConnected) placeAtStart(to);
  }
  // A caret on the page itself (after the last line, say) goes into the nearest line.
  function caretIntoLine() {
    const s = getSelection(); if (!s.rangeCount) return;
    const r = s.getRangeAt(0);
    if (r.startContainer !== doc) return;
    const at = doc.childNodes[r.startOffset], el = at?.nodeType === 1 ? at : doc.lastElementChild;
    if (!el) return;
    const x = document.createRange(); x.selectNodeContents(el); x.collapse(!!at); s.removeAllRanges(); s.addRange(x);
  }
  // Lines the browser makes on its own (div, or loose text) become ordinary lines.
  function tidy() {
    const loose = [...doc.childNodes].filter((n) => (n.nodeType === 1 && n.tagName === 'DIV') || (n.nodeType === 3 && n.nodeValue.trim()));
    if (!loose.length) return;
    const h = holdCaret();
    for (const n of loose) { const p = document.createElement('p'); if (n.nodeType === 1) { p.append(...n.childNodes); n.replaceWith(p); } else { n.replaceWith(p); p.appendChild(n); } }
    if (h) putCaret(h, new Map());
  }
  function setList(kind) {
    refocus(); remember(); caretIntoLine();
    const held = holdCaret(), made = new Map(), blocks = selectedBlocks();
    if (!blocks.length) return;
    const lis = blocks.filter((b) => b.tagName === 'LI'), lines = blocks.filter((b) => b.tagName !== 'LI');
    if (!lines.length && lis.every((li) => kindOf(li.parentElement) === kind)) lis.reverse().forEach((li) => made.set(li, unlist(li)));
    else {
      for (const L of new Set(lis.map((li) => li.parentElement))) mergeAround(retype(L, kind));
      let L = null;
      for (const b of lines) {
        const li = document.createElement('li');
        made.set(b, li);
        li.append(...b.childNodes);
        if (!li.childNodes.length) li.innerHTML = '<br>';
        if (L && b.previousElementSibling === L) L.appendChild(li);
        else { L = newList(kind); b.before(L); L.appendChild(li); }
        b.remove();
        L = mergeAround(L);
      }
    }
    fixChecks();
    putCaret(held, made);
    keepRange(); changed(); updateBar();
  }
  function shiftIndent(out) {
    refocus(); caretIntoLine();
    const lis = selectedBlocks().filter((b) => b.tagName === 'LI');
    if (!lis.length) return;
    remember();
    const held = holdCaret(), made = new Map();
    (out ? lis.reverse() : lis).forEach((li) => { if (out && li.parentElement?.parentElement?.tagName !== 'LI') made.set(li, unlist(li)); else if (out) outdent(li); else indent(li); });
    fixChecks();
    putCaret(held, made);
    keepRange(); changed(); updateBar();
  }

  // ---- toolbar state follows the caret
  function updateBar() {
    const el = selEl();
    if (!el) return;
    for (const b of bar.querySelectorAll('[data-ed]')) {
      const c = b.dataset.ed;
      let on = false;
      if (['bold', 'italic', 'underline', 'strikeThrough'].includes(c)) { try { on = document.queryCommandState(c); } catch {} }
      if (c === 'insertUnorderedList') on = listOf(el)?.tagName === 'UL' && !listOf(el).classList.contains('checklist');
      if (c === 'insertOrderedList') on = listOf(el)?.tagName === 'OL';
      if (c === 'checklist') on = !!listOf(el)?.classList.contains('checklist');
      if (c === 'quote') on = !!el.closest('blockquote');
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    const h = el.closest('h1, h2, h3');
    bar.querySelector('#ed-style').value = h ? h.tagName.toLowerCase() : 'p';
    const fs = el.closest('[class^="fs-"]');
    bar.querySelector('#ed-size').value = fs ? fs.className.slice(3) : 'n';
  }
  document.addEventListener('selectionchange', () => { if (doc.isConnected && getSelection().rangeCount && doc.contains(getSelection().anchorNode)) { lastRange = getSelection().getRangeAt(0).cloneRange(); updateBar(); } });

  bar.addEventListener('mousedown', (e) => { if (e.target.closest('[data-ed], [data-mic]')) e.preventDefault(); });   // keep the selection in the page
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ed]'); if (!b) return;
    const c = b.dataset.ed;
    if (c === 'insertUnorderedList') return setList('ul');
    if (c === 'insertOrderedList') return setList('ol');
    if (c === 'checklist') return setList('check');
    if (c === 'indent' || c === 'outdent') return shiftIndent(c === 'outdent');
    if (c === 'undo') return undo();
    if (c === 'redo') return redo();
    if (c === 'attach') { remember(); host.querySelector('.ed-file').click(); return; }
    remember();
    if (c === 'quote') { exec('formatBlock', selEl()?.closest('blockquote') ? 'p' : 'blockquote'); }
    else if (c === 'removeFormat') { exec('removeFormat'); doc.querySelectorAll('span[class^="fs-"]').forEach((s) => { if (getSelection().containsNode(s, true)) s.replaceWith(...s.childNodes); }); }
    else exec(c);
    changed(); updateBar();
  });
  bar.querySelector('#ed-style').addEventListener('change', (e) => setStyle(e.target.value));
  bar.querySelector('#ed-size').addEventListener('change', (e) => setSize(e.target.value));

  // ---- typing
  const SHORT = [[/^[-*•]\s$/, () => setList('ul')], [/^1[.)]\s$/, () => setList('ol')], [/^\[\s?\]\s$/, () => setList('check')], [/^#\s$/, () => setStyle('h1')], [/^##\s$/, () => setStyle('h2')], [/^###\s$/, () => setStyle('h3')], [/^>\s$/, () => exec('formatBlock', 'blockquote')]];
  // Where the caret is, kept at once (menus take focus; the selectionchange event comes late).
  for (const ev of ['keyup', 'mouseup', 'focus']) doc.addEventListener(ev, () => setTimeout(keepRange, 0));
  doc.addEventListener('input', (e) => {
    tidy();
    keepRange();
    const el = selEl(), blk = blockOf(el);
    if (e.inputType === 'insertText' && e.data === ' ' && blk && blk.tagName === 'P') {
      const t = blk.textContent.replace(/ /g, ' ');
      for (const [re, run] of SHORT) if (re.test(t)) { blk.innerHTML = '<br>'; placeAtStart(blk); run(); break; }
    }
    // A new line in a checklist starts unticked.
    if (e.inputType === 'insertParagraph') { const li = selEl()?.closest('li'); if (li && li.parentElement?.classList.contains('checklist')) li.dataset.checked = 'false'; }
    if (!doc.firstElementChild) doc.innerHTML = '<p><br></p>';
    changed();
  });
  doc.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    // Enter at the end of a heading: a fresh normal line (the browser would otherwise stay in the heading).
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      const h = selEl()?.closest('h1, h2, h3'), sel = getSelection();
      if (h && sel.rangeCount) {
        remember();
        const r = sel.getRangeAt(0), rest = document.createRange();
        rest.selectNodeContents(h); rest.setStart(r.endContainer, r.endOffset);
        if (!rest.toString().length) { e.preventDefault(); const p = document.createElement('p'); p.innerHTML = '<br>'; h.after(p); placeAtStart(p); keepRange(); changed(); updateBar(); return; }
      }
    }
    if (e.key === 'Tab') { e.preventDefault(); shiftIndent(e.shiftKey); return; }
    // Backspace at the very start of a list item: out one level, or back to a plain line.
    if (e.key === 'Backspace' && getSelection().isCollapsed) {
      const li = selEl()?.closest('li');
      if (li && caretOffset(li) === 0 && (getSelection().getRangeAt(0).startOffset === 0 || !ownNodes(li).some((n) => n.textContent))) {
        e.preventDefault(); shiftIndent(true); return;
      }
    }
    if (mod && e.shiftKey && e.key === '7') { e.preventDefault(); setList('ol'); }
    if (mod && e.shiftKey && e.key === '8') { e.preventDefault(); setList('ul'); }
    if (mod && e.shiftKey && e.key === '9') { e.preventDefault(); setList('check'); }
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    if (mod && ((e.shiftKey && e.key.toLowerCase() === 'z') || e.key.toLowerCase() === 'y')) { e.preventDefault(); redo(); return; }
  });
  // Ticking a box: a click on it, left of the text.
  doc.addEventListener('mousedown', (e) => {
    const li = e.target.closest?.('ul.checklist > li');
    if (!li || e.target !== li) return;
    const box = li.getBoundingClientRect();
    if (e.clientX - box.left > 28) return;
    e.preventDefault();
    remember();
    li.dataset.checked = li.dataset.checked === 'true' ? 'false' : 'true';
    changed();
  });
  // ---- putting text in at the caret: paste and dictation both come through here,
  // so the sanitiser applies and one undo step takes it back out.
  function insertHtml(clean) { refocus(); remember(); document.execCommand('insertHTML', false, clean); keepRange(); changed(); }
  const textHtml = (t) => /(^|\n)\s*([-*] |\d+[.)] |- \[[ x]\] |#{1,3} )/i.test(t) ? linesToHtml(t) : esc(t).replace(/\n/g, '<br>');
  // Pictures and files: kept on this computer (lib/attachments.js); a picture
  // shows in the page, anything else is a link that downloads it.
  async function insertFiles(files) {
    for (const file of files) {
      try {
        const f = await uploadFile(file);
        insertHtml(f.image ? `<p><img src="${esc(fileUrl(f.id))}" alt="${esc(f.name)}"></p>` : `<p><a class="file-link" href="${esc(fileUrl(f.id))}">${esc(f.name)}</a></p>`);
      } catch (err) { toast(err.message, { kind: 'error' }); }
    }
  }
  host.querySelector('.ed-file').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; insertFiles(f); });
  // Pasting: formatting kept (bold, lists…), everything else dropped; a pasted picture or file goes in as one.
  doc.addEventListener('paste', (e) => {
    e.preventDefault();
    const cd = e.clipboardData;
    if (cd?.files?.length) { insertFiles([...cd.files]); return; }
    const h = cd?.getData('text/html');
    insertHtml(h ? sanitizeHtml(h) : textHtml(cd?.getData('text/plain') || ''));
  });
  doc.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
  doc.addEventListener('drop', (e) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    // Where it was dropped is where it goes.
    const r = document.caretRangeFromPoint?.(e.clientX, e.clientY);
    if (r) { const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); lastRange = r.cloneRange(); }
    insertFiles([...e.dataTransfer.files]);
  });
  // A file link opens in the reader on a click, even while editing; a picture on
  // a double-click (one click is for placing the caret). There: Download, Copy,
  // Move or copy to a project, another note or a session (fileview.js).
  const keptHere = () => [...doc.querySelectorAll('a.file-link[href^="/api/files/"], img[src^="/api/files/"]')].map((x) => x.getAttribute('href') || x.getAttribute('src'));
  doc.addEventListener('click', (e) => { const a = e.target.closest('a.file-link'); if (a) { e.preventDefault(); e.stopPropagation(); const h = a.getAttribute('href'); if (h.startsWith('/api/files/')) openKeptFile(h, keptHere()); else window.open(h, '_blank', 'noopener'); } });
  doc.addEventListener('dblclick', (e) => { const img = e.target.closest('img[src^="/api/files/"]'); if (img) { e.preventDefault(); openKeptFile(img.getAttribute('src'), keptHere()); } });

  // ---- talk to type (voice.js finds this on the page element as target.dictation)
  // The words so far sit in a marked span at the caret, replaced as the
  // recogniser firms them up; at the end the span is unwrapped so only text
  // stays. The marker never reaches a saved page: sanitizeHtml unwraps any
  // span that is not a size, and html() runs through it.
  let dict = null;   // { span, lead }: the marker, and whether a space goes before the words
  function dictStart() {
    refocus(); caretIntoLine();
    const s = getSelection(); if (!s.rangeCount || !doc.contains(s.getRangeAt(0).startContainer)) return false;
    remember();
    const r = s.getRangeAt(0);
    if (!r.collapsed) r.deleteContents();
    const before = document.createRange(); before.selectNodeContents(blockOf(r.startContainer.nodeType === 3 ? r.startContainer.parentElement : r.startContainer) || doc); before.setEnd(r.startContainer, r.startOffset);
    const lead = /\S$/.test(before.toString()) ? ' ' : '';
    const span = document.createElement('span'); span.dataset.dictating = '';
    r.insertNode(span);
    dict = { span, lead };
    r.setStartAfter(span); r.collapse(true); s.removeAllRanges(); s.addRange(r); keepRange();
    return true;
  }
  function dictShow(text) {
    if (!dict?.span.isConnected) return;
    dict.span.textContent = text ? dict.lead + text : '';
    const r = document.createRange(); r.setStartAfter(dict.span); r.collapse(true);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r); keepRange();
    dict.span.scrollIntoView?.({ block: 'nearest' });
    changed();
  }
  function dictEnd() {
    const d = dict; dict = null;
    if (!d?.span.isConnected) return;
    const blk = blockOf(d.span), text = document.createTextNode(d.span.textContent);
    d.span.replaceWith(text);
    // A line that was empty kept its placeholder break; with words on it now, that break would be a blank line.
    if (blk && text.nodeValue && blk.lastChild?.nodeName === 'BR' && blk.lastChild !== blk.firstChild) blk.lastChild.remove();
    const r = document.createRange(); r.setStart(text, text.length); r.collapse(true);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    text.parentNode?.normalize(); keepRange(); changed();
  }
  doc.dictation = { start: dictStart, show: dictShow, end: dictEnd };

  // ---- answers after "=" lines, and log totals; shown, never saved
  function ownText(el) {
    let s = '';
    for (const n of el.childNodes) if (n.nodeType === 3) s += n.nodeValue; else if (n.nodeType === 1 && !/^(UL|OL)$/.test(n.tagName)) s += n.textContent;
    return s.replace(/ /g, ' ');
  }
  function refresh() {
    const blocks = [...doc.querySelectorAll('p, h1, h2, h3, li, blockquote')].filter((b) => !b.closest('ul.log'));
    const shown = CALC.sheet(blocks.map((b) => ({ text: ownText(b), kind: /^H/.test(b.tagName) ? 'heading' : 'text' })));
    // "3 × 4 =" shows "12"; "wire = 2 × $89" shows "= $178.00".
    blocks.forEach((b, i) => { const v = shown[i] && (/=\s*$/.test(ownText(b)) ? shown[i] : '= ' + shown[i]); if (v) { if (b.dataset.calc !== v) b.dataset.calc = v; } else if (b.dataset.calc) b.removeAttribute('data-calc'); });
    drawLog();
  }

  // ---- logs: ul.log, one entry per line ("Tue Nov 3, 6:10 PM · 14 · note")
  function logTotals() {
    const items = [...doc.querySelectorAll('ul.log > li')];
    const now = new Date(), day = new Date(now).setHours(0, 0, 0, 0);
    const week = new Date(day); week.setDate(week.getDate() - ((week.getDay() + 6) % 7));
    const month = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const t = { today: 0, week: 0, month: 0, all: 0, n: 0, money: false };
    for (const li of items) {
      const at = Number(li.dataset.at) || 0;
      const part = ownText(li).split(' · ')[1] ?? ownText(li);
      const a = CALC.lineAmount(part);
      if (!a) continue;
      t.n++; t.all += a.v; if (a.money) t.money = true;
      if (at >= day) t.today += a.v;
      if (at >= week.getTime()) t.week += a.v;
      if (at >= month) t.month += a.v;
    }
    return doc.querySelector('ul.log') ? t : null;   // an empty log still shows its Add box
  }
  function drawLog() {
    const t = logTotals();
    logsum.hidden = !t;
    if (!t) return;
    const f = (v) => CALC.format({ v, money: t.money });
    const box = (label, v) => `<div class="ls-box"><span class="ls-k">${label}</span><span class="ls-v">${f(v)}</span></div>`;
    const keep = logsum.querySelector('#ls-n') ? { n: logsum.querySelector('#ls-n').value, note: logsum.querySelector('#ls-note').value, focus: document.activeElement?.id } : null;
    logsum.innerHTML = `<div class="ls-boxes">${box('Today', t.today)}${box('This week', t.week)}${box('This month', t.month)}${box('All time', t.all)}<div class="ls-box"><span class="ls-k">Entries</span><span class="ls-v">${t.n}</span></div></div>
      <form class="ls-add" id="ls-add"><label class="sr" for="ls-n">Amount</label><input id="ls-n" inputmode="decimal" placeholder="Amount" autocomplete="off"><label class="sr" for="ls-note">Note</label><input id="ls-note" placeholder="Note (optional)" autocomplete="off"><button class="btn btn--primary" type="submit">Add</button></form>`;
    if (keep) { logsum.querySelector('#ls-n').value = keep.n; logsum.querySelector('#ls-note').value = keep.note; if (keep.focus) logsum.querySelector('#' + keep.focus)?.focus(); }
  }
  logsum.addEventListener('submit', (e) => {
    e.preventDefault();
    const n = logsum.querySelector('#ls-n').value.trim(), note = logsum.querySelector('#ls-note').value.trim();
    if (!/^-?\$?[\d,]*\.?\d+$/.test(n)) { logsum.querySelector('#ls-n').focus(); return; }
    let ul = [...doc.querySelectorAll('ul.log')].at(-1);
    if (!ul) { ul = document.createElement('ul'); ul.className = 'log'; doc.appendChild(ul); }
    const li = document.createElement('li');
    li.dataset.at = String(Date.now());
    li.textContent = [logDate(Date.now()), n, note].filter(Boolean).join(' · ');
    ul.prepend(li);
    logsum.querySelector('#ls-n').value = ''; logsum.querySelector('#ls-note').value = '';
    changed(); refresh(); logsum.querySelector('#ls-n').focus();
  });

  setBody(body);
  return {
    focused: () => doc.contains(document.activeElement) || doc === document.activeElement,
    focusEnd: () => { doc.focus(); const r = document.createRange(); r.selectNodeContents(doc); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); },
    focusStart: () => { doc.focus(); placeAtStart(doc.firstElementChild || doc); },
    // Puts the caret on the first line that has this text (a search result), and shows it.
    focusText: (text) => {
      const want = String(text || '').trim().slice(0, 60).toLowerCase();
      const blk = want && [...doc.querySelectorAll('p, h1, h2, h3, li, blockquote')].find((b) => ownText(b).toLowerCase().includes(want));
      if (!blk) return;
      doc.focus(); const r = document.createRange(); r.selectNodeContents(blk); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      blk.scrollIntoView({ block: 'center' }); blk.classList.add('ed-flash'); setTimeout(() => blk.classList.remove('ed-flash'), 1400);
    },
    load: (b) => setBody(b),
    // A change made to the page from outside (notemarks.js Mark done): saved like typing.
    edited: () => { refresh(); changed(); },
    flush: () => { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; onSave?.(html()); } },
    insertText: (t) => insertHtml(textHtml(String(t || ''))),
    html
  };
}
// How a log entry's date reads; the same on the server (lib/pages.js).
function logDate(t) { return new Date(t).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
