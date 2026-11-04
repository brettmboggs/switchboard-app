// Git and pull request chips on a session's bar: files not yet committed, how
// far the branch is ahead of or behind its upstream, and the open pull request
// for the branch with its checks. Opt-in: Settings, General. The server caches
// git for 20 seconds per folder and asks GitHub once per branch every three
// minutes (lib/routes/sessionview.js); this asks it at most every 5 seconds,
// and only for the session on screen.
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
const devCache = {};   // term id -> { at, data, busy }

function devChips(t) {
  if (!S?.prefs?.devChips || t.remote) return '';
  const c = devCache[t.id] ||= { at: 0, data: null, busy: false };
  if (!c.busy && Date.now() - c.at > 5000) {
    c.busy = true;
    api(`/api/terms/${encodeURIComponent(t.id)}/dev`).then((d) => { c.data = d; }).catch(() => {})
      .finally(() => { c.at = Date.now(); c.busy = false; if (currentTerm === t.key) renderTermBar(); });
  }
  const g = c.data?.git, pr = c.data?.pr;
  let h = '';
  if (g) {
    if (g.changed) h += `<span class="dev" title="${Number(g.changed)} file${g.changed === 1 ? '' : 's'} changed and not committed">${Number(g.changed)} changed</span>`;
    if (g.ahead || g.behind) h += `<span class="mono dev" title="${esc(`${Number(g.ahead)} commit${g.ahead === 1 ? '' : 's'} to push, ${Number(g.behind)} to pull (${g.upstream})`)}">${g.ahead ? '↑' + Number(g.ahead) : ''}${g.ahead && g.behind ? ' ' : ''}${g.behind ? '↓' + Number(g.behind) : ''}</span>`;
    else if (g.branch && !g.upstream) h += `<span class="dev" title="This branch is not on GitHub (or any remote) yet">not pushed</span>`;
    if (!t.ci?.branch && g.branch) h += `<span class="mono" title="Branch">⎇ ${esc(g.branch)}</span>`;
  }
  if (pr) {
    const checks = pr.checks ? { success: 'checks passed', failure: 'checks failed', running: 'checks running' }[pr.checks] : 'no checks';
    h += `<a class="pr" href="${safeHref(pr.url)}" target="_blank" rel="noopener noreferrer" title="${esc(`#${Number(pr.number)} ${pr.title}${pr.draft ? ' (draft)' : ''} · ${checks}`)}">${pr.checks ? ciDot(pr.checks, checks) : ''}PR #${Number(pr.number)}${pr.draft ? ' · draft' : ''}</a>`;
  }
  return h;
}
