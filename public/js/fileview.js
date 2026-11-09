// Files named in a session's chat open with a click. Claude writes
// "docs/PITCH.md", "lib/search.js:12" or a screenshot's full path; each one
// that really exists on this computer (asked once, in a batch) becomes a link,
// and a file Claude sends you (SendUserFile) is a card, a picture shown right
// there. A click opens the reader: markdown drawn as a page, text and code with
// the named line lit, pictures full size, and for anything else Open (its own
// app) and Show in folder. Server side: lib/routes/localfile.js.
// A session on another computer works the same: that computer looks and sends
// the file back over the relay; Open and Show in folder stay on that computer.

const FILE_RE = /^(~|\.{1,2})?\/?(?:[\w.@+-]+\/)*[\w@+-][\w.@+-]*(?:\.[A-Za-z][A-Za-z0-9]{0,7}|\/)(?::\d+(?::\d+)?|#L\d+)?$/;
function looksLikePath(t) {
  const s = String(t || '').trim();
  return s.length > 2 && s.length < 400 && !/\s|^[a-z][\w+.-]*:\/\//i.test(s) && FILE_RE.test(s) && (/\//.test(s) || /\.[A-Za-z]/.test(s));
}
// A file name in the text, waiting to hear whether it is real.
function pathEl(tag, cls, text, path) {
  const e = elt(tag, cls, text);
  e.dataset.path = String(path).trim();
  return e;
}

// ---- which names are real: one request per drawing, remembered per session
const fileKnown = new Map();   // `${term}|${path}` -> true | false
const fileWait = new Map();    // term -> Set of elements
let fileTimer = null;
// Sessions are named by their key (a local id, or r:<device>:<id>); requests go
// to this computer or, through it, to the one the session runs on.
const chatTermId = () => (cv && termByKey(cv.key) ? cv.key : null);
const fvUrl = (key, op) => termPath(termByKey(key) || { id: key }, 'files/' + op);

// base: the folder relative names start from (the reader's own file), else the session's.
function fileLinks(root, { term = chatTermId(), base = null } = {}) {
  if (!term || !root) return;
  for (const el of root.querySelectorAll('[data-path]:not([data-pterm])')) {
    if (base && !/^(\/|~|[A-Za-z]:\\)/.test(el.dataset.path)) el.dataset.path = base.replace(/\/$/, '') + '/' + el.dataset.path.replace(/^\.\//, '');
    el.dataset.pterm = term;
    const known = fileKnown.get(`${term}|${el.dataset.path}`);
    if (known !== undefined) { if (known) makeFileLink(el); continue; }
    if (!fileWait.has(term)) fileWait.set(term, new Set());
    fileWait.get(term).add(el);
  }
  clearTimeout(fileTimer);
  fileTimer = setTimeout(fileFlush, 60);
}
async function fileFlush() {
  const batches = [...fileWait]; fileWait.clear();
  for (const [term, els] of batches) {
    const paths = [...new Set([...els].map((e) => e.dataset.path))].filter((p) => !fileKnown.has(`${term}|${p}`));
    if (paths.length) {
      const r = await api(fvUrl(term, 'check'), { paths }).catch(() => null);
      if (!r) continue;   // the server is restarting: names stay text, and the next drawing asks again
      paths.forEach((p, i) => fileKnown.set(`${term}|${p}`, !!r.ok[i]));
    }
    for (const el of els) if (fileKnown.get(`${term}|${el.dataset.path}`)) makeFileLink(el);
  }
}
function makeFileLink(el) {
  el.classList.add('file-link');
  el.setAttribute('role', 'link');
  el.tabIndex = 0;
  el.title = 'Open ' + el.dataset.path;
}
document.addEventListener('click', (e) => {
  const a = e.target.closest?.('.file-link[data-pterm]');
  if (a) { e.preventDefault(); openFileView(a.dataset.pterm, a.dataset.path); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.classList?.contains('file-link') && e.target.dataset.pterm) { e.preventDefault(); openFileView(e.target.dataset.pterm, e.target.dataset.path); }
});

// ---- files Claude sent you: a card each, pictures previewed
const IMG_EXT = /\.(png|jpe?g|gif|webp|bmp|ico|svg|avif)$/i;
function sentFiles(m) {
  const box = elt('div', 'cm cm-files');
  if (m.caption) box.append(elt('p', 'cf-caption', m.caption));
  const term = chatTermId();
  for (const f of m.files) {
    const card = pathEl('div', 'cf-card', '', f);
    const name = f.split(/[\\/]/).pop();
    if (IMG_EXT.test(f) && term) {
      const img = elt('img', 'cf-img'); img.alt = name; card.append(img);
      fileImage(term, f).then((url) => { if (url) img.src = url; else img.remove(); });
    }
    const row = elt('div', 'cf-row');
    row.append(elt('span', 'cf-name', name), elt('span', 'cf-where', f.includes('/') ? f.slice(0, f.length - name.length) : ''));
    card.append(row);
    box.append(card);
  }
  m.el = box;
  fileLinks(box, { term });
  return box;
}
// A picture as a blob: link, fetched with the header every request needs.
const fileImgs = new Map();   // `${term}|${path}` -> Promise<url | null>
function fileImage(term, path) {
  const k = `${term}|${path}`;
  if (!fileImgs.has(k)) {
    fileImgs.set(k, fetch(fvUrl(term, 'raw'), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Switchboard': '1' }, body: JSON.stringify({ path }) })
      .then((r) => (r.ok ? r.blob() : null)).then((b) => (b ? URL.createObjectURL(b) : null)).catch(() => null));
    if (fileImgs.size > 60) fileImgs.delete(fileImgs.keys().next().value);
  }
  return fileImgs.get(k);
}

// ---- the reader
// Two sources. A session's file: term and path, asked through the session
// (fvUrl). A file Switchboard keeps (a project's files, a file added to a
// note): its own address, `kept`, which serves it (?view, ?download) and
// answers …/view and …/open. `list` is the files beside it, for Previous / Next.
let fileOpen = null;   // { term, path, kept, list, d }
const fileSize = (n) => n < 1024 ? `${n} bytes` : n < 1024 ** 2 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`;
async function openFileView(term, path) {
  fileOpen = { term, path, d: null };
  return drawFileView(path.split(/[\\/]/).pop().replace(/(:\d+)+$|#L\d+$/, ''), () => api(fvUrl(term, 'view'), { path }));
}
// A kept file: kept is its address (/api/projects/<id>/files/<name> or /api/files/<id>).
function openKeptFile(kept, list = null) {
  fileOpen = { kept, list, d: null };
  return drawFileView(decodeURIComponent(kept.split('/').pop()).replace(/^[a-f0-9]{12}--/, ''), () => api(kept + '/view', {}));
}
async function drawFileView(title, ask) {
  const me = fileOpen;
  $('file-name').textContent = title;
  $('file-where').textContent = '';
  $('file-body').textContent = 'Opening…';
  $('file-actions').hidden = true;
  $('file-put').hidden = true; $('file-send').setAttribute('aria-expanded', 'false');
  if (!$('file-scrim').classList.contains('open')) openDialog('file-scrim');
  let d;
  try { d = await ask(); }
  catch (err) { $('file-body').textContent = ''; $('file-body').append(elt('p', 'fv-note', err.message)); return; }
  if (fileOpen !== me) return;
  fileOpen.d = d;
  const { term, kept, list } = me;
  $('file-name').textContent = d.name;
  const away = !kept && d.remote ? termByKey(term) : null;
  $('file-where').textContent = kept ? `${keptWhere(kept)} · ${fileSize(d.size)}`
    : `${away ? `On ${away.deviceName || 'your other computer'}: ` : ''}${d.folder} · ${d.kind === 'folder' ? 'folder' : fileSize(d.size)}`;
  $('file-actions').hidden = false;
  // A file on another computer opens on that computer; here it can be read and its place copied.
  $('file-open').hidden = d.kind === 'folder' || !!away;
  $('file-reveal').hidden = !!away;
  $('file-copy').hidden = !!kept;   // its place is Switchboard's own data folder: Download or Move or copy instead
  const dl = $('file-download');
  dl.hidden = !kept;
  if (kept) { dl.href = kept + '?download'; dl.setAttribute('download', d.name); }
  $('file-copy-it').hidden = !(d.kind === 'image' || d.kind === 'text' || d.kind === 'markdown');
  $('file-copy-it').textContent = d.kind === 'image' ? 'Copy picture' : 'Copy text';
  $('file-send').hidden = !kept;
  const at = list ? list.indexOf(kept) : -1;
  $('file-prev').hidden = $('file-next').hidden = !(list && list.length > 1 && at >= 0);
  const body = $('file-body');
  body.textContent = '';
  if (d.kind === 'markdown') {
    const page = elt('div', 'fv-md cm-agent');
    page.append(chatMd(d.text.replace(/<!--[\s\S]*?-->\n?/g, '')));   // notes to whoever edits it, not for reading
    body.append(page);
    if (!kept) fileLinks(page, { term, base: d.folder });
  } else if (d.kind === 'text') {
    const pre = elt('pre', 'fv-text');
    d.text.split('\n').forEach((l, i) => { const ln = elt('span', 'fv-line', l + '\n'); ln.dataset.n = i + 1; if (d.line === i + 1) ln.classList.add('lit'); pre.append(ln); });
    body.append(pre);
    if (d.line) requestAnimationFrame(() => pre.querySelector('.lit')?.scrollIntoView({ block: 'center' }));
  } else if (d.kind === 'image') {
    const img = elt('img', 'fv-img'); img.alt = d.name; body.append(img);
    const url = kept ? kept + '?view' : await fileImage(term, d.path);
    if (url) img.src = url; else { img.remove(); body.append(elt('p', 'fv-note', d.remote ? 'This picture is too big to send from the other computer. Open it there.' : 'Could not show this picture. Open opens it in your picture viewer.')); }
  } else if (d.kind === 'pdf' && kept) {
    const fr = elt('iframe', 'fv-pdf'); fr.title = d.name; fr.src = kept + '?view'; body.append(fr);
  } else if (d.kind === 'folder') {
    body.append(elt('p', 'fv-note', 'This is a folder. Show in folder opens it in your file manager.'));
  } else {
    body.append(elt('p', 'fv-note', kept ? 'Switchboard can\'t show this kind of file. Open opens it in its own app; Download saves a copy.' : 'This kind of file opens in its own app: press Open. Show in folder picks it out in your file manager.'));
  }
  if (d.cut) body.append(elt('p', 'fv-note', d.remote ? 'This file is long, so only its start came over from the other computer. Open it there for all of it.' : 'This file is long, so only the first megabyte is shown. Open shows all of it.'));
}
// Where a kept file lives, in words: "Acme · Files" or "Added to a note".
function keptWhere(kept) {
  const m = kept.match(/^\/api\/projects\/([^/]+)\/files\//);
  return m ? `${spaceOf(decodeURIComponent(m[1])).name} · Files` : 'Added to a note or session';
}
function fileStep(by) {
  const { list, kept } = fileOpen || {};
  if (!list || list.length < 2) return;
  openKeptFile(list[(list.indexOf(kept) + by + list.length) % list.length], list);
}
async function fileAct(how) {
  if (!fileOpen?.d) return;
  try {
    if (fileOpen.kept) await api(fileOpen.kept + '/open', { how });
    else await api(fvUrl(fileOpen.term, 'open'), { path: fileOpen.d.path, how });
    toast(how === 'reveal' ? 'Opened its folder.' : `Opened ${fileOpen.d.name}.`);
  } catch (err) { toast(err.message, { kind: 'error' }); }
}
$('file-open').addEventListener('click', () => fileAct('open'));
$('file-reveal').addEventListener('click', () => fileAct('reveal'));
$('file-prev').addEventListener('click', () => fileStep(-1));
$('file-next').addEventListener('click', () => fileStep(1));
$('file-scrim').addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select') || !fileOpen?.list) return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); fileStep(-1); }
  if (e.key === 'ArrowRight') { e.preventDefault(); fileStep(1); }
});
$('file-copy').addEventListener('click', () => {
  if (!fileOpen?.d) return;
  navigator.clipboard.writeText(fileOpen.d.path).then(() => toast('Copied where it is.'), () => toast('Could not copy.', { kind: 'error' }));
});
// Move or copy: to any project's Files, into a note (a picture shows in it),
// or to a session (its agent gets the file's place on this computer). Move is
// for a project's own files; a file in a note stays there, taken out by
// editing the note.
$('file-send').addEventListener('click', () => {
  const box = $('file-put'), open = box.hidden;
  box.hidden = !open; $('file-send').setAttribute('aria-expanded', String(open));
  if (!open || !fileOpen?.kept) return;
  const from = fileOpen.kept.match(/^\/api\/projects\/([^/]+)\/files\//), here = from && decodeURIComponent(from[1]);
  const opt = (v, t) => `<option value="${esc(v)}">${esc(t)}</option>`;
  const pages = (S.pages || []).slice().sort((a, b) => b.updated_at - a.updated_at).slice(0, 60);
  const terms = (S.terms || []).filter((t) => t.state !== 'ended');
  $('file-put-to').innerHTML = `<optgroup label="A project's Files">${S.spaces.filter((x) => x.id !== here).map((x) => opt('project:' + x.id, x.name)).join('')}</optgroup>`
    + (pages.length ? `<optgroup label="A note">${pages.map((p) => opt('page:' + p.uid, `${p.title || 'Untitled'} · ${spaceOf(p.space).name}`)).join('')}</optgroup>` : '')
    + (terms.length ? `<optgroup label="A session">${terms.map((t) => opt('term:' + t.id, termLabel(t))).join('')}</optgroup>` : '');
  const sync = () => { const v = $('file-put-to').value; $('file-put-move').hidden = !here || !v.startsWith('project:'); $('file-put-note').textContent = v.startsWith('term:') ? 'The session is told where the file is.' : ''; };
  $('file-put-to').onchange = sync; sync();
  $('file-put-to').focus();
});
$('file-put').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = fileOpen; if (!f?.kept) return;
  const how = e.submitter?.dataset.put || 'copy', v = $('file-put-to').value, [kind, ...rest] = v.split(':'), dest = rest.join(':');
  try {
    if (kind === 'term') {
      const t = (S.terms || []).find((x) => x.id === dest);
      if (!t) throw new Error('That session has ended.');
      await api(termPath(t, 'queue'), { text: `Here is ${f.d.name}: '${f.d.path.replace(/'/g, "'\\''")}'`, source: 'Files' });
      toast(`Sent to ${termLabel(t)}. It goes in when the session is ready.`);
    } else {
      const r = await api('/api/files/put', { from: f.kept, to: kind === 'project' ? { project: dest } : { page: dest }, move: how === 'move' });
      toast(r.project ? `${how === 'move' ? 'Moved' : 'Copied'} to ${spaceOf(r.project).name}'s Files${r.name !== f.d.name ? ' as ' + r.name : ''}.` : `Added to ${r.title}.`);
      if (how === 'move') { closeDialog('file-scrim'); if (typeof loadProjFiles === 'function' && openProject) loadProjFiles(openProject, true); }
      else if (r.project && typeof loadProjFiles === 'function' && openProject === r.project) loadProjFiles(openProject, true);
      await load().catch(() => {});
    }
    $('file-put').hidden = true; $('file-send').setAttribute('aria-expanded', 'false');
  } catch (err) { toast(err.message, { kind: 'error' }); }
});

// Copy picture (as a PNG, the one kind every app takes from the clipboard) or Copy text.
$('file-copy-it').addEventListener('click', async () => {
  const f = fileOpen; if (!f?.d) return;
  try {
    if (f.d.kind !== 'image') { await navigator.clipboard.writeText(f.d.text); return toast('Copied the text.'); }
    const img = $('file-body').querySelector('img');
    if (!img?.complete || !img.naturalWidth) throw new Error('not ready');
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    const png = await new Promise((r) => c.toBlob(r, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    toast('Copied the picture. Paste it anywhere.');
  } catch { toast('Could not copy that. Download it instead.', { kind: 'error' }); }
});

// ---- the same in Terminal view: file names on the screen are links (xterm's
// link provider). Claude's own screen drops the backticks, so a bare name with
// an extension counts too; only names that turn out to be real get underlined.
const TERM_PATH_RE = /(?<![\w/.~-])(?:~|\.{1,2})?\/?(?:[\w@+-][\w.@+-]*\/)*[\w@+-][\w.@+-]*\.[A-Za-z][A-Za-z0-9]{0,7}(?::\d+(?::\d+)?)?(?![\w/])/g;
function termFileLinks(term, termId) {
  return term.registerLinkProvider({
    provideLinks(y, done) {
      const line = term.buffer.active.getLine(y - 1);
      const text = line ? line.translateToString(true) : '';
      const found = [...text.matchAll(TERM_PATH_RE)].filter((m) => looksLikePath(m[0]) && !/^\d/.test(m[0]));
      if (!found.length) return done(undefined);
      const want = [...new Set(found.map((m) => m[0]))].filter((p) => !fileKnown.has(`${termId}|${p}`));
      const finish = () => done(found.filter((m) => fileKnown.get(`${termId}|${m[0]}`)).map((m) => ({
        range: { start: { x: m.index + 1, y }, end: { x: m.index + m[0].length, y } },
        text: m[0],
        decorations: { underline: true, pointerCursor: true },
        activate: (e, path) => openFileView(termId, path)
      })));
      if (!want.length) return finish();
      api(fvUrl(termId, 'check'), { paths: want })
        .then((r) => want.forEach((p, i) => fileKnown.set(`${termId}|${p}`, !!r.ok[i])))
        .catch(() => {}).then(finish);
    }
  });
}
