// Google Calendar in Settings, Connections (lib/google.js): one Sign in with
// Google button (Google's own page opens in a new tab and you sign in there),
// then a tick per calendar on the account, a project and Add. Switchboard never
// sees a Google password. One of the page's scripts in public/js, loaded in
// order by index.html; they share one scope, so names defined earlier are usable.
let gPick = null;   // { calendars, email, error, busy } while the list of the account's calendars is open
function renderGoogleCal() {
  const host = $('cal-google'); if (!host || !SET) return;
  if (gPick?.calendars && host.querySelector('[data-g-pick]')) return;   // ticks stay put
  const g = SET.google || {};
  const mine = (SET.calendars || []).filter((c) => c.kind === 'google');
  if (gPick?.calendars) {
    host.innerHTML = `<div class="cal-acct" data-g-pick><b>Google calendars for ${esc(gPick.email || 'your account')}</b>
      ${gPick.calendars.map((c, i) => `<label class="cal-tick"><input type="checkbox" data-g-i="${i}" ${c.added ? 'disabled checked' : c.primary ? 'checked' : ''}> ${c.color ? `<span class="tag" style="background:${safeColor(c.color)}"></span>` : ''}${esc(c.name)}${c.canWrite ? '' : ' <span class="muted small">read only</span>'}${c.added ? ' <span class="muted small">added</span>' : ''}</label>`).join('')}
      <div class="form-row"><select id="g-space" class="field field--sm" aria-label="Project">${SET.spaces.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select>
        <button class="btn btn--primary" type="button" data-g="add" ${gPick.calendars.some((c) => !c.added) ? '' : 'disabled'}>Add</button><button class="btn" type="button" data-g="cancel">Cancel</button><span id="g-msg" class="small"></span></div></div>`;
    return;
  }
  if (!g.configured) { host.innerHTML = ''; return; }
  host.innerHTML = g.connected
    ? `<div class="cal-acct"><span>Google: <b>${esc(g.email || 'connected')}</b>${mine.length ? ` <span class="muted small">${mine.length} calendar${mine.length === 1 ? '' : 's'} added</span>` : ''}${gPick?.error ? ` <span class="bad-text small">${esc(gPick.error)}</span>` : ''}</span>
        <span class="form-row"><button class="btn" type="button" data-g="find">${gPick?.busy ? 'Looking…' : mine.length ? 'Add more' : 'Choose calendars'}</button><button class="btn btn--quiet" type="button" data-g="disconnect">Sign out of Google</button></span></div>`
    : `<div class="cal-acct"><span>Read and change your Google calendar from Switchboard.</span><button class="btn btn--primary" type="button" data-g="signin">Sign in with Google</button></div>`;
}

async function gFind() {
  gPick = { busy: true }; renderGoogleCal();
  try { const r = await api('/api/google/calendars', {}); gPick = { calendars: r.calendars, email: r.email }; }
  catch (err) { gPick = { error: err.message }; }
  renderGoogleCal();
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-g]');
  if (!b) return;
  const act = b.dataset.g;
  if (act === 'signin') {
    // Open the tab first (the click allows it), then point it at Google's own page.
    const tab = window.open('', '_blank');
    try {
      const r = await api('/api/google/start', {});
      if (tab) tab.location = r.url; else location.href = r.url;
      toast('Google\'s sign-in is open in a new tab. Sign in there, then come back.');
      // The new tab finishes the sign-in; when this page sees it, offer the calendars.
      const was = SET.google.connected;
      const t = setInterval(async () => {
        SET = await api('/api/settings').catch(() => SET);
        if (SET.google?.connected && !was) { clearInterval(t); renderCalendars(); gFind(); }
        else if (!document.body.contains($('cal-google'))) clearInterval(t);
      }, 2000);
      setTimeout(() => clearInterval(t), 10 * 60e3);
    } catch (err) { tab?.close(); toast(err.message, { kind: 'error' }); }
  } else if (act === 'find') gFind();
  else if (act === 'cancel') { gPick = null; $('cal-google').innerHTML = ''; renderGoogleCal(); }
  else if (act === 'disconnect') {
    b.disabled = true;
    try { await api('/api/google/disconnect', {}); gPick = null; SET = await api('/api/settings'); renderCalendars(); toast('Signed out of Google. Its calendars are removed from Switchboard.'); }
    catch (err) { b.disabled = false; toast(err.message, { kind: 'error' }); }
  } else if (act === 'add' && gPick?.calendars) {
    const ids = [...document.querySelectorAll('[data-g-i]')].filter((x) => x.checked && !x.disabled).map((x) => gPick.calendars[Number(x.dataset.gI)].calendarId);
    b.disabled = true;
    try {
      const r = await api('/api/google/add', { calendarIds: ids, space: $('g-space').value });
      gPick = null; $('cal-google').innerHTML = '';
      SET = await api('/api/settings'); renderCalendars();
      toast(r.added === 1 ? 'Calendar added.' : `${r.added} calendars added.`);
    } catch (err) { b.disabled = false; $('g-msg').textContent = err.message; $('g-msg').className = 'small bad-text'; }
  }
});
