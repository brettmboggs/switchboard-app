// Keyboard shortcuts: ? shows them all; G then a letter goes to a page (as in
// Gmail and GitHub). Only when no box is being typed in and no dialog is open.
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
const GO_KEYS = { n: 'now', s: 'sessions', b: 'builds', c: 'calendar', i: 'inbox', m: 'money', o: 'notes', u: 'usage' };
const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
// Inside the Switchboard app the page is opened with ?app=quit: Ctrl+Q then
// quits the app (it watches for /app/quit; desktop/src-tauri/src/main.rs),
// the same as Quit in its tray menu. In a browser tab Ctrl+Q is left alone.
// Remembered for the tab, since the address loses the ?app=quit as pages change.
if (new URLSearchParams(location.search).get('app') === 'quit') sessionStorage.setItem('sb.inApp', '1');
const IN_APP = sessionStorage.getItem('sb.inApp') === '1';
window.addEventListener('keydown', (e) => {
  if (!IN_APP || !e.ctrlKey || e.shiftKey || e.altKey || e.metaKey || e.key.toLowerCase() !== 'q') return;
  e.preventDefault(); e.stopPropagation();
  try { saveDrafts(); } catch {}
  location.href = '/app/quit';
}, true);
const KEY_GROUPS = [
  ['Anywhere', [[[MOD, 'K'], 'Command bar: add a note, reminder, to-do or bill, or search'], [['Ctrl', 'Space'], 'Hold and talk to Jarvis; let go and it answers'], [['?'], 'These shortcuts'], [['Esc'], 'Close the dialog on top'], [[MOD, 'Z'], 'Undo Done, Delete or archive (while Undo shows)'], [[','], 'Settings'], ...(IN_APP ? [[['Ctrl', 'Q'], 'Quit the Switchboard app (your sessions keep running)']] : [])]],
  ['Go to', Object.entries(GO_KEYS).map(([k, p]) => [['G', k.toUpperCase()], PAGES.find(([id]) => id === p)?.[1] || p])],
  ['Writing', [[['Enter'], 'Send a message to a session'], [['Shift', 'Enter'], 'A new line'], [[MOD, 'Enter'], 'Send a reply in Inbox'], [['/'], 'Claude\'s commands, in a session\'s message bar'], [[MOD, 'B'], 'Bold, in Notes (I italic, U underline)']]],
  ['In a Claude session\'s terminal', [[['Shift', 'Enter'], 'A new line'], [['Ctrl', 'Enter'], 'Send now, even while Claude is working'], [['Ctrl', 'Backspace'], 'Delete a word']]]
];
function renderKeys() {
  const kbd = (ks) => ks.map((k) => `<kbd>${esc(k)}</kbd>`).join('<span class="keys-then">' + (ks[0] === 'G' ? 'then' : '+') + '</span>');
  $('keys-list').innerHTML = KEY_GROUPS.map(([title, rows]) => `<section><h3 class="kicker">${esc(title)}</h3><dl>${rows.map(([ks, what]) => `<div><dt>${kbd(ks)}</dt><dd>${esc(what)}</dd></div>`).join('')}</dl></section>`).join('');
}

let goArmed = 0;
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
  const t = e.target;
  if (t.closest?.('input, textarea, select, [contenteditable="true"], .xterm') || topDialog()) { goArmed = 0; return; }
  if (e.key === '?') { e.preventDefault(); renderKeys(); openDialog('keys-scrim'); return; }
  if (e.key === ',') { e.preventDefault(); openSettings(); return; }
  if (e.key === 'g' || e.key === 'G') { goArmed = Date.now(); return; }
  const go = GO_KEYS[e.key.toLowerCase()];
  if (go && goArmed && Date.now() - goArmed < 1500) { e.preventDefault(); goArmed = 0; location.hash = '#' + go; return; }
  goArmed = 0;
});
