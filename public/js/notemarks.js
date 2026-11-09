// On an open note, a small mark after each line that went to a session
// (lib/notemarks.js finds them in what Claude Code sessions were sent, however
// it got there: Send to session, the queue, a paste). It says where it went
// and how far that got: "Sent · Build notes working", "Build notes needs you",
// then "Claude finished". Finished only means that turn ended, not that it was
// done right, so the line is ticked off by you: click the mark, Mark done
// (a checklist line is ticked, any other line crossed out) and the mark goes.
// The marks sit over the page (absolutely placed in .ed-body), never in it,
// so nothing of them is ever saved into the note.
// One of the page's scripts in public/js, loaded in order by index.html.
const nmKey = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
let nmFrame = 0, nmOpen = null, nmLast = '';   // nmOpen: the line whose menu is showing; nmLast: what was drawn
const nmLater = () => { if (!nmFrame) nmFrame = requestAnimationFrame(drawNoteMarks); };

// A line's own text: a bullet without the bullets under it.
function nmOwn(el) {
  return [...el.childNodes].filter((n) => !(n.nodeType === 1 && /^(UL|OL)$/.test(n.tagName))).map((n) => n.textContent).join(' ');
}
function nmWords(m) {
  const t = (S.terms || []).find((x) => x.id === m.term);
  const name = t ? termLabel(t) : m.name || 'a session';
  if (m.finished) return { cls: 'note-mark--done', text: `Claude finished · ${ago(m.finished)}`, title: `Sent to ${name} ${ago(m.sent)}; its turn ended ${ago(m.finished)}. Check it, then Mark done.` };
  const state = t?.state || m.state;
  if (state === 'waiting') return { cls: 'note-mark--ask', text: `${name} needs you`, title: `Sent to ${name} ${ago(m.sent)}. It is asking you something.` };
  if (state === 'ended' || (m.term && !t && !m.state)) return { cls: '', text: `Sent · session ended`, title: `Sent to ${name} ${ago(m.sent)}; the session ended before its turn did.` };
  return { cls: '', text: `Sent · ${name}${state === 'running' ? ' working' : ''}`, title: `Sent to ${name} ${ago(m.sent)}.` };
}

function drawNoteMarks() {
  nmFrame = 0;
  const body = $('ed-body'), doc = body?.querySelector('.ed-doc');
  const clear = () => { body?.querySelectorAll('.note-mark, .nm-menu').forEach((x) => x.remove()); nmLast = ''; };
  if (!body || !doc || typeof edUid === 'undefined' || !edUid) return clear();
  const marks = new Map((S.noteMarks || []).filter((m) => m.page === edUid).map((m) => [m.line, m]));
  if (!marks.size) return clear();
  const box = body.getBoundingClientRect(), edge = doc.getBoundingClientRect().right - box.left;
  const shown = new Set(), out = [];
  for (const el of doc.querySelectorAll('li, p, h1, h2, h3, blockquote')) {
    const k = nmKey(nmOwn(el)), m = marks.get(k);
    if (!m || shown.has(k)) continue;
    shown.add(k);
    // After the end of the line's own last row of text, past where the line's Send button sits.
    const r = document.createRange(); r.selectNodeContents(el);
    const nested = el.querySelector(':scope > ul, :scope > ol'); if (nested) r.setEndBefore(nested);
    const rows = [...r.getClientRects()].filter((x) => x.width);
    const last = rows[rows.length - 1] || el.getBoundingClientRect();
    const w = nmWords(m), b = document.createElement('button');
    b.type = 'button'; b.className = `note-mark ${w.cls}`; b.contentEditable = 'false';
    b.dataset.nmLine = k; b.title = w.title; b.textContent = w.text;
    b.setAttribute('aria-expanded', String(nmOpen === k));
    b.style.top = `${last.top - box.top + body.scrollTop + last.height / 2}px`;
    b.style.left = `${Math.min(last.right - box.left + 40, Math.max(edge - 160, 0))}px`;
    out.push(b);
    if (nmOpen === k) out.push(nmMenu(k, b));
  }
  // The board redraws every few seconds: put new marks in only when they changed, so a click is never lost mid-redraw.
  const sig = out.map((x) => x.outerHTML).join('');
  if (sig === nmLast && body.querySelector('.note-mark, .nm-menu')) return;
  body.querySelectorAll('.note-mark, .nm-menu').forEach((x) => x.remove());
  body.append(...out);
  nmLast = sig;
}
function nmMenu(k, b) {
  const m = document.createElement('div');
  m.className = 'nm-menu'; m.contentEditable = 'false';
  m.style.top = `calc(${b.style.top} + var(--sp-4))`; m.style.left = b.style.left;
  const mark = (S.noteMarks || []).find((x) => x.page === edUid && x.line === k);
  const t = mark && (S.terms || []).find((x) => x.id === mark.term);
  m.innerHTML = `<button class="btn btn--sm" type="button" data-nm-done>Mark done</button>${t ? '<button class="btn btn--quiet btn--sm" type="button" data-nm-open>Open session</button>' : ''}<button class="btn btn--quiet btn--sm" type="button" data-nm-clear>Remove mark</button>`;
  m.dataset.nmLine = k;
  return m;
}
async function nmClear(k) {
  S.noteMarks = (S.noteMarks || []).filter((x) => !(x.page === edUid && x.line === k));
  nmOpen = null; nmLater();
  await api('/api/notemarks/clear', { page: edUid, line: k }).catch((err) => toast(err.message, { kind: 'error' }));
}
// Mark done: tick a checklist line, else cross the line's own words out; then the mark goes.
function nmDone(k) {
  const doc = $('ed-body')?.querySelector('.ed-doc');
  const el = doc && [...doc.querySelectorAll('li, p, h1, h2, h3, blockquote')].find((x) => nmKey(nmOwn(x)) === k);
  if (el && editor) {
    if (el.tagName === 'LI' && el.parentElement?.classList.contains('checklist')) el.dataset.checked = 'true';
    else if (!el.querySelector(':scope > s')) {
      const s = document.createElement('s');
      for (const n of [...el.childNodes]) { if (n.nodeType === 1 && /^(UL|OL)$/.test(n.tagName)) break; s.append(n); }
      el.prepend(s);
    }
    editor.edited();
  }
  nmClear(k);
  toast('Marked done.');
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('.note-mark');
  if (b) { e.preventDefault(); nmOpen = nmOpen === b.dataset.nmLine ? null : b.dataset.nmLine; return nmLater(); }
  const menu = e.target.closest('.nm-menu');
  if (menu) {
    const k = menu.dataset.nmLine;
    if (e.target.closest('[data-nm-done]')) return nmDone(k);
    if (e.target.closest('[data-nm-clear]')) return nmClear(k);
    if (e.target.closest('[data-nm-open]')) {
      const m = (S.noteMarks || []).find((x) => x.page === edUid && x.line === k);
      nmOpen = null; currentTerm = m.term; store.set('term', currentTerm); location.hash = '#sessions';
    }
    return;
  }
  if (nmOpen) { nmOpen = null; nmLater(); }
});
document.addEventListener('mousedown', (e) => { if (e.target.closest('.note-mark, .nm-menu')) e.preventDefault(); });   // the caret stays put
document.addEventListener('input', (e) => { if (e.target.closest?.('.ed-doc')) nmLater(); });
window.addEventListener('resize', nmLater);
