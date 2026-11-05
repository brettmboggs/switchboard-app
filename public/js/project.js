// A project's own page (#project/<id>): a client, a business, a part of life.
// Its work in flight, its conversations, sessions, notes and files on the
// left; who it is for, how to reach them and its links (the site, its admin,
// the repo) on the right. Projects on the rail open this page; filtering a
// list by project is the picker in each page's head (projectPicker in core.js).
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
let openProject = null;                      // the project id on #project/<id>
let projFiles = { id: null, list: [], found: [], at: 0 };   // its files, and the people found in its mail
let projEdit = false;                        // the profile card is a form
let projDraft = null;                        // { id, profile }: what is typed in that form, unsaved
const fmtSize = (n) => n < 1024 ? n + ' B' : n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
const profileOf = (id) => ({ about: '', people: [], links: [], hidden: [], ...(S.profiles?.[id] || {}) });

function loadProjFiles(id, force = false) {
  if (!force && projFiles.id === id && Date.now() - projFiles.at < 30e3) return;
  projFiles = { ...projFiles, id, at: Date.now() };
  api('/api/projects/' + encodeURIComponent(id)).then((r) => { projFiles = { id, list: r.files, found: r.found || [], at: Date.now() }; if (page === 'project' && openProject === id) renderProject(); }).catch(() => {});
}

function renderProject() {
  const id = openProject, sp = S.spaces.find((s) => s.id === id);
  if (!sp) { $('page').innerHTML = `<div class="page-head"><h1>Project</h1></div><section class="card">${empty('That project is gone. Projects are made and named in Settings, Projects.')}</section>`; return; }
  loadProjFiles(id);
  const mine = (x) => inSpace(x, id);
  const cards = flight().filter(mine).sort((a, b) => ((a.st === 'needs') ? 0 : 1) - ((b.st === 'needs') ? 0 : 1) || b.at - a.at);
  const threads = [...S.threads.filter(mine), ...S.email.filter(mine), ...S.recent.filter(mine)].filter((t, i, a) => a.findIndex((x) => x.key === t.key) === i).sort((a, b) => b.date - a.date).slice(0, 12);
  const terms = allTerms().filter(mine);
  const notes = (S.pages || []).filter(mine).sort((a, b) => b.updated_at - a.updated_at).slice(0, 8);
  const n = cards.filter((c) => c.st === 'needs').length;
  const section = (title, body, extra = '') => `<section class="card"><div class="group-head"><h2>${title}</h2>${extra}</div>${body}</section>`;
  let left = membersCard(id) + section('In flight', cards.length ? nowRows(cards, { showProject: false }) : empty('Nothing in flight for this project.'), n ? `<span class="sum proj-needs">${n} need${n === 1 ? 's' : ''} you</span>` : '');
  left += section('Conversations', threads.length ? `<div class="list">${threads.map((t) => `<button class="item ${t.unread ? 'bold' : ''}" type="button" data-proj-thread="${esc(t.key)}"><span class="tag" style="background:${safeColor(sp.color)}"></span>
      <span><span class="t">${esc(t.who || t.from_name || t.from || '')}</span><br><span class="s">${esc(t.subject || t.snippet || '')}</span></span><span class="r"><span class="mono muted">${ago(t.date)}</span></span></button>`).join('')}</div>`
    : empty('Mail and chats sorted into this project show here. Sorting is set in Settings, Projects (rules such as an address or a domain).'));
  left += section('Sessions', terms.length ? `<div class="list">${terms.map((t) => `<button class="item" type="button" data-proj-term="${esc(t.key)}"><span class="tag" style="background:${safeColor(sp.color)}"></span>
      <span><span class="t">${esc(termLabel(t))}</span><br><span class="s mono">${esc((t.cwd || '').replace(/^\/home\/[^/]+|^\/Users\/[^/]+|^[A-Za-z]:\\Users\\[^\\]+/, '~'))}</span></span><span class="r">${esc(TERM_STATE[t.state] || t.state)}</span></button>`).join('')}</div>`
    : empty('No agent sessions in this project\'s folders right now.'));
  left += section('Notes', notes.length ? `<div class="list">${notes.map((p) => `<button class="item" type="button" data-proj-page="${esc(p.uid)}"><span class="tag" style="background:${safeColor(sp.color)}"></span><span><span class="t">${esc(p.title || 'Untitled')}</span></span><span class="r"><span class="mono muted">${ago(p.updated_at)}</span></span></button>`).join('')}</div>`
    : empty('No pages yet.'), `<button class="btn btn--ghost" type="button" data-proj-newpage>New page</button>`);
  left += costsCard(id);
  const files = projFiles.id === id ? projFiles.list : [];
  left += `<section class="card proj-drop" id="proj-drop" data-drop-project="${esc(id)}"><div class="group-head"><h2>Files</h2><label class="btn btn--ghost">Add files<input type="file" multiple hidden id="proj-file-input"></label></div>
    ${files.length ? `<div class="list">${files.map((f) => `<div class="item file-row"><a class="t" href="/api/projects/${encodeURIComponent(id)}/files/${encodeURIComponent(f.name)}" download>${esc(f.name)}</a><span class="mono muted">${fmtSize(f.size)} · ${ago(f.at)}</span><button class="btn btn--quiet" type="button" data-proj-rmfile="${esc(f.name)}" aria-label="Remove ${esc(f.name)}">Remove</button></div>`).join('')}</div>` : ''}
    <p class="drop-hint muted">Drop files here: briefs, contracts, logos, photos. Any kind of file, up to 1 GB each. They stay on this computer, in Switchboard's data folder.</p></section>`;

  const head = `<span class="dot proj-dot" style="background:${safeColor(sp.color)}"></span><h1>${esc(sp.name)}</h1><span class="muted">${esc(sp.group || '')}</span><span class="grow"></span><button class="btn btn--ghost" type="button" data-proj-settings>Project settings</button>`;
  // The board redraws whenever anything changes (mail, a session, the file
  // list). Once this project's page is up, only the parts that changed are
  // redrawn, and the About form is never touched while it is open, so what is
  // being typed stays until Save or Cancel.
  const grid = document.querySelector(`#page .proj-grid[data-proj="${CSS.escape(id)}"]`);
  if (!grid) {
    $('page').innerHTML = `<div class="page-head proj-head">${head}</div><div class="proj-grid" data-proj="${esc(id)}"><div class="proj-work">${left}</div><aside class="proj-side">${profileCard(id)}</aside></div>`;
    return;
  }
  const put = (el, html) => { if (el && el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; } };
  put(document.querySelector('#page .proj-head'), head);
  put(grid.querySelector('.proj-work'), left);
  if (!(projEdit && $('proj-profile-form'))) put(grid.querySelector('.proj-side'), profileCard(id));
}

// Who it is for, how to reach them, and where its things live. Read as text;
// Edit turns the same card into a form.
function profileCard(id) {
  const p = projEdit && projDraft?.id === id ? projDraft.profile : profileOf(id);
  if (projEdit) {
    const person = (x = {}) => `<div class="pf-person"><input class="field" data-pf="name" placeholder="Name" value="${esc(x.name || '')}"><input class="field" data-pf="role" placeholder="Role (owner, office, billing)" value="${esc(x.role || '')}"><input class="field" data-pf="email" type="email" placeholder="Email" value="${esc(x.email || '')}"><input class="field" data-pf="phone" type="tel" placeholder="Phone" value="${esc(x.phone || '')}"></div>`;
    const link = (x = {}) => `<div class="pf-link"><input class="field" data-pf="label" placeholder="What it is (Website, Admin, Repo, Hosting)" value="${esc(x.label || '')}"><input class="field" data-pf="url" placeholder="https://" value="${esc(x.url || '')}"></div>`;
    return `<form class="card proj-profile" id="proj-profile-form">
      <div class="group-head"><h2>About</h2></div><textarea class="field" id="pf-about" rows="4" placeholder="What you do for them, how they like to work, anything to remember">${esc(p.about)}</textarea>
      <div class="group-head"><h2>People</h2><button class="btn btn--ghost" type="button" data-pf-add="person">Add</button></div><div id="pf-people" class="pf-list">${(p.people.length ? p.people : [{}]).map(person).join('')}</div>
      <div class="group-head"><h2>Links</h2><button class="btn btn--ghost" type="button" data-pf-add="link">Add</button></div><div id="pf-links" class="pf-list">${(p.links.length ? p.links : [{}]).map(link).join('')}</div>
      <div class="form-row"><button class="btn btn--primary" type="submit">Save</button><button class="btn" type="button" data-pf-cancel>Cancel</button></div></form>`;
  }
  const people = p.people.map((x) => `<div class="pf-show"><b>${esc(x.name || x.email)}</b>${x.role ? ` <span class="muted">${esc(x.role)}</span>` : ''}
      ${x.email ? `<a href="mailto:${esc(x.email)}">${esc(x.email)}</a>` : ''}${x.phone ? `<a href="tel:${esc(x.phone.replace(/[^\d+]/g, ''))}">${esc(x.phone)}</a>` : ''}</div>`).join('');
  const links = p.links.map((x) => `<a class="pf-linkout" href="${safeHref(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.label || x.url.replace(/^https?:\/\//, '').replace(/\/$/, ''))}<span class="muted mono">${esc(x.url.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</span></a>`).join('');
  const found = projFiles.id === id ? projFiles.found || [] : [];
  const foundRows = found.map((f) => `<div class="pf-found"><span class="pf-found-who"><b>${esc(f.name || f.email)}</b><span class="muted">${f.name ? esc(f.email) + ' · ' : ''}${f.count} message${f.count === 1 ? '' : 's'} · ${ago(f.last)}</span></span>
      <button class="btn btn--ghost" type="button" data-pf-take="${esc(f.email)}">Add</button><button class="btn btn--quiet" type="button" data-pf-hide="${esc(f.email)}" aria-label="Hide ${esc(f.name || f.email)}">Hide</button></div>`).join('');
  const emptyAll = !p.about && !p.people.length && !p.links.length && !found.length;
  return `<section class="card proj-profile"><div class="group-head"><h2>About</h2><button class="btn btn--ghost" type="button" data-pf-edit>Edit</button></div>
    ${emptyAll ? `<p class="empty">Add who this is for, how to reach them, and links to the site, its admin and anything else you open for them.</p>` : ''}
    ${p.about ? `<p class="pf-about">${esc(p.about)}</p>` : ''}
    ${people ? `<h3 class="section-label">People</h3>${people}` : ''}
    ${links ? `<h3 class="section-label">Links</h3><div class="pf-links">${links}</div>` : ''}
    ${foundRows ? `<h3 class="section-label">Found in your mail</h3><p class="pf-found-lead muted">People you have written to in this project. Add saves them to People.</p>${foundRows}` : ''}</section>`;
}

function readProfileForm() {
  const rows = (host, keys) => [...$(host).children].map((r) => Object.fromEntries(keys.map((k) => [k, r.querySelector(`[data-pf="${k}"]`).value.trim()])));
  return { ...profileOf(openProject), about: $('pf-about').value, people: rows('pf-people', ['name', 'role', 'email', 'phone']), links: rows('pf-links', ['label', 'url']) };
}

async function uploadProjFiles(id, files) {
  for (const f of files) {
    if (f.size > 1024 ** 3) { toast(`${f.name} is over 1 GB. Share a link to it instead.`, { kind: 'error' }); continue; }
    try {
      const res = await fetch('/api/projects/' + encodeURIComponent(id) + '/files', { method: 'POST', headers: { 'X-Switchboard': '1', 'X-Filename': encodeURIComponent(f.name), 'Content-Type': 'application/octet-stream' }, body: f });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || res.statusText);
      projFiles = { ...projFiles, id, list: j.files, at: Date.now() };
    } catch (err) { toast(err.message, { kind: 'error' }); }
  }
  toast(files.length === 1 ? 'File added.' : 'Files added.');
  renderProject();
}

document.addEventListener('click', (e) => {
  if (page !== 'project') return;
  const id = openProject;
  if (e.target.closest('[data-pf-edit]')) { projEdit = true; projDraft = null; forceSide(); renderProject(); $('pf-about')?.focus(); return; }
  if (e.target.closest('[data-pf-cancel]')) { projEdit = false; projDraft = null; forceSide(); renderProject(); return; }
  const add = e.target.closest('[data-pf-add]');
  if (add) {
    const host = $(add.dataset.pfAdd === 'person' ? 'pf-people' : 'pf-links');
    const proto = host.firstElementChild.cloneNode(true);
    for (const i of proto.querySelectorAll('input')) i.value = '';
    host.appendChild(proto); proto.querySelector('input').focus(); return;
  }
  const take = e.target.closest('[data-pf-take], [data-pf-hide]');
  if (take) {
    const p = profileOf(id), addr = take.dataset.pfTake || take.dataset.pfHide, f = (projFiles.found || []).find((x) => x.email === addr);
    const next = take.dataset.pfTake ? { ...p, people: [...p.people, { name: f?.name || '', role: '', email: addr, phone: '' }] } : { ...p, hidden: [...(p.hidden || []), addr] };
    take.disabled = true;
    api(`/api/projects/${encodeURIComponent(id)}/profile`, next).then((r) => { S.profiles = { ...(S.profiles || {}), [id]: r.profile }; projFiles = { ...projFiles, found: r.found || [] }; renderProject(); toast(take.dataset.pfTake ? 'Added to People.' : 'Hidden.'); })
      .catch((err) => { take.disabled = false; toast(err.message, { kind: 'error' }); });
    return;
  }
  const th = e.target.closest('[data-proj-thread]');
  if (th) { const t = [...S.threads, ...S.email, ...S.recent].find((x) => x.key === th.dataset.projThread); inboxTab = S.email.some((x) => x.key === th.dataset.projThread) ? 'personal' : 'business'; inboxSource = 'all'; project = id; store.set('space', project); keepSel = { type: 'thread', key: th.dataset.projThread }; if (t) location.hash = '#inbox'; return; }
  const tm = e.target.closest('[data-proj-term]');
  if (tm) { currentTerm = tm.dataset.projTerm; store.set('term', currentTerm); location.hash = '#sessions'; return; }
  const pg = e.target.closest('[data-proj-page]');
  if (pg) { openPage(pg.dataset.projPage); return; }
  if (e.target.closest('[data-proj-newpage]')) { api('/api/pages', { title: '', body: '', space: id }).then(async (p) => { await load(); openPage(p.uid); }).catch((err) => toast(err.message, { kind: 'error' })); return; }
  if (e.target.closest('[data-proj-settings]')) { openSettings('projects'); return; }
  const rm = e.target.closest('[data-proj-rmfile]');
  if (rm) {
    // Removing asks once, in place: the button becomes "Remove for good".
    if (rm.dataset.armed !== '1') { rm.dataset.armed = '1'; rm.textContent = 'Remove for good'; rm.classList.add('bad-text'); return; }
    api(`/api/projects/${encodeURIComponent(id)}/files/${encodeURIComponent(rm.dataset.projRmfile)}/delete`, {}).then((r) => { projFiles = { ...projFiles, id, list: r.files, at: Date.now() }; renderProject(); toast('Removed.'); }).catch((err) => toast(err.message, { kind: 'error' }));
  }
});
document.addEventListener('submit', (e) => {
  if (e.target.id !== 'proj-profile-form') return;
  e.preventDefault();
  const id = openProject;
  api(`/api/projects/${encodeURIComponent(id)}/profile`, readProfileForm()).then((r) => { S.profiles = { ...(S.profiles || {}), [id]: r.profile }; if (r.found) projFiles = { ...projFiles, found: r.found }; projEdit = false; projDraft = null; forceSide(); renderProject(); toast('Saved.'); }).catch((err) => toast(err.message, { kind: 'error' }));
});
// The open form's side card is redrawn only on Edit, Save and Cancel.
function forceSide() { const el = document.querySelector('#page .proj-side'); if (el) { el.innerHTML = ''; el.dataset.html = ''; } }
document.addEventListener('input', (e) => {
  if (page === 'project' && projEdit && e.target.closest('#proj-profile-form')) projDraft = { id: openProject, profile: readProfileForm() };
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'proj-file-input' && e.target.files.length) uploadProjFiles(openProject, [...e.target.files]);
});
// Dropping files anywhere on a project's page adds them to its Files.
for (const ev of ['dragenter', 'dragover']) document.addEventListener(ev, (e) => {
  if (page !== 'project' || !e.dataTransfer?.types?.includes('Files')) return;
  e.preventDefault(); $('proj-drop')?.classList.add('over');
});
document.addEventListener('dragleave', (e) => { if (page === 'project' && !e.relatedTarget) $('proj-drop')?.classList.remove('over'); });
document.addEventListener('drop', (e) => {
  if (page !== 'project' || !e.dataTransfer?.files?.length) return;
  e.preventDefault(); $('proj-drop')?.classList.remove('over');
  uploadProjFiles(openProject, [...e.dataTransfer.files]);
});
