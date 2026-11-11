// A project's dashboard (Nov 11 2026): the numbers that show how a project is
// doing, kept over time, with what they mean in words, and a report to hand
// someone (lib/dashreport.js). Set up per project: which tiles it shows, its
// website, how often the site is checked, and any number of its own to track
// (a rating, reviews, leads a month) typed in by hand.
//
// - Readings: one row per number per moment (dash_readings). A website check
//   (lib/sitecheck.js) writes a dozen at once; a number of your own gets one
//   each time you add it.
// - The baseline: the first reading of each number, unless a later moment is
//   chosen as the start. Everything after is "from here to here", which is the
//   point: the proof of work done for a client is the change since day one.
// - Fixes: what the last website check found, worst first, in plain words.
// - Analysis: sentences built from the numbers (no AI needed, so it is always
//   there and always right); Jarvis can say more from the same data.
// Kept in this computer's own tables, like browser checks: a site is checked by
// one computer, not by every one that shares the settings.
import { db } from './db.js';
import { spaces } from './spaces.js';
import { checkSite, siteUrl, AI_BOTS } from './sitecheck.js';

for (const sql of [
  `CREATE TABLE IF NOT EXISTS dash_config (space TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS dash_readings (space TEXT NOT NULL, metric TEXT NOT NULL, at INTEGER NOT NULL, value REAL, PRIMARY KEY (space, metric, at))`,
  `CREATE TABLE IF NOT EXISTS dash_checks (id INTEGER PRIMARY KEY AUTOINCREMENT, space TEXT NOT NULL, at INTEGER NOT NULL, url TEXT, data TEXT)`
]) db.exec(sql);

const DAY = 86400e3;
const KEEP_CHECKS = 30;   // full website checks kept per project (the readings are kept for good)

// Every number a website check gives. better: which way is good. group: the tile it sits on.
export const SITE_METRICS = {
  'speed.mobile': { name: 'Speed score, phone', unit: '/100', better: 'up', group: 'speed', key: true },
  'speed.desktop': { name: 'Speed score, computer', unit: '/100', better: 'up', group: 'speed', key: true },
  'lcp.mobile': { name: 'Main content shows, phone', unit: 's', better: 'down', group: 'speed', target: 2.5 },
  'tbt.mobile': { name: 'Too busy to tap, phone', unit: 'ms', better: 'down', group: 'speed', target: 200 },
  'cls.mobile': { name: 'Layout shift, phone', unit: '', better: 'down', group: 'speed', target: 0.1 },
  'weight': { name: 'Home page size', unit: 'MB', better: 'down', group: 'speed', target: 2 },
  'requests': { name: 'Files the home page loads', unit: '', better: 'down', group: 'speed' },
  'google.performance.mobile': { name: 'Google speed score, phone', unit: '/100', better: 'up', group: 'google', key: true },
  'google.performance.desktop': { name: 'Google speed score, computer', unit: '/100', better: 'up', group: 'google' },
  'google.seo.mobile': { name: 'Google SEO score', unit: '/100', better: 'up', group: 'google', key: true },
  'google.accessibility.mobile': { name: 'Google accessibility score', unit: '/100', better: 'up', group: 'google' },
  'google.bestPractices.mobile': { name: 'Google best practices score', unit: '/100', better: 'up', group: 'google' },
  'seo.score': { name: 'SEO score', unit: '/100', better: 'up', group: 'seo', key: true },
  'ai.score': { name: 'AI search readiness', unit: '/100', better: 'up', group: 'ai', key: true },
  'ai.searchBots': { name: 'AI search crawlers let in', unit: '', better: 'up', group: 'ai' },
  'ai.qaPages': { name: 'Pages answering questions', unit: '', better: 'up', group: 'ai' },
  'track.tags': { name: 'Tracking in place (of 4)', unit: '', better: 'up', group: 'tracking' },
  'site.pages': { name: 'Pages on the site', unit: '', better: 'up', group: 'health' },
  'site.fixes': { name: 'Fixes waiting', unit: '', better: 'down', group: 'health', key: true },
  'site.broken': { name: 'Broken links', unit: '', better: 'down', group: 'health' },
  'site.noDesc': { name: 'Pages without a description', unit: '', better: 'down', group: 'health' },
  'site.dupTitles': { name: 'Pages sharing a title', unit: '', better: 'down', group: 'health' },
  'site.longTitles': { name: 'Titles cut off in Google', unit: '', better: 'down', group: 'health' },
  'site.noH1': { name: 'Pages without a main heading', unit: '', better: 'down', group: 'health' },
  'site.thin': { name: 'Thin pages (under 300 words)', unit: '', better: 'down', group: 'health' },
  'site.noAlt': { name: 'Pictures without alt text', unit: '', better: 'down', group: 'health' },
  'site.schema': { name: 'Pages with structured data', unit: '%', better: 'up', group: 'health' },
  'site.answerMs': { name: 'Server answer time', unit: 'ms', better: 'down', group: 'health', target: 600 }
};

// The tiles a dashboard can show, and the templates that pick them.
export const TILES = {
  summary: { name: 'Analysis', about: 'What the numbers mean, in words: where things stand and what changed since the start.' },
  speed: { name: 'Speed', about: 'How fast the home page loads on a phone and a computer, measured here in a browser.' },
  google: { name: 'Google scores', about: 'Google PageSpeed\'s own scores. Needs a free PageSpeed key.' },
  health: { name: 'Site health', about: 'Pages, titles, descriptions, headings, broken links and pictures, from reading the site.' },
  fixes: { name: 'Fixes', about: 'What to fix on the site, worst first.' },
  ai: { name: 'AI search', about: 'Whether ChatGPT, Google\'s AI Overviews and Perplexity can read the site and quote it: crawler access, business details, answers to questions, llms.txt.' },
  tracking: { name: 'Tracking and ads', about: 'Google Analytics, Tag Manager, Google Ads conversion tracking, the Meta pixel and call tracking: what is installed and what really runs.' },
  numbers: { name: 'Your numbers', about: 'Anything you track by hand: a rating, reviews, leads, sales, calls.' },
  work: { name: 'Work', about: 'This project\'s to-dos, what needs you, and what got done this week.' }
};
export const TEMPLATES = {
  website: { name: 'A client\'s website', tiles: ['summary', 'speed', 'fixes', 'health', 'ai', 'tracking', 'numbers', 'google'] },
  product: { name: 'A product or business', tiles: ['summary', 'numbers', 'work'] },
  simple: { name: 'Just my numbers', tiles: ['summary', 'numbers'] }
};

const lc = (s) => String(s || '').trim();
const slug = (s) => lc(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'number';
export const validSpace = (id) => spaces().some((s) => s.id === id);

export function config(space) {
  const row = db.prepare('SELECT data FROM dash_config WHERE space = ?').get(space);
  let c = {};
  try { c = row ? JSON.parse(row.data) : {}; } catch {}
  return { tiles: [], site: '', every: 7, baselineAt: null, custom: [], ...c, set: !!row };
}
function save(space, c) {
  const { set, ...keep } = c;
  db.prepare('INSERT INTO dash_config (space, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(space) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at').run(space, JSON.stringify(keep), Date.now());
  return config(space);
}

// Change how a dashboard is set up: { template, tiles, site, every, baselineAt }.
export function setConfig(space, b = {}) {
  if (!validSpace(space)) throw Object.assign(new Error('That project is gone. Reload the page.'), { status: 404 });
  const c = config(space);
  if (b.template) { if (!TEMPLATES[b.template]) throw Object.assign(new Error('Pick one of the templates.'), { status: 400 }); c.tiles = [...TEMPLATES[b.template].tiles]; }
  if (Array.isArray(b.tiles)) c.tiles = [...new Set(b.tiles.filter((t) => TILES[t]))];
  if (b.site !== undefined) {
    if (!lc(b.site)) c.site = '';
    else { const u = siteUrl(b.site); if (!u) throw Object.assign(new Error('That is not a web address. Type it like example.com.'), { status: 400 }); c.site = u; }
  }
  if (b.every !== undefined) c.every = [0, 1, 7, 30].includes(Number(b.every)) ? Number(b.every) : 7;
  if (b.baselineAt !== undefined) c.baselineAt = b.baselineAt ? Number(b.baselineAt) : null;
  if (!c.tiles.length) c.tiles = [...TEMPLATES[c.site ? 'website' : 'simple'].tiles];
  return save(space, c);
}

// ---- numbers of your own
export function addNumber(space, { name, unit = '', better = 'up' }) {
  if (!validSpace(space)) throw Object.assign(new Error('That project is gone. Reload the page.'), { status: 404 });
  name = lc(name).slice(0, 60);
  if (!name) throw Object.assign(new Error('Give the number a name, like Google rating or Leads a month.'), { status: 400 });
  const c = config(space);
  let id = 'my.' + slug(name);
  for (let i = 2; c.custom.some((x) => x.id === id); i++) id = `my.${slug(name)}-${i}`;
  c.custom.push({ id, name, unit: lc(unit).slice(0, 12), better: better === 'down' ? 'down' : 'up' });
  if (!c.tiles.includes('numbers')) c.tiles.push('numbers');
  save(space, c);
  return { id };
}
export function addReading(space, { metric, value, at }) {
  const c = config(space), d = c.custom.find((x) => x.id === metric);
  if (!d) throw Object.assign(new Error('That number is not on this dashboard. Reload the page.'), { status: 404 });
  const v = Number(String(value ?? '').replace(/[, $%]/g, ''));
  if (!Number.isFinite(v)) throw Object.assign(new Error('Type a number, like 4.6 or 32.'), { status: 400 });
  const when = at ? Number(at) : Date.now();
  if (!Number.isFinite(when) || when > Date.now() + DAY) throw Object.assign(new Error('Pick a date that is not in the future.'), { status: 400 });
  db.prepare('INSERT OR REPLACE INTO dash_readings (space, metric, at, value) VALUES (?, ?, ?, ?)').run(space, metric, when, v);
  return { ok: true };
}
export function forgetNumber(space, metric) {
  const c = config(space);
  if (!c.custom.some((x) => x.id === metric)) throw Object.assign(new Error('That number is not on this dashboard.'), { status: 404 });
  c.custom = c.custom.filter((x) => x.id !== metric);
  save(space, c);
  db.prepare('DELETE FROM dash_readings WHERE space = ? AND metric = ?').run(space, metric);
  return { ok: true };
}
export function forgetReading(space, metric, at) {
  db.prepare('DELETE FROM dash_readings WHERE space = ? AND metric = ? AND at = ?').run(space, metric, Number(at));
  return { ok: true };
}

// ---- the website check
const running = new Map();   // space -> { step, started }
export const checkState = (space) => running.get(space) || null;

const LOCAL = /LocalBusiness|MedicalBusiness|MedicalClinic|MedicalOrganization|ProfessionalService|HomeAndConstructionBusiness|HealthAndBeautyBusiness|Store|Restaurant|LegalService|FinancialService|AutomotiveBusiness|LodgingBusiness|FoodEstablishment|Dentist|Physician/;

// What a check found, as the numbers and the fixes.
export function digest(check) {
  const ok = check.pages.filter((p) => p.status === 200 && p.title !== undefined);
  const live = ok.filter((p) => !p.noindex);
  const titles = new Map();
  // A list's later pages (/page/2/) and a page that names another as the real one (canonical) are not duplicates.
  const own = (p) => !/\/page\/\d+\/?$/.test(p.url) && (!p.canonical || p.canonical.replace(/\/$/, '') === (p.finalUrl || p.url).replace(/\/$/, ''));
  for (const p of live.filter(own)) if (p.title) titles.set(p.title.toLowerCase(), [...(titles.get(p.title.toLowerCase()) || []), p.url]);
  const dupUrls = [...titles.values()].filter((l) => l.length > 1).flat();
  const of = (f) => live.filter(f).map((p) => p.url);
  const noDesc = of((p) => !p.description), noH1 = of((p) => !p.h1?.length), manyH1 = of((p) => p.h1?.length > 1);
  const longT = of((p) => p.title && p.title.length > 60), thin = of((p) => p.words < 300);
  const noAltPages = live.filter((p) => p.noAlt > 0).sort((a, b) => b.noAlt - a.noAlt);
  const noAlt = live.reduce((s, p) => s + (p.noAlt || 0), 0), imgs = live.reduce((s, p) => s + (p.images || 0), 0);
  const withSchema = live.filter((p) => p.schema?.length).length;
  const types = new Set(live.flatMap((p) => p.schema || []));
  const hidden = check.pages.filter((p) => p.noindex).map((p) => p.url);
  const answer = ok.length ? Math.round(ok.reduce((s, p) => s + p.ms, 0) / ok.length) : null;
  const m = check.speed?.mobile || {}, d = check.speed?.desktop || {}, g = check.google || {};
  const fixes = [];
  const fix = (sev, what, why, urls = [], count = urls.length) => fixes.push({ sev, what, why, count, urls: urls.slice(0, 8) });
  if (!check.site.https) fix('high', 'The site is not on HTTPS', 'Browsers mark it "Not secure" and Google ranks secure sites first.', [check.url], 1);
  else if (check.site.httpToHttps === false) fix('high', 'http:// does not send people on to https://', 'Two copies of the site split its ranking and some visitors see "Not secure".', [check.url], 1);
  if (m.score != null && m.score < 50) fix('high', `Slow on phones: speed score ${m.score} of 100`, `The main content takes ${(m.lcp / 1000).toFixed(1)} s to show on a phone; Google wants it under 2.5 s. Most visitors are on phones, and slow pages rank lower and lose visitors before they load.`, [check.url], 1);
  else if (m.score != null && m.score < 90) fix('medium', `Could be faster on phones: speed score ${m.score} of 100`, `The main content shows after ${(m.lcp / 1000).toFixed(1)} s on a phone; Google wants under 2.5 s.`, [check.url], 1);
  if (m.bytes > 3e6) fix('medium', `The home page is heavy: ${(m.bytes / 1e6).toFixed(1)} MB`, 'Large pictures and scripts are the usual cause. Smaller files load faster on phones.', [check.url], 1);
  if (check.broken.length) fix('high', `${check.broken.length} broken link${check.broken.length === 1 ? '' : 's'}`, 'Visitors hit a dead end and Google sees a neglected site.', check.broken.map((b) => b.url));
  if (!types.size || ![...types].some((t) => LOCAL.test(t))) fix('medium', 'No local business details for Google (structured data)', 'Structured data tells Google the business name, address, phone, hours and service area, which feeds the map results and rich listings.', [check.url], 1);
  if (noDesc.length) fix('medium', `${noDesc.length} page${noDesc.length === 1 ? ' has' : 's have'} no description`, 'Google writes its own snippet instead, and a good description is what gets the click.', noDesc);
  if (dupUrls.length) fix('medium', `${dupUrls.length} pages share a title with another page`, 'Google cannot tell them apart and may show the wrong one.', dupUrls);
  if (noH1.length) fix('medium', `${noH1.length} page${noH1.length === 1 ? ' has' : 's have'} no main heading (H1)`, 'The main heading tells readers and Google what the page is about.', noH1);
  if (!check.site.sitemap) fix('medium', 'No sitemap', 'A sitemap lists every page for Google, so new pages are found sooner.', [check.url], 1);
  if (hidden.length) fix('low', `${hidden.length} page${hidden.length === 1 ? ' is' : 's are'} hidden from Google (noindex)`, 'Fine if on purpose (thank-you pages); a mistake if it is a page that should be found.', hidden);
  if (noAlt) fix(noAlt > 20 ? 'medium' : 'low', `${noAlt} of ${imgs} pictures have no alt text`, 'Alt text describes a picture to screen readers and to Google Images.', noAltPages.map((p) => p.url), noAlt);
  if (longT.length) fix('low', `${longT.length} title${longT.length === 1 ? ' is' : 's are'} too long for Google`, 'Over about 60 characters, Google cuts the title off with "…".', longT);
  if (thin.length) fix('low', `${thin.length} thin page${thin.length === 1 ? '' : 's'} (under 300 words)`, 'Pages with little on them rarely rank. Add to them, or fold them into another page.', thin);
  if (manyH1.length) fix('low', `${manyH1.length} page${manyH1.length === 1 ? ' has' : 's have'} more than one main heading`, 'One H1 a page makes clear what the page is about.', manyH1);
  if (!check.site.robots) fix('low', 'No robots.txt', 'It tells search engines what to read and where the sitemap is.', [check.url], 1);
  // AI search: crawlers, answers, llms.txt (lib/sitecheck.js AI_BOTS).
  const ai = check.ai || null, tags = check.tags || null;
  const botsIn = ai ? AI_BOTS.search.filter(([b]) => ai.robots[b] !== false) : [];
  const shut = ai ? AI_BOTS.search.filter(([b]) => ai.robots[b] === false) : [];
  const qaPages = live.filter((p) => (p.schema || []).includes('FAQPage') || (p.questions || 0) >= 2).length;
  if (ai && shut.length) fix('high', `AI search can't read the site: ${shut.map(([, w]) => w).join(', ')}`, 'robots.txt shuts these crawlers out, so those AI answers cannot cite or link the site.', [check.url.replace(/\/?$/, '/robots.txt')], shut.length);
  if (ai && qaPages < 3) fix('medium', `Only ${qaPages} page${qaPages === 1 ? '' : 's'} answer${qaPages === 1 ? 's' : ''} questions the way AI quotes them`, 'ChatGPT and Google\'s AI Overviews quote short, direct answers to real questions. A few questions families ask ("How much does home care cost in Manhattan?") answered on each service page, marked up as an FAQ, is what gets quoted.', [], 1);
  if (ai && !ai.llms) fix('low', 'No llms.txt', 'A short guide to the site for AI tools. Not used by Google yet, cheap to add.', [], 1);
  if (tags) {
    if (!tags.ga4.length && !tags.ga4Sends) fix('high', 'No Google Analytics found', 'Without it there is no record of visitors, where they came from, or what they did, so no way to show what SEO or ads brought in.', [check.url], 1);
    if (!tags.ads.length && !tags.adsSends) fix('medium', 'No Google Ads conversion tracking', 'Google Ads cannot tell which clicks became calls or form fills, so it cannot spend toward them, and there is no proof the ads pay off.', [check.url], 1);
    if (!tags.calls) fix('low', 'No call tracking', 'Phone calls are how most families reach an agency; call tracking ties each call to the search or ad that brought it.', [], 1);
  }
  if (answer > 1200) fix('medium', `The server is slow to answer: ${answer} ms a page on average`, 'A slow server holds up every page before anything else can load; better hosting or caching helps.', [], 1);
  const order = { high: 0, medium: 1, low: 2 };
  fixes.sort((a, b) => order[a.sev] - order[b.sev]);

  const readings = {
    'speed.mobile': m.score, 'speed.desktop': d.score,
    'lcp.mobile': m.lcp != null ? +(m.lcp / 1000).toFixed(2) : null, 'tbt.mobile': m.tbt != null ? Math.round(m.tbt) : null, 'cls.mobile': m.cls != null ? +m.cls.toFixed(3) : null,
    weight: m.bytes ? +(m.bytes / 1e6).toFixed(2) : null, requests: m.requests ?? null,
    'google.performance.mobile': g.mobile?.performance, 'google.performance.desktop': g.desktop?.performance, 'google.seo.mobile': g.mobile?.seo,
    'google.accessibility.mobile': g.mobile?.accessibility, 'google.bestPractices.mobile': g.mobile?.bestPractices,
    'site.pages': Math.max(check.site.sitemapUrls || 0, live.length), 'site.fixes': fixes.length,
    'site.broken': check.broken.length, 'site.noDesc': noDesc.length, 'site.dupTitles': dupUrls.length, 'site.longTitles': longT.length, 'site.noH1': noH1.length,
    'site.thin': thin.length, 'site.noAlt': noAlt, 'site.schema': live.length ? Math.round(withSchema / live.length * 100) : null, 'site.answerMs': answer
  };
  // The two scores out of 100, each made of named parts (what the dashboard and report show).
  const hasLocal = [...types].some((t) => LOCAL.test(t)), hasOrg = types.has('Organization') || hasLocal;
  const titleOk = live.filter((p) => p.title && p.title.length <= 60 && !dupUrls.includes(p.url)).length;
  const share = (n) => live.length ? n / live.length : 0;
  const speedPart = m.score != null ? [['Speed on phones', 10, m.score / 100]] : [];
  const seoParts = [
    ['Titles: present, unique, not cut off', 15, share(titleOk)], ['Descriptions', 15, share(live.length - noDesc.length)],
    ['One main heading a page', 10, share(live.length - noH1.length - manyH1.length)], ['Pictures with alt text', 10, imgs ? 1 - noAlt / imgs : 1],
    ['Pages with enough to say', 10, share(live.length - thin.length)], ['No broken links', 10, Math.max(0, 1 - check.broken.length / 10)],
    ['HTTPS, sitemap and robots.txt', 15, ((check.site.https && check.site.httpToHttps !== false ? 5 : 0) + (check.site.sitemap ? 5 : 0) + (check.site.robots ? 5 : 0)) / 15],
    ['Business details for Google', 10, hasLocal ? 1 : types.size ? 0.5 : 0], ...speedPart
  ];
  const aiParts = ai ? [
    ['AI search crawlers let in', 30, botsIn.length / AI_BOTS.search.length], ['Business details AI can read', 20, hasLocal ? 1 : hasOrg ? 0.5 : 0],
    ['Answers to real questions', 15, Math.min(1, qaPages / 5)], ['Readable without scripts', 10, (ok.find((p) => p.url === check.url || p.finalUrl === check.url)?.words || 0) >= 200 ? 1 : 0],
    ['Pages with enough to say', 10, share(live.length - thin.length)], ['llms.txt', 5, ai.llms ? 1 : 0], ...speedPart
  ] : null;
  const score = (parts) => parts ? Math.round(parts.reduce((t, [, w, g]) => t + w * g, 0) / parts.reduce((t, [, w]) => t + w, 0) * 100) : null;
  readings['seo.score'] = score(seoParts);
  readings['ai.score'] = score(aiParts);
  readings['ai.searchBots'] = ai ? botsIn.length : null;
  readings['ai.qaPages'] = ai ? qaPages : null;
  readings['track.tags'] = tags ? [tags.ga4.length || tags.ga4Sends, tags.ads.length || tags.adsSends, tags.meta, !!tags.calls].filter(Boolean).length : null;
  const parts = (p) => p && p.map(([name, weight, got]) => ({ name, weight, got: Math.round(got * 100) / 100 }));
  return { readings, fixes, types: [...types], pagesRead: check.pages.length, scores: { seo: { score: readings['seo.score'], parts: parts(seoParts) }, ai: aiParts && { score: readings['ai.score'], parts: parts(aiParts) } }, ai, tags, qaPages };
}

export async function runCheck(space, { onChange = () => {} } = {}) {
  const c = config(space);
  if (!c.site) throw Object.assign(new Error('Add the website first, in the dashboard\'s settings.'), { status: 400 });
  if (running.has(space)) return { already: true };
  running.set(space, { step: 'Starting', started: Date.now() });
  onChange();
  try {
    const check = await checkSite(c.site, { onStep: (step) => { running.set(space, { ...running.get(space), step }); onChange(); } });
    const at = check.at, { readings } = digest(check);
    const put = db.prepare('INSERT OR REPLACE INTO dash_readings (space, metric, at, value) VALUES (?, ?, ?, ?)');
    for (const [k, v] of Object.entries(readings)) if (v != null && Number.isFinite(v)) put.run(space, k, at, v);
    db.prepare('INSERT INTO dash_checks (space, at, url, data) VALUES (?, ?, ?, ?)').run(space, at, check.url, JSON.stringify(check));
    const old = db.prepare('SELECT id FROM dash_checks WHERE space = ? ORDER BY at DESC LIMIT -1 OFFSET ?').all(space, KEEP_CHECKS);
    // The first check is the baseline: always kept, never trimmed.
    const first = db.prepare('SELECT id FROM dash_checks WHERE space = ? ORDER BY at ASC LIMIT 1').get(space)?.id;
    for (const o of old) if (o.id !== first) db.prepare('DELETE FROM dash_checks WHERE id = ?').run(o.id);
    return { ok: true, at };
  } finally { running.delete(space); onChange(); }
}

// Checks that are due (each project's every-N-days), one at a time; from server.js.
let sweeping = false;
export async function dueChecks(onChange) {
  if (sweeping) return;
  sweeping = true;
  try {
    for (const row of db.prepare('SELECT space FROM dash_config').all()) {
      const c = config(row.space);
      if (!c.site || !c.every || !validSpace(row.space)) continue;
      const last = db.prepare('SELECT MAX(at) AS at FROM dash_checks WHERE space = ?').get(row.space)?.at || 0;
      if (last && Date.now() - last < c.every * DAY) continue;
      if (!last) continue;   // the first check is the baseline: taken on a click, never by itself
      await runCheck(row.space, { onChange }).catch((e) => console.warn('[dashboard] check', row.space, e.message));
    }
  } finally { sweeping = false; }
}

// ---- what the page and the report read
export function defsFor(space) {
  const c = config(space), out = {};
  for (const [k, v] of Object.entries(SITE_METRICS)) out[k] = { id: k, ...v };
  for (const x of c.custom) out[x.id] = { id: x.id, name: x.name, unit: x.unit, better: x.better, group: 'numbers', custom: true };
  return out;
}

export function series(space) {
  const out = {};
  for (const r of db.prepare('SELECT metric, at, value FROM dash_readings WHERE space = ? ORDER BY at ASC').all(space)) (out[r.metric] ||= []).push([r.at, r.value]);
  return out;
}

// The baseline and latest value of each number, and the change.
export function compare(space) {
  const c = config(space), s = series(space), defs = defsFor(space), out = {};
  for (const [k, list] of Object.entries(s)) {
    if (!defs[k]) continue;
    const base = (c.baselineAt ? list.find(([at]) => at >= c.baselineAt) : null) || list[0];
    const now = list[list.length - 1], prev = list.length > 1 ? list[list.length - 2] : null;
    const change = now[1] - base[1], d = defs[k];
    out[k] = { base, now, prev, change, good: change === 0 ? null : (d.better === 'up') === (change > 0), n: list.length };
  }
  return out;
}

export function latestCheck(space) {
  const row = db.prepare('SELECT at, url, data FROM dash_checks WHERE space = ? ORDER BY at DESC LIMIT 1').get(space);
  if (!row) return null;
  try { return JSON.parse(row.data); } catch { return null; }
}

const fmtNum = (v, unit) => {
  if (v == null) return '–';
  const n = Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-US') : String(+v.toFixed(2));
  return unit === '/100' ? `${n}/100` : unit === '%' ? `${n}%` : unit ? `${n} ${unit}` : n;
};
export const fmt = fmtNum;
const day = (at) => new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
export const grade = (score) => score == null ? null : score >= 90 ? 'good' : score >= 50 ? 'needs work' : 'poor';

// What it all means, as short paragraphs: where things stand, then what changed.
export function analysis(space) {
  const c = config(space), cmp = compare(space), defs = defsFor(space), check = latestCheck(space);
  const lines = [];
  const any = Object.values(cmp);
  if (!any.length) return [c.site ? 'No readings yet. Check the site to take the baseline: everything later is measured from it.' : 'No readings yet. Add a number to track, or a website to check.'];
  const firstAt = Math.min(...any.map((x) => x.base[0])), lastAt = Math.max(...any.map((x) => x.now[0]));
  const v = (k) => cmp[k]?.now[1];
  if (check) {
    const dg = digest(check), high = dg.fixes.filter((f) => f.sev === 'high');
    const parts = [];
    if (v('speed.mobile') != null) parts.push(`On a phone the home page scores ${v('speed.mobile')} of 100 for speed (${grade(v('speed.mobile'))})${v('lcp.mobile') != null ? `: the main content shows after ${v('lcp.mobile')} s, where Google wants under 2.5 s` : ''}. On a computer it scores ${v('speed.desktop') ?? '–'}.`);
    if (v('google.performance.mobile') != null) parts.push(`Google's own test scores it ${v('google.performance.mobile')} for speed on a phone and ${v('google.seo.mobile') ?? '–'} for SEO basics.`);
    if (v('seo.score') != null) parts.push(`SEO score ${v('seo.score')} of 100${v('ai.score') != null ? `, AI search readiness ${v('ai.score')} of 100` : ''}.`);
    if (dg.tags) { const t = dg.tags; parts.push(`Tracking: Google Analytics ${t.ga4.length || t.ga4Sends ? 'is in place' : 'was not found'}, Google Ads conversion tracking ${t.ads.length || t.adsSends ? 'is in place' : 'was not found'}, call tracking ${t.calls ? 'is in place (' + t.calls + ')' : 'was not found'}.`); }
    parts.push(`The site has ${v('site.pages')} pages${dg.pagesRead < v('site.pages') ? ` (${dg.pagesRead} read)` : ''}. ${dg.fixes.length ? `${dg.fixes.length} things to fix, ${high.length} of them serious${high.length ? ': ' + high.map((f) => f.what.toLowerCase()).join('; ') : ''}.` : 'Nothing to fix was found.'}`);
    lines.push(parts.join(' '));
  }
  if (lastAt > firstAt) {
    const moved = Object.entries(cmp).filter(([k, x]) => x.change !== 0 && x.n > 1 && defs[k]);
    const better = moved.filter(([, x]) => x.good), worse = moved.filter(([, x]) => !x.good);
    const say = ([k, x]) => `${defs[k].name.toLowerCase()} ${fmtNum(x.base[1], defs[k].unit)} → ${fmtNum(x.now[1], defs[k].unit)}`;
    const keyFirst = (a, b) => (defs[b[0]].key ? 1 : 0) - (defs[a[0]].key ? 1 : 0);
    let s = `Since the baseline on ${day(c.baselineAt || firstAt)}: `;
    s += better.length ? `better: ${better.sort(keyFirst).slice(0, 6).map(say).join('; ')}.` : 'nothing has improved yet.';
    if (worse.length) s += ` Worse: ${worse.sort(keyFirst).slice(0, 4).map(say).join('; ')}.`;
    lines.push(s);
  } else lines.push(`This is the baseline, taken ${day(firstAt)}. Every later reading is compared with it.`);
  const mine = c.custom.filter((x) => cmp[x.id]);
  if (mine.length) lines.push(mine.map((x) => { const k = cmp[x.id]; return `${x.name}: ${fmtNum(k.now[1], x.unit)}${k.n > 1 && k.change ? ` (${k.change > 0 ? '+' : ''}${fmtNum(k.change, x.unit)} since ${day(k.base[0])})` : ''}`; }).join('. ') + '.');
  return lines;
}

// Everything the dashboard page needs in one answer.
export function dashboard(space) {
  if (!validSpace(space)) throw Object.assign(new Error('That project is gone. Reload the page.'), { status: 404 });
  const c = config(space), check = latestCheck(space);
  const dg = check ? digest(check) : null;
  const checks = db.prepare('SELECT at FROM dash_checks WHERE space = ? ORDER BY at ASC').all(space).map((r) => r.at);
  return {
    config: c, tiles: TILES, aiBots: AI_BOTS, templates: TEMPLATES, defs: defsFor(space), series: series(space), compare: compare(space), analysis: analysis(space),
    fixes: dg?.fixes || [], types: dg?.types || [], scores: dg?.scores || null, ai: dg?.ai || null, tags: dg?.tags || null, qaPages: dg?.qaPages ?? null, checks, lastCheck: check ? { at: check.at, url: check.url, site: check.site, pagesRead: check.pages.length, linksChecked: check.linksChecked, speed: check.speed, google: check.google } : null,
    running: checkState(space)
  };
}

// The numbers as CSV: one row per reading.
export function csv(space) {
  const defs = defsFor(space), rows = [['date', 'measure', 'value', 'unit']];
  for (const r of db.prepare('SELECT metric, at, value FROM dash_readings WHERE space = ? ORDER BY at ASC, metric ASC').all(space)) {
    const d = defs[r.metric]; if (!d) continue;
    rows.push([new Date(r.at).toISOString(), d.name, r.value, d.unit]);
  }
  const cell = (v) => { if (typeof v === 'number') return String(v); const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : /^[=+\-@]/.test(s) ? `'${s}` : s; };
  return rows.map((r) => r.map(cell).join(',')).join('\n') + '\n';
}
