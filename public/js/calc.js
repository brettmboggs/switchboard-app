// The notebook's calculator. No eval: a small parser for + - × ÷ ^ ( ) and %.
//   3 bags × $12.50 =        → $37.50   (words between numbers are labels)
//   feed = 3 × 12.50         → names a number (feed), shown when it was worked out
//   feed + 4 =               → 41.50
//   15% of 80 =              → 12        80 + 15% =  → 92
//   total =  (or sum =)      → the numbers on the lines above, back to a heading or empty line
// One of the page's scripts in public/js, loaded in order by index.html; also
// loaded by test/calc.test.js. Pure functions, no page.
const CALC = (() => {
  const NUM = /^\$?\s?\d[\d,]*(?:\.\d+)?|^\$?\s?\.\d+/;
  function tokenize(s, vars) {
    const out = [];
    let money = false, i = 0;
    s = s.replace(/[×✕✖·]/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-');
    while (i < s.length) {
      const rest = s.slice(i), c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      const n = rest.match(NUM);
      if (n) {
        if (n[0].includes('$')) money = true;
        let v = parseFloat(n[0].replace(/[$,\s]/g, ''));
        i += n[0].length;
        const pct = s[i] === '%';
        if (pct) i++;
        out.push({ t: 'num', v: pct ? v / 100 : v, pct });
        continue;
      }
      if (c === '$') { money = true; i++; continue; }
      if ('+-*/^()'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
      const w = rest.match(/^[A-Za-z_](?:\w|-(?=[A-Za-z]))*(?:\s+[A-Za-z_](?:\w|-(?=[A-Za-z]))*)*/);   // t-posts is one word
      if (w) {
        // The longest run of words that is a named number; "of" and "x" between numbers multiply; other words are labels.
        const words = w[0].split(/\s+/);
        let used = 0;
        for (let k = words.length; k > 0; k--) { const name = words.slice(0, k).join(' ').toLowerCase(); if (vars && name in vars) { out.push({ t: 'num', v: vars[name].v, pct: false }); if (vars[name].money) money = true; used = k; break; } }
        if (!used) {
          const word = words[0].toLowerCase(), prev = out.at(-1);
          if ((word === 'of' || word === 'x' || word === 'times') && prev && (prev.t === 'num' || prev.v === ')')) out.push({ t: 'op', v: '*' });
          else if (word === 'plus' || word === 'and') out.push({ t: 'op', v: '+' });
          else if (word === 'minus' || word === 'less') out.push({ t: 'op', v: '-' });
          else if (word === 'per' || word === 'divided') out.push({ t: 'op', v: '/' });
          used = 1;
        }
        i += words.slice(0, used).join(' ').length;
        continue;
      }
      return null;   // something that is not maths
    }
    return { tokens: out, money };
  }
  function parse(tokens) {
    let p = 0;
    const peek = () => tokens[p], take = () => tokens[p++];
    function expr() {
      let l = term();
      while (peek()?.t === 'op' && (peek().v === '+' || peek().v === '-')) {
        const op = take().v, r = term();
        // "80 + 15%" means 80 and 15% of it.
        l = r.pct ? { v: op === '+' ? l.v * (1 + r.v) : l.v * (1 - r.v) } : { v: op === '+' ? l.v + r.v : l.v - r.v };
      }
      return l;
    }
    function term() {
      let l = power();
      for (;;) {
        const t = peek();
        if (t?.t === 'op' && (t.v === '*' || t.v === '/')) { take(); const r = power(); l = { v: t.v === '*' ? l.v * r.v : l.v / r.v }; continue; }
        if (t && (t.t === 'num' || t.v === '(')) { const r = power(); l = { v: l.v * r.v }; continue; }   // "3 (4)" or "3 bags 4": next to each other multiplies
        return l;
      }
    }
    function power() { const b = unary(); if (peek()?.v === '^') { take(); const e = power(); return { v: Math.pow(b.v, e.v) }; } return b; }
    function unary() { if (peek()?.v === '-') { take(); const u = unary(); return { v: -u.v }; } if (peek()?.v === '+') { take(); return unary(); } return primary(); }
    function primary() {
      const t = take();
      if (!t) throw new Error('end');
      if (t.t === 'num') return { v: t.v, pct: t.pct };
      if (t.v === '(') { const v = expr(); if (take()?.v !== ')') throw new Error(')'); return v; }
      throw new Error('bad');
    }
    const v = expr();
    if (p !== tokens.length) throw new Error('left over');
    return v.v;
  }
  // One expression; null when it is not one.
  function evaluate(text, vars = {}) {
    const tk = tokenize(String(text), vars);
    if (!tk || !tk.tokens.some((t) => t.t === 'num')) return null;
    try { const v = parse(tk.tokens); return Number.isFinite(v) ? { v, money: tk.money } : null; } catch { return null; }
  }
  function format({ v, money }) {
    if (money) return (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const r = Math.round(v * 1e6) / 1e6;
    return r.toLocaleString('en-US', { maximumFractionDigits: 6 });
  }
  // The last amount on a plain line ("t-posts $40", "eggs 14"), for total =.
  function lineAmount(text) {
    const all = [...String(text).matchAll(/(\$)?\s?(-?\d[\d,]*(?:\.\d+)?)(?!\s*%)/g)];
    const m = all.at(-1);
    return m ? { v: parseFloat(m[2].replace(/,/g, '')), money: !!m[1] } : null;
  }
  // A whole page. lines: [{ text, kind: 'heading' | 'text' }]. Returns what to show after each line (or '').
  function sheet(lines) {
    const vars = {}, out = [];
    let group = [];
    for (const { text, kind } of lines) {
      const t = String(text || '').trim();
      if (kind === 'heading' || !t) { group = []; out.push(''); continue; }
      let shown = '';
      const sum = t.match(/^(total|sum|subtotal)\s*=\s*$/i);
      const asg = !sum && t.match(/^([A-Za-z][A-Za-z ]{0,30}?)\s*=\s*([^=]+?)\s*=?\s*$/);
      if (sum) {
        const v = { v: group.reduce((a, g) => a + g.v, 0), money: group.some((g) => g.money) };
        if (group.length) { shown = format(v); vars[sum[1].toLowerCase()] = v; group = [v]; }
      } else if (asg && evaluate(asg[2], vars)) {
        const v = evaluate(asg[2], vars);
        vars[asg[1].trim().toLowerCase()] = v;
        if (!/^\$?\s?[\d,.]+\s*$/.test(asg[2].trim()) || /=\s*$/.test(t)) shown = format(v);
        group.push(v);
      } else if (/=\s*$/.test(t)) {
        const v = evaluate(t.replace(/=\s*$/, ''), vars);
        if (v) { shown = format(v); group.push(v); }
      } else {
        const a = lineAmount(t);
        if (a) group.push(a);
      }
      out.push(shown);
    }
    return out;
  }
  return { evaluate, format, sheet, lineAmount };
})();
if (typeof module !== 'undefined') module.exports = CALC;
