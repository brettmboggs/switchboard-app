// The Calendar page's events for any stretch of time (a month, a week): every
// calendar Switchboard has, expanded for the range asked for. A calendar link's
// text is kept five minutes and expanded per request; a calendar from an email
// account (CalDAV) is asked for the range itself and kept five minutes per range.
// The Now page's own two-week list is lib/calendar.js and does not depend on this.
import { calendars, expand, parseICS, fetchCalendar, fetchCaldav } from './calendar.js';
import { googleEvents } from './google.js';
import { friendlyError } from './friendly.js';

const TTL = 5 * 60e3, MAX_DAYS = 100;
const cache = new Map();   // key -> { at, value }

async function cached(key, make) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const value = await make();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 60) for (const [k, v] of cache) if (Date.now() - v.at >= TTL) cache.delete(k);
  return value;
}
export const forget = () => cache.clear();   // after a change is made, so the page shows it

// from and to are milliseconds. Returns { events, problems }: a calendar that
// would not open is a line in problems, never an error for the whole page.
export async function eventsBetween(from, to) {
  from = Number(from); to = Number(to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return { error: 'Give a start and an end.' };
  if (to - from > MAX_DAYS * 86400e3) return { error: `Ask for ${MAX_DAYS} days or fewer at a time.` };
  const events = [], problems = [];
  for (const c of calendars()) {
    try {
      let found;
      if (c.kind === 'google') found = await cached(`${c.id}|${from}|${to}`, () => googleEvents(c, from, to));
      else {
        const text = c.kind === 'caldav'
          ? await cached(`${c.id}|${from}|${to}`, () => fetchCaldav(c, from, to))
          : await cached(c.id, async () => (await fetchCalendar(c.url)).text);
        found = expand(parseICS(text), from, to);
      }
      for (const e of found) events.push({ ...e, calendar: c.id, calendarName: c.name, canWrite: c.kind === 'google' && c.canWrite !== false, space: c.space || 'personal', color: c.color || null });
    } catch (e) { problems.push({ calendar: c.name, error: friendlyError(e, 'the calendar') }); }
  }
  return { events: events.sort((a, b) => a.start - b.start), problems };
}
