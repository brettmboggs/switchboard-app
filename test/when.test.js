import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.SWITCHBOARD_DATA = process.env.SWITCHBOARD_DATA || '/tmp/switchboard-test';
const { parseWhen } = await import('../lib/capture.js');

// Tue Nov 3 2026, 2:00 pm local
const now = new Date(2026, 10, 3, 14, 0, 0);
const at = (text) => { const r = parseWhen(text, now); return r && { d: new Date(r.at), rest: r.rest }; };

test('weekday with time', () => {
  const r = at('fri 9am call ABBCO');
  assert.equal(r.d.getDate(), 6); assert.equal(r.d.getHours(), 9); assert.equal(r.rest, 'call ABBCO');
});
test('in 2h', () => {
  const r = at('in 2h check the deploy');
  assert.equal(r.d.getHours(), 16); assert.equal(r.rest, 'check the deploy');
});
test('tomorrow to', () => {
  const r = at('tomorrow to call Jacob');
  assert.equal(r.d.getDate(), 4); assert.equal(r.d.getHours(), 9); assert.equal(r.rest, 'to call Jacob');
});
test('bare time later today, earlier time rolls to tomorrow', () => {
  assert.equal(at('5pm stretch').d.getDate(), 3);
  assert.equal(at('9am stretch').d.getDate(), 4);
});
test('date and month name', () => {
  assert.equal(at('11/20 renew domain').d.getDate(), 20);
  assert.equal(at('dec 1 taxes').d.getMonth(), 11);
});
test('by thu', () => {
  const r = at('send Debbie the invoice by thu');
  assert.equal(r.d.getDate(), 5); assert.equal(r.rest, 'send Debbie the invoice');
});
test('same weekday means next week', () => {
  assert.equal(at('tue standup').d.getDate(), 10);
});
test('numbers are not times', () => {
  assert.equal(at('call 3 people'), null);
});
