// Chores and routines: what people type becomes the right schedule, and the
// next time is right (month ends, leap years, done early, done late).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-routines-'));
const { parseRoutine, nextDue, describe, addRoutine, advance, reschedule, routines, IDEAS } = await import('../lib/routines.js');

const TUE = new Date(2026, 10, 3, 14, 0);   // Tue Nov 3 2026, 2pm
const at = (y, mo, d, h = 9, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const p = (line) => parseRoutine(line, TUE);

test('the way people say it', () => {
  assert.deepEqual(p('walk the dog every day at 6am and 6pm'), { text: 'Walk the dog', rule: { kind: 'daily', at: ['06:00', '18:00'] } });
  assert.deepEqual(p('change the furnace filter every 90 days'), { text: 'Change the furnace filter', rule: { kind: 'every', n: 90, unit: 'day', at: ['09:00'] } });
  assert.deepEqual(p('trash every tue at 7pm'), { text: 'Trash', rule: { kind: 'weekly', days: [2], at: ['19:00'] } });
  assert.deepEqual(p('flea meds monthly on the 1st'), { text: 'Flea meds', rule: { kind: 'monthly', day: 1, at: ['09:00'] } });
  assert.deepEqual(p('rent on the 1st of every month'), { text: 'Rent', rule: { kind: 'monthly', day: 1, at: ['09:00'] } });
  assert.deepEqual(p('invoices monthly on the last day'), { text: 'Invoices', rule: { kind: 'monthly', day: 31, at: ['09:00'] } });
  assert.deepEqual(p('gym every mon, wed and fri at 6:30am'), { text: 'Gym', rule: { kind: 'weekly', days: [1, 3, 5], at: ['06:30'] } });
  assert.deepEqual(p('stand-up every weekday at 9:15am'), { text: 'Stand-up', rule: { kind: 'weekly', days: [1, 2, 3, 4, 5], at: ['09:15'] } });
  assert.deepEqual(p('mow the lawn every other week'), { text: 'Mow the lawn', rule: { kind: 'every', n: 2, unit: 'week', at: ['09:00'] } });
  assert.deepEqual(p('test smoke alarms every 6 months'), { text: 'Test smoke alarms', rule: { kind: 'every', n: 6, unit: 'month', at: ['09:00'] } });
  assert.deepEqual(p("mom's birthday every mar 14"), { text: "Mom's birthday", rule: { kind: 'yearly', month: 3, day: 14, at: ['09:00'] } });
  assert.deepEqual(p('renew the truck tags yearly on apr 30'), { text: 'Renew the truck tags', rule: { kind: 'yearly', month: 4, day: 30, at: ['09:00'] } });
  assert.deepEqual(p('remind me to take vitamins daily in the morning'), { text: 'Take vitamins', rule: { kind: 'daily', at: ['07:00'] } });
  assert.deepEqual(p('feed the dog daily at 6'), { text: 'Feed the dog', rule: { kind: 'daily', at: ['06:00'] } });
  assert.deepEqual(p('check the mail every day at 3'), { text: 'Check the mail', rule: { kind: 'daily', at: ['15:00'] } });
  assert.deepEqual(p('lock up nightly'), { text: 'Lock up', rule: { kind: 'daily', at: ['21:00'] } });
  assert.deepEqual(p('take out recycling every tuesdays'), { text: 'Take out recycling', rule: { kind: 'weekly', days: [2], at: ['09:00'] } });
});

test('not routines', () => {
  for (const line of ['call the bank on tuesday', 'remind fri 9am call the bank', 'every little thing', 'I love you every', 'gate code 4411', 'every day', 'weekly']) assert.equal(p(line), null, line);
});

test('next time: daily, several times a day', () => {
  const r = { kind: 'daily', at: ['06:00', '18:00'] };
  assert.equal(nextDue(r, at(2026, 11, 3, 14)), at(2026, 11, 3, 18));
  assert.equal(nextDue(r, at(2026, 11, 3, 18)), at(2026, 11, 4, 6));
  assert.equal(nextDue(r, at(2026, 11, 3, 5)), at(2026, 11, 3, 6));
});

test('next time: weekly, monthly at month ends, yearly on Feb 29', () => {
  assert.equal(nextDue({ kind: 'weekly', days: [2], at: ['19:00'] }, at(2026, 11, 3, 14)), at(2026, 11, 3, 19));
  assert.equal(nextDue({ kind: 'weekly', days: [2], at: ['19:00'] }, at(2026, 11, 3, 20)), at(2026, 11, 10, 19));
  assert.equal(nextDue({ kind: 'weekly', days: [1, 5], at: ['08:00'] }, at(2026, 11, 3, 14)), at(2026, 11, 6, 8));
  const last = { kind: 'monthly', day: 31, at: ['09:00'] };
  assert.equal(nextDue(last, at(2026, 11, 3)), at(2026, 11, 30));
  assert.equal(nextDue(last, at(2027, 2, 1)), at(2027, 2, 28));
  assert.equal(nextDue({ kind: 'monthly', day: 1, at: ['09:00'] }, at(2026, 11, 3)), at(2026, 12, 1));
  assert.equal(nextDue({ kind: 'yearly', month: 2, day: 29, at: ['09:00'] }, at(2026, 11, 3)), at(2027, 2, 28));
  assert.equal(nextDue({ kind: 'yearly', month: 2, day: 29, at: ['09:00'] }, at(2027, 3, 1)), at(2028, 2, 29));
});

test('next time: every N, from when it was done; far behind rolls forward', () => {
  const r = { kind: 'every', n: 90, unit: 'day', at: ['09:00'] };
  assert.equal(nextDue(r, at(2026, 11, 3, 14), at(2026, 11, 3, 14)), at(2027, 2, 1));
  assert.equal(nextDue({ kind: 'every', n: 3, unit: 'day', at: ['09:00'] }, at(2026, 11, 20), at(2026, 11, 1)), at(2026, 11, 22));
  assert.equal(nextDue({ kind: 'every', n: 6, unit: 'month', at: ['09:00'] }, at(2026, 11, 3), at(2026, 11, 3)), at(2027, 5, 3));
});

test('said back in words', () => {
  assert.equal(describe({ kind: 'daily', at: ['06:00', '18:00'] }), 'Every day at 6am and 6pm');
  assert.equal(describe({ kind: 'weekly', days: [2, 4], at: ['19:00'] }), 'Every Tue and Thu at 7pm');
  assert.equal(describe({ kind: 'weekly', days: [1, 2, 3, 4, 5], at: ['09:15'] }), 'Weekdays at 9:15am');
  assert.equal(describe({ kind: 'monthly', day: 1, at: ['09:00'] }), 'The 1st of every month');
  assert.equal(describe({ kind: 'monthly', day: 31, at: ['12:00'] }), 'Last day of the month at noon');
  assert.equal(describe({ kind: 'yearly', month: 3, day: 14, at: ['09:00'] }), 'Every March 14');
  assert.equal(describe({ kind: 'every', n: 90, unit: 'day', at: ['09:00'] }), 'Every 90 days, from when last done');
});

test('every built-in idea reads as a routine', () => {
  for (const [, line] of IDEAS) assert.ok(p(line), line);
});

test('done moves to the next time; early, late, and skip', () => {
  const now = at(2026, 11, 3, 14);
  const a = addRoutine('walk the dog every day at 6am and 6pm', 'home', now);
  assert.equal(a.due_at, at(2026, 11, 3, 18));
  // Done late (it was due at 6pm, done at 8pm): next is tomorrow 6am.
  assert.equal(advance(a.id, { now: at(2026, 11, 3, 20) }), at(2026, 11, 4, 6));
  // Done early (at 5am for the 6am one): next is 6pm, not 6am again.
  assert.equal(advance(a.id, { now: at(2026, 11, 4, 5) }), at(2026, 11, 4, 18));
  assert.equal(advance(a.id, { now: at(2026, 11, 4, 17), skip: true }), at(2026, 11, 5, 6));
  const r = routines().find((x) => x.id === a.id);
  assert.equal(r.amount, 2);   // done twice, skipped once
  assert.equal(r.every, 'Every day at 6am and 6pm');
  // Every 90 days: counted from the day it was actually done.
  const f = addRoutine('change the furnace filter every 90 days', 'personal', now);
  assert.equal(advance(f.id, { now: at(2027, 2, 10, 15) }), at(2027, 5, 11));
  // A new schedule, keeping the name.
  reschedule(f.id, 'every 60 days', now);
  assert.equal(routines().find((x) => x.id === f.id).text, 'Change the furnace filter');
  assert.equal(routines().find((x) => x.id === f.id).due_at, at(2027, 1, 2));
  assert.ok(addRoutine('just a note', 'personal', now).error);
});
