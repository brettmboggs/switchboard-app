/* global document, NodeFilter, getComputedStyle */
// Wrap check: lists every short piece of text on the page that is drawn on more
// than one line (DESIGN.md, "Text never wraps a label"). Run it in the browser on any
// Switchboard page, in the console or through a browser tool, with the page at
// a normal window size; it returns [{ text, where, lines }] and changes nothing.
// A label (a time, a date, an amount, a name, a button) must come back empty.
// It is a plain script, not loaded by the page.
(() => {
  const LABEL = 60;   // characters: longer text is a sentence, which may wrap between words
  const skip = '[hidden], .scrim:not(.open), .xterm, pre, code, textarea, input, select, svg, .sr';
  const where = (el) => {
    const parts = [];
    for (let e = el; e && e !== document.body && parts.length < 4; e = e.parentElement) parts.unshift(e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : ''));
    return parts.join(' > ');
  };
  const out = [], seen = new Set();
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walk.nextNode()) {
    const node = walk.currentNode, text = node.textContent.replace(/\s+/g, ' ').trim();
    const el = node.parentElement;
    if (!text || text.length > LABEL || !el || seen.has(el) || el.closest(skip)) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue;
    const range = document.createRange(); range.selectNodeContents(node);
    const lines = new Set([...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1).map((r) => Math.round(r.top)));
    if (lines.size > 1) { seen.add(el); out.push({ text, where: where(el), lines: lines.size }); }
  }
  return out;
})();
