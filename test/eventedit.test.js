// Changing a calendar event from one line (lib/eventedit.js), and the same event
// read twice shown once (lib/calendar.js dedupe). No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-eventedit-'));
const { parseEdit, findEvent, newTimes } = await import('../lib/eventedit.js');
const { dedupe } = await import('../lib/calendar.js');
const { quick } = await import('../lib/jarvistools.js');

const NOW = new Date(2026, 10, 10, 13, 0);   // a Tuesday, 1 pm
const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo, d, h, mi).getTime();
const EVENTS = [
  { uid: 'a', title: 'Lunch with Sam', start: at(2026, 10, 13, 12), end: at(2026, 10, 13, 13), calendar: 'g', canWrite: true },
  { uid: 'b', title: 'Lunch with Sam', start: at(2026, 10, 20, 12), end: at(2026, 10, 20, 13), calendar: 'g', canWrite: true },
  { uid: 'c', title: 'Dentist', start: at(2026, 10, 17, 15), end: at(2026, 10, 17, 15, 30), calendar: 'g', canWrite: true },
  { uid: 'd', title: "Mia's recital", start: at(2026, 10, 20), end: at(2026, 10, 21), allDay: true, calendar: 'g', canWrite: true },
  { uid: 'e', title: 'Team meeting', start: at(2026, 10, 9, 15), end: at(2026, 10, 9, 16), calendar: 'g', canWrite: true }
];

test('what a line asks for', () => {
  assert.deepEqual(parseEdit('move lunch with Sam to 1pm'), { act: 'move', what: 'lunch with Sam', when: '1pm', sure: true });
  assert.equal(parseEdit('Jarvis, reschedule the dentist to thu 2-3pm').act, 'move');
  assert.deepEqual(parseEdit('rename the dentist event to cleaning'), { act: 'rename', what: 'the dentist event', title: 'cleaning', sure: true });
  assert.equal(parseEdit('change the recital to friday').act, 'move');
  assert.equal(parseEdit('cancel lunch with Sam friday').sure, true);
  assert.equal(parseEdit('cancel the build').sure, false);           // not plainly the calendar: left to others
  assert.equal(parseEdit('move on'), null);
});

test('the event meant: its words, the day or time said, the next one first', () => {
  assert.equal(findEvent(EVENTS, 'lunch with Sam', NOW.getTime()).uid, 'a');
  assert.equal(findEvent(EVENTS, 'lunch with sam on 11/20', NOW.getTime()).uid, 'b');
  assert.equal(findEvent(EVENTS, 'the dentist', NOW.getTime()).uid, 'c');
  assert.equal(findEvent(EVENTS, 'my 3pm meeting', NOW.getTime()).uid, 'e');   // only a past one: still found
  assert.equal(findEvent(EVENTS, 'mias recital', NOW.getTime()).uid, 'd');
  assert.equal(findEvent(EVENTS, 'board review', NOW.getTime()), null);
});

test('new times: a time keeps the day, a day keeps the time, a range sets both', () => {
  const lunch = EVENTS[0], dentist = EVENTS[2], recital = EVENTS[3];
  assert.deepEqual(newTimes(lunch, '1pm', NOW), { start: at(2026, 10, 13, 13), end: at(2026, 10, 13, 14), allDay: false });
  assert.deepEqual(newTimes(dentist, 'thu', NOW), { start: at(2026, 10, 12, 15), end: at(2026, 10, 12, 15, 30), allDay: false });
  assert.deepEqual(newTimes(dentist, 'thu 2-3pm', NOW), { start: at(2026, 10, 12, 14), end: at(2026, 10, 12, 15), allDay: false });
  assert.deepEqual(newTimes(recital, 'friday', NOW), { start: at(2026, 10, 13), end: at(2026, 10, 14), allDay: true });
  assert.equal(newTimes(lunch, 'later', NOW), null);
});

test('one event read twice (Google, and its old private link) shows once: the copy you can edit', () => {
  const cals = [{ id: 'g', kind: 'google', canWrite: true }, { id: 'link', url: 'https://example.com/basic.ics' }];
  const list = [
    { uid: 'abc', start: 5, calendar: 'g' }, { uid: 'abc@google.com', start: 5, calendar: 'link' },
    { uid: 'other@google.com', start: 9, calendar: 'link' }
  ];
  assert.deepEqual(dedupe(list, cals).map((e) => e.calendar + ':' + e.uid), ['g:abc', 'link:other@google.com']);
});

test('Jarvis: change, cancel, and a yes, with no model', () => {
  assert.deepEqual(quick('move lunch with Sam to 1pm'), ['edit_event', { line: 'move lunch with Sam to 1pm' }]);
  assert.deepEqual(quick('cancel lunch with Sam friday'), ['edit_event', { line: 'cancel lunch with Sam friday' }]);
  assert.equal(quick('cancel the build'), null);
  assert.deepEqual(quick('yes'), ['yes', {}]);
  assert.deepEqual(quick('never mind'), ['no', {}]);
});
