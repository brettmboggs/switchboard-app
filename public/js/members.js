// A project's "In this project" card (#project/<id>) and its Add picker:
// repos and folders, people, addresses and chats, pages and sections of pages.
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
// The list and the picker come from the server (lib/sorting.js): filing
// something with no project yet writes a rule (its main project); anything else
// also belongs (lib/belongs.js). Take out undoes either.
let members = { id: null, list: [], at: 0 }, addHits = [], addSel = 0;
function loadMembers(id, force) {
  if (!force && members.id === id && Date.now() - members.at < 30e3) return;
  members = { ...members, id, at: Date.now() };
  api('/api/projects/' + encodeURIComponent(id) + '/members').then((list) => { members = { id, list, at: Date.now() }; if (page === 'project' && openProject === id) renderProject(); }).catch(() => {});
}
const MEMBER_ICON = { repo: '▣', folder: '▢', person: '@', domain: '@', chat: 'T', word: 'Aa', page: '¶', section: '§' };
const memberIcon = (m) => m.kind === 'person' && m.label && !m.label.includes('@') ? m.label.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() : (MEMBER_ICON[m.kind] || '·');
function memberTile(m, repos) {
  const note = m.kind === 'page' || m.kind === 'section';
  const tie = note && repos.length ? `<label class="mb-tie"><span class="sr">Shows beside</span><select class="field field--sm" data-mb-tie="${esc(m.key)}"><option value="">Shows in every session</option>${repos.map((r) => `<option value="${esc(r)}" ${m.repo === r ? 'selected' : ''}>Only in ${esc(r)}</option>`).join('')}</select></label>` : '';
  // A page whose own project this is moves to Personal; a person on the About card comes off it.
  const what = m.from === 'page' ? 'Move to Personal' : m.from === 'card' ? 'Take off this card (it stays in Notes)' : m.from === 'about' ? 'Take off the About card' : 'Take out of this project';
  const out = m.own && !m.from ? '' : `<button class="mb-out" type="button" data-mb-out="${esc(m.key)}" ${m.rule != null && !m.own ? `data-mb-rule="${esc(m.rule)}"` : ''} aria-label="${what}: ${esc(m.label)}" title="${what}">×</button>`;
  return `<div class="mb-tile"><span class="mb-ico">${esc(memberIcon(m))}</span><span class="mb-text"><b>${esc(m.label)}</b>${m.line ? `<small>${esc(m.line)}</small>` : ''}${tie}</span>${out}</div>`;
}
function membersCard(id) {
  loadMembers(id);
  const list = members.id === id ? members.list : [];
  const groups = [['Repos and folders', ['repo', 'folder']], ['People and mail', ['person', 'domain', 'chat', 'word']], ['Notes', ['page', 'section']]];
  const repos = list.filter((m) => m.kind === 'repo').map((m) => m.label);
  const cols = groups.map(([title, kinds]) => {
    const mine = list.filter((m) => kinds.includes(m.kind));
    return `<div class="mb-group"><h3>${title}<span>${mine.length || ''}</span></h3>${mine.map((m) => memberTile(m, repos)).join('')}<button class="mb-add" type="button" data-mb-add="${esc(kinds[0])}">+ Add ${title === 'Notes' ? 'a page or a section' : title === 'People and mail' ? 'a person, address or chat' : 'a repo or folder'}</button></div>`;
  }).join('');
  return `<section class="card mb-card"><div class="group-head"><h2>In this project <span class="count">${list.length || ''}</span></h2><span class="grow"></span><a class="btn btn--quiet btn--sm" href="#unsorted">Unsorted${S.unsorted ? ' · ' + Number(S.unsorted) : ''}</a><button class="btn btn--sm" type="button" data-mb-add="">+ Add to this project</button></div>
    ${list.length ? '' : `<p class="muted mb-lead">Everything this project is about, in one place: its repos, the people and chats about it, and the notes for it. Sessions, Inbox and Notes use this to know what goes where.</p>`}
    <div class="mb-groups">${cols}</div></section>`;
}
const MEMBER_KIND = { repo: 'Repo', folder: 'Folder', person: 'Person', domain: 'Address', chat: 'Chat', page: 'Page', section: 'Section' };
function drawAddHits() {
  const host = $('mb-hits'); if (!host) return;
  host.innerHTML = addHits.map((h, i) => `<li><button type="button" class="cmd-hit ${i === addSel ? 'sel' : ''}" data-mb-hit="${i}"><span></span><span class="k">${esc(MEMBER_KIND[h.kind] || '')}</span><span class="t">${esc(h.label)}${h.line ? `<span class="muted"> · ${esc(h.line)}</span>` : ''}</span></button></li>`).join('');
  host.hidden = !addHits.length;
  $('mb-hint').textContent = addHits.length ? 'Enter adds it · ↑↓ to choose · Esc closes' : '';
}
let addTimer = 0;
function searchAddable() {
  const id = openProject, q = $('mb-q')?.value || '';
  clearTimeout(addTimer);
  addTimer = setTimeout(() => api(`/api/projects/${encodeURIComponent(id)}/addable?q=${encodeURIComponent(q)}`).then((hits) => { addHits = hits; addSel = 0; drawAddHits(); }).catch(() => {}), 120);
}
function openAdd() {
  addHits = []; $('mb-q').value = ''; $('mb-title').textContent = 'Add to ' + spaceOf(openProject).name; drawAddHits();
  openDialog('mb-scrim'); $('mb-q').focus(); searchAddable();
}
const closeAdd = () => closeDialog('mb-scrim');
async function addMember(h) {
  const id = openProject;
  try {
    const r = await api(`/api/projects/${encodeURIComponent(id)}/file`, { key: h.key, label: h.label });
    toast(r.main ? `${h.label} is in ${spaceOf(id).name} now${r.movedFrom ? `, no longer in ${r.movedFrom}` : ''}.` : `${h.label} also belongs to ${spaceOf(id).name} now.`);
    closeAdd(); loadMembers(id, true); load();
  } catch (err) { toast(err.message, { kind: 'error' }); }
}
document.addEventListener('click', (e) => {
  const h = e.target.closest('[data-mb-hit]');
  if (h) { const hit = addHits[Number(h.dataset.mbHit)]; if (hit) addMember(hit); return; }
  if (page !== 'project') return;
  if (e.target.closest('[data-mb-add]')) { openAdd(); return; }
  const o = e.target.closest('[data-mb-out]');
  if (o) {
    const id = openProject, m = members.list.find((x) => x.key === o.dataset.mbOut);
    api(`/api/projects/${encodeURIComponent(id)}/takeout`, { key: o.dataset.mbOut, rule: o.dataset.mbRule ?? null })
      .then((r) => {
        const undo = r.restore ? { action: { label: 'Undo', run: () => api(`/api/projects/${encodeURIComponent(id)}/putback`, { restore: r.restore }).then(() => { loadMembers(id, true); load(); }).catch((err) => toast(err.message, { kind: 'error' })) } } : {};
        toast(r.sharedBy ? `${m?.label || 'The page'} is off your card. ${r.sharedBy} shared it, so it stays in ${spaceOf(id).name} for everyone.` : r.restore?.onCard ? `${m?.label || 'The page'} is off this card. It is still in Notes.` : r.restore?.page ? `${m?.label || 'The page'} is in Personal now${r.unshared ? `, and no longer shared with the ${r.unshared === 1 ? 'other person' : `${r.unshared} others`}` : ''}.` : r.restore?.people ? `${m?.label || 'They'} came off ${spaceOf(id).name}'s About card.` : `${m?.label || 'It'} is out of ${spaceOf(id).name}.`, undo);
        loadMembers(id, true); load();
      }).catch((err) => toast(err.message, { kind: 'error' }));
  }
});
document.addEventListener('change', (e) => {
  const t = e.target.closest?.('[data-mb-tie]');
  if (!t) return;
  const id = openProject, m = members.list.find((x) => x.key === t.dataset.mbTie);
  api(`/api/projects/${encodeURIComponent(id)}/file`, { key: t.dataset.mbTie, label: m?.label, repo: t.value || null })
    .then(() => { toast(t.value ? `Shows beside ${t.value} sessions.` : 'Shows beside every session in this project.'); loadMembers(id, true); load(); }).catch((err) => toast(err.message, { kind: 'error' }));
});
document.addEventListener('input', (e) => { if (e.target.id === 'mb-q') searchAddable(); });
document.addEventListener('keydown', (e) => {
  if (e.target.id !== 'mb-q') return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeAdd(); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!addHits.length) return; addSel = (addSel + (e.key === 'ArrowDown' ? 1 : addHits.length - 1)) % addHits.length; drawAddHits(); return; }
  if (e.key === 'Enter') { e.preventDefault(); const hit = addHits[addSel]; if (hit) addMember(hit); }
});
