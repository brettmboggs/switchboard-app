// AI plan history (lib/usagehist.js): past windows kept for good, when in the
// week the plan is used, and which session made each jump.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-usagehist-'));
const { noteUsage } = await import('../lib/usage.js');
const { usageHistory } = await import('../lib/usagehist.js');
const { db } = await import('../lib/db.js');

const H = 3600e3, D = 24 * H, WEEK = 7 * D;

test('each window is summarised, its peak and when it ran out kept', () => {
  const r1 = Date.UTC(2026, 9, 5), r2 = r1 + WEEK;
  noteUsage('claude', 'seven_day', 40, r1, WEEK, r1 - 2 * D, 'a');
  noteUsage('claude', 'seven_day', 100, r1, WEEK, r1 - D, 'b');
  noteUsage('claude', 'seven_day', 10, r2, WEEK, r1 + H, 'a');
  noteUsage('claude', 'seven_day', 25, r2, WEEK, r1 + 3 * H, 'a');
  const h = usageHistory('claude', r1 + 4 * H);
  assert.equal(h.main, 'seven_day');
  assert.deepEqual(h.past.seven_day.map((w) => [w.peak, !!w.outAt]), [[100, true]]);
  assert.equal(h.habits.ranOut, 1);
  assert.equal(h.habits.avgEnd, 100);
  // The faint line: the week before, moved onto this week's dates.
  assert.equal(h.series.seven_day.now.length, 2);
  assert.equal(h.series.seven_day.prev[0][0], r1 - 2 * D + WEEK);
});

test('a jump goes to the session that saw it, and to the hour it happened in', () => {
  const h = usageHistory('claude', Date.UTC(2026, 9, 5) + 4 * H);
  const a = h.sessions.find((s) => s.id === 'a');
  assert.ok(a && a.used >= 15, JSON.stringify(h.sessions));   // 10 at the start of the window, then +15
  const total = h.heat.flat().reduce((x, y) => x + y, 0);
  assert.ok(total > 0);
});

test('a past window can be looked at again while its readings are kept', () => {
  const r1 = Date.UTC(2026, 9, 5);
  const h = usageHistory('claude', r1 + 4 * H, { win: 'seven_day', at: r1 });
  assert.equal(h.view.points.length, 2);
  assert.equal(h.view.start, r1 - WEEK);
});

test('summaries outlive the raw readings', () => {
  db.prepare('DELETE FROM usage_samples').run();
  const h = usageHistory('claude', Date.UTC(2026, 9, 5) + 4 * H);
  assert.equal(h.past.seven_day.length, 1);
});
