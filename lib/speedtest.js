// Network test: how fast this computer's internet really is (the Network test
// window, public/js/speedtest.js; Settings, System and the monitor's Network
// card open it). It runs here on the server, not in the page: the browser's own
// limits never show in the numbers, and the page still talks only to Switchboard.
//
// The far end is Cloudflare's public speed test (speed.cloudflare.com: free, no
// account, answered from the nearest of its cities). What is measured, and how:
// - Latency: the time to open a connection (a TCP handshake), 20 times with the
//   line idle. That is one round trip and nothing else: no browser, no server work.
// - Download, then upload: 8 connections at once for 10 seconds each, counted
//   from when data starts moving (Cloudflare can take a few seconds to accept). Downloads
//   ask for 25 to 50 MB at a time (few, big requests: Cloudflare turns away a
//   flood of small ones, and whatever is left at 10 s is simply cut off);
//   uploads grow from 1 MB to about 2 s each. The first 3 seconds (TCP finding
//   its speed) are left out; the result is the bytes after that over the time.
//   Upload counts only what Cloudflare confirmed it received, spread over the
//   time each request took, so data still waiting in this computer's buffers
//   never counts.
// - Latency under load: the same handshake every 250 ms while each transfer
//   runs. How far it rises is bufferbloat: why calls stutter while someone
//   else downloads.
// - Packet loss and your router: ping to 1.1.1.1 and to the default gateway for
//   the whole test (lib/sysprobe.js), so a slow result can be put down to the
//   Wi-Fi or to the internet beyond it. Loss is counted apart for the quiet
//   five seconds and for the busy part: a full line drops a few packets by
//   design (that is how TCP finds its speed), so only the quiet figure judges it.
// Only test data is sent. Results are kept on this computer (speed_tests),
// without the public IP address.
import https from 'node:https';
import net from 'node:net';
import { lookup } from 'node:dns/promises';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { db } from './db.js';
import { friendlyError } from './friendly.js';
import { defaultRoute, netLink, pingStream } from './sysprobe.js';

const HOST = 'speed.cloudflare.com';
const UA = 'Switchboard-network-test';
export const PLAN = { streams: 8, phaseMs: 10000, warmMs: 3000, lateMs: 6000, flowBytes: 256 << 10, pings: 25, pingEvery: 200, loadedEvery: 250, tick: 100 };

db.exec(`CREATE TABLE IF NOT EXISTS speed_tests (at INTEGER PRIMARY KEY, down REAL, up REAL, ping REAL, data TEXT NOT NULL)`);

const now = () => performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r1 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10) / 10);
const mbps = (bytes, ms) => (ms > 0 ? bytes * 8 / ms / 1000 : 0);

// ---------- the numbers (pure, tested in test/speedtest.test.js)

// Latency figures from a list of round trips in the order taken (null = no answer).
export function latencyStats(list) {
  const ok = list.filter((x) => x != null);
  if (!ok.length) return null;
  const s = [...ok].sort((a, b) => a - b), q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  let jit = 0; for (let i = 1; i < ok.length; i++) jit += Math.abs(ok[i] - ok[i - 1]);
  return { n: ok.length, lost: list.length - ok.length, min: r1(s[0]), median: r1(s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2), p90: r1(q(0.9)), max: r1(s[s.length - 1]), jitter: r1(ok.length > 1 ? jit / (ok.length - 1) : 0) };
}
// Bytes received by time t, from the running tally sampled as [ms, bytes].
export function bytesAt(raw, t) {
  if (!raw.length) return 0;
  if (t <= raw[0][0]) return raw[0][1];
  for (let i = 1; i < raw.length; i++) if (raw[i][0] >= t) { const [t0, b0] = raw[i - 1], [t1, b1] = raw[i]; return b0 + (b1 - b0) * (t - t0) / (t1 - t0 || 1); }
  return raw[raw.length - 1][1];
}
// Bytes the far end had by time t, from finished uploads [{ s, e, size }]: each
// request's bytes spread evenly over its time on the wire (half a round trip in
// from each end).
export function confirmedAt(done, t, rtt = 0) {
  let b = 0;
  for (const d of done) {
    const s = d.s + rtt / 2, e = Math.max(s + 1, d.e - rtt / 2);
    b += d.size * Math.min(1, Math.max(0, (t - s) / (e - s)));
  }
  return b;
}
// Speed in Mbps over [a, b] from a bytes-by-time function, and the steadiness:
// the best second, and how much the seconds differ (0 = perfectly even).
export function throughput(at, a, b) {
  if (!(b - a >= 1000)) return null;
  const total = mbps(at(b) - at(a), b - a), secs = [];
  for (let t = a; t + 1000 <= b + 1; t += 500) secs.push(mbps(at(t + 1000) - at(t), 1000));
  const mean = secs.reduce((x, y) => x + y, 0) / (secs.length || 1);
  const sd = Math.sqrt(secs.reduce((x, y) => x + (y - mean) ** 2, 0) / (secs.length || 1));
  return { mbps: r1(total), peak: r1(Math.max(...secs, total)), spread: mean > 0 ? Math.round(sd / mean * 100) / 100 : 0 };
}
// Bufferbloat: how far latency rises under load, as a grade (the scale DSLReports and Waveform use).
// Where the upload's counted window ends: when every connection that was still
// moving after the warm-up had finished its requests. A stalled one is left out;
// fewer than half moving gives 0 (count the bytes written instead).
export function upEnd(lastDone, warm) {
  const moving = lastDone.filter((x) => x > warm);
  return moving.length >= lastDone.length / 2 ? Math.min(...moving) : 0;
}
export function bloatGrade(ms) {
  if (ms == null) return null;
  return ms < 5 ? 'A+' : ms < 30 ? 'A' : ms < 60 ? 'B' : ms < 200 ? 'C' : ms < 400 ? 'D' : 'F';
}

// What the result means, in words: a headline, what it is good for, and notes.
export function summary(r) {
  if (!r || r.down?.mbps == null) return null;
  const d = r.down.mbps, u = r.up?.mbps ?? 0, p = r.ping?.idle?.median ?? null, jit = r.ping?.idle?.jitter ?? 0;
  const rise = r.bloat?.ms ?? 0, loss = r.loss?.idle?.pct ?? 0;
  const f = (n) => (n >= 100 ? Math.round(n) : n >= 10 ? n.toFixed(0) : n.toFixed(1));
  const speedWord = d >= 500 ? 'Very fast' : d >= 100 ? 'Fast' : d >= 25 ? 'Good' : d >= 10 ? 'Slow' : 'Very slow';
  const steady = rise < 60 && jit < 15 && loss < 1;
  const headline = `${speedWord}${steady ? ' and steady' : ''}: ${f(d)} down, ${f(u)} up, ${p == null ? '?' : Math.round(p)} ms.`;
  const lvl = (good, ok) => (good ? 'good' : ok ? 'ok' : 'poor');
  const loadedPing = Math.max(r.ping?.down?.median ?? 0, r.ping?.up?.median ?? 0) || p || 0;
  const hours = (gb, m) => { const s = gb * 8000 / m; return s < 90 ? `${Math.round(s)} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`; };
  const uses = [
    { id: 'stream', name: '4K video', level: lvl(d >= 25, d >= 15), note: d >= 25 ? `room for ${Math.max(1, Math.floor(d / 25))} at once` : 'may drop to HD' },
    { id: 'calls', name: 'Video calls', level: lvl(u >= 3 && d >= 4 && loadedPing < 150 && jit < 30 && loss < 2, u >= 1.5 && loadedPing < 300), note: u >= 3 ? (loadedPing >= 150 ? 'may stutter while something downloads' : 'smooth, even with others online') : 'your picture may freeze' },
    { id: 'games', name: 'Online games', level: lvl(p != null && p < 40 && jit < 10 && rise < 30 && loss < 0.5, p != null && p < 80 && rise < 100), note: p == null ? '' : `${Math.round(p)} ms${rise >= 30 ? `, ${Math.round(loadedPing)} ms while busy` : ''}` },
    { id: 'big', name: '50 GB download', level: lvl(d >= 100, d >= 25), note: hours(50, d) },
    { id: 'backup', name: '10 GB upload', level: lvl(u >= 50, u >= 10), note: u > 0 ? hours(10, u) : '' }
  ];
  const notes = [];
  const cap = r.link?.linkMbps;
  if (cap && r.link.kind === 'wired' && d >= cap * 0.8) notes.push(`The cable to your router runs at ${cap >= 1000 ? cap / 1000 + ' Gb/s' : cap + ' Mb/s'}, so this test cannot show more than that${cap <= 100 ? '. A Cat 5e or better cable, or a gigabit port, would lift it.' : '.'}`);
  if (r.link?.kind === 'wifi' && r.link.signal != null && r.link.signal < 50) notes.push(`The Wi-Fi signal is weak (${r.link.signal}%). Closer to the router, or on a cable, this will likely be faster.`);
  if (r.bloat?.grade && /[CDF]/.test(r.bloat.grade)) notes.push(`Latency rises by ${Math.round(rise)} ms when the line is busy (grade ${r.bloat.grade}). Calls and games will stutter while something big downloads; a router with Smart Queue (SQM, or "QoS") fixes most of it.`);
  const late = Math.max(r.down?.flowS || 0, r.up?.flowS || 0);
  if (late >= 2) notes.push(`Cloudflare took ${Math.round(late)} s to start taking data, so the clock started when it did. If that keeps happening, try again in a while.`);
  if ((r.down?.throttled || 0) + (r.up?.throttled || 0) >= 3) notes.push('Cloudflare held this test back (this address has run several tests lately), so the speeds may read low. Try again in a while for a cleaner figure.');
  if (loss >= 1) notes.push(`${loss.toFixed(1)}% of pings got no answer with the line quiet. Even 1% makes calls choppy; if it stays like this, it is worth telling your provider.`);
  const gw = r.gateway?.idle?.median, gwLoad = Math.max(r.gateway?.down?.median ?? 0, r.gateway?.up?.median ?? 0);
  if (gw != null && p != null) {
    if (gw > 10 || gwLoad > 40) notes.push(`Your router takes ${Math.round(Math.max(gw, gwLoad))} ms to answer${gwLoad > gw * 3 && gwLoad > 20 ? ' when the line is busy' : ''}: some of the delay is inside your home (Wi-Fi, or the router itself).`);
    else if (p > 5) notes.push(`Your router answers in ${gw < 1 ? 'under 1' : Math.round(gw)} ms, so the ${Math.round(p)} ms is spent out on the internet, not in your home.`);
  }
  return { headline, uses, notes };
}

// ---------- the run
let cur = null, seq = 0;

function hello() {
  return new Promise((ok, fail) => {
    const req = https.get({ host: HOST, path: '/__down?bytes=0', headers: { 'user-agent': UA }, timeout: 8000 }, (res) => {
      res.resume();
      const h = res.headers;
      if (res.statusCode !== 200) return fail(Object.assign(new Error(`HTTP ${res.statusCode}`), { status: res.statusCode }));
      ok({ colo: h.colo || h['cf-meta-colo'] || null, city: h.city || null, country: h.country || null, asn: h.asn || null, ip: h['cf-meta-ip'] || null });
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })));
    req.on('error', fail);
  });
}

// One TCP handshake to the test server, in ms (null: no answer in 3 s).
function tcpPing(ip) {
  return new Promise((ok) => {
    const t0 = now(), s = net.connect({ host: ip, port: 443 });
    const done = (v) => { s.destroy(); ok(v); };
    s.setTimeout(3000, () => done(null));
    s.once('connect', () => done(now() - t0));
    s.once('error', () => done(null));
  });
}

// The next request's size: aimed at about 2 s, at most 4 times bigger or half
// the last, never over what Cloudflare is accepting right now (cap).
const nextSize = (size, ms, cap) => Math.min(cap, Math.max(250e3, Math.round(size * Math.min(4, Math.max(0.5, 2000 / Math.max(ms, 1))))));
const httpError = (code) => Object.assign(new Error(`HTTP ${code}`), { status: code });

// One direction: PLAN.streams connections for PLAN.phaseMs, pinging alongside.
async function transfer(T, dir) {
  const P = T[dir], agent = new https.Agent({ keepAlive: true, maxSockets: PLAN.streams }), reqs = new Set();
  const t0 = now(); P.start = Date.now();
  let stop = false, errors = 0, lastErr = null, busy = 0, throttled = 0;
  let cap = dir === 'down' ? 50e6 : 32e6;   // Cloudflare turns big requests away when an address has tested a lot lately
  const live = { bytes: 0 };            // received (down) or handed to the network (up)
  const done = [];                      // up: finished requests { s, e, size, stream }
  const lastDone = new Array(PLAN.streams).fill(0);
  const buf = dir === 'up' ? randomBytes(1 << 20) : null;
  const track = (req) => { reqs.add(req); req.on('close', () => reqs.delete(req)); };
  // A failed request is tried again shortly. Turned away (429 or 403): the size
  // halves for every connection and it goes again at once; turned away even at
  // the smallest size, it waits longer each time.
  const failed = (e, again, size) => {
    if (stop) return;
    errors++; lastErr = e;
    if (e.status === 429 || e.status === 403) {
      throttled++;
      if (size > 250e3) { cap = Math.max(250e3, Math.min(cap, Math.round(size / 2))); return setTimeout(again, 100); }
      busy++; return setTimeout(again, Math.min(4000, 400 * 2 ** Math.min(4, busy)));
    }
    setTimeout(again, 250);
  };

  const down = () => {
    let size = 4e6;
    const go = () => {
      if (stop) return;
      size = Math.min(size, cap);
      const s = now(), want = size;
      const req = https.get({ host: HOST, path: `/__down?bytes=${want}`, agent, headers: { 'user-agent': UA } }, (res) => {
        if (res.statusCode !== 200) { res.resume(); return failed(httpError(res.statusCode), go, want); }
        res.on('data', (c) => { live.bytes += c.length; });
        res.on('end', () => { size = nextSize(want, now() - s, cap); go(); });
        res.on('error', () => {});
      });
      req.on('error', (e) => failed(e, go, want)); track(req);
    };
    go();
  };
  const up = (k) => {
    let size = 1e6;
    const go = () => {
      if (stop) return;
      size = Math.min(size, cap);
      const s = now(), want = size;
      const req = https.request({ host: HOST, path: '/__up', method: 'POST', agent, headers: { 'user-agent': UA, 'content-type': 'application/octet-stream', 'content-length': want } }, (res) => {
        res.resume();
        res.on('end', () => {
          if (res.statusCode !== 200) return failed(httpError(res.statusCode), go, want);
          const e = now(); done.push({ s: s - t0, e: e - t0, size: want }); lastDone[k] = e - t0;
          size = nextSize(want, e - s, cap); go();
        });
      });
      req.on('error', (e) => failed(e, go, want)); track(req);
      let sent = 0, off = 0;
      const pump = () => {
        while (sent < want && !stop) {
          const n = Math.min(256 << 10, want - sent), chunk = buf.subarray(off, off + n);
          off = (off + n) % ((1 << 20) - (256 << 10)); sent += n;
          if (!req.write(chunk, () => { live.bytes += n; })) return req.once('drain', pump);
        }
        if (sent >= want) req.end();
      };
      pump();
    };
    go();
  };
  for (let k = 0; k < PLAN.streams; k++) setTimeout(() => (dir === 'down' ? down : up)(k), k * 25);

  // Latency under load, and the tally ten times a second.
  const pings = (async () => { while (!stop) { const t = now(); const ms = await tcpPing(T.ip); if (!stop) T.lat[dir].push(ms == null ? null : r1(ms)); await sleep(Math.max(0, PLAN.loadedEvery - (now() - t))); } })();
  // The ten seconds start when data starts moving: Cloudflare sometimes takes
  // a few seconds to take the connections, and that wait is not the line's speed.
  P.raw = [[0, 0]];
  let lastB = 0, flowAt = null;
  while (now() - t0 < Math.min(flowAt == null ? Infinity : flowAt + PLAN.phaseMs, PLAN.phaseMs + PLAN.lateMs) && !T.stopAsked) {
    await sleep(PLAN.tick);
    const t = now() - t0; P.raw.push([t, live.bytes]);
    if (flowAt == null && live.bytes >= PLAN.flowBytes) flowAt = t;
    const back = bytesAt(P.raw, t - 1000);
    P.live = r1(mbps(live.bytes - back, Math.min(1000, t)));
    if (P.raw.length % 2 === 0) { P.trace.push([r1(t / 1000), P.live]); }
    if (errors > 40 && live.bytes === lastB) break;          // nothing moving and every request failing
    lastB = live.bytes;
  }
  stop = true;
  const end = now() - t0;
  for (const r of reqs) r.destroy();
  agent.destroy();
  await pings;

  if (live.bytes === 0) throw lastErr || new Error('No data moved');
  const from = flowAt ?? 0, warm = from + Math.min(PLAN.warmMs, (end - from) / 3), rtt = T.ping?.idle?.min || 0;
  let res = null;
  if (dir === 'up' && done.length) {
    // Up to the moment every connection that was moving had finished its
    // requests; one that stalled (nothing finished after the warm-up) is left
    // out rather than cutting the window short. Too few left: the bytes written.
    const te = upEnd(lastDone, warm);
    if (te - warm >= 2000) res = throughput((t) => confirmedAt(done, t, rtt), warm, te);
  }
  if (!res) res = throughput((t) => bytesAt(P.raw, t), warm, end);
  Object.assign(P, res || { mbps: r1(mbps(live.bytes, end)), peak: null, spread: null }, { bytes: live.bytes, ms: Math.round(end), errors, throttled, flowS: r1(from / 1000), warmS: r1(warm / 1000) });
  P.live = P.mbps;
  delete P.raw;
}

async function run(T) {
  let gwPing = null, netPing = null;
  try {
    T.phase = 'starting';
    const route = await defaultRoute().catch(() => null);
    netLink(route).then((l) => { T.link = l; }).catch(() => {});
    const t = now(); const addr = await lookup(HOST); T.dnsMs = r1(now() - t); T.ip = addr.address;
    T.server = await hello();
    // Each ping lands in the part of the test it was answered in; a lost one is
    // remembered by its number, in case its answer turns up late.
    const part = () => (T.phase === 'download' ? 'down' : T.phase === 'upload' ? 'up' : 'idle');
    let n = 0;
    const tag = (list, seen) => (x) => {
      const key = x.seq ?? 'w' + n++, e = seen.get(key) || { ph: part(), ok: false };
      if (!x.lost) { e.ok = true; list[part()].push(r1(x.ms)); }
      seen.set(key, e);
    };
    if (route?.gateway) gwPing = pingStream(route.gateway, tag(T.gw, new Map()), 0.25);
    netPing = pingStream('1.1.1.1', tag(T.icmp, T.icmpSeen), 0.2);

    T.phase = 'latency';
    for (let i = 0; i < PLAN.pings && !T.stopAsked; i++) {
      const t0 = now(), ms = await tcpPing(T.ip);
      T.lat.idle.push(ms == null ? null : r1(ms));
      await sleep(Math.max(0, PLAN.pingEvery - (now() - t0)));
    }
    if (T.stopAsked) throw Object.assign(new Error('stopped'), { stopped: true });
    T.phase = 'download'; await transfer(T, 'down');
    if (T.stopAsked) throw Object.assign(new Error('stopped'), { stopped: true });
    T.phase = 'upload'; await transfer(T, 'up');
    if (T.stopAsked) throw Object.assign(new Error('stopped'), { stopped: true });
    T.phase = 'done';
  } catch (e) {
    T.phase = e.stopped || T.stopAsked ? 'stopped' : 'error';
    if (T.phase === 'error') { console.error('network test:', e); T.error = e.status === 429 ? 'Cloudflare asked Switchboard to slow down after several tests in a row. Wait a minute and run it again.' : friendlyError(e, 'Cloudflare\'s speed test'); }
  } finally {
    netPing?.stop(); gwPing?.stop();
    T.loss = lossByPart(T.icmpSeen);
    finish(T);
  }
}

export function lossByPart(seen) {
  const out = {};
  for (const ph of ['idle', 'down', 'up']) {
    const list = [...seen.values()].filter((e) => e.ph === ph), lost = list.filter((e) => !e.ok).length;
    out[ph] = list.length >= 5 ? { sent: list.length, lost, pct: r1(lost / list.length * 100) } : null;
  }
  return out.idle || out.down || out.up ? out : null;
}

function finish(T) {
  for (const k of ['idle', 'down', 'up']) { T.ping[k] = latencyStats(T.lat[k]); T.gateway[k] = latencyStats(T.gw[k]); T.icmpStats[k] = latencyStats(T.icmp[k]); }
  const idle = T.ping.idle?.median, rise = Math.max(T.ping.down?.median ?? 0, T.ping.up?.median ?? 0) - (idle ?? 0);
  if (idle != null && (T.ping.down || T.ping.up)) T.bloat = { ms: r1(Math.max(0, rise)), grade: bloatGrade(Math.max(0, rise)) };
  T.endedAt = Date.now();
  if (T.phase === 'done') {
    T.summary = summary(T);
    const rec = record(T);
    db.prepare('INSERT OR REPLACE INTO speed_tests (at, down, up, ping, data) VALUES (?, ?, ?, ?, ?)').run(T.at, T.down.mbps, T.up.mbps, T.ping.idle?.median ?? null, JSON.stringify(rec));
  }
}

// What is kept: everything but the IP address and the raw samples.
function record(T) {
  const { colo, city, country, asn } = T.server || {};
  return { at: T.at, server: { colo, city, country, asn }, link: T.link, dnsMs: T.dnsMs, ping: T.ping, gateway: T.gateway, icmp: T.icmpStats, loss: T.loss, bloat: T.bloat, lat: T.lat,
    down: { mbps: T.down.mbps, peak: T.down.peak, spread: T.down.spread, bytes: T.down.bytes, throttled: T.down.throttled, flowS: T.down.flowS, warmS: T.down.warmS, trace: T.down.trace }, up: { mbps: T.up.mbps, peak: T.up.peak, spread: T.up.spread, bytes: T.up.bytes, throttled: T.up.throttled, flowS: T.up.flowS, warmS: T.up.warmS, trace: T.up.trace }, summary: T.summary };
}

export function startTest() {
  if (cur && !['done', 'error', 'stopped'].includes(cur.phase)) return { error: 'A test is already running. Wait for it to finish, or stop it first.' };
  const blank = () => ({ idle: [], down: [], up: [] });
  cur = { id: ++seq, at: Date.now(), phase: 'starting', server: null, link: null, ip: null, dnsMs: null,
    lat: blank(), gw: blank(), icmp: blank(), icmpSeen: new Map(), ping: {}, gateway: {}, icmpStats: {}, loss: null, bloat: null,
    down: { live: 0, trace: [] }, up: { live: 0, trace: [] }, plan: PLAN };
  run(cur);
  return { ok: true, id: cur.id };
}
export function stopTest() { if (cur && !['done', 'error', 'stopped'].includes(cur.phase)) cur.stopAsked = true; return { ok: true }; }

const ST_RUN = (T) => !['done', 'error', 'stopped'].includes(T.phase);
const live3 = (l) => ({ idle: latencyStats(l.idle), down: latencyStats(l.down), up: latencyStats(l.up) });
// The running (or last) test for the page.
export function testState() {
  if (!cur) return null;
  const T = cur, el = (T.endedAt || Date.now()) - T.at;
  return { id: T.id, at: T.at, phase: T.phase, elapsed: el, server: T.server, link: T.link, dnsMs: T.dnsMs, lat: T.lat, ping: ST_RUN(T) ? live3(T.lat) : T.ping,
    gateway: ST_RUN(T) ? live3(T.gw) : T.gateway, icmp: ST_RUN(T) ? live3(T.icmp) : T.icmpStats, loss: T.loss, bloat: T.bloat, down: { ...T.down, raw: undefined }, up: { ...T.up, raw: undefined }, summary: T.summary || null, error: T.error || null, plan: PLAN };
}
export function testHistory(limit = 60) {
  return db.prepare('SELECT at, down, up, ping, data FROM speed_tests ORDER BY at DESC LIMIT ?').all(limit).map((r) => { try { return JSON.parse(r.data); } catch { return { at: r.at, down: { mbps: r.down }, up: { mbps: r.up } }; } });
}
export function forgetTest(at) { db.prepare('DELETE FROM speed_tests WHERE at = ?').run(Number(at)); return { ok: true }; }
