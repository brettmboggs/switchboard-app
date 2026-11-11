// A project's dashboard (#project/<id>/dashboard; the Dashboard tab on a
// project's page): the numbers that show how it is doing, set up for what the
// project is. Tiles in a grid that fills the window (lists scroll in their own
// box): the analysis in words, speed, Google's scores, site health, fixes, your
// own numbers, the project's work. Check site now, Make PDF (kept in the
// project's Files) and CSV in the head; Set up picks the template, tiles,
// website, how often it is checked and which reading is the baseline.
// The numbers come from lib/dashboard.js (GET /api/projects/<id>/dashboard).
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
let projView = 'overview';                    // the project page's tab: overview | dashboard
let DASH = { id: null, d: null, at: 0, busy: false, setup: false, adding: false, armed: null, pdfBusy: false };

function loadDash(id, force = false) {
  if (DASH.busy || (!force && DASH.id === id && Date.now() - DASH.at < (DASH.d?.running ? 1500 : 5000))) return;
  if (DASH.id !== id) DASH = { ...DASH, id, d: null, setup: false, adding: false, armed: null };
  DASH.busy = true;
  api('/api/projects/' + encodeURIComponent(id) + '/dashboard').then((d) => {
    const changedNow = JSON.stringify(d) !== JSON.stringify(DASH.d);
    DASH = { ...DASH, d, at: Date.now() };
    if (changedNow && page === 'project' && openProject === id && projView === 'dashboard') renderProject();
  }).catch((e) => { DASH.at = Date.now(); toast(e.message, { kind: 'error' }); }).finally(() => { DASH.busy = false; });
}

const dFmt = (v, unit) => {
  if (v == null) return '–';
  const n = Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-US') : String(+Number(v).toFixed(2));
  return unit === '/100' ? n : unit === '%' ? `${n}%` : unit ? `${n} ${unit}` : n;
};
const dDay = (at) => new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const dGrade = (s) => s == null ? '' : s >= 90 ? 'good' : s >= 50 ? 'warn' : 'bad';
const dGradeWord = (s) => s == null ? '' : s >= 90 ? 'Good' : s >= 50 ? 'Needs work' : 'Poor';

// A change since the baseline: arrow, amount and a word, coloured by whether it is good.
function dChange(x, d) {
  if (!x || x.n < 2 || !x.change) return `<span class="dash-chg muted">${x ? 'baseline' : ''}</span>`;
  const up = x.change > 0, amt = dFmt(Math.abs(x.change), d.unit === '/100' ? '' : d.unit);
  return `<span class="dash-chg ${x.good ? 'is-good' : 'is-bad'}" title="Since ${dDay(x.base[0])}: ${x.good ? 'better' : 'worse'}">${up ? '▲' : '▼'} ${esc(amt)}<span class="sr"> ${x.good ? 'better' : 'worse'}</span></span>`;
}

// One number over time: a line with a dot per reading; each dot names its date and value.
function dSpark(points, unit, cls = '') {
  if (!points || points.length < 2) return '';
  const W = 160, H = 40, P = 4, xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (unit === '/100') { y0 = Math.min(y0, 0); y1 = 100; } else if (y0 === y1) { y0 -= 1; y1 += 1; }
  const X = (t) => P + (x1 === x0 ? (W - 2 * P) / 2 : (t - x0) / (x1 - x0) * (W - 2 * P)), Y = (v) => P + (1 - (v - y0) / (y1 - y0)) * (H - 2 * P);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ');
  return `<svg class="dash-spark ${cls}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="From ${esc(dFmt(points[0][1], unit))} to ${esc(dFmt(points[points.length - 1][1], unit))}"><path d="${d}"/>${points.map((p) => `<circle cx="${X(p[0]).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="2.5"><title>${esc(dDay(p[0]))}: ${esc(dFmt(p[1], unit))}</title></circle>`).join('')}</svg>`;
}

// A metric row: name, value now, its change, and its line when it has one.
function dRow(D, k, { target = true } = {}) {
  const d = D.defs[k], x = D.compare[k];
  if (!d || !x) return '';
  const off = target && d.target != null && (d.better === 'down' ? x.now[1] > d.target : x.now[1] < d.target);
  return `<div class="dash-row"><span class="dash-name" title="${esc(d.name)}${d.target != null ? ` (aim: ${d.better === 'down' ? 'under' : 'over'} ${esc(dFmt(d.target, d.unit))})` : ''}">${esc(d.name)}</span>
    <span class="dash-val mono ${off ? 'is-bad' : ''}">${esc(dFmt(x.now[1], d.unit))}${d.unit === '/100' ? '<small>/100</small>' : ''}</span>${dChange(x, d)}</div>`;
}

// A score's parts: each a short bar of how much of its share it earns.
const dParts = (parts) => `<div class="dash-parts">${parts.map((p) => `<div class="dash-part" title="${esc(p.name)}: ${Math.round(p.got * p.weight)} of ${p.weight} points"><span class="dash-name">${esc(p.name)}</span><span class="dash-bar"><i style="width:${Math.round(p.got * 100)}%"></i></span><span class="dash-val mono">${Math.round(p.got * p.weight)}/${p.weight}</span></div>`).join('')}</div>`;
const dScore = (D, k, label) => { const x = D.compare[k]; if (!x) return ''; return `<div class="dash-gauge is-${dGrade(x.now[1])}"><span class="dash-label">${label}</span><span class="dash-big">${x.now[1]}<small>${dGradeWord(x.now[1])}</small></span>${dChange(x, D.defs[k])}</div>`; };
const tile = (id, title, body, extra = '') => `<section class="card dash-tile dash-tile--${id}"><div class="group-head"><h2>${title}</h2>${extra}</div><div class="dash-body">${body}</div></section>`;

function dashTiles(D, id) {
  const c = D.config, out = [];
  const site = c.site ? c.site.replace(/^https?:\/\//, '').replace(/\/$/, '') : '';
  const run = D.running;
  for (const t of c.tiles) {
    if (t === 'summary') {
      const heads = [['seo.score', 'SEO score'], ['ai.score', 'AI search readiness'], ['speed.mobile', 'Phone speed'], ['site.fixes', 'Fixes waiting'], ['speed.desktop', 'Computer speed'], ['site.pages', 'Pages']].filter(([k]) => D.compare[k]).slice(0, 4);
      const mine = c.custom.filter((x) => D.compare[x.id]).slice(0, 4 - Math.min(heads.length, 4)).map((x) => [x.id, x.name]);
      const nums = [...heads, ...mine].slice(0, 4).map(([k, label]) => { const x = D.compare[k], d = D.defs[k];
        return `<div class="dash-head-num"><span class="dash-label" title="${esc(label)}">${esc(label)}</span><span class="dash-big ${d.unit === '/100' ? 'is-' + dGrade(x.now[1]) : ''}">${esc(dFmt(x.now[1], d.unit))}${d.unit === '/100' ? `<small>${dGradeWord(x.now[1])}</small>` : ''}</span>${dChange(x, d)}</div>`; }).join('');
      const status = run ? `<p class="dash-run"><span class="dash-pulse" aria-hidden="true"></span>${esc(run.step)}…</p>`
        : D.error ? `<p class="dash-err">${esc(D.error)}</p>`
        : D.lastCheck ? `<p class="dash-meta muted">${site ? esc(site) + ' · ' : ''}checked ${ago(D.lastCheck.at)}${D.checks.length ? ` · baseline ${dDay(c.baselineAt || D.checks[0])}` : ''}${c.every ? ` · every ${c.every === 1 ? 'day' : c.every === 7 ? 'week' : c.every + ' days'}` : ''}</p>` : '';
      out.push(tile('summary', 'Analysis', `${nums ? `<div class="dash-heads">${nums}</div>` : ''}${status}<div class="dash-words">${D.analysis.map((p) => `<p>${esc(p)}</p>`).join('')}</div>`));
    }
    if (t === 'speed') {
      const sp = D.lastCheck?.speed || {};
      const gauge = (k, label) => { const x = D.compare[k]; const v = x?.now[1]; return `<div class="dash-gauge is-${dGrade(v)}"><span class="dash-label">${label}</span><span class="dash-big">${v ?? '–'}<small>${v != null ? dGradeWord(v) : ''}</small></span>${dChange(x, D.defs[k])}${dSpark(D.series[k], '/100')}</div>`; };
      const err = sp.mobile?.error || sp.error;
      out.push(tile('speed', 'Speed', !D.lastCheck ? empty(c.site ? 'Check the site to measure it.' : 'Add a website in Set up.')
        : err && !D.compare['speed.mobile'] ? `<p class="dash-err">${esc(err)}</p>`
        : `<div class="dash-gauges">${gauge('speed.mobile', 'Phone')}${gauge('speed.desktop', 'Computer')}</div>${['lcp.mobile', 'tbt.mobile', 'cls.mobile', 'weight', 'requests'].map((k) => dRow(D, k)).join('')}`));
    }
    if (t === 'google') {
      const g = D.lastCheck?.google, has = ['google.performance.mobile', 'google.seo.mobile', 'google.accessibility.mobile', 'google.bestPractices.mobile', 'google.performance.desktop'].filter((k) => D.compare[k]);
      const keyForm = `<form class="dash-key" data-dash-key><label for="dash-key-in">PageSpeed key</label><input id="dash-key-in" class="field field--sm" type="password" autocomplete="off" placeholder="${D.pagespeedKey ? 'Saved. Paste a new one to change it' : 'AIza…'}"><button class="btn btn--primary" type="submit">${D.pagespeedKey ? 'Replace' : 'Save'}</button>${D.pagespeedKey ? '<button class="btn btn--quiet" type="button" data-dash-key-rm>Remove</button>' : ''}</form>`;
      const how = `<p class="dash-help muted">Google's own scores need a free key: in Google Cloud, make a project, turn on the PageSpeed Insights API, then APIs and services, Credentials, Create credentials, API key. Paste it here; it is kept encrypted on this computer.</p>`;
      out.push(tile('google', 'Google scores', has.length ? has.map((k) => dRow(D, k)).join('') + (g?.mobile?.fieldOverall ? `<p class="dash-meta muted">Real visitors (Chrome's data): ${esc(g.mobile.fieldOverall.toLowerCase())}</p>` : '') + (D.pagespeedKey ? '' : keyForm)
        : g?.mobile?.error ? `<p class="dash-err">${esc(g.mobile.error)}</p>${keyForm}`
        : D.pagespeedKey ? `${empty('The key is saved. The next check adds Google\'s scores.')}${keyForm}` : how + keyForm));
    }
    if (t === 'health') {
      const ks = ['site.pages', 'site.broken', 'site.noDesc', 'site.dupTitles', 'site.longTitles', 'site.noH1', 'site.thin', 'site.noAlt', 'site.schema', 'site.answerMs'];
      const s = D.lastCheck?.site;
      const flags = s ? `<div class="dash-flags">${[[s.https, 'HTTPS'], ...(s.httpToHttps == null ? [] : [[s.httpToHttps, 'http to https']]), [!!s.sitemap, 'Sitemap'], [s.robots, 'robots.txt']].map(([ok, w]) => `<span class="dash-flag ${ok ? 'is-good' : 'is-bad'}">${ok ? '✓' : '✕'} ${w}</span>`).join('')}</div>` : '';
      out.push(tile('health', 'Site health', D.lastCheck ? (D.scores?.seo?.score != null ? `<div class="dash-scorehead">${dScore(D, 'seo.score', 'SEO score')}${dParts(D.scores.seo.parts)}</div>` : '') + flags + ks.map((k) => dRow(D, k)).join('') : empty(c.site ? 'Check the site to read its pages.' : 'Add a website in Set up.')));
    }
    if (t === 'ai') {
      const ai = D.ai;
      const bots = ai ? `<div class="dash-flags">${D.aiBots.search.map(([b, w]) => `<span class="dash-flag ${ai.robots[b] !== false ? 'is-good' : 'is-bad'}" title="${esc(b)}">${ai.robots[b] !== false ? '✓' : '✕'} ${esc(w.split(' (')[0])}</span>`).join('')}</div>` : '';
      const trainShut = ai ? D.aiBots.training.filter(([b]) => ai.robots[b] === false).map(([, w]) => w) : [];
      out.push(tile('ai', 'AI search', !ai ? empty(D.lastCheck ? 'Check the site again to read its AI search setup.' : 'Check the site to see whether AI search can read it.')
        : `<div class="dash-scorehead">${dScore(D, 'ai.score', 'Readiness')}${dParts(D.scores.ai.parts)}</div>${bots}
          <p class="dash-help muted">${D.qaPages ?? 0} pages answer questions · llms.txt ${ai.llms ? 'yes' : 'no'}${trainShut.length ? ` · training crawlers kept out: ${esc(trainShut.length)}` : ''}${ai.cloudflare ? ' · behind Cloudflare: check its AI crawler setting once there is access' : ''}</p>
          <p class="dash-help muted">Readiness is what can be checked from outside. Whether ChatGPT or Google's AI actually names them: track it under Your numbers.</p>`));
    }
    if (t === 'tracking') {
      const g = D.tags;
      const flag = (ok, w, note = '') => `<div class="dash-row dash-trk"><span class="dash-name">${w}</span><span class="dash-val ${ok ? '' : 'is-bad'}">${ok ? 'Found' : 'Not found'}</span><span class="dash-note mono muted" title="${esc(note)}">${esc(note)}</span></div>`;
      out.push(tile('tracking', 'Tracking and ads', !g ? empty(D.lastCheck ? 'Check the site again to read its tracking.' : 'Check the site to see what tracking it has.')
        : flag(g.ga4.length || g.ga4Sends, 'Google Analytics', g.ga4Sends ? 'sending' : g.ga4[0] || '') + flag(g.gtm.length, 'Google Tag Manager', g.gtm[0] || '') + flag(g.ads.length || g.adsSends, 'Google Ads conversions', g.ads[0] || '')
          + flag(g.meta, 'Meta (Facebook) pixel') + flag(g.calls, 'Call tracking', g.calls || '') + flag(g.bing, 'Microsoft Ads (Bing)')
          + '<p class="dash-help muted">Read from the home page, its Tag Manager container and what the page really sent. Ad spend, clicks and cost per lead need access to their Google Ads account.</p>'));
    }
    if (t === 'fixes') {
      const sev = { high: ['is-bad', 'Serious'], medium: ['is-warn', 'Worth fixing'], low: ['is-low', 'Small'] };
      out.push(tile('fixes', 'Fixes', D.fixes.length ? `<ol class="dash-fixes">${D.fixes.map((f) => `<li><span class="dash-sev ${sev[f.sev][0]}">${sev[f.sev][1]}</span><div><b>${esc(f.what)}</b><p class="muted">${esc(f.why)}</p></div></li>`).join('')}</ol>`
        : empty(D.lastCheck ? 'Nothing to fix was found.' : 'Fixes show after the first check.'), D.fixes.length ? `<span class="count">${D.fixes.length}</span>` : ''));
    }
    if (t === 'numbers') {
      const rows = c.custom.map((x) => { const cmp = D.compare[x.id];
        return `<div class="dash-num"><span class="dash-name" title="${esc(x.name)}">${esc(x.name)}</span><span class="dash-val mono">${cmp ? esc(dFmt(cmp.now[1], x.unit)) : '–'}</span>${dChange(cmp, x)}
          ${dSpark(D.series[x.id], x.unit)}<form class="dash-add" data-dash-reading="${esc(x.id)}"><label class="sr" for="dr-${esc(x.id)}">New value for ${esc(x.name)}</label><input id="dr-${esc(x.id)}" class="field field--sm" inputmode="decimal" placeholder="New value" autocomplete="off"><button class="btn" type="submit">Add</button>
          <button class="btn btn--ghost ${DASH.armed === x.id ? 'bad-text' : ''}" type="button" data-dash-forget="${esc(x.id)}">${DASH.armed === x.id ? 'Delete for good' : 'Delete'}</button></form></div>`; }).join('');
      const add = DASH.adding ? `<form class="dash-newnum" data-dash-newnum><label class="sr" for="dn-name">Name</label><input id="dn-name" class="field field--sm" placeholder="Google rating, Reviews, Leads a month" maxlength="60" autocomplete="off">
          <label class="sr" for="dn-unit">Unit</label><input id="dn-unit" class="field field--sm dash-unit" placeholder="Unit" maxlength="12" autocomplete="off"><label class="sr" for="dn-better">Better when</label><select id="dn-better" class="field field--sm"><option value="up">Higher is better</option><option value="down">Lower is better</option></select>
          <button class="btn btn--primary" type="submit">Track it</button><button class="btn btn--quiet" type="button" data-dash-newnum-cancel>Cancel</button></form>` : '';
      out.push(tile('numbers', 'Your numbers', (rows || (DASH.adding ? '' : empty('Track anything by hand: a Google rating, reviews, leads, calls, sales. Each value you add is kept with its date.'))) + add,
        DASH.adding ? '' : `<button class="btn btn--ghost" type="button" data-dash-newnum-open>Track a number</button>`));
    }
    if (t === 'work') {
      const mine = (x) => inSpace(x, id), cards = flight().filter(mine), needs = cards.filter((x) => x.st === 'needs').length;
      const todos = (S.items || []).filter((i) => i.kind === 'todo' && inSpace(i, id)).length;
      const done = (S.recentDone || []).filter((i) => inSpace(i, id)).length;
      out.push(tile('work', 'Work', `<div class="dash-heads">${[[needs, 'Needs you'], [cards.length, 'In flight'], [todos, 'To-dos open'], [done, 'Done, 3 days']].map(([n, w]) => `<div class="dash-head-num"><span class="dash-label">${w}</span><span class="dash-big">${n}</span></div>`).join('')}</div>`));
    }
  }
  return out.join('');
}

function dashSetup(D) {
  const c = D.config;
  const tiles = Object.entries(D.tiles).map(([k, t]) => `<label class="dash-pick" title="${esc(t.about)}"><input type="checkbox" data-dash-tile="${k}" ${c.tiles.includes(k) ? 'checked' : ''}> ${esc(t.name)}</label>`).join('');
  const base = D.checks.length ? `<label class="dash-field"><span>Baseline</span><select id="dash-base" class="field field--sm"><option value="">The first check (${dDay(D.checks[0])})</option>${D.checks.slice(1).map((at) => `<option value="${at}" ${c.baselineAt === at ? 'selected' : ''}>${new Date(at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</option>`).join('')}</select></label>` : '';
  return `<form class="card dash-setup" data-dash-setup><div class="group-head"><h2>Set up this dashboard</h2></div>
    <div class="dash-setup-grid"><label class="dash-field"><span>Website</span><input id="dash-site" class="field field--sm" placeholder="example.com" value="${esc(c.site || '')}" autocomplete="off"></label>
    <label class="dash-field"><span>Check it</span><select id="dash-every" class="field field--sm">${[[0, 'Only when I click'], [1, 'Every day'], [7, 'Every week'], [30, 'Every month']].map(([v, w]) => `<option value="${v}" ${c.every === v ? 'selected' : ''}>${w}</option>`).join('')}</select></label>${base}</div>
    <div class="dash-picks">${tiles}</div>
    <div class="form-row"><button class="btn btn--primary" type="submit">Save</button><button class="btn" type="button" data-dash-setup-cancel>Cancel</button></div></form>`;
}

function dashStart(D) {
  return `<section class="card dash-start"><h2>What is this project?</h2><p class="muted">Pick a starting point. You can change the tiles any time in Set up.</p>
    <form class="dash-templates" data-dash-template>${Object.entries(D.templates).map(([k, t]) => `<button class="dash-template" type="submit" value="${k}"><b>${esc(t.name)}</b><span class="muted">${t.tiles.map((x) => esc(D.tiles[x].name)).join(', ')}</span></button>`).join('')}
    <label class="dash-field dash-start-site"><span>Website, for a site's dashboard</span><input id="dash-start-site" class="field" placeholder="example.com" autocomplete="off"></label></form></section>`;
}

// Called by renderProject when the Dashboard tab is open.
function dashboardHtml(id) {
  loadDash(id);
  const D = DASH.id === id ? DASH.d : null;
  if (!D) return `<div class="dash" data-dash="${esc(id)}"><section class="card">${empty('Loading the dashboard…')}</section></div>`;
  if (!D.config.set) return `<div class="dash" data-dash="${esc(id)}">${dashStart(D)}</div>`;
  const full = ['summary', 'speed', 'fixes', 'health', 'ai', 'tracking', 'numbers', 'google'].every((t) => D.config.tiles.includes(t)) && D.config.tiles.length === 8;
  return `<div class="dash" data-dash="${esc(id)}">${DASH.setup ? dashSetup(D) : ''}<div class="dash-grid${full ? ' dash-grid--site' : ''}">${dashTiles(D, id)}</div></div>`;
}
function dashboardActions(id) {
  const D = DASH.id === id ? DASH.d : null;
  if (!D?.config.set) return '';
  return `${D.config.site ? `<button class="btn btn--primary" type="button" data-dash-check ${D.running ? 'disabled' : ''}>${D.running ? 'Checking…' : D.checks.length ? 'Check site now' : 'Take the baseline'}</button>` : ''}
    <button class="btn" type="button" data-dash-pdf ${DASH.pdfBusy ? 'disabled' : ''}>${DASH.pdfBusy ? 'Making PDF…' : 'Make PDF'}</button>
    <a class="btn btn--ghost" href="/api/projects/${encodeURIComponent(id)}/dashboard/report" target="_blank" rel="noopener">Open report</a>
    <a class="btn btn--ghost" href="/api/projects/${encodeURIComponent(id)}/dashboard/csv" download>CSV</a>
    <button class="btn btn--ghost" type="button" data-dash-setup-open aria-pressed="${DASH.setup}">Set up</button>`;
}

const dashApi = (part, body) => api(`/api/projects/${encodeURIComponent(openProject)}/dashboard/${part}`, body);
const dashAgain = () => { loadDash(openProject, true); };

document.addEventListener('click', (e) => {
  if (page !== 'project' || projView !== 'dashboard') return;
  if (e.target.closest('[data-dash-check]')) { dashApi('check', {}).then(() => { toast('Checking the site. It takes a minute or two.'); setTimeout(dashAgain, 600); }).catch((err) => toast(err.message, { kind: 'error' })); return; }
  if (e.target.closest('[data-dash-pdf]')) {
    DASH.pdfBusy = true; renderProject();
    dashApi('pdf', {}).then((r) => { projFiles = { ...projFiles, list: r.files, at: Date.now() }; toast(`Saved ${r.name} in this project's Files.`, { action: { label: 'Open', run: () => openKeptFile(`/api/projects/${encodeURIComponent(openProject)}/files/${encodeURIComponent(r.name)}`) } }); })
      .catch((err) => toast(err.message, { kind: 'error' })).finally(() => { DASH.pdfBusy = false; renderProject(); });
    return;
  }
  if (e.target.closest('[data-dash-setup-open]')) { DASH.setup = !DASH.setup; renderProject(); return; }
  if (e.target.closest('[data-dash-setup-cancel]')) { DASH.setup = false; renderProject(); return; }
  if (e.target.closest('[data-dash-newnum-open]')) { DASH.adding = true; renderProject(); $('dn-name')?.focus(); return; }
  if (e.target.closest('[data-dash-newnum-cancel]')) { DASH.adding = false; renderProject(); return; }
  const fg = e.target.closest('[data-dash-forget]');
  if (fg) {
    // Deleting asks once, in place: the button becomes "Delete for good".
    if (DASH.armed !== fg.dataset.dashForget) { DASH.armed = fg.dataset.dashForget; renderProject(); return; }
    DASH.armed = null;
    dashApi('number-forget', { metric: fg.dataset.dashForget }).then(() => { toast('Deleted.'); dashAgain(); }).catch((err) => toast(err.message, { kind: 'error' }));
    return;
  }
  if (e.target.closest('[data-dash-key-rm]')) { api('/api/dashboard/pagespeed-key', { key: '' }).then(() => { toast('Key removed.'); dashAgain(); }).catch((err) => toast(err.message, { kind: 'error' })); }
});

document.addEventListener('submit', (e) => {
  if (page !== 'project' || projView !== 'dashboard') return;
  const f = e.target;
  if (f.matches('[data-dash-template]')) {
    e.preventDefault();
    const template = e.submitter?.value || 'simple';
    dashApi('config', { template, site: $('dash-start-site')?.value || '' }).then(() => dashAgain()).catch((err) => toast(err.message, { kind: 'error' }));
  } else if (f.matches('[data-dash-setup]')) {
    e.preventDefault();
    const tiles = [...f.querySelectorAll('[data-dash-tile]')].filter((x) => x.checked).map((x) => x.dataset.dashTile);
    dashApi('config', { tiles, site: $('dash-site').value, every: Number($('dash-every').value), ...($('dash-base') ? { baselineAt: $('dash-base').value ? Number($('dash-base').value) : null } : {}) })
      .then(() => { DASH.setup = false; toast('Saved.'); dashAgain(); }).catch((err) => toast(err.message, { kind: 'error' }));
  } else if (f.matches('[data-dash-newnum]')) {
    e.preventDefault();
    dashApi('number', { name: $('dn-name').value, unit: $('dn-unit').value, better: $('dn-better').value })
      .then(() => { DASH.adding = false; toast('Tracking it. Add its first value.'); dashAgain(); }).catch((err) => toast(err.message, { kind: 'error' }));
  } else if (f.matches('[data-dash-reading]')) {
    e.preventDefault();
    const input = f.querySelector('input');
    dashApi('reading', { metric: f.dataset.dashReading, value: input.value }).then(() => { input.value = ''; toast('Added.'); dashAgain(); }).catch((err) => toast(err.message, { kind: 'error' }));
  } else if (f.matches('[data-dash-key]')) {
    e.preventDefault();
    api('/api/dashboard/pagespeed-key', { key: $('dash-key-in').value }).then(() => { toast('Key saved. The next check adds Google\'s scores.'); dashAgain(); }).catch((err) => toast(err.message, { kind: 'error' }));
  }
});
