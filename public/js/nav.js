// Routing between pages, the Ctrl K command bar, and composing a new email.
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
// ---------- routing
// The page the address names; a project's own page is #project/<id> (project.js), its dashboard #project/<id>/dashboard (dashboard.js).
function pageFromHash() {
  const h = location.hash.replace('#', '');
  const pm = h.match(/^project\/([a-z0-9-]{1,60})(\/dashboard)?$/);
  if (pm) { if (openProject !== pm[1]) projEdit = false; openProject = pm[1]; page = 'project'; projView = pm[2] ? 'dashboard' : 'overview'; }
  else page = PAGES.some(([id]) => id === h) ? h : 'deck';   // the Deck is home (deck.js)
}
// Each page remembers where it was (scroll and the open item) for this tab, so
// going to Inbox and back to Now lands where you left Now. A link to a given
// item (keepSel) wins over what was remembered.
const pageKey = () => page === 'project' ? 'project/' + openProject : page;
const pageMemory = (() => { try { return JSON.parse(sessionStorage.getItem('sb.pages') || '{}'); } catch { return {}; } })();
function rememberPage() {
  if (!S) return;
  pageMemory[pageKey()] = { y: Math.round(window.scrollY), sel: selected ? { type: selected.type, key: selected.key } : null };
  try { sessionStorage.setItem('sb.pages', JSON.stringify(pageMemory)); } catch {}
}
function route() {
  const h = location.hash.replace('#', '');
  if (PAGE_MOVED[h]) { location.replace('#' + PAGE_MOVED[h]); return; }
  rememberPage();
  const prev = page;
  pageFromHash();
  const was = pageMemory[pageKey()], fromLink = !!keepSel;
  selected = keepSel || (was?.sel && S && find(was.sel.type, was.sel.key) ? was.sel : null);
  keepSel = null; extra = { key: null, html: '' };
  // To and from the Deck, the module zooms between its tile and its full panel
  // (the browser's view transitions; the tile and the panel share a name).
  if (S && prev !== page && (prev === 'deck' || page === 'deck') && document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.startViewTransition(() => { render(); deckNames(); });
  } else { render(); deckNames(); }
  if (S) requestAnimationFrame(() => window.scrollTo(0, fromLink ? 0 : (was?.y || 0)));
}
// The open module's panel carries its tile's name, so the two morph into each other.
function deckNames() {
  const pg = $('page'); if (!pg) return;
  const mod = page === 'project' ? 'projects' : DECK_MODS.includes(page) ? page : railOf(page);
  pg.style.viewTransitionName = page === 'deck' ? 'none' : 'mod-' + mod;
}
window.addEventListener('pagehide', rememberPage);
window.addEventListener('hashchange', route);

// ---------- command bar
function openCmd() { cmdLoadEvents(); openDialog('cmd-scrim'); $('cmd-input').value = ''; growText($('cmd-input')); cmdHits = []; cmdSel = -1; drawCmdResults(); const to = captureSpace(); $('cmd-hint').textContent = to === 'all' ? '' : `Goes to ${spaceOf(to).name} unless you add @project`; $('cmd-input').focus(); }
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openCmd(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && document.activeElement?.id === 'r-text') { e.preventDefault(); act('send', document.querySelector('[data-act="send"]')); }
  if (e.key === 'Escape' && topDialog()) closeDialog(topDialog());   // only the one on top
});
// Talking: Enter stops the mic first and the words are there to check; Enter
// again sends. Caught before every other Enter on this box (search.js picks a result on Enter).
$('cmd-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && rec?.target === e.target) { e.preventDefault(); e.stopImmediatePropagation(); stopDictation(); }
}, true);
$('cmd-input').addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter' || e.defaultPrevented) return;   // taken: the mic stopped on it (above)
  e.preventDefault();   // the box is a textarea so long lines wrap; Enter still sends, never a new line
  if (cmdPick()) return;   // a search result was picked (search.js)
  const line = e.target.value.trim();
  if (!line) return;
  try {
    const item = await api('/api/capture', { line, space: captureSpace() });
    closeDialog('cmd-scrim');
    // A calendar change: say what was done; a delete waits for its button (lib/eventedit.js).
    if (item.kind === 'event' || item.kind === 'event-edit') cal.key = '';   // the Calendar page reads its month again
    if (item.kind === 'event-edit') { toast(item.say); await load(); return; }
    if (item.kind === 'confirm') {
      toast(item.question, { action: { label: 'Delete', run: async (b) => { b.disabled = true; try { const r = await api('/api/capture', { line: item.line, confirmed: true }); toast(r.say); await load(); } catch (err) { toast(err.message, { kind: 'error' }); } } } });
      return;
    }
    const label = { note: 'Note saved', todo: 'To-do added', reminder: 'Reminder set for ' + (item.due_at ? when(item.due_at) : ''), paid: 'Payment logged', bill: 'Bill added', invoice: 'Invoice logged, waiting on them', routine: 'Routine added: ' + (item.every || '').toLowerCase(), list: `Added ${item.count === 1 ? 'it' : item.count} to ${item.text}`, log: `Logged ${item.amount} in ${item.text}`, today: `On today's page, ${item.text}`, event: `${item.text}, ${item.allDay ? new Date(item.start).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) : when(item.start)}, on ${item.calendarName}` }[item.kind];
    toast(item.kind === 'event' ? label : `${label} · ${spaceOf(item.space).name}`);
    await load();
  } catch (err) { $('cmd-hint').textContent = err.message; }
});

// ---------- compose
function openCompose() {
  if (!S.sendAs.length) { toast('Add an email account in Settings first.'); return; }
  $('c-from').innerHTML = S.sendAs.map((a) => `<option value="${esc(a.address)}">${esc(a.address)}</option>`).join('');
  $('c-from').value = guessFrom({ space: project === 'all' ? 'personal' : project });
  $('c-msg').textContent = '';
  $('c-track-slot').innerHTML = mtToggle('c-track');   // mail tracking (mailtrack.js)
  openDialog('compose-scrim');
  $('c-to').focus();
}
$('compose-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.submitter; if (btn) btn.disabled = true;
  $('c-msg').textContent = 'Sending…'; $('c-msg').className = 'small muted';
  try {
    await api('/api/compose', { from: $('c-from').value, to: $('c-to').value, subject: $('c-subject').value, text: $('c-body').value, track: mtTrackValue('c-track') });
    closeDialog('compose-scrim');
    $('c-to').value = $('c-subject').value = $('c-body').value = '';
    toast('Sent.');
  } catch (err) { $('c-msg').textContent = err.message; $('c-msg').className = 'small bad-text'; }
  finally { if (btn) btn.disabled = false; }
});
