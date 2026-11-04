import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.SWITCHBOARD_DATA = process.env.SWITCHBOARD_DATA || '/tmp/switchboard-test';
const { parseICS, expand, zonedToUtc, ianaZone, durationMs } = await import('../lib/calendar.js');

const cal = (...events) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events.join('\r\n')}\r\nEND:VCALENDAR\r\n`;
const ev = (lines) => `BEGIN:VEVENT\r\n${lines.join('\r\n')}\r\nEND:VEVENT`;
const iso = (t) => new Date(t).toISOString();
const range = (a, b) => [Date.parse(a), Date.parse(b)];
const day = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

test('time zones, including Outlook names', () => {
  assert.equal(iso(zonedToUtc(2026, 11, 3, 9, 0, 0, 'America/Chicago')), '2026-11-03T15:00:00.000Z');   // CST
  assert.equal(iso(zonedToUtc(2026, 7, 1, 9, 0, 0, 'America/Chicago')), '2026-07-01T14:00:00.000Z');    // CDT
  assert.equal(ianaZone('Central Standard Time'), 'America/Chicago');
  assert.equal(ianaZone('Nowhere/Fake'), null);
});

test('a single event, folded lines and escapes', () => {
  const e = parseICS(cal(ev(['UID:1', 'SUMMARY:Lunch with Sam\\, then', '  the bank', 'LOCATION:Main St\\nSuite 2', 'DTSTART;TZID=America/Chicago:20261104T120000', 'DTEND;TZID=America/Chicago:20261104T130000'])));
  assert.equal(e.length, 1);
  assert.equal(e[0].summary, 'Lunch with Sam, then the bank');
  assert.equal(e[0].location, 'Main St\nSuite 2');
  const [x] = expand(e, ...range('2026-11-04T00:00Z', '2026-11-05T00:00Z'));
  assert.equal(iso(x.start), '2026-11-04T18:00:00.000Z');
  assert.equal(x.end - x.start, 3600e3);
});

test('weekly on two days keeps local time across the DST change', () => {
  const e = parseICS(cal(ev(['UID:w', 'SUMMARY:Standup', 'DTSTART;TZID=America/Chicago:20261026T090000', 'DURATION:PT15M', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE'])));
  const xs = expand(e, ...range('2026-10-26T00:00Z', '2026-11-05T00:00Z')).map((x) => iso(x.start));
  // Oct 26 and 28 are CDT (14:00Z); Nov 1 DST ends; Nov 2 and 4 are CST (15:00Z).
  assert.deepEqual(xs, ['2026-10-26T14:00:00.000Z', '2026-10-28T14:00:00.000Z', '2026-11-02T15:00:00.000Z', '2026-11-04T15:00:00.000Z']);
});

test('every other week, with a skipped date and a count', () => {
  const e = parseICS(cal(ev(['UID:b', 'SUMMARY:Payroll', 'DTSTART:20261106T150000Z', 'DTEND:20261106T153000Z', 'RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=4', 'EXDATE:20261120T150000Z'])));
  const xs = expand(e, ...range('2026-11-01T00:00Z', '2027-01-31T00:00Z')).map((x) => iso(x.start).slice(0, 10));
  assert.deepEqual(xs, ['2026-11-06', '2026-12-04', '2026-12-18']);
});

test('second Tuesday and last Friday of the month', () => {
  const e = parseICS(cal(
    ev(['UID:m1', 'SUMMARY:Board', 'DTSTART:20261110T180000Z', 'DURATION:PT1H', 'RRULE:FREQ=MONTHLY;BYDAY=2TU']),
    ev(['UID:m2', 'SUMMARY:Rent', 'DTSTART;VALUE=DATE:20261127', 'RRULE:FREQ=MONTHLY;BYDAY=-1FR'])));
  const xs = expand(e, ...range('2026-11-01T00:00Z', '2027-01-31T00:00Z')).map((x) => `${x.title} ${x.allDay ? day(x.start) : iso(x.start).slice(0, 10)}`);
  assert.deepEqual(xs, ['Board 2026-11-10', 'Rent 2026-11-27', 'Board 2026-12-08', 'Rent 2026-12-25', 'Board 2027-01-12', 'Rent 2027-01-29']);
});

test('a moved meeting and a cancelled one', () => {
  const e = parseICS(cal(
    ev(['UID:r', 'SUMMARY:1:1', 'DTSTART:20261102T160000Z', 'DTEND:20261102T163000Z', 'RRULE:FREQ=DAILY;COUNT=3']),
    ev(['UID:r', 'SUMMARY:1:1 (moved)', 'RECURRENCE-ID:20261103T160000Z', 'DTSTART:20261103T190000Z', 'DTEND:20261103T193000Z']),
    ev(['UID:c', 'SUMMARY:Gone', 'STATUS:CANCELLED', 'DTSTART:20261102T200000Z', 'DTEND:20261102T210000Z'])));
  const xs = expand(e, ...range('2026-11-01T00:00Z', '2026-11-10T00:00Z')).map((x) => `${x.title} ${iso(x.start).slice(5, 16)}`);
  assert.deepEqual(xs, ['1:1 11-02T16:00', '1:1 (moved) 11-03T19:00', '1:1 11-04T16:00']);
});

test('all-day events and yearly birthdays', () => {
  const e = parseICS(cal(ev(['UID:y', 'SUMMARY:Mom birthday', 'DTSTART;VALUE=DATE:19600315', 'DTEND;VALUE=DATE:19600316', 'RRULE:FREQ=YEARLY'])));
  const [x] = expand(e, ...range('2027-03-01T00:00Z', '2027-04-01T00:00Z'));
  assert.equal(x.allDay, true);
  assert.equal(day(x.start), '2027-03-15');
  assert.equal(durationMs('P1DT2H'), 26 * 3600e3);
});

// A calendar link is outside input: the parser stays quick on a hostile feed.
test('a 1 MB line with an unclosed quote parses in a blink, and lines are capped', async () => {
  const { MAX_LINE, readCapped } = await import('../lib/calendar.js');
  // A million colons and one stray quote: the old lookahead regex scanned to the
  // end of the line from every colon (minutes); one pass finds the first colon.
  const hostile = 'SUMMARY:' + ':'.repeat(1e6) + '"';
  const t0 = performance.now();
  const e = parseICS(cal(ev(['UID:h', hostile, 'DTSTART:20261104T120000Z'])));
  assert.ok(performance.now() - t0 < 50, `took ${Math.round(performance.now() - t0)} ms`);
  assert.equal(e.length, 1);
  assert.equal(e[0].summary.length, MAX_LINE - 'SUMMARY:'.length);
  const long = parseICS(cal(ev(['UID:l', 'SUMMARY:' + 'b'.repeat(10000), 'DTSTART:20261104T120000Z'])));
  assert.equal(long[0].summary.length, MAX_LINE - 'SUMMARY:'.length);
  // Quotes are honoured: the colon inside a parameter value is not the separator.
  const q = parseICS(cal(ev(['UID:q', 'DTSTART;TZID="America/Chicago":20261104T120000', 'SUMMARY:Lunch at 12:30'])));
  assert.equal(q[0].summary, 'Lunch at 12:30');
  assert.equal(q[0].start.zone, 'America/Chicago');
  // A feed past 2 MB is not read to the end.
  assert.equal(await readCapped(new Response('BEGIN:VCALENDAR'), 100), 'BEGIN:VCALENDAR');
  await assert.rejects(readCapped(new Response('x'.repeat(3 * 1024 * 1024)), 2 * 1024 * 1024), /too big/);
  await assert.rejects(readCapped(new Response('x', { headers: { 'content-length': String(5e6) } }), 2 * 1024 * 1024), /too big/);
});
