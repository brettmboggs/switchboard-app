// The Money page (Inbox: inbox.js and convo.js; Notes: notebook.js).
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
// ---------- Inbox: see inbox.js and convo.js

// ---------- Money
function renderMoney() {
  const now = Date.now();
  const inv = S.money.invoices.filter(inProject);
  const bills = S.money.bills.filter(inProject).filter((b) => b.next && b.next - now < 31 * 86400e3).sort((a, b) => a.next - b.next);
  const paid = S.money.paid.filter(inProject);
  const mail = S.money.mail.filter(inProject).filter((m) => now - m.date < 30 * 86400e3);
  const charged = mail.filter((m) => m.kind === 'charge' && now - m.date < 14 * 86400e3);
  let html = `<div class="page-head"><h1>Money</h1>${S.flips && !window.WEB ? subTabs() : ''}<span class="grow"></span>${projectPicker()}</div>
    <div class="tiles">
      <div class="tile"><div class="big">${$$(inv.reduce((a, b) => a + (b.amount || 0), 0))}</div><div class="muted small">owed to you</div></div>
      <div class="tile"><div class="big in">${$$(paid.filter((p) => now - p.created_at < 30 * 86400e3).reduce((a, b) => a + (b.amount || 0), 0))}</div><div class="muted small">paid to you, 30 days</div></div>
      <div class="tile"><div class="big">${$$(bills.filter((b) => b.next - now < 14 * 86400e3).reduce((a, b) => a + (b.amount || 0), 0))}</div><div class="muted small">bills due, 14 days</div></div>
      <div class="tile"><div class="big">${$$(charged.reduce((a, b) => a + (b.amount || 0), 0))}</div><div class="muted small">card charges, 14 days</div></div>
    </div>` + costsCard();
  const section = (title, rows, emptyText) => `<section class="card"><h2>${title}</h2><div class="list">${rows || empty(emptyText)}</div></section>`;
  html += `<div class="row2">` + section('Invoices out', inv.map((v) => row({ type: 'invoice', key: String(v.id), space: v.space, title: v.text, sub: `Sent ${when(v.created_at)}${v.due_at ? ' · due ' + dayOnly(v.due_at) : ''}`, right: `<span class="amt">${$$(v.amount)}</span>` })).join(''), 'Ctrl+K: "invoice Acme 1500 due fri"')
    + section('Bills, next 30 days', bills.map((b) => row({ type: 'item', key: String(b.id), space: b.space, title: b.text, sub: `${dayOnly(b.next)} · ${CADENCE_WORD[b.cadence] || b.cadence}`, right: `<span class="amt">−${$$(b.amount)}</span>` })).join(''), 'Ctrl+K: "bill Google Workspace 14 monthly on 6"') + `</div>`;
  html += `<div class="row2">` + section('Paid to you', paid.map((p) => row({ type: 'item', key: String(p.id), space: p.space, title: p.text, sub: when(p.created_at), right: `<span class="amt in">+${$$(p.amount)}</span>` })).join(''), 'Ctrl+K: "paid Acme 1500 check"')
    + section('Charges and receipts, 30 days', mail.map((m) => row({ type: 'money', key: m.msg_id, space: m.space, title: m.merchant || m.from_name || m.from_addr, via: m.kind === 'charge' ? 'Charge' : 'Receipt', sub: `${m.subject} · ${dayOnly(m.date)}`, right: m.amount != null ? `<span class="amt">−${$$(m.amount)}</span>` : '' })).join(''), 'Card alerts and receipts from your email land here.') + `</div>`;
  $('page').innerHTML = html;
}

// ---------- Notes: see notebook.js
