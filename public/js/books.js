// Books on Inbox, Reading (lib/books.js): the library in the middle column
// (covers, where you are, shelves and tags; Add book searches archive.org for
// books that are free to download, or takes a book's link), and the open book
// in the right column (bookreader.js), read aloud by bookvoice.js.
// Posts from followed blogs (feeds.js) are the other half of Reading: a small
// Books | Posts choice in the column's head when there are any.
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so every name here starts with bk or BK.
const BK = {
  open: store.get('bkOpen', null), book: null, loading: '', what: store.get('bkWhat', 'books'), shelf: store.get('bkShelf', 'all'),
  adding: false, q: '', results: null, searching: false, addErr: '',
  n: 0, view: store.get('bkView', 'scan'), night: store.get('bkNight', false), side: store.get('bkSide', false), focus: false,
  fitPage: store.get('bkFit', 'page') === 'page',   // the whole page on screen, two side by side when there is room
  text: new Map(), sel: null, drag: null, say: null, editMark: null, saveT: null, audio: null, audioErr: ''
};
const BK_SHELF = { reading: 'Reading', want: 'Want to read', finished: 'Finished' };
const bkBooks = () => S?.books || [];
const bkPct = (b) => b.pages ? Math.round((b.page + 1) / b.pages * 100) : 0;
const bkPostsOn = () => (S?.feedCount || 0) > 0 || (S?.reading || []).length > 0;
const bkShowing = () => page === 'inbox' && inboxTab === 'reading' && (BK.what === 'books' || !bkPostsOn());

// ---------- the middle column
function bkListHtml() {
  const posts = bkPostsOn();
  const what = posts ? `<label class="sr" for="bk-what">Show</label><select id="bk-what" class="field field--sm" data-bk-what><option value="books" ${BK.what === 'books' ? 'selected' : ''}>Books ${bkBooks().length}</option><option value="posts" ${BK.what === 'posts' ? 'selected' : ''}>Posts ${readingList().filter((i) => !i.read_at).length || ''}</option></select>` : '';
  if (posts && BK.what === 'posts') return readingHtml().replace('<span class="grow"></span>', `<span class="grow"></span>${what}`);
  const all = bkBooks(), tags = [...new Set(all.flatMap((b) => b.tags))].sort();
  const pick = (b) => BK.shelf === 'all' || b.shelf === BK.shelf || (BK.shelf.startsWith('#') && b.tags.includes(BK.shelf.slice(1)));
  const list = all.filter(pick);
  const shelf = all.length ? `<label class="sr" for="bk-shelf">Shelf</label><select id="bk-shelf" class="field field--sm" data-bk-shelf><option value="all">All books</option>${Object.entries(BK_SHELF).map(([k, n]) => `<option value="${k}" ${BK.shelf === k ? 'selected' : ''}>${n} ${all.filter((b) => b.shelf === k).length || ''}</option>`).join('')}${tags.map((t) => `<option value="#${esc(t)}" ${BK.shelf === '#' + t ? 'selected' : ''}># ${esc(t)}</option>`).join('')}</select>` : '';
  const rows = list.map((b) => `<button type="button" class="item ib-row bk-row${BK.open === b.id ? ' sel' : ''}" data-bk-open="${esc(b.id)}"><img class="bk-thumb" src="/api/books/${encodeURIComponent(b.id)}/cover" alt="" loading="lazy">
      <span class="t" title="${esc(b.title)}">${esc(b.title)}</span><span class="ib-when mono muted">${b.page ? bkPct(b) + '%' : b.shelf === 'want' ? '' : 'new'}</span>
      <span class="s" title="${esc(b.author)}">${esc([b.author.replace(/,\s*\d{4}-.*$/, ''), b.page ? (b.label ? `p. ${b.label}` : `${b.page + 1} of ${b.pages}`) : `${b.pages} pages`].filter(Boolean).join(' · '))}</span><span class="ib-mark">${b.audio ? '<span class="bk-has" title="Has an audiobook">♪</span>' : ''}${b.shelf === 'finished' ? '<span class="bk-has">Finished</span>' : ''}</span>
      <span class="bk-bar" style="--p:${bkPct(b)}%"></span></button>`).join('');
  const none = all.length ? '<p class="empty">No books on that shelf.</p>' : `<div class="empty-cta"><p class="empty">Your library is empty. Add a book from archive.org: search by title or author, or paste the link of a book you found there. Books free to download work; borrow-only ones are copy-protected.</p></div>`;
  return `<div class="ib-head"><h2>Reading</h2><span class="grow"></span>${what}${shelf}<button class="btn btn--quiet btn--sm" type="button" data-bk-adding aria-pressed="${BK.adding}">Add book</button></div>
    ${BK.adding || !all.length ? bkFindHtml() : ''}<div class="ib-rows list">${rows || (BK.adding ? '' : none)}</div>`;
}

function bkFindHtml() {
  const res = BK.results;
  const rows = res ? res.map((r) => `<div class="bk-hit"><img class="bk-thumb" src="https://archive.org/services/img/${encodeURIComponent(r.id)}" alt="" loading="lazy">
      <span class="t" title="${esc(r.title)}">${esc(r.title)}</span><span class="s">${esc([r.author.replace(/,\s*\d{4}-.*$/, ''), r.year, r.pages ? r.pages + ' pages' : ''].filter(Boolean).join(' · '))}</span>
      ${bkBooks().some((b) => b.id === r.id) ? '<span class="muted small">In your library</span>' : r.free ? `<button class="btn btn--sm" type="button" data-bk-add="${esc(r.id)}">Add</button>` : '<span class="muted small" title="A lending-library loan: copy-protected">Borrow only</span>'}</div>`).join('') || '<p class="empty">No free books found for that. Try fewer words, or the author\'s surname.</p>' : '';
  return `<form class="bk-find" data-bk-find><label for="bk-q" class="sr">Find a book</label><input id="bk-q" class="field" value="${esc(BK.q)}" placeholder="Title or author, or paste an archive.org link" autocomplete="off" spellcheck="false">
    <button class="btn btn--primary" type="submit" ${BK.searching ? 'disabled' : ''}>${BK.searching ? 'Looking…' : 'Find'}</button></form>
    ${BK.addErr ? `<p class="bad-text small bk-err">${esc(BK.addErr)}</p>` : ''}${res ? `<div class="bk-hits">${rows}</div>` : ''}`;
}

// ---------- the right column: the shell bookreader.js paints into
function bkPaneHtml() {
  if (BK.open && bkBooks().some((b) => b.id === BK.open)) return `<div class="bk-reader" id="bk-reader" data-book="${esc(BK.open)}"></div>`;
  const b = bkBooks()[0];
  return `<div class="ib-pane-empty"><p class="ib-pane-big">${b ? 'Pick a book' : 'Your library'}</p><p class="muted">${b ? 'It opens where you left off. Arrow keys turn the page.' : 'Add a book from archive.org and it opens here, on its own pages.'}</p></div>`;
}

// Open a book (from the list, Jarvis or search), at the page you were on.
function bkOpenBook(id, { read = false } = {}) {
  BK.open = id; store.set('bkOpen', id); BK.what = 'books'; store.set('bkWhat', 'books');
  BK.book = null; BK.sel = null; BK.text = new Map();
  inboxTab = 'reading'; store.set('inboxTab', inboxTab); selected = null;
  if (location.hash !== '#inbox') location.hash = '#inbox'; else render();
  if (read) bkWhenLoaded(() => bvStart({ n: BK.n }));
}
function bkWhenLoaded(fn, tries = 60) { if (BK.book && BK.book.id === BK.open) fn(); else if (tries) setTimeout(() => bkWhenLoaded(fn, tries - 1), 150); }

// ---------- events
document.addEventListener('click', async (e) => {
  const o = e.target.closest('[data-bk-open]');
  if (o) { if (BK.open !== o.dataset.bkOpen) bkOpenBook(o.dataset.bkOpen); return; }
  if (e.target.closest('[data-bk-adding]')) { BK.adding = !BK.adding; BK.addErr = ''; render(); if (BK.adding) setTimeout(() => $('bk-q')?.focus(), 0); return; }
  const add = e.target.closest('[data-bk-add]');
  if (add) {
    add.disabled = true; add.textContent = 'Adding…'; BK.addErr = '';
    try { const b = await api('/api/books/add', { link: add.dataset.bkAdd }); BK.adding = false; BK.results = null; BK.q = ''; await load(); bkOpenBook(b.id); toast(`${b.title} is in your library.`); }
    catch (err) { BK.addErr = err.message; render(); }
  }
});
document.addEventListener('submit', async (e) => {
  const f = e.target.closest('[data-bk-find]'); if (!f) return;
  e.preventDefault();
  BK.q = $('bk-q').value.trim(); if (!BK.q) return;
  BK.searching = true; BK.addErr = ''; render();
  try {
    if (/archive\.org\/(details|download|stream)\//i.test(BK.q)) {
      const b = await api('/api/books/add', { link: BK.q });
      BK.searching = false; BK.adding = false; BK.results = null; BK.q = ''; await load(); bkOpenBook(b.id); toast(`${b.title} is in your library.`); return;
    }
    BK.results = (await api('/api/books/search?q=' + encodeURIComponent(BK.q))).results;
  } catch (err) { BK.addErr = err.message; BK.results = null; }
  BK.searching = false; render();
  setTimeout(() => $('bk-q')?.focus(), 0);
});
document.addEventListener('change', (e) => {
  const w = e.target.closest?.('[data-bk-what]'); if (w) { BK.what = w.value; store.set('bkWhat', BK.what); render(); return; }
  const s = e.target.closest?.('[data-bk-shelf]'); if (s) { BK.shelf = s.value; store.set('bkShelf', BK.shelf); render(); }
});
