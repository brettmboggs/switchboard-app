// Mail tracking on the page (lib/mailtrack.js): the card in Settings,
// Connections; the Track switch beside Send (compose and reply); Inbox,
// Tracking (what you sent, who opened and clicked, with the tracker's verdict
// and reasons, and the senders who track you); and the small marks on Inbox
// rows. One of the page's scripts in public/js, loaded in order by index.html;
// they share one scope, so every name here starts with mt or MT.
const MT = { sel: null, detail: null, filter: 'all', loading: false };
const MT_STATUS = { clicked: 'Clicked', opened: 'Opened', delivered: 'Not opened yet', sent: 'Not opened yet' };
const MT_LABEL = { confirmed_human: 'Confirmed person', likely_human: 'Likely a person', automated: 'Automated', self: 'You' };
const mtOn = () => !!S?.mailtrack?.connected;
const mtThreadId = (t) => String(t.threadId || String(t.key || '').split(':').slice(2).join(':'));

// ---------- the Track switch beside Send
function mtToggle(id) {
  if (!mtOn()) return '';
  return `<label class="mt-track" title="Adds your tracker's pixel and tracked links, so you see when it is opened. Set the default in Settings, Connections, Mail tracking."><input type="checkbox" id="${id}" ${S.mailtrack.trackByDefault ? 'checked' : ''}> Track</label>`;
}
const mtTrackValue = (id) => ($(id) ? $(id).checked : undefined);

// ---------- a mark on an Inbox row: they track you, or how your email did
function mtThreadMark(t) {
  if (!mtOn() || t.kind !== 'mail') return '';
  const id = mtThreadId(t), m = S.mailtrack;
  const sent = (m.emails || []).find((e) => e.thread === id);
  if (sent) return `<span class="mt-mark mt-${esc(sent.status)}" title="${esc(MT_STATUS[sent.status])}${sent.lastActivityAt ? ', last ' + ago(sent.lastActivityAt) + ' ago' : ''}">${esc(sent.status === 'clicked' ? 'Clicked' : sent.status === 'opened' ? 'Opened' : 'Unopened')}</span>`;
  const them = (m.trackedThreads || []).find((x) => x.thread === id);
  if (them) return `<span class="mt-mark mt-them" title="The sender tracks this email${them.vendors.length ? ' with ' + esc(them.vendors.join(', ')) : ''}${them.readReceipt ? ' (asks for a read receipt)' : ''}. Switchboard did not load their tracker.">Tracks you</span>`;
  return '';
}

// ---------- Settings, Connections
function renderMailtrackCard() {
  const el = $('mailtrack-card'); if (!el || !S) return;
  if (el.contains(document.activeElement) || [...el.querySelectorAll('input[type=text], input[type=password]')].some((i) => i.value) || el.querySelector('[data-mt-msg]')?.textContent) return;
  const m = S.mailtrack || {};
  if (m.connected) {
    el.innerHTML = `<div class="acct-main"><b>Mail tracking</b><span class="acct-line">${m.ok === false ? `<span class="bad-text">${esc(m.error)}</span>` : `Connected to ${esc(m.address)}${m.user ? ` as ${esc(m.user)}` : ''}. Opens and clicks are on Inbox, Tracking.`}</span></div>
      <div class="acct-wide form-row"><label class="toggle-inline"><input type="checkbox" data-mt-set="trackByDefault" ${m.trackByDefault ? 'checked' : ''}> Track new email</label><label class="toggle-inline"><input type="checkbox" data-mt-set="trackLinks" ${m.trackLinks ? 'checked' : ''}> Links too</label>
      <a class="btn btn--quiet" href="${esc(m.origin)}/app/" target="_blank" rel="noopener noreferrer">Open the tracker</a><button class="btn btn--quiet" type="button" data-mt-disconnect>Disconnect</button></div>`;
    return;
  }
  el.innerHTML = `<div class="acct-main"><b>Mail tracking</b><span class="acct-line">Your own mail tracker (the one on your Cloudflare account): see when email you send from Switchboard is opened and clicked, and which senders track you. Type its address, then paste an access token from it: its dashboard, Settings, Access tokens, New token.</span></div>
    <form class="acct-wide form-row" data-mt-connect><label for="mt-address" class="sr">Tracker address</label><input id="mt-address" class="field" type="text" autocomplete="off" spellcheck="false" placeholder="t.example.com">
      <label for="mt-token" class="sr">Access token</label><input id="mt-token" class="field" type="password" autocomplete="off" spellcheck="false" placeholder="Access token">
      <button class="btn" type="submit">Connect</button><span class="small" data-mt-msg></span></form>`;
}

// ---------- Inbox, Tracking
function mtCounts(e) { const o = e.opens || {}, c = e.clicks || {}; return { opens: (o.human || 0) + (o.likely || 0), clicks: (c.human || 0) + (c.likely || 0), auto: (o.automated || 0) + (c.automated || 0) }; }
// The middle column of Inbox, Tracking: what you sent, newest activity first;
// the right column (inbox.js, inboxPane) is one email's timeline or, with none
// picked, the senders who track you.
const MT_FILTERS = { all: ['All sent', () => true], opened: ['Opened', (e) => e.status === 'opened' || e.status === 'clicked'], unopened: ['Not opened', (e) => e.status === 'sent' || e.status === 'delivered'], clicked: ['Clicked', (e) => e.status === 'clicked'] };
function mtListHtml() {
  const m = S.mailtrack || {};
  if (!m.connected) return `<div class="ib-head"><h2>Tracking</h2></div><div class="empty-cta"><p class="empty">Connect your mail tracker and every email you send from Switchboard shows here: who opened it, who clicked, and whether it was really a person. Senders who track you are marked in your inbox.</p><div class="form-row"><button class="btn btn--primary" type="button" data-setup-link="mailtrack">Connect mail tracking</button></div></div>`;
  const all = m.emails || [], list = all.filter((MT_FILTERS[MT.filter] || MT_FILTERS.all)[1]);
  const filter = `<label class="sr" for="mt-filter">Show</label><select id="mt-filter" class="field field--sm" data-mt-filter>${Object.entries(MT_FILTERS).map(([k, [n, f]]) => `<option value="${k}" ${MT.filter === k ? 'selected' : ''}>${n} ${all.filter(f).length}</option>`).join('')}</select>`;
  const rows = list.map((e) => {
    const c = mtCounts(e), to = e.to[0] ? (e.to[0].name || e.to[0].email) + (e.to.length > 1 ? ` +${e.to.length - 1}` : '') : '';
    const mark = `<span class="mt-mark mt-${esc(e.status)}">${esc(e.status === 'clicked' ? 'Clicked' : e.status === 'opened' ? 'Opened' : 'Unopened')}</span>`;
    return `<button type="button" class="item ib-row mt-row${MT.sel === e.id ? ' sel' : ''}" data-mt-pick="${esc(e.id)}"><span></span><span class="t" title="${esc(e.subject)}">${esc(e.subject || '(no subject)')}</span><span class="ib-when mono muted">${ago(e.lastActivityAt || e.sentAt)}</span>
      <span></span><span class="s" title="${esc(e.to.map((r) => r.email).join(', '))}">${esc(to)}${c.opens ? ` · ${c.opens} open${c.opens > 1 ? 's' : ''}` : ''}${c.clicks ? ` · ${c.clicks} click${c.clicks > 1 ? 's' : ''}` : ''}</span><span class="ib-mark">${mark}</span></button>`;
  }).join('') || `<p class="empty">${all.length ? 'None like that.' : 'Nothing tracked yet. Send an email from Switchboard (or Gmail with the extension) and it shows here.'}</p>`;
  return `<div class="ib-head"><h2>Tracking</h2><span class="grow"></span>${filter}<button class="btn btn--quiet btn--sm" type="button" data-mt-refresh title="Ask your tracker now">Refresh</button></div>
    ${m.ok === false ? `<p class="bad-text small">${esc(m.error)}</p>` : ''}<div class="ib-rows list">${rows}</div>`;
}
function mtDetailHtml() {
  const d = MT.detail;
  if (!d || d.email?.id !== MT.sel) return `<p class="empty">${MT.loading ? 'Reading the tracker…' : 'Pick an email.'}</p>`;
  const e = d.email, c = mtCounts(e);
  const ev = (d.events || []).slice().sort((a, b) => b.at - a.at).map((x) => `<li class="mt-ev mt-${esc(x.label)}"><span class="mt-ev-when">${esc(when(x.at))}</span><span class="mt-ev-what">${x.kind === 'click' ? `Clicked ${esc(x.linkUrl ? new URL(x.linkUrl).hostname : 'a link')}` : 'Opened'}</span><span class="mt-ev-label">${esc(MT_LABEL[x.label] || x.label)}</span>
      <span class="mt-ev-where">${esc([x.device, x.location?.city || x.location?.country, x.network].filter(Boolean).join(' · '))}</span>${(x.reasons || []).length ? `<span class="mt-ev-why">${esc(x.reasons.join(' '))}</span>` : ''}</li>`).join('');
  return `<div class="mt-d-head"><h2 title="${esc(e.subject)}">${esc(e.subject || '(no subject)')}</h2><button class="btn btn--quiet btn--sm" type="button" data-mt-close>Back</button></div>
    <p class="mt-d-sub">To ${esc(e.recipients.map((r) => r.name || r.email).join(', '))} · sent ${esc(when(e.sentAt))}${e.possibleForward ? ' · may have been forwarded' : ''}</p>
    <div class="mt-d-nums"><span><b>${c.opens}</b> opens by a person</span><span><b>${c.clicks}</b> clicks</span><span><b>${c.auto}</b> automated</span></div>
    <ol class="mt-evs">${ev || '<li class="empty">No opens or clicks yet.</li>'}</ol>`;
}
function mtOthersHtml() {
  const m = S.mailtrack, st = m.stats, mine = (m.trackedThreads || []).filter((x) => x.category === 'person' || x.readReceipt);
  return `<h2>Tracked by others</h2>
    ${st ? `<p class="mt-d-sub">Of ${st.checked.toLocaleString()} emails your tracker checked, ${st.tracked.toLocaleString()} carry a tracker; ${st.person} came from people, not newsletters.</p>` : '<p class="mt-d-sub">Your tracker counts the senders who track you once it has read some mail.</p>'}
    ${st?.vendors?.length ? `<div class="chips mt-vendors">${st.vendors.map((v) => `<span class="chip" title="${esc(v.category || '')}">${esc(v.name)} <span class="c">${v.emails}</span></span>`).join('')}</div>` : ''}
    <h3 class="section-label">People tracking you, last 30 days</h3>
    <ul class="mt-people">${mine.slice(0, 12).map((x) => `<li><span class="mt-who" title="${esc(x.from)}">${esc(x.from)}</span><span class="mt-how">${esc(x.readReceipt ? 'read receipt' : x.vendors.join(', '))}</span></li>`).join('') || '<li class="empty">Nobody, so far.</li>'}</ul>
    <p class="hint">Switchboard shows mail as text, so a sender's tracker never loads when you read it here.</p>`;
}
async function mtPick(id) {
  MT.sel = id; MT.loading = true; render();
  try { MT.detail = await api('/api/mailtrack/emails/' + encodeURIComponent(id)); }
  catch (err) { toast(err.message, { kind: 'error' }); MT.sel = null; }
  MT.loading = false; render();
}

// ---------- events
document.addEventListener('click', async (e) => {
  const p = e.target.closest('[data-mt-pick]'); if (p) { mtPick(p.dataset.mtPick); return; }
  if (e.target.closest('[data-mt-close]')) { MT.sel = null; render(); return; }
  if (e.target.closest('[data-mt-refresh]')) { try { await api('/api/mailtrack/refresh', {}); await load(); } catch (err) { toast(err.message, { kind: 'error' }); } return; }
  if (e.target.closest('[data-mt-disconnect]')) {
    try { await api('/api/mailtrack/disconnect', {}); toast('Mail tracking disconnected. Email you send from Switchboard goes untracked; your tracker keeps its history.'); await load(); renderMailtrackCard(); } catch (err) { toast(err.message, { kind: 'error' }); }
  }
});
document.addEventListener('change', async (e) => {
  const f = e.target.closest('[data-mt-filter]'); if (f) { MT.filter = f.value; render(); return; }
  const s = e.target.closest('[data-mt-set]'); if (!s) return;
  try { await api('/api/mailtrack/settings', { [s.dataset.mtSet]: s.checked }); await load(); toast('Saved in your tracker.'); }
  catch (err) { s.checked = !s.checked; toast(err.message, { kind: 'error' }); }
});
document.addEventListener('submit', async (e) => {
  const f = e.target.closest('[data-mt-connect]'); if (!f) return;
  e.preventDefault();
  const btn = f.querySelector('button[type=submit]'), msg = f.querySelector('[data-mt-msg]');
  btn.disabled = true; btn.textContent = 'Checking…'; msg.textContent = '';
  try {
    const r = await api('/api/mailtrack/connect', { address: $('mt-address').value, token: $('mt-token').value });
    f.querySelectorAll('input').forEach((i) => { i.value = ''; });
    toast(`Mail tracking connected${r.user ? ' as ' + r.user : ''}.`); document.activeElement?.blur(); await load(); renderMailtrackCard();
  } catch (err) { msg.textContent = err.message; msg.className = 'small bad-text'; btn.disabled = false; btn.textContent = 'Connect'; }
});
