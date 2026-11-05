// News and blogs (lib/feeds.js): Inbox, Reading lists the newest posts from the
// feeds you follow, a post leaves once read (no orange dot: that is for people); a click opens the post in a new tab
// and marks it read. Never orange and never on Now: reading is for when there
// is time. Settings, Connections, News and blogs adds and removes feeds.
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
const readingList = () => (S.reading || []).filter(inProject);

function readingHtml() {
  const list = readingList(), unread = list.filter((i) => !i.read_at).length;
  if (!list.length) return `<section class="card"><div class="empty-cta"><p class="empty">${S.feedCount ? 'All caught up. New posts show here as they come out.' : 'Follow news sites and blogs and their newest posts show here, quietly: never as something that needs you.'}</p>
    ${S.feedCount ? '' : `<form class="form-row feed-add" data-feed-add><label for="feed-url" class="sr">Site or feed address</label><input id="feed-url" class="field" placeholder="A site or its feed, e.g. example.com/blog" autocomplete="off"><button class="btn btn--primary" type="submit">Follow</button></form>`}</div></section>`;
  return `<section class="card"><div class="group-head"><h2>Reading</h2><span class="sum">${unread ? `${unread} unread` : 'All read'}</span>${unread ? '<button class="btn btn--ghost" type="button" data-feed-allread>Mark all read</button>' : ''}</div>
    <div class="list">${list.map((i) => `<a class="item feed-item ${i.read_at ? '' : 'unread'}" href="${safeHref(i.link)}" target="_blank" rel="noopener noreferrer" data-feed-open="${esc(i.feed)}" data-guid="${esc(i.guid)}">${tag(i.space)}
      <span><span class="t">${esc(i.title)}</span><br><span class="s"><span class="via">${esc(i.feedName)}</span>${esc(i.summary || '')}</span></span><span class="r"><span class="mono muted">${ago(i.date)}</span></span></a>`).join('')}</div></section>`;
}

// Settings, Connections: the feeds followed, with Add.
async function renderFeedsCard() {
  const el = $('feeds-card'); if (!el || !SET) return;
  if (el.querySelector('#feed-set-url') === document.activeElement) return;   // typing an address: leave it
  const list = (await api('/api/feeds').catch(() => ({ feeds: [] }))).feeds;
  el.innerHTML = `<div class="acct-main"><b>News and blogs</b><span class="acct-line">${list.length ? `${list.length} followed. Their posts are on Inbox, Reading.` : 'Follow sites and blogs; their newest posts show on Inbox, Reading.'}</span></div>
    <div class="acct-wide feed-list">${list.map((f) => `<div class="cal-row"><span><b>${esc(f.name)}</b>${f.kind === 'page' ? ' <span class="muted small">no feed, watching the page</span>' : ''}${f.ok === false ? `<span class="bad-text small"> ${esc(f.error)}</span>` : ''}</span>
      <select class="field field--sm" data-feed-space="${esc(f.id)}" aria-label="Project for ${esc(f.name)}">${SET.spaces.map((x) => `<option value="${esc(x.id)}" ${x.id === f.space ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
      <button class="btn btn--quiet" type="button" data-feed-remove="${esc(f.id)}">Stop following</button></div>`).join('')}
    <form class="form-row feed-add" data-feed-add><label for="feed-set-url" class="sr">Site or feed address</label><input id="feed-set-url" class="field" placeholder="A site or its feed address" autocomplete="off"><button class="btn" type="submit">Follow</button><span class="small" data-feed-msg></span></form></div>`;
}

document.addEventListener('submit', async (e) => {
  const f = e.target.closest('[data-feed-add]'); if (!f) return;
  e.preventDefault();
  const input = f.querySelector('input'), btn = f.querySelector('button'), msg = f.querySelector('[data-feed-msg]');
  if (!input.value.trim()) return;
  btn.disabled = true; btn.textContent = 'Looking…';
  try {
    const r = await api('/api/feeds/add', { url: input.value, space: captureSpace() === 'all' ? 'personal' : captureSpace() });
    input.value = ''; toast(`Following ${r.feed.name}.`);
    await load(); renderFeedsCard();
  } catch (err) { if (msg) { msg.textContent = err.message; msg.className = 'small bad-text'; } else toast(err.message, { kind: 'error' }); }
  finally { btn.disabled = false; btn.textContent = 'Follow'; }
});
document.addEventListener('click', (e) => {
  const o = e.target.closest('[data-feed-open]');
  if (o) { api('/api/feeds/read', { feed: o.dataset.feedOpen, guid: o.dataset.guid }).then(load).catch(() => {}); return; }   // the link itself opens the post
  if (e.target.closest('[data-feed-allread]')) { api('/api/feeds/all-read', { feeds: [...new Set(readingList().map((i) => i.feed))] }).then(load).catch((err) => toast(err.message, { kind: 'error' })); return; }
  const rm = e.target.closest('[data-feed-remove]');
  if (rm) { rm.disabled = true; api('/api/feeds/remove', { id: rm.dataset.feedRemove }).then(load).then(renderFeedsCard).catch((err) => toast(err.message, { kind: 'error' })); }
});
document.addEventListener('change', (e) => {
  const s = e.target.closest?.('[data-feed-space]');
  if (s) api('/api/feeds/edit', { id: s.dataset.feedSpace, space: s.value }).then(load).catch((err) => toast(err.message, { kind: 'error' }));
});
