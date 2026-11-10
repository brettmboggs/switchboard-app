// Network test (lib/speedtest.js): the numbers from raw readings, the grade,
// the words; and the readings from the OS (lib/sysprobe.js). No network here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-speedtest-'));
const { latencyStats, bytesAt, confirmedAt, throughput, bloatGrade, summary, lossByPart, upEnd } = await import('../lib/speedtest.js');
const { parseProcRoute, parsePingLine, parseNmcliWifi } = await import('../lib/sysprobe.js');

test('latency: median, lowest, jitter between pings in order, lost ones counted apart', () => {
  const s = latencyStats([10, 12, null, 14, 10]);
  assert.equal(s.n, 4); assert.equal(s.lost, 1);
  assert.equal(s.min, 10); assert.equal(s.median, 11);
  assert.equal(s.jitter, 2.7);          // |12-10| + |14-12| + |10-14| = 8, over 3
  assert.equal(latencyStats([null, null]), null);
});

test('download: bytes by time, interpolated, and speed after the warm-up', () => {
  const raw = []; for (let t = 0; t <= 10000; t += 100) raw.push([t, t * 12500]);   // 100 Mbps exactly
  assert.equal(bytesAt(raw, 150), 150 * 12500);
  const r = throughput((t) => bytesAt(raw, t), 3000, 10000);
  assert.equal(r.mbps, 100); assert.equal(r.peak, 100); assert.equal(r.spread, 0);
  assert.equal(throughput((t) => bytesAt(raw, t), 3000, 3500), null);   // under a second: no figure
});

test('upload: only what the far end confirmed, spread over each request', () => {
  // Two back-to-back 10 MB requests of 1 s each on one connection: 80 Mbps.
  const done = [{ s: 0, e: 1000, size: 10e6 }, { s: 1000, e: 2000, size: 10e6 }];
  assert.equal(confirmedAt(done, 500), 5e6);
  assert.equal(confirmedAt(done, 1500), 15e6);
  assert.equal(throughput((t) => confirmedAt(done, t), 0, 2000).mbps, 80);
});

test('upload window: a stalled connection does not cut it short', () => {
  // Seven connections finished requests up to 9.6-9.9 s; one finished only an early one at 1.2 s.
  assert.equal(upEnd([9800, 9900, 9700, 1200, 9600, 9850, 9750, 9900], 3000), 9600);
  assert.equal(upEnd([1200, 1300, 9000, 0], 3000), 0);          // most stalled: count bytes written instead
});

test('bufferbloat grade by how far latency rises', () => {
  assert.equal(bloatGrade(2), 'A+'); assert.equal(bloatGrade(20), 'A'); assert.equal(bloatGrade(45), 'B');
  assert.equal(bloatGrade(150), 'C'); assert.equal(bloatGrade(300), 'D'); assert.equal(bloatGrade(900), 'F');
  assert.equal(bloatGrade(null), null);
});

test('packet loss is counted apart for quiet and busy, and a late answer is not a loss', () => {
  const seen = new Map();
  for (let i = 1; i <= 10; i++) seen.set(i, { ph: 'idle', ok: i !== 4 });
  for (let i = 11; i <= 30; i++) seen.set(i, { ph: 'down', ok: i % 5 !== 0 });
  const l = lossByPart(seen);
  assert.deepEqual(l.idle, { sent: 10, lost: 1, pct: 10 });
  assert.equal(l.down.lost, 4); assert.equal(l.up, null);
});

test('the words: headline, what it is good for, and the notes that apply', () => {
  const base = { down: { mbps: 900 }, up: { mbps: 40 }, ping: { idle: { median: 14, jitter: 1 }, down: { median: 260 }, up: { median: 30 } },
    bloat: { ms: 246, grade: 'D' }, loss: { idle: { pct: 0 } }, link: { kind: 'wired', linkMbps: 1000 }, gateway: { idle: { median: 0.4 } } };
  const s = summary(base);
  assert.equal(s.headline, 'Very fast: 900 down, 40 up, 14 ms.');
  assert.equal(s.uses.find((u) => u.id === 'calls').level, 'ok');            // busy ping 260 ms
  assert.ok(s.notes.some((n) => /cable to your router runs at 1 Gb\/s/.test(n)));
  assert.ok(s.notes.some((n) => /grade D/.test(n)));
  assert.ok(s.notes.some((n) => /router answers in under 1 ms/.test(n)));
  const calm = summary({ ...base, ping: { idle: { median: 14, jitter: 1 } }, bloat: { ms: 2, grade: 'A+' }, link: { kind: 'wifi', signal: 35 } });
  assert.match(calm.headline, /^Very fast and steady/);
  assert.ok(calm.notes.some((n) => /Wi-Fi signal is weak \(35%\)/.test(n)));
  assert.equal(summary({}), null);
});

test('sysprobe: default route, ping lines, Wi-Fi from nmcli', () => {
  const route = 'Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT\n' +
    'enp6s0\t00000000\t0100A8C0\t0003\t0\t0\t100\t00000000\t0\t0\t0\n' +
    'enp6s0\t0000A8C0\t00000000\t0001\t0\t0\t100\t00FFFFFF\t0\t0\t0\n';
  assert.deepEqual(parseProcRoute(route), { iface: 'enp6s0', gateway: '192.168.0.1' });
  assert.equal(parseProcRoute('Iface\tDestination\n'), null);
  assert.deepEqual(parsePingLine('64 bytes from 1.1.1.1: icmp_seq=7 ttl=58 time=12.3 ms'), { seq: 7, ms: 12.3 });
  assert.deepEqual(parsePingLine('no answer yet for icmp_seq=9'), { seq: 9, lost: true });
  assert.deepEqual(parsePingLine('Reply from 1.1.1.1: bytes=32 time<1ms TTL=58'), { ms: 1 });
  assert.deepEqual(parsePingLine('Request timed out.'), { lost: true });
  assert.equal(parsePingLine('PING 1.1.1.1 (1.1.1.1) 56(84) bytes of data.'), null);
  assert.deepEqual(parseNmcliWifi(' :Next door:40:130 Mbit/s:6\n*:Home\\:5G:72:866 Mbit/s:36\n'), { name: 'Home:5G', signal: 72, linkMbps: 866, channel: 36 });
});
