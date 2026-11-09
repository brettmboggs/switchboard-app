// Your team (lib/share.js): Settings, Team. People first: invite someone once,
// by their email (they need not have a Switchboard account yet), choose which
// of your projects they are in and, per kind, None, See or Edit; make someone
// an admin; take them off a project or off the team. Inviting ends with the
// invite email: To, From and what it says are shown, and it goes only on Send,
// from your own mail ("Sam via Switchboard"); Copy link works without mail.
// Also here: following an invite link (#join), and your own sync service
// (Settings, Account). The Share button on a project's page opens the same
// controls for that one project (public/js/share.js).
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
// Everything a project has (public/js/shared/share-core.js SHARE_KINDS), each with one line of what it means.
const TEAM_KINDS = [
  ['pages', 'Pages and notes', 'Pages and their checklists, pages added from other projects, and sections of pages added on their own (read-only).'],
  ['tasks', 'To-dos and reminders', 'To-dos, reminders and quick notes in this project.'],
  ['repos', 'Repos and builds', 'The repos, their builds and pull requests. Each person uses their own GitHub sign-in.'],
  ['checks', 'Browser checks', 'The results of this project\'s browser checks.'],
  ['activity', 'Activity', 'What each person is working on: a session\'s name and state, pushes, pull requests.'],
  ['sessions', 'Sessions', 'Your sessions in this project, live, as the Chat view, while your computer is on. Send: they can ask to send a message; it waits for you to let it in.'],
  ['conversations', 'Conversations', 'Mail, Teams and Outlook conversations sorted into this project: they can read them. Replies stay yours. These are other people\'s words: share them only with someone those people would expect.'],
  ['calendar', 'Calendar', 'Calendar events in this project.'],
  ['money', 'Money', 'Bills, invoices and payments in this project.'],
  ['files', 'Files', 'The project\'s files: their names and sizes.'],
  ['about', 'About card', 'What the project is, its people and its links.']
];
const KIND_LEVELS = (k) => ['checks', 'conversations', 'calendar', 'money', 'files'].includes(k) ? ['none', 'see'] : k === 'sessions' ? ['none', 'see', 'send'] : ['none', 'see', 'edit'];
// New people get the first kinds as before; everything else is off until you turn it on.
const TEAM_DEFAULT = { pages: 'edit', tasks: 'edit', repos: 'see', checks: 'none', activity: 'none', sessions: 'none', conversations: 'none', calendar: 'none', money: 'none', files: 'none', about: 'see' };
const TEAM_ROLE_WORD = { owner: 'Owner', admin: 'Admin', member: 'Member' };
// Where an invitation stands (public/js/shared/share-core.js), in words.
const TEAM_STATUS_WORD = { invited: 'Invited', 'invited by email': 'Invited', 'asks to join': 'Asked to join', asked: 'Asked to join', joining: 'Joining', accepted: 'Joining' };
// "Give everything": a co-founder.
const TEAM_ALL = Object.fromEntries(TEAM_KINDS.map(([k]) => [k, KIND_LEVELS(k).at(-1)]));
const LEVEL_WORD = { none: 'None', see: 'See', edit: 'Edit', send: 'Send' };
let teamBusy = false, teamErr = '', teamDraft = null, teamMail = null, teamPages = {}, teamReset = null;

// One kind's level as a small select: None · See · Edit.
const kindOf = (kind) => TEAM_KINDS.find(([k]) => k === kind);
const levelSelect = (kind, level, attrs, disabled = false) => `<label class="team-lvl" title="${esc(kindOf(kind)[2])}"><span>${esc(kindOf(kind)[1])}</span><select class="field field--sm" ${attrs} data-kind="${kind}" ${disabled || teamBusy ? 'disabled' : ''}>${KIND_LEVELS(kind).map((l) => `<option value="${l}" ${(level === l || (level === 'edit' && l === 'send')) ? 'selected' : ''}>${LEVEL_WORD[l]}</option>`).join('')}</select></label>`;
// Every kind as a labelled select; with lines, each also says what it means (the invite form).
const kindsGrid = (levels, attrs, disabled = false, lines = false) => lines
  ? `<div class="team-kinds-list">${TEAM_KINDS.map(([k, , line]) => `<div class="team-kind">${levelSelect(k, levels[k], attrs, disabled)}<small>${esc(line)}</small></div>`).join('')}</div>`
  : `<div class="team-kinds-grid">${TEAM_KINDS.map(([k]) => levelSelect(k, levels[k], attrs, disabled)).join('')}</div>`;
const myProjects = () => S.spaces.filter((s) => { const sh = shareOf(s.id); return !sh || sh.canManage; });

// How far ahead a clock is, in words: "3 hours", "2 days".
const teamAhead = (ms) => ms >= 2 * 86400e3 ? `${Math.round(ms / 86400e3)} days` : ms >= 2 * 3600e3 ? `${Math.round(ms / 3600e3)} hours` : `${Math.max(10, Math.round(ms / 60e3))} minutes`;
// Check codes: yours and each person's, from their keys. Two people who read each other the same
// codes know the sync service did not swap anyone's keys (lib/share.js, review M3).
function codesCard(k) {
  const rows = (k.people || []).map((p) => `<li><span class="team-code-who">${esc(p.name)} <small class="muted">${esc(p.email)}</small></span><span class="mono">${esc(p.code)}</span>
    <button class="btn btn--quiet btn--sm" type="button" data-team-checked="${esc(p.email)}" data-yes="${p.checked ? '' : '1'}" aria-pressed="${p.checked}">${p.checked ? 'Checked' : 'Mark checked'}</button></li>`).join('');
  return `<details class="team-codes"><summary>Check codes</summary>
    <p class="small">Your code is <b class="mono">${esc(k.mine)}</b>. Ask each person to read you theirs from their own Team page, by phone or in person; if it is the one below, the keys are theirs. It is optional: Switchboard already refuses keys that change.</p>
    ${rows ? `<ul class="team-code-list">${rows}</ul>` : '<p class="muted small">Nobody to check yet.</p>'}</details>`;
}
function renderTeam() {
  const el = $('team-body'); if (!el || !S) return;
  const st = S.share || {};
  if (!st.signedIn || !st.ready) {
    el.innerHTML = `<p class="pane-lead">Your team is the people you share projects with. Each has their own Switchboard and keeps their own sign-ins, sessions and private things; you choose which of your projects they are in and what they can see or edit there.</p>
      <div class="share-need"><span>${st.signedIn ? 'This computer is signed in but does not have your account key yet.' : 'A team needs a Switchboard account (free). The people you invite make theirs from the invitation.'}</span><button class="btn" type="button" data-share-account>${st.signedIn ? 'Finish signing in' : 'Set up your account'}</button></div>`;
    return;
  }
  const team = st.team || [];
  let html = `<p class="pane-lead">The people you share projects with. Invite someone once; then pick their projects, and for each kind of thing whether they can see it, edit it (or send, for sessions), or neither. Everyone's Switchboard checks every change against what you chose, and the sync service cannot read any of it. Never shared: your other projects, your sign-ins and tokens, signatures, and what is typed in your terminals.</p>`;
  html += inviteForm();
  if (teamMail) html += mailStep();
  if (teamErr) html += `<p class="bad-text small" role="alert">${esc(teamErr)}</p>`;
  for (const c of st.clockAhead || []) html += `<div class="share-need" role="status"><span>${esc(c.name)}'s computer clock is about ${esc(teamAhead(c.aheadBy))} ahead, so their changes wait here until it is right. Ask them to set its date and time to set automatically.</span></div>`;
  const k = st.keys || {};
  for (const c of k.changed || []) html += `<div class="share-need" role="alert"><span><b>${esc(c.name)}'s keys changed on the sync service.</b> Nothing new is locked to them until you check. ${c.code ? `Their new check code is <span class="mono">${esc(c.code)}</span>${c.was ? ` (it was <span class="mono">${esc(c.was)}</span>)` : ''}. ` : ''}Ask ${esc(c.name)}, by phone or in person, what their code is in Settings, Team. If it matches and they reset their account, use the new keys; if it does not, someone may be trying to read your projects.</span>${c.code ? `<button class="btn btn--sm" type="button" data-team-trust="${esc(c.email)}" data-code="${esc(c.code)}" ${teamBusy ? 'disabled' : ''}>The codes match: use the new keys</button>` : ''}</div>`;
  html += team.length ? team.map(personCard).join('') : `<p class="muted">Nobody yet. Invite someone above.</p>`;
  if (k.mine) html += codesCard(k);
  redrawKeeping(el, html);
}

// Redrawing a pane keeps what is being typed: the invite draft holds the email and name, and the
// box you were in keeps its place (Settings redraws on every refresh).
function redrawKeeping(el, html) {
  const a = document.activeElement, id = a && el.contains(a) ? a.id : null;
  const sel = id && typeof a.selectionStart === 'number' ? [a.selectionStart, a.selectionEnd] : null;
  el.innerHTML = html;
  const b = id && document.getElementById(id);
  if (b) { b.focus(); if (sel) try { b.setSelectionRange(sel[0], sel[1]); } catch {} }
}

function inviteForm(fixedSpace = null) {
  const d = teamDraft || (teamDraft = { space: fixedSpace || myProjects()[0]?.id || '', kinds: { ...TEAM_DEFAULT }, existing: 'share' });
  if (fixedSpace) d.space = fixedSpace;
  const fresh = d.space && !shareOf(d.space);
  if (fresh && teamPages[d.space] == null) api('/api/share/pages?space=' + encodeURIComponent(d.space)).then((r) => { teamPages[d.space] = r.count; renderTeam(); if (shareSpace) renderShare(); }).catch(() => {});
  const n = teamPages[d.space] || 0;
  return `<form class="team-invite" id="team-invite"><h3>Invite someone</h3>
    <div class="team-row"><label>Their email<input class="field" id="team-email" type="email" required autocomplete="off" placeholder="name@example.com" value="${esc(d.email || '')}"></label>
      <label>Name (optional)<input class="field" id="team-name" type="text" maxlength="60" autocomplete="off" placeholder="Jordan" value="${esc(d.name || '')}"></label>
      ${fixedSpace ? '' : `<label>To the project<select class="field" id="team-space">${myProjects().map((s) => `<option value="${esc(s.id)}" ${s.id === d.space ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>`}</div>
    <div class="team-kinds-top"><b>What they can do</b><button class="btn btn--sm" type="button" data-team-all-draft title="A co-founder: every kind, as much as it allows">Give everything</button></div>
    ${kindsGrid(d.kinds, 'data-draft-kind', false, true)}
    ${fresh && n ? `<div class="share-ask"><span>Share the ${n} page${n === 1 ? '' : 's'} already in ${esc(spaceOf(d.space).name)}?</span><label><input type="radio" name="team-existing" value="share" ${d.existing === 'share' ? 'checked' : ''}> Yes</label><label><input type="radio" name="team-existing" value="private" ${d.existing === 'private' ? 'checked' : ''}> No, keep them Only me</label></div>` : ''}
    <p class="muted small">They get an email from you with a link. Following it (making their Switchboard account with that email, or signing in) puts them straight in. It works once, for 14 days.</p>
    <div><button class="btn btn--primary" type="submit" ${teamBusy || !d.space ? 'disabled' : ''}>${teamBusy ? 'Inviting…' : 'Invite'}</button></div></form>`;
}

// The invite email, before it goes: who it is to, who from, what it says. Send is the one click that sends it.
function mailStep() {
  const m = teamMail;
  const froms = (S.sendAs || []).map((a) => a.address);
  return `<section class="team-mail" aria-label="The invite email"><h3>${m.sent ? 'Sent' : 'Send them the invitation'}</h3>
    ${m.sent ? `<p>The invitation went to ${esc(m.to)} from ${esc(m.from)}.</p>` : `
    <dl class="team-mail-head"><dt>To</dt><dd>${esc(m.to)}</dd><dt>From</dt><dd>${froms.length ? `<select class="field field--sm" id="team-from">${froms.map((f) => `<option ${f === m.from ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select> <span class="muted small">as "${esc(m.fromName)}"</span>` : '<span class="muted">No email account connected: use Copy link and send it your own way.</span>'}</dd><dt>Subject</dt><dd>${esc(m.subject)}</dd></dl>
    <pre class="team-mail-text">${esc(m.text)}</pre>`}
    <div class="team-mail-acts">${!m.sent && froms.length ? `<button class="btn btn--primary" type="button" data-team-send ${teamBusy ? 'disabled' : ''}>Send</button>` : ''}<button class="btn" type="button" data-team-copy>Copy link</button><button class="btn btn--quiet" type="button" data-team-done>${m.sent ? 'Done' : 'Not now'}</button></div></section>`;
}

function personCard(p) {
  const owner = Object.values(S.share.projects).some((x) => x.role === 'owner');
  const inSpaces = new Set(p.projects.map((x) => x.space));
  const addable = myProjects().filter((s) => !inSpaces.has(s.id));
  return `<section class="team-person"><div class="team-person-head"><span class="share-face">${esc(initials(p.name))}</span><span class="share-who"><b>${esc(p.name)}</b><small>${esc(p.email)}</small></span>
      ${owner && p.projects.some((x) => !x.pending) ? `<label><span class="sr">Role</span><select class="field field--sm" data-team-role="${esc(p.email)}" ${teamBusy ? 'disabled' : ''}><option value="member" ${p.role === 'member' ? 'selected' : ''}>Member</option><option value="admin" ${p.role === 'admin' ? 'selected' : ''}>Admin</option></select></label>` : `<span class="muted small">${esc(TEAM_ROLE_WORD[p.role] || p.role)}</span>`}
      ${p.projects.some((x) => x.status === 'joined') ? `<button class="btn btn--quiet btn--sm" type="button" data-team-reset="${esc(p.email)}" ${teamBusy ? 'disabled' : ''}>Reset their password</button>` : ''}
      <button class="btn btn--quiet btn--sm" type="button" data-team-remove="${esc(p.email)}" ${teamBusy ? 'disabled' : ''}>Remove from team</button></div>
    ${teamReset?.email === p.email ? `<div class="share-need" role="status"><span>Give ${esc(p.name)} this code by text, a call or in person: <b class="mono">${esc(teamReset.code)}</b>. They press Forgot password? under Sign in, then enter it with a new password. It works once, for 30 minutes. Their computers sign out. They stay in your projects with the same access: this computer locks them to the new password as soon as it is set.</span><button class="btn btn--sm" type="button" data-team-reset-copy>Copy code</button></div>` : ''}
    ${p.projects.map((x) => `<div class="team-proj"><div class="team-proj-head"><span class="dot" style="background:${safeColor(spaceOf(x.space).color)}"></span><b>${esc(spaceOf(x.space).name)}</b>${x.status !== 'joined' ? ` <small class="muted">${esc(TEAM_STATUS_WORD[x.status] || x.status)}</small>` : ''}<span class="grow"></span>
      ${!x.pending && p.role !== 'admin' ? `<button class="btn btn--sm" type="button" data-team-all="${esc(p.email)}" data-space="${esc(x.space)}" ${teamBusy ? 'disabled' : ''}>Give everything</button>` : ''}
      ${x.asked ? `<button class="btn btn--primary btn--sm" type="button" data-team-admit="${esc(x.pending)}" data-space="${esc(x.space)}" data-email="${esc(x.askedBy)}" title="They answered without the invitation's link. Let them in if ${esc(x.askedBy)} is really them." ${teamBusy ? 'disabled' : ''}>Let in</button>` : ''}
      ${x.pending ? `<button class="btn btn--quiet btn--sm" type="button" data-team-cancel="${esc(x.pending)}" data-space="${esc(x.space)}">Cancel invite</button>` : `<button class="btn btn--quiet btn--sm" type="button" data-team-out="${esc(p.email)}" data-space="${esc(x.space)}">Take off</button>`}</div>
      ${kindsGrid(x.kinds, `data-team-access="${esc(p.email)}" data-space="${esc(x.space)}"`, !!x.pending || p.role === 'admin')}</div>`).join('')}
    ${p.role === 'admin' ? '<p class="muted small">An admin sees and edits everything in their projects, and can invite and remove people.</p>' : ''}
    ${addable.length ? `<label class="team-add">Add to a project<select class="field field--sm" data-team-add="${esc(p.email)}"><option value="">Pick…</option>${addable.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select></label>` : ''}</section>`;
}

async function teamDo(path, body, done) {
  teamBusy = true; teamErr = ''; renderTeam(); if (shareSpace) renderShare();
  try { const r = await api(path, body); if (r.share) S.share = r.share; await done?.(r); }
  catch (err) { teamErr = err.message; }
  teamBusy = false; renderTeam(); if (shareSpace) renderShare(); load();
}
async function startMail(r, to) {
  const m = await api('/api/share/mail-preview', { to, link: r.link, project: r.project, kinds: teamDraft.kinds, account: r.account });
  teamMail = { ...m, link: r.link, project: r.project, kinds: { ...teamDraft.kinds }, account: r.account, sent: false };
}

document.addEventListener('submit', (e) => {
  if (e.target.id !== 'team-invite') return;
  e.preventDefault();
  const email = $('team-email').value.trim(), name = $('team-name').value.trim(), d = teamDraft;
  if ($('team-space')) d.space = $('team-space').value;
  teamDo('/api/share', { space: d.space, email, name, kinds: d.kinds, existing: d.existing }, async (r) => {
    d.email = ''; d.name = '';
    toast(r.account ? `${name || email} is invited to ${spaceOf(d.space).name}: it shows in their Switchboard now.` : `${name || email} is invited to ${spaceOf(d.space).name}. They join from the link.`);
    await startMail(r, email);
  });
});
document.addEventListener('input', (e) => {
  if (!teamDraft) return;
  if (e.target.id === 'team-email') teamDraft.email = e.target.value;
  else if (e.target.id === 'team-name') teamDraft.name = e.target.value;
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'team-space') { teamDraft.space = t.value; renderTeam(); return; }
  if (t.name === 'team-existing') { teamDraft.existing = t.value; return; }
  if (t.matches?.('[data-draft-kind]')) { teamDraft.kinds[t.dataset.kind] = t.value; return; }
  if (t.matches?.('[data-team-access]')) { teamDo('/api/share/access', { space: t.dataset.space, email: t.dataset.teamAccess, kinds: { [t.dataset.kind]: t.value } }, () => toast(`${TEAM_KINDS.find(([k]) => k === t.dataset.kind)[1]}: ${LEVEL_WORD[t.value]} in ${spaceOf(t.dataset.space).name}.`)); return; }
  if (t.matches?.('[data-team-role]')) { teamDo('/api/share/role', { email: t.dataset.teamRole, role: t.value }, () => toast(t.value === 'admin' ? 'An admin now, in the projects you shared with them.' : 'A member now.')); return; }
  if (t.matches?.('[data-team-add]') && t.value) {
    const email = t.dataset.teamAdd, space = t.value;
    teamDraft = { ...(teamDraft || {}), space, kinds: { ...TEAM_DEFAULT }, existing: 'share' };
    teamDo('/api/share', { space, email, kinds: teamDraft.kinds }, async (r) => { toast(`Added to ${spaceOf(space).name}.`); await startMail(r, email); });
  }
});
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-team-all-draft]')) { teamDraft.kinds = { ...TEAM_ALL }; renderTeam(); if (shareSpace) renderShare(); return; }
  const all = e.target.closest('[data-team-all]');
  if (all) { teamDo('/api/share/access', { space: all.dataset.space, email: all.dataset.teamAll, kinds: TEAM_ALL }, () => toast(`Everything in ${spaceOf(all.dataset.space).name}, for ${all.dataset.teamAll}.`)); return; }
  const rm = e.target.closest('[data-team-remove]');
  if (rm) { if (rm.dataset.sure) teamDo('/api/share/remove-person', { email: rm.dataset.teamRemove }, (r) => toast(`Off your team: out of ${r.projects} project${r.projects === 1 ? '' : 's'}, with new keys. They keep the copies they had.`)); else { rm.dataset.sure = '1'; rm.textContent = 'Remove from every project?'; rm.classList.add('btn--danger'); } return; }
  const rs = e.target.closest('[data-team-reset]');
  if (rs) { if (rs.dataset.sure) teamDo('/api/share/reset-code', { email: rs.dataset.teamReset }, (r) => { teamReset = { email: rs.dataset.teamReset, code: r.code }; }); else { rs.dataset.sure = '1'; rs.textContent = 'Make a reset code?'; rs.classList.add('btn--danger'); } return; }
  if (e.target.closest('[data-team-reset-copy]')) { navigator.clipboard?.writeText(teamReset?.code || '').then(() => toast('Code copied.')).catch(() => toast(teamReset?.code || '')); return; }
  const out = e.target.closest('[data-team-out]');
  if (out) { teamDo('/api/share/remove', { space: out.dataset.space, email: out.dataset.teamOut }, () => toast(`Off ${spaceOf(out.dataset.space).name}. It has new keys.`)); return; }
  const tr = e.target.closest('[data-team-trust]');
  if (tr) { teamDo('/api/share/keys-trust', { email: tr.dataset.teamTrust, code: tr.dataset.code }, () => toast('Their new keys are kept. Things are locked to them again.')); return; }
  const ck = e.target.closest('[data-team-checked]');
  if (ck) { teamDo('/api/share/keys-checked', { email: ck.dataset.teamChecked, yes: !!ck.dataset.yes }); return; }
  const ad = e.target.closest('[data-team-admit]');
  if (ad) { teamDo('/api/share/admit', { space: ad.dataset.space, id: ad.dataset.teamAdmit }, (r) => toast(`${r.email} is in ${spaceOf(ad.dataset.space).name}.`)); return; }
  const c = e.target.closest('[data-team-cancel]');
  if (c) { teamDo('/api/share/cancel-invite', { space: c.dataset.space, id: c.dataset.teamCancel }, () => toast('Invitation cancelled. The link no longer works.')); return; }
  if (e.target.closest('[data-team-send]')) {
    const m = teamMail, from = $('team-from')?.value || m.from;
    teamDo('/api/share/mail-send', { to: m.to, from, link: m.link, project: m.project, kinds: m.kinds, account: m.account }, (r) => { teamMail = { ...m, sent: true, from: r.from }; toast('Invitation sent.'); });
    return;
  }
  if (e.target.closest('[data-team-copy]')) { navigator.clipboard?.writeText(teamMail.link).then(() => toast('Link copied. It works once, for 14 days, for their email only.')).catch(() => toast(teamMail.link)); return; }
  if (e.target.closest('[data-team-done]')) { teamMail = null; renderTeam(); if (shareSpace) renderShare(); }
});

// ---- following an invite link: …#join?email=…&t=…&p=… (from the join page's
// Open in Switchboard, or pasted into Settings, Account). Kept here, used as
// soon as this account can: signing up or in with that email is joining.
let joinWant = null;
function useJoinLink(link) {
  const at = String(link || '').indexOf('#join?');
  if (at < 0) { toast('That is not an invitation link. Copy the whole link from the invite email.', { kind: 'error' }); return false; }
  const q = new URLSearchParams(String(link).slice(at + 6));
  joinWant = { email: q.get('email') || '', token: q.get('t') || '', project: q.get('p') || 'the project' };
  api('/api/share/link', { token: joinWant.token, project: joinWant.project }).then(() => load()).catch((err) => toast(err.message, { kind: 'error' }));
  return true;
}
function takeJoinLink() {
  if (!location.hash.startsWith('#join')) return;
  const link = location.hash;
  history.replaceState(null, '', '#now');
  useJoinLink(link);
  const go = () => {
    const a = S?.account;
    if (a?.signedIn && !a.locked) {
      if (a.email && joinWant.email && a.email.toLowerCase() !== joinWant.email.toLowerCase()) toast(`This invitation is for ${joinWant.email}, and this Switchboard is signed in as ${a.email}. Sign out and sign in as ${joinWant.email} to join.`, { kind: 'error' });
      else toast(`Joining ${joinWant.project}…`);
      joinWant = null;
      return;
    }
    openSettings('accounts');
  };
  if (S) go(); else setTimeout(go, 1500);
}
window.addEventListener('hashchange', takeJoinLink);
setTimeout(takeJoinLink, 0);

// On Settings, Account: the invitation you came with, and your own sync service.
function renderSyncOwn() {
  const el = $('sync-own'); if (!el || !S) return;
  const a = S.account || {};
  let html = '';
  if (joinWant && !a.signedIn) html += `<div class="share-need"><span>To join ${esc(joinWant.project)}, make your Switchboard account (or sign in) with <b>${esc(joinWant.email)}</b>. You are in as soon as you are signed in.</span></div>`;
  // On the web board: your own Microsoft 365 and GitHub, connected in this browser (public/js/web/connect.js).
  if (S.web && a.signedIn && S.webConnect) {
    const c = S.webConnect, row = (id, name, x, what) => `<div class="web-conn"><span class="share-who"><b>${name}</b><small>${x.connected ? esc(x.email || x.login || 'Connected') + (x.error ? ' · ' + esc(x.error) : '') : esc(what)}</small></span>${x.connected ? `<button class="btn btn--quiet btn--sm" type="button" data-web-conn="${id}" data-off="1">Disconnect</button>` : `<button class="btn btn--sm" type="button" data-web-conn="${id}">Connect</button>`}</div>`;
    html += `<section class="web-conns"><h3>Your connections, here</h3>${c.notice?.error ? `<p class="bad-text small">${esc(c.notice.error)}</p>` : c.notice?.connected ? `<p class="small">${esc(c.notice.connected)} is connected.</p>` : ''}
      ${row('microsoft', 'Microsoft 365', c.microsoft, 'Teams chats and Outlook mail in Inbox. You sign in on Microsoft\'s page.')}
      ${row('github', 'GitHub', c.github, 'Your builds, and the pull requests waiting on you.')}
      ${c.google ? row('google', 'Google', c.google, 'Gmail in Inbox, with replies on your click, and your Google calendars on Calendar. You sign in on Google\'s page.') : ''}
      <p class="muted small">They are yours: kept sealed in your own account, never shared unless you share a project's conversations. Mail by app password (iCloud, Fastmail and others) works only in Switchboard on a computer: a browser cannot reach a mail server directly.</p></section>`;
  }
  if (!joinWant) html += `<form class="form-row invite-paste" id="invite-paste"><label for="invite-paste-url">Have an invite? Paste the link</label><input class="field" id="invite-paste-url" type="url" autocomplete="off" placeholder="https://…/join#join?…"><button class="btn" type="submit">Use it</button></form>`;
  html += `<details class="sync-own"${a.ownServer ? ' open' : ''}><summary>Sync service: ${esc(a.ownServer ? a.server : 'Switchboard\'s')}</summary>
    <p class="muted small">Your account and everything it syncs live on one sync service. You can run your own (it is in Switchboard's sync-worker folder, for your own Cloudflare account and domain) and use it here, before signing in.</p>
    <form class="form-row" id="sync-own-form"><label class="sr" for="sync-own-url">Sync service address</label><input class="field" id="sync-own-url" type="url" placeholder="https://sync.example.com" value="${esc(a.ownServer ? a.server : '')}" ${a.signedIn ? 'disabled' : ''}>
    <button class="btn" type="submit" ${a.signedIn ? 'disabled' : ''}>Use it</button>${a.ownServer && !a.signedIn ? '<button class="btn btn--quiet" type="button" data-sync-own-reset>Use Switchboard\'s</button>' : ''}</form>
    ${a.signedIn ? '<p class="muted small">Sign out first to change it: an account lives on one sync service.</p>' : ''}</details>`;
  el.innerHTML = html;
  if (joinWant && $('acct-email') && !$('acct-email').value) {
    $('acct-email').value = joinWant.email;
    if ($('acct-form')?.hidden) $('acct-email-toggle')?.click();
  }
}
document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-web-conn]');
  if (!c) return;
  c.disabled = true;
  api('/api/web/connect', { service: c.dataset.webConn, disconnect: !!c.dataset.off }).then(() => { if (c.dataset.off) { toast('Disconnected.'); return load().then(renderSyncOwn); } return null; })
    .catch((err) => { c.disabled = false; toast(err.message, { kind: 'error' }); });
});
document.addEventListener('submit', (e) => {
  if (e.target.id !== 'invite-paste') return;
  e.preventDefault();
  if (useJoinLink($('invite-paste-url').value.trim())) { toast(S?.account?.signedIn ? `Joining ${joinWant.project}…` : 'Now make your account (or sign in) with the email the invitation was sent to.'); renderSyncOwn(); }
});
document.addEventListener('submit', (e) => {
  if (e.target.id !== 'sync-own-form') return;
  e.preventDefault();
  api('/api/sync-server', { url: $('sync-own-url').value.trim() }).then((r) => { toast(`This computer uses ${r.server} now.`); return load(); }).then(renderSyncOwn).catch((err) => toast(err.message, { kind: 'error' }));
});
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-sync-own-reset]')) api('/api/sync-server', { url: '' }).then(() => { toast('This computer uses Switchboard\'s sync service again.'); return load(); }).then(renderSyncOwn).catch((err) => toast(err.message, { kind: 'error' }));
});
