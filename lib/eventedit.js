// Change a calendar event from one line, for Ctrl K and Jarvis:
//   move lunch with Sam to 1pm            same day, new time, same length
//   reschedule dentist to thu 2-3pm        new day and time (a range sets the end)
//   move the recital to friday             new day, same time
//   rename the dentist event to cleaning   new title
//   cancel lunch with Sam friday           deleted, only after a yes
// The event is found by its words among the next three months (a day in the
// line narrows it), on a calendar that can be edited (Google). Repeating events
// change one occurrence, as on the Calendar page.
import { parseWhen } from './capture.js';
import { pollCalendars } from './calendar.js';
import { eventsBetween, forget } from './calendarview.js';
import { calendars } from './calendar.js';
import { updateGoogleEvent, deleteGoogleEvent } from './google.js';
import { CLOCK, takeRange } from './eventline.js';

const H = 3600e3, D = 24 * H;
const DAY = /\b(?:today|tonight|tomorrow|tmrw|tmr|(?:next\s+)?(?:sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)[a-z]*|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?|in\s+\d+\s*d(?:ays?)?)\b/i;
const CAL_WORDS = /\b(?:event|meeting|appointment|appt|calendar)\b/i;
const STOP = new Set(['the', 'my', 'a', 'an', 'with', 'on', 'at', 'for', 'calendar', 'from', 'off', 'this', 'that']);
const SOFT = new Set(['event', 'meeting', 'appointment', 'appt']);   // count when a title has them, else ignored
const words = (s) => String(s || '').toLowerCase().replace(/['’]s\b/g, '').replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w && !STOP.has(w));
const looksWhen = (s) => DAY.test(s) || CLOCK.test(s) || !!takeRange(s);
const clean = (line) => String(line || '').trim().replace(/[.!?]+$/, '').replace(/^(?:hey |ok |okay )?jarvis,?\s*/i, '').replace(/^(?:please|can you|could you)\s+/i, '');
const sod = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

// What the line asks for, or null. sure: plainly about the calendar (it names an
// event or a day, or moves something to a time), so it is worth answering
// "no such event" rather than handing the line on.
export function parseEdit(line) {
  const s = clean(line);
  let m;
  if ((m = s.match(/^(?:move|reschedule|push|shift|change)\s+(.+?)\s+(?:to|until|till)\s+(.+)$/i))) {
    if (looksWhen(m[2])) return { act: 'move', what: m[1], when: m[2].trim(), sure: true };
    if (/^change/i.test(s)) return { act: 'rename', what: m[1], title: m[2].trim(), sure: CAL_WORDS.test(m[1]) };
    return null;
  }
  if ((m = s.match(/^rename\s+(.+?)\s+to\s+(.+)$/i))) return { act: 'rename', what: m[1], title: m[2].trim(), sure: CAL_WORDS.test(m[1]) };
  if ((m = s.match(/^(?:cancel|delete|remove)\s+(.+)$/i))) {
    const what = m[1].replace(/\s+(?:from|off|on)\s+(?:my|the)\s+(?:[\w'’ -]+\s+)?calendar$/i, '');
    return { act: 'delete', what, sure: CAL_WORDS.test(m[1]) || DAY.test(what) };
  }
  return null;
}

// The event meant: every word said is in its title, on the day said (if one
// was), the next one coming first.
export function findEvent(list, what, now = Date.now()) {
  let want = what, day = null;
  const dm = DAY.exec(what);
  if (dm) { const p = parseWhen(dm[0], new Date(now)); if (p) { day = sod(p.at); want = what.replace(dm[0], ' '); } }
  // A time said ("my 3pm meeting") picks by when it starts.
  let hm = null;
  const cm = CLOCK.exec(want);
  if (cm && !/^(tonight|in\s)/i.test(cm[0])) { const p = parseWhen(cm[0], new Date(sod(now))); if (p) { const d = new Date(p.at); hm = d.getHours() * 60 + d.getMinutes(); want = want.replace(cm[0], ' '); } }
  const all = words(want), plain = all.filter((w) => !SOFT.has(w));
  if (!plain.length && day == null && hm == null) return null;
  const match = (ws) => list.filter((e) => {
    const t = words(e.title), s = new Date(e.start);
    return ws.every((w) => t.some((x) => x === w || x.startsWith(w) || (w.length > 3 && w.startsWith(x)))) && (day == null || sod(e.start) === day) && (hm == null || (!e.allDay && s.getHours() * 60 + s.getMinutes() === hm));
  });
  let hits = match(all);
  if (!hits.length && plain.length < all.length) hits = match(plain);
  const later = hits.filter((e) => e.end > now).sort((a, b) => a.start - b.start);
  return later[0] || hits.sort((a, b) => b.start - a.start)[0] || null;
}

// The new start and end for "move … to <when>": a day keeps the time, a time
// keeps the day, a range sets both ends, and otherwise the length is kept.
export function newTimes(ev, when, now = new Date()) {
  const len = ev.allDay ? H : Math.max(ev.end - ev.start, 15 * 60e3);
  const range = takeRange(when);
  const text = range ? range.text : when;
  const hasDay = DAY.test(text), hasClock = !!range || CLOCK.test(text);
  if (!hasDay && !hasClock) return null;
  let start;
  if (hasDay) {
    const p = parseWhen(text, now); if (!p) return null;
    start = p.at;
    if (!hasClock) {
      if (ev.allDay) return { start: sod(start), end: sod(start) + Math.max(D, ev.end - ev.start), allDay: true };
      const was = new Date(ev.start), d = new Date(start); d.setHours(was.getHours(), was.getMinutes(), 0, 0); start = d.getTime();
    }
  } else {
    const p = parseWhen(text, new Date(sod(ev.start))); if (!p) return null;
    const d = new Date(sod(ev.start)), t = new Date(p.at); d.setHours(t.getHours(), t.getMinutes(), 0, 0); start = d.getTime();
  }
  let end = start + len;
  if (range) { const e = new Date(start); e.setHours(range.endH, range.endM, 0, 0); end = e.getTime() > start ? e.getTime() : e.getTime() + D; }
  return { start, end, allDay: false };
}

const say = (t, allDay) => (allDay ? new Date(t).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : new Date(t).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }));

// Reads the line and changes the event. Returns null when the line is not an
// edit (or not plainly about the calendar and no event matches); { error };
// { kind: 'confirm' } for a delete that waits for a yes; else what was done.
export async function editEventLine(line, { confirmed = false, now = Date.now() } = {}) {
  const ask = parseEdit(line);
  if (!ask) return null;
  const r = await eventsBetween(now - D, now + 90 * D);
  const ev = findEvent(r.events || [], ask.what, now);
  if (!ev) return ask.sure ? { error: `No event called "${ask.what.trim()}" in the next three months. Check its name on the Calendar page.` } : null;
  const c = calendars().find((x) => x.id === ev.calendar);
  if (!ev.canWrite || !c) return { error: `${ev.title} is on ${ev.calendarName}, which can only be read here. Add that calendar through Sign in with Google to change it.` };
  const base = { title: ev.title, location: ev.location || '', description: ev.description || '', start: ev.start, end: ev.end, allDay: !!ev.allDay };
  let done;
  if (ask.act === 'delete') {
    if (!confirmed) return { kind: 'confirm', act: 'delete', text: ev.title, start: ev.start, allDay: !!ev.allDay, calendarName: ev.calendarName, line, question: `Delete ${ev.title}, ${say(ev.start, ev.allDay)}, from ${ev.calendarName}?` };
    await deleteGoogleEvent(c, ev.uid);
    done = { act: 'delete', text: ev.title, start: ev.start, allDay: !!ev.allDay };
  } else if (ask.act === 'rename') {
    const title = ask.title.charAt(0).toUpperCase() + ask.title.slice(1);
    await updateGoogleEvent(c, ev.uid, { ...base, title });
    done = { act: 'rename', text: title, was: ev.title, start: ev.start, allDay: !!ev.allDay };
  } else {
    const t = newTimes(ev, ask.when, new Date(now));
    if (!t) return { error: `When to? Try "move ${ev.title.toLowerCase()} to 1pm" or "to thu 2-3pm".` };
    await updateGoogleEvent(c, ev.uid, { ...base, ...t });
    done = { act: 'move', text: ev.title, start: t.start, end: t.end, allDay: t.allDay, was: ev.start };
  }
  forget(); await pollCalendars().catch(() => {});   // read back before answering, so the board shows it
  return { kind: 'event-edit', ...done, calendarName: ev.calendarName, space: c.space || 'personal', say: done.act === 'delete' ? `Deleted ${done.text}, ${say(done.start, done.allDay)}.` : done.act === 'rename' ? `Renamed ${done.was} to ${done.text}.` : `Moved ${done.text} to ${say(done.start, done.allDay)}.` };
}
