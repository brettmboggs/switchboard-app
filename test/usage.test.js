// AI plan usage: readings kept from Claude Code's status line and Codex's logs,
// and the forecast: where the pace lands at reset and when it would hit 100%.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-usage-'));
process.env.CODEX_HOME = mkdtempSync(join(tmpdir(), 'sb-codex-'));
const { forecast, noteClaudeLimits, usageForBoard, windowLength } = await import('../lib/usage.js');

const H = 3600e3, D = 24 * H, WEEK = 7 * D;

test('window lengths come from their names', () => {
  assert.equal(windowLength('five_hour'), 5 * H);
  assert.equal(windowLength('seven_day'), WEEK);
  assert.equal(windowLength('seven_day_opus'), WEEK);
  assert.equal(windowLength('mystery'), 0);
});

test('an even pace lands near 100 and is on track', () => {
  const start = 0, reset = WEEK, now = WEEK / 2;
  const samples = [0, 1, 2, 3].map((d) => ({ at: d * D + D / 2, pct: (d * D + D / 2) / WEEK * 90, resets_at: reset, len: WEEK }));
  samples.push({ at: now, pct: 45, resets_at: reset, len: WEEK });
  const f = forecast(samples, now);
  assert.equal(f.start, start);
  assert.equal(f.state, 'tight');   // lands about 90
  assert.ok(f.lands >= 85 && f.lands <= 95, String(f.lands));
  assert.equal(f.outAt, null);
  assert.equal(f.even, 50);
});

test('a heavy last day runs out before the reset, and says when', () => {
  const reset = WEEK, now = 3 * D;
  const samples = [
    { at: 1 * D, pct: 10, resets_at: reset, len: WEEK },
    { at: 2 * D, pct: 20, resets_at: reset, len: WEEK },
    { at: 3 * D, pct: 60, resets_at: reset, len: WEEK }
  ];
  const f = forecast(samples, now);
  assert.equal(f.state, 'over');
  assert.ok(f.outAt > now && f.outAt < reset);
  assert.ok(f.perDay > 9 && f.perDay < 11, String(f.perDay));   // 40% left over 4 days
});

test('a light week is ok', () => {
  const f = forecast([{ at: 2 * D, pct: 5, resets_at: WEEK, len: WEEK }, { at: 4 * D, pct: 10, resets_at: WEEK, len: WEEK }], 4 * D);
  assert.equal(f.state, 'ok');
  assert.ok(f.lands < 30);
});

test('Claude Code limits are kept and come back on the board, with a reset in the past shown as fresh', () => {
  const now = Date.now();
  noteClaudeLimits({ five_hour: { used_percentage: 20, resets_at: Math.round((now + 2 * H) / 1000) }, seven_day: { used_percentage: 51, resets_at: Math.round((now + 3 * D) / 1000) } }, now);
  noteClaudeLimits({ seven_day: { used_percentage: 'nope' } }, now);   // junk is ignored
  const plans = usageForBoard(now + 1000);
  const claude = plans.find((p) => p.id === 'claude');
  assert.deepEqual(claude.windows.map((w) => w.id), ['five_hour', 'seven_day']);
  assert.equal(claude.windows[1].pct, 51);
  assert.ok(Array.isArray(claude.windows[1].days));
  const later = usageForBoard(now + 3 * H);
  assert.equal(later.find((p) => p.id === 'claude').windows[0].pct, 0);   // the 5-hour window reset
});

test('a first reading mid-week is never counted as one day\'s use', async () => {
  const { usageForBoard: board, noteUsage } = await import('../lib/usage.js');
  const now = Date.now(), reset = now + 3.5 * D;   // three and a half days in
  noteUsage('codex', 'weekly-test', 51, reset, WEEK, now);
  const w = board(now + 1000).find((p) => p.id === 'codex').windows.find((x) => x.id === 'weekly-test');
  assert.equal(w.days.length, 7);
  assert.ok(w.days.every((d) => d === null), JSON.stringify(w.days));   // nothing to measure from yet
  noteUsage('codex', 'weekly-test', 60, reset, WEEK, now + 1.2 * D);    // the next day, measured from the first reading
  const w2 = board(now + 1.2 * D + 1000).find((p) => p.id === 'codex').windows.find((x) => x.id === 'weekly-test');
  assert.equal(w2.days.filter((d) => d != null).length, 1);
});
