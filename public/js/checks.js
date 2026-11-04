// Browser checks (lib/browserchecks.js): a project's Playwright tests, or one page,
// run in a headless browser with no window open. Sessions, Browser checks (one
// line per check), a Needs-you card on Now when one fails, its detail panel, and
// the Add a check form. Agents add and read checks too (bin/mcp.mjs). Same lights as GitHub runs: yellow running, green, red.
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
const BC_EVERY = { 0: 'When you click Run', 60: 'Every hour', 360: 'Every 6 hours', 1440: 'Every day' };
let bcRun = null;        // { check, run }: an older run picked in the detail panel
let bcSure = null;       // the check whose Remove was clicked once

const bcList = () => (S.checks || []).filter(inProject);
const bcLive = (c) => c.runs.find((r) => r.state === 'running' || r.state === 'queued');
const bcLast = (c) => c.runs.find((r) => r.state === 'success' || r.state === 'failure' || r.state === 'cancelled');
const bcState = (c) => (bcLive(c) || bcLast(c) || {}).state || '';
const bcWhat = (c) => c.kind === 'page' ? c.url.replace(/^https?:\/\//, '').replace(/\/$/, '') : c.folder.split(/[\\/]/).filter(Boolean).slice(-2).join('/');
const bcShot = (run, n) => `/api/checks/runs/${run.id}/shot/${n}`;
function bcTime(r) {
  if (r.state === 'running') return `<span class="mono" data-tick="${r.startedAt}">${dur(Date.now() - r.startedAt)}</span>`;
  if (r.state === 'queued') return '<span class="mono muted">waiting its turn</span>';
  return `<span class="mono muted" title="took ${dur(r.endedAt - r.startedAt)}">${ago(r.endedAt)}</span>`;
}
const bcDots = (c) => `<span class="bc-hist" aria-hidden="true">${c.runs.slice(0, 8).reverse().map((r) => `<span class="ci-dot ${esc(r.state)}"></span>`).join('')}</span>`;

// A failed check needs you until it passes again or is cleared; a running one is working.
function checkCards() {
  const cards = [];
  for (const c of S.checks || []) {
    const live = bcLive(c), last = bcLast(c);
    if (live?.state === 'running') cards.push({ type: 'check', key: String(c.id), space: c.space, st: 'working', label: 'Running', where: `Browser check · ${bcWhat(c)}`, what: c.name, at: live.startedAt });
    else if (last?.state === 'failure' && !c.cleared) cards.push({ type: 'check', key: String(c.id), space: c.space, st: 'needs', label: 'Failed', where: `Browser check · ${c.name}`, what: last.summary || 'Failed', at: last.endedAt });
  }
  return cards;
}
// The Sessions light (with GitHub runs): yellow while one runs, red while one's newest run failed.
function checksLight() {
  const list = bcList();
  if (list.some((c) => bcLive(c)?.state === 'running')) return 'running';
  if (list.some((c) => bcLast(c)?.state === 'failure' && !c.cleared)) return 'failure';
  return '';
}

// One line per check: its light, its name, what it looks at, when it last ran.
// What failed, screenshots and earlier runs are in the panel on click.
function bcRow(c) {
  const st = bcState(c), r = bcLive(c) || bcLast(c);
  const sum = r && r.state === 'failure' ? `<span class="bc-sum failure">${esc(r.summary)}</span>` : '';
  return `<div class="bc-row ${isSel('check', String(c.id)) ? 'sel' : ''}">
    <button class="ci-row" type="button" data-type="check" data-key="${c.id}">${ciDot(st || 'skipped', st ? CI_LABEL[st] : 'Not run yet')}
      <span class="ci-main"><span class="t">${tag(c.space)}${esc(c.name)}</span>
        <span class="s">${c.kind === 'page' ? 'Page' : 'Tests'} · ${esc(bcWhat(c))}${c.every ? ' · ' + esc(BC_EVERY[c.every].toLowerCase()) : ''}</span>${sum}</span>
      <span class="r">${r ? bcTime(r) : '<span class="mono muted">not run yet</span>'}</span></button>
    ${bcLive(c) ? `<button class="btn" type="button" data-bc="cancel" data-id="${c.id}">Cancel</button>` : `<button class="btn" type="button" data-bc="run" data-id="${c.id}">Run</button>`}</div>`;
}

// Sessions, Browser checks.
function renderChecksPage() {
  const list = bcList();
  $('page').innerHTML = `<div class="sessions-head"><h1 class="page-title">Sessions</h1>${subTabs()}<span class="grow"></span>
      <button class="btn go" type="button" data-bc="new">Add a check</button></div>
    <section class="card bc-card">${list.length ? `<div class="list">${list.map(bcRow).join('')}</div>`
      : `<p class="empty">A check opens a page, or runs a project's Playwright tests, in a browser you never see, and puts a Needs-you card on Now when something breaks. Add one here, or ask an agent to set one up for you.</p>`}</section>`;
}

function findCheck(key) {
  const c = (S.checks || []).find((x) => String(x.id) === key);
  return c && { ...c, key: 'check:' + c.id };   // key: what Clear clears
}

function checkDetail(x, kick) {
  const r = (bcRun?.check === x.id && x.runs.find((y) => y.id === bcRun.run)) || bcLive(x) || bcLast(x);
  const newest = r && r === (bcLive(x) || bcLast(x));
  const fails = (r?.failures || []).map((f) => `<li><div class="bc-ft">${ciDot('failure')}<b>${esc(f.title)}</b></div>
      <div class="mono muted">${esc(f.file)}${f.line ? ':' + f.line : ''}${f.project ? ' · ' + esc(f.project) : ''}</div>
      <pre class="bc-err">${esc(f.error)}</pre>
      ${f.shots.length ? `<div class="bc-shots">${f.shots.map((n) => `<a href="${bcShot(r, n)}" target="_blank" rel="noopener"><img src="${bcShot(r, n)}" alt="Screenshot of ${esc(f.title)}" loading="lazy"></a>`).join('')}</div>` : ''}</li>`).join('');
  const pageShot = x.kind === 'page' && r?.shots ? `<a class="bc-page" href="${bcShot(r, 0)}" target="_blank" rel="noopener"><img src="${bcShot(r, 0)}" alt="The page as the check saw it" loading="lazy"></a>` : '';
  const facts = x.kind === 'page'
    ? [['Page', `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.url)}</a>`], x.expect && ['Must show', esc(x.expect)]]
    : [['Folder', `<span class="mono">${esc(x.folder)}</span>`], ['Command', `<span class="mono">${esc(x.command)}</span>`]];
  facts.push(['Runs', esc(BC_EVERY[x.every] || '')]);
  if (r) facts.push(['Started', `${when(r.startedAt)}${r.by === 'schedule' ? ' · on schedule' : ''}`]);
  const status = r ? `<p class="ci-status ${esc(r.state)}">${ciDot(r.state)} ${esc(CI_LABEL[r.state] || r.state)} · ${bcTime(r)}</p>` : '<p class="muted">Not run yet. Run it to see how it goes.</p>';
  const out = r && r.state !== 'queued' && r.state !== 'running' ? `<details class="bc-out"><summary>Output</summary>${extra.key === 'bcrun:' + r.id ? extra.html : '<p class="note-line">Loading…</p>'}</details>` : '';
  if (out) loadExtra('bcrun:' + r.id, `/api/checks/runs/${r.id}`, (d) => `<pre>${esc(d.output.slice(-8000)) || 'No output.'}</pre>`);
  return kick('Browser check') + `<h2>${esc(x.name)}</h2>${status}
    ${r?.summary && r.state !== 'running' ? `<p class="bc-sum ${esc(r.state)}">${esc(r.summary)}</p>` : ''}
    ${x.runs.length > 1 ? `<div class="bc-pick" role="group" aria-label="Earlier runs">${x.runs.slice().reverse().map((y) => `<button type="button" class="${y === r ? 'on' : ''}" data-bc-pick="${y.id}" title="${esc(CI_LABEL[y.state] || y.state)} · ${esc(when(y.startedAt))}">${ciDot(y.state)}</button>`).join('')}${newest ? '' : '<span class="note-line">an earlier run</span>'}</div>` : ''}
    ${pageShot}
    ${fails ? `<div class="section-label">Failed</div><ul class="bc-flist">${fails}</ul>` : ''}
    <dl class="facts">${facts.filter(Boolean).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
    <div class="actions">${bcLive(x) ? `<button class="btn danger" type="button" data-bc="cancel" data-id="${x.id}">Cancel run</button>` : `<button class="btn go" type="button" data-bc="run" data-id="${x.id}">Run now</button>`}
      ${bcLast(x)?.state === 'failure' && !x.cleared ? '<button class="btn" data-act="clear" type="button">Clear</button>' : ''}
      <button class="btn" type="button" data-bc="edit" data-id="${x.id}">Change</button>
      <button class="btn ${bcSure === x.id ? 'danger' : ''}" type="button" data-bc="remove" data-id="${x.id}">${bcSure === x.id ? 'Click again to remove' : 'Remove'}</button></div>
    ${out}`;
}

// ---------- the New check / Change form: a sheet like New session, made once.
function bcSheet() {
  if ($('bc-scrim')) return;
  document.body.insertAdjacentHTML('beforeend', `<div class="scrim" id="bc-scrim" role="dialog" aria-modal="true" aria-labelledby="bc-title">
  <form class="sheet" id="bc-form" autocomplete="off">
    <div class="sheet-head"><h2 id="bc-title">Add a check</h2><button class="icon-btn" type="button" data-close="bc-scrim">Close</button></div>
    <div class="seg" role="group" aria-label="What to check"><button type="button" data-bc-kind="page" aria-pressed="true">A web page</button><button type="button" data-bc-kind="tests" aria-pressed="false">My project's tests</button></div>
    <div class="form-grid">
      <label for="bc-url" class="bc-fpage">Address</label><input id="bc-url" class="bc-fpage" type="url" placeholder="https://example.com">
      <label for="bc-expect" class="bc-fpage">Must show</label><input id="bc-expect" class="bc-fpage" type="text" maxlength="200" placeholder="optional: words that prove it loaded">
      <label for="bc-folder" class="bc-ftests" hidden>Folder</label><input id="bc-folder" class="bc-ftests" type="text" list="bc-folders" placeholder="the project folder" hidden>
      <label for="bc-every">How often</label><select id="bc-every">${Object.entries(BC_EVERY).map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select>
    </div>
    <details class="bc-more"><summary class="muted small">More</summary><div class="form-grid">
      <label for="bc-name">Name</label><input id="bc-name" type="text" maxlength="80" placeholder="optional">
      <label for="bc-command" class="bc-ftests" hidden>Command</label><input id="bc-command" class="bc-ftests mono" type="text" value="npx playwright test" hidden>
      <label for="bc-space">Project</label><select id="bc-space"></select>
    </div></details>
    <datalist id="bc-folders"></datalist>
    <p class="muted small" id="bc-note"></p>
    <div class="form-row"><button class="btn go" type="submit" id="bc-save">Add check</button><span id="bc-msg" class="small"></span></div>
  </form></div>`);
}
let bcKind = 'page', bcEditing = null;
function bcSetKind(kind) {
  bcKind = kind;
  document.querySelectorAll('[data-bc-kind]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.bcKind === kind)));
  document.querySelectorAll('.bc-ftests').forEach((el) => { el.hidden = kind !== 'tests'; });
  document.querySelectorAll('.bc-fpage').forEach((el) => { el.hidden = kind !== 'page'; });
  $('bc-note').textContent = kind === 'tests'
    ? 'Runs the project\'s own Playwright tests and shows which failed, with screenshots.'
    : 'Fails if the page won\'t load or the words never show. First time: node scripts/setup.mjs browser.';
}
async function bcOpen(c) {
  bcSheet();
  bcEditing = c ? c.id : null;
  $('bc-title').textContent = c ? 'Change check' : 'Add a check';
  $('bc-save').textContent = c ? 'Save' : 'Add check';
  $('bc-space').innerHTML = S.spaces.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  $('bc-space').value = c ? c.space : project !== 'all' ? project : (S.spaces.find((s) => /datum/i.test(s.name)) || S.spaces[0]).id;
  $('bc-name').value = c?.name || '';
  $('bc-folder').value = c?.folder || '';
  $('bc-command').value = c?.command || 'npx playwright test';
  $('bc-url').value = c?.url || '';
  $('bc-expect').value = c?.expect || '';
  $('bc-every').value = String(c?.every || 0);
  $('bc-msg').textContent = '';
  bcSetKind(c?.kind || bcKind);
  $('bc-scrim').classList.add('open');
  (bcKind === 'tests' ? $('bc-folder') : $('bc-url')).focus();
  api('/api/folders').then((list) => { $('bc-folders').innerHTML = list.map((f) => `<option value="${esc(f.path)}">${esc(f.name)}</option>`).join(''); }).catch(() => {});
}

document.addEventListener('click', async (e) => {
  const kind = e.target.closest('[data-bc-kind]');
  if (kind) { bcSetKind(kind.dataset.bcKind); return; }
  const pick = e.target.closest('[data-bc-pick]');
  if (pick && selected?.type === 'check') { bcRun = { check: Number(selected.key), run: Number(pick.dataset.bcPick) }; renderDetail(); return; }
  const b = e.target.closest('[data-bc]');
  if (!b) return;
  const id = Number(b.dataset.id), act = b.dataset.bc;
  if (act === 'new') return bcOpen(null);
  if (act === 'edit') return bcOpen((S.checks || []).find((c) => c.id === id));
  if (act === 'remove' && bcSure !== id) { bcSure = id; renderDetail(); setTimeout(() => { if (bcSure === id) { bcSure = null; renderDetail(); } }, 4000); return; }
  b.disabled = true;
  try {
    await api('/api/checks/' + act, { id });
    if (act === 'run') { bcRun = null; if (!selected || selected.type !== 'check') selected = { type: 'check', key: String(id) }; toast('Running it, headless.'); }
    if (act === 'remove') { bcSure = null; selected = null; toast('Check removed.'); }
    await load();
  } catch (err) { toast(err.message); }
  finally { if (b.isConnected) b.disabled = false; }
});

// A folder without Playwright gets a hint before it is saved.
document.addEventListener('change', async (e) => {
  if (e.target.id !== 'bc-folder' || !e.target.value.trim()) return;
  try {
    const f = await api('/api/checks/inspect', { folder: e.target.value.trim() });
    $('bc-msg').textContent = !f.exists ? 'No folder there on this computer.' : !f.config ? 'No playwright.config in that folder. Use a command that runs your tests, or pick the folder that has it.' : !f.installed ? `Found ${f.config}, but Playwright isn't installed there yet: run npm install in that folder.` : `Found ${f.config}.`;
  } catch {}
});

document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'bc-form') return;
  e.preventDefault();
  const body = { id: bcEditing, kind: bcKind, name: $('bc-name').value, folder: $('bc-folder').value, command: $('bc-command').value, url: $('bc-url').value, expect: $('bc-expect').value, space: $('bc-space').value, every: Number($('bc-every').value) };
  $('bc-save').disabled = true;
  try {
    const r = await api('/api/checks', body);
    $('bc-scrim').classList.remove('open');
    selected = { type: 'check', key: String(r.id) };
    toast(bcEditing ? 'Saved.' : 'Added. Press Run to try it.');
    await load();
  } catch (err) { $('bc-msg').textContent = err.message; }
  finally { $('bc-save').disabled = false; }
});
