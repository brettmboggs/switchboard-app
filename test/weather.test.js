import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.SWITCHBOARD_DATA = process.env.SWITCHBOARD_DATA || '/tmp/switchboard-test';
const { summarize, describe } = await import('../lib/weather.js');

// A forecast for Chicago time (UTC-6), starting at local midnight on Nov 3.
function forecast({ temps, rain = [], codes = [], high = 61, low = 40, gust = 10 }) {
  const time = temps.map((_, i) => `2026-11-03T${String(i).padStart(2, '0')}:00`);
  return {
    timezone: 'America/Chicago', utc_offset_seconds: -21600,
    current: { temperature_2m: 54.4, weather_code: 2, is_day: 1 },
    hourly: { time, temperature_2m: temps, precipitation_probability: temps.map((_, i) => rain[i] ?? 0), weather_code: temps.map((_, i) => codes[i] ?? 2) },
    daily: { temperature_2m_max: [high], temperature_2m_min: [low], weather_code: [2], wind_gusts_10m_max: [gust] }
  };
}
const at = (hourLocal) => Date.parse('2026-11-03T00:00Z') + (hourLocal + 6) * 3600e3;   // local hour to a moment

test('a quiet day has no notes', () => {
  const s = summarize(forecast({ temps: Array(24).fill(50) }), 'f', at(8));
  assert.equal(s.temp, 54); assert.equal(s.text, 'Partly cloudy'); assert.equal(s.high, 61); assert.equal(s.low, 40);
  assert.deepEqual(s.notes, []);
});

test('rain coming this afternoon', () => {
  const rain = []; const codes = []; rain[15] = 70; codes[15] = 63;
  const s = summarize(forecast({ temps: Array(24).fill(50), rain, codes }), 'f', at(8));
  assert.equal(s.notes[0].kind, 'rain');
  assert.match(s.notes[0].text, /^Rain likely from 3/);
});

test('frost tonight, and a hard freeze', () => {
  const temps = Array(24).fill(45); temps[22] = 31; temps[23] = 33;
  assert.match(summarize(forecast({ temps }), 'f', at(14)).notes[0].text, /^Frost tonight, low 31°/);
  temps[22] = 25;
  assert.match(summarize(forecast({ temps }), 'f', at(14)).notes[0].text, /^Hard freeze tonight, low 25°/);
});

test('heat and wind, in Celsius', () => {
  const s = summarize(forecast({ temps: Array(24).fill(30), high: 37, gust: 70 }), 'c', at(10));
  assert.deepEqual(s.notes.map((n) => n.kind), ['heat', 'wind']);
  assert.equal(s.unit, 'C');
  assert.equal(describe(95), 'Thunderstorms');
});

test('town names typed loosely', async () => {
  const { variants } = await import('../lib/weather.js');
  assert.ok(variants('St Augustine').includes('Saint Augustine'));
  assert.ok(variants('Saint Paul').includes('St. Paul'));
  assert.ok(variants('ONeill').includes("O'Neill"));
  assert.ok(variants('O Neill').includes("O'Neill"));
});
