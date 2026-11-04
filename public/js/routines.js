// Chores and routines (lib/routines.js): the Routines card on Notes with ideas to
// pick from, a Needs-you card when one is due, and its detail panel.
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
let routineIdeas = null, ideasOpen = false;

const dueNow = (r) => r.due_at && r.due_at <= Date.now();

// Due ones need you, with the rest of the cards on Now.
function routineCards() {
  return (S.routines || []).filter(dueNow).map((r) => ({ type: 'routine', key: String(r.id), space: r.space, st: 'needs', label: 'Routine', where: r.every, what: r.text, at: r.due_at }));
}

function routinesCard() {
  const list = (S.routines || []).filter(inProject);
  const have = new Set((S.routines || []).map((r) => r.text.toLowerCase()));
  let ideas = '';
  if (ideasOpen) {
    if (!routineIdeas) api('/api/routines/ideas').then((r) => { routineIdeas = r.ideas; render(); }).catch(() => {});
    const groups = [...new Set((routineIdeas || []).map((i) => i.group))];
    ideas = `<div class="rt-ideas"><p class="hint">Tap one to add it${project !== 'all' ? ` to ${esc(spaceOf(project).name)}` : ''}. Change the time after, on the routine itself.</p>
      ${groups.map((g) => `<div class="rt-group"><span class="ship-label">${esc(g)}</span><div class="rt-chips">${routineIdeas.filter((i) => i.group === g).map((i) => {
        const added = [...have].some((t) => i.line.toLowerCase().startsWith(t));
        return `<button type="button" class="rt-idea" data-rt-idea="${esc(i.line)}" ${added ? 'disabled' : ''}>${added ? '✓ ' : '+ '}${esc(i.line)}</button>`;
      }).join('')}</div></div>`).join('') || '<p class="hint">Loading…</p>'}</div>`;
  }
  return `<section class="card"><div class="rt-head"><h2>Routines <span class="count">${list.length || ''}</span></h2><button class="btn" type="button" data-rt-ideas>${ideasOpen ? 'Close ideas' : 'Ideas'}</button></div>
    ${ideas}
    <div class="list">${list.map((r) => row({ type: 'routine', key: String(r.id), space: r.space, title: r.text, via: r.every, sub: '', right: dueNow(r) ? '<span class="mono late">due</span>' : `<span class="mono muted">${esc(when(r.due_at))}</span>` })).join('')
      || empty('Things that come back: type "feed the animals every day at 6am and 6pm" or "change the filter every 90 days" above, or pick from Ideas.')}</div></section>`;
}

function findRoutine(key) { return (S.routines || []).find((r) => String(r.id) === key); }

function routineDetail(x, kick) {
  return kick('Routine') + `<h2>${esc(x.text)}</h2>
    <dl class="facts"><dt>When</dt><dd>${esc(x.every)}</dd><dt>${dueNow(x) ? 'Due' : 'Next'}</dt><dd>${esc(when(x.due_at))}${dueNow(x) ? ` · ${esc(since(x.due_at))}` : ''}</dd>${x.amount ? `<dt>Done</dt><dd>${x.amount} time${x.amount === 1 ? '' : 's'}</dd>` : ''}</dl>
    <div class="actions"><button class="btn btn--primary" type="button" data-rt="done">Done</button><button class="btn" type="button" data-rt="skip">Skip this one</button>${dueNow(x) ? '<button class="btn" type="button" data-rt="snooze">1 hour</button>' : ''}</div>
    <form class="rt-edit" id="rt-edit"><label for="rt-when" class="field-label">Change when</label><div class="form-row"><input id="rt-when" type="text" placeholder="every sat at 9am · every 2 weeks · monthly on the 15th" autocomplete="off"><button class="btn" type="submit">Change</button></div>
      <label for="rt-name" class="field-label">Name</label><div class="form-row"><input id="rt-name" type="text" value="${esc(x.text)}" maxlength="200" autocomplete="off"><button class="btn" type="button" data-rt="rename">Rename</button></div></form>
    <div class="actions"><button class="btn" type="button" data-rt="delete">${routineDeleteArmed === x.id ? 'Click again to delete it' : 'Delete'}</button></div>`;
}
let routineDeleteArmed = null;

document.addEventListener('click', async (e) => {
  if (e.target.closest('[data-rt-ideas]')) { ideasOpen = !ideasOpen; render(); return; }
  const idea = e.target.closest('[data-rt-idea]');
  if (idea) {
    idea.disabled = true;
    try { const r = await api('/api/routines', { add: idea.dataset.rtIdea, space: project }); toast(`Added: ${r.text}, ${r.every.charAt(0).toLowerCase() + r.every.slice(1)}.`); await load(); }
    catch (err) { idea.disabled = false; toast(err.message, { kind: 'error' }); }
    return;
  }
  const b = e.target.closest('[data-rt]');
  if (!b || selected?.type !== 'routine') return;
  const x = findRoutine(selected.key);
  if (!x) return;
  const act = b.dataset.rt;
  try {
    if (act === 'done' || act === 'skip') { const r = await api('/api/routines', { id: x.id, [act]: true }); toast(`${act === 'done' ? 'Done' : 'Skipped'}. Next: ${when(r.due_at)}.`); }
    else if (act === 'snooze') { await api(`/api/items/${x.id}/snooze`, { until: Date.now() + 3600e3 }); toast('Back in an hour.'); }
    else if (act === 'rename') { await api('/api/routines', { id: x.id, text: $('rt-name').value }); toast('Renamed.'); }
    else if (act === 'delete') {
      if (routineDeleteArmed !== x.id) { routineDeleteArmed = x.id; renderDetail(); return; }
      await api(`/api/items/${x.id}/delete`, {}); selected = null; routineDeleteArmed = null; toast('Deleted.');
    }
    await load();
  } catch (err) { toast(err.message, { kind: 'error' }); }
});

document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'rt-edit') return;
  e.preventDefault();
  const x = selected && findRoutine(selected.key);
  if (!x || !$('rt-when').value.trim()) return;
  try { await api('/api/routines', { id: x.id, schedule: $('rt-when').value }); toast('Changed.'); await load(); }
  catch (err) { toast(err.message, { kind: 'error' }); }
});
