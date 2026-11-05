// The morning rundown: one card at the top of Now until noon that says how the
// day looks (weather, meetings, bills, packages, routines, what needs you),
// in one sentence and four figures, and can read itself aloud.
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
// Everything in it came from outside (calendars, mail, weather): esc() on all of it.

const RUNDOWN_DONE = 'sb.rundown.done';   // this browser: the day it was put away
let rundownAsked = false;                 // opened by hand, at any hour
const dayKey = () => new Date().toDateString();

function rundownShows() {
  if (S.prefs?.rundown === false && !rundownAsked) return false;
  if (rundownAsked) return true;
  const h = new Date().getHours();
  return h >= 4 && h < 12 && localStorage.getItem(RUNDOWN_DONE) !== dayKey();
}

// What the day holds, filtered to the project picked in the head of Now.
function rundownData() {
  const now = Date.now(), start = new Date().setHours(0, 0, 0, 0), end = start + 86400e3;
  const events = (S.events || []).filter(inProject).filter((e) => e.end > now && e.start < end);
  const timed = events.filter((e) => !e.allDay).sort((a, b) => a.start - b.start);
  const needs = flight().filter(inProject).filter((c) => c.st === 'needs').sort((a, b) => b.at - a.at);
  const bills = ((S.money && S.money.bills) || []).filter(inProject).filter((b) => b.next && b.next < start + 7 * 86400e3).sort((a, b) => a.next - b.next);
  const routines = (S.routines || []).filter(inProject).filter((r) => r.due_at && r.due_at < end).sort((a, b) => a.due_at - b.due_at);
  const packages = shipList().filter((p) => p.status === 'out' || p.status === 'pickup' || (p.status === 'shipped' && p.eta && p.eta < end));
  return { now, events, timed, allDay: events.filter((e) => e.allDay), needs, bills, routines, packages, weather: S.weather || null };
}

const words = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const count = (n, one, many) => `${n < words.length ? words[n] : n} ${n === 1 ? one : many}`;
const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);
function dueDay(t) {
  const diff = Math.round((new Date(t).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400e3);
  return diff <= 0 ? 'today' : diff === 1 ? 'tomorrow' : new Date(t).toLocaleDateString([], { weekday: 'long' });
}

// The day in a few plain sentences. Plain text: the card escapes it, the voice reads it.
function rundownSentences(d) {
  const out = [];
  const upcoming = d.timed.filter((e) => e.start > d.now);
  if (!(S.calendars || []).length) { /* no calendar: say nothing about meetings */ }
  else if (!d.timed.length) out.push(d.allDay.length ? `Nothing booked, just ${lower(d.allDay[0].title)}${d.allDay.length > 1 ? ' and more' : ''}.` : 'Nothing on the calendar.');
  else if (!upcoming.length) out.push(`${count(d.timed.length, 'meeting', 'meetings')} today, all under way or done.`);
  else out.push(`${count(upcoming.length, 'meeting', 'meetings')}, the ${upcoming.length === 1 ? 'one' : 'first'} at ${clock(upcoming[0].start)}${upcoming[0].title ? ` (${upcoming[0].title})` : ''}.`);
  if (d.needs.length) out.push(`${count(d.needs.length, 'thing needs', 'things need')} you.`);
  if (d.bills.length === 1) out.push(`${d.bills[0].text} (${$$(d.bills[0].amount)}) is due ${dueDay(d.bills[0].next)}.`);
  else if (d.bills.length) out.push(`${count(d.bills.length, 'bill', 'bills')} due this week, ${$$(d.bills.reduce((t, b) => t + (Number(b.amount) || 0), 0))} in all.`);
  if (d.packages.length) out.push(d.packages.length === 1 ? `A package ${d.packages[0].status === 'pickup' ? 'is ready to pick up' : 'arrives today'}.` : `${count(d.packages.length, 'package', 'packages')} arrive today.`);
  if (d.routines.length === 1) out.push(`${d.routines[0].text} ${d.routines[0].due_at <= d.now ? 'is due now' : 'at ' + clock(d.routines[0].due_at)}.`);
  else if (d.routines.length) out.push(`${count(d.routines.length, 'routine', 'routines')} to do today.`);
  if (!out.length) out.push('A clear day. Nothing needs you.');
  return out;
}

const shortDay = (t) => { const w = dueDay(t); return w === 'today' ? 'Today' : w === 'tomorrow' ? 'Tomorrow' : new Date(t).toLocaleDateString([], { weekday: 'short' }); };
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning.' : h < 17 ? 'Good afternoon.' : 'Good evening.'; };

function rundownCard() {
  const d = rundownData(), w = d.weather?.now;
  const sentences = rundownSentences(d);
  const fig = (big, label, sub, hot, extra = '') => `<div class="rd-fig${hot ? ' hot' : ''}"><span class="rd-big">${big}</span><span class="rd-label">${label}</span>${sub ? `<span class="rd-sub">${sub}</span>` : ''}${extra}</div>`;
  const warn = (d.weather?.alerts || []).map((a) => `<details class="wx-warn"><summary>${esc(a.event)}</summary><p>${esc(a.headline || '')}</p>${a.instruction ? `<p>${esc(a.instruction)}</p>` : ''}</details>`).join('');
  const notes = (w?.notes || []).map((n) => `<span class="pill pill--soft wx-note wx-${n.kind}">${esc(n.text)}</span>`).join('');
  const upcoming = d.timed.filter((e) => e.start > d.now);
  const figs = [
    w ? fig(`${Number(w.temp)}°`, esc(w.text), `H ${Number(w.high)}° · L ${Number(w.low)}°`, false, notes ? `<span class="rd-notes">${notes}</span>` : '') : '',
    (S.calendars || []).length ? fig(String(d.timed.length), d.timed.length === 1 ? 'meeting' : 'meetings', upcoming.length ? `first ${esc(clock(upcoming[0].start))}` : d.timed.length ? 'all under way' : 'a clear calendar') : '',
    d.needs.length ? fig(String(d.needs.length), d.needs.length === 1 ? 'needs you' : 'need you', '', true) : '',
    d.bills.length ? fig(esc($$(d.bills.reduce((t, b) => t + (Number(b.amount) || 0), 0))), d.bills.length === 1 ? 'bill this week' : `${d.bills.length} bills this week`, `first due ${esc(dueDay(d.bills[0].next))}`) : '',
    d.packages.length ? fig(String(d.packages.length), d.packages.length === 1 ? 'package today' : 'packages today', esc(d.packages[0].window || '')) : ''
  ].filter(Boolean).slice(0, 4);

  const evItem = (e) => {
    const on = !e.allDay && e.start <= d.now && e.end > d.now;
    return `<li class="${on ? 'on' : ''}"><span class="ev-time">${e.allDay ? 'All day' : on ? 'Now' : esc(clock(e.start))}</span><span class="tag" style="background:${safeColor(spaceOf(e.space).color)}"></span><span class="ev-title">${esc(e.title)}${e.location ? `<span class="ev-where">${esc(e.location.split('\n')[0])}</span>` : ''}</span></li>`;
  };
  const schedule = (S.calendars || []).length
    ? `<div class="rd-col"><h3 class="kicker">Schedule</h3>${d.events.length ? `<ul class="ev-list">${[...d.allDay, ...d.timed].map(evItem).join('')}</ul>` : '<p class="muted">Nothing on the calendar today.</p>'}</div>`
    : '';
  const row = (type, key, left, what, hot) => `<li><button type="button" class="rd-row${hot ? ' hot' : ''}" data-type="${esc(type)}" data-key="${esc(key)}"><span class="rd-when mono">${left}</span><span class="rd-what">${what}</span></button></li>`;
  const lists = [
    // What needs you is listed once, right under the rundown; here it is the figure and the sentence.
    d.bills.length ? `<div><h3 class="kicker">Bills this week</h3><ul class="rd-list">${d.bills.map((b) => row('item', String(b.id), esc(shortDay(b.next)), `${esc(b.text)} <span class="rd-amt">${esc($$(b.amount))}</span>`)).join('')}</ul></div>` : '',
    d.routines.length ? `<div><h3 class="kicker">Routines</h3><ul class="rd-list">${d.routines.map((r) => row('routine', String(r.id), r.due_at <= d.now ? 'Now' : esc(clock(r.due_at)), esc(r.text))).join('')}</ul></div>` : '',
    d.packages.length ? `<div><h3 class="kicker">Packages</h3><ul class="rd-list">${d.packages.map((p) => row('delivery', p.key, esc(p.status === 'pickup' ? 'Pick up' : p.window || 'Today'), `${esc(p.name)}${p.from ? ` <span class="muted">· ${esc(p.from)}</span>` : ''}`)).join('')}</ul></div>` : ''
  ].filter(Boolean).join('');
  const date = new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  const canSpeak = !!localVoice();
  return `<section class="card rundown" aria-labelledby="rd-hello">
    <div class="rd-top"><span class="kicker">${esc(date)}${d.weather?.place ? ` · ${esc(d.weather.place)}` : ''}</span>
      <span class="actions">${canSpeak ? `<button class="btn btn--quiet btn--sm" type="button" data-rundown="speak">${speaking ? 'Stop reading' : 'Read aloud'}</button>` : ''}<button class="btn btn--quiet btn--sm" type="button" data-rundown="done">Done for today</button></span></div>
    <h2 class="rd-hello" id="rd-hello">${greeting()}</h2>
    <p class="rd-lead">${sentences.map(esc).join(' ')}</p>
    ${figs.length ? `<div class="rd-figs">${figs.join('')}</div>` : ''}
    ${warn || (notes && !w) ? `<div class="wx-notes">${warn}</div>` : ''}
    ${schedule || lists ? `<div class="rd-body${schedule && lists ? '' : ' one'}">${schedule}${lists ? `<div class="rd-col rd-side">${lists}</div>` : ''}</div>` : ''}
  </section>`;
}

// ---- reading it aloud: only a voice on this computer, so the words never leave it
// (a browser's online voices send the text to their maker).
let speaking = false;
function localVoice() {
  if (!('speechSynthesis' in window)) return null;
  const vs = speechSynthesis.getVoices().filter((v) => v.localService);
  const lang = (navigator.language || 'en').slice(0, 2);
  return vs.find((v) => v.default && v.lang.startsWith(lang)) || vs.find((v) => v.lang.startsWith(lang)) || null;
}
const redrawNow = () => { if (S && page === 'now') renderNow(); };
if ('speechSynthesis' in window) speechSynthesis.addEventListener?.('voiceschanged', redrawNow);

function rundownSpeech(d) {
  const parts = [greeting(), ...rundownSentences(d)];
  const w = d.weather?.now;
  if (w) parts.splice(1, 0, `It is ${Number(w.temp)} degrees and ${lower(String(w.text))}, with a high of ${Number(w.high)}.`);
  for (const a of d.weather?.alerts || []) parts.push(`Weather warning: ${a.event}.`);
  return parts.join(' ');
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-rundown]'); if (!b) return;
  const what = b.dataset.rundown;
  if (what === 'done') {
    localStorage.setItem(RUNDOWN_DONE, dayKey()); rundownAsked = false;
    if (speaking) speechSynthesis.cancel();
    redrawNow(); return;
  }
  if (what === 'open') { rundownAsked = true; redrawNow(); return; }
  if (what === 'speak') {
    if (speaking) { speechSynthesis.cancel(); speaking = false; redrawNow(); return; }
    const v = localVoice(); if (!v) return;
    const u = new SpeechSynthesisUtterance(rundownSpeech(rundownData()));
    u.voice = v; u.lang = v.lang;
    u.onend = u.onerror = () => { speaking = false; redrawNow(); };
    speaking = true; speechSynthesis.speak(u); redrawNow();
  }
});
