// Routing between pages, the Ctrl K command bar, and composing a new email.
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
// ---------- routing
// The page the address names; a project's own page is #project/<id> (project.js).
function pageFromHash() {
  const h = location.hash.replace('#', '');
  const pm = h.match(/^project\/([a-z0-9-]{1,60})$/);
  if (pm) { if (openProject !== pm[1]) projEdit = false; openProject = pm[1]; page = 'project'; }
  else page = PAGES.some(([id]) => id === h) ? h : 'now';
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
  pageFromHash();
  const was = pageMemory[pageKey()], fromLink = !!keepSel;
  selected = keepSel || (was?.sel && S && find(was.sel.type, was.sel.key) ? was.sel : null);
  keepSel = null; extra = { key: null, html: '' };
  render();
  if (S) requestAnimationFrame(() => window.scrollTo(0, fromLink ? 0 : (was?.y || 0)));
}
window.addEventListener('pagehide', rememberPage);
window.addEventListener('hashchange', route);

// ---------- command bar
function openCmd() { cmdLoadEvents(); openDialog('cmd-scrim'); $('cmd-input').value = ''; cmdHits = []; cmdSel = -1; drawCmdResults(); const to = captureSpace(); $('cmd-hint').textContent = to === 'all' ? '' : `Goes to ${spaceOf(to).name} unless you add @project`; $('cmd-input').focus(); }
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openCmd(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && document.activeElement?.id === 'r-text') { e.preventDefault(); act('send', document.querySelector('[data-act="send"]')); }
  if (e.key === 'Escape' && topDialog()) closeDialog(topDialog());   // only the one on top
});
$('cmd-input').addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;
  if (cmdPick()) return;   // a search result was picked (search.js)
  const line = e.target.value.trim();
  if (!line) return;
  try {
    const item = await api('/api/capture', { line, space: captureSpace() });
    closeDialog('cmd-scrim');
    const label = { note: 'Note saved', todo: 'To-do added', reminder: 'Reminder set for ' + (item.due_at ? when(item.due_at) : ''), paid: 'Payment logged', bill: 'Bill added', invoice: 'Invoice logged, waiting on them', routine: 'Routine added: ' + (item.every || '').toLowerCase(), list: `Added ${item.count === 1 ? 'it' : item.count} to ${item.text}`, log: `Logged ${item.amount} in ${item.text}`, today: `On today's page, ${item.text}` }[item.kind];
    toast(`${label} · ${spaceOf(item.space).name}`);
    await load();
  } catch (err) { $('cmd-hint').textContent = err.message; }
});

// ---------- compose
function openCompose() {
  if (!S.sendAs.length) { toast('Add an email account in Settings first.'); return; }
  $('c-from').innerHTML = S.sendAs.map((a) => `<option value="${esc(a.address)}">${esc(a.address)}</option>`).join('');
  $('c-from').value = guessFrom({ space: project === 'all' ? 'personal' : project });
  $('c-msg').textContent = '';
  openDialog('compose-scrim');
  $('c-to').focus();
}
$('compose-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.submitter; if (btn) btn.disabled = true;
  $('c-msg').textContent = 'Sending…'; $('c-msg').className = 'small muted';
  try {
    await api('/api/compose', { from: $('c-from').value, to: $('c-to').value, subject: $('c-subject').value, text: $('c-body').value });
    closeDialog('compose-scrim');
    $('c-to').value = $('c-subject').value = $('c-body').value = '';
    toast('Sent.');
  } catch (err) { $('c-msg').textContent = err.message; $('c-msg').className = 'small bad-text'; }
  finally { if (btn) btn.disabled = false; }
});
