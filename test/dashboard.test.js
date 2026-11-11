// Project dashboards (lib/dashboard.js, lib/sitecheck.js, lib/sitespeed.js,
// lib/dashreport.js): reading a page, the fixes and numbers a check gives, the
// speed score's curve, numbers of your own, the analysis, the CSV and the report.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-dash-'));
const { db, setSetting } = await import('../lib/db.js');
setSetting('spaces', [{ id: 'acme', name: 'Acme', color: '#2F5D8A' }]);
const { readPage, siteUrl } = await import('../lib/sitecheck.js');
const { curveScore, speedScore, PROFILES } = await import('../lib/sitespeed.js');
const D = await import('../lib/dashboard.js');
const { reportHtml } = await import('../lib/dashreport.js');

test('a page is read for what a search engine sees', () => {
  const p = readPage(`<html lang="en"><head><title>Home &amp; Care | Acme</title><meta name="description" content="We care."><meta name="viewport" content="width=device-width">
    <link rel="canonical" href="https://acme.test/"><script type="application/ld+json">{"@graph":[{"@type":"WebSite"},{"@type":["LocalBusiness","Organization"]}]}</script></head>
    <body><h1>Welcome</h1><h2>a</h2><p>${'word '.repeat(120)}</p><img src="a.png"><img src="b.png" alt="A nurse"><img src="c.png" alt="">
    <a href="/about#team">About</a><a href="mailto:x@acme.test">mail</a><a href="https://other.test/x">out</a><a href="/cdn-cgi/l/email-protection#abc">hidden</a><script>var x = "<h1>not this</h1>";</script></body></html>`, 'https://acme.test/');
  assert.equal(p.title, 'Home & Care | Acme');
  assert.equal(p.description, 'We care.');
  assert.deepEqual(p.h1, ['Welcome']);
  assert.equal(p.images, 3);
  assert.equal(p.noAlt, 2);
  assert.ok(p.words >= 120 && p.words < 130);
  assert.deepEqual(p.schema.sort(), ['LocalBusiness', 'Organization', 'WebSite']);
  assert.deepEqual(p.links, ['https://acme.test/about', 'https://other.test/x']);
  assert.equal(p.viewport, true);
});

test('a web address is made whole, and nonsense is refused', () => {
  assert.equal(siteUrl('acme.test'), 'https://acme.test/');
  assert.equal(siteUrl('http://acme.test/shop/'), 'http://acme.test/shop/');
  assert.equal(siteUrl('not a site'), null);
  assert.equal(siteUrl('ftp://acme.test'), null);
});

test('the speed score follows Lighthouse\'s curve', () => {
  const lcp = PROFILES.mobile.curves.lcp;
  assert.ok(Math.abs(curveScore(lcp, lcp.p10) - 0.9) < 0.01);
  assert.ok(Math.abs(curveScore(lcp, lcp.median) - 0.5) < 0.01);
  assert.ok(curveScore(lcp, 20000) < 0.05);
  assert.equal(speedScore({ fcp: 500, lcp: 800, tbt: 0, cls: 0 }, PROFILES.mobile.curves), 100);
  assert.ok(speedScore({ fcp: 3000, lcp: 11000, tbt: 700, cls: 0.05 }, PROFILES.mobile.curves) < 50);
});

const check = (over = {}) => ({
  url: 'https://acme.test/', at: Date.now(),
  site: { https: true, httpToHttps: true, robots: true, sitemap: 'https://acme.test/sitemap.xml', sitemapUrls: 3, homeMs: 300 },
  pages: [
    { url: 'https://acme.test/', status: 200, ms: 300, title: 'Acme', description: 'Hi', h1: ['A'], words: 500, images: 4, noAlt: 2, schema: ['Organization'], noindex: false },
    { url: 'https://acme.test/a', status: 200, ms: 300, title: 'Same', description: '', h1: [], words: 120, images: 0, noAlt: 0, schema: [], noindex: false },
    { url: 'https://acme.test/b', status: 200, ms: 300, title: 'same', description: 'B', h1: ['B', 'C'], words: 800, images: 1, noAlt: 0, schema: [], noindex: false }
  ],
  linksChecked: 5, broken: [{ url: 'https://acme.test/gone', status: 404, from: ['https://acme.test/'] }],
  speed: { mobile: { score: 41, lcp: 9000, tbt: 600, cls: 0.02, bytes: 2.5e6, requests: 60 }, desktop: { score: 80, lcp: 2000 } }, google: null, ...over
});

test('a check becomes numbers and fixes, worst first', () => {
  const dg = D.digest(check());
  assert.equal(dg.readings['speed.mobile'], 41);
  assert.equal(dg.readings['lcp.mobile'], 9);
  assert.equal(dg.readings['site.broken'], 1);
  assert.equal(dg.readings['site.noDesc'], 1);
  assert.equal(dg.readings['site.dupTitles'], 2);
  assert.equal(dg.readings['site.noH1'], 1);
  assert.equal(dg.readings['site.thin'], 1);
  assert.equal(dg.readings['site.noAlt'], 2);
  assert.equal(dg.readings['site.schema'], 33);
  assert.deepEqual(dg.fixes.slice(0, 2).map((f) => f.sev), ['high', 'high']);
  assert.ok(dg.fixes.some((f) => /local business/i.test(f.what)), 'no LocalBusiness data is a fix');
  const sev = dg.fixes.map((f) => f.sev);
  assert.deepEqual(sev, [...sev].sort((a, b) => ['high', 'medium', 'low'].indexOf(a) - ['high', 'medium', 'low'].indexOf(b)));
});

test('set up, numbers of your own, analysis, CSV and the report', () => {
  assert.throws(() => D.setConfig('nope', { template: 'website' }), /gone/);
  assert.throws(() => D.setConfig('acme', { site: 'not a site' }), /web address/);
  const c = D.setConfig('acme', { template: 'website', site: 'acme.test' });
  assert.equal(c.site, 'https://acme.test/');
  assert.ok(c.tiles.includes('fixes'));

  // A baseline check and a later one, written as runCheck would.
  const put = (at, ch) => {
    const { readings } = D.digest(ch);
    for (const [k, v] of Object.entries(readings)) if (v != null) db.prepare('INSERT OR REPLACE INTO dash_readings (space, metric, at, value) VALUES (?, ?, ?, ?)').run('acme', k, at, v);
    db.prepare('INSERT INTO dash_checks (space, at, url, data) VALUES (?, ?, ?, ?)').run('acme', at, ch.url, JSON.stringify({ ...ch, at }));
  };
  const t0 = Date.now() - 30 * 86400e3;
  put(t0, check());
  put(Date.now() - 1000, check({ broken: [], speed: { mobile: { score: 72, lcp: 3100, tbt: 150, cls: 0.02, bytes: 1.5e6, requests: 40 }, desktop: { score: 95, lcp: 900 } } }));

  const { id } = D.addNumber('acme', { name: 'Google rating', unit: 'stars' });
  assert.equal(id, 'my.google-rating');
  assert.throws(() => D.addReading('acme', { metric: id, value: 'lots' }), /number/);
  D.addReading('acme', { metric: id, value: '4.2', at: t0 });
  D.addReading('acme', { metric: id, value: '4.6' });

  const cmp = D.compare('acme');
  assert.equal(cmp['speed.mobile'].change, 31);
  assert.equal(cmp['speed.mobile'].good, true);
  assert.equal(cmp['site.broken'].good, true);
  assert.equal(cmp[id].now[1], 4.6);

  const words = D.analysis('acme').join(' ');
  assert.match(words, /scores 72 of 100/);
  assert.match(words, /Since the baseline/);
  assert.match(words, /speed score, phone 41\/100 → 72\/100/);
  assert.match(words, /Google rating: 4\.6 stars \(\+0\.4 stars/);

  const csv = D.csv('acme').split('\n');
  assert.equal(csv[0], 'date,measure,value,unit');
  assert.ok(csv.some((l) => l.includes('Google rating,4.6,stars')));

  const html = reportHtml('acme');
  assert.match(html, /Website report: acme\.test/);
  assert.match(html, /What to fix, worst first/);
  assert.match(html, /<svg class="rp-chart"/);
  assert.ok(!/<script/i.test(html), 'the report runs no script');

  D.forgetNumber('acme', id);
  assert.equal(D.compare('acme')[id], undefined);
});

test('robots.txt: AI search crawlers in or out, by their own group or the * group', async () => {
  const { robotsAllows } = await import('../lib/sitecheck.js');
  const robots = `User-agent: *\nContent-Signal: search=yes\nAllow: /\n\nUser-agent: GPTBot\nDisallow: /\n\nUser-agent: AwarioSmartBot\nUser-agent: PerplexityBot\nDisallow: /\n\nUser-agent: Googlebot\nDisallow: /private/\n`;
  assert.equal(robotsAllows(robots, 'GPTBot'), false);
  assert.equal(robotsAllows(robots, 'OAI-SearchBot'), true);
  assert.equal(robotsAllows(robots, 'PerplexityBot'), false, 'a group of several user-agents');
  assert.equal(robotsAllows(robots, 'Googlebot'), true, 'only a folder shut');
  assert.equal(robotsAllows('', 'Bingbot'), true);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /', 'Bingbot'), false);
});

test('tracking tags: on the page, in Tag Manager, and what the page really sent', async () => {
  const { findTags } = await import('../lib/sitecheck.js');
  const t = findTags('<script src="https://www.googletagmanager.com/gtm.js?id=GTM-ABC123"></script>', '"vtp_tagId":"AW-123456789" G-XYZ12345', ['www.google-analytics.com/g/collect', 'cdn.callrail.com/companies/']);
  assert.deepEqual(t.gtm, ['GTM-ABC123']);
  assert.deepEqual(t.ads, ['AW-123456789']);
  assert.deepEqual(t.ga4, ['G-XYZ12345']);
  assert.equal(t.ga4Sends, true);
  assert.equal(t.calls, 'CallRail');
  assert.equal(t.meta, false);
});

test('the SEO score and AI search readiness are made of named parts', () => {
  const ai = { robots: { 'OAI-SearchBot': true, 'ChatGPT-User': true, PerplexityBot: false, Googlebot: true, Bingbot: true, 'Claude-SearchBot': true, GPTBot: false }, llms: null, cloudflare: true };
  const tags = { gtm: ['GTM-ABC123'], ga4: [], ua: [], ads: [], ga4Sends: true, adsSends: false, meta: false, bing: false, calls: null };
  const dg = D.digest(check({ ai, tags }));
  assert.ok(dg.scores.seo.score > 0 && dg.scores.seo.score < 100);
  assert.ok(dg.scores.ai.score > 0 && dg.scores.ai.score < 100);
  assert.equal(dg.readings['ai.searchBots'], 5);
  assert.equal(dg.readings['track.tags'], 1);
  assert.ok(dg.fixes.some((f) => /AI search can't read the site: Perplexity/.test(f.what)));
  assert.ok(dg.fixes.some((f) => /Google Ads conversion/.test(f.what)));
  assert.ok(!dg.fixes.some((f) => /No Google Analytics/.test(f.what)), 'analytics that really sends counts');
  assert.equal(dg.scores.ai.parts.reduce((t, p) => t + p.weight, 0), 100);
});
