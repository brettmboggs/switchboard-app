// The live favicon: the Switchboard mark with the board's state in the lamp.
// Orange when something needs you, green when nothing does, cobalt before the
// board has loaded. The count is read off document.title, which core.js sets to
// "(n) Switchboard" on every render, so this file needs nothing from the rest of
// the page. The drawing is the small cut of scripts/icons.mjs (heavier lines, no
// input dots), which holds up at 16 px.
(() => {
  const NEEDS = '#FF4F00', CLEAR = '#1F7A4D', COBALT = '#4967E8', SOFT = '#8EA0FF', INK = '#15171C', PAPER = '#FCFCFA';
  const dark = matchMedia('(prefers-color-scheme: dark)');
  let link = document.querySelector('link[rel="icon"]');
  if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.append(link); }
  let count = null; // null until the board has rendered once

  function svg(lamp, ink) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">`
      + `<g fill="none" stroke="${ink}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">`
      + `<path d="M5.5 10H11C15.5 10 15.5 24 20 24"/><path d="M5.5 38H11C15.5 38 15.5 24 20 24"/><path d="M5.5 24H20"/><path d="M36 24H43.5"/></g>`
      + `<circle cx="28" cy="24" r="8" fill="none" stroke="${ink}" stroke-width="4"/><circle cx="28" cy="24" r="3.9" fill="${lamp}"/></svg>`;
  }

  function draw() {
    // The tab strip follows the browser's own theme, not the page's, so the
    // lines take their colour from prefers-color-scheme.
    const ink = dark.matches ? PAPER : INK;
    const lamp = count === null ? (dark.matches ? SOFT : COBALT) : count > 0 ? NEEDS : CLEAR;
    link.type = 'image/svg+xml';
    link.href = 'data:image/svg+xml,' + encodeURIComponent(svg(lamp, ink));
  }

  function fromTitle() {
    const m = /^\((\d+)\)/.exec(document.title);
    count = m ? +m[1] : 0;
    draw();
  }

  const title = document.querySelector('title');
  if (title) new MutationObserver(fromTitle).observe(title, { childList: true, characterData: true, subtree: true });
  dark.addEventListener('change', draw);
  draw();
})();
