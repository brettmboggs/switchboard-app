// Settings, Connections: Granola. Sign in with Granola (any plan, the free one
// too: Granola's own page opens in a browser tab), or on a Business plan paste
// an API key. Your meeting notes come into Notes, one page a meeting, in the
// project of the people who were in it or its name (else Personal); any page
// moves to any project from its own page. Connected, the card says how many and
// when it last looked, has Read now and Sign out. Server side: lib/granola.js, lib/granolamcp.js.
// One of the page's scripts in public/js, loaded in order by index.html.
function renderGranolaCard() {
  const el = $('granola-card'); if (!el || !SET) return;
  if (el.contains(document.activeElement) || el.querySelector('input')?.value || el.querySelector('[data-gr-msg], [data-gr-keymsg]')?.textContent) return;
  const st = S.granola || { connected: false };
  if (st.connected) {
    if (st.needsSignIn) {
      el.innerHTML = `<div class="acct-main"><b>Granola</b><span class="acct-line"><span class="bad-text">Granola signed Switchboard out, so new meeting notes are paused.</span> Sign in again to carry on; the pages already in Notes stay.</span></div>
        <div class="form-row"><button class="btn btn--primary" type="button" data-gr-signin>Sign in with Granola</button><button class="btn btn--quiet" type="button" data-gr-disconnect>Sign out</button></div>`;
      return;
    }
    const line = st.ok === false ? `<span class="bad-text">${esc(st.error)}</span>`
      : st.ok ? `Connected${st.email ? ' as ' + esc(st.email) : ''}. ${st.count ? `${st.count} meeting${st.count === 1 ? '' : 's'} in Notes` : 'No meeting notes yet (Granola shares a note once its summary is written)'}; looked ${esc(ago(st.at))}.`
      : 'Connected, reading your meeting notes…';
    el.innerHTML = `<div class="acct-main"><b>Granola</b><span class="acct-line">${line}</span></div>
      <div class="form-row"><button class="btn btn--quiet" type="button" data-gr-sync>Read now</button><button class="btn btn--quiet" type="button" data-gr-disconnect>${st.via === 'signin' ? 'Sign out' : 'Disconnect'}</button></div>`;
    return;
  }
  el.innerHTML = `<div class="acct-main"><b>Granola</b><span class="acct-line">Your meeting notes in Notes, one page a meeting, each in the project its people or its name match (else Personal; move any page to any project), so your sessions can read them too. Read only. Sign in on Granola's own page; Switchboard never sees your password.</span></div>
    <div class="form-row"><button class="btn btn--primary" type="button" data-gr-signin>Sign in with Granola</button><span class="small" data-gr-msg></span></div>
    <details class="acct-wide small"><summary class="muted">On Granola's Business plan? Use an API key instead</summary>
    <form class="form-row" data-gr-connect><label for="granola-key" class="sr">Granola API key</label><input id="granola-key" name="key" class="field" type="password" autocomplete="off" spellcheck="false" placeholder="Granola API key (grn_…), from Settings, Connectors, API keys">
      <button class="btn" type="submit">Connect</button><span class="small" data-gr-keymsg></span></form></details>`;
}
document.addEventListener('submit', async (e) => {
  const f = e.target.closest('[data-gr-connect]'); if (!f) return;
  e.preventDefault();
  const btn = f.querySelector('button[type=submit]'), msg = f.querySelector('[data-gr-keymsg]');
  btn.disabled = true; btn.textContent = 'Checking…'; msg.textContent = '';
  try {
    await api('/api/granola/connect', { key: f.querySelector('input[name="key"]').value });
    f.querySelector('input').value = '';
    toast('Granola connected. Your meeting notes from the last 30 days are coming into Notes.'); document.activeElement?.blur(); await load(); renderGranolaCard();
  } catch (err) { msg.textContent = err.message; msg.className = 'small bad-text'; btn.disabled = false; btn.textContent = 'Connect'; }
});
// Sign in with Granola: its own page in a new tab; this card follows once the tab has come back.
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-gr-signin]'); if (!b) return;
  const tab = window.open('', '_blank');   // opened in the click, so the browser allows it
  const msg = $('granola-card').querySelector('[data-gr-msg]');
  try {
    const r = await api('/api/granola/signin', {});
    if (tab) tab.location = r.url; else location.href = r.url;
    if (msg) { msg.textContent = 'Granola\'s sign-in is open in a new tab. Sign in there, then come back.'; msg.className = 'small'; }
    const t = setInterval(async () => {
      await load().catch(() => {});
      if (S.granola?.connected && !S.granola.needsSignIn) { clearInterval(t); if (msg) msg.textContent = ''; toast('Granola is signed in. Your meeting notes are coming into Notes.'); renderGranolaCard(); }
      else if (!document.body.contains(b) && !$('granola-card')) clearInterval(t);
    }, 2500);
    setTimeout(() => clearInterval(t), 10 * 60e3);
  } catch (err) { tab?.close(); if (msg) { msg.textContent = err.message; msg.className = 'small bad-text'; } else toast(err.message, { kind: 'error' }); }
});
document.addEventListener('click', async (e) => {
  if (e.target.closest('[data-gr-sync]')) {
    try { await api('/api/granola/sync', {}); toast('Reading Granola now.'); setTimeout(() => load().then(renderGranolaCard).catch(() => {}), 4000); } catch (err) { toast(err.message, { kind: 'error' }); }
  }
  if (e.target.closest('[data-gr-disconnect]')) {
    try { await api('/api/granola/disconnect', {}); toast('Granola is off. Its sign-in is removed from this computer; the meeting pages stay in Notes.'); await load(); renderGranolaCard(); } catch (err) { toast(err.message, { kind: 'error' }); }
  }
});
