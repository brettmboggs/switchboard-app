// Loading the board state, installing as an app, and starting up. Loaded last.
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
// ---------- data
let loading = false, again = false;
async function load() {
  if (loading) { again = true; return; }
  loading = true;
  try { S = await api('/api/state'); render(); applyPrefs(S.prefs); checkWelcome(); renderWelcome(); if ($('settings-scrim').classList.contains('open')) { renderAccount(); renderMsStatus(); if (SET) { renderGmail(); renderDev(); renderVoice(); } } }
  catch { const el = $('status'); el.hidden = false; el.textContent = 'Switchboard server is not running'; el.title = ''; }
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
page = (PAGES.find(([id]) => id === location.hash.replace('#', '')) || ['now'])[0];
load();
