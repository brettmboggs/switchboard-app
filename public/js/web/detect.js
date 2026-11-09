// Is this page the web board? The sync service marks the page it serves
// (sync-worker/src/board.js adds <meta name="switchboard-board">); on your own
// computer there is no mark, and nothing here changes anything.
// On the web board: window.WEB is the adapter-to-be (public/js/web/main.js
// fills it in), core.js's api() waits for it, and only the pages that exist on
// the web show. Loaded before every other page script.
(function () {
  const board = !!document.querySelector('meta[name="switchboard-board"]');
  if (!board) { window.WEB = null; return; }
  let ready;
  window.WEB = { ready: new Promise((ok) => { ready = ok; }), api: null, onChange: () => {}, _ready: () => ready() };
  document.documentElement.classList.add('web');
})();
