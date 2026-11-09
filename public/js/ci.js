// Sessions, Builds (once the Actions page): GitHub Actions runs, live, with the same colours as GitHub
// (yellow glowing while it runs, green passed, red failed), and the run strip
// each session shows for the repo it works in.
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
const CI_LABEL = { running: 'Running', queued: 'Queued', success: 'Passed', failure: 'Failed', cancelled: 'Cancelled', skipped: 'Skipped', action: 'Waiting for approval' };
let keepSel = null;   // the run to show once the page switches to Actions
const CI_ACTIVE = (st) => st === 'running' || st === 'queued';
// What started a run, in words (GitHub's event names are kept for the tooltip).
const CI_EVENT = { push: 'after a push', pull_request: 'for a pull request', pull_request_target: 'for a pull request', workflow_dispatch: 'started by hand', schedule: 'on a schedule', release: 'for a release', merge_group: 'before a merge', workflow_run: 'after another build', repository_dispatch: 'started from outside', workflow_call: 'from another build', create: 'for a new branch or tag', delete: 'after a delete', issues: 'for an issue', issue_comment: 'for a comment', pull_request_review: 'for a review', deployment: 'for a deploy', page_build: 'for the website' };
const ciEvent = (ev) => ev ? CI_EVENT[ev] || String(ev).replace(/_/g, ' ') : '';
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
      <span class="s"><b>${esc(r.workflow)}</b>${r.number ? ` #${Number(r.number)}` : ''}${r.attempt > 1 ? ` · try ${Number(r.attempt)}` : ''} · ${esc(r.branch || '')}${r.event ? ` · <span title="${esc(r.event)}">${esc(ciEvent(r.event))}</span>` : ''}${r.actor ? ' by ' + esc(r.actor) : ''}${step ? ` · <span class="ci-step">${esc(step)}</span>` : ''}</span>
      ${jobChips(r)}</span>
    <span class="r">${ciTime(r)}</span></button>`;
}

// Builds opens on the builds of the session you have open on Sessions (its
// repo); "All builds" shows every project's, until you open another session.
let buildsAllFor = null;
function renderActionsPage() {
  const t = currentTerm && buildsAllFor !== currentTerm ? termByKey(currentTerm) : null;
  const mine = t?.ci?.fullName ? (S.actions || []).filter((a) => a.fullName === t.ci.fullName) : null;
  const repos = mine || (S.actions || []).filter(inProject);
  const live = ciActiveCount();
  let html = `<div class="sessions-head"><h1 class="page-title">Sessions</h1>${subTabs()}<span class="grow"></span>${projectPicker()}
    ${live ? `<span class="chip hot">${ciDot('running')} ${live} running</span>` : ''}<span class="muted small">${S.status.github.at ? 'Live from GitHub · checked ' + since(S.status.github.at) : ''}</span></div>`;
  if (t) html += `<p class="ci-for muted small">${mine ? `Builds for <b>${esc(termLabel(t))}</b>` : `<b>${esc(termLabel(t))}</b> has no builds on GitHub, so here are all of them`}${mine ? ' · <button class="btn btn--quiet btn--sm" type="button" data-ci-all>All builds</button>' : ''}</p>`;
  else if (buildsAllFor && buildsAllFor === currentTerm && termByKey(currentTerm)?.ci) html += `<p class="ci-for muted small"><button class="btn btn--quiet btn--sm" type="button" data-ci-mine>Just ${esc(termLabel(termByKey(currentTerm)))}'s builds</button></p>`;
  if (mine && !mine.length) html += `<section class="card"><p class="empty">No builds for ${esc(termLabel(t))} in the last few days. When it pushes to GitHub, each build shows here as it runs.</p></section>`;
  else if (S.status.github.ok === false && !repos.length) html += `<section class="card"><p class="empty">${window.WEB ? `GitHub did not answer: ${esc(S.status.github.error || 'try Connect again in Settings, Account')}.` : 'GitHub isn\'t connected, so builds can\'t show here yet. Sign in once and they appear as they run.'}</p>${window.WEB ? '' : '<div class="actions"><button class="btn btn--primary" type="button" data-ci-signin title="Opens a terminal running gh auth login; follow the steps in the browser window it opens">Sign in to GitHub</button></div>'}</section>`;
  else if (!repos.length) html += `<section class="card"><p class="empty">No builds in the last few days${project === 'all' ? '' : ' for this project'}. Projects that build on GitHub show each build here as it runs.</p></section>`;
  for (const repo of repos) {
    const sess = allTerms().filter((t) => t.ci?.fullName === repo.fullName);
    html += `<section class="card ci-repo"><div class="ci-head">${tag(repo.space)}<h2 title="${esc(repo.fullName)}">${esc(repo.name)}</h2>
      ${sess.length ? `<span class="muted small">${sess.length === 1 ? 'Session' : 'Sessions'}: ${sess.map((t) => esc(t.name)).join(', ')}</span>` : ''}<span class="grow"></span>
      <a class="btn btn--quiet" href="https://github.com/${esc(repo.fullName)}/actions" target="_blank" rel="noopener">Open on GitHub</a></div>
      <div class="list">${repo.runs.slice(0, 8).map((r) => ciRow(r, repo, `data-type="ci" data-key="${r.id}"`)).join('')}</div></section>`;
  }
  $('page').innerHTML = html;
}

function ciDetail(x, kick) {
  const jobs = (x.jobs || []).map((j) => `<li>${ciDot(j.state)} <a href="${safeHref(j.url)}" target="_blank" rel="noopener">${esc(j.name)}</a>${j.step ? ` · <span class="ci-step">${esc(j.step)}</span>` : ''}
    <span class="mono muted">${j.startedAt ? (j.endedAt ? dur(j.endedAt - j.startedAt) : `<span data-tick="${j.startedAt}">${dur(Date.now() - j.startedAt)}</span>`) : ''}</span></li>`).join('');
  return kick('GitHub Actions') + `<h2>${esc(x.title)}</h2>
    <p class="ci-status ${esc(x.state)}">${ciDot(x.state)} ${esc(CI_LABEL[x.state] || x.state)} · ${ciTime(x)}</p>
    ${jobs ? `<div class="section-label">Steps</div><ul class="tl ci-joblist">${jobs}</ul>` : ''}
    <dl class="facts"><dt>Project on GitHub</dt><dd>${esc(x.fullName)}</dd><dt>Build</dt><dd>${esc(x.workflow)} #${Number(x.number)}</dd><dt>Branch</dt><dd${x.sha ? ` title="Commit ${esc(x.sha)}"` : ''}>${esc(x.branch || '')}</dd>
    <dt>Started</dt><dd${x.event ? ` title="${esc(x.event)}"` : ''}>${esc(ciEvent(x.event)) || '—'}${x.actor ? ' · by ' + esc(x.actor) : ''}</dd><dt>When</dt><dd>${when(x.startedAt)}</dd></dl>
    <div class="actions">${x.state === 'failure' ? `<button class="btn btn--primary" type="button" data-ci-act="rerun" data-run="${x.id}">Re-run the failed steps</button>` : ''}
      ${CI_ACTIVE(x.state) ? `<button class="btn btn--danger" type="button" data-ci-act="cancel" data-run="${x.id}">Cancel run</button>` : ''}
      <a class="btn" href="${safeHref(x.url)}" target="_blank" rel="noopener">Open on GitHub</a></div>`;
}

// A session's build: the newest run on its branch (or, with none there, the
// newest for its repo), as one quiet line in words. The Builds tab has the rest.
function sessionRun(t) {
  const repo = t.ci && ciRepo(t.ci.fullName);
  if (!repo) return null;
  const r = repo.runs.find((x) => x.branch === t.ci.branch) || repo.runs[0];
  return r ? { ...r, repo } : null;
}
// "build failed" / "building": only what is worth a glance, for the session list.
function sessionBuildWord(t) {
  const r = sessionRun(t);
  if (!r || r.branch !== t.ci.branch || (Date.now() - r.updatedAt > 86400e3 && !CI_ACTIVE(r.state))) return '';
  return r.state === 'failure' ? '<span class="w-bad">build failed</span>' : CI_ACTIVE(r.state) ? '<span class="w-run">building</span>' : '';
}
// The build on the session's bar, in a word, next to the branch it belongs to.
function termBuild(t) {
  const r = sessionRun(t);
  if (!r || r.branch !== t.ci.branch) return '';
  const word = r.state === 'failure' ? 'build failed' : CI_ACTIVE(r.state) ? 'building' : r.state === 'success' ? 'build passed' : 'build ' + (CI_LABEL[r.state] || r.state).toLowerCase();
  return `<button class="tb-link w-${esc(r.state)}" type="button" data-ci-open="${Number(r.id)}" title="${esc(`${r.workflow} #${Number(r.number)}: ${r.title}`)}">${word}</button>`;
}

document.addEventListener('click', async (e) => {
  if (e.target.closest('[data-ci-signin]')) { runInTerminal('gh auth login'); return; }
  if (e.target.closest('[data-ci-all]')) { buildsAllFor = currentTerm; render(); return; }
  if (e.target.closest('[data-ci-mine]')) { buildsAllFor = null; render(); return; }
  const open = e.target.closest('[data-ci-open]');
  if (open) { selected = { type: 'ci', key: open.dataset.ciOpen }; if (location.hash === '#builds') render(); else { keepSel = selected; location.hash = '#builds'; } return; }
  const b = e.target.closest('[data-ci-act]');
  if (!b) return;
  const r = ciRun(b.dataset.run); if (!r) return;
  b.disabled = true;
  try {
    await api(`/api/github/${b.dataset.ciAct}`, { fullName: r.fullName, runId: r.id });
    toast(b.dataset.ciAct === 'cancel' ? 'Cancelling the run.' : 'Re-running the failed steps.');
  } catch (err) { toast(err.message, { kind: 'error' }); }
  finally { if (b.isConnected) b.disabled = false; }
});
