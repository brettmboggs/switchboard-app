// A project dashboard's report (lib/dashboard.js): one clean document to hand
// someone, on white paper, made from the same numbers as the dashboard. Served
// as a page (GET /api/projects/<id>/dashboard/report) and printed to PDF by
// lib/headless.js, so the PDF and the page are the same thing.
//
// In order: the headline numbers, what they mean (the analysis), every number
// with its baseline, now and change, a chart for each number that has moved
// over time, the fixes worst first, every page that was read, and how it was
// measured, with what can only be measured once the site's owner gives access.
import { spaces } from './spaces.js';
import { config, dashboard, latestCheck, digest, fmt, grade } from './dashboard.js';
import { AI_BOTS } from './sitecheck.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const day = (at) => new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const path = (u) => { try { const x = new URL(u); return x.pathname + x.search; } catch { return u; } };
const GROUPS = [['seo', 'Scores'], ['ai', 'AI search'], ['speed', 'Speed'], ['google', 'Google scores'], ['health', 'Site health'], ['tracking', 'Tracking'], ['numbers', 'Tracked numbers']];

// One number over time, as a line on a light grid, with its first and last value labelled.
export function lineSvg(points, { w = 320, h = 120, unit = '' } = {}) {
  if (points.length < 2) return '';
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (unit === '/100') { y0 = Math.min(y0, 0); y1 = 100; } else { const pad = (y1 - y0) * 0.15 || Math.abs(y1) * 0.1 || 1; y0 -= pad; y1 += pad; if (Math.min(...ys) >= 0) y0 = Math.max(0, y0); }
  const L = 8, R = 8, T = 18, B = 20, X = (t) => L + (x1 === x0 ? (w - L - R) / 2 : (t - x0) / (x1 - x0) * (w - L - R)), Y = (v) => T + (1 - (v - y0) / (y1 - y0 || 1)) * (h - T - B);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ');
  const grid = [0.25, 0.5, 0.75].map((f) => `<line class="rp-grid" x1="${L}" x2="${w - R}" y1="${(T + f * (h - T - B)).toFixed(1)}" y2="${(T + f * (h - T - B)).toFixed(1)}"/>`).join('');
  const first = points[0], last = points[points.length - 1];
  return `<svg class="rp-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="From ${esc(fmt(first[1], unit))} to ${esc(fmt(last[1], unit))}">${grid}<line class="rp-axis" x1="${L}" x2="${w - R}" y1="${h - B}" y2="${h - B}"/>
    <path class="rp-line" d="${d}"/>${points.map((p) => `<circle class="rp-dot" cx="${X(p[0]).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="3"/>`).join('')}
    <text class="rp-val" x="${X(first[0])}" y="${Y(first[1]) - 7}" text-anchor="start">${esc(fmt(first[1], unit))}</text><text class="rp-val" x="${X(last[0])}" y="${Y(last[1]) - 7}" text-anchor="end">${esc(fmt(last[1], unit))}</text>
    <text class="rp-date" x="${L}" y="${h - 5}">${esc(day(first[0]))}</text><text class="rp-date" x="${w - R}" y="${h - 5}" text-anchor="end">${esc(day(last[0]))}</text></svg>`;
}

const chip = (sev) => `<span class="rp-sev rp-sev--${sev}">${{ high: 'Serious', medium: 'Worth fixing', low: 'Small' }[sev]}</span>`;
const gradeChip = (score) => { const g = grade(score); return g ? `<span class="rp-grade rp-grade--${g.replace(' ', '-')}">${g === 'good' ? 'Good' : g === 'poor' ? 'Poor' : 'Needs work'}</span>` : ''; };

export function reportHtml(space) {
  const sp = spaces().find((s) => s.id === space);
  const c = config(space), D = dashboard(space), check = latestCheck(space), dg = check ? digest(check) : null;
  const site = c.site ? host(c.site) : '';
  const v = (k) => D.compare[k]?.now[1];
  const first = D.checks[0] || Math.min(...Object.values(D.compare).map((x) => x.base[0]).concat(Date.now()));
  const last = D.checks[D.checks.length - 1] || Date.now();

  const heads = [
    ['seo.score', 'SEO score'], ['ai.score', 'AI search readiness'], ['speed.mobile', 'Speed on a phone'], ['site.fixes', 'Fixes waiting'], ['speed.desktop', 'Speed on a computer'], ['google.seo.mobile', 'Google SEO score']
  ].filter(([k]) => v(k) != null).slice(0, 4).map(([k, label]) => {
    const x = D.compare[k], d = D.defs[k];
    const ch = x.n > 1 && x.change ? `<span class="rp-change ${x.good ? 'rp-good' : 'rp-bad'}">${x.change > 0 ? '+' : ''}${esc(fmt(x.change, d.unit === '/100' ? '' : d.unit))} since ${esc(day(x.base[0]))}</span>` : `<span class="rp-change rp-muted">Baseline</span>`;
    return `<div class="rp-head-num"><div class="rp-label">${esc(label)}</div><div class="rp-big">${esc(d.unit === '/100' ? x.now[1] : fmt(x.now[1], d.unit))}${d.unit === '/100' ? '<small>/100</small>' : ''}</div>${d.unit === '/100' ? gradeChip(x.now[1]) : ''}${ch}</div>`;
  }).join('');

  const once = !Object.values(D.compare).some((x) => x.n > 1);   // only the baseline so far: one column of values
  const rows = GROUPS.map(([g, title]) => {
    const ks = Object.keys(D.defs).filter((k) => D.defs[k].group === g && D.compare[k]);
    if (!ks.length) return '';
    return `<tr class="rp-group"><th colspan="${once ? 2 : 4}">${esc(title)}</th></tr>` + ks.map((k) => {
      const x = D.compare[k], d = D.defs[k];
      const ch = x.n > 1 && x.change ? `<span class="${x.good ? 'rp-good' : 'rp-bad'}">${x.change > 0 ? '+' : ''}${esc(fmt(x.change, d.unit === '/100' ? '' : d.unit))}</span>` : '<span class="rp-muted">–</span>';
      return `<tr><td>${esc(d.name)}${d.target != null ? ` <span class="rp-muted">(aim: under ${esc(fmt(d.target, d.unit))})</span>` : ''}</td><td class="rp-n">${esc(fmt(x.base[1], d.unit))}</td>${once ? '' : `<td class="rp-n">${esc(fmt(x.now[1], d.unit))}</td><td class="rp-n">${ch}</td>`}</tr>`;
    }).join('');
  }).join('');

  const moving = Object.keys(D.defs).filter((k) => (D.series[k] || []).length > 1 && (D.defs[k].key || D.defs[k].custom || D.compare[k]?.change));
  const charts = moving.length ? `<section class="rp-sec"><h2>Over time</h2><div class="rp-charts">${moving.slice(0, 12).map((k) => `<figure class="rp-fig"><figcaption>${esc(D.defs[k].name)}</figcaption>${lineSvg(D.series[k], { unit: D.defs[k].unit })}</figure>`).join('')}</div></section>` : '';

  const fixes = dg?.fixes?.length ? `<section class="rp-sec"><h2>What to fix, worst first</h2><ol class="rp-fixes">${dg.fixes.map((f) => `<li>${chip(f.sev)}<div><b>${esc(f.what)}</b><p>${esc(f.why)}</p>${f.urls.length && f.urls[0] !== check.url ? `<p class="rp-urls">${f.urls.slice(0, 5).map((u) => esc(path(u))).join(' · ')}${f.urls.length > 5 || f.count > f.urls.length ? ' · …' : ''}</p>` : ''}</div></li>`).join('')}</ol></section>` : '';

  const pages = check ? `<section class="rp-sec rp-break"><h2>Every page read (${check.pages.length})</h2><table class="rp-table rp-pages"><thead><tr><th>Page</th><th class="rp-n">Status</th><th class="rp-n">Title</th><th class="rp-n">Words</th><th>Description</th><th class="rp-n">H1</th><th class="rp-n">No alt</th></tr></thead><tbody>
    ${check.pages.map((p) => `<tr><td class="rp-url">${esc(path(p.url))}</td><td class="rp-n">${p.status || '–'}</td><td class="rp-n ${p.title?.length > 60 ? 'rp-bad' : ''}">${p.title ? p.title.length : '<span class="rp-bad">none</span>'}</td><td class="rp-n ${p.words < 300 ? 'rp-bad' : ''}">${p.words ?? '–'}</td><td>${p.description ? 'Yes' : '<span class="rp-bad">No</span>'}</td><td class="rp-n ${p.h1 && p.h1.length !== 1 ? 'rp-bad' : ''}">${p.h1 ? p.h1.length : '–'}</td><td class="rp-n ${p.noAlt ? 'rp-bad' : ''}">${p.noAlt ?? '–'}</td></tr>`).join('')}</tbody></table>
    <p class="rp-muted rp-small">Title: its length in characters (Google shows about 60). Words: on the page, without menus' scripts. H1: main headings (one is right). No alt: pictures without alt text.</p></section>` : '';

  const partsTable = (title, sc, lead) => sc ? `<section class="rp-sec"><h2>${title}: ${sc.score} of 100 ${gradeChip(sc.score)}</h2><p class="rp-muted">${lead}</p><table class="rp-table"><thead><tr><th>Part</th><th class="rp-n">Points</th></tr></thead><tbody>${sc.parts.map((p) => `<tr><td>${esc(p.name)}</td><td class="rp-n">${Math.round(p.got * p.weight)} of ${p.weight}</td></tr>`).join('')}</tbody></table></section>` : '';
  const seoSec = partsTable('SEO score', dg?.scores?.seo, 'Made from the site check: how well every page is set up to be found and chosen in Google.');
  const ai = dg?.ai;
  const aiSec = ai ? partsTable('AI search readiness', dg.scores.ai, 'Whether ChatGPT, Google\'s AI Overviews, Perplexity and Copilot can read the site and quote it. This is readiness, checked from outside; whether they actually name the business is tracked by asking them the same questions each month.')
    + `<section class="rp-sec"><table class="rp-table"><thead><tr><th>AI search crawler</th><th class="rp-n">Let in</th></tr></thead><tbody>${AI_BOTS.search.map(([b, w]) => `<tr><td>${esc(w)} <span class="rp-muted">(${esc(b)})</span></td><td class="rp-n">${ai.robots[b] !== false ? '<span class="rp-good">Yes</span>' : '<span class="rp-bad">No</span>'}</td></tr>`).join('')}</tbody></table>
      <p class="rp-muted rp-small">${dg.qaPages} pages answer questions directly. llms.txt: ${ai.llms ? 'present' : 'none'}. Training crawlers kept out: ${AI_BOTS.training.filter(([b]) => ai.robots[b] === false).map(([, w]) => esc(w)).join(', ') || 'none'} (the owner's choice; it does not stop AI search citing the site).${ai.cloudflare ? ' The site is behind Cloudflare, whose bot settings can also turn AI crawlers away; to be checked once there is access.' : ''}</p></section>` : '';
  const t = dg?.tags;
  const yes = (ok, note = '') => ok ? `<span class="rp-good">Found</span>${note ? ` <span class="rp-muted">${esc(note)}</span>` : ''}` : '<span class="rp-bad">Not found</span>';
  const tagSec = t ? `<section class="rp-sec"><h2>Tracking and ads</h2><table class="rp-table"><tbody>
    <tr><td>Google Analytics</td><td class="rp-n">${yes(t.ga4.length || t.ga4Sends, t.ga4[0] || '')}</td></tr><tr><td>Google Tag Manager</td><td class="rp-n">${yes(t.gtm.length, t.gtm[0] || '')}</td></tr>
    <tr><td>Google Ads conversion tracking</td><td class="rp-n">${yes(t.ads.length || t.adsSends, t.ads[0] || '')}</td></tr><tr><td>Meta (Facebook) pixel</td><td class="rp-n">${yes(t.meta)}</td></tr>
    <tr><td>Call tracking</td><td class="rp-n">${yes(t.calls, t.calls || '')}</td></tr><tr><td>Microsoft Ads (Bing)</td><td class="rp-n">${yes(t.bing)}</td></tr></tbody></table>
    <p class="rp-muted rp-small">Read from the home page, its Tag Manager container and the requests the page really made. Ad spend, clicks, cost per lead and conversions need access to the Google Ads and Analytics accounts.</p></section>` : '';
  const sp0 = check?.speed || {};
  const method = `<section class="rp-sec"><h2>How this was measured</h2><ul class="rp-method">
    ${check ? `<li><b>The site</b> was read from outside, as a visitor and a search engine would see it, on ${esc(day(check.at))}: ${check.pages.length} pages from its sitemap and links, and ${check.linksChecked} links checked${check.slowedDown ? ` (the site asked us to slow down ${check.slowedDown} times; those were left out rather than counted as broken)` : ''}.</li>` : ''}
    ${sp0.mobile && !sp0.mobile.error ? `<li><b>Speed</b> was measured by loading the home page in a real browser, once as a mid-range phone on a slow mobile connection and once as a computer, and scored on Google Lighthouse's scale (90 to 100 good, 50 to 89 needs work, under 50 poor). Each was measured three times and the middle result kept${sp0.mobile?.runs ? ` (phone: ${sp0.mobile.runs.join(', ')})` : ''}, because a single run can swing by ten points; Google's own PageSpeed numbers vary the same way and may differ slightly from these.</li>` : sp0.mobile?.error ? `<li><b>Speed</b> could not be measured: ${esc(sp0.mobile.error)}</li>` : ''}
    ${check?.google && !check.google.error && !check.google.mobile?.error ? '<li><b>Google scores</b> come from Google PageSpeed Insights on the same day.</li>' : ''}
    <li><b>Measured once there is access</b> (the site's owner adds us as a user): visits and searches from Google Search Console (clicks, how often the site shows, its average position for each search), Google Analytics (visitors from search, calls and form fills), Google Ads (spend, clicks, cost per lead), and the Google Business Profile (calls, direction requests, reviews).</li></ul></section>`;

  const title = site ? `Website report: ${site}` : `${sp?.name || 'Project'} report`;
  return `<!doctype html><html lang="en" class="rp-doc"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} · ${esc(day(last))}</title>
<link rel="stylesheet" href="/css/fonts.css"><link rel="stylesheet" href="/css/tokens.css"><link rel="stylesheet" href="/css/components/report.css"></head>
<body class="rp"><main class="rp-page">
<header class="rp-top"><div><div class="rp-kicker">${esc(sp?.name || '')}</div><h1>${esc(title)}</h1></div><div class="rp-when">${D.checks.length > 1 || first < last - 86400e3 ? `${esc(day(first))} to ${esc(day(last))}` : `Baseline · ${esc(day(first))}`}</div></header>
${heads ? `<section class="rp-heads">${heads}</section>` : ''}
<section class="rp-sec"><h2>Summary</h2>${D.analysis.map((p) => `<p>${esc(p)}</p>`).join('')}</section>
${rows ? `<section class="rp-sec"><h2>Every number</h2><table class="rp-table"><thead><tr><th>Measure</th><th class="rp-n">${once ? `Baseline, ${esc(day(first))}` : 'Baseline'}</th>${once ? '' : '<th class="rp-n">Now</th><th class="rp-n">Change</th>'}</tr></thead><tbody>${rows}</tbody></table></section>` : ''}
${seoSec}${aiSec}${tagSec}${charts}${fixes}${method}${pages}
</main></body></html>`;
}
