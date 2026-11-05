// The Calendar page's events for a range: what it refuses, and that a calendar
// link is read once and expanded for the range asked for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-calview-'));
const { setSetting } = await import('../lib/db.js');
const { eventsBetween, forget } = await import('../lib/calendarview.js');

test('a range has to be a start and an end, no more than 100 days', async () => {
  assert.match((await eventsBetween('x', 5)).error, /start and an end/);
  assert.match((await eventsBetween(10, 5)).error, /start and an end/);
  assert.match((await eventsBetween(0, 101 * 86400e3)).error, /100 days/);
});

test('a calendar link is read once and its events come back for the range, with its calendar named', async () => {
  const ics = (s) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:a@x\r\nSUMMARY:Dentist\r\nDTSTART:${s}T150000Z\r\nDTEND:${s}T160000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
  let hits = 0;
  const srv = createServer((req, res) => { hits++; res.writeHead(200, { 'Content-Type': 'text/calendar' }); res.end(ics('20301005')); }).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  setSetting('calendars', [{ id: 'c1', name: 'Family', url: `http://127.0.0.1:${srv.address().port}/f.ics`, space: 'personal' }]);
  forget();
  const from = Date.UTC(2030, 9, 1), to = Date.UTC(2030, 10, 1);
  const r = await eventsBetween(from, to);
  assert.deepEqual(r.problems, []);
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].title, 'Dentist');
  assert.equal(r.events[0].calendarName, 'Family');
  assert.equal((await eventsBetween(from, to + 86400e3)).events.length, 1);
  assert.equal(hits, 1, 'the second range did not fetch the link again');
  assert.equal((await eventsBetween(Date.UTC(2030, 10, 1), Date.UTC(2030, 11, 1))).events.length, 0);
  srv.close();
});
