// Network test: how fast the internet is here, measured by lib/speedtest.js
// (Settings, System, Test the network; Test speed on the monitor's Network card).
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so every name here starts with st or ST.
//
// The server runs the test. This window starts it, asks for progress five
// times a second while it is open, and draws: the gauge (live speed, on a scale
// that spreads out the low end), the four numbers, the speed through each ten
// seconds, every ping as a dot (quiet, downloading, uploading: how far the dots
// rise is bufferbloat), what the result is good for, and past tests. Closing
// the window lets a running test finish; opening it again picks it up.
'use strict';

const ST = { tok: 0, test: null, hist: [], pick: null, shown: 0, want: 0, raf: 0, top: 1000, built: false, announce: false };
const ST_LOW = [0, 5, 10, 25, 50, 100, 250, 500];
const ST_DONE = ['done', 'error', 'stopped'];
const stTicks = () => [...ST_LOW, ...[1000, 2500, 5000, 10000].filter((t) => t <= ST.top)];
const stRunning = (t) => !!t?.phase && !ST_DONE.includes(t.phase);   // a saved test has no phase: it is done
const stMbps = (v) => (v == null ? '–' : v >= 100 ? String(Math.round(v)) : v.toFixed(1));
const stMs = (v) => (v == null ? '–' : v < 10 ? v.toFixed(1) : String(Math.round(v)));
const stBytes = (b) => (b >= 1e9 ? (b / 1e9).toFixed(2) + ' GB' : Math.round(b / 1e6) + ' MB');
const stNice = (v, floor) => { const m = Math.max(v, floor); const p = 10 ** Math.floor(Math.log10(m)); for (const k of [1, 2, 2.5, 5, 10]) if (k * p >= m) return k * p; return m; };
const stReduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const ST_PHASE = { starting: 'Finding the nearest server', latency: 'Latency', download: 'Download', upload: 'Upload', done: 'Done', stopped: 'Stopped', error: 'Could not finish' };

// ---------- the gauge: 270°, from bottom left round to bottom right
const ST_A0 = 135, ST_SWEEP = 270, ST_R = 84;
const stPt = (deg, r) => { const a = deg * Math.PI / 180; return [100 + r * Math.cos(a), 100 + r * Math.sin(a)]; };
const stArc = (r) => { const [x0, y0] = stPt(ST_A0, r), [x1, y1] = stPt(ST_A0 + ST_SWEEP, r); return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 1 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`; };
function stFrac(v) {
  const t = stTicks(); if (!(v > 0)) return 0;
  for (let i = 1; i < t.length; i++) if (v <= t[i]) return (i - 1 + (v - t[i - 1]) / (t[i] - t[i - 1])) / (t.length - 1);
  return 1;
}
function stGaugeSvg() {
  const t = stTicks(), n = t.length - 1;
  const marks = t.map((v, i) => {
    const deg = ST_A0 + ST_SWEEP * i / n, [x0, y0] = stPt(deg, 93), [x1, y1] = stPt(deg, 97), [lx, ly] = stPt(deg, 70);
    return `<line class="st-tick" x1="${x0.toFixed(2)}" y1="${y0.toFixed(2)}" x2="${x1.toFixed(2)}" y2="${y1.toFixed(2)}"/><text class="st-tlabel" font-size="7.5" x="${lx.toFixed(2)}" y="${ly.toFixed(2)}">${v >= 1000 ? v / 1000 + 'G' : v}</text>`;
  }).join('');
  return `<svg viewBox="0 0 200 200" aria-hidden="true">
    <defs><linearGradient id="st-grad-down" x1="0" y1="1" x2="1" y2="0"><stop offset="0" class="st-g0"/><stop offset="1" class="st-g1"/></linearGradient>
    <linearGradient id="st-grad-up" x1="0" y1="1" x2="1" y2="0"><stop offset="0" class="st-g2"/><stop offset="1" class="st-g3"/></linearGradient></defs>
    <circle class="st-spin" cx="100" cy="100" r="99"/>
    <path class="st-track" d="${stArc(ST_R)}"/>
    <path class="st-fill" id="st-fill" d="${stArc(ST_R)}" pathLength="1000" stroke-dasharray="0 2000" style="display:none"/>
    ${marks}
    <line class="st-mark st-mark--down" id="st-mark-down" x1="0" y1="0" x2="0" y2="0" style="display:none"/>
    <line class="st-mark st-mark--up" id="st-mark-up" x1="0" y1="0" x2="0" y2="0" style="display:none"/>
    <circle class="st-tip" id="st-tip" r="4.5" cx="0" cy="0" style="display:none"/>
  </svg>`;
}
function stMarkAt(id, v) {
  const el = $(id); if (!el) return;
  if (!(v > 0)) { el.style.display = 'none'; return; }
  const deg = ST_A0 + ST_SWEEP * stFrac(v), [x0, y0] = stPt(deg, ST_R - 9), [x1, y1] = stPt(deg, ST_R + 9);
  el.setAttribute('x1', x0.toFixed(2)); el.setAttribute('y1', y0.toFixed(2)); el.setAttribute('x2', x1.toFixed(2)); el.setAttribute('y2', y1.toFixed(2)); el.style.display = '';
}
// The needle eases toward the newest reading, so five readings a second look like one smooth sweep.
function stAnimate() {
  ST.raf = 0;
  const d = ST.want - ST.shown;
  ST.shown = stReduced() || Math.abs(d) < 0.05 ? ST.want : ST.shown + d * 0.16;
  const f = stFrac(ST.shown), fill = $('st-fill'), tip = $('st-tip');
  if (!fill) return;
  fill.setAttribute('stroke-dasharray', `${(f * 1000).toFixed(1)} 2000`); fill.style.display = f > 0.002 ? '' : 'none';
  const [x, y] = stPt(ST_A0 + ST_SWEEP * f, ST_R);
  tip.setAttribute('cx', x.toFixed(2)); tip.setAttribute('cy', y.toFixed(2)); tip.style.display = f > 0.002 ? '' : 'none';
  if (stRunning(ST.test) && ['download', 'upload'].includes(ST.test.phase)) $('st-big').textContent = stMbps(ST.shown);
  if (ST.shown !== ST.want) ST.raf = requestAnimationFrame(stAnimate);
}
function stAim(v) { ST.want = Math.max(0, v || 0); if (!ST.raf) ST.raf = requestAnimationFrame(stAnimate); }
function stScaleFor(t) {
  const want = Math.max(t?.link?.linkMbps || 0, t?.down?.live || 0, t?.up?.live || 0, t?.down?.peak || 0, t?.up?.peak || 0, t?.down?.mbps || 0, t?.up?.mbps || 0);
  const top = [1000, 2500, 5000, 10000].find((x) => x >= want * 0.98) || 10000;
  if (top !== ST.top) { ST.top = top; $('st-dial').innerHTML = stGaugeSvg(); ST.shown = 0; }
}

// ---------- the skeleton, built once
function stBuild() {
  // One screen, three columns: the gauge, the numbers and the details; the
  // verdict over the two charts, which take whatever height is left; what it is
  // good for and past tests. Nothing scrolls in a normal window.
  $('st-body').innerHTML = `
    <div class="st-col st-col--gauge">
      <div class="st-gauge" id="st-gauge" data-dir="down">
        <div class="st-dial" id="st-dial">${stGaugeSvg()}</div>
        <div class="st-center"><span class="st-phase" id="st-phase">Ready</span><span class="st-big" id="st-big">–</span><span class="st-unit" id="st-unit">Mbps</span></div>
        <button class="st-go" id="st-go" type="button" aria-label="Start the network test"><span>GO</span></button>
      </div>
      <div class="st-reads">
        <div class="st-read"><span class="k">Ping</span><span class="v"><b id="st-ping">–</b><small>ms</small></span><span class="s" id="st-ping-s">line quiet</span></div>
        <div class="st-read"><span class="k">Jitter</span><span class="v"><b id="st-jit">–</b><small>ms</small></span><span class="s" id="st-jit-s">ping to ping</span></div>
        <div class="st-read st-read--down" id="st-read-down"><span class="k">Download</span><span class="v"><b id="st-down">–</b><small>Mbps</small></span><span class="s" id="st-down-s">&nbsp;</span></div>
        <div class="st-read st-read--up" id="st-read-up"><span class="k">Upload</span><span class="v"><b id="st-up">–</b><small>Mbps</small></span><span class="s" id="st-up-s">&nbsp;</span></div>
      </div>
      <section class="card st-card st-details" aria-label="Details">
        <div class="st-card-head"><h3>Details</h3><span class="aside" id="st-when"></span></div>
        <dl class="st-facts" id="st-facts"></dl>
      </section>
    </div>
    <div class="st-col st-col--charts">
      <div class="st-say" id="st-say" aria-live="polite"><p id="st-head">Download, upload, latency, jitter, packet loss, and how far latency rises when the line is busy.</p><small id="st-head2">About 25 seconds. At gigabit speeds one test moves about 2 GB.</small></div>
      <section class="card st-card st-fill-card" aria-label="Speed over the test">
        <div class="st-card-head"><h3>Speed</h3><span class="aside">shaded start left out</span></div>
        <div class="st-chart" id="st-speed"><svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true"><rect class="st-warm" x="0" y="0" width="30" height="40"/><g class="st-grid-l"><line x1="0" y1="10" x2="100" y2="10"/><line x1="0" y1="20" x2="100" y2="20"/><line x1="0" y1="30" x2="100" y2="30"/></g><path class="st-line st-line--down" d=""/><path class="st-line st-line--up" d=""/></svg><span class="st-scale" id="st-speed-top"></span><span class="st-scale st-scale--b">0</span></div>
        <div class="st-legend"><span class="st-key st-key--down">Download</span><span class="st-key st-key--up">Upload</span><span class="st-axis">0 s</span><span class="st-axis">10 s</span></div>
      </section>
      <section class="card st-card st-fill-card" aria-label="Every ping">
        <div class="st-card-head"><h3>Latency</h3><span class="aside">the higher the busy dots, the worse calls get</span></div>
        <div class="st-chart" id="st-lat"><svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true"><line class="st-band" x1="33.33" y1="0" x2="33.33" y2="40"/><line class="st-band" x1="66.67" y1="0" x2="66.67" y2="40"/><g id="st-lat-med"></g><g id="st-lat-dots"></g></svg><span class="st-scale" id="st-lat-top"></span><span class="st-scale st-scale--b">0</span></div>
        <div class="st-bands"><span id="st-band-idle">Quiet</span><span id="st-band-down">Downloading</span><span id="st-band-up">Uploading</span></div>
      </section>
    </div>
    <div class="st-col st-col--side">
      <section class="card st-card" id="st-means" aria-label="What this is good for" hidden>
        <div class="st-card-head"><h3>Good for</h3></div>
        <div class="st-uses" id="st-uses"></div>
        <div class="st-notes" id="st-notes"></div>
      </section>
      <section class="card st-card st-fill-card" aria-label="Past tests">
        <div class="st-card-head"><h3>Past tests</h3><span class="aside" id="st-hist-aside"></span></div>
        <div class="st-spark" id="st-spark"></div>
        <div class="st-hist" id="st-hist"></div>
      </section>
    </div>`;
  ST.built = true;
}

// ---------- drawing a test (running, finished, or one from the history)
function stRender() {
  const t = ST.pick || ST.test, run = stRunning(t), phase = t ? (t.phase || 'done') : 'idle';
  stScaleFor(t);
  const g = $('st-gauge');
  g.dataset.dir = phase === 'upload' ? 'up' : 'down';
  g.classList.toggle('running', run);
  $('st-go').hidden = run;
  $('st-go').querySelector('span').textContent = t && !run ? 'AGAIN' : 'GO';
  $('st-stop').hidden = !run;
  $('st-copy').hidden = !(t && phase === 'done');
  $('st-phase').textContent = run ? ST_PHASE[phase] || '' : '';
  $('st-unit').textContent = run && phase !== 'starting' ? (phase === 'latency' ? 'ms' : 'Mbps') : '';
  if (run) {
    if (phase === 'latency') { stAim(0); $('st-big').textContent = stMs(t.ping?.idle?.median); }
    else if (phase === 'starting') { stAim(0); $('st-big').textContent = '…'; }
    else stAim(t[phase === 'upload' ? 'up' : 'down'].live);
  } else { stAim(0); $('st-big').textContent = ''; }
  stMarkAt('st-mark-down', !run || phase === 'upload' ? t?.down?.mbps : null);
  stMarkAt('st-mark-up', !run ? t?.up?.mbps : null);

  // the head line: the server, the connection
  const s = t?.server, l = t?.link;
  const link = l ? (l.kind === 'wifi' ? `Wi-Fi${l.name ? ' ' + l.name : ''}${l.signal != null ? ` · signal ${l.signal}%` : ''}${l.linkMbps ? ` · ${l.linkMbps} Mb/s link` : ''}` : l.kind === 'wired' ? `Cable${l.linkMbps ? ' · ' + (l.linkMbps >= 1000 ? l.linkMbps / 1000 + ' Gb/s' : l.linkMbps + ' Mb/s') + ' link' : ''}` : 'Connected') : '';
  $('st-sub').textContent = s ? [`Cloudflare ${s.city ? s.city + ' ' : ''}(${s.colo || '?'})`, link, s.asn ? `network AS${s.asn}` : '', t.server.ip ? `your address ${t.server.ip}` : ''].filter(Boolean).join(' · ') : 'Cloudflare\'s nearest server · runs on this computer, not in the browser';

  // the four numbers
  const live = (d) => (run && phase === (d === 'down' ? 'download' : 'upload'));
  $('st-ping').textContent = stMs(t?.ping?.idle?.median);
  $('st-ping-s').textContent = t?.ping?.idle ? `with the line quiet · lowest ${stMs(t.ping.idle.min)}` : 'with the line quiet';
  $('st-jit').textContent = stMs(t?.ping?.idle?.jitter);
  for (const d of ['down', 'up']) {
    const p = t?.[d];
    $('st-' + d).textContent = live(d) ? stMbps(p.live) : stMbps(p?.mbps);
    const lp = t?.ping?.[d];
    $('st-' + d + '-s').textContent = lp ? `${stMs(lp.median)} ms ping while ${d === 'down' ? 'downloading' : 'uploading'}` : live(d) ? 'measuring…' : ' ';
    $('st-read-' + d).classList.toggle('st-on', live(d));
  }

  // the line in words
  if (t) {
    $('st-head').textContent = phase === 'error' ? t.error : phase === 'stopped' ? 'Stopped before the end, so nothing was kept.' : run ? stRunWords(t) : t.summary?.headline || 'Done.';
    $('st-head2').textContent = run ? 'Keep this window open or close it: the test finishes either way.' : ST.pick ? `A past test, from ${when(t.at)}. GO runs a new one.` : phase === 'done' ? `Measured against Cloudflare ${t.server?.city || ''} (${t.server?.colo || ''}), ${t.down?.bytes ? stBytes((t.down.bytes || 0) + (t.up.bytes || 0)) + ' moved' : ''}.` : '';
    $('st-say').classList.toggle('bad', phase === 'error');
  }

  stSpeedChart(t);
  stLatChart(t);
  stMeans(t, run);
  stFacts(t, run);
  stFitHist();
}
function stRunWords(t) {
  if (t.phase === 'starting') return 'Finding the nearest Cloudflare server…';
  if (t.phase === 'latency') return 'Measuring latency with the line quiet…';
  if (t.phase === 'download') return 'Downloading on 8 connections at once…';
  return 'Uploading on 8 connections at once…';
}

// The chart spans the longer direction (10 s, more when data started late);
// the shaded part is what the result leaves out, until the download's warm-up ended.
function stPath(trace, max, span) {
  if (!trace?.length) return '';
  return trace.map(([s, v], i) => `${i ? 'L' : 'M'}${Math.min(100, s / span * 100).toFixed(2)} ${(38 - Math.min(1, v / max) * 36).toFixed(2)}`).join(' ');
}
function stSpeedChart(t) {
  const dn = t?.down?.trace || [], up = t?.up?.trace || [];
  const max = stNice(Math.max(1, ...dn.map((p) => p[1]), ...up.map((p) => p[1])), 10);
  const span = Math.max(10, ...dn.map((p) => p[0]), ...up.map((p) => p[0]));
  const el = $('st-speed');
  el.querySelector('.st-line--down').setAttribute('d', stPath(dn, max, span));
  el.querySelector('.st-line--up').setAttribute('d', stPath(up, max, span));
  const warm = el.querySelector('.st-warm'), w = t?.down?.warmS ?? 3;
  warm.setAttribute('width', (Math.min(span, w) / span * 100).toFixed(2));
  el.parentElement.querySelectorAll('.st-axis')[1].textContent = `${Math.round(span)} s`;
  $('st-speed-top').textContent = (max >= 1000 ? max / 1000 + ' Gbps' : max + ' Mbps');
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', `Speed through the test: download ${stMbps(t?.down?.mbps ?? t?.down?.live)} Mbps, upload ${stMbps(t?.up?.mbps ?? t?.up?.live)} Mbps`);
}
function stLatChart(t) {
  const lat = t?.lat || { idle: [], down: [], up: [] }, all = [...lat.idle, ...lat.down, ...lat.up].filter((x) => x != null).sort((a, b) => a - b);
  const p95 = all.length ? all[Math.floor(all.length * 0.95)] : 0;
  const max = stNice(Math.max(20, p95 * 1.25, (t?.ping?.idle?.median || 0) * 3), 10);
  const y = (v) => (38 - Math.min(1, v / max) * 36).toFixed(2);
  let dots = '', meds = '';
  ['idle', 'down', 'up'].forEach((k, b) => {
    const list = lat[k] || [], n = Math.max(list.length, k === 'idle' ? 25 : 40);
    list.forEach((v, i) => { const x = (b * 33.33 + 2 + (i + 0.5) / n * 29.33).toFixed(2); dots += v == null ? `<path class="st-dot st-dot--lost st-dot--${k}" d="M${x} 2 l0 0"/>` : `<path class="st-dot st-dot--${k}${v > max ? ' st-dot--over' : ''}" d="M${x} ${y(v)} l0 0"/>`; });
    const m = t?.ping?.[k]?.median;
    if (m != null) meds += `<line class="st-med st-med--${k}" x1="${(b * 33.33 + 1).toFixed(2)}" x2="${(b * 33.33 + 32.33).toFixed(2)}" y1="${y(m)}" y2="${y(m)}"/>`;
  });
  $('st-lat-dots').innerHTML = dots; $('st-lat-med').innerHTML = meds;
  $('st-lat-top').textContent = max + ' ms';
  const lbl = (k, w) => { const m = t?.ping?.[k]?.median; return m != null ? `${w} ${stMs(m)} ms` : w; };
  $('st-band-idle').textContent = lbl('idle', 'Quiet'); $('st-band-down').textContent = lbl('down', 'Downloading'); $('st-band-up').textContent = lbl('up', 'Uploading');
  $('st-lat').setAttribute('role', 'img');
  $('st-lat').setAttribute('aria-label', `Latency: ${lbl('idle', 'quiet')}, ${lbl('down', 'downloading')}, ${lbl('up', 'uploading')}`);
}
function stMeans(t, run) {
  const sum = !run && t?.summary;
  $('st-means').hidden = !sum;
  if (!sum) return;
  const word = { good: 'Good', ok: 'OK', poor: 'Poor' };
  $('st-uses').innerHTML = sum.uses.map((u) => `<div class="st-use st-use--${esc(u.level)}"><span class="n">${esc(u.name)}</span><b>${word[u.level] || ''}</b><small>${esc(u.note)}</small></div>`).join('');
  $('st-notes').innerHTML = sum.notes.map((n) => `<p>${esc(n)}</p>`).join('');
}
const stEven = (x) => (x == null ? '–' : x < 0.15 ? 'even' : x < 0.35 ? 'a bit uneven' : 'uneven');
function stFacts(t, run) {
  $('st-when').textContent = t && !run && t.at ? when(t.at) : '';
  if (!t) { $('st-facts').innerHTML = '<div><dt>Server</dt><dd>Cloudflare, nearest city</dd></div><div><dt>Measures</dt><dd>8 connections, 10 s each way</dd></div>'; return; }
  const loss = (p) => (p ? `${p.pct}%` : '–');
  const gw = t.gateway?.idle, gwBusy = Math.max(t.gateway?.down?.median ?? 0, t.gateway?.up?.median ?? 0);
  const rows = [
    ['Bufferbloat', t.bloat ? `<b class="st-grade st-grade--${esc(t.bloat.grade.replace('+', 'p'))}">${esc(t.bloat.grade)}</b> +${stMs(t.bloat.ms)} ms busy` : '–'],
    ['Packet loss', t.loss ? `${loss(t.loss.idle)} quiet${t.loss.down || t.loss.up ? ` · ${loss(t.loss.down)} / ${loss(t.loss.up)} busy` : ''}` : (run ? 'measuring…' : 'not measured here')],
    ['Your router', gw ? `${stMs(gw.median)} ms${gwBusy ? ` · ${stMs(gwBusy)} busy` : ''}` : (run ? 'measuring…' : 'not measured here')],
    ['Ping to 1.1.1.1', t.icmp?.idle ? `${stMs(t.icmp.idle.median)} ms` : (run ? 'measuring…' : '–')],
    ['Name lookup', t.dnsMs != null ? `${stMs(t.dnsMs)} ms` : '–'],
    ['Best second', t.down?.peak ? `↓ ${stMbps(t.down.peak)} · ↑ ${stMbps(t.up?.peak)}` : '–'],
    ['Steadiness', t.down?.spread != null ? `↓ ${stEven(t.down.spread)} · ↑ ${stEven(t.up?.spread)}` : '–'],
    ['Data used', t.down?.bytes ? stBytes(t.down.bytes + (t.up?.bytes || 0)) : '–']
  ];
  $('st-facts').innerHTML = rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('');
}

// ---------- past tests
function stHistory() {
  const h = ST.hist;
  $('st-hist-aside').textContent = h.length ? `${h.length} kept on this computer` : '';
  if (!h.length) { $('st-spark').innerHTML = ''; $('st-hist').innerHTML = '<p class="st-empty">Your tests will be listed here, so you can see if the line gets slower at night or after a change.</p>'; return; }
  const pts = h.slice(0, 30).reverse(), max = stNice(Math.max(1, ...pts.map((r) => Math.max(r.down?.mbps || 0, r.up?.mbps || 0))), 10);
  const line = (k) => pts.map((r, i) => `${i ? 'L' : 'M'}${(pts.length < 2 ? 50 : i / (pts.length - 1) * 100).toFixed(2)} ${(18 - Math.min(1, (r[k]?.mbps || 0) / max) * 16).toFixed(2)}`).join(' ');
  $('st-spark').innerHTML = pts.length > 1 ? `<svg viewBox="0 0 100 20" preserveAspectRatio="none" role="img" aria-label="Download and upload over your last ${pts.length} tests"><path class="st-line st-line--down" d="${line('down')}"/><path class="st-line st-line--up" d="${line('up')}"/></svg>` : '';
  const cur = ST.pick?.at ?? (ST.test?.phase === 'done' ? ST.test.at : null);
  $('st-hist').innerHTML = h.slice(0, 30).map((r) => `<div class="st-row${r.at === cur ? ' on' : ''}"><button type="button" class="st-row-main" data-st-pick="${r.at}"><span class="w">${esc(when(r.at))}</span><span class="d">↓ ${stMbps(r.down?.mbps)}</span><span class="u">↑ ${stMbps(r.up?.mbps)}</span><span class="p">${stMs(r.ping?.idle?.median)} ms</span><span class="g">${esc(r.bloat?.grade || '')}</span><span class="c">${r.link?.kind === 'wifi' ? 'Wi-Fi' : r.link?.kind === 'wired' ? 'Cable' : ''}</span></button><button type="button" class="st-x" data-st-forget="${r.at}" aria-label="Remove the test from ${esc(when(r.at))}" title="Remove">×</button></div>`).join('');
  stFitHist();
}

// The list shows the rows that fit its box, never a scroll bar; the rest are
// still in the sparkline above it.
function stFitHist() {
  const box = $('st-hist'); if (!box) return;
  const rows = [...box.children]; rows.forEach((r) => { r.hidden = false; });
  const bottom = box.getBoundingClientRect().bottom;
  let shown = 0;
  for (const r of rows) { if (r.getBoundingClientRect().bottom > bottom + 1) r.hidden = true; else shown++; }
  if (rows.length > shown && rows[0]?.classList?.contains('st-row')) $('st-hist-aside').textContent = `latest ${shown} of ${ST.hist.length}`;
}
window.addEventListener('resize', () => { if ($('st-scrim')?.classList.contains('open')) stFitHist(); });

function stCopyText(t) {
  return `Internet speed, ${new Date(t.at).toLocaleString()}: download ${stMbps(t.down?.mbps)} Mbps, upload ${stMbps(t.up?.mbps)} Mbps, ping ${stMs(t.ping?.idle?.median)} ms (jitter ${stMs(t.ping?.idle?.jitter)} ms)${t.bloat ? `, bufferbloat ${t.bloat.grade} (+${stMs(t.bloat.ms)} ms busy)` : ''}${t.loss?.idle ? `, packet loss ${t.loss.idle.pct}%` : ''}. Cloudflare ${t.server?.colo || ''}${t.link?.kind ? ', ' + (t.link.kind === 'wifi' ? 'Wi-Fi' : 'cable') : ''}.`;
}

// ---------- the loop: runs while the window is open
async function stTick(tok) {
  // A test Jarvis started keeps being followed after the window closes, so he can say how it went.
  if (tok !== ST.tok || (!$('st-scrim').classList.contains('open') && !ST.announce)) return;
  let again = 1000;
  if (!document.hidden) {
    try {
      const was = ST.test?.phase, r = await api('/api/speedtest');
      if (tok !== ST.tok) return;
      ST.test = r.test;
      if (stRunning(ST.test)) again = 200;
      else if (was && was !== ST.test?.phase) { const h = await api('/api/speedtest?history=1'); ST.hist = h.history || []; stHistory(); stTell(ST.test); }
      stRender();
      if (!stRunning(ST.test)) return;
    } catch (e) { $('st-head').textContent = e.message; }
  }
  setTimeout(() => stTick(tok), again);
}
// Jarvis says the result of a test he was asked to run (jarvisspeak.js).
function stTell(t) {
  if (!ST.announce || !t) return;
  ST.announce = false;
  const say = t.phase === 'done' ? [t.summary?.headline, t.summary?.notes?.[0]].filter(Boolean).join(' ') : t.phase === 'error' ? t.error : 'The network test was stopped.';
  if (say && typeof jvAnnounce === 'function') jvAnnounce(say, 'Network test');
}
async function stOpen({ announce = false } = {}) {
  if (announce) ST.announce = true;
  if (!ST.built) stBuild();
  openDialog('st-scrim');
  ST.pick = null;
  try { const r = await api('/api/speedtest?history=1'); ST.test = r.test; ST.hist = r.history || []; }
  catch (e) { toast(e.message, { kind: 'error' }); }
  if (!ST.test && ST.hist[0]) ST.pick = ST.hist[0];
  stRender(); stHistory();
  if (stRunning(ST.test)) stTick(++ST.tok); else if (ST.announce) stTell(ST.test);
  $('st-go').focus({ preventScroll: true });
}
async function stGo() {
  ST.pick = null;
  try { await api('/api/speedtest', {}); }
  catch (e) { toast(e.message, { kind: 'error' }); return; }
  ST.test = { phase: 'starting', lat: { idle: [], down: [], up: [] }, down: { live: 0, trace: [] }, up: { live: 0, trace: [] } };
  ST.shown = 0; stRender(); stHistory();
  stTick(++ST.tok);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && $('st-scrim')?.classList.contains('open') && stRunning(ST.test)) stTick(++ST.tok); });
document.addEventListener('click', async (e) => {
  if (e.target.closest('#st-open')) { closeDialog('settings-scrim'); stOpen(); return; }
  if (e.target.closest('#mon-speedtest')) { stOpen(); return; }
  if (e.target.closest('#st-go')) { stGo(); return; }
  if (e.target.closest('#st-stop')) { api('/api/speedtest/stop', {}).catch((err) => toast(err.message, { kind: 'error' })); return; }
  if (e.target.closest('#st-copy')) {
    const t = ST.pick || ST.test; if (!t) return;
    try { await navigator.clipboard.writeText(stCopyText(t)); toast('Result copied.'); } catch { toast('The clipboard was not available. Select the numbers and copy them instead.', { kind: 'error' }); }
    return;
  }
  const pick = e.target.closest('[data-st-pick]');
  if (pick) {
    const r = ST.hist.find((x) => String(x.at) === pick.dataset.stPick);
    ST.pick = r && !(ST.test?.phase === 'done' && ST.test.at === r.at) ? { ...r, phase: 'done' } : null;
    stRender(); stHistory(); return;
  }
  const forget = e.target.closest('[data-st-forget]');
  if (forget) {
    try { await api('/api/speedtest/forget', { at: Number(forget.dataset.stForget) }); }
    catch (err) { toast(err.message, { kind: 'error' }); return; }
    ST.hist = ST.hist.filter((x) => String(x.at) !== forget.dataset.stForget);
    if (ST.pick && String(ST.pick.at) === forget.dataset.stForget) ST.pick = null;
    stRender(); stHistory();
  }
});
