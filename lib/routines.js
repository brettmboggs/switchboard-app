// Chores and routines: things that come back on their own. "Feed the animals
// every day at 6am and 6pm", "change the furnace filter every 90 days", "trash
// every tue at 7pm". Each is an item of kind 'routine' (so it syncs like the
// rest): due_at is when it is next due, cadence holds its schedule as JSON,
// done_at stays empty (a routine is never finished) and notified_at says the
// current one was announced. Done moves it to the next time; Skip too, without
// counting; "every N days" counts from when it was last done.
//
// A schedule (rule):
//   { kind: 'daily', at: ['06:00', '18:00'] }
//   { kind: 'weekly', days: [2], at: ['19:00'] }           days: 0 = Sunday
//   { kind: 'monthly', day: 1, at: ['09:00'] }             day past the month's end: its last day
//   { kind: 'yearly', month: 3, day: 15, at: ['09:00'] }   month: 1 = January
//   { kind: 'every', n: 90, unit: 'day', at: ['09:00'] }   unit: day | week | month, from when last done
import { db, onLocalChange } from './db.js';

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAY_WORD = '(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|sday|urday|rsday)?s?';

// ---- times: "at 6am and 6pm", "6:30pm", "noon", "in the morning". A bare hour: 1 to 5 is afternoon, 6 to 11 morning.
const pad = (n) => String(n).padStart(2, '0');
function readTimes(s) {
  const at = [];
  let rest = s;
  const one = /\b(?:at\s+|@\s*)?(noon|midnight|(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.|a|p)\b|at\s+(\d{1,2})(?::(\d{2}))?\b)/i;
  for (let guard = 0; guard < 6; guard++) {
    const m = rest.match(one);
    if (!m) break;
    let h, min = 0;
    if (/noon/i.test(m[1])) h = 12; else if (/midnight/i.test(m[1])) h = 0;
    else if (m[2]) { h = +m[2] % 12; min = +(m[3] || 0); if (/^p/i.test(m[4])) h += 12; }
    else { h = +m[5]; min = +(m[6] || 0); if (h >= 1 && h <= 5) h += 12; }
    if (h < 24 && min < 60) at.push(`${pad(h)}:${pad(min)}`);
    rest = rest.replace(m[0], ' ');
  }
  // "and 6pm" after "at 6am": the loop already took it. Words for parts of the day:
  const words = { morning: '07:00', noon: '12:00', afternoon: '15:00', evening: '18:00', night: '21:00', bedtime: '21:00' };
  rest = rest.replace(/\b(?:in the |every |each )?(morning|afternoon|evening|night|bedtime)s?\b/gi, (all, w) => { at.push(words[w.toLowerCase()]); return ' '; });
  return { at: [...new Set(at)].sort(), rest };
}
const dayIndex = (w) => DAY_NAMES.indexOf(w.slice(0, 3).toLowerCase());

// One line in, { text, rule } out; null when it is not a routine.
export function parseRoutine(line, now = new Date()) {
  let s = ' ' + String(line || '').trim() + ' ';
  let rule = null;
  const take = (re, fn) => { if (rule) return; const m = s.match(re); if (!m) return; rule = fn(m); if (rule) s = s.replace(m[0], ' '); };
  // Before "every month" below, which would take only the end of it.
  take(/\s(?:on\s+)?the\s+(\d{1,2})(?:st|nd|rd|th)\s+of\s+(?:every|each)\s+month\b/i, (m) => ({ kind: 'monthly', day: Math.min(31, +m[1]) }));
  take(/\s(?:every\s+(other|\d+)\s+(day|week|month|year)s?|every\s+(day|week|month|year)|(daily|weekly|monthly|yearly|annually|nightly))\b(?:\s+on\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?|\s+on\s+(?:the\s+)?(last)\s+day|\s+on\s+((?:\s*(?:,|and|&)?\s*\b(?:sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)[a-z]*)+))?/i, (m) => {
    const n = m[1] ? (m[1].toLowerCase() === 'other' ? 2 : +m[1]) : 1;
    const unit = (m[2] || m[3] || ({ daily: 'day', nightly: 'day', weekly: 'week', monthly: 'month', yearly: 'year', annually: 'year' })[(m[4] || '').toLowerCase()]).toLowerCase();
    if (!n || n > 400) return null;
    const onDays = m[7] ? [...m[7].matchAll(new RegExp(DAY_WORD, 'gi'))].map((d) => dayIndex(d[1])).filter((d) => d >= 0) : null;
    if (n > 1) return { kind: 'every', n, unit: unit === 'year' ? 'month' : unit, ...(unit === 'year' ? { n: n * 12 } : {}) };
    if (unit === 'day') return { kind: 'daily', ...(/^nightly$/i.test(m[4] || '') ? { night: true } : {}) };
    if (unit === 'week') return { kind: 'weekly', days: onDays?.length ? [...new Set(onDays)].sort() : [now.getDay()] };
    if (unit === 'month') return { kind: 'monthly', day: m[6] ? 31 : m[5] ? Math.min(31, Math.max(1, +m[5])) : now.getDate() };
    return { kind: 'yearly', month: now.getMonth() + 1, day: now.getDate() };
  });
  take(/\severy\s+(weekday|weekend)s?\b/i, (m) => ({ kind: 'weekly', days: /weekday/i.test(m[1]) ? [1, 2, 3, 4, 5] : [0, 6] }));
  take(new RegExp(`\\s(?:every|each|on)\\s+(${DAY_WORD}(?:\\s*(?:,|and|&)\\s*${DAY_WORD})*)\\b`, 'i'), (m) => {
    if (/^on\s/i.test(m[0].trim()) && !/s\b/i.test(m[1])) return null;   // "on tuesday" alone is one day, not a routine; "on tuesdays" is
    const days = [...m[1].matchAll(new RegExp(DAY_WORD, 'gi'))].map((d) => dayIndex(d[1])).filter((d) => d >= 0);
    return days.length ? { kind: 'weekly', days: [...new Set(days)].sort() } : null;
  });
  take(/\severy\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/i, (m) => ({ kind: 'yearly', month: MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, day: +m[2] }));
  if (!rule) return null;
  // A yearly or monthly one may still say which day ("yearly on mar 15").
  if (rule.kind === 'yearly') {
    const m = s.match(/\s(?:on\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/i);
    if (m) { rule.month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1; rule.day = +m[2]; s = s.replace(m[0], ' '); }
  }
  const t = readTimes(s);
  s = t.rest;
  rule.at = t.at.length ? t.at : [rule.night ? '21:00' : '09:00'];
  delete rule.night;
  const text = s.replace(/^\s*(routine|chore|remind(?: me)?(?: to)?|todo|to do|task)\b\s*:?/i, ' ').replace(/\s+(at|on|in|and|by)\s*$/i, ' ').replace(/\s+/g, ' ').trim().replace(/^to\s+/i, '');
  if (!text) return null;
  return { text: text[0].toUpperCase() + text.slice(1), rule };
}

// ---- when it is next due
const atTime = (d, hhmm) => { const [h, m] = hhmm.split(':').map(Number); const x = new Date(d); x.setHours(h, m, 0, 0); return x; };
const lastOfMonth = (y, mo) => new Date(y, mo + 1, 0).getDate();
// The first time after `after` (ms). For 'every', `from` is when it was last done (or made).
export function nextDue(rule, after, from = after) {
  const times = rule.at?.length ? rule.at : ['09:00'];
  if (rule.kind === 'every') {
    const base = new Date(from);
    const step = () => { if (rule.unit === 'month') base.setMonth(base.getMonth() + rule.n); else base.setDate(base.getDate() + rule.n * (rule.unit === 'week' ? 7 : 1)); };
    step();
    let t = atTime(base, times[0]).getTime();
    for (let guard = 0; t <= after && guard < 5000; guard++) { step(); t = atTime(base, times[0]).getTime(); }   // far behind: roll forward
    return t;
  }
  const start = new Date(after);
  for (let i = 0; i < 800; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const ok = rule.kind === 'daily' ? true
      : rule.kind === 'weekly' ? (rule.days || []).includes(d.getDay())
      : rule.kind === 'monthly' ? d.getDate() === Math.min(rule.day, lastOfMonth(d.getFullYear(), d.getMonth()))
      : rule.kind === 'yearly' ? d.getMonth() + 1 === rule.month && d.getDate() === Math.min(rule.day, lastOfMonth(d.getFullYear(), d.getMonth()))
      : false;
    if (!ok) continue;
    for (const hhmm of times) { const t = atTime(d, hhmm).getTime(); if (t > after) return t; }
  }
  return null;
}

// ---- said back in words: "Every day at 6am and 6pm", "Tue and Thu at 7pm", "Every 90 days"
const clock = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return (h === 12 && !m ? 'noon' : `${h % 12 || 12}${m ? ':' + pad(m) : ''}${h < 12 ? 'am' : 'pm'}`); };
const list = (a) => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a.at(-1);
const ordinal = (n) => n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');
export function describe(rule) {
  const at = rule.at?.length && !(rule.at.length === 1 && rule.at[0] === '09:00' && ['every', 'monthly', 'yearly'].includes(rule.kind)) ? ' at ' + list(rule.at.map(clock)) : '';
  const D = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  if (rule.kind === 'daily') return 'Every day' + at;
  if (rule.kind === 'weekly') {
    const d = [...rule.days].sort();
    const days = d.join() === '1,2,3,4,5' ? 'Weekdays' : d.join() === '0,6' ? 'Weekends' : d.length === 7 ? 'Every day' : 'Every ' + list(d.map((x) => D[x]));
    return days + at;
  }
  if (rule.kind === 'monthly') return (rule.day >= 31 ? 'Last day of the month' : `The ${ordinal(rule.day)} of every month`) + at;
  if (rule.kind === 'yearly') return `Every ${new Date(2000, rule.month - 1, 1).toLocaleString('en-US', { month: 'long' })} ${rule.day}` + at;
  if (rule.kind === 'every') return `Every ${rule.n} ${rule.unit}s` + at + ', from when last done';
  return '';
}

// ---- built in, to pick from. Nothing is on until picked.
export const IDEAS = [
  ['Home', 'Take out the trash every tue at 7pm'],
  ['Home', 'Change the furnace filter every 90 days'],
  ['Home', 'Test the smoke alarms every 6 months'],
  ['Home', 'Water the plants every 3 days'],
  ['Home', 'Clean out the fridge every sun at 10am'],
  ['Homestead', 'Feed and water the animals every day at 6am and 6pm'],
  ['Homestead', 'Collect eggs every day at 5pm'],
  ['Homestead', 'Walk the fence line every sat at 9am'],
  ['Homestead', 'Clean the coop every 2 weeks'],
  ['Pets', 'Flea and tick medicine monthly on the 1st'],
  ['Pets', 'Heartworm pill monthly on the 1st'],
  ['Car', 'Check the tire pressure monthly on the 15th'],
  ['Health', 'Take vitamins every day at 8am'],
  ['Money', 'Look over the budget every sun at 7pm'],
  ['Work', 'Plan the week every mon at 8am'],
  ['Work', 'Send invoices monthly on the last day']
];

// ---- the items
const ruleOf = (r) => { try { return JSON.parse(r.cadence); } catch { return null; } };
export function routines() {
  return db.prepare("SELECT * FROM items WHERE kind = 'routine' ORDER BY due_at").all()
    .map((r) => { const rule = ruleOf(r); return rule ? { ...r, rule, every: describe(rule) } : null; }).filter(Boolean);
}
export function addRoutine(line, space = 'personal', now = Date.now()) {
  const p = parseRoutine(line, new Date(now));
  if (!p) return { error: 'Say how often: "every day at 6am", "every tue", "every 90 days", "monthly on the 1st".' };
  const due = nextDue(p.rule, now, now);
  const r = db.prepare("INSERT INTO items (kind, text, space, due_at, cadence, amount, created_at) VALUES ('routine', ?, ?, ?, ?, NULL, ?)").run(p.text.slice(0, 200), space, due, JSON.stringify(p.rule), now);
  onLocalChange();
  return { id: Number(r.lastInsertRowid), kind: 'routine', text: p.text, space, due_at: due, every: describe(p.rule) };
}
// Done (or skipped): on to the next time. amount holds how many times it was done, for "done 12 times".
export function advance(id, { skip = false, now = Date.now() } = {}) {
  const r = db.prepare("SELECT * FROM items WHERE id = ? AND kind = 'routine'").get(id);
  const rule = r && ruleOf(r);
  if (!rule) throw new Error('That routine is gone.');
  // Done early (before it was due): the next one after the one it was for.
  const after = Math.max(now, r.due_at || 0);
  const due = nextDue(rule, after, rule.kind === 'every' ? now : after);
  db.prepare('UPDATE items SET due_at = ?, notified_at = NULL, amount = ?, done_at = NULL WHERE id = ?').run(due, skip ? r.amount : (r.amount || 0) + 1, id);
  onLocalChange();
  return due;
}
export function reschedule(id, line, now = Date.now()) {
  const r = db.prepare("SELECT * FROM items WHERE id = ? AND kind = 'routine'").get(id);
  if (!r) throw new Error('That routine is gone.');
  // Only the schedule ("every sun at 10am"), or a new name and schedule together.
  const p = parseRoutine(line, new Date(now)) || parseRoutine('x ' + line, new Date(now));
  if (!p) throw new Error('Say how often: "every day at 6am", "every tue", "every 90 days".');
  const text = p.text === 'X' ? r.text : p.text;
  db.prepare('UPDATE items SET text = ?, cadence = ?, due_at = ?, notified_at = NULL WHERE id = ?').run(text.slice(0, 200), JSON.stringify(p.rule), nextDue(p.rule, now, now), id);
  onLocalChange();
}
export function renameRoutine(id, text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!t) throw new Error('Give it a name.');
  db.prepare("UPDATE items SET text = ? WHERE id = ? AND kind = 'routine'").run(t, id);
  onLocalChange();
}
