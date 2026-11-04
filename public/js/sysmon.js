// System monitor: what this computer is doing, live (Settings, System, Open monitor).
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
//
// The page asks /api/system every second while the monitor is open and
// stops the moment it closes or the tab is hidden; the server keeps no timer
// and no history (lib/sysmon.js). The two minutes of history in the charts live
// here, in a few small arrays. The skeleton is built once and updated in place,
// so hovering a chart, typing in the search box and scrolling are never
// interrupted by a refresh.
const MON = { token: 0, paused: false, snap: null, built: false, gpuN: -1, sort: 'cpu', filter: '', more: false, hist: { t: [], cpu: [], mem: [], down: [], up: [], gpu: [] } };
const HIST = 120, EVERY = 1000;   // two minutes at one reading a second

const fmtB = (b, d = 1) => { if (b == null) return '–'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0, n = b; while (n >= 1024 && i < 4) { n /= 1024; i++; } return (i >= 3 ? n.toFixed(d) : n >= 100 || i === 0 ? Math.round(n) : n.toFixed(d)) + ' ' + u[i]; };
const fmtRate = (b) => (b == null ? '–' : fmtB(b) + '/s');
const bigRate = (b) => { const t = fmtB(b).split(' '); return `${t[0]}<small>${t[1]}/s</small>`; };
const fmtUp = (s) => { const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : `${m} min`; };
const pctFmt = (n) => (n == null ? '–' : Math.round(n) + '%');
const heat = (pct) => (pct >= 85 ? 'hi' : pct >= 60 ? 'mid' : 'lo');
const niceMax = (v, floor) => { const m = Math.max(v, floor); const p = 10 ** Math.floor(Math.log10(m)); for (const k of [1, 2, 5, 10]) if (k * p >= m) return k * p; return m; };
const PLATFORM = { linux: 'Linux', darwin: 'macOS', win32: 'Windows' };

// ---------- charts: an SVG that stretches, a hover line, a read-out
function chartHtml(id, cls, aria) {
  return `<div class="chart ${cls || ''}" id="${id}" role="img" aria-label="${esc(aria)}"><svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="${id}-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-opacity=".30"/><stop offset="1" stop-opacity="0"/></linearGradient></defs>
    <g class="grid"><line x1="0" y1="10" x2="100" y2="10"/><line x1="0" y1="20" x2="100" y2="20"/><line x1="0" y1="30" x2="100" y2="30"/></g>
    <path class="area" fill="url(#${id}-g)" d=""/><path class="line" d=""/><path class="line line--b" d="" hidden/></svg>
    <span class="scale scale--top"></span><span class="scale scale--bottom">0</span><i class="cursor"></i><i class="dot"></i><span class="tip"></span></div>`;
}
// The chart is as wide as the history so far (at least half a minute), so it fills in from the first seconds and holds still once two minutes are in.
const span = (n) => Math.min(HIST, Math.max(30, n));
const xOf = (i, n) => ((span(n) - n + i) / (span(n) - 1)) * 100;
function curve(data, max) {
  const n = data.length; if (!n) return '';
  const pts = data.map((v, i) => [xOf(i, n), 38 - Math.min(1, Math.max(0, v / max)) * 36]);
  let d = `M${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 1; i < n; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], mx = (x0 + x1) / 2; d += ` C${mx.toFixed(2)} ${y0.toFixed(2)} ${mx.toFixed(2)} ${y1.toFixed(2)} ${x1.toFixed(2)} ${y1.toFixed(2)}`; }
  return d;
}
// series: [main, optional second]; fmt formats a value for the scale and the read-out.
function drawChart(id, series, max, fmt, label) {
  const el = $(id); if (!el) return;
  const [a, b] = series, line = el.querySelectorAll('.line'), area = el.querySelector('.area');
  const d = curve(a, max);
  line[0].setAttribute('d', d);
  area.setAttribute('d', a.length ? `${d} L100 40 L${xOf(0, a.length).toFixed(2)} 40 Z` : '');
  line[1].hidden = !b; if (b) line[1].setAttribute('d', curve(b, max));
  el.querySelector('.scale--top').textContent = fmt(max);
  el._d = { series, max, fmt, label };
  const now = a.length ? a[a.length - 1] : null;
  el.setAttribute('aria-label', `${label}: ${now == null ? 'no reading' : fmt(now)} now`);
}
document.addEventListener('pointermove', (e) => {
  const el = e.target.closest?.('.chart'); document.querySelectorAll('.chart.hover').forEach((c) => { if (c !== el) c.classList.remove('hover'); });
  if (!el || !el._d) return;
  const { series, max, fmt } = el._d, n = series[0].length; if (!n) return;
  const r = el.getBoundingClientRect(), frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  const i = Math.round(frac * (span(n) - 1)) - (span(n) - n); if (i < 0 || i >= n) { el.classList.remove('hover'); return; }
  const x = xOf(i, n), ago = Math.round((n - 1 - i) * EVERY / 1000);
  const tip = el.querySelector('.tip'), dot = el.querySelector('.dot');
  el.querySelector('.cursor').style.left = x + '%'; dot.style.left = x + '%'; dot.style.top = (38 - Math.min(1, series[0][i] / max) * 36) / 40 * 100 + '%';
  tip.style.left = Math.min(88, Math.max(12, x)) + '%';
  tip.textContent = series.map((s, k) => (s ? (k ? '↑ ' : series[1] ? '↓ ' : '') + fmt(s[i]) : '')).filter(Boolean).join('  ') + ' · ' + (ago ? ago + ' s ago' : 'now');
  el.classList.add('hover');
});
document.addEventListener('pointerleave', () => document.querySelectorAll('.chart.hover').forEach((c) => c.classList.remove('hover')), true);

// ---------- the skeleton, built once
function buildMonitor() {
  $('sys-body').innerHTML = `
    <div class="verdict" id="mon-verdict" aria-live="polite"><p id="mon-say">Reading this computer…</p><small id="mon-say2"></small></div>
    <div class="mon-grid">
      <section class="card res" aria-label="Processor">
        <div class="res-head"><h3>Processor</h3><span class="aside" id="cpu-model"></span></div>
        <div class="res-nums"><div><span class="big" id="cpu-big">–</span></div><div class="facts" id="cpu-facts"></div></div>
        ${chartHtml('cpu-chart', '', 'Processor use')}
        <div class="cores" id="cpu-cores" aria-label="Each processor thread" role="img"></div>
      </section>
      <section class="card res" aria-label="Memory">
        <div class="res-head"><h3>Memory</h3><span class="aside" id="mem-aside"></span></div>
        <div class="res-nums"><div><span class="big" id="mem-big">–</span></div><div class="facts" id="mem-facts"></div></div>
        ${chartHtml('mem-chart', '', 'Memory use')}
        <div><div class="segbar" id="mem-seg"></div><div class="seglegend" id="mem-legend"></div></div>
      </section>
      <div id="mon-gpus"></div>
      <section class="card res" aria-label="Network">
        <div class="res-head"><h3>Network</h3><span class="aside">all connections together</span></div>
        <div class="res-nums"><div><span class="k">Down</span><span class="big" id="net-down">–</span></div><div><span class="k">Up</span><span class="big" id="net-up">–</span></div></div>
        ${chartHtml('net-chart', '', 'Network speed')}
      </section>
      <div class="stack">
        <section class="card res" aria-label="Disks"><div class="res-head"><h3>Storage</h3><span class="aside">space left</span></div><div class="rows" id="mon-disks"></div></section>
        <section class="card res" aria-label="Fans"><div class="res-head"><h3>Fans</h3><span class="aside" id="fan-aside"></span></div><div class="fans" id="mon-fans"></div><div class="mon-notes" id="mon-notes"></div></section>
      </div>
      <section class="card res" aria-label="Temperatures"><div class="res-head"><h3>Temperatures</h3><span class="aside" id="temp-aside"></span></div><div class="rows" id="mon-temps"></div></section>
      <section class="card res wide" aria-label="Apps">
        <div class="res-head"><h3>Apps</h3><span class="aside" id="apps-aside"></span></div>
        <div class="apps-bar">
          <div class="chips" role="group" aria-label="Sort apps by"><button class="chip" type="button" data-mon-sort="cpu" aria-pressed="true">Processor</button><button class="chip" type="button" data-mon-sort="mem" aria-pressed="false">Memory</button></div>
          <input class="field" id="mon-filter" type="search" placeholder="Find an app" aria-label="Find an app" autocomplete="off">
        </div>
        <table class="apps"><thead><tr><th>App</th><th class="n">Processor</th><th class="n">Memory</th></tr></thead><tbody id="mon-apps"></tbody></table>
        <div><button class="btn btn--quiet btn--sm" type="button" id="mon-more">Show more</button></div>
      </section>
    </div>`;
  MON.built = true; MON.gpuN = -1;
}

// ---------- one reading in
function pushHist(s) {
  const h = MON.hist, add = (a, v) => { a.push(v); if (a.length > HIST) a.shift(); };
  add(h.t, s.at); add(h.cpu, s.cpu.pct); add(h.mem, s.mem.pct);
  add(h.down, s.net ? s.net.down : 0); add(h.up, s.net ? s.net.up : 0);
  s.gpus.forEach((g, i) => add((h.gpu[i] = h.gpu[i] || []), g.pct ?? 0));
}
const meterRow = (name, val, pct, cls) => `<div class="mrow"><span class="name" title="${esc(name)}">${esc(name)}</span><span class="val">${esc(val)}</span><div class="meter meter--${cls}"><i style="width:${Math.max(0, Math.min(100, pct)).toFixed(1)}%"></i></div></div>`;

function updateMonitor(s) {
  $('mon-sub').textContent = `${s.host} · ${PLATFORM[s.platform] || s.platform} ${s.release} · up ${fmtUp(s.uptime)}`;
  const v = $('mon-verdict');
  v.classList.toggle('strained', s.say.length > 0);
  $('mon-say').textContent = s.say.length ? s.say[0].text : 'Everything is calm.';
  $('mon-say2').textContent = s.say.length > 1 ? s.say.slice(1).map((x) => x.text).join(' ') : s.say.length ? '' : 'Nothing is straining this computer.';

  // processor
  $('cpu-big').innerHTML = `${Math.round(s.cpu.pct)}<small>%</small>`;
  $('cpu-model').textContent = s.cpu.model;
  $('cpu-facts').innerHTML = `<span><b>${s.cpu.count}</b> threads</span>${s.cpu.mhz ? `<span><b>${(s.cpu.mhz / 1000).toFixed(1)}</b> GHz</span>` : ''}${s.cpu.load != null ? `<span>load <b>${s.cpu.load.toFixed(2)}</b></span>` : ''}`;
  drawChart('cpu-chart', [MON.hist.cpu], 100, pctFmt, 'Processor');
  const cores = $('cpu-cores');
  if (cores.children.length !== s.cpu.cores.length) cores.innerHTML = s.cpu.cores.map(() => '<i></i>').join('');
  s.cpu.cores.forEach((p, i) => { const b = cores.children[i]; b.style.height = Math.max(4, p) + '%'; b.className = heat(p); b.title = `Thread ${i + 1}: ${Math.round(p)}%`; });

  // memory
  $('mem-big').innerHTML = `${Math.round(s.mem.pct)}<small>%</small>`;
  $('mem-aside').textContent = `${fmtB(s.mem.used)} of ${fmtB(s.mem.total)}`;
  $('mem-facts').innerHTML = `<span><b>${fmtB(s.mem.avail)}</b> available</span>${s.mem.swapUsed > 1048576 ? `<span><b>${fmtB(s.mem.swapUsed)}</b> on disk</span>` : ''}`;
  drawChart('mem-chart', [MON.hist.mem], 100, pctFmt, 'Memory');
  const m = s.mem, T = m.total || 1, cached = m.cached != null ? Math.min(m.cached, m.avail) : 0, free = Math.max(0, m.avail - cached);
  $('mem-seg').innerHTML = `<i style="width:${m.used / T * 100}%" title="In use"></i>${cached ? `<i class="seg-2" style="width:${cached / T * 100}%" title="Cached"></i>` : ''}<i class="seg-3" style="width:${free / T * 100}%" title="Free"></i>`;
  $('mem-legend').innerHTML = `<span>In use ${fmtB(m.used)}</span>${cached ? `<span class="seg-2">Cached ${fmtB(cached)}</span>` : ''}<span class="seg-3">${cached ? 'Free' : 'Available'} ${fmtB(free)}</span>`;

  updateGpus(s);

  // network
  $('net-down').innerHTML = s.net ? bigRate(s.net.down) : 'measuring…'; $('net-up').innerHTML = s.net ? bigRate(s.net.up) : 'measuring…';
  const top = niceMax(Math.max(...MON.hist.down, ...MON.hist.up, 0), 128 * 1024);
  drawChart('net-chart', [MON.hist.down, MON.hist.up], top, fmtRate, 'Network');

  // storage
  $('mon-disks').innerHTML = s.disks.map((d) => { const used = (1 - d.free / d.total) * 100, left = d.free / d.total * 100; return meterRow(d.mount, `${fmtB(d.free, 0)} free of ${fmtB(d.total, 0)}`, used, left < 8 ? 'hi' : left < 15 ? 'mid' : 'lo'); }).join('') || '<p class="mon-note">No disks could be read.</p>';

  // temperatures and fans
  const temps = [...s.temps].sort((a, b) => b.c - a.c).slice(0, 8);
  $('temp-aside').textContent = temps.length ? `hottest ${Math.round(temps[0].c)}°C` : '';
  $('mon-temps').innerHTML = temps.map((t) => meterRow(t.label, Math.round(t.c) + '°C', (t.c - 20) / 80 * 100, t.c >= 85 ? 'hi' : t.c >= 70 ? 'mid' : 'lo')).join('') || '<p class="mon-note">No temperature readings on this computer.</p>';
  const fans = s.fans.slice(0, 8), fmax = Math.max(3000, ...fans.map((f) => f.rpm * 1.15));
  $('fan-aside').textContent = fans.length ? `${fans.length} spinning` : '';
  $('mon-fans').innerHTML = fans.map((f) => `<div class="fanrow"><div class="dial" style="--pct:${Math.min(100, f.rpm / fmax * 100)}"><b>${Math.round(f.rpm)}</b></div><span class="mon-note">${esc(f.label)}<br>rpm</span></div>`).join('') || '<p class="mon-note">No fan readings.</p>';
  $('mon-notes').innerHTML = s.notes.map((n) => `<p class="mon-note">${esc(n)}</p>`).join('');

  renderApps(s);
}

function updateGpus(s) {
  const box = $('mon-gpus');
  if (MON.gpuN !== s.gpus.length) {
    MON.gpuN = s.gpus.length;
    box.innerHTML = s.gpus.length ? s.gpus.map((g, i) => `<section class="card res" aria-label="Graphics ${i + 1}">
      <div class="res-head"><h3>Graphics</h3><span class="aside" id="gpu-name-${i}"></span></div>
      <div class="res-nums"><div><span class="big" id="gpu-big-${i}">–</span></div><div class="facts" id="gpu-facts-${i}"></div></div>
      ${chartHtml('gpu-chart-' + i, 's-ok', 'Graphics use')}<div id="gpu-mem-${i}"></div></section>`).join('')
      : `<section class="card res" aria-label="Graphics"><div class="res-head"><h3>Graphics</h3></div><p class="mon-note">No graphics readings on this computer. NVIDIA cards report through the driver; on Windows other cards report their activity; on a Mac, Apple graphics do.</p></section>`;
  }
  s.gpus.forEach((g, i) => {
    $('gpu-name-' + i).textContent = g.name;
    $('gpu-big-' + i).innerHTML = g.pct == null ? '–' : `${Math.round(g.pct)}<small>%</small>`;
    $('gpu-facts-' + i).innerHTML = [g.temp != null ? `<span><b>${Math.round(g.temp)}</b>°C</span>` : '', g.fanPct ? `<span>fan <b>${Math.round(g.fanPct)}</b>%</span>` : '', g.watts != null ? `<span><b>${g.watts.toFixed(0)}</b> W</span>` : ''].join('');
    drawChart('gpu-chart-' + i, [MON.hist.gpu[i] || []], 100, pctFmt, 'Graphics');
    $('gpu-mem-' + i).innerHTML = g.memUsed != null ? (g.memTotal ? meterRow('Video memory', `${fmtB(g.memUsed)} of ${fmtB(g.memTotal)}`, g.memUsed / g.memTotal * 100, heat(g.memUsed / g.memTotal * 100)) : `<p class="mon-note">Video memory in use: ${fmtB(g.memUsed)}</p>`) : '';
  });
}

function renderApps(s) {
  const q = MON.filter.trim().toLowerCase(), by = MON.sort;
  let list = s.apps.filter((a) => !q || a.name.toLowerCase().includes(q)).sort((a, b) => b[by] - a[by] || b.mem - a.mem);
  const total = list.length; list = list.slice(0, MON.more ? 40 : 12);
  const maxCpu = Math.max(1, ...list.map((a) => a.cpu)), maxMem = Math.max(1, ...list.map((a) => a.mem));
  $('apps-aside').textContent = `${s.apps.length ? 'top ' + list.length + (total > list.length ? ' of ' + total : '') : ''}`;
  $('mon-apps').innerHTML = list.map((a) => `<tr><td><div class="nm"><b title="${esc(a.name)}">${esc(a.name)}${a.count > 1 ? `<span class="x">×${a.count}</span>` : ''}</b><div class="meter meter--${by === 'cpu' ? heat(a.cpu * 2) : 'lo'}"><i style="width:${(by === 'cpu' ? a.cpu / maxCpu : a.mem / maxMem) * 100}%"></i></div></div></td><td class="n">${a.cpu.toFixed(1)}%</td><td class="n">${fmtB(a.mem)}</td></tr>`).join('') || '<tr><td colspan="3"><span class="mon-note">No app matches.</span></td></tr>';
  $('mon-more').hidden = total <= 12; $('mon-more').textContent = MON.more ? 'Show fewer' : 'Show more';
  document.querySelectorAll('[data-mon-sort]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.monSort === by)));
}

// ---------- the loop: runs only while the monitor is open and visible
async function monTick(token) {
  if (token !== MON.token) return;
  const open = $('sys-scrim').classList.contains('open');
  if (!open) { MON.token++; return; }
  if (!MON.paused && !document.hidden) {
    try { const s = await api('/api/system'); if (token !== MON.token) return; MON.snap = s; pushHist(s); updateMonitor(s); $('mon-live').textContent = 'live'; }
    catch (e) { $('mon-live').textContent = 'no answer'; }
  }
  setTimeout(() => monTick(token), EVERY);
}
function openMonitor() {
  if (!MON.built) buildMonitor();
  MON.paused = false; $('mon-pause').textContent = 'Pause'; $('mon-live').removeAttribute('data-paused');
  MON.hist = { t: [], cpu: [], mem: [], down: [], up: [], gpu: [] };
  openDialog('sys-scrim');
  monTick(++MON.token);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && $('sys-scrim').classList.contains('open')) { const t = ++MON.token; monTick(t); } });
document.addEventListener('click', (e) => {
  if (e.target.closest('#sys-open')) { closeDialog('settings-scrim'); openMonitor(); return; }
  if (e.target.closest('#mon-pause')) { MON.paused = !MON.paused; $('mon-pause').textContent = MON.paused ? 'Resume' : 'Pause'; $('mon-live').toggleAttribute('data-paused', MON.paused); $('mon-live').textContent = MON.paused ? 'paused' : 'live'; return; }
  const sort = e.target.closest('[data-mon-sort]'); if (sort) { MON.sort = sort.dataset.monSort; if (MON.snap) renderApps(MON.snap); return; }
  if (e.target.closest('#mon-more')) { MON.more = !MON.more; if (MON.snap) renderApps(MON.snap); }
});
document.addEventListener('input', (e) => { if (e.target.id === 'mon-filter') { MON.filter = e.target.value; if (MON.snap) renderApps(MON.snap); } });
