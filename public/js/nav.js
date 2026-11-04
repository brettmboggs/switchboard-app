// Routing between pages, the Ctrl K command bar, and composing a new email.
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
// ---------- routing
function route() {
  const h = location.hash.replace('#', '');
  if (PAGE_MOVED[h]) { location.replace('#' + PAGE_MOVED[h]); return; }
  page = PAGES.some(([id]) => id === h) ? h : 'now';
  selected = keepSel; keepSel = null; extra = { key: null, html: '' };
  render();
}
window.addEventListener('hashchange', route);

// ---------- command bar
function openCmd() { $('cmd-scrim').classList.add('open'); $('cmd-input').value = ''; cmdHits = []; cmdSel = -1; drawCmdResults(); $('cmd-hint').textContent = project === 'all' ? '' : `Goes to ${spaceOf(project).name} unless you add @project`; $('cmd-input').focus(); }
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openCmd(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && document.activeElement?.id === 'r-text') { e.preventDefault(); act('send', document.querySelector('[data-act="send"]')); }
  if (e.key === 'Escape') document.querySelectorAll('.scrim.open').forEach((s) => s.classList.remove('open'));
});
$('cmd-input').addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;
  if (cmdPick()) return;   // a search result was picked (notebook.js)
  const line = e.target.value.trim();
  if (!line) return;
  try {
    const item = await api('/api/capture', { line, space: project });
    $('cmd-scrim').classList.remove('open');
    const label = { note: 'Note saved', todo: 'To-do added', reminder: 'Reminder set for ' + (item.due_at ? when(item.due_at) : ''), paid: 'Payment logged', bill: 'Bill added', invoice: 'Invoice logged, waiting on them', routine: 'Routine added: ' + (item.every || '').toLowerCase(), list: `Added ${item.count === 1 ? 'it' : item.count} to ${item.text}`, log: `Logged ${item.amount} in ${item.text}` }[item.kind];
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
  $('compose-scrim').classList.add('open');
  $('c-to').focus();
}
$('compose-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.submitter; if (btn) btn.disabled = true;
  $('c-msg').textContent = 'Sending…'; $('c-msg').className = 'small muted';
  try {
    await api('/api/compose', { from: $('c-from').value, to: $('c-to').value, subject: $('c-subject').value, text: $('c-body').value });
    $('compose-scrim').classList.remove('open');
    $('c-to').value = $('c-subject').value = $('c-body').value = '';
    toast('Sent.');
  } catch (err) { $('c-msg').textContent = err.message; $('c-msg').className = 'small bad-text'; }
  finally { if (btn) btn.disabled = false; }
});
