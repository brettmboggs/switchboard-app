// How fast a website loads, measured here: a headless Chromium (the one browser
// checks installed, or Chrome; lib/desktop.js chromiumPath) opens the page once
// as a mid-range phone on a slow mobile connection and once as a desktop, the
// way Google's Lighthouse does, and reads what the browser itself reports:
// first paint (FCP), largest paint (LCP), layout shift (CLS), time the page was
// too busy to answer a tap (TBT), load time, page weight and requests. The
// score uses Lighthouse's own curves and weights (without Speed Index), so it
// lands close to Google's number but is not it: the dashboard says so.
//
// Google's own PageSpeed scores need a free key (Google refuses calls without
// one); with a key in Settings, lib/sitecheck.js asks Google as well.
//
// The browser is lib/headless.js's: started for the test and closed after it.
import { setTimeout as wait } from 'node:timers/promises';
import { openBrowser } from './headless.js';

// Lighthouse 10+: the phone it pretends to be, its slow 4G and 4x slower CPU,
// and the curves a value is scored on ({ p10, median }: p10 scores 90, median 50).
export const PROFILES = {
  mobile: {
    width: 412, height: 823, dpr: 1.75, mobile: true, cpu: 4,
    ua: 'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
    net: { latency: 562.5, downloadThroughput: 1474.56 * 1024 / 8, uploadThroughput: 675 * 1024 / 8 },
    curves: { fcp: { p10: 1800, median: 3000 }, lcp: { p10: 2500, median: 4000 }, tbt: { p10: 200, median: 600 }, cls: { p10: 0.1, median: 0.25 } }
  },
  desktop: {
    width: 1350, height: 940, dpr: 1, mobile: false, cpu: 1,
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    net: { latency: 40, downloadThroughput: 10240 * 1024 / 8, uploadThroughput: 10240 * 1024 / 8 },
    curves: { fcp: { p10: 934, median: 1600 }, lcp: { p10: 1200, median: 2400 }, tbt: { p10: 150, median: 350 }, cls: { p10: 0.1, median: 0.25 } }
  }
};
const WEIGHTS = { fcp: 10, lcp: 25, tbt: 30, cls: 25 };
const RUNS = 3;   // runs per device; the middle one is kept   // Lighthouse's, less Speed Index's 10

// Lighthouse's log-normal scoring (lighthouse-core/lib/statistics.js).
function erfc(x) {   // Abramowitz and Stegun 7.1.26, good to 1e-7
  const z = Math.abs(x), t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}
export function curveScore({ p10, median }, value) {
  if (!(value > 0)) return 1;
  const INV_ERFC_ONE_FIFTH = 0.9061938024368232;
  const x = Math.log(value / median) * INV_ERFC_ONE_FIFTH / -Math.log(p10 / median);
  const s = erfc(x) / 2;
  return Math.min(1, Math.max(0, s));
}
export function speedScore(m, curves) {
  let sum = 0, w = 0;
  for (const [k, weight] of Object.entries(WEIGHTS)) if (m[k] != null) { sum += curveScore(curves[k], m[k]) * weight; w += weight; }
  return w ? Math.round(sum / w * 100) : null;
}

// What the page records about itself, set before any of its own code runs.
const OBSERVE = `(() => {
  const sb = window.__sb = { lcp: 0, fcp: 0, shifts: [], tasks: [] };
  const on = (type, fn) => { try { new PerformanceObserver((l) => l.getEntries().forEach(fn)).observe({ type, buffered: true }); } catch {} };
  on('largest-contentful-paint', (e) => { sb.lcp = e.startTime; });
  on('paint', (e) => { if (e.name === 'first-contentful-paint') sb.fcp = e.startTime; });
  on('layout-shift', (e) => { if (!e.hadRecentInput) sb.shifts.push([e.startTime, e.value]); });
  on('longtask', (e) => { sb.tasks.push([e.startTime, e.duration]); });
})();`;
const READ = `JSON.stringify((() => {
  const sb = window.__sb || { shifts: [], tasks: [] }, nav = performance.getEntriesByType('navigation')[0] || {};
  let cls = 0, win = 0, first = -1, last = -1;   // the worst burst of shifts (1 s apart at most, 5 s long at most), as Chrome counts CLS
  for (const [t, v] of sb.shifts) { if (first < 0 || t - last > 1000 || t - first > 5000) { win = 0; first = t; } win += v; last = t; cls = Math.max(cls, win); }
  const tbt = sb.tasks.filter(([t]) => t >= sb.fcp).reduce((s, [, d]) => s + Math.max(0, d - 50), 0);
  return { fcp: sb.fcp || null, lcp: sb.lcp || sb.fcp || null, cls, tbt, ttfb: nav.responseStart || null, load: nav.loadEventEnd || null };
})())`;

async function measureOne(cdp, url, profile) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: s } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const urls = new Set();   // where the page sent requests: which tracking tags really run (lib/sitecheck.js)
  let bytes = 0, requests = 0, inflight = 0, lastNet = Date.now(), loaded = false, status = 0, mainId = null;
  const off = cdp.on((m) => {
    if (m.sessionId !== s) return;
    if (m.method === 'Network.requestWillBeSent') { if (urls.size < 400) { try { const u = new URL(m.params.request.url); urls.add(u.hostname + u.pathname.slice(0, 40)); } catch {} } requests++; inflight++; lastNet = Date.now(); if (!mainId && m.params.type === 'Document') mainId = m.params.requestId; }
    else if (m.method === 'Network.responseReceived' && m.params.requestId === mainId) status = m.params.response.status;
    else if (m.method === 'Network.loadingFinished') { bytes += m.params.encodedDataLength || 0; inflight = Math.max(0, inflight - 1); lastNet = Date.now(); }
    else if (m.method === 'Network.loadingFailed') { inflight = Math.max(0, inflight - 1); lastNet = Date.now(); }
    else if (m.method === 'Page.loadEventFired') loaded = true;
  });
  try {
    for (const [m, p] of [['Page.enable'], ['Network.enable'], ['Network.setCacheDisabled', { cacheDisabled: true }], ['Network.clearBrowserCache'],
      ['Emulation.setDeviceMetricsOverride', { width: profile.width, height: profile.height, deviceScaleFactor: profile.dpr, mobile: profile.mobile }],
      ['Emulation.setUserAgentOverride', { userAgent: profile.ua }], ['Emulation.setCPUThrottlingRate', { rate: profile.cpu }],
      ['Network.emulateNetworkConditions', { offline: false, ...profile.net }], ['Page.addScriptToEvaluateOnNewDocument', { source: OBSERVE }]]) await cdp.send(m, p || {}, s);
    const started = Date.now();
    const nav = await cdp.send('Page.navigate', { url }, s);
    if (nav.errorText) throw new Error(`The page did not open (${nav.errorText}).`);
    // Until it has loaded and the network has been quiet for 2 seconds (at most a minute).
    while (Date.now() - started < 60e3 && !(loaded && inflight <= 2 && Date.now() - lastNet > 2000)) await wait(250);
    await wait(1000);
    const r = await cdp.send('Runtime.evaluate', { expression: READ, returnByValue: true }, s);
    // A firewall's answer (Cloudflare and the like turn automated browsers away) is not the site: no score for it.
    if (status >= 400) throw Object.assign(new Error(status === 429 ? 'The site asked the test browser to slow down (429), even after a pause. Check again later; Google\'s own test (a PageSpeed key) usually gets through.' : `The site turned the test browser away (${status}). Its firewall blocks automated browsers. Google's own test (a PageSpeed key in the dashboard's settings) usually gets through, or the site's owner can let it in.`), { blocked: status });
    const m = JSON.parse(r.result?.value || '{}');
    const out = { ...m, bytes, requests, status, timedOut: !loaded, urls: [...urls] };
    out.score = speedScore(out, profile.curves);
    return out;
  } finally { off(); await cdp.send('Target.closeTarget', { targetId }).catch(() => {}); }
}

// { mobile: {...}, desktop: {...} }; a side that fails has { error }.
export async function measureSpeed(url) {
  const b = await openBrowser();
  try {
    const out = {};
    // Three runs each, keeping the one with the middle score: one run swings by ten points or more
    // (Google says the same of its own test), and a baseline has to be a fair number.
    for (const k of ['mobile', 'desktop']) {
      const runs = [];
      let last = null;
      for (let n = 0; n < RUNS && runs.length < RUNS; n++) {
        try { runs.push(await measureOne(b.cdp, url, PROFILES[k])); }
        catch (e) {
          last = { error: e.message, blocked: e.blocked || null };
          if (e.blocked !== 429) break;
          await wait(20e3);   // "slow down": once more after a pause
        }
      }
      if (!runs.length) { out[k] = last; continue; }
      runs.sort((x, y) => (x.score ?? 0) - (y.score ?? 0));
      out[k] = { ...runs[Math.floor((runs.length - 1) / 2)], runs: runs.map((r) => r.score) };
    }
    return out;
  } finally { b.close(); }
}
