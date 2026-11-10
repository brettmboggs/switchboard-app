// The AI plans page (#usage), opened from the AI plans card on the Deck and on
// Now. One screen, no scrolling: a tab per plan; the window's big chart (hover
// it for any moment, the dashed line is where the pace goes, the faint one is
// last window at the same point); the readout beside it; then when you use it
// (weekday by hour), past windows and the last four weeks, and habits with the
// sessions that made the big jumps. The history comes from /api/usage
// (lib/usagehist.js); the current windows and forecasts from the board (S.usage).
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
const up = { provider: null, win: null, view: null, data: null, at: 0, busy: false, stamp: '', html: '' };
const UP_DAYS = [1, 2, 3, 4, 5, 6, 0];   // Monday first
const upDayName = (d, f = 'short') => new Date(2026, 10, 1 + d).toLocaleDateString([], { weekday: f });   // Nov 1 2026 was a Sunday
const upHour = (h) => new Date(2026, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' });
// What one window of a kind is called: a 5-hour block, a week, a month.
const upPeriod = (win) => { const w = (S.usage || []).find((p) => p.id === up.provider)?.windows.find((x) => x.id === win); return !w ? 'week' : w.len <= 86400e3 ? 'block' : w.len <= 8 * 86400e3 ? 'week' : 'month'; };
const upTone = (w) => (w.state === 'over' || w.state === 'out' ? 'hot' : w.state === 'tight' ? 'warn' : 'ok');

async function upLoad(force = false) {
  const stamp = JSON.stringify((S.usage || []).map((p) => [p.id, p.at]));
  if (up.busy || (!force && up.data && up.data.provider === (up.provider || up.data.provider) && stamp === up.stamp && Date.now() - up.at < 60e3)) return;
  up.busy = true;
  try {
    const q = new URLSearchParams();
    if (up.provider) q.set('provider', up.provider);
    if (up.view) { q.set('win', up.view.win); q.set('at', up.view.resetsAt); }
    const r = await fetch('/api/usage?' + q, { cache: 'no-store' });
    if (r.ok) { up.data = await r.json(); up.stamp = stamp; up.at = Date.now(); }
  } catch {}
  up.busy = false;
  if (page === 'usage') renderUsagePage();
}

function renderUsagePage() {
  upLoad();
  const d = up.data;
  const used = (S.usage || []).filter((p) => p.windows.some((w) => w.pct > 0 || w.points.some((q) => q[1] > 0)));
  // The tab picked last time, else the plan most used right now.
  if (!up.provider) { let last = null; try { last = localStorage.getItem('sb.usagePlan'); } catch {}
    const top = [...used].sort((a, b) => Math.max(...b.windows.map((w) => w.pct)) - Math.max(...a.windows.map((w) => w.pct)))[0];
    up.provider = ((S.usage || []).find((p) => p.id === last) || top || (S.usage || [])[0])?.id || null; }
  const plan = (S.usage || []).find((p) => p.id === up.provider) || (S.usage || [])[0];
  if (!up.provider && plan) up.provider = plan.id;
  const tabs = (d?.providers || []).length > 1 ? `<nav class="chips tabs up-tabs" aria-label="Plans">${d.providers.map((p) => `<button class="chip" type="button" data-up-plan="${esc(p.id)}" aria-pressed="${p.id === up.provider}">${esc(p.name)}</button>`).join('')}</nav>` : '';
  const head = `<div class="page-head"><h1>AI plans</h1>${tabs}<span class="grow"></span>${plan ? `<span class="u-asof">${Date.now() - plan.at > 3600e3 ? 'as of ' + esc(since(plan.at)) : 'live'}</span>` : ''}</div>`;
  let html;
  if (!plan) {
    html = head + `<section class="card"><p class="empty">Your plan limits show here once a Claude Code session is running (or Codex has been used): how much is used, when it resets, whether the pace lasts, and your habits over time.</p></section>`;
  } else {
    const wins = plan.windows;
    if (!wins.some((w) => w.id === up.win)) up.win = (wins.find((w) => w.id === d?.main) || wins[wins.length - 1]).id;
    const w = wins.find((x) => x.id === up.win);
    html = head + `<div class="up-grid">
      ${upChartCard(plan, w, d)}
      ${upReadout(plan, w, d)}
      ${upHeat(d)}
      ${upPast(d)}
      ${upHabits(d)}
    </div>`;
  }
  html = `<div class="up" data-usage-page>${html}</div>`;
  if (html !== up.html || !$('page').querySelector('[data-usage-page]')) { $('page').innerHTML = html; up.html = html; }
}

// ---- the big chart: the window from its start to its reset, or a past one picked below.
function upChartCard(plan, w, d) {
  const pick = plan.windows.length > 1 ? `<div class="chips up-wins" role="group" aria-label="Window">${plan.windows.map((x) => `<button class="chip" type="button" data-up-win="${esc(x.id)}" aria-pressed="${x.id === w.id && !up.view}">${esc(useName(x))}</button>`).join('')}</div>` : '';
  const v = up.view && d?.view;
  const title = v ? `${esc(useName({ id: up.view.win, len: v.len }))} · ${esc(new Date(v.start).toLocaleDateString([], { month: 'short', day: 'numeric' }))} to ${esc(new Date(v.resetsAt).toLocaleDateString([], { month: 'short', day: 'numeric' }))}` : `${esc(plan.name)} ${esc(useName(w).toLowerCase())}`;
  const back = v ? '<button class="btn btn--sm" type="button" data-up-now>Back to now</button>' : '';
  return `<section class="card up-chart u-win--${v ? 'ok' : upTone(w)}" aria-label="Usage chart">
    <div class="up-head"><span class="u-title">${title}</span><span class="grow"></span>${back}${pick}</div>
    ${upPlot(w, d, v)}
  </section>`;
}

function upPlot(w, d, v) {
  const W = 1000, Hh = 300, now = Date.now();
  const start = v ? v.start : w.start, len = v ? v.len : w.len, end = start + len;
  const pts = v ? v.points : (d?.series?.[w.id]?.now?.length ? d.series[w.id].now : w.points);
  const prev = v ? [] : d?.series?.[w.id]?.prev || [];
  const x = (t) => Math.max(0, Math.min(W, ((t - start) / len) * W)), y = (p) => Hh - (Math.min(100, Math.max(0, p)) / 100) * Hh;
  const path = (list) => list.map(([t, p], i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
  const live = !v && !w.reset;
  const list = pts.length ? pts : live ? [[now, w.pct]] : [];
  let body = '';
  const grid = [25, 50, 75].map((p) => `<path class="up-gridl" d="M0,${y(p)} L${W},${y(p)}"/>`).join('');
  // Ticks along the bottom: each day for a long window, every hour for a short one.
  const tickStep = len > 26 * 3600e3 ? 86400e3 : 3600e3;
  const ticks = [];
  for (let t = Math.ceil(start / tickStep) * tickStep; t < end; t += tickStep) {
    const lt = tickStep === 86400e3 ? new Date(new Date(t).setHours(0, 0, 0, 0)).getTime() : t;
    if (lt <= start || lt >= end) continue;
    ticks.push(lt);
  }
  const every = Math.ceil(ticks.length / 10);
  const shown = ticks.filter((_, i) => i % every === 0);
  const vlines = ticks.map((t) => `<path class="up-gridv" d="M${x(t).toFixed(1)},0 L${x(t).toFixed(1)},${Hh}"/>`).join('');
  if (prev.length) body += `<path class="up-prev" d="${path(prev)}"/>`;
  if (list.length) {
    const lx = x(live ? now : list[list.length - 1][0]), ly = y(live ? w.pct : list[list.length - 1][1]);
    const area = `${path(list)} L${lx.toFixed(1)},${ly.toFixed(1)} L${lx.toFixed(1)},${Hh} L${x(list[0][0]).toFixed(1)},${Hh} Z`;
    body += `<path class="u-area" d="${area}" style="fill: url(#up-g)"/><path class="u-line" d="${path(list)} L${lx.toFixed(1)},${ly.toFixed(1)}"/>`;
    if (live && w.state !== 'out') {
      const endT = w.outAt || w.resetsAt, endP = w.outAt ? 100 : w.lands;
      body += `<path class="u-proj" d="M${lx.toFixed(1)},${ly.toFixed(1)} L${x(endT).toFixed(1)},${y(endP).toFixed(1)}"/><path class="u-now" d="M${lx.toFixed(1)},0 L${lx.toFixed(1)},${Hh}"/>`;
    }
  }
  const labels = shown.map((t) => `<span class="up-tick" style="left: ${(x(t) / W * 100).toFixed(2)}%">${esc(tickStep === 86400e3 ? new Date(t).toLocaleDateString([], every > 1 ? { month: 'short', day: 'numeric' } : { weekday: 'short' }) : new Date(t).toLocaleTimeString([], { hour: 'numeric' }))}</span>`).join('');
  const ylabels = [100, 75, 50, 25].map((p) => `<span class="up-ylab" style="top: ${(y(p) / Hh * 100).toFixed(2)}%">${p}%</span>`).join('');
  const dot = live && list.length ? `<span class="u-dot" style="left: ${(x(now) / W * 100).toFixed(2)}%; top: ${(y(w.pct) / Hh * 100).toFixed(2)}%"></span>` : '';
  const hit = live && w.outAt ? `<span class="u-hit" style="left: ${(x(w.outAt) / W * 100).toFixed(2)}%" title="Runs out here at this pace"></span>` : '';
  const legend = `<div class="up-legend"><span class="up-k up-k--used">used</span>${live ? '<span class="up-k up-k--proj">at this pace</span>' : ''}<span class="up-k up-k--even">even pace</span>${prev.length ? '<span class="up-k up-k--prev">last window</span>' : ''}</div>`;
  return `<div class="up-plot" data-up-plot data-start="${start}" data-len="${len}">
    <svg class="u-chart" viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="up-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="u-g1"/><stop offset="1" class="u-g2"/></linearGradient></defs>
      ${grid}${vlines}<path class="u-limit" d="M0,0.5 L${W},0.5"/><path class="u-even" d="M0,${Hh} L${W},0"/>${body}
    </svg>${ylabels}${labels}${dot}${hit}
    <span class="up-cross" hidden></span><span class="up-tip" hidden></span>
  </div>${legend}`;
}

// Hovering the chart: the moment under the pointer, what was used then (or
// where the pace puts it, ahead of now), an even pace, and last window then.
function upAt(list, t) {
  if (!list?.length || t < list[0][0]) return null;
  let i = list.findIndex((q) => q[0] > t);
  if (i === -1) return list[list.length - 1][1];
  const [t0, p0] = list[i - 1] || list[0], [t1, p1] = list[i];
  return t1 === t0 ? p1 : p0 + (p1 - p0) * (t - t0) / (t1 - t0);
}
document.addEventListener('pointermove', (e) => {
  const plot = e.target.closest?.('[data-up-plot]');
  document.querySelectorAll('.up-plot .up-tip:not([hidden]), .up-plot .up-cross:not([hidden])').forEach((el) => { if (!plot || !plot.contains(el)) el.hidden = true; });
  if (!plot || page !== 'usage') return;
  const r = plot.getBoundingClientRect(), f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  const start = Number(plot.dataset.start), len = Number(plot.dataset.len), t = start + f * len, now = Date.now();
  const plan = (S.usage || []).find((p) => p.id === up.provider), w = plan?.windows.find((x) => x.id === up.win);
  const v = up.view && up.data?.view;
  const pts = v ? v.points : up.data?.series?.[up.win]?.now || w?.points || [];
  let line;
  if (!v && w && t > now && !w.reset) {
    const endT = w.outAt || w.resetsAt, endP = w.outAt ? 100 : w.lands;
    const p = t >= endT ? endP : w.pct + (endP - w.pct) * (t - now) / Math.max(1, endT - now);
    line = `<span><b>${Math.round(p)}%</b> at this pace</span>`;
  } else {
    const p = upAt(pts, Math.min(t, now));
    line = p == null ? '<span>no readings yet</span>' : `<span><b>${Math.round(p)}%</b> used</span>`;
  }
  const prev = !v && upAt(up.data?.series?.[up.win]?.prev, t);
  const when = new Date(t).toLocaleString([], len > 8 * 86400e3 ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' } : len > 26 * 3600e3 ? { weekday: 'short', hour: 'numeric', minute: '2-digit' } : { hour: 'numeric', minute: '2-digit' });
  const tip = plot.querySelector('.up-tip'), cross = plot.querySelector('.up-cross');
  tip.innerHTML = `<span class="up-tip-t">${esc(when)}</span>${line}<span class="muted">even pace ${Math.round(f * 100)}%${prev != null && prev !== false ? ` · last window ${Math.round(prev)}%` : ''}</span>`;
  tip.hidden = cross.hidden = false;
  cross.style.left = (f * 100) + '%';
  tip.style.left = (f * 100) + '%';
  tip.classList.toggle('up-tip--left', f > 0.7);
});

// ---- beside the chart: the numbers that matter right now.
function upReadout(plan, w, d) {
  const h = d?.habits || {};
  const pace = w.pct - w.even;
  const row = (k, v, sub = '') => `<div class="up-row"><span class="up-k2">${k}</span><span class="up-v">${v}</span>${sub ? `<span class="up-sub">${sub}</span>` : ''}</div>`;
  const short = w.len <= 86400e3;
  const room = w.perDay == null ? '—' : short ? `${(w.perDay / 24).toFixed(1)}%/h` : `${Math.round(w.perDay)}%/day`;
  const vsLast = h.lastAtThisPoint != null && !short && w.id === d?.main ? `${h.lastAtThisPoint}%` : null;
  return `<section class="card up-read u-win--${upTone(w)}" aria-label="Right now">
    <div class="u-read"><span class="u-pct up-pct">${Math.round(w.pct)}<small>%</small></span><span class="u-pace">${w.reset ? 'fresh window' : Math.abs(pace) < 3 ? 'even pace' : pace > 0 ? `${Math.round(pace)}% ahead of even` : `${Math.round(-pace)}% under even`}</span></div>
    <p class="u-line">${esc(useLine(w))}</p>
    ${w.days ? `<div class="up-days"><span class="up-k2">Each day this week</span>${useDays(w)}</div>` : ''}
    <div class="up-rows">
      ${row('Resets', esc(useReset(w.resetsAt)), esc(new Date(w.resetsAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })))}
      ${row('Lands near', w.reset ? '—' : `${Math.min(999, w.lands)}%`, w.outAt ? `out ${esc(useWhen(w.outAt))}` : '')}
      ${row('Burning', w.rate ? `${w.rate.toFixed(w.rate < 1 ? 2 : 1)}%/h` : '—', 'recent pace')}
      ${row('Room left', esc(room), 'to last to the reset')}
      ${vsLast ? row('Last week here', vsLast, w.pct > h.lastAtThisPoint + 2 ? 'using more' : w.pct < h.lastAtThisPoint - 2 ? 'using less' : 'about the same') : ''}
    </div>
  </section>`;
}

// ---- when you use it: weekday by hour, brighter where more of the plan went.
function upHeat(d) {
  if (!d?.heat) return '<section class="card up-heat"><span class="u-title">When you use it</span></section>';
  const max = Math.max(0.01, ...d.heat.flat());
  const days = Math.max(1, Math.round((Date.now() - d.habits.since) / 86400e3));
  const cells = UP_DAYS.map((wd) => `<span class="up-hd">${esc(upDayName(wd, 'narrow'))}</span>${d.heat[wd].map((v, h) => `<i class="up-cell" style="--a: ${(v / max).toFixed(2)}" title="${esc(upDayName(wd, 'long'))} ${esc(upHour(h))}: ${v ? `about ${v < 0.1 ? '<0.1' : v.toFixed(1)}% of the week` : 'nothing'}"></i>`).join('')}`).join('');
  return `<section class="card up-heat" aria-label="When you use it">
    <div class="up-head"><span class="u-title">When you use it</span><span class="grow"></span><span class="up-note">${days < 14 ? `${days} day${days === 1 ? '' : 's'} so far` : 'average week'}</span></div>
    <div class="up-hm">${cells}<span></span>${[0, 6, 12, 18].map((h) => `<span class="up-hh" style="grid-column: ${h + 2} / span 6">${esc(upHour(h))}</span>`).join('')}</div>
  </section>`;
}

// ---- past windows (click one to see it on the chart) and the last four weeks, day by day.
function upPast(d) {
  const kind = up.win && d?.past?.[up.win] ? up.win : d?.main;
  const list = d?.past?.[kind] || [];
  const bars = list.length ? list.map((p) => `<button type="button" class="up-pbar ${p.outAt ? 'up-pbar--out' : ''} ${up.view?.resetsAt === p.resetsAt ? 'up-pbar--on' : ''}" data-up-view="${p.resetsAt}" data-up-kind="${esc(kind)}" title="${esc(new Date(p.start).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric' }))}: ended at ${p.peak}%${p.outAt ? `, ran out ${new Date(p.outAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : ''}${p.partial ? ' (readings began part way)' : ''}"><i style="height: ${Math.max(3, Math.min(100, p.peak))}%"><em>${p.peak}%</em></i><b>${p.len > 86400e3 ? esc(new Date(p.start).toLocaleDateString([], { month: 'numeric', day: 'numeric' })) : ''}</b></button>`).join('')
    : `<p class="up-empty">Each finished ${upPeriod(kind) === 'block' ? '5-hour block' : upPeriod(kind)} lands here with where it ended. Click one to see it on the chart.</p>`;
  const max = Math.max(1, ...(d?.daily || []).map((x) => x[1] || 0));
  const today = new Date().setHours(0, 0, 0, 0);
  const daily = (d?.daily || []).map(([t, v]) => `<span class="up-dbar ${t === today ? 'up-dbar--today' : ''} ${v == null ? 'up-dbar--none' : ''}" title="${esc(new Date(t).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }))}: ${v == null ? 'no readings yet' : `${v}% of the week`}">${v ? `<i style="height: ${Math.max(4, (v / max) * 100).toFixed(0)}%"></i>` : ''}</span>`).join('');
  return `<section class="card up-past" aria-label="Past windows">
    <div class="up-head"><span class="u-title">Past ${upPeriod(kind)}s</span><span class="grow"></span><span class="up-note">where each ended</span></div>
    <div class="up-pbars">${bars}</div>
    <div class="up-head"><span class="u-title">Last 4 weeks</span><span class="grow"></span><span class="up-note">used each day</span></div>
    <div class="up-dbars">${daily}</div>
  </section>`;
}

// ---- habits, and the sessions that made a dent this window.
function upHabits(d) {
  const h = d?.habits || {};
  const stat = (v, k) => `<div class="up-stat"><span class="up-sv">${v ?? '—'}</span><span class="up-sk">${k}</span></div>`;
  const sess = (d?.sessions || []).map((s) => {
    const live = (S.sessions || []).find((x) => x.id === s.id);
    const name = s.folder || (s.space ? spaceOf(s.space).name : 'A session');
    const inner = `<span class="up-sn">${s.space ? tag(s.space) : ''}${esc(name)}</span><span class="up-sp">${esc(s.prompt || '')}</span><span class="up-su">+${s.used}%</span>`;
    return live?.termId ? `<button type="button" class="up-sess" data-up-term="${esc(live.termId)}" title="Open this session">${inner}</button>` : `<div class="up-sess">${inner}</div>`;
  }).join('');
  return `<section class="card up-habits" aria-label="Habits">
    <div class="up-head"><span class="u-title">Habits</span></div>
    <div class="up-stats">
      ${stat(h.perDay != null ? `${h.perDay}%` : null, 'a day, on average')}
      ${stat(h.perActiveHour != null ? `${h.perActiveHour}%` : null, 'an hour of real use')}
      ${stat(h.activeHours != null ? `${h.activeHours}h` : null, 'of real use a day')}
      ${stat(h.busiestDay != null ? esc(upDayName(h.busiestDay, 'short')) : null, 'busiest day')}
      ${stat(h.peakHour != null ? esc(upHour(h.peakHour)) : null, 'busiest hour')}
      ${stat(h.avgEnd != null ? `${h.avgEnd}%` : null, `a week ends at${h.ranOut ? ` · ran out ${h.ranOut}×` : ''}`)}
    </div>
    <div class="up-head"><span class="u-title">Big sessions</span><span class="grow"></span><span class="up-note">this window</span></div>
    <div class="up-sl">${sess || '<p class="up-empty">The sessions that use the most of this window show here, with how much each took.</p>'}</div>
  </section>`;
}

document.addEventListener('click', (e) => {
  if (page !== 'usage') return;
  const b = e.target.closest('[data-up-plan], [data-up-win], [data-up-view], [data-up-now], [data-up-term]');
  if (!b) return;
  if (b.dataset.upPlan) { up.provider = b.dataset.upPlan; try { localStorage.setItem('sb.usagePlan', up.provider); } catch {} up.win = null; up.view = null; up.data = null; renderUsagePage(); return; }
  if (b.dataset.upWin) { up.win = b.dataset.upWin; up.view = null; upLoad(true); renderUsagePage(); return; }
  if (b.hasAttribute('data-up-now')) { up.view = null; upLoad(true); return; }
  if (b.dataset.upView) {
    const at = Number(b.dataset.upView);
    up.view = up.view?.resetsAt === at ? null : { win: b.dataset.upKind, resetsAt: at };
    upLoad(true); return;
  }
  if (b.dataset.upTerm) { location.hash = '#sessions'; openTerm(b.dataset.upTerm); }
});
