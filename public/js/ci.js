// Sessions, Builds (once the Actions page): GitHub Actions runs, live, with the same colours as GitHub
// (yellow glowing while it runs, green passed, red failed), and the run strip
// each session shows for the repo it works in.
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
const CI_LABEL = { running: 'Running', queued: 'Queued', success: 'Passed', failure: 'Failed', cancelled: 'Cancelled', skipped: 'Skipped', action: 'Waiting for approval' };
let keepSel = null;   // the run to show once the page switches to Actions
const CI_ACTIVE = (st) => st === 'running' || st === 'queued';
const ciDot = (st, title) => `<span class="ci-dot ${esc(st)}" title="${esc(title || CI_LABEL[st] || st)}"></span>`;

// "45s", "3m 12s", "1h 4m"
function dur(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return s + 's';
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}
// Running time ticks every second without redrawing the page.
const ciTime = (r) => CI_ACTIVE(r.state)
  ? `<span class="mono" data-tick="${r.startedAt}">${dur(Date.now() - r.startedAt)}</span>`
  : `<span class="mono muted" title="took ${dur(r.updatedAt - r.startedAt)}">${ago(r.updatedAt)}</span>`;
setInterval(() => { for (const el of document.querySelectorAll('[data-tick]')) el.textContent = dur(Date.now() - Number(el.dataset.tick)); }, 1000);

function ciRun(id) {
  for (const repo of S.actions || []) {
    const r = repo.runs.find((x) => String(x.id) === String(id));
    if (r) return { ...r, repo: repo.name, fullName: repo.fullName, space: repo.space };
  }
  return null;
}
const ciRepo = (fullName) => (S.actions || []).find((a) => a.fullName === fullName);
const ciActiveCount = () => (S.actions || []).filter(inProject).reduce((n, a) => n + a.runs.filter((r) => CI_ACTIVE(r.state)).length, 0);
// The rail's light: yellow while anything runs, red if a repo's newest run failed.
function ciLight() {
  const repos = (S.actions || []).filter(inProject);
  if (repos.some((a) => a.runs.some((r) => CI_ACTIVE(r.state))) || checksLight() === 'running') return 'running';
  if (repos.some((a) => a.runs[0]?.state === 'failure' && Date.now() - a.runs[0].updatedAt < 2 * 86400e3) || checksLight() === 'failure') return 'failure';
  return '';
}
const jobChips = (r) => (r.jobs || []).length > 1 || (r.jobs || []).some((j) => j.state !== r.state)
  ? `<span class="ci-jobs">${r.jobs.map((j) => `<span class="ci-job">${ciDot(j.state)}${esc(j.name)}</span>`).join('')}</span>` : '';

function ciRow(r, repo, attrs) {
  const step = CI_ACTIVE(r.state) && (r.jobs || []).find((j) => j.step)?.step;
  return `<button class="ci-row ${isSel('ci', String(r.id)) ? 'sel' : ''}" type="button" ${attrs}>
    ${ciDot(r.state)}
    <span class="ci-main"><span class="t">${esc(r.title)}</span>
      <span class="s"><b>${esc(r.workflow)}</b> #${r.number}${r.attempt > 1 ? ` · try ${r.attempt}` : ''} · ${esc(r.branch || '')} · ${esc(r.event)}${r.actor ? ' by ' + esc(r.actor) : ''}${step ? ` · <span class="ci-step">${esc(step)}</span>` : ''}</span>
      ${jobChips(r)}</span>
    <span class="r">${ciTime(r)}</span></button>`;
}

function renderActionsPage() {
  const repos = (S.actions || []).filter(inProject);
  const live = ciActiveCount();
  let html = `<div class="sessions-head"><h1 class="page-title">Sessions</h1>${subTabs()}<span class="grow"></span>
    ${live ? `<span class="chip hot">${ciDot('running')} ${live} running</span>` : ''}<span class="mono muted">${S.status.github.at ? 'GitHub Actions, live · checked ' + since(S.status.github.at) : ''}</span></div>`;
  if (S.status.github.ok === false) html += `<section class="card"><p class="empty">GitHub isn't connected. Run <span class="mono">gh auth login</span> in a terminal.</p></section>`;
  else if (!repos.length) html += `<section class="card"><p class="empty">No workflow runs in the last few days${project === 'all' ? '' : ' for this project'}. Push to a repo with GitHub Actions and its runs show here as they go.</p></section>`;
  for (const repo of repos) {
    const sess = allTerms().filter((t) => t.ci?.fullName === repo.fullName);
    html += `<section class="card ci-repo"><div class="ci-head">${tag(repo.space)}<h2>${esc(repo.name)}</h2><span class="mono muted">${esc(repo.fullName)}</span>
      ${sess.length ? `<span class="mono muted">· ${sess.map((t) => esc(t.name)).join(', ')}</span>` : ''}<span class="grow"></span>
      <a class="icon-btn" href="https://github.com/${esc(repo.fullName)}/actions" target="_blank" rel="noopener">Open on GitHub</a></div>
      <div class="list">${repo.runs.slice(0, 8).map((r) => ciRow(r, repo, `data-type="ci" data-key="${r.id}"`)).join('')}</div></section>`;
  }
  $('page').innerHTML = html;
}

function ciDetail(x, kick) {
  const jobs = (x.jobs || []).map((j) => `<li>${ciDot(j.state)} <a href="${esc(j.url)}" target="_blank" rel="noopener">${esc(j.name)}</a>${j.step ? ` · <span class="ci-step">${esc(j.step)}</span>` : ''}
    <span class="mono muted">${j.startedAt ? (j.endedAt ? dur(j.endedAt - j.startedAt) : `<span data-tick="${j.startedAt}">${dur(Date.now() - j.startedAt)}</span>`) : ''}</span></li>`).join('');
  return kick('GitHub Actions') + `<h2>${esc(x.title)}</h2>
    <p class="ci-status ${esc(x.state)}">${ciDot(x.state)} ${esc(CI_LABEL[x.state] || x.state)} · ${ciTime(x)}</p>
    ${jobs ? `<div class="section-label">Jobs</div><ul class="tl ci-joblist">${jobs}</ul>` : ''}
    <dl class="facts"><dt>Repo</dt><dd>${esc(x.fullName)}</dd><dt>Workflow</dt><dd>${esc(x.workflow)} #${x.number}</dd><dt>Branch</dt><dd>${esc(x.branch || '')} <span class="mono muted">${esc(x.sha)}</span></dd>
    <dt>Started by</dt><dd>${esc(x.event)}${x.actor ? ' · ' + esc(x.actor) : ''}</dd><dt>Started</dt><dd>${when(x.startedAt)}</dd></dl>
    <div class="actions">${x.state === 'failure' ? `<button class="btn go" type="button" data-ci-act="rerun" data-run="${x.id}">Re-run failed jobs</button>` : ''}
      ${CI_ACTIVE(x.state) ? `<button class="btn danger" type="button" data-ci-act="cancel" data-run="${x.id}">Cancel run</button>` : ''}
      <a class="btn" href="${esc(x.url)}" target="_blank" rel="noopener">Open on GitHub</a></div>`;
}

// The strip on a session: runs for the repo its folder pushes to, its own branch first.
function sessionCi(t) {
  const repo = t.ci && ciRepo(t.ci.fullName);
  if (!repo) return '';
  const mine = repo.runs.filter((r) => r.branch === t.ci.branch), rest = repo.runs.filter((r) => r.branch !== t.ci.branch);
  const runs = [...mine.slice(0, 3), ...rest.slice(0, Math.max(1, 4 - Math.min(3, mine.length)))].slice(0, 4);
  return `<div class="section-label">GitHub Actions · ${esc(repo.name)} · ${esc(t.ci.branch || '')}</div>
    <div class="list ci-mini">${runs.map((r) => ciRow(r, repo, `data-ci-open="${r.id}"`)).join('')}</div>`;
}
// The light on a session's tab: the newest run on its branch.
function sessionCiDot(t) {
  const repo = t.ci && ciRepo(t.ci.fullName);
  const r = repo && (repo.runs.find((x) => x.branch === t.ci.branch) || null);
  if (!r || (!CI_ACTIVE(r.state) && Date.now() - r.updatedAt > 86400e3)) return '';
  return ciDot(r.state, `${r.workflow}: ${CI_LABEL[r.state] || r.state}`);
}

document.addEventListener('click', async (e) => {
  const open = e.target.closest('[data-ci-open]');
  if (open) { selected = { type: 'ci', key: open.dataset.ciOpen }; if (location.hash === '#builds') render(); else { keepSel = selected; location.hash = '#builds'; } return; }
  const b = e.target.closest('[data-ci-act]');
  if (!b) return;
  const r = ciRun(b.dataset.run); if (!r) return;
  b.disabled = true;
  try {
    await api(`/api/github/${b.dataset.ciAct}`, { fullName: r.fullName, runId: r.id });
    toast(b.dataset.ciAct === 'cancel' ? 'Cancelling the run.' : 'Re-running the failed jobs.');
  } catch (err) { toast(err.message); }
  finally { if (b.isConnected) b.disabled = false; }
});
