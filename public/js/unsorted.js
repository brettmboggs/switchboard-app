// Unsorted (#unsorted): what Switchboard found that has no project yet (repos
// and folders, people, Teams chats), each with its likely project to file it
// in one click, Other… for any project, and Hide to take it out of every list
// (lib/hidden.js; nothing is deleted from the computer). Folders that are not
// repos can all be hidden at once.
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
let unsortedList = null, unsortedAt = 0, unsortedKind = 'all', hiddenList = null, showHidden = false;
function loadUnsorted(force) {
  if (!force && unsortedList && Date.now() - unsortedAt < 30e3) return;
  unsortedAt = Date.now();
  Promise.all([api('/api/unsorted'), api('/api/hidden')]).then(([list, hidden]) => {
    unsortedList = list; hiddenList = hidden;
    // The list just fetched is the true count: the rail's number follows it.
    if (S && S.unsorted !== list.length) { S.unsorted = list.length; renderShell(); }
    if (page === 'unsorted') renderUnsorted();
  }).catch(() => {});
}
const US_KINDS = [['all', 'All'], ['repo', 'Repos'], ['folder', 'Folders'], ['person', 'People'], ['chat', 'Chats']];
// The projects offered on a row: its likely one first, then the two used most.
function usTargets(x) {
  const used = {};
  for (const t of allTerms()) used[t.space] = (used[t.space] || 0) + 1;
  for (const t of S.threads || []) used[t.space] = (used[t.space] || 0) + 1;
  const ids = S.spaces.map((s) => s.id).sort((a, b) => (used[b] || 0) - (used[a] || 0));
  const pick = [...new Set([x.suggest, ...ids].filter(Boolean))].slice(0, x.suggest ? 2 : 2);
  return pick.map((id) => `<button class="us-target${id === x.suggest ? ' sug' : ''}" type="button" data-us-file="${esc(x.key)}" data-us-to="${esc(id)}"><span class="dot" style="background:${safeColor(spaceOf(id).color)}"></span>${esc(spaceOf(id).name)}</button>`).join('')
    + `<label class="us-other"><span class="sr">Other project</span><select class="field field--sm" data-us-other="${esc(x.key)}"><option value="">Other…</option>${S.spaces.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select></label>`;
}
// A hidden thing's name. Only its key is kept (lib/hidden.js), so the name comes
// from what was on the list when it was hidden, or is worked out from the key.
const usHiddenNames = {};
function usHiddenLabel(k) {
  if (usHiddenNames[k]) return usHiddenNames[k];
  const kind = k.split(':')[0], rest = k.slice(k.indexOf(':') + 1);
  if (kind === 'folder' || kind === 'repo') return rest.split(/[\\/]/).filter(Boolean).pop() || rest;
  if (kind === 'domain') return 'Everyone at ' + rest;
  if (kind === 'chat') {
    const th = (S.threads || []).find((t) => t.key === rest);
    if (th?.who) return `${th.kind === 'teams' ? 'Teams chat' : 'Chat'} with ${th.who}`;
    return rest.startsWith('teams:') ? 'A Teams chat' : 'A chat';
  }
  return rest;
}
function renderUnsorted() {
  loadUnsorted();
  const list = unsortedList || [];
  const n = (k) => k === 'all' ? list.length : list.filter((x) => x.kind === k).length;
  const shown = list.filter((x) => unsortedKind === 'all' || x.kind === unsortedKind);
  const plain = list.filter((x) => x.notRepo);
  let html = `<div class="page-head"><h1>Unsorted</h1><span class="grow"></span></div>
    <p class="muted us-lead">Things Switchboard found that are not in a project yet. Put each where it belongs, or hide it from Switchboard. Projects are made in Settings, Projects.</p>
    <div class="chips us-kinds">${US_KINDS.filter(([k]) => k === 'all' || n(k)).map(([k, name]) => `<button class="chip" type="button" data-us-kind="${k}" aria-pressed="${unsortedKind === k}">${name} <span class="c">${n(k)}</span></button>`).join('')}</div>`;
  if (plain.length > 1 && (unsortedKind === 'all' || unsortedKind === 'folder')) html += `<div class="us-tip"><span>${plain.length} folders in your code folders are not projects you code in (downloads, films, old copies). They crowd the folder list when you start a session.</span><button class="btn btn--sm" type="button" data-us-hide-plain>Hide all ${plain.length}</button></div>`;
  html += `<section class="card us-card">${unsortedList === null ? empty('Looking…') : shown.length ? shown.map((x) => `<div class="us-row"><span class="mb-ico">${esc(memberIcon(x))}</span><span class="mb-text"><b>${esc(x.label)}</b><small>${esc(x.line || '')}</small></span><span class="us-targets">${usTargets(x)}</span><button class="btn btn--quiet btn--sm" type="button" data-us-hide="${esc(x.hideKey || x.key)}" title="Hide from every list in Switchboard; nothing is deleted">Hide</button></div>`).join('')
    : empty(list.length ? 'Nothing of this kind left to sort.' : 'Everything is in a project. New repos, people and chats show here as they turn up.')}</section>`;
  const hid = hiddenList || [];
  if (hid.length) html += `<p class="muted us-hidden">Hidden from Switchboard: ${hid.length} · <button class="btn btn--ghost" type="button" data-us-show-hidden>${showHidden ? 'Hide the list' : 'Show them'}</button> · hidden things never show in lists or the folder picker; nothing is deleted from your computer.</p>`
    + (showHidden ? `<section class="card us-card">${hid.map((k) => `<div class="us-row" title="${esc(k)}"><span class="mb-ico">${esc(MEMBER_ICON[k.split(':')[0]] || '·')}</span><span class="mb-text"><b>${esc(usHiddenLabel(k))}</b><small>${esc(MEMBER_KIND[k.split(':')[0]] || '')}</small></span><span></span><button class="btn btn--quiet btn--sm" type="button" data-us-unhide="${esc(k)}">Bring back</button></div>`).join('')}</section>` : '');
  // The board redraws on every change; only touch the page when this changed, so an open Other… stays open.
  const pg = $('page');
  if (pg.dataset.us !== html || !pg.querySelector('.us-lead')) { pg.innerHTML = html; pg.dataset.us = html; }
}
async function usFile(key, to) {
  const x = (unsortedList || []).find((u) => u.key === key);
  try {
    const r = await api(`/api/projects/${encodeURIComponent(to)}/file`, { key, label: x?.label });
    unsortedList = (unsortedList || []).filter((u) => u.key !== key);
    toast(`${x?.label || 'It'} is in ${spaceOf(to).name}${r.main ? '' : ' too'}.`, { action: { label: 'Undo', run: () => api(`/api/projects/${encodeURIComponent(to)}/takeout`, { key, rule: r.main ? x?.rule : null }).then(() => { loadUnsorted(true); load(); }) } });
    renderUnsorted(); load();
  } catch (err) { toast(err.message, { kind: 'error' }); }
}
async function usHide(keys, label) {
  try {
    await api('/api/hidden', { keys, hidden: true });
    for (const u of unsortedList || []) if (keys.includes(u.hideKey || u.key) && u.label) usHiddenNames[u.hideKey || u.key] = u.label;
    unsortedList = (unsortedList || []).filter((u) => !keys.includes(u.hideKey || u.key));
    hiddenList = [...new Set([...(hiddenList || []), ...keys])];
    toast(`${label} hidden from Switchboard.`, { action: { label: 'Undo', run: () => api('/api/hidden', { keys, hidden: false }).then(() => { loadUnsorted(true); load(); }) } });
    renderUnsorted(); load();
  } catch (err) { toast(err.message, { kind: 'error' }); }
}
document.addEventListener('click', (e) => {
  if (page !== 'unsorted') return;
  const k = e.target.closest('[data-us-kind]');
  if (k) { unsortedKind = k.dataset.usKind; renderUnsorted(); return; }
  const f = e.target.closest('[data-us-file]');
  if (f) { usFile(f.dataset.usFile, f.dataset.usTo); return; }
  const h = e.target.closest('[data-us-hide]');
  if (h) { const x = (unsortedList || []).find((u) => (u.hideKey || u.key) === h.dataset.usHide); usHide([h.dataset.usHide], x?.label || 'It'); return; }
  if (e.target.closest('[data-us-hide-plain]')) { const keys = (unsortedList || []).filter((u) => u.notRepo).map((u) => u.hideKey); usHide(keys, `${keys.length} folders`); return; }
  if (e.target.closest('[data-us-show-hidden]')) { showHidden = !showHidden; renderUnsorted(); return; }
  const u = e.target.closest('[data-us-unhide]');
  if (u) api('/api/hidden', { keys: [u.dataset.usUnhide], hidden: false }).then(() => { toast('Back in Switchboard\'s lists.'); loadUnsorted(true); load(); }).catch((err) => toast(err.message, { kind: 'error' }));
});
document.addEventListener('change', (e) => {
  const o = e.target.closest?.('[data-us-other]');
  if (o && o.value) usFile(o.dataset.usOther, o.value);
});
