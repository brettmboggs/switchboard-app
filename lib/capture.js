// The command bar. One line in, one item out.
//   remind fri 9am call the bank       a reminder that pops at that time
//   todo send the proposal by thu      a to-do, optionally with a date
//   paid Acme 1500 check               money in, logged
//   invoice Acme 1500 due fri          money owed to you, waiting on them
//   bill Google Workspace 14 monthly on 6   a recurring bill
//   today fed the goats                a timed line on today's page (lib/pages.js)
//   anything else                      a note
// "@work" (any space id or name) anywhere puts it in that space.
import { db } from './db.js';
import { parseRoutine, addRoutine } from './routines.js';
import { findListPage, addToList, addLog, addToday } from './pages.js';
import { spaces, spaceFor } from './spaces.js';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// Finds a time expression in the text. Returns { at, rest } or null.
export function parseWhen(text, now = new Date()) {
  let s = ' ' + text + ' ';
  let date = null, timeSet = false;
  const take = (re, fn) => {
    const m = s.match(re);
    if (!m) return false;
    fn(m);
    s = s.replace(m[0], ' ');
    return true;
  };

  take(/\s(?:in\s+)(\d+)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)\b/i, (m) => {
    const n = +m[1], u = m[2][0].toLowerCase();
    date = new Date(now.getTime() + n * (u === 'm' ? 60e3 : u === 'h' ? 3600e3 : 86400e3));
    timeSet = u !== 'd';
  });
  if (!date) take(/\s(today|tonight)\b/i, (m) => { date = new Date(now); if (m[1].toLowerCase() === 'tonight') { date.setHours(20, 0, 0, 0); timeSet = true; } });
  if (!date) take(/\s(tomorrow|tmrw|tmr)\b/i, () => { date = new Date(now); date.setDate(date.getDate() + 1); });
  if (!date) take(/\s(?:next\s+|on\s+)?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)[a-z]*\b/i, (m) => {
    const want = DAYS.indexOf(m[1].slice(0, 3).toLowerCase());
    date = new Date(now);
    let add = (want - date.getDay() + 7) % 7;
    if (add === 0) add = 7;
    date.setDate(date.getDate() + add);
  });
  if (!date) take(/\s(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/, (m) => {
    date = new Date(now.getFullYear(), +m[1] - 1, +m[2]);
    if (m[3]) date.setFullYear(m[3].length === 2 ? 2000 + +m[3] : +m[3]);
    else if (date < startOfDay(now)) date.setFullYear(date.getFullYear() + 1);
  });
  if (!date) take(/\s(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/i, (m) => {
    date = new Date(now.getFullYear(), MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()), +m[2]);
    if (date < startOfDay(now)) date.setFullYear(date.getFullYear() + 1);
  });

  // A clock time: 9am, 9:30, 14:00, 3pm, noon. Bare numbers are not times.
  take(/\s(?:at\s+)?(noon|midnight|(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)\b|(\d{1,2}):(\d{2}))/i, (m) => {
    let h, min = 0;
    if (/noon/i.test(m[1])) h = 12; else if (/midnight/i.test(m[1])) h = 0;
    else if (m[2]) { h = +m[2] % 12; min = +(m[3] || 0); if (/p/i.test(m[4])) h += 12; }
    else { h = +m[5]; min = +m[6]; }
    if (!date) { date = new Date(now); date.setHours(h, min, 0, 0); if (date <= now) date.setDate(date.getDate() + 1); }
    else date.setHours(h, min, 0, 0);
    timeSet = true;
  });

  if (!date) return null;
  if (!timeSet) date.setHours(9, 0, 0, 0);   // a day with no time means 9am
  return { at: date.getTime(), rest: s.replace(/\s+(by|on|at)\s*$/i, ' ').replace(/^\s*(by|on|at)\s+/i, ' ').replace(/\s+/g, ' ').trim() };
}

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

function pickSpace(text, fallback) {
  const list = spaces();
  let space = fallback;
  const rest = text.replace(/(^|\s)@([\w.-]+)/g, (all, pre, tag) => {
    const t = tag.toLowerCase();
    const hit = list.find((s) => s.id === t || s.name.toLowerCase().replace(/\s+/g, '') === t || s.name.toLowerCase().startsWith(t));
    if (hit) { space = hit.id; return pre; }
    return all;
  });
  return { space, rest: rest.trim() };
}

export function capture(line, currentSpace) {
  const raw = (line || '').trim();
  if (!raw) return null;
  const fallback = currentSpace && currentSpace !== 'all' ? currentSpace : 'personal';
  let { space, rest } = pickSpace(raw, null);
  if (!space) space = (currentSpace && currentSpace !== 'all') ? currentSpace : (spaceFor(rest) || fallback);
  const now = Date.now();
  const add = (kind, text, extra = {}) => {
    const r = db.prepare('INSERT INTO items (kind, text, space, due_at, amount, cadence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(kind, text, space, extra.due_at ?? null, extra.amount ?? null, extra.cadence ?? null, now);
    return { id: Number(r.lastInsertRowid), kind, text, space, ...extra };
  };

  let m;
  // "today fed the goats" or "today: call back at 3": a timed line on the day's page in this project.
  if ((m = rest.match(/^today:?\s+(.+)$/i))) {
    const p = addToday(m[1], space, now);
    if (p) return { kind: 'today', text: p.title, uid: p.uid, space: p.space };
  }
  // "log eggs 14", "log miles 42 to the feed store": an entry in that log page, with its totals.
  if ((m = rest.match(/^log\s+([a-z][\w' -]{0,40}?)\s+(-?\$?[\d,]*\.?\d+)\b\s*(.*)$/i))) {
    const p = addLog(m[1], m[2], m[3], space, now);
    return { kind: 'log', text: p.title, uid: p.uid, space: p.space, amount: m[2] };
  }
  // "shopping eggs, milk" or "add eggs to shopping": onto that list page.
  if ((m = rest.match(/^add\s+(.+?)\s+to\s+(?:my\s+|the\s+)?(.+?)(?:\s+list)?$/i)) || (m = rest.match(/^(\S+(?:\s+list)?)\s+(.+)$/i))) {
    const [words, what] = /^add\s/i.test(rest) ? [m[2], m[1]] : [m[1], m[2]];
    const page = findListPage(words, space);
    if (page) {
      const r = addToList(page.uid, what.split(/\s*,\s*|\s+and\s+/i));
      if (r) return { kind: 'list', text: page.title, uid: page.uid, space: page.space, count: r.count };
    }
  }
  // Something that comes back ("feed the animals every day at 6am", "filter every 90 days"):
  // a routine. Money and plain notes keep their own words.
  if (!/^(paid|invoiced?|bill|note)\s/i.test(rest) && parseRoutine(rest)) return addRoutine(rest, space, now);
  if ((m = rest.match(/^remind(?:\s+me)?\s+(.+)$/i))) {
    const w = parseWhen(m[1]);
    if (!w) return { error: 'When? Try "remind fri 9am call the bank" or "remind in 2h check the deploy".' };
    return add('reminder', w.rest.replace(/^(to|that)\s+/i, '') || 'Reminder', { due_at: w.at });
  }
  if ((m = rest.match(/^(?:todo|to do|task)\s+(.+)$/i))) {
    const w = parseWhen(m[1]);
    return add('todo', (w ? w.rest : m[1]).trim(), { due_at: w?.at ?? null });
  }
  if ((m = rest.match(/^paid\s+(.+?)\s+\$?([\d,]+(?:\.\d{1,2})?)\b(.*)$/i))) {
    const amount = parseFloat(m[2].replace(/,/g, ''));
    return add('paid', `${m[1].trim()} paid${m[3] ? ' · ' + m[3].trim() : ''}`, { amount });
  }
  if ((m = rest.match(/^invoice(?:d)?\s+(.+?)\s+\$?([\d,]+(?:\.\d{1,2})?)\b(.*)$/i))) {
    const amount = parseFloat(m[2].replace(/,/g, ''));
    const w = m[3].trim() ? parseWhen(m[3]) : null;
    const note = (w ? w.rest : m[3]).replace(/^(due|by)\s*/i, '').trim();
    return add('invoice', `${m[1].trim()}${note ? ' · ' + note : ''}`, { amount, due_at: w?.at ?? null });
  }
  if ((m = rest.match(/^bill\s+(.+?)\s+\$?([\d,]+(?:\.\d{1,2})?)\s*(weekly|monthly|yearly|annually|annual)?(?:\s+(?:on\s+(?:the\s+)?)?(.+))?$/i))) {
    const amount = parseFloat(m[2].replace(/,/g, ''));
    const cadence = (m[3] || 'monthly').toLowerCase().replace(/annual(ly)?/, 'yearly');
    let due = null;
    if (m[4]) {
      const day = m[4].match(/^(\d{1,2})(st|nd|rd|th)?$/);
      if (day) {
        const d = new Date(); d.setHours(9, 0, 0, 0);
        d.setDate(+day[1]);
        if (d.getTime() < startOfDay(new Date()).getTime()) d.setMonth(d.getMonth() + 1);
        due = d.getTime();
      } else {
        due = parseWhen(m[4])?.at ?? null;
      }
    }
    return add('bill', m[1].trim(), { amount, cadence, due_at: due });
  }
  if ((m = rest.match(/^note\s+(.+)$/i))) rest = m[1];
  return add('note', rest);
}

// Next date a bill is due, rolling forward by its cadence.
export function nextDue(bill, now = Date.now()) {
  if (!bill.due_at) return null;
  const d = new Date(bill.due_at);
  let guard = 0;
  while (d.getTime() < startOfDay(new Date(now)).getTime() && guard++ < 600) {
    if (bill.cadence === 'weekly') d.setDate(d.getDate() + 7);
    else if (bill.cadence === 'yearly') d.setFullYear(d.getFullYear() + 1);
    else d.setMonth(d.getMonth() + 1);
  }
  return d.getTime();
}
