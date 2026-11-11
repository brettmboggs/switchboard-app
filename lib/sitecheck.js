// A website check for a project's dashboard (lib/dashboard.js): everything that
// can be measured about a site from outside, with no access to its accounts.
//
// - The pages: robots.txt and the sitemap(s), else the links from the home page,
//   up to 150 pages read politely (2 at a time with a pause, waiting when the site says slow down, a browser-like user agent that
//   says it is Switchboard). For each: status, title, description, headings,
//   words, pictures without alt text, structured data (JSON-LD types), canonical,
//   noindex, and its links.
// - Broken links: every internal link found but not read, and up to 60 outside
//   links, asked for once each (HEAD, then GET when HEAD is refused).
// - The site: HTTPS, http:// sending on to https://, how long the home page
//   took to answer.
// - Speed: lib/sitespeed.js in a headless browser, and Google's PageSpeed scores
//   when a key is saved (Google refuses calls without one).
// Nothing is sent anywhere but the site itself and, with a key, Google.
import { setTimeout as wait } from 'node:timers/promises';
import { getSetting } from './db.js';
import { measureSpeed } from './sitespeed.js';

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 SwitchboardSiteCheck/1.0';
const MAX_PAGES = 150, MAX_INTERNAL = 120, MAX_EXTERNAL = 60, AT_ONCE = 2, GAP = 350;   // GAP: ms between one reader's requests, so a firewall never sees a burst
const SKIP = /\.(jpe?g|png|gif|webp|svg|ico|pdf|zip|docx?|xlsx?|pptx?|mp[34]|mov|avi|woff2?|ttf|css|js|xml|json|txt)(\?|$)/i;

export function siteUrl(input) {
  let s = String(input || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try { const u = new URL(s); if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) return null; u.hash = ''; return u.origin + (u.pathname === '/' ? '/' : u.pathname); } catch { return null; }
}
const bare = (h) => String(h || '').toLowerCase().replace(/^www\./, '');

async function get(url, { method = 'GET', tries = 2, timeout = 20e3, body = true, script = false } = {}) {
  let slowed = 0;
  for (let i = 0; ; i++) {
    const t0 = Date.now();
    try {
      const r = await fetch(url, { method, redirect: 'follow', headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' }, signal: AbortSignal.timeout(timeout) });
      // "Slow down" (429, often a firewall such as Cloudflare): wait as asked (or a few seconds) and ask again, twice at most.
      if (r.status === 429 && slowed < 2) { slowed++; r.body?.cancel().catch(() => {}); await wait(Math.min(30, Number(r.headers.get('retry-after')) || 6 * slowed) * 1000); i--; continue; }
      const type = r.headers.get('content-type') || '';
      const text = body && method === 'GET' && (/html|xml|text/i.test(type) || (script && /javascript/i.test(type))) ? (await r.text()).slice(0, 3e6) : (r.body?.cancel().catch(() => {}), '');
      return { status: r.status, url: r.url, type, text, ms: Date.now() - t0, redirected: r.redirected, server: r.headers.get('server') || '' };
    } catch (e) {
      // The first try of a lookup on a flaky line fails now and then: once more after a pause.
      if (i + 1 >= tries) return { status: 0, url, type: '', text: '', ms: Date.now() - t0, error: e.name === 'TimeoutError' ? 'took too long' : (e.cause?.code || e.message) };
      await wait(1500);
    }
  }
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…' };
const decode = (s) => String(s || '').replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e.toLowerCase()] ?? m).replace(/\s+/g, ' ').trim();
function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([a-zA-Z:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g)) out[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? '';
  return out;
}
const tags = (html, name) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map((m) => attrs(m[0]));

// One page's facts from its HTML.
export function readPage(html, base) {
  const head = html.slice(0, 200000);
  const metas = tags(head, 'meta'), links = tags(head, 'link');
  const meta = (k) => metas.find((m) => (m.name || m.property || '').toLowerCase() === k)?.content;
  const types = new Set();
  for (const m of html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (o) => { if (Array.isArray(o)) return o.forEach(walk); if (!o || typeof o !== 'object') return; if (o['@type']) [].concat(o['@type']).forEach((t) => types.add(String(t))); if (o['@graph']) walk(o['@graph']); };
      walk(JSON.parse(m[1].trim()));
    } catch {}
  }
  const body = html.replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
  const words = decode(body.replace(/<[^>]+>/g, ' ')).split(' ').filter((w) => /\p{L}/u.test(w)).length;
  const imgs = tags(body, 'img');
  const hrefs = [];
  for (const a of tags(body, 'a')) {
    // Cloudflare's hidden email addresses (/cdn-cgi/l/email-protection) are put back by a script: not a link to check.
    if (!a.href || /^(mailto|tel|javascript|sms|#)/i.test(a.href) || /\/cdn-cgi\//.test(a.href)) continue;
    try { const u = new URL(decode(a.href), base); u.hash = ''; if (/^https?:$/.test(u.protocol)) hrefs.push(u.href); } catch {}
  }
  const h1 = [...body.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => decode(m[1].replace(/<[^>]+>/g, ' ')));
  return {
    title: decode(head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ''),
    description: decode(meta('description') || ''),
    noindex: /noindex/i.test(meta('robots') || ''),
    canonical: links.find((l) => /(^|\s)canonical(\s|$)/i.test(l.rel || ''))?.href || '',
    viewport: !!meta('viewport'), og: !!meta('og:title'), lang: /<html[^>]*\blang\s*=/i.test(head),
    h1, h2: (body.match(/<h2\b/gi) || []).length, words,
    // Headings asked as questions ("How much does home care cost?"): the shape AI answers quote.
    questions: [...body.matchAll(/<h[2-4]\b[^>]*>([\s\S]*?)<\/h[2-4]>/gi)].map((m) => decode(m[1].replace(/<[^>]+>/g, ' '))).filter((t) => /\?\s*$/.test(t)).length,
    images: imgs.length, noAlt: imgs.filter((i) => !('alt' in i) || !i.alt.trim()).length,
    schema: [...types], links: [...new Set(hrefs)]
  };
}

async function pool(list, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => { while (i < list.length) { const k = i++; out[k] = await fn(list[k], k); await wait(GAP); } }));
  return out;
}

async function sitemapUrls(origin, robots) {
  const tried = new Set(), urls = new Set();
  let queue = [...(robots.match(/^\s*sitemap:\s*(\S+)/gim) || []).map((l) => l.replace(/^\s*sitemap:\s*/i, ''))];
  if (!queue.length) queue = ['/sitemap.xml', '/sitemap_index.xml', '/wp-sitemap.xml'].map((p) => origin + p);
  let found = null;
  while (queue.length && tried.size < 12 && urls.size < 2000) {
    const u = queue.shift(); if (tried.has(u)) continue; tried.add(u);
    const r = await get(u);
    if (r.status !== 200 || !/<(urlset|sitemapindex)\b/i.test(r.text)) continue;
    found ||= u;
    const locs = [...r.text.matchAll(/<loc>\s*(?:<!\[CDATA\[)?([^<\]]+)/gi)].map((m) => decode(m[1]));
    if (/<sitemapindex\b/i.test(r.text)) queue.push(...locs); else locs.forEach((l) => urls.add(l));
  }
  return { sitemap: found, urls: [...urls] };
}

// AI search: which crawlers robots.txt lets in. The ones that fetch pages to answer
// questions (ChatGPT search, Perplexity, Google and Bing, whose index ChatGPT and
// Copilot also use) decide whether a site can be cited; training crawlers are the
// owner's choice and are only reported.
export const AI_BOTS = {
  search: [['OAI-SearchBot', 'ChatGPT search'], ['ChatGPT-User', 'ChatGPT, opening a page for someone'], ['PerplexityBot', 'Perplexity'], ['Googlebot', 'Google (and its AI Overviews)'], ['Bingbot', 'Bing (and Copilot, ChatGPT)'], ['Claude-SearchBot', 'Claude search']],
  training: [['GPTBot', 'OpenAI training'], ['Google-Extended', 'Gemini training'], ['ClaudeBot', 'Anthropic training'], ['CCBot', 'Common Crawl'], ['Applebot-Extended', 'Apple training']]
};
export function robotsAllows(robots, bot) {
  // Groups of User-agent lines and their rules; a bot follows its own group, else the * group.
  const groups = []; let cur = null, lastUA = false;
  for (const raw of String(robots || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim(); if (!line) continue;
    const [k, ...rest] = line.split(':'); const key = k.trim().toLowerCase(), val = rest.join(':').trim();
    if (key === 'user-agent') { if (!lastUA) groups.push(cur = { agents: [], rules: [] }); cur.agents.push(val.toLowerCase()); lastUA = true; }
    else { lastUA = false; if (cur && (key === 'allow' || key === 'disallow')) cur.rules.push([key, val]); }
  }
  const b = bot.toLowerCase();
  const g = groups.find((x) => x.agents.some((a) => a !== '*' && b.includes(a))) || groups.find((x) => x.agents.includes('*'));
  if (!g) return true;
  const allowRoot = g.rules.some(([k, v]) => k === 'allow' && v === '/');
  return !(g.rules.some(([k, v]) => k === 'disallow' && v === '/') && !allowRoot);
}

// Tracking and ads tags: in the home page's HTML, inside its Tag Manager container,
// and in what the page really sent when the speed test opened it.
export function findTags(html, gtmJs = '', urls = []) {
  const all = html + '\n' + gtmJs, sent = urls.join(' ');
  const ids = (re) => [...new Set([...all.matchAll(re)].map((m) => m[1]))];
  const ga4 = ids(/\b(G-[A-Z0-9]{6,12})\b/g), ads = ids(/\b(AW-\d{8,12})\b/g), gtm = ids(/\b(GTM-[A-Z0-9]{5,9})\b/g), ua = ids(/\b(UA-\d{4,10}-\d{1,3})\b/g);
  return {
    gtm, ga4, ua, ads,
    ga4Sends: /google-analytics\.com\/g\/collect|analytics\.google\.com\/g\/collect/.test(sent),
    adsSends: /googleadservices\.com|googleads\.g\.doubleclick\.net/.test(sent),
    meta: /connect\.facebook\.net|fbq\(/.test(all) || /facebook\.com\/tr/.test(sent),
    bing: /bat\.bing\.com/.test(all + sent),
    calls: { callrail: 'CallRail', calltrackingmetrics: 'CallTrackingMetrics', callfire: 'CallFire', ringba: 'Ringba', whatconverts: 'WhatConverts', invoca: 'Invoca' }[(all + sent).match(/callrail|calltrackingmetrics|callfire|ringba|whatconverts|invoca/i)?.[0]?.toLowerCase()] || null,
    clarity: /clarity\.ms/.test(all + sent), hotjar: /hotjar/.test(all + sent)
  };
}

async function pageSpeedGoogle(url, key) {
  const out = {};
  for (const strategy of ['mobile', 'desktop']) {
    const q = new URLSearchParams({ url, strategy, key });
    for (const c of ['PERFORMANCE', 'SEO', 'ACCESSIBILITY', 'BEST_PRACTICES']) q.append('category', c);
    const r = await fetch('https://www.googleapis.com/pagespeedonline/v5/runPagespeed?' + q, { signal: AbortSignal.timeout(120e3) }).catch((e) => ({ ok: false, status: 0, json: async () => ({ error: { message: e.message } }) }));
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { out[strategy] = { error: r.status === 400 && /key/i.test(j.error?.message || '') ? 'Google did not accept that PageSpeed key. Copy it again from Google Cloud, APIs, Credentials.' : `Google's PageSpeed test did not answer (${j.error?.message || r.status}).` }; continue; }
    const cat = j.lighthouseResult?.categories || {}, au = j.lighthouseResult?.audits || {};
    const sc = (k) => cat[k]?.score == null ? null : Math.round(cat[k].score * 100);
    const field = j.loadingExperience?.metrics || {};
    out[strategy] = {
      performance: sc('performance'), seo: sc('seo'), accessibility: sc('accessibility'), bestPractices: sc('best-practices'),
      lcp: au['largest-contentful-paint']?.numericValue ?? null, cls: au['cumulative-layout-shift']?.numericValue ?? null, tbt: au['total-blocking-time']?.numericValue ?? null, fcp: au['first-contentful-paint']?.numericValue ?? null,
      // Real visitors' numbers (Chrome's field data), when the site has enough traffic for Google to have them.
      fieldLcp: field.LARGEST_CONTENTFUL_PAINT_MS?.percentile ?? null, fieldInp: field.INTERACTION_TO_NEXT_PAINT?.percentile ?? null,
      fieldCls: field.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile != null ? field.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100 : null, fieldOverall: j.loadingExperience?.overall_category || null
    };
  }
  return out;
}

// The whole check. onStep(words) says what it is doing, for the dashboard.
export async function checkSite(input, { onStep = () => {} } = {}) {
  const start = siteUrl(input);
  if (!start) throw Object.assign(new Error('That is not a web address. Type it like example.com.'), { status: 400 });
  onStep('Opening the home page');
  const home = await get(start);
  if (!home.status) throw Object.assign(new Error(`Could not reach ${new URL(start).hostname} (${home.error}). Check the address, or try again in a minute.`), { status: 502 });
  // A home page that still says "slow down" after waiting is not the site: nothing is recorded from it.
  if (home.status === 429) throw Object.assign(new Error(`${new URL(start).hostname} asked us to slow down (its firewall). Nothing was recorded; check again in a few minutes.`), { status: 503 });
  if (home.status >= 400 || !/html/i.test(home.type)) throw Object.assign(new Error(`${new URL(start).hostname} answered ${home.status} instead of its home page, so nothing was recorded. If it opens in a browser, its firewall is turning automated visits away.`), { status: 502 });
  const origin = new URL(home.url).origin, host = bare(new URL(home.url).hostname);
  const same = (u) => { try { return bare(new URL(u).hostname) === host; } catch { return false; } };
  const http = await get(origin.replace(/^https:/, 'http:') + '/', { body: false });
  const robots = await get(origin + '/robots.txt');
  const robotsText = robots.status === 200 && /text\/plain/i.test(robots.type) ? robots.text : '';
  // Speed and the AI checks first, while the site is fresh: a firewall can slow everything down after a few dozen pages.
  onStep('Checking AI search access');
  const llms = await get(origin + '/llms.txt');
  const ai = {
    robots: Object.fromEntries([...AI_BOTS.search, ...AI_BOTS.training].map(([b]) => [b, robotsAllows(robotsText, b)])),
    contentSignal: robotsText.match(/content-signal:\s*([^\n]+)/i)?.[1]?.trim() || null,
    llms: llms.status === 200 && /text\/(plain|markdown)/i.test(llms.type) ? { title: (llms.text.match(/^#\s+(.+)$/m)?.[1] || '').trim(), links: (llms.text.match(/\]\(https?:/g) || []).length } : null,
    cloudflare: /cloudflare/i.test(home.server || '')
  };
  onStep('Timing the home page in a browser');
  let speed = {};
  try { speed = await measureSpeed(home.url); } catch (e) { speed = { error: e.message }; }
  onStep('Reading the sitemap');
  const sm = await sitemapUrls(origin, robotsText);

  // Which pages: the sitemap's, then whatever the pages read so far link to.
  const want = [...new Set([home.url, ...sm.urls.filter((u) => same(u) && !SKIP.test(u))])];
  const pages = new Map(), linkSeen = new Map();   // url -> page; link -> pages linking to it
  const finals = new Set();   // where each address ended up: /about and /about/ are one page
  const take = (u, r) => {
    if (r.status === 200 && r.url && finals.has(r.url)) { pages.set(u, null); return null; }
    if (r.url) finals.add(r.url);
    const p = { url: u, finalUrl: r.url, status: r.status, ms: r.ms, error: r.error || null };
    if (r.status === 200 && /html/i.test(r.type)) Object.assign(p, readPage(r.text, r.url));
    pages.set(u, p);
    for (const l of p.links || []) { if (!linkSeen.has(l)) linkSeen.set(l, []); linkSeen.get(l).push(u); }
    return p;
  };
  take(home.url, home);
  let queue = want.filter((u) => !pages.has(u));
  while (pages.size < MAX_PAGES) {
    if (!queue.length) queue = [...linkSeen.keys()].filter((l) => same(l) && !pages.has(l) && !SKIP.test(l));
    if (!queue.length) break;
    const batch = queue.splice(0, Math.min(MAX_PAGES - pages.size, 12));
    onStep(`Reading pages (${pages.size} of up to ${MAX_PAGES})`);
    await pool(batch, AT_ONCE, async (u) => take(u, await get(u)));
  }

  onStep('Checking links');
  const internal = [...linkSeen.keys()].filter((l) => same(l) && !pages.has(l)).slice(0, MAX_INTERNAL);
  const external = [...linkSeen.keys()].filter((l) => !same(l)).slice(0, MAX_EXTERNAL);
  const ask = async (u) => { let r = await get(u, { method: 'HEAD', body: false, timeout: 12e3, tries: 1 }); if ([0, 403, 405, 501].includes(r.status)) r = await get(u, { body: false, timeout: 15e3 }); return r; };
  const linkResults = await pool([...internal, ...external], 4, async (u) => ({ url: u, status: (await ask(u)).status, internal: same(u) }));
  // Broken: gone (404, 410), the server failing (5xx), or no answer at all. A 403 or 429 from
  // someone else's site is them refusing robots, not a broken link.
  const isBroken = (s, inside) => s !== 429 && (s === 404 || s === 410 || s >= 500 || s === 0 || (inside && s >= 400));
  const broken = [];
  for (const p of pages.values()) if (p && p.status !== 200 && p.status !== 429) broken.push({ url: p.url, status: p.status, from: (linkSeen.get(p.url) || []).slice(0, 3) });
  for (const l of linkResults) if (isBroken(l.status, l.internal)) broken.push({ url: l.url, status: l.status, from: (linkSeen.get(l.url) || []).slice(0, 3) });

  // Tag Manager's container holds the tags it adds; it is public, like the page.
  const gtmIds = [...new Set([...home.text.matchAll(/\b(GTM-[A-Z0-9]{5,9})\b/g)].map((m) => m[1]))].slice(0, 3);
  let gtmJs = '';
  for (const id of gtmIds) { const r = await get(`https://www.googletagmanager.com/gtm.js?id=${id}`, { tries: 1, script: true }); if (r.status === 200) gtmJs += r.text.slice(0, 2e6); }
  const tags = findTags(home.text, gtmJs, speed.mobile?.urls || []);
  const key = getSetting('pagespeed', {})?.key || '';
  let google = null;
  if (key) { onStep('Asking Google PageSpeed'); try { google = await pageSpeedGoogle(home.url, key); } catch (e) { google = { error: e.message }; } }

  return {
    url: home.url, at: Date.now(),
    site: { https: home.url.startsWith('https://'), httpToHttps: http.status && http.status !== 429 ? !!http.url?.startsWith('https://') : null, robots: !!robotsText, sitemap: sm.sitemap, sitemapUrls: sm.urls.length, homeMs: home.ms },
    pages: [...pages.values()].filter(Boolean).map(({ links, ...p }) => ({ ...p, linkCount: links?.length || 0 })),
    linksChecked: linkResults.length, broken, slowedDown: [...pages.values()].filter((p) => p?.status === 429).length + linkResults.filter((l) => l.status === 429).length, speed: { mobile: speed.mobile && { ...speed.mobile, urls: undefined }, desktop: speed.desktop && { ...speed.desktop, urls: undefined }, error: speed.error }, google, ai, tags
  };
}
