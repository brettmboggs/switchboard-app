// Recurring costs: per-month sums, the form's checks, and charges in the
// email that come back like a subscription (and only those).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-costs-'));
const { db, setSetting } = await import('../lib/db.js');
const { perMonth, addCost, editCost, recurringGuesses, markNotRecurring } = await import('../lib/costs.js');
const { nextDue } = await import('../lib/capture.js');

test('per month', () => {
  assert.equal(perMonth(120, 'yearly'), 10);
  assert.equal(perMonth(30, 'quarterly'), 10);
  assert.equal(Math.round(perMonth(12, 'weekly') * 100) / 100, 52);
  assert.equal(perMonth(14, 'monthly'), 14);
});

test('add and edit check what they are given', () => {
  setSetting('spaces', [{ id: 'personal', name: 'Personal' }, { id: 'acme', name: 'Acme' }]);
  assert.throws(() => addCost({ text: '', amount: 5, cadence: 'monthly' }), /name/);
  assert.throws(() => addCost({ text: 'X', amount: 'lots', cadence: 'monthly' }), /amount/);
  assert.throws(() => addCost({ text: 'X', amount: 5, cadence: 'hourly' }), /often/);
  const id = addCost({ text: 'Hosting', amount: '$1,200.50', cadence: 'yearly', space: 'acme' });
  let row = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
  assert.equal(row.kind, 'bill'); assert.equal(row.amount, 1200.5); assert.equal(row.space, 'acme');
  editCost(id, { amount: 99, space: 'nope' });
  row = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
  assert.equal(row.amount, 99); assert.equal(row.space, 'personal');   // an unknown project falls back
  assert.equal(row.text, 'Hosting');
  assert.throws(() => editCost(999999, { amount: 1 }), /gone/);
});

test('quarterly rolls forward three months', () => {
  const start = new Date(2026, 0, 15, 9).getTime();
  assert.equal(new Date(nextDue({ due_at: start, cadence: 'quarterly' }, new Date(2026, 1, 1).getTime())).getMonth(), 3);
});

test('charges that come back each month are offered, once', () => {
  const now = new Date(2026, 10, 4).getTime(), day = 86400e3;
  const add = db.prepare(`INSERT INTO mail (account, msg_id, merchant, from_addr, amount, date, from_me, bulk, kind, space) VALUES ('a', ?, ?, 'x@y.test', ?, ?, 0, 0, ?, ?)`);
  let n = 0;
  for (const m of [0, 1, 2]) add.run('f' + n++, 'Figma, Inc.', 15, now - m * 30 * day, 'receipt', 'acme');   // monthly
  add.run('d' + n++, 'Namecheap', 12.98, now - 2 * day, 'charge', 'personal');                               // yearly
  add.run('d' + n++, 'Namecheap', 12.98, now - 367 * day, 'charge', 'personal');
  add.run('o' + n++, 'Hardware Store', 40, now - 3 * day, 'charge', 'personal');                             // once
  add.run('w' + n++, 'Coffee', 4, now - 1 * day, 'charge', 'personal');                                      // same month, twice
  add.run('w' + n++, 'Coffee', 4, now - 2 * day, 'charge', 'personal');
  const g = recurringGuesses(now);
  const by = Object.fromEntries(g.map((x) => [x.name, x]));
  assert.deepEqual(Object.keys(by).sort(), ['Figma, Inc.', 'Namecheap']);
  assert.equal(by['Figma, Inc.'].cadence, 'monthly'); assert.equal(by['Figma, Inc.'].space, 'acme'); assert.equal(by['Figma, Inc.'].times, 3);
  assert.equal(by.Namecheap.cadence, 'yearly');
  // Added as a cost, or waved away: not offered again.
  addCost({ text: 'Figma', amount: 15, cadence: 'monthly', space: 'acme' });
  markNotRecurring('Namecheap');
  assert.deepEqual(recurringGuesses(now), []);
});
