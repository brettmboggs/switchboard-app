// The HUD strip across the top of every page: the time, and the board in a
// few lit readouts (what needs you, sessions working, builds running, the
// weather). Each readout is a link to where that lives. Redrawn every second
// from the board state already on the page; nothing is fetched for it.
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
function hudBar() {
  const el = $('hud-bar'); if (!el) return;
  const d = new Date();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const date = d.toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short' }).toUpperCase();
  if (!S) { el.innerHTML = `<span class="hud-time">${time}</span><span class="hud-r">${date}</span><span class="hud-r dim">Connecting…</span>`; return; }
  const needs = needsCount('all');
  const working = allTerms().filter((t) => t.state === 'running').length;
  const builds = ciActiveCount();
  const w = S.weather?.ok && S.weather.now;
  const r = (href, n, word, cls = '') => `<a class="hud-r ${cls}" href="${href}"><b>${n}</b> ${word}</a>`;
  el.innerHTML = `<span class="hud-time" aria-label="Time">${time}</span><span class="hud-r dim">${date}</span>
    ${r('#now', needs, needs === 1 ? 'needs you' : 'need you', needs ? 'hot' : 'ok')}
    ${r('#sessions', working, working === 1 ? 'session working' : 'sessions working', working ? 'live' : '')}
    ${r('#builds', builds, builds === 1 ? 'build running' : 'builds running', builds ? 'live' : '')}
    ${w ? `<span class="hud-r">${Math.round(w.temp)}°${esc(w.unit || '')} ${esc(String(w.text || '').toLowerCase())}</span>` : ''}
    <span class="grow"></span><span class="hud-r dim hud-sys"><i></i>Systems online</span>`;
}
setInterval(hudBar, 1000);
hudBar();
