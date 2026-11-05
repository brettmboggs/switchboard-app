// Calendar: a month of everything on your calendars, one day opened underneath.
// Reads every calendar Switchboard has (GET /api/calendar). One of the page's
// scripts in public/js, loaded in order by index.html; they share one scope, so
// names defined in an earlier file are usable here.
let cal = { month: null, day: null, events: [], problems: [], key: '', loading: false, error: '' };   // month: first of the month shown; day: the day opened (midnight, ms)

const calDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const calAddDays = (t, n) => { const d = new Date(t); d.setDate(d.getDate() + n); return d.getTime(); };
const calTime = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const calOn = (e, day) => e.start < calAddDays(day, 1) && Math.max(e.end, e.start + 1) > day;

// The six weeks shown: from the Sunday on or before the 1st.
function calGrid(month) {
  const first = new Date(month), start = calAddDays(month, -first.getDay());
  return Array.from({ length: 42 }, (_, i) => calAddDays(start, i));
}

async function calLoad() {
  const grid = calGrid(cal.month), key = grid[0] + ':' + cal.month;
  if (cal.key === key || cal.loading) return;
  cal.loading = true; cal.error = '';
  try {
    const r = await api(`/api/calendar?from=${grid[0]}&to=${calAddDays(grid[41], 1)}`);
    cal = { ...cal, events: r.events, problems: r.problems, key };
  } catch (e) { cal.error = e.message; cal.key = key; }
  finally { cal.loading = false; }
  if (page === 'calendar') renderCalendar();
}

// What a day's row says about when: all day, or the start and end.
const calWhen = (e) => e.allDay ? 'All day' : `${calTime(e.start)} – ${calTime(e.end)}`;

function calDayList(day) {
  const list = cal.events.filter(inProject).filter((e) => calOn(e, day));
  const title = new Date(day).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  return `<section class="card cal-day"><h2 class="section-label">${esc(title)}</h2>${list.length ? `<div class="list">${list.map((e) => `<${e.canWrite ? `button type="button" data-cal-edit="${esc(e.calendar)}:${esc(e.uid)}:${e.start}"` : 'div'} class="row cal-ev">
      <span class="cal-when mono">${esc(calWhen(e))}</span>
      <span class="cal-what"><span class="t">${tag(e.space)}${esc(e.title)}</span>${e.location ? `<span class="s">${esc(e.location.split('\n')[0])}</span>` : ''}</span>
      <span class="cal-from muted">${esc(e.calendarName)}</span></${e.canWrite ? 'button' : 'div'}>`).join('')}</div>` : '<p class="empty">Nothing on this day.</p>'}</section>`;
}

function renderCalendar() {
  const now = Date.now(), today = calDay(now);
  if (!cal.month) { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); cal.month = d.getTime(); cal.day = today; }
  const label = new Date(cal.month).toLocaleDateString([], { month: 'long', year: 'numeric' });
  const head = `<div class="page-head"><h1>Calendar</h1><span class="grow"></span>
    ${(S.calendars || []).some((c) => c.canWrite) ? '<button class="btn btn--primary" type="button" data-cal-new>Add event</button>' : ''}
    <div class="cal-nav"><button class="btn btn--sm" type="button" data-cal="prev" aria-label="Previous month">‹</button>
      <button class="btn btn--sm" type="button" data-cal="today">Today</button>
      <button class="btn btn--sm" type="button" data-cal="next" aria-label="Next month">›</button></div>${projectPicker()}</div>`;
  if (!(S.calendars || []).length) {
    $('page').innerHTML = head + `<section class="card"><p class="empty">No calendar is connected yet. Connect one and its events show here, and on Now.</p>
      <div class="actions"><button class="btn btn--primary" type="button" data-cal="connect">Connect a calendar</button></div></section>`;
    return;
  }
  const grid = calGrid(cal.month), month = new Date(cal.month).getMonth();
  const visible = cal.events.filter(inProject);
  const cells = grid.map((day) => {
    const evs = visible.filter((e) => calOn(e, day)), d = new Date(day);
    const shown = evs.slice(0, 3);
    return `<button type="button" class="cal-cell ${d.getMonth() !== month ? 'out' : ''} ${day === today ? 'today' : ''} ${day === cal.day ? 'sel' : ''}" data-cal-day="${day}" aria-label="${esc(d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }))}, ${evs.length} event${evs.length === 1 ? '' : 's'}" ${day === cal.day ? 'aria-current="date"' : ''}>
      <span class="cal-n">${d.getDate()}</span>
      ${shown.map((e) => `<span class="cal-chip" style="--cal-c:${safeColor(spaceOf(e.space).color)}">${e.allDay ? '' : `<span class="mono">${esc(new Date(e.start).toLocaleTimeString([], { hour: 'numeric' }).replace(/\s/g, '').toLowerCase())}</span> `}${esc(e.title)}</span>`).join('')}
      ${evs.length > shown.length ? `<span class="cal-more muted">+${evs.length - shown.length} more</span>` : ''}</button>`;
  }).join('');
  const notes = [cal.error, ...cal.problems.map((p) => `${p.calendar}: ${p.error}`)].filter(Boolean);
  $('page').innerHTML = head + `<h2 class="cal-month">${esc(label)}${cal.loading ? ' <span class="muted small">loading…</span>' : ''}</h2>
    ${notes.length ? `<section class="card">${notes.map((n) => `<p class="note-line">${esc(n)}</p>`).join('')}</section>` : ''}
    <div class="cal-grid" role="group" aria-label="${esc(label)}">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((n) => `<span class="cal-dow" aria-hidden="true">${n}</span>`).join('')}${cells}</div>
    ${calDayList(cal.day)}`;
  calLoad();
}

document.addEventListener('click', (e) => {
  if (page !== 'calendar') return;
  const dayBtn = e.target.closest('[data-cal-day]');
  if (dayBtn) { cal.day = Number(dayBtn.dataset.calDay); renderCalendar(); return; }
  const b = e.target.closest('[data-cal]');
  if (!b) return;
  const step = (n) => { const d = new Date(cal.month); d.setMonth(d.getMonth() + n); cal.month = d.getTime(); cal.day = cal.month; renderCalendar(); };
  if (b.dataset.cal === 'prev') step(-1);
  else if (b.dataset.cal === 'next') step(1);
  else if (b.dataset.cal === 'today') { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); cal.month = d.getTime(); cal.day = calDay(Date.now()); renderCalendar(); }
  else if (b.dataset.cal === 'connect') openSettings('connections');
});
