// Forgot password, in Settings, Account (the app and the web board alike): a
// code from a teammate who runs a project you are in (Settings, Team) or by
// email, then the code and a new password. The sync service clears
// the data it kept locked with the old password, and this computer (or browser)
// uploads its own copy again, locked with the new one (sync-worker/src/reset.js).
// The email's link opens the web board at #reset=<code>&email=<email>, which
// fills this in.
function showReset({ email = '', code = '' } = {}) {
  const form = $('acct-form');
  if (!form) { toast('Sign out first, then set a new password from the sign-in form.', { kind: 'error' }); return; }
  form.hidden = false;
  form.id = 'acct-reset';
  form.innerHTML = `
    <label for="rs-email">Email</label><input id="rs-email" type="email" autocomplete="username" required value="${esc(email)}">
    <span></span><div class="form-row"><button class="btn" type="button" id="rs-send">${code ? 'Send a new code' : 'Email me a code'}</button><button class="btn btn--ghost" type="button" id="rs-back">Back to sign in</button></div>
    <span></span><p class="hint">Enter the code someone who runs a project you are in gave you (Settings, Team, Reset their password), or have one emailed if this service sends email.</p>
    <label for="rs-code">Code</label><input id="rs-code" autocomplete="one-time-code" spellcheck="false" value="${esc(code)}">
    <label for="rs-pass">New password</label><input id="rs-pass" type="password" autocomplete="new-password" minlength="10">
    <span></span><p class="hint">Your computers sign out. Sign in on each with the new password and it sends its copy of your data up again. Shared projects come back once the person who runs them is online, usually within seconds.</p>
    <span></span><div class="form-row"><button class="btn btn--primary" type="submit">Set new password</button></div>
    <span></span><span id="rs-msg" class="small"></span>`;
  (code ? $('rs-pass') : email ? $('rs-code') : $('rs-email')).focus();
}
const rsMsg = (text, bad) => { const m = $('rs-msg'); if (m) { m.textContent = text; m.className = 'small ' + (bad ? 'bad-text' : 'muted'); } };

document.addEventListener('click', (e) => {
  if (e.target.closest('#acct-forgot')) { showReset({ email: $('acct-email')?.value || '' }); return; }
  if (e.target.closest('#rs-back')) { $('acct').innerHTML = ''; renderAccount(); return; }
  const send = e.target.closest('#rs-send');
  if (!send) return;
  const email = $('rs-email').value.trim();
  if (!email) { rsMsg('Enter the email of your Switchboard account.', true); return; }
  send.disabled = true; rsMsg('Sending…');
  api('/api/account/reset-start', { email })
    .then(() => { send.textContent = 'Send a new code'; rsMsg(`If ${email} has a Switchboard account, a code is on its way. It works for 30 minutes.`); $('rs-code').focus(); })
    .catch((err) => rsMsg(err.message, true))
    .finally(() => { send.disabled = false; });
});

document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'acct-reset') return;
  e.preventDefault();
  rsMsg('Setting your new password…');
  try {
    await api('/api/account/reset-finish', { email: $('rs-email').value, code: $('rs-code').value, password: $('rs-pass').value });
    $('acct').innerHTML = '';
    await load();
    toast('New password set. Sign in on your other computers with it.');
    openSettings();
  } catch (err) { rsMsg(err.message, true); }
});

// The link in the email: #reset=<code>&email=<email>. Read once, then gone from the address bar.
if (location.hash.startsWith('#reset=')) {
  const q = new URLSearchParams(location.hash.slice(1));
  const pending = { code: q.get('reset') || '', email: q.get('email') || '' };
  history.replaceState(null, '', location.pathname + location.search);
  addEventListener('load', () => setTimeout(() => { openSettings(); setTimeout(() => showReset(pending), 300); }, 300));
}
