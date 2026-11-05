// Loading the board state, installing as an app, and starting up. Loaded last.
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
// ---------- data
let loading = false, again = false, offlineSince = 0, retryTimer = null;
async function load() {
  if (loading) { again = true; return; }
  loading = true;
  clearTimeout(retryTimer);
  let state;
  try { state = await api('/api/state'); offlineSince = 0; }
  catch (e) {
    // Only a server that does not answer is "not running". A restart after an
    // update or a code change takes a second or two, so say that first and keep
    // trying; only after half a minute say it is down.
    const el = $('status'); el.hidden = false; el.title = '';
    if (e?.data?.offline) {
      offlineSince ||= Date.now();
      el.textContent = Date.now() - offlineSince < 30000 ? 'Switchboard is restarting. Reconnecting…' : 'Switchboard server is not running. Restart this computer\'s Switchboard, or wait: this page reconnects by itself.';
      retryTimer = setTimeout(load, 2000);
    } else el.textContent = e?.message || 'Switchboard could not load the board. Reload the page.';
    loading = false; if (again) { again = false; load(); }
    return;
  }
  // A mistake in the page itself is reported as one, never as the server being down.
  try { S = state; hideWaiting(); render(); applyPrefs(S.prefs); checkWelcome(); renderWelcome(); if ($('settings-scrim').classList.contains('open')) { renderAccount(); renderMsStatus(); if (SET) { renderGmail(); renderDev(); renderVoice(); } } }
  catch (e) { oops(e, 'drawing the board'); }
  finally { loading = false; if (again) { again = false; load(); } }
}

// ---------- install as its own app (own icon in the Dock / taskbar)
let installPrompt = null;
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
// Offer it only in a plain browser window on macOS or Windows. Inside the installed
// app (standalone) there is nothing to install, and on Linux the launcher already
// gives Switchboard its own icon.
const inInstalledApp = () => matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  $('install-btn').hidden = inInstalledApp() || /Linux/.test(navigator.platform) || store.get('installed', false);
});
window.addEventListener('appinstalled', () => { installPrompt = null; store.set('installed', true); $('install-btn').hidden = true; toast('Installed. Open Switchboard from your apps from now on.'); });
$('install-btn').addEventListener('click', async () => { if (!installPrompt) return; installPrompt.prompt(); await installPrompt.userChoice.catch(() => {}); installPrompt = null; $('install-btn').hidden = true; });

const es = new EventSource('/api/events');
es.addEventListener('changed', load);
es.addEventListener('open', load);
if (!location.hash) { const sp = store.get('prefs', {})?.startPage; if (sp && sp !== 'now') history.replaceState(null, '', '#' + sp); }
pageFromHash();
load();
