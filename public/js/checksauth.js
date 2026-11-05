// Signed-in browser checks (lib/checkauth.js): the Sign in block in a check's
// panel and its buttons. The person signs in themselves in a browser window on
// this computer; Switchboard never sees a password, a code or an answer, and the
// saved sign-in is a file only their account can read. Loaded after checks.js.
function bcSigninBlock(x) {
  const s = x.signin;
  if (!s) return '';
  const btn = (act, label, cls = 'btn') => `<button class="${cls}" type="button" data-bcs="${act}" data-id="${x.id}">${label}</button>`;
  const states = {
    open: [`A browser window is open on this computer at ${esc(s.url)}. Sign in there yourself, wait until you are back on the site itself, then press Done here.`, btn('done', 'Done, I\'m signed in', 'btn btn--primary') + btn('cancel', 'Cancel')],
    starting: ['Opening a browser window on this computer…', btn('cancel', 'Cancel')],
    saving: ['Saving your sign-in…', ''],
    ok: [`Signed in. Saved ${esc(ago(s.savedAt))}. If it runs out, the check stops and asks you to sign in again.`, btn('signin', 'Sign in again') + btn('signout', 'Sign out')],
    expired: ['The saved sign-in ran out, so the check is paused until you sign in again.', btn('signin', 'Sign in', 'btn btn--primary') + btn('signout', 'Sign out')],
    none: ['Not signed in yet. The check runs once you have.', btn('signin', 'Sign in', 'btn btn--primary')]
  };
  const [text, buttons] = states[s.state] || states.none;
  return `<div class="section-label">Sign-in</div><p>${text}</p>
    ${s.message && (s.result === 'waiting' || !['ok', 'open', 'starting', 'saving'].includes(s.state)) ? `<p class="note-line">${esc(s.message)}</p>` : ''}
    <div class="actions">${buttons}</div>
    <p class="muted small">Your password, codes and answers go only to the site's own page, in that window. Switchboard keeps just the browser's sign-in, in a file only your account on this computer can read. It never leaves this computer or shows here, and Sign out or removing the check deletes it.</p>`;
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-bcs]');
  if (!b) return;
  const id = Number(b.dataset.id), act = b.dataset.bcs;
  b.disabled = true;
  try {
    await api('/api/checks/' + (act === 'signin' ? 'signin' : act === 'signout' ? 'signout' : 'signin/' + act), { id });
    if (act === 'signin') toast('A sign-in window is opening on this computer. Sign in there, then press Done here.');
    if (act === 'signout') toast('Signed out. The saved sign-in is deleted.');
    if (act === 'done') toast('Saving your sign-in…');
    await load();
  } catch (err) { toast(err.message, { kind: 'error' }); }
  finally { if (b.isConnected) b.disabled = false; }
});
