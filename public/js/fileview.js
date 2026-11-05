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
  const a = e.target.closest?.('.file-link');
  if (a) { e.preventDefault(); openFileView(a.dataset.pterm, a.dataset.path); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.classList?.contains('file-link')) { e.preventDefault(); openFileView(e.target.dataset.pterm, e.target.dataset.path); }
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
let fileOpen = null;   // { term, path, d }
const fileSize = (n) => n < 1024 ? `${n} bytes` : n < 1024 ** 2 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`;
async function openFileView(term, path) {
  fileOpen = { term, path, d: null };
  $('file-name').textContent = path.split(/[\\/]/).pop().replace(/(:\d+)+$|#L\d+$/, '');
  $('file-where').textContent = '';
  $('file-body').textContent = 'Opening…';
  $('file-actions').hidden = true;
  openDialog('file-scrim');
  let d;
  try { d = await api(fvUrl(term, 'view'), { path }); }
  catch (err) { $('file-body').textContent = ''; $('file-body').append(elt('p', 'fv-note', err.message)); return; }
  if (fileOpen?.path !== path) return;
  fileOpen.d = d;
  $('file-name').textContent = d.name;
  const away = d.remote ? termByKey(term) : null;
  $('file-where').textContent = `${away ? `On ${away.deviceName || 'your other computer'}: ` : ''}${d.folder} · ${d.kind === 'folder' ? 'folder' : fileSize(d.size)}`;
  $('file-actions').hidden = false;
  // A file on another computer opens on that computer; here it can be read and its place copied.
  $('file-open').hidden = d.kind === 'folder' || !!away;
  $('file-reveal').hidden = !!away;
  const body = $('file-body');
  body.textContent = '';
  if (d.kind === 'markdown') {
    const page = elt('div', 'fv-md cm-agent');
    page.append(chatMd(d.text.replace(/<!--[\s\S]*?-->\n?/g, '')));   // notes to whoever edits it, not for reading
    body.append(page);
    fileLinks(page, { term, base: d.folder });
  } else if (d.kind === 'text') {
    const pre = elt('pre', 'fv-text');
    d.text.split('\n').forEach((l, i) => { const ln = elt('span', 'fv-line', l + '\n'); ln.dataset.n = i + 1; if (d.line === i + 1) ln.classList.add('lit'); pre.append(ln); });
    body.append(pre);
    if (d.line) requestAnimationFrame(() => pre.querySelector('.lit')?.scrollIntoView({ block: 'center' }));
  } else if (d.kind === 'image') {
    const img = elt('img', 'fv-img'); img.alt = d.name; body.append(img);
    const url = await fileImage(term, d.path);
    if (url) img.src = url; else { img.remove(); body.append(elt('p', 'fv-note', d.remote ? 'This picture is too big to send from the other computer. Open it there.' : 'Could not show this picture. Open opens it in your picture viewer.')); }
  } else if (d.kind === 'folder') {
    body.append(elt('p', 'fv-note', 'This is a folder. Show in folder opens it in your file manager.'));
  } else {
    body.append(elt('p', 'fv-note', 'This kind of file opens in its own app: press Open. Show in folder picks it out in your file manager.'));
  }
  if (d.cut) body.append(elt('p', 'fv-note', d.remote ? 'This file is long, so only its start came over from the other computer. Open it there for all of it.' : 'This file is long, so only the first megabyte is shown. Open shows all of it.'));
}
async function fileAct(how) {
  if (!fileOpen?.d) return;
  try {
    await api(fvUrl(fileOpen.term, 'open'), { path: fileOpen.d.path, how });
    toast(how === 'reveal' ? 'Opened its folder.' : `Opened ${fileOpen.d.name}.`);
  } catch (err) { toast(err.message, { kind: 'error' }); }
}
$('file-open').addEventListener('click', () => fileAct('open'));
$('file-reveal').addEventListener('click', () => fileAct('reveal'));
$('file-copy').addEventListener('click', () => {
  if (!fileOpen?.d) return;
  navigator.clipboard.writeText(fileOpen.d.path).then(() => toast('Copied where it is.'), () => toast('Could not copy.', { kind: 'error' }));
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
