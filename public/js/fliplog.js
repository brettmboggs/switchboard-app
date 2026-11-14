// Flip log (#fliplog, a tab of Money): each thing bought to resell, from bought
// to listed to sold, with the profit after eBay's fee and the label, and the
// money still sitting in what has not sold (lib/fliplog.js). Add one here, or
// with "I bought it" on a Flips price check. One screen: the list scrolls in
// its own box. One of the page's scripts in public/js, loaded by index.html.
const flog = { data: null, at: 0, busy: false };

async function flogLoad(force = false) {
  if (flog.busy || (!force && flog.data && Date.now() - flog.at < 60e3)) return;
  flog.busy = true;
  try { flog.data = await api('/api/flips/log'); flog.at = Date.now(); } catch {}
  flog.busy = false;
  if (page === 'fliplog') renderFlipLog();
}

function flogRow(e) {
  const n = (k, ph, title) => `<input class="field field--sm fl-num" name="${k}" type="number" min="0" step="0.01" placeholder="${ph}" title="${title}" value="${e[k] ?? ''}" data-flog-edit="${esc(e.id)}">`;
  const status = `<select class="field field--sm" name="status" data-flog-edit="${esc(e.id)}" aria-label="Status">${['bought', 'listed', 'sold'].map((s) => `<option${e.status === s ? ' selected' : ''}>${s}</option>`).join('')}</select>`;
  const name = e.url ? `<a href="${safeHref(e.url)}" target="_blank" rel="noopener noreferrer" title="${esc(e.name)}">${esc(e.name)}</a>` : `<span title="${esc(e.name)}">${esc(e.name)}</span>`;
  return `<div class="flog-row flog-row--${e.status}">
    <span class="flog-name">${name}<small>${esc(e.where || '')}${e.where ? ' · ' : ''}bought ${esc(e.boughtAt || '')}${e.days != null ? ` · ${e.days} day${e.days === 1 ? '' : 's'}${e.status === 'sold' ? ' to sell' : ' so far'}` : ''}</small></span>
    <span class="flog-num" title="All it cost">${flMoney(e.cost)}</span>
    ${status}
    ${e.status === 'bought' ? '<span></span>' : n(e.status === 'sold' ? 'soldFor' : 'listPrice', e.status === 'sold' ? 'Sold for' : 'Listed at', e.status === 'sold' ? 'What the buyer paid' : 'Listed at')}
    ${e.status === 'sold' ? n('shipOut', 'Label', 'The shipping label') : '<span></span>'}
    <span class="flog-num flog-profit${e.profit == null ? '' : e.profit > 0 ? ' flog-profit--up' : ' flog-profit--down'}" title="${e.fee != null ? `eBay fee ${flMoney(e.fee)}` : ''}">${e.profit == null ? (e.sells ? `~${flMoney(e.sells)}` : '') : flMoney(e.profit)}</span>
    <button class="btn btn--ghost" type="button" data-flog-remove="${esc(e.id)}" aria-label="Remove ${esc(e.name)}">Remove</button>
  </div>`;
}

function renderFlipLog() {
  flogLoad();
  const d = flog.data, t = d?.totals;
  const head = `<div class="page-head"><h1>Money</h1>${subTabs()}<span class="grow"></span></div>`;
  const stat = (label, value, cls = '') => `<div class="flog-stat"><span class="flog-label">${label}</span><b class="${cls}">${value}</b></div>`;
  const stats = t ? `<div class="flog-stats">${stat('Profit this month', flMoney(t.month), t.month > 0 ? 'flog-profit--up' : '')}${stat('Profit in all', flMoney(t.profit), t.profit > 0 ? 'flog-profit--up' : '')}${stat(`Money in ${t.open} unsold`, flMoney(t.tiedUp))}${stat('Usual days to sell', t.days == null ? '–' : t.days)}</div>` : '';
  const rows = !d ? '<p class="empty">Loading…</p>' : d.entries.length ? d.entries.map(flogRow).join('')
    : '<p class="empty">Nothing yet. Add what you bought above, or press "I bought it" on a Flips price check. Mark each one listed, then sold with what the buyer paid, and the profit after eBay\'s fee shows here.</p>';
  keepEdits($('page'), () => {
  $('page').innerHTML = head + `<div class="flog-page">${stats}
    <section class="card flog-card"><h2>Flip log<span class="count">${d?.entries?.length || 0}</span><span class="aside">profit is after eBay's fee and the label</span></h2>
      <form class="flog-add" data-flog-add>
        <label class="sr" for="flog-name">What it is</label><input id="flog-name" name="name" class="field" type="text" autocomplete="off" placeholder="What you bought">
        <label class="sr" for="flog-cost">All it cost</label><input id="flog-cost" name="cost" class="field fl-num" type="number" min="0" step="0.01" placeholder="All it cost $">
        <label class="sr" for="flog-where">Where</label><input id="flog-where" name="where" class="field" type="text" autocomplete="off" placeholder="Where (ShopGoodwill…)">
        <button class="btn btn--primary" type="submit">Add</button>
      </form>
      <div class="fl-list flog-list">${rows}</div>
    </section></div>`;
  }, { forget: flog.forget });
  flog.forget = false;
}

document.addEventListener('submit', async (e) => {
  const f = e.target.closest('[data-flog-add]');
  if (!f) return;
  e.preventDefault();
  const v = Object.fromEntries(new FormData(f));
  try { flog.data = await api('/api/flips/log', v); flog.at = Date.now(); flog.forget = true; renderFlipLog(); $('flog-name')?.focus(); } catch (err) { toast(err.message, { kind: 'error' }); }
});

document.addEventListener('change', async (e) => {
  const el = e.target.closest('[data-flog-edit]');
  if (!el || page !== 'fliplog') return;
  try { flog.data = await api('/api/flips/log', { id: el.dataset.flogEdit, [el.name]: el.value }); flog.at = Date.now(); flog.forget = true; renderFlipLog(); } catch (err) { toast(err.message, { kind: 'error' }); }
});

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-flog-remove]');
  if (!b || page !== 'fliplog') return;
  const before = flog.data;
  const entry = before?.entries.find((x) => x.id === b.dataset.flogRemove);
  try {
    flog.data = await api('/api/flips/log/remove', { id: b.dataset.flogRemove }); flog.forget = true; renderFlipLog();
    if (entry) toast(`Removed ${entry.name}.`, { undo: async () => { const { id, fee, profit, days, ...keep } = entry; flog.data = await api('/api/flips/log', keep); renderFlipLog(); } });
  } catch (err) { toast(err.message, { kind: 'error' }); }
});
