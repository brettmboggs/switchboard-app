// Only here so browsers offer "Install Switchboard" (its own app, with its own
// icon in the Dock and taskbar). It does no caching: Switchboard is always live.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.mode === 'navigate') e.respondWith(fetch(e.request));
});
