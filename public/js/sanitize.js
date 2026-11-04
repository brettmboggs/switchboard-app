// The notebook's sanitiser: only what the page editor itself makes gets
// through. Used by editor.js when a page loads, when something is pasted and
// when the page is saved. Loaded before editor.js by index.html; the page's
// scripts share one scope, so sanitizeHtml is in reach there.
// test/sanitize.test.js runs it in a headless browser.
//
// A page is stored as HTML, and only these tags ever survive:
// p h1 h2 h3 b i u s ul ol li blockquote hr br, span with a size class, and
// ul class="checklist" / "log" with li data-checked / data-at. Everything else
// (scripts, styles, links, handlers, images, frames) is dropped; an unknown
// wrapper is unwrapped and its text kept. Bold, italic, underline, strike and
// size are read off pasted styles; no style attribute is ever kept.
const ED_TAGS = { P: 'p', DIV: 'p', H1: 'h1', H2: 'h2', H3: 'h3', H4: 'h3', H5: 'h3', H6: 'h3', B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u', INS: 'u', S: 's', STRIKE: 's', DEL: 's', UL: 'ul', OL: 'ol', LI: 'li', BLOCKQUOTE: 'blockquote', HR: 'hr', BR: 'br', SPAN: 'span', FONT: 'span' };
const ED_DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'SVG', 'MATH', 'HEAD', 'TITLE', 'META', 'LINK', 'NOSCRIPT', 'FORM', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'IMG', 'VIDEO', 'AUDIO', 'CANVAS']);
const FONT_SIZE = { 1: 's', 2: 's', 4: 'l', 5: 'l', 6: 'xl', 7: 'xl' };

// Only what the editor itself makes gets through.
function sanitizeHtml(html) {
  const src = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body;
  const out = document.createElement('div');
  (function copy(from, to) {
    for (const n of [...from.childNodes]) {
      if (n.nodeType === 3) { to.appendChild(document.createTextNode(n.nodeValue)); continue; }
      // Inside <svg> and <math> tag names come back lowercase: compare upper, so those and anything in them go.
      const T = n.nodeType === 1 ? n.tagName.toUpperCase() : '';
      if (n.nodeType !== 1 || ED_DROP.has(T)) continue;
      const tag = ED_TAGS[T];
      if (!tag) { copy(n, to); continue; }   // unknown wrapper: keep what is inside
      // Styles pasted from elsewhere: bold, italic, underline, strike and size read from them, nothing else kept.
      const st = n.style || {}, inner = [];
      let size = null;
      if (tag === 'span') {
        const cls = [...n.classList].find((c) => /^fs-(s|l|xl)$/.test(c));
        size = cls ? cls.slice(3) : n.tagName === 'FONT' ? FONT_SIZE[n.getAttribute('size')] || null : null;
        if (!size && st.fontSize) { const px = parseFloat(st.fontSize); size = px && px < 13 ? 's' : px >= 26 ? 'xl' : px >= 19 ? 'l' : null; }
      }
      if (/^(bold|[6-9]00)$/.test(st.fontWeight || '') && tag !== 'b' && !/^h/.test(tag)) inner.push('b');
      if (st.fontStyle === 'italic' && tag !== 'i') inner.push('i');
      if (/underline/.test(st.textDecoration || st.textDecorationLine || '') && tag !== 'u') inner.push('u');
      if (/line-through/.test(st.textDecoration || st.textDecorationLine || '') && tag !== 's') inner.push('s');
      let el;
      if (tag === 'span') {
        if (!size) { let host = to; for (const t of inner) { const x = document.createElement(t); host.appendChild(x); host = x; } copy(n, host); continue; }
        el = document.createElement('span'); el.className = 'fs-' + size;
      } else el = document.createElement(tag);
      if (tag === 'ul') { const k = n.classList.contains('checklist') ? 'checklist' : n.classList.contains('log') ? 'log' : ''; if (k) el.className = k; }
      if (tag === 'li') {
        if (n.parentElement?.classList.contains('checklist') || n.hasAttribute('data-checked')) el.dataset.checked = n.dataset.checked === 'true' ? 'true' : 'false';
        if (/^\d{10,14}$/.test(n.dataset.at || '')) el.dataset.at = n.dataset.at;
      }
      to.appendChild(el);
      let host = el;
      for (const t of inner) { const x = document.createElement(t); host.appendChild(x); host = x; }
      copy(n, host);
    }
  })(src, out);
  // A list item inside a checklist is always a checkbox.
  out.querySelectorAll('ul.checklist > li:not([data-checked])').forEach((li) => { li.dataset.checked = 'false'; });
  return out.innerHTML;
}
