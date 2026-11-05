// Settings, General: Remove Switchboard from this computer (lib/uninstall.js).
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
// The button asks once in place (it turns red and says what it will do), then
// takes out what setup added. In the app the last step is the app's own: Quit
// and finish turns off start at login, deletes the data if asked, and quits.
function renderRemove(done) {
  const el = $('remove-row'); if (!el) return;
  if (done) {
    const data = done.data ? ' Your data is deleted too.' : ' Your data is kept, in case you come back.';
    el.innerHTML = done.app
      ? `<div class="form-row"><span class="acct-line">Switchboard's hooks and tools are out of your coding agents. Quit and finish stops the app and turns off start at login.${esc(data)} Then drag Switchboard from Applications (or your Programs list) to the Trash.</span><button class="btn btn--danger" type="button" id="remove-finish" data-data="${done.data ? 1 : 0}">Quit and finish</button></div>`
      : `<div class="form-row"><span class="acct-line">Done. Switchboard has stopped and will not start at login.${esc(data)} Its folder can go to the Trash now: <span class="mono">${esc(done.folder || '')}</span></span></div>`;
    return;
  }
  el.innerHTML = `<div class="form-row"><span class="acct-line">Takes out everything Switchboard added to this computer: the Claude Code hooks, its tools in your coding agents, the headless browser and start at login. Your own settings stay as they are.</span></div>`
    + `<label class="toggle"><span>Also delete my Switchboard data: settings, connections, saved passwords, the board</span><input type="checkbox" id="remove-data"></label>`
    + `<div class="form-row"><button class="btn" type="button" id="remove-go">Remove Switchboard</button><span class="acct-line" id="remove-note"></span></div>`;
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('#remove-go');
  if (b) {
    const data = !!$('remove-data')?.checked;
    if (!b.dataset.sure) {
      b.dataset.sure = '1'; b.classList.add('btn--danger');
      b.textContent = data ? 'Remove it and delete my data?' : 'Remove it from this computer?';
      setTimeout(() => { if (b.isConnected && !b.disabled) { b.dataset.sure = ''; b.classList.remove('btn--danger'); b.textContent = 'Remove Switchboard'; } }, 5000);
      return;
    }
    b.disabled = true; b.textContent = 'Removing…';
    try { renderRemove(await api('/api/remove-switchboard', { data })); }
    catch (err) { $('remove-note').textContent = err.message; $('remove-note').classList.add('bad-text'); b.disabled = false; b.dataset.sure = ''; b.classList.remove('btn--danger'); b.textContent = 'Remove Switchboard'; }
    return;
  }
  const f = e.target.closest('#remove-finish');
  if (f) {
    // The app watches for this address and finishes there (desktop/src-tauri/src/main.rs).
    if (IN_APP) location.href = '/app/remove' + (f.dataset.data === '1' ? '?data=1' : '');
    else toast('Quit Switchboard from its tray icon to finish, then drag it to the Trash.');
  }
});
