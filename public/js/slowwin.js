// Inside the Switchboard app only (IN_APP, keys.js): when its window draws slowly
// while you type or scroll, offer to open Switchboard in your browser instead
// (Nov 5 2026). Some graphics drivers make the app's built-in window lag
// (WebKitGTK with NVIDIA on Linux: typing a letter behind, scrolling that
// stutters); the same page in Chrome, Edge or Brave is smooth. The app opens it
// when the page goes to /app/browser (desktop/src-tauri/src/main.rs). Settings,
// General has the same button any time (renderAbout, settings.js).
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
const openInBrowser = () => { try { saveDrafts(); } catch {} location.href = '/app/browser'; };
(() => {
  if (!IN_APP) return;
  let busyUntil = 0, frames = 0, slow = 0, last = 0, strikes = 0;
  const busy = () => { busyUntil = performance.now() + 800; };
  for (const ev of ['keydown', 'wheel', 'touchmove']) window.addEventListener(ev, busy, { passive: true, capture: true });
  const tick = (now) => {
    // Only frames while you are typing or scrolling count: an idle page is allowed to rest.
    if (last && now < busyUntil && document.visibilityState === 'visible') { frames++; if (now - last > 50) slow++; }
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  setInterval(() => {
    // Over ten seconds of use, a third of the frames slower than 20 a second is a window that lags.
    if (frames >= 40 && slow / frames > 0.33) strikes++; else if (frames >= 40) strikes = Math.max(0, strikes - 1);
    frames = 0; slow = 0;
    const asked = Number(store.get('slowWinAsked', 0));
    if (strikes < 2 || Date.now() - asked < 7 * 86400e3) return;
    store.set('slowWinAsked', Date.now()); strikes = 0;
    toast('This window is running slowly on this computer. Switchboard runs smoothly in your browser, with the same sessions and settings.', { action: { label: 'Open in browser', run: openInBrowser }, ms: 30000 });
  }, 10000);
})();
