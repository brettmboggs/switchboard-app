// The web board's Sessions and Browser checks (public/js/web/): no computer is
// behind the board, so its Sessions are those of the projects shared with you,
// live from the computer of whoever shares them (lib/sessshare.js), opened as
// the Chat view (share.js openSharedSession; Send waits for them to let it in);
// and its Browser checks are those projects' latest results, to read.
// One of the page's scripts in public/js, loaded in order by index.html.
function webSharedProjects(kind) {
  return Object.entries(S.share?.projects || {}).filter(([space, sh]) => sh.kinds?.[kind] && sh.kinds[kind] !== 'none' && sh.role !== 'owner' && (project === 'all' || project === space));
}

function renderWebSessions() {
  const list = webSharedProjects('sessions');
  let html = `<div class="sessions-head"><h1 class="page-title">Sessions</h1>${subTabs()}<span class="grow"></span>${projectPicker()}</div>`;
  if (!list.length) html += `<section class="card"><p class="empty">${Object.keys(S.share?.projects || {}).length ? 'None of your shared projects shares its sessions with you. Whoever runs a project can turn on Sessions for you in their Settings, Team.' : 'Sessions here are the ones in projects shared with you. Join one from its invitation and they show here.'}</p></section>`;
  for (const [space, sh] of list) html += sharedSessionsCard(space, sh).replace('<h2>Sessions</h2>', `<h2>${tag(space)}${esc(spaceOf(space).name)}</h2>`);
  html += `<p class="muted small">Starting sessions of your own needs Switchboard on a computer; here you follow and send to the ones shared with you.</p>`;
  $('page').innerHTML = html;
}

function renderWebChecks() {
  const rows = webSharedProjects('checks').flatMap(([space]) => (S.sharedChecks || []).filter((c) => c.space === space));
  const st = (s) => s === 'failed' ? 'failure' : s === 'passed' ? 'success' : s === 'running' ? 'running' : 'skipped';
  $('page').innerHTML = `<div class="sessions-head"><h1 class="page-title">Sessions</h1>${subTabs()}<span class="grow"></span>${projectPicker()}</div>
    <section class="card">${rows.length ? `<div class="list">${rows.map((c) => `<div class="item"><span>${ciDot(st(c.state))}</span><span><span class="t">${tag(c.space)}${esc(c.name)}</span><br><span class="s">${esc(c.state === 'never' ? 'not run yet' : c.state)}${c.detail ? ' · ' + esc(c.detail) : ''}${c.from ? ' · from ' + esc(c.from) : ''}</span></span><span class="r"><span class="mono muted">${c.at ? ago(c.at) : ''}</span></span></div>`).join('')}</div>`
      : '<p class="empty">Browser checks here are those of the projects shared with you, with their latest results. Adding a check needs Switchboard on a computer.</p>'}</section>`;
}
