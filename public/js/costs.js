// Recurring costs (Money, and each project's page): what you pay again and
// again, what it comes to a month, split by project, and charges in your
// email that look like subscriptions. Adding and editing happen in the side
// panel, in a form that is never redrawn while it is open (the board redraws
// on every change; a redraw must not take what is being typed).
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
const CADENCE_WORD = { weekly: 'every week', monthly: 'every month', quarterly: 'every 3 months', yearly: 'every year' };
const PER_MONTH = { weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };
const monthly = (b) => (Number(b.amount) || 0) * (PER_MONTH[b.cadence] ?? 1);
let costForm = null;   // { key, dirty }: the open add or edit form

// The card on Money (and, for one project, on its page).
function costsCard(only = null) {
  const list = S.money.bills.filter(only ? (b) => b.space === only : inProject).sort((a, b) => monthly(b) - monthly(a));
  const guesses = (S.money.guesses || []).filter(only ? (g) => g.space === only : inProject);
  const total = list.reduce((a, b) => a + monthly(b), 0);
  const byProject = new Map();
  for (const b of list) byProject.set(b.space, (byProject.get(b.space) || 0) + monthly(b));
  const split = !only && byProject.size > 1 ? `<div class="cost-split">${[...byProject].sort((a, b) => b[1] - a[1]).map(([sp, m]) => `<span class="cost-share">${tag(sp)}${esc(spaceOf(sp).name)} <span class="amt">${$$(m)}</span></span>`).join('')}</div>` : '';
  const rows = list.map((b) => row({ type: 'item', key: String(b.id), space: b.space, title: b.text,
    sub: [CADENCE_WORD[b.cadence] || b.cadence, b.next ? 'next ' + dayOnly(b.next) : '', only ? '' : spaceOf(b.space).name].filter(Boolean).join(' · '),
    right: `<span class="amt">${$$(b.amount)}</span>${b.cadence !== 'monthly' ? `<span class="amt muted">${$$(monthly(b))}/mo</span>` : ''}` })).join('');
  const guessRows = guesses.map((g) => `<div class="item cost-guess"><span class="tag" style="background:${safeColor(spaceOf(g.space).color)}"></span>
      <span><span class="t">${esc(g.name)}</span><br><span class="s">${$$(g.amount)} ${esc(CADENCE_WORD[g.cadence] || '')}, seen ${g.times} times · last ${dayOnly(g.last)}</span></span>
      <span class="r"><button class="btn btn--ghost" type="button" data-cost-guess="${esc(g.key)}">Add</button><button class="btn btn--quiet" type="button" data-cost-no="${esc(g.name)}">Not recurring</button></span></div>`).join('');
  return `<section class="card costs"><div class="group-head"><h2>Recurring costs</h2>
      <span class="sum">${list.length ? `${$$(total)} a month · ${$$(total * 12)} a year` : ''}</span><button class="btn" type="button" data-cost-new>Add</button></div>
    ${split}<div class="list">${rows || empty(only ? 'No recurring costs for this project yet. Add rent, hosting, a domain, software, insurance.' : 'Add what you pay again and again (rent, hosting, software, insurance) and see what it comes to a month, by project. Or Ctrl+K: "bill Google Workspace 14 monthly on 6".')}</div>
    ${guessRows ? `<h3 class="section-label">Looks recurring, from your email</h3><div class="list">${guessRows}</div>` : ''}</section>`;
}

// The form in the side panel: a new cost (selected = { type: 'newcost' }) or one being edited.
function costFormHtml(x, key) {
  const d = x || {};
  const date = d.next || d.due_at ? new Date(d.next || d.due_at).toISOString().slice(0, 10) : '';
  const sp = d.space || (page === 'project' && openProject) || (project !== 'all' ? project : 'personal');
  return `<form class="cost-form form-grid" id="cost-form" data-key="${esc(key)}">
      <label for="cf-text">Name</label><input id="cf-text" required maxlength="120" placeholder="Hosting, rent, Adobe…" value="${esc(d.text || '')}">
      <label for="cf-amount">Amount</label><input id="cf-amount" required inputmode="decimal" placeholder="14.00" value="${d.amount != null ? esc(String(d.amount)) : ''}">
      <label for="cf-cadence">How often</label><select id="cf-cadence">${Object.entries(CADENCE_WORD).map(([k, v]) => `<option value="${k}" ${(d.cadence || 'monthly') === k ? 'selected' : ''}>${v[0].toUpperCase() + v.slice(1)}</option>`).join('')}</select>
      <label for="cf-date">Next charge</label><input id="cf-date" type="date" value="${date}">
      <label for="cf-space">Project</label><select id="cf-space">${S.spaces.map((s) => `<option value="${esc(s.id)}" ${s.id === sp ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
      <span></span><div class="form-row"><button class="btn btn--primary" type="submit">${x?.id ? 'Save' : 'Add'}</button>${x?.id ? '<button class="btn" type="button" data-act="delete">Delete</button>' : '<button class="btn" type="button" data-cost-cancel>Cancel</button>'}<span id="cf-msg" class="small"></span></div>
    </form>`;
}
// True while the open form should be left alone (renderDetail asks before drawing).
function costFormOpen(key) { const f = $('cost-form'); return !!(f && f.dataset.key === key && costForm?.key === key); }

function openCostForm(prefill) {
  selected = { type: 'newcost', key: 'new' }; costForm = { key: 'new', prefill }; renderDetail();
  $('cf-text')?.focus();
}
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-cost-new]')) { openCostForm(null); return; }
  if (e.target.closest('[data-cost-cancel]')) { costForm = null; selected = null; renderDetail(); return; }
  const g = e.target.closest('[data-cost-guess]');
  if (g) { const x = (S.money.guesses || []).find((y) => y.key === g.dataset.costGuess); if (x) openCostForm({ text: x.name, amount: x.amount, cadence: x.cadence, space: x.space }); return; }
  const no = e.target.closest('[data-cost-no]');
  if (no) { no.disabled = true; api('/api/costs/not-recurring', { name: no.dataset.costNo }).then(load).then(() => toast('Left out. It will not be suggested again.')).catch((err) => toast(err.message, { kind: 'error' })); }
});
document.addEventListener('input', (e) => { if (e.target.closest?.('#cost-form') && costForm) costForm.dirty = true; });
document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'cost-form') return;
  e.preventDefault();
  const key = e.target.dataset.key, date = $('cf-date').value;
  const body = { text: $('cf-text').value, amount: $('cf-amount').value, cadence: $('cf-cadence').value, space: $('cf-space').value,
    due_at: date ? new Date(date + 'T09:00').getTime() : null };
  try {
    if (key === 'new') { const r = await api('/api/costs', body); selected = { type: 'item', key: String(r.id) }; toast('Added.'); }
    else { await api('/api/costs/' + key, body); toast('Saved.'); }
    costForm = null;
    await load();
  } catch (err) { $('cf-msg').textContent = err.message; $('cf-msg').className = 'small bad-text'; }
});
