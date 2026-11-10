// AI plans: how much of each plan's limit is used, when it resets, and where
// the pace lands by then (lib/usage.js works it out from Claude Code's status
// line and Codex's logs). One card, on the Deck's bottom row and on Now. Each
// window is a small chart from its start to its reset: what was used so far
// (the filled line), where the pace goes from here (dashed), an even pace
// (the faint diagonal) and the limit (the top line). Orange only when the pace
// runs out before the reset, as that is when it needs you. Clicking it opens
// the AI plans page (usagepage.js): history, habits and the big sessions.
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
const USE_WIN = { five_hour: '5-hour', seven_day: 'Weekly', seven_day_opus: 'Weekly, Opus', seven_day_sonnet: 'Weekly, Sonnet', primary: 'Plan window', secondary: 'Second window' };
const useName = (w) => USE_WIN[w.id] || (w.len <= 6 * 3600e3 ? '5-hour' : w.len <= 8 * 86400e3 ? 'Weekly' : 'Monthly');

// "in 2h 10m" today, "Thu 2:00 AM" further off.
function useReset(t) {
  const left = t - Date.now();
  if (left <= 0) return 'reset';
  if (left < 20 * 3600e3) { const h = Math.floor(left / 3600e3), m = Math.round((left % 3600e3) / 60e3); return `in ${h ? h + 'h ' : ''}${m}m`; }
  return new Date(t).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}
const useWhen = (t) => (t - Date.now() < 20 * 3600e3 ? new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : new Date(t).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }));

// The forecast in one plain line.
function useLine(w) {
  const short = w.len <= 86400e3;
  const room = w.perDay == null ? '' : short ? `${Math.max(0, (w.perDay / 24)).toFixed(w.perDay / 24 < 10 ? 1 : 0)}% an hour` : `${Math.round(w.perDay)}% a day`;
  if (w.reset) return 'Fresh window';
  if (w.state === 'out') return `Limit reached · back ${useReset(w.resetsAt)}`;
  if (w.state === 'over') return `Runs out about ${useWhen(w.outAt)} at this pace${room ? ` · ${room} lasts to the reset` : ''}`;
  if (w.state === 'tight') return `Close · lands near ${Math.min(100, w.lands)}%${room ? ` · keep under ${room}` : ''}`;
  return `On track · lands near ${w.lands}%${room ? ` · room for ${room}` : ''}`;
}

// The chart: 0..100% up, window start..reset across. Drawn in a 300×80 box that stretches.
function useChart(w, key) {
  const W = 300, Hh = 80, now = Date.now();
  const x = (t) => Math.max(0, Math.min(W, ((t - w.start) / w.len) * W)), y = (p) => Hh - (Math.min(100, Math.max(0, p)) / 100) * Hh;
  const pts = w.points.length ? w.points : [[now, w.pct]];
  const line = pts.map(([t, p], i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
  const nx = x(now), ny = y(w.pct), fx = x(pts[0][0]), fy = y(pts[0][1]);
  const area = `${line} L${nx.toFixed(1)},${ny.toFixed(1)} L${nx.toFixed(1)},${Hh} L${fx.toFixed(1)},${Hh} Z`;
  // Before the first reading Switchboard does not know the path: a faint dotted guess from 0.
  const guess = fx > 1 ? `<path class="u-guess" d="M0,${Hh} L${fx.toFixed(1)},${fy.toFixed(1)}"/>` : '';
  const endT = w.outAt || w.resetsAt, endP = w.outAt ? 100 : w.lands;
  const proj = w.reset || w.state === 'out' ? '' : `<path class="u-proj" d="M${nx.toFixed(1)},${ny.toFixed(1)} L${x(endT).toFixed(1)},${y(endP).toFixed(1)}"/>`;
  return `<svg class="u-chart" viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="ug-${key}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="u-g1"/><stop offset="1" class="u-g2"/></linearGradient></defs>
    <path class="u-limit" d="M0,0.5 L${W},0.5"/><path class="u-even" d="M0,${Hh} L${W},0"/>
    ${guess}<path class="u-area" d="${area}" style="fill: url(#ug-${key})"/><path class="u-line" d="${line} L${nx.toFixed(1)},${ny.toFixed(1)}"/>
    ${proj}<path class="u-now" d="M${nx.toFixed(1)},0 L${nx.toFixed(1)},${Hh}"/>
  </svg><span class="u-dot" style="left: ${(nx / W * 100).toFixed(2)}%; top: ${(ny / Hh * 100).toFixed(2)}%"></span>${w.outAt ? `<span class="u-hit" style="left: ${(x(endT) / W * 100).toFixed(2)}%" title="Runs out here at this pace"></span>` : ''}`;
}

// A weekly window's days: what each one used, today last and brightest.
// Seven slots under the chart, lined up with it; a day with no reading to
// measure from, or still to come, is an empty slot.
function useDays(w) {
  if (!w.days?.length) return '';
  const top = Math.max(1, ...w.days.filter((d) => d != null));
  const today = Math.floor((Date.now() - w.start) / 86400e3);
  return `<div class="u-days" aria-label="Used each day">${w.days.map((d, i) => {
    const day = new Date(w.start + i * 86400e3);
    const tip = d == null ? (i > today ? 'still to come' : 'no readings yet') : `${d}% used`;
    return `<span class="u-day ${i === today ? 'u-today' : ''} ${d == null ? 'u-none' : ''}" title="${esc(day.toLocaleDateString([], { weekday: 'long' }))}: ${tip}">${d == null ? '' : `<i style="height: ${Math.max(4, (d / top) * 100).toFixed(0)}%"></i>`}<b>${esc(day.toLocaleDateString([], { weekday: 'narrow' }))}</b></span>`;
  }).join('')}</div>`;
}

function useWindow(p, w) {
  const tone = w.state === 'over' || w.state === 'out' ? 'hot' : w.state === 'tight' ? 'warn' : 'ok';
  const pace = w.pct - w.even;
  return `<div class="u-win u-win--${tone}">
    <div class="u-head"><span class="u-name"><b>${esc(p.name)}</b> ${esc(useName(w))}</span><span class="u-reset">resets ${esc(useReset(w.resetsAt))}</span></div>
    <div class="u-read"><span class="u-pct">${Math.round(w.pct)}<small>%</small></span><span class="u-pace" title="Compared with using it evenly to the reset">${w.reset ? '' : Math.abs(pace) < 3 ? 'even pace' : pace > 0 ? `${Math.round(pace)}% ahead of even` : `${Math.round(-pace)}% under even`}</span></div>
    <div class="u-plot">${useChart(w, p.id + '-' + w.id)}</div>
    ${useDays(w)}
    <p class="u-line">${esc(useLine(w))}</p>
  </div>`;
}

// The whole card. where: 'deck' (a module on the Deck) or 'now' (a card on Now).
function usageCard(where = 'now') {
  // A plan that used nothing all week (a free Codex, say) stays out of the way until it is used.
  const plans = (S.usage || []).filter((p, _, all) => all.length === 1 || p.windows.some((w) => w.pct > 0 || w.points.some((q) => q[1] > 0)));
  const open = !window.WEB && plans.length;   // the card opens the AI plans page (usagepage.js)
  const head = `<div class="u-top"><span class="u-title">AI plans</span><span class="grow"></span>${plans.length ? `<span class="u-asof">${Date.now() - plans[0].at > 3600e3 ? 'as of ' + esc(since(plans[0].at)) : 'live'}</span>` : ''}${open ? '<span class="mod-go" aria-hidden="true">↗</span>' : ''}</div>`;
  const body = plans.length
    ? `<div class="u-wins">${plans.flatMap((p) => p.windows.map((w) => useWindow(p, w))).join('')}</div>`
    : '<p class="u-quiet">Your plan limits show here once a Claude Code session is running: how much is used, when it resets, and whether the pace lasts.</p>';
  const cls = `usage ${where === 'deck' ? 'mod usage--deck' : 'card usage--now'}`;
  return open ? `<a class="${cls} usage--open" href="#usage" aria-label="AI plan usage: open the AI plans page">${head}${body}</a>` : `<section class="${cls}" aria-label="AI plan usage">${head}${body}</section>`;
}

// The same limits as a tiny gauge per window, for a Claude Code session's bar
// on Sessions: "5h ▰▰▱ 82%  wk ▰▱▱ 48%", coloured as on the card.
function usageChip(provider) {
  const p = (S.usage || []).find((x) => x.id === provider);
  if (!p) return '';
  const short = (w) => (w.len <= 6 * 3600e3 ? '5h' : w.len <= 8 * 86400e3 ? 'wk' : 'mo');
  return `<span class="u-chip" title="${esc(p.windows.map((w) => `${p.name} ${useName(w).toLowerCase()}: ${Math.round(w.pct)}% used, resets ${useReset(w.resetsAt)}. ${useLine(w)}`).join('\n'))}">${p.windows.filter((w) => !/opus|sonnet/.test(w.id)).map((w) => {
    const tone = w.state === 'over' || w.state === 'out' ? 'hot' : w.state === 'tight' ? 'warn' : 'ok';
    return `<span class="u-mini u-win--${tone}"><b>${short(w)}</b><span class="u-gauge"><i style="width: ${Math.min(100, w.pct).toFixed(0)}%"></i><em style="left: ${Math.min(100, w.even)}%"></em></span>${Math.round(w.pct)}%</span>`;
  }).join('')}</span>`;
}
