// Shared projects on the page (lib/share.js). The team itself is in Settings,
// Team (public/js/team.js); Share on a project's page opens the same controls
// for that project in #share-scrim: who is in it and, per kind, None, See or
// Edit, plus Invite. A shared project's head says who it is shared with; its
// page shows the others' Activity, its repos (Open on GitHub, Open in
// Codespaces, Download ZIP, Clone to this computer) and their pull requests.
// On Now: an invitation that came without its link (Join), "You're in" while
// the inviter's computer hands over the keys, and a link that did not work.
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
let shareSpace = null, stopArmed = false, cloneRoots = null;
const shareOf = (id) => S?.share?.projects?.[id] || null;
const initials = (name) => String(name || '?').split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
const SHARE_NEVER = 'Never shared: your other projects, your sign-ins and tokens, signatures, and what is typed in your terminals. Each person keeps their own sign-ins.';
const SHARE_SAFE = 'Encrypted end to end: the sync service passes it along but cannot read it, and everyone\'s Switchboard turns away a change from someone who may only see.';
const ROLE_WORD = { owner: 'owner', admin: 'admin', member: 'member' };
// What lib/sessshare.js and the shared results send, in words.
const SH_SESS_WORD = { working: 'Working', waiting: 'Needs them', done: 'Their turn', idle: 'Ready' };
const SH_CHECK_WORD = { passed: 'Passed', failed: 'Failed', running: 'Running', never: 'Not run yet' };
const SH_MONEY_WORD = { bill: 'Bill', invoice: 'Invoice out', paid: 'Payment' };
const SH_LEVEL_WORD = { see: 'can see', edit: 'can edit', send: 'can see and send' };
// A step in a shared session, said as what it did (the tool's own name is in the tooltip).
const SH_TOOL_WORD = { Bash: 'Ran a command', Shell: 'Ran a command', Read: 'Read a file', Write: 'Wrote a file', Edit: 'Edited a file', MultiEdit: 'Edited a file', NotebookEdit: 'Edited a notebook', Grep: 'Searched the files', Glob: 'Looked for files', WebFetch: 'Read a web page', WebSearch: 'Searched the web', Task: 'Asked a helper', Agent: 'Asked a helper', TodoWrite: 'Made a plan' };

// The line in a project's head: Share, or who it is shared with.
function shareHead(id) {
  const sh = shareOf(id);
  if (!sh) return `<button class="btn btn--ghost" type="button" data-share-open="${esc(id)}">Share</button>`;
  const people = sh.members.filter((m) => m.status === 'joined' || sh.canManage);
  const words = people.map((m) => m.name + (m.status === 'invited' ? ' (invited)' : m.role !== 'member' ? ' · ' + ROLE_WORD[m.role] : ''));
  const label = people.length ? 'Shared with ' + words.join(', ') : 'Shared';
  return `<button class="share-line" type="button" data-share-open="${esc(id)}" title="Who this project is shared with, and what">${people.slice(0, 4).map((m) => `<span class="share-face${m.status === 'invited' ? ' invited' : ''}" title="${esc(m.email)}">${esc(initials(m.name))}</span>`).join('')}<span>${esc(label)}</span>${sh.role !== 'member' ? `<span class="share-me">you · ${esc(ROLE_WORD[sh.role])}</span>` : ''}</button>`;
}

// A repo's actions, for someone who has never used git (a browser on a work
// laptop) and for someone with this Switchboard installed.
function repoRow(r) {
  const [owner, name] = r.split('/');
  const gh = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  return `<li><span class="share-who"><b>${esc(name)}</b><small title="On GitHub: ${esc(r)}">${esc(r)}</small></span><span class="share-repo-acts">
    <a class="btn btn--sm" href="https://codespaces.new/${encodeURIComponent(owner)}/${encodeURIComponent(name)}" target="_blank" rel="noopener" title="A ready-to-code copy in your browser, with your GitHub sign-in: nothing to install">Open in Codespaces</a>
    <a class="btn btn--quiet btn--sm" href="${gh}/archive/HEAD.zip" rel="noopener" title="The files as they are now, as a .zip">Download ZIP</a>
    <a class="btn btn--quiet btn--sm" href="${gh}" target="_blank" rel="noopener">Open on GitHub</a>
    <button class="btn btn--quiet btn--sm" type="button" data-clone="${esc(r)}" title="A copy in one of your code folders, made with your own GitHub sign-in; then it shows when you start a session">Clone to this computer</button></span></li>`;
}

// On a shared project's page: the others' Activity, its repos, and pull requests on them.
function shareCards(id) {
  const sh = shareOf(id);
  if (!sh) return '';
  let html = '';
  if (sh.waiting) html += `<section class="card"><p class="muted">This project is being moved to the new way of sharing. It opens as soon as ${esc(sh.members.find((m) => m.role === 'owner')?.name || 'its owner')}'s Switchboard is online.</p></section>`;
  if (sh.kinds.activity !== 'none') {
    const rows = sh.activity.map((a) => `<li><span class="share-face">${esc(initials(a.who))}</span><span class="share-who"><b>${esc(a.who)}</b><small>${a.kind === 'session' ? `${esc(a.name)} · <span class="share-st share-st--${esc(a.state)}">${esc(SH_SESS_WORD[a.state] || a.state)}</span>` : a.kind === 'push' ? `pushed to ${esc(a.branch)} · ${esc(a.repo)}` : `pull request on ${esc(a.branch)} · ${esc(a.repo)}`}</small></span><span class="mono muted">${ago(a.at)}</span></li>`).join('');
    html += `<section class="card"><div class="group-head"><h2>Activity</h2><span class="muted small">What the others are working on. Never what is in their terminals.</span></div>${rows ? `<ul class="share-act">${rows}</ul>` : empty('Nothing from the others in the last two days.')}</section>`;
  }
  if (sh.kinds.repos !== 'none' && sh.repos.length) html += `<section class="card"><div class="group-head"><h2>Repos</h2><span class="muted small">Each opens with your own GitHub sign-in.</span></div><ul class="share-repos">${sh.repos.map(repoRow).join('')}</ul></section>`;
  // Sessions: from the owner's computer, live, while it is on.
  if (sh.kinds.sessions !== 'none' && sh.role === 'member') html += sharedSessionsCard(id, sh);
  // What the owner's computer publishes into the project, kind by kind, as you may see it.
  const pub = sh.published || {}, day = (t) => t ? new Date(t).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  const card = (title, note, rows) => `<section class="card"><div class="group-head"><h2>${title}</h2><span class="muted small">${esc(note)}</span></div>${rows || empty('Nothing here yet.')}</section>`;
  if (pub.checks && sh.role === 'member') html += card('Browser checks', 'Their latest results.', pub.checks.length && `<ul class="share-act">${pub.checks.map((c) => `<li><span class="share-who"><b>${esc(c.name)}</b><small><span class="share-st share-st--${c.state === 'failed' ? 'waiting' : c.state === 'passed' ? 'done' : 'working'}">${esc(SH_CHECK_WORD[c.state] || c.state)}</span>${c.detail ? ' · ' + esc(c.detail) : ''}</small></span><span class="mono muted">${c.at ? ago(c.at) : ''}</span></li>`).join('')}</ul>`);
  if (pub.conversations && sh.role === 'member') html += card('Conversations', 'Sorted into this project. You can read them; replies stay with whoever shared them.', pub.conversations.length && `<ul class="share-convos">${pub.conversations.map((c) => `<li><details><summary><b>${esc(c.who)}</b> · ${esc(c.subject || c.snippet || '')} <span class="mono muted">${c.date ? ago(c.date) : ''}</span></summary>${c.messages.map((m) => `<div class="share-msg"><small>${esc(m.from)} · ${esc(day(m.date))}</small><p>${esc(m.text)}</p></div>`).join('')}</details></li>`).join('')}</ul>`);
  if (pub.calendar && sh.role === 'member') html += card('Calendar', 'Events in this project.', pub.calendar.length && `<ul class="share-act">${pub.calendar.map((e) => `<li><span class="share-who"><b>${esc(e.title)}</b><small>${esc(day(e.start))}${e.where ? ' · ' + esc(e.where) : ''}</small></span></li>`).join('')}</ul>`);
  if (pub.money && sh.role === 'member') html += card('Money', 'Bills, invoices and payments in this project.', pub.money.length && `<ul class="share-act">${pub.money.map((m) => `<li><span class="share-who"><b>${esc(m.text)}</b><small>${esc(SH_MONEY_WORD[m.kind] || m.kind)}${m.due_at ? ' · due ' + esc(day(m.due_at)) : ''}</small></span><span class="mono">${m.amount != null ? esc(Number(m.amount).toFixed(2)) : ''}</span></li>`).join('')}</ul>`);
  if (pub.files && sh.role === 'member') html += card('Files', 'On the owner\'s computer: names and sizes. Ask them for one you need.', pub.files.length && `<ul class="share-act">${pub.files.map((f) => `<li><span class="share-who"><b>${esc(f.name)}</b><small>${f.size != null ? esc(fmtSize(f.size)) : ''}</small></span><span class="mono muted">${f.at ? ago(f.at) : ''}</span></li>`).join('')}</ul>`);
  const prs = sh.kinds.repos !== 'none' ? (S.sharedPrs || []).filter((p) => p.space === id) : [];
  if (prs.length) html += `<section class="card"><div class="group-head"><h2>Pull requests</h2><span class="muted small">Open on this project's repos, read with your own GitHub sign-in.</span></div><div class="list share-prs">${prs.slice(0, 10).map((p) => `<a class="item" href="${esc(p.url)}" target="_blank" rel="noopener"><span class="tag" style="background:${safeColor(spaceOf(id).color)}"></span><span><span class="t">${esc(p.title)}</span><br><span class="s">${esc(p.repo)} #${Number(p.number)} · ${esc(p.author || '')}</span></span><span class="r"><span class="mono muted">${ago(p.updatedAt)}</span></span></a>`).join('')}</div></section>`;
  return html;
}

// ---- a shared project's sessions, live from its owner's computer (lib/sessshare.js)
let shSessions = {}, shSess = null, shSessTimer = null;
function sharedSessionsCard(id, sh) {
  const st = shSessions[id];
  if (!st || Date.now() - st.at > 15e3) loadSharedSessions(id);
  const owner = sh.ownerName || 'The owner';
  const rows = !st ? empty('Asking ' + owner + '\'s computer…') : st.offline ? `<p class="muted">${esc(st.offline)}</p>` : st.error ? `<p class="bad-text small">${esc(st.error)}</p>`
    : st.list.length ? `<ul class="share-act">${st.list.map((x) => `<li><button class="share-sess" type="button" data-sh-sess="${esc(x.id)}" data-space="${esc(id)}"><span class="share-who"><b>${esc(x.name)}</b><small>${esc(x.agent || '')} · <span class="share-st share-st--${esc(x.state)}">${esc(SH_SESS_WORD[x.state] || x.state)}</span></small></span><span class="mono muted">${ago(x.at)}</span></button></li>`).join('')}</ul>` : empty('No sessions in this project right now.');
  return `<section class="card"><div class="group-head"><h2>Sessions</h2><span class="muted small">${esc(owner)}'s, as the Chat view, while their computer is on.${sh.kinds.sessions === 'send' || sh.kinds.sessions === 'edit' ? ' What you send waits for them to let it in.' : ''}</span></div>${rows}</section>`;
}
function loadSharedSessions(id) {
  if (shSessions[id]?.loading) return;
  shSessions[id] = { ...(shSessions[id] || { list: [] }), loading: true, at: shSessions[id]?.at || 0 };
  api('/api/share/sessions?space=' + encodeURIComponent(id)).then((r) => { shSessions[id] = { at: Date.now(), list: r.sessions || [], offline: r.offline || null }; })
    .catch((err) => { shSessions[id] = { at: Date.now(), list: [], error: err.message }; })
    .finally(() => { if (page === 'project' && openProject === id) renderProject(); else if (page === 'sessions' && window.WEB) renderSessions(); });
}
function openSharedSession(space, term) {
  shSess = { space, term, messages: [], file: null, end: null, error: null };
  openDialog('shsess-scrim');
  drawSharedSession(); pollSharedSession();
}
async function pollSharedSession() {
  clearTimeout(shSessTimer);
  const s = shSess;
  if (!s || !$('shsess-scrim').classList.contains('open')) return;
  try {
    const q = s.file && s.end != null ? `&file=${encodeURIComponent(s.file)}&from=${s.end}` : '';
    const r = await api(`/api/share/session?space=${encodeURIComponent(s.space)}&term=${encodeURIComponent(s.term)}${q}`);
    if (r.reset || r.file !== s.file) s.messages = [];
    const seen = new Set(s.messages.map((m) => m.id));
    for (const m of r.messages || []) if (!seen.has(m.id)) s.messages.push(m);
    s.file = r.file; s.end = r.end ?? s.end; s.error = r.why && !r.messages?.length ? 'This session has nothing to show yet.' : null;
  } catch (err) { s.error = err.message; }
  drawSharedSession();
  shSessTimer = setTimeout(pollSharedSession, 3000);
}
function drawSharedSession() {
  const s = shSess, el = $('shsess-body'); if (!s || !el) return;
  const sh = shareOf(s.space), name = (shSessions[s.space]?.list || []).find((x) => x.id === s.term)?.name || 'Session';
  $('shsess-title').textContent = name;
  const line = (m) => m.k === 'user' ? `<div class="cm cm-user">${esc(m.t || '')}</div>` : m.k === 'text' ? `<div class="cm cm-text">${esc(m.t || '')}</div>` : m.k === 'tool' ? `<div class="cm cm-tool" title="${esc(m.name || '')}">${esc(SH_TOOL_WORD[m.name] || 'Used a tool')}${m.sum ? ' · ' + esc(m.sum) : ''}</div>` : m.t ? `<div class="cm cm-note">${esc(m.t)}</div>` : '';
  const canSend = sh && (sh.kinds.sessions === 'send' || sh.kinds.sessions === 'edit');
  el.innerHTML = `<div class="shsess-msgs">${s.messages.map(line).join('') || empty(s.error || 'Getting the conversation…')}</div>${s.error && s.messages.length ? `<p class="bad-text small">${esc(s.error)}</p>` : ''}
    ${canSend ? `<form class="form-row shsess-send" id="shsess-form"><label class="sr" for="shsess-text">Message</label><input class="field" id="shsess-text" autocomplete="off" placeholder="Ask to send a message"><button class="btn btn--primary" type="submit">Ask to send</button></form><p class="muted small">It goes into the session when ${esc(sh.ownerName || 'its owner')} lets it in.</p>` : '<p class="muted small">You can watch this session; sending is not shared with you.</p>'}`;
  const box = el.querySelector('.shsess-msgs'); if (box) box.scrollTop = box.scrollHeight;
}

function openShare(id) {
  shareSpace = id; stopArmed = false; teamErr = ''; teamMail = null;
  teamDraft = { space: id, kinds: { ...TEAM_DEFAULT }, existing: 'share' };
  renderShare(); openDialog('share-scrim');
}
function renderShare() {
  const el = $('share-body'); if (!el || !shareSpace) return;
  const sp = spaceOf(shareSpace), sh = shareOf(shareSpace), st = S.share || {};
  $('share-title').textContent = 'Share ' + sp.name;
  let html = `<p class="muted small">${esc(SHARE_SAFE)}</p>`;
  if (!st.signedIn || !st.ready) html += `<div class="share-need"><span>${st.signedIn ? 'This computer is signed in but does not have your account key yet.' : 'Sharing needs a Switchboard account. It is free; the people you invite make theirs from the invitation.'}</span><button class="btn" type="button" data-share-account>${st.signedIn ? 'Finish signing in' : 'Set up your account'}</button></div>`;
  else {
    if (sh && !sh.rosterOk) html += `<p class="bad-text small">The list of who runs this project could not be checked, so nobody is treated as an admin for now.</p>`;
    if (sh?.members?.length) {
      html += sh.members.map((m) => `<div class="team-proj"><div class="team-proj-head"><span class="share-who"><b>${esc(m.name)}</b><small>${m.role === 'owner' ? 'shared it' : m.status === 'invited' ? 'invited' : ROLE_WORD[m.role]}</small></span><span class="grow"></span>
        ${sh.canManage && m.role === 'member' ? `<button class="btn btn--sm" type="button" data-team-all="${esc(m.email)}" data-space="${esc(shareSpace)}">Give everything</button>` : ''}
        ${sh.canManage && m.role !== 'owner' && (sh.role === 'owner' || m.role !== 'admin') ? `<button class="btn btn--quiet btn--sm" type="button" data-team-out="${esc(m.email)}" data-space="${esc(shareSpace)}">Take off</button>` : ''}</div>
        ${kindsGrid(m.kinds, `data-team-access="${esc(m.email)}" data-space="${esc(shareSpace)}"`, !sh.canManage || m.role !== 'member')}</div>`).join('');
    }
    if (sh && !sh.canManage) html += `<p class="small">You can ${TEAM_KINDS.filter(([k]) => sh.kinds[k] !== 'none').map(([k, n]) => `${sh.kinds[k] === 'edit' ? 'see and edit' : sh.kinds[k] === 'send' ? 'see and send to' : 'see'} ${n.toLowerCase()}`).join(', ') || 'see nothing yet'} here.</p>`;
    if (!sh || sh.canManage) html += inviteForm(shareSpace);
    if (teamMail) html += mailStep();
    if (teamErr) html += `<p class="bad-text small" role="alert">${esc(teamErr)}</p>`;
    html += `<p class="muted small">${esc(SHARE_NEVER)} Everyone you share with is in Settings, Team.</p>`;
    if (sh?.role === 'owner') html += `<div class="share-foot"><span class="muted small">Taking someone off gives the project new keys, so they get nothing written after. They keep the copy they had.</span><button class="btn ${stopArmed ? 'btn--danger' : 'btn--quiet'}" type="button" data-share-stop>${stopArmed ? 'Stop sharing with everyone?' : 'Stop sharing'}</button></div>`;
    else if (sh) html += `<div class="share-foot"><span class="muted small">Leaving keeps your copy of what is here; nothing new comes.</span><button class="btn ${stopArmed ? 'btn--danger' : 'btn--quiet'}" type="button" data-share-leave>${stopArmed ? 'Leave ' + esc(sp.name) + '?' : 'Leave this project'}</button></div>`;
  }
  redrawKeeping(el, html);
}

// On Now: an invitation that came without its link, "You're in" while the keys are on their way, and a link that did not work.
function shareInvites() {
  const st = S?.share || {};
  let html = '';
  if (st.joinError) html += `<section class="card"><p class="bad-text">${esc(st.joinError)}</p></section>`;
  for (const j of st.joining || []) html += `<section class="card share-invite share-invite--in"><span class="share-face">${esc(initials(j.inviterName))}</span><div class="share-who">${j.asked ? `<b>You asked to join. ${esc(j.project)} opens once ${esc(j.inviterName)} lets you in.</b><small>You answered without the invitation's link, so they check it is you first. Opening the link from the email lets you straight in.</small>` : `<b>You're in. ${esc(j.project)} opens as soon as ${esc(j.inviterName)}'s Switchboard is online.</b><small>It finishes by itself; nothing more to do.</small>`}</div></section>`;
  for (const v of st.invites || []) {
    const kinds = TEAM_KINDS.filter(([k]) => v.kinds?.[k] && v.kinds[k] !== 'none').map(([k, n]) => `${n.toLowerCase()}: ${SH_LEVEL_WORD[v.kinds[k]] || v.kinds[k]}`).join(', ');
    html += `<section class="card share-invite"><span class="share-face">${esc(initials(v.fromName))}</span><div class="share-who"><b>${esc(v.fromName)} invited you to ${esc(v.name)}</b><small>${esc(v.from)}${kinds ? ' · ' + esc(kinds) : ''}. Nothing of yours is shared but what you put in that project.</small></div>
    <span class="share-acts"><button class="btn btn--primary" type="button" data-share-accept="${esc(v.id)}" data-pending="${v.pending ? 1 : ''}">Join</button></span></section>`;
  }
  return html;
}

// Notes: Only me, on a page in a shared project. A page someone else shared stays theirs to take back.
function onlyMeButton(p) {
  const sh = shareOf(p.space);
  if (!sh) return '';
  if (sh.kinds.pages === 'see') return `<span class="nb-only" title="You can see this project's pages; changes you make stay on this computer">View only</span>`;
  const theirs = S.sharedBy?.[p.uid];
  if (theirs && !p.private) return `<button class="btn btn--quiet" type="button" disabled title="${esc(theirs)} shared this page; only ${esc(theirs)} can make it Only me">Shared by ${esc(theirs)}</button>`;
  return `<button class="btn btn--quiet" type="button" data-page-private="${esc(p.uid)}" aria-pressed="${!!p.private}" title="${p.private ? 'Only you see this page. Click to share it with the project again.' : 'Keep this page to yourself: it stops being shared, and the others no longer see it.'}">${p.private ? 'Only me' : 'Shared'}</button>`;
}

document.addEventListener('submit', (e) => {
  if (e.target.id !== 'shsess-form') return;
  e.preventDefault();
  const text = $('shsess-text').value.trim(), s = shSess;
  if (!text || !s) return;
  api('/api/share/session-send', { space: s.space, term: s.term, text }).then((r) => { $('shsess-text').value = ''; toast(r.held ? 'Asked. It goes in when they let it in.' : 'Sent: it goes in when the session is free.'); })
    .catch((err) => toast(err.message, { kind: 'error' }));
});
document.addEventListener('click', (e) => {
  const ss = e.target.closest('[data-sh-sess]');
  if (ss) { openSharedSession(ss.dataset.space, ss.dataset.shSess); return; }
  // On your own session: a held "Jordan asks" line, let in now and from now on.
  const li = e.target.closest('[data-letin]');
  if (li) { api('/api/share/session-auto', { queue: li.dataset.letin }).then(() => api(`/api/queue/${li.dataset.letin}/release`, {})).then(() => { toast('Sent, and their messages to this session go straight in from now on.'); return load(); }).catch((err) => toast(err.message, { kind: 'error' })); return; }
  const o = e.target.closest('[data-share-open]');
  if (o) { openShare(o.dataset.shareOpen); return; }
  const pv = e.target.closest('[data-page-private]');
  if (pv) {
    const on = pv.getAttribute('aria-pressed') !== 'true';
    api('/api/pages/' + pv.dataset.pagePrivate, { private: on }).then(() => { toast(on ? 'Only you see this page now. The others no longer get it.' : 'This page is shared with the project again.'); pv.setAttribute('aria-pressed', String(on)); pv.textContent = on ? 'Only me' : 'Shared'; return load(); })
      .catch((err) => toast(err.message, { kind: 'error' }));
    return;
  }
  const cl = e.target.closest('[data-clone]');
  if (cl) {
    cl.disabled = true; cl.textContent = 'Copying…';
    api('/api/share/clone', { repo: cl.dataset.clone }).then((r) => { cl.textContent = 'On this computer'; toast(`Copied into your code folder as ${String(r.path || '').split(/[\\/]/).filter(Boolean).pop() || cl.dataset.clone.split('/').pop()}. It is in the folder list when you start a session.`); return load(); })
      .catch((err) => { cl.disabled = false; cl.textContent = 'Clone to this computer'; toast(err.message, { kind: 'error' }); });
    return;
  }
  if (e.target.closest('[data-share-account]')) { closeDialog('share-scrim'); openSettings('accounts'); return; }
  if (e.target.closest('[data-share-stop]')) {
    if (!stopArmed) { stopArmed = true; renderShare(); return; }
    teamDo('/api/share/stop', { space: shareSpace }, () => { toast(`${spaceOf(shareSpace).name} is not shared any more. Everything in it stays here.`); closeDialog('share-scrim'); });
    return;
  }
  if (e.target.closest('[data-share-leave]')) {
    if (!stopArmed) { stopArmed = true; renderShare(); return; }
    teamDo('/api/share/leave', { space: shareSpace }, () => { toast(`You left ${spaceOf(shareSpace).name}. Your copy stays.`); closeDialog('share-scrim'); });
    return;
  }
  const a = e.target.closest('[data-share-accept]');
  if (a) {
    a.disabled = true;
    const pending = !!a.dataset.pending;
    api(pending ? '/api/share/answer' : '/api/share/accept', pending ? { id: a.dataset.shareAccept, yes: true } : { id: a.dataset.shareAccept }).then((res) => { if (res.share) S.share = res.share; toast(pending ? 'You\'re in.' : `Joined ${spaceOf(res.space).name}.`); return load(); })
      .catch((err) => { a.disabled = false; toast(err.message, { kind: 'error' }); });
  }
});
