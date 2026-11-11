// Calendar events from one line (lib/eventline.js), for Ctrl K and Jarvis, and
// the calendar it goes on. No network: the Google call itself is not run here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-eventline-'));
const { parseEventLine, pickCalendar } = await import('../lib/eventline.js');
const { quick, dayRange } = await import('../lib/jarvistools.js');

const NOW = new Date(2026, 10, 10, 13, 0);   // a Tuesday, 1 pm
const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo, d, h, mi).getTime();
const read = (line) => parseEventLine(line, NOW);

test('what and when from one line', () => {
  assert.deepEqual(read('lunch with Sam fri noon to my calendar'), { title: 'Lunch with Sam', start: at(2026, 10, 13, 12), end: at(2026, 10, 13, 13), allDay: false, calendarWord: null });
  const r = read('meeting dentist tue 3-4pm');
  assert.equal(r.title, 'Meeting dentist'); assert.equal(r.start, at(2026, 10, 17, 15)); assert.equal(r.end, at(2026, 10, 17, 16));
});

test('ranges, lengths, and a day with no time', () => {
  assert.equal(read('event standup 9:30-9:45 tomorrow').end, at(2026, 10, 11, 9, 45));
  assert.equal(read('appointment vet thu 11-1pm').start, at(2026, 10, 12, 11));
  assert.equal(read('event call from 2 to 3:30pm thu').end, at(2026, 10, 12, 15, 30));
  assert.equal(read('put haircut on my calendar sat 10am for 45 min').end, at(2026, 10, 14, 10, 45));
  assert.equal(read('cal flight to Denver 12/3 6:15am for 3 hours').end, at(2026, 11, 3, 9, 15));
  assert.deepEqual(read('schedule oil change tomorrow'), { title: 'Oil change', start: at(2026, 10, 11), end: at(2026, 10, 12), allDay: true, calendarWord: null });
});

test('which calendar, and lines that are not events', () => {
  assert.equal(read("add Mia's recital to the family calendar 11/20 6pm").calendarWord, 'family');
  assert.equal(read('lunch fri noon on my google calendar').calendarWord, null);
  assert.equal(read('buy milk'), null);
  assert.equal(read('note check what is on my calendar'), null);
  assert.equal(read('what is on my calendar 12/30'), null);
  assert.equal(read('anything on my calendar friday?'), null);
  assert.match(read('event team dinner').error, /When is it/);
});

test('the calendar it goes on: the one named, else your own, never a read-only one', () => {
  const list = [{ id: 'a', name: 'Holidays', kind: 'google', calendarId: 'h', canWrite: false }, { id: 'b', name: 'Family', kind: 'google', calendarId: 'fam' }, { id: 'c', name: 'Personal Calendar', kind: 'google', calendarId: 'sam@example.com' }, { id: 'd', name: 'Work link', url: 'https://example.com/x.ics' }];
  assert.equal(pickCalendar(null, list, 'sam@example.com').id, 'c');
  assert.equal(pickCalendar('family', list, 'sam@example.com').id, 'b');
  assert.equal(pickCalendar('holidays', list, 'sam@example.com').id, 'c');
  assert.equal(pickCalendar(null, [list[0], list[3]], 'sam@example.com'), null);
});

test('Jarvis: adding and asking, with no model', () => {
  assert.deepEqual(quick('Jarvis, put lunch with Sam on my calendar friday at noon'), ['add_event', { line: 'put lunch with Sam on my calendar friday at noon' }]);
  assert.deepEqual(quick("what's on my calendar tomorrow"), ['calendar', { when: 'tomorrow' }]);
  assert.deepEqual(quick('am I free friday'), ['calendar', { when: 'friday' }]);
  assert.deepEqual(quick('what is on my calendar 12/30'), ['calendar', { when: '12/30' }]);
  assert.deepEqual(quick("what's up"), ['whats_up', {}]);
  assert.deepEqual(quick('remind me tomorrow at 9 to call the bank')[0], 'add');
  const r = dayRange('tomorrow', NOW);
  assert.equal(r.label, 'tomorrow'); assert.equal(r.from, at(2026, 10, 11)); assert.equal(r.to, at(2026, 10, 12));
  assert.equal(dayRange('this week', NOW).to, at(2026, 10, 17));
});
