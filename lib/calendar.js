// Calendars from private calendar links (iCal / ICS): Google, Outlook, iCloud,
// Fastmail, Proton, and any school, team or club calendar. Read only. Every ten
// minutes each link is fetched and its events for the next two weeks are worked
// out, repeating events and time zones included, so Now can show today.
import { getSetting, setSetting } from './db.js';
import { alert } from './notify.js';

export const calendars = () => getSetting('calendars', []);   // [{ id, name, url, space, color }]
export const saveCalendars = (list) => setSetting('calendars', list);

// ---------------------------------------------------------------------------
// Reading ICS
const unfold = (text) => String(text).replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
const unescape = (v) => String(v || '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim();

// A feed is read up to this size and a line up to this length; a calendar link
// is outside input, and the parser has to stay quick on a hostile one.
export const MAX_FEED = 2 * 1024 * 1024, MAX_LINE = 4096;

function prop(line) {
  // NAME;PARAM=a;PARAM2="b":value — the first colon outside quotes, in one pass.
  let colon = -1, quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === ':' && !quoted) { colon = i; break; }
  }
  if (colon < 0) return null;
  const [name, ...params] = line.slice(0, colon).split(';');
  const p = {};
  for (const kv of params) { const i = kv.indexOf('='); if (i > 0) p[kv.slice(0, i).toUpperCase()] = kv.slice(i + 1).replace(/^"|"$/g, ''); }
  return { name: name.toUpperCase(), params: p, value: line.slice(colon + 1) };
}

// Windows time zone names (Outlook and Exchange) to the IANA names Intl knows.
const WINDOWS_TZ = {
  'Eastern Standard Time': 'America/New_York', 'Central Standard Time': 'America/Chicago', 'Mountain Standard Time': 'America/Denver',
  'US Mountain Standard Time': 'America/Phoenix', 'Pacific Standard Time': 'America/Los_Angeles', 'Alaskan Standard Time': 'America/Anchorage',
  'Hawaiian Standard Time': 'Pacific/Honolulu', 'Atlantic Standard Time': 'America/Halifax', 'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik', 'W. Europe Standard Time': 'Europe/Berlin', 'Central Europe Standard Time': 'Europe/Budapest',
  'Romance Standard Time': 'Europe/Paris', 'Central European Standard Time': 'Europe/Warsaw', 'E. Europe Standard Time': 'Europe/Chisinau',
  'FLE Standard Time': 'Europe/Kiev', 'GTB Standard Time': 'Europe/Bucharest', 'Russian Standard Time': 'Europe/Moscow', 'India Standard Time': 'Asia/Kolkata',
  'China Standard Time': 'Asia/Shanghai', 'Tokyo Standard Time': 'Asia/Tokyo', 'Korea Standard Time': 'Asia/Seoul', 'AUS Eastern Standard Time': 'Australia/Sydney',
  'E. Australia Standard Time': 'Australia/Brisbane', 'Cen. Australia Standard Time': 'Australia/Adelaide', 'W. Australia Standard Time': 'Australia/Perth',
  'New Zealand Standard Time': 'Pacific/Auckland', 'SA Pacific Standard Time': 'America/Bogota', 'Central America Standard Time': 'America/Guatemala',
  'Mexico Standard Time': 'America/Mexico_City', 'Central Standard Time (Mexico)': 'America/Mexico_City', 'Canada Central Standard Time': 'America/Regina',
  'E. South America Standard Time': 'America/Sao_Paulo', 'Arabian Standard Time': 'Asia/Dubai', 'Israel Standard Time': 'Asia/Jerusalem',
  'South Africa Standard Time': 'Africa/Johannesburg', 'Singapore Standard Time': 'Asia/Singapore', 'UTC': 'UTC', 'Coordinated Universal Time': 'UTC'
};
export function ianaZone(tzid) {
  if (!tzid) return null;
  const t = tzid.replace(/^\/.*?\/(?=[A-Z])/, '').trim();    // "/mozilla.org/.../America/Chicago"
  const name = WINDOWS_TZ[t] || t;
  try { new Intl.DateTimeFormat('en-US', { timeZone: name }); return name; } catch { return null; }
}

// Wall-clock time in a zone, to a UTC timestamp.
export function zonedToUtc(y, mo, d, h, mi, s, zone) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  if (!zone || zone === 'UTC') return guess;
  const offset = (t) => {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const p = Object.fromEntries(f.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - t;
  };
  let t = guess - offset(guess);
  t = guess - offset(t);   // second pass settles daylight-saving edges
  return t;
}

// A DTSTART-style value: { t (UTC ms), allDay, zone, parts } where parts keep
// the wall-clock fields so repeats land at the same local time across DST.
export function parseDate(value, params = {}) {
  const v = String(value || '').trim();
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (h === undefined || params.VALUE === 'DATE') {
    // A day, not a moment: midnight here, so it lands on the right date on this computer.
    return { t: new Date(+y, +mo - 1, +d).getTime(), allDay: true, zone: null, parts: [+y, +mo, +d, 0, 0, 0] };
  }
  const zone = z ? 'UTC' : ianaZone(params.TZID) || null;   // floating time: this computer's zone
  const parts = [+y, +mo, +d, +h, +mi, +(s || 0)];
  const t = zone ? zonedToUtc(...parts, zone) : new Date(+y, +mo - 1, +d, +h, +mi, +(s || 0)).getTime();
  return { t, allDay: false, zone, parts };
}

export function parseICS(text) {
  const events = [];
  let cur = null, depth = 0;
  for (const raw of unfold(text).split('\n')) {
    const line = (raw.length > MAX_LINE ? raw.slice(0, MAX_LINE) : raw).trimEnd();
    if (!line) continue;
    if (line === 'BEGIN:VEVENT') { cur = { exdates: [] }; depth = 0; continue; }
    if (!cur) continue;
    if (line.startsWith('BEGIN:')) { depth++; continue; }          // VALARM inside an event
    if (line.startsWith('END:') && depth) { depth--; continue; }
    if (line === 'END:VEVENT') { if (cur.start && cur.uid !== undefined) events.push(cur); cur = null; continue; }
    if (depth) continue;
    const p = prop(line);
    if (!p) continue;
    if (p.name === 'UID') cur.uid = p.value;
    else if (p.name === 'SUMMARY') cur.summary = unescape(p.value);
    else if (p.name === 'LOCATION') cur.location = unescape(p.value);
    else if (p.name === 'DESCRIPTION') cur.description = unescape(p.value).slice(0, 2000);
    else if (p.name === 'STATUS') cur.status = p.value.toUpperCase();
    else if (p.name === 'DTSTART') cur.start = parseDate(p.value, p.params);
    else if (p.name === 'DTEND') cur.end = parseDate(p.value, p.params);
    else if (p.name === 'DURATION') cur.duration = p.value;
    else if (p.name === 'RRULE') cur.rrule = Object.fromEntries(p.value.split(';').map((kv) => kv.split('=')).map(([k, v]) => [k.toUpperCase(), v]));
    else if (p.name === 'EXDATE') for (const v of p.value.split(',')) { const d = parseDate(v, p.params); if (d) cur.exdates.push(d.t); }
    else if (p.name === 'RECURRENCE-ID') cur.recurrenceId = parseDate(p.value, p.params)?.t;
  }
  for (const e of events) {
    if (e.uid === undefined) e.uid = '';
    if (!e.end) e.end = e.duration ? { ...e.start, t: e.start.t + durationMs(e.duration) } : { ...e.start, t: e.start.t + (e.start.allDay ? 86400e3 : 0) };
  }
  return events;
}

export function durationMs(d) {
  const m = String(d).match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return 0;
  const [, sign, w, dd, h, mi, s] = m;
  const ms = (((+w || 0) * 7 + (+dd || 0)) * 86400 + (+h || 0) * 3600 + (+mi || 0) * 60 + (+s || 0)) * 1000;
  return sign === '-' ? -ms : ms;
}

// ---------------------------------------------------------------------------
// Repeating events: DAILY, WEEKLY, MONTHLY, YEARLY with INTERVAL, COUNT, UNTIL,
// BYDAY (incl. "2TU", "-1FR"), BYMONTHDAY and BYMONTH. Wall-clock based, so a
// 9:00 meeting stays at 9:00 through daylight saving.
const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const atLocal = (start, y, mo, d) => {
  const [, , , h, mi, s] = start.parts;
  if (start.allDay) return new Date(y, mo - 1, d).getTime();
  return start.zone ? zonedToUtc(y, mo, d, h, mi, s, start.zone) : new Date(y, mo - 1, d, h, mi, s).getTime();
};
const daysIn = (y, mo) => new Date(Date.UTC(y, mo, 0)).getUTCDate();
const weekday = (y, mo, d) => new Date(Date.UTC(y, mo - 1, d)).getUTCDay();

function candidatesInPeriod(rule, start, y, mo, weekStartDay) {
  // Days (y, mo, d) inside the period that the BY rules allow.
  const freq = rule.FREQ;
  const byday = rule.BYDAY ? rule.BYDAY.split(',').map((x) => { const m = x.match(/^([+-]?\d+)?([A-Z]{2})$/); return m ? { n: m[1] ? +m[1] : 0, day: DAYS.indexOf(m[2]) } : null; }).filter(Boolean) : null;
  const bymd = rule.BYMONTHDAY ? rule.BYMONTHDAY.split(',').map(Number) : null;
  const bymonth = rule.BYMONTH ? rule.BYMONTH.split(',').map(Number) : null;
  const [, sMo, sD] = start.parts;
  const out = [];
  const monthDays = (yy, mm) => {
    const n = daysIn(yy, mm);
    let days = [];
    if (bymd) days = bymd.map((x) => (x < 0 ? n + 1 + x : x)).filter((x) => x >= 1 && x <= n);
    else if (byday) {
      for (const b of byday) {
        const all = []; for (let d = 1; d <= n; d++) if (weekday(yy, mm, d) === b.day) all.push(d);
        if (!b.n) days.push(...all); else { const pick = b.n > 0 ? all[b.n - 1] : all[all.length + b.n]; if (pick) days.push(pick); }
      }
    } else days = [Math.min(sD, n) === sD ? sD : null].filter(Boolean);
    return [...new Set(days)].sort((a, b) => a - b);
  };
  if (freq === 'DAILY') {
    out.push([y, mo, weekStartDay]);
  } else if (freq === 'WEEKLY') {
    // weekStartDay is the date (in this month or rolling) of the week's first day.
    const base = Date.UTC(y, mo - 1, weekStartDay);
    const want = byday ? byday.map((b) => b.day) : [weekday(...start.parts.slice(0, 3))];
    for (let i = 0; i < 7; i++) {
      const dt = new Date(base + i * 86400e3);
      if (want.includes(dt.getUTCDay())) out.push([dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()]);
    }
  } else if (freq === 'MONTHLY') {
    for (const d of monthDays(y, mo)) out.push([y, mo, d]);
  } else if (freq === 'YEARLY') {
    const months = bymonth || [sMo];
    for (const mm of months) {
      const days = bymd || byday ? monthDays(y, mm) : [sD <= daysIn(y, mm) ? sD : null].filter(Boolean);
      for (const d of days) out.push([y, mm, d]);
    }
  }
  return out.filter(([yy, mm]) => !bymonth || freq === 'YEARLY' || bymonth.includes(mm));
}

export function occurrences(ev, from, to) {
  const len = ev.end.t - ev.start.t;
  if (!ev.rrule) return ev.start.t < to && ev.start.t + Math.max(len, 1) > from ? [ev.start.t] : [];
  const rule = ev.rrule;
  const interval = Math.max(1, +rule.INTERVAL || 1);
  const until = rule.UNTIL ? parseDate(rule.UNTIL, { TZID: ev.start.zone })?.t ?? Infinity : Infinity;
  const count = rule.COUNT ? +rule.COUNT : Infinity;
  const ex = new Set(ev.exdates || []);
  const out = [];
  let n = 0;
  const [sy, sm, sd] = ev.start.parts;
  // Walk period by period (day, week, month or year), at most a few thousand steps.
  for (let step = 0; step < 5000; step++) {
    let cands;
    if (rule.FREQ === 'DAILY') { const dt = new Date(Date.UTC(sy, sm - 1, sd) + step * interval * 86400e3); cands = [[dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()]]; }
    else if (rule.FREQ === 'WEEKLY') {
      const wkst = DAYS.indexOf(rule.WKST || 'MO');
      const startDay = Date.UTC(sy, sm - 1, sd);
      const back = (new Date(startDay).getUTCDay() - wkst + 7) % 7;
      const ws = new Date(startDay - back * 86400e3 + step * interval * 7 * 86400e3);
      cands = candidatesInPeriod(rule, ev.start, ws.getUTCFullYear(), ws.getUTCMonth() + 1, ws.getUTCDate());
    } else if (rule.FREQ === 'MONTHLY') { const mm = sm - 1 + step * interval; cands = candidatesInPeriod(rule, ev.start, sy + Math.floor(mm / 12), (mm % 12) + 1); }
    else if (rule.FREQ === 'YEARLY') cands = candidatesInPeriod(rule, ev.start, sy + step * interval, 1);
    else break;
    let past = false;
    for (const [y, mo, d] of cands) {
      const t = atLocal(ev.start, y, mo, d);
      if (t < ev.start.t) continue;
      if (t > until || n >= count) { past = true; break; }
      n++;
      if (t >= to) { past = true; break; }
      if (!ex.has(t) && t + Math.max(len, 1) > from) out.push(t);
    }
    if (past) break;
  }
  return out;
}

// All event instances between from and to, with moved or cancelled repeats applied.
export function expand(events, from, to) {
  const moved = new Map();   // uid -> Map(original start -> override event)
  for (const e of events) if (e.recurrenceId) { if (!moved.has(e.uid)) moved.set(e.uid, new Map()); moved.get(e.uid).set(e.recurrenceId, e); }
  const out = [];
  for (const e of events) {
    if (e.recurrenceId) continue;
    const len = e.end.t - e.start.t;
    const over = moved.get(e.uid);
    for (const t of occurrences(e, from, to)) {
      if (over?.has(t)) continue;   // the moved copy is added below
      if (e.status === 'CANCELLED') continue;
      out.push({ uid: e.uid, title: e.summary || '(no title)', location: e.location || '', start: t, end: t + len, allDay: e.start.allDay });
    }
  }
  for (const [, m] of moved) for (const [, e] of m) {
    if (e.status === 'CANCELLED') continue;
    if (e.start.t < to && e.end.t > from) out.push({ uid: e.uid, title: e.summary || '(no title)', location: e.location || '', start: e.start.t, end: e.end.t, allDay: e.start.allDay });
  }
  return out.sort((a, b) => a.start - b.start);
}

// ---------------------------------------------------------------------------
// Polling and the board
const status = new Map();   // id -> { at, ok, error, count }
let upcoming = [];          // the next 14 days across all calendars
export const calendarStatus = () => calendars().map((c) => ({ id: c.id, name: c.name, space: c.space, ...(status.get(c.id) || {}) }));
export const events = () => upcoming;

// webcal:// is just https:// by another name.
export const feedUrl = (url) => String(url || '').trim().replace(/^webcals?:\/\//i, 'https://');

export async function fetchCalendar(url) {
  const r = await fetch(feedUrl(url), { headers: { 'User-Agent': 'Switchboard calendar', Accept: 'text/calendar, */*' }, signal: AbortSignal.timeout(20000), redirect: 'follow' });
  if (r.status === 401 || r.status === 403 || r.status === 404) throw new Error('That link did not open a calendar. It may be private or out of date: copy it again.');
  if (!r.ok) throw new Error(`The calendar did not answer (${r.status}).`);
  const text = await readCapped(r, MAX_FEED);
  if (!/BEGIN:VCALENDAR/.test(text)) throw new Error('That link is a web page, not a calendar. Use the iCal or ICS address.');
  return { text, name: unescape((unfold(text).match(/^X-WR-CALNAME:(.*)$/m) || [])[1] || '') };
}

// The body as text, or an error once it passes max bytes (the download stops there).
export async function readCapped(r, max) {
  if (Number(r.headers.get('content-length')) > max) { await r.body?.cancel().catch(() => {}); throw new Error('That calendar is too big to read (over 2 MB).'); }
  if (!r.body) return '';
  const chunks = []; let size = 0;
  for await (const chunk of r.body) {
    size += chunk.length;
    if (size > max) throw new Error('That calendar is too big to read (over 2 MB).');   // leaving the loop cancels the download
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

let busy = false;
export async function pollCalendars() {
  if (busy) return false;
  busy = true;
  const from = Date.now() - 12 * 3600e3, to = Date.now() + 14 * 86400e3;
  const all = [];
  try {
    for (const c of calendars()) {
      try {
        const { text } = await fetchCalendar(c.url);
        const list = expand(parseICS(text), from, to).map((e) => ({ ...e, calendar: c.id, calendarName: c.name, space: c.space || 'personal', color: c.color || null }));
        all.push(...list);
        status.set(c.id, { at: Date.now(), ok: true, error: null, count: list.length });
      } catch (e) {
        status.set(c.id, { at: Date.now(), ok: false, error: String(e.message || e).slice(0, 200) });
        all.push(...upcoming.filter((x) => x.calendar === c.id));   // keep the last good copy
      }
    }
    const before = JSON.stringify(upcoming);
    upcoming = all.sort((a, b) => a.start - b.start);
    return JSON.stringify(upcoming) !== before;
  } finally { busy = false; }
}

// "Starts in 10 minutes", once per event.
const told = new Set();
export function tickEvents() {
  const now = Date.now();
  for (const e of upcoming) {
    if (e.allDay) continue;
    const key = e.uid + e.start;
    if (e.start - now <= 10 * 60e3 && e.start > now && !told.has(key)) {
      told.add(key);
      const mins = Math.max(1, Math.round((e.start - now) / 60e3));
      alert('events', e.title, `In ${mins} minute${mins === 1 ? '' : 's'}${e.location ? ' · ' + e.location.split('\n')[0] : ''}`);
    }
  }
}
