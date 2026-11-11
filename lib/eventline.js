// One line in, one calendar event out, for Ctrl K and Jarvis ("lunch with Sam
// fri noon to my calendar", "meeting dentist tue 3-4pm", "schedule oil change
// tomorrow", "add Mia's recital to the family calendar 11/20 6pm"). The day and
// time are read the way the rest of the command bar reads them (lib/capture.js);
// a range ("3-4pm", "from 2 to 3:30") or a length ("for 90 min") sets the end,
// otherwise it is an hour; a day with no time is an all-day event. It goes on a
// Google calendar this account may write to: the one named in the line, else
// the account's own (primary) calendar, else the first that takes events.
import { parseWhen } from './capture.js';
import { calendars, pollCalendars } from './calendar.js';
import { forget } from './calendarview.js';
import { createGoogleEvent, googleAccount } from './google.js';

const H = 3600e3;
const LEAD = /^(?:new\s+)?(?:event|meeting|appointment|appt|schedule|calendar|cal)\b:?\s+(.+)$/i;
const ONTO = /\s*\b(?:to|on|in|onto|into)\s+(?:my|the)\s+(?:([\w'’ -]{1,40}?)\s+)?calendar\b\s*/i;
export const CLOCK = /\b(?:noon|midnight|\d{1,2}(?::\d{2})?\s*(?:am|pm|a|p)\b|\d{1,2}:\d{2}|tonight|in\s+\d+\s*(?:m|min|mins|minutes?|h|hr|hrs|hours?)\b)/i;

// "3-4pm", "from 2 to 3:30pm", "11am-1pm", "9:30-10": a start and end clock.
// Returns { text (with the range swapped for its start), endH, endM } or null.
export function takeRange(text) {
  const m = text.match(/\b(?:from\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?\s*(?:-|–|to|until|till)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?\b/i);
  if (!m || (!m[3] && !m[6] && !m[2] && !m[5])) return null;     // "2 to 3" with no am/pm or minutes is not a time
  const mer = (x) => (x ? x[0].toLowerCase() : null);
  let m2 = mer(m[6]), m1 = mer(m[3]) || m2;
  const h24 = (h, mr) => (mr ? (h % 12) + (mr === 'p' ? 12 : 0) : h);
  let s = h24(+m[1], m1), e = h24(+m[4], m2 || m1);
  if (!m[3] && m2 === 'p' && s > e) s -= 12;                         // "11-1pm" is 11am to 1pm
  if (e * 60 + +(m[5] || 0) <= s * 60 + +(m[2] || 0) && !m2) e += 12;   // "11:30-1" runs past noon
  const start = `${String(s).padStart(2, '0')}:${m[2] || '00'}`;
  return { text: text.replace(m[0], ` at ${start} `), endH: e, endM: +(m[5] || 0) };
}

// Reads the line. Returns null when it is not an event, { error } when it is but
// something is missing, else { title, start, end, allDay, calendarWord }.
export function parseEventLine(line, now = new Date()) {
  let s = String(line || '').trim().replace(/[.!]+$/, '');
  let calendarWord = null, isEvent = false, m;
  if (/^(?:note|todo|to do|task|remind|paid|invoiced?|bill|log|today)\b/i.test(s)) return null;   // the command bar's own words win
  if (/^(?:what|whats|what's|when|where|who|how|is|am|are|do|does|did|any|anything|show|list|tell|read|check|find|search)\b/i.test(s) || /\?\s*$/.test(s)) return null;   // a question about the calendar adds nothing
  if ((m = s.match(LEAD))) { s = /^(meeting|appointment|appt)\b/i.test(s) ? s : m[1]; isEvent = true; }
  if ((m = s.match(/^(?:add|put)\s+(.+)$/i)) && ONTO.test(m[1])) s = m[1];
  if ((m = s.match(ONTO))) { isEvent = true; calendarWord = m[1] && !/^(google|own)$/i.test(m[1].trim()) ? m[1].trim() : null; s = s.replace(m[0], ' '); }
  if (!isEvent) return null;
  const range = takeRange(s);
  if (range) s = range.text;
  let mins = null;
  s = s.replace(/\bfor\s+(\d+(?:\.\d+)?)\s*(m|min|mins|minutes?|h|hr|hrs|hours?)\b/i, (all, n, u) => { mins = +n * (/^h/i.test(u) ? 60 : 1); return ' '; });
  const hasClock = !!range || CLOCK.test(s);
  const w = parseWhen(s, now);
  if (!w) return { error: 'When is it? Try "lunch with Sam fri noon to my calendar" or "meeting dentist tue 3-4pm".' };
  let title = w.rest.replace(/^(?:to|for|a|an)\s+/i, '').replace(/\s+(?:on|at|from)$/i, '').trim();
  title = title.charAt(0).toUpperCase() + title.slice(1);
  if (!title) return { error: 'What is it called? Say it with the time, like "dentist tue 3pm".' };
  if (!hasClock) {
    const d = new Date(w.at); d.setHours(0, 0, 0, 0);
    return { title, start: d.getTime(), end: d.getTime() + 24 * H, allDay: true, calendarWord };
  }
  let end = w.at + (mins ? mins * 60e3 : H);
  if (range) { const e = new Date(w.at); e.setHours(range.endH, range.endM, 0, 0); end = e.getTime() > w.at ? e.getTime() : e.getTime() + 24 * H; }
  return { title, start: w.at, end, allDay: false, calendarWord };
}

// The calendar it goes on (writable Google calendars only).
export function pickCalendar(word, list = calendars(), me = googleAccount()?.email) {
  const ok = list.filter((c) => c.kind === 'google' && c.canWrite !== false);
  if (!ok.length) return null;
  const w = String(word || '').toLowerCase().replace(/['’]s$/, '').trim();
  return (w && ok.find((c) => c.name.toLowerCase().includes(w))) || ok.find((c) => c.calendarId === me) || ok[0];
}

// Reads the line and puts the event on the calendar. Returns null when the line
// is not an event; { error } when it cannot be added; else the event as added.
export async function addEventLine(line, now = new Date()) {
  const ev = parseEventLine(line, now);
  if (!ev || ev.error) return ev;
  const c = pickCalendar(ev.calendarWord);
  if (!c) return { error: 'No calendar here can take new events yet. Settings, Connections, Google Calendar: sign in and add your calendars, then try again.', needsCalendar: true };
  const made = await createGoogleEvent(c, { title: ev.title, start: ev.start, end: ev.end, allDay: ev.allDay, location: '', description: '' });
  forget(); await pollCalendars().catch(() => {});   // read back before answering, so the board shows it
  return { kind: 'event', text: ev.title, start: ev.start, end: ev.end, allDay: ev.allDay, calendar: c.id, calendarName: c.name, id: made?.uid || null, space: c.space || 'personal' };
}
