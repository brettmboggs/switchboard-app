// The question an agent is asking in its own screen (a permission prompt, a
// "trust this folder?", a choice from AskUserQuestion), read off the screen
// text so the Chat view can show it as buttons instead of sending the user to the
// terminal.
//
// Claude Code draws these as a block like
//
//   ─────────────────────────────        (the top edge)
//    Bash command
//    Write current date to stamp.txt
//   ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌        (the command sits between these)
//    date > stamp.txt
//   ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//    Do you want to proceed?
//    ❯ 1. Yes
//      2. Yes, and always allow access to … from this project
//      4. No
//    Esc to cancel · Tab to amend
//
// with ❯ on the choice the cursor is on, numbers or none, and long choices
// wrapped onto lines indented further. Older versions put it in a │ box.
// The model picker (/model, checked Nov 4 2026) is the same shape two columns
// further in, under a ▔ rule, each choice followed by its description after a
// run of spaces, ↓ on the last one shown with "… +4 models" under it, and a
// "◐ Medium effort (default) ←/→ to adjust" line between the choices and the
// footer: those two lines are kept as notes. The cursor's column sets where
// the choices are. (/effort is a slider, not a list, so it is not read.)
// Nothing counts as a question without both a footer line and a ❯, so the
// main prompt ("❯ " with "esc to interrupt" under it) never does.
// Pure functions: the screen comes from lib/terminals.js (screenText).
import { createHash } from 'node:crypto';

const FOOTER = /\b(Esc to (cancel|go back|exit)|Enter to (confirm|select|submit|continue|set as default)|↑\/?↓ to (navigate|select))\b/i;
const TOP = /^\s*╭?─{8,}╮?\s*$|^\s*▔{8,}/;    // the dialog's top edge (with corners in the old box; a ▔ rule with text in it)
const BOTTOM = /^\s*╰─{8,}╯\s*$/;             // the old box's bottom edge, between the choices and the footer
const INNER = /^\s*[╌┄┈╍┅┉-]{8,}\s*$/;       // separators inside it
const CURSOR = /^( *)[❯›>] \S/;              // the choice the cursor is on; its indent is the cursor's column
const NOTE = /^\s*(…|[◐◑◒◓●○])/;              // "… +4 models", the effort line: kept as notes, never a choice

const unbox = (l) => l.replace(/\s+$/, '').replace(/^\s?│/, '').replace(/│$/, '').replace(/\s+$/, '');
// A choice "Opus 5.5 ✔             For complex work" is its name, then its description after a run of spaces.
const split = (s) => { const m = s.match(/^(.*?\S)\s{2,}(\S.*)$/); return m ? [m[1], m[2]] : [s.trim(), '']; };

export function parseMenu(screen) {
  const lines = String(screen || '').split('\n').map(unbox);
  while (lines.length && !lines.at(-1).trim()) lines.pop();   // the screen's empty rows under the prompt
  // The footer: the last such line, near the bottom.
  let f = -1;
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 12); i--) if (FOOTER.test(lines[i])) { f = i; break; }
  if (f < 0) return null;
  // The cursor: the last ❯ line above the footer; its column is where every choice's cursor sits.
  let sel = -1;
  for (let i = f - 1; i >= Math.max(0, f - 40); i--) if (CURSOR.test(lines[i])) { sel = i; break; }
  if (sel < 0) return null;
  const col = lines[sel].match(CURSOR)[1].length;
  const OPTION = new RegExp(`^ {${col}}([❯›>↓↑ ]) (\\S.*)$`);   // the cursor (↓ ↑: more beyond the screen), then the choice
  const MORE = new RegExp(`^ {${col + 3},}\\S`);                 // a long choice carried onto the next line
  // The choices: the block of option lines (and their carried-on lines) just
  // above the footer, with up to a few note lines between.
  const notes = [];
  let end = f - 1;
  while (end >= 0 && (!lines[end].trim() || BOTTOM.test(lines[end]) || (notes.length < 4 && NOTE.test(lines[end]) && !OPTION.test(lines[end])))) {
    if (lines[end].trim() && !BOTTOM.test(lines[end])) notes.unshift(lines[end].trim());
    end--;
  }
  let start = end;
  while (start >= 0 && (OPTION.test(lines[start]) || (MORE.test(lines[start]) && start > 0))) start--;
  start++;
  const options = [];
  for (let i = start; i <= end; i++) {
    const m = lines[i].match(OPTION);
    if (m) {   // OPTION and MORE never both match: a choice starts two past the cursor, a carried line after it
      const num = m[2].match(/^(\d+)[.)]\s+(.*)$/);
      const [label, hint] = split(num ? num[2] : m[2]);
      options.push({ label, hint, n: num ? Number(num[1]) : null, selected: /[❯›>]/.test(m[1]) });
    } else if (options.length) {
      const o = options.at(-1);
      if (o.hint) o.hint += ' ' + lines[i].trim(); else o.label += ' ' + lines[i].trim();
    }
  }
  if (options.length < 2 || options.filter((o) => o.selected).length !== 1) return null;
  // What is being asked: everything between the top edge and the choices.
  let top = start - 1;
  while (top >= 0 && start - top < 40 && !TOP.test(lines[top])) top--;
  const body = lines.slice(top + 1, start);
  const out = [];
  let code = false;
  for (const l of body) {
    if (INNER.test(l)) { code = !code; continue; }
    const t = l.trim();
    if (!t || /^Tip:/i.test(t)) continue;
    out.push({ t: code ? l.replace(/^ /, '') : t, code });
  }
  // The last plain line is the question; the first plain line, when there is
  // more, is the title ("Bash command").
  let question = '', title = '';
  for (let i = out.length - 1; i >= 0; i--) if (!out[i].code) { question = out.splice(i, 1)[0].t; break; }
  if (out.length && !out[0].code) title = out.shift().t;
  const menu = { title, lines: out.slice(-24), question, options: options.map(({ label, hint, n }) => ({ label, ...(hint ? { hint } : {}), n })), notes, at: options.findIndex((o) => o.selected) };
  menu.sig = menuSig(menu);
  return menu;
}

// Which question this is: the same title, question and choices give the same sig,
// so an answer is only typed into the question the user saw.
export function menuSig(m) {
  return createHash('sha256').update(JSON.stringify([m.title, m.question, m.options.map((o) => o.label)])).digest('hex').slice(0, 16);
}

// The keys that move from the current choice to choice `index` and pick it.
export function keysFor(menu, index) {
  const d = index - menu.at;
  return [...Array(Math.abs(d)).fill(d > 0 ? 'Down' : 'Up'), 'Enter'];
}
