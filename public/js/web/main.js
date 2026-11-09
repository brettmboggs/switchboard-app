// The web board starts here (a module, after the page's own scripts): the web
// client for this sync service, the page's api() pointed at the adapter, the
// session from before resumed, and the page told when anything changes (the
// relay says when someone saved). Does nothing in the app on your computer.
import { makeClient } from './client.js';
import { makeAdapter } from './adapter.js';

if (window.WEB) {
  const client = makeClient({ base: location.origin });
  const api = makeAdapter(client);
  window.WEB.api = api;
  window.WEB.onChange = (fn) => client.onChange(fn);
  window.WEB.client = client;
  // Back from connecting Microsoft 365 or GitHub: finish it once this account is open again.
  const connected = () => client.connect.finish().then((r) => { if (r?.connected || r?.error) window.WEB.connected = r; return client.connect.refresh(); }).catch((e) => { window.WEB.connected = { error: e.message }; });
  client.resume().catch(() => {}).finally(() => { window.WEB._ready(); if (client.session) connected().finally(() => client.sync()); });
  setInterval(() => { if (client.session) client.connect.refresh().then(() => client.sync()).catch(() => {}); }, 120e3);
  // A fallback for when the live link is down: look every minute.
  setInterval(() => { if (client.session) client.sync(); }, 60e3);
}
