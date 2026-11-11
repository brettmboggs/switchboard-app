// Books on Inbox, Reading: a library of scanned books from archive.org that are
// free to download (public domain and open access), read on their own page
// scans with a text layer from archive.org's OCR, so words can be highlighted,
// noted and read aloud on the page itself.
//
// What is kept, on this computer only (DATA_DIR/books/<id>/ and two tables):
//   books       one row a book: title, author, its pages (sizes and printed page
//               numbers), where you are, its shelf and tags, the audiobook chosen
//   book_marks  bookmarks, highlights (a run of words on one page) and notes
//   page images and page text as they are first read (and the next few ahead),
//   so a page read once opens offline.
// Borrow-only books (archive.org's lending library) are copy-protected: they are
// refused with a plain message, never fetched.
//
// archive.org, as used here (checked Nov 10 2026):
//   /metadata/<id>                         the item: files, server, page numbers
//   https://<server>/BookReader/BookReaderJSIA.php   every page with its size and leaf
//   /download/<id>/page/n<i>.jpg?scale=2   page i as a picture (scale 1 is full size)
//   <id>_hocr_pageindex.json.gz            byte ranges of each page in <id>_hocr.html,
//                                          so one page's words come with one Range request
//   advancedsearch.php                     search, and LibriVox recordings (collection librivoxaudio)
import { gunzipSync } from 'node:zlib';
import { mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { db, DATA_DIR } from './db.js';

db.exec(`CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, author TEXT, year TEXT, pages INTEGER NOT NULL, data TEXT NOT NULL,
  shelf TEXT NOT NULL DEFAULT 'reading', tags TEXT NOT NULL DEFAULT '[]', page INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL, read_at INTEGER, audio TEXT)`);
db.exec(`CREATE TABLE IF NOT EXISTS book_marks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, book TEXT NOT NULL, page INTEGER NOT NULL, kind TEXT NOT NULL,
  start INTEGER, end INTEGER, color TEXT, quote TEXT, note TEXT, tags TEXT NOT NULL DEFAULT '[]', at INTEGER NOT NULL)`);

const IA = 'https://archive.org';
const UA = { 'user-agent': 'Switchboard (personal reader)' };
const SHELVES = ['reading', 'want', 'finished'];
export const COLORS = ['yellow', 'green', 'blue', 'pink'];
const dir = (id, ...p) => join(DATA_DIR, 'books', id, ...p);
const okId = (id) => /^[A-Za-z0-9][\w.-]{0,99}$/.test(String(id || ''));
const tagList = (t) => [...new Set((Array.isArray(t) ? t : String(t || '').split(',')).map((x) => String(x).trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 30)).filter(Boolean))].slice(0, 12);

// ---------- the pure parts (test/books.test.js)

// An archive.org link or a bare identifier, to the identifier.
export function bookIdent(input) {
  const s = String(input || '').trim();
  const m = s.match(/archive\.org\/(?:details|download|stream|embed)\/([^/?#\s]+)/i);
  const id = m ? decodeURIComponent(m[1]) : s;
  return okId(id) ? id : null;
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const unent = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(parseInt(e[1].toLowerCase() === 'x' ? e.slice(2) : e.slice(1), e[1].toLowerCase() === 'x' ? 16 : 10) || 32) : ENT[e.toLowerCase()] ?? m);
const bbox = (title) => (String(title).match(/bbox (\d+) (\d+) (\d+) (\d+)/) || []).slice(1).map(Number);

// One page of hOCR to its words, in reading order: { w, h, words: [[x0, y0, x1, y1, text]],
// br: last word of each line, pe: last word of each paragraph, skip: words that are
// the running head or the page number (selectable, never read aloud) }.
export function parseHocr(html) {
  const s = String(html || '');
  const [, , w = 0, h = 0] = bbox((s.match(/class=["']ocr_page["'][^>]*title=["']([^"']*)/) || [])[1] || '');
  const words = [], lines = [], pe = [];
  const re = /class=["'](ocr_par|ocr_line|ocrx_word)["'][^>]*?title=["']([^"']*)["'][^>]*>/g;
  let m, line = null;
  while ((m = re.exec(s))) {
    if (m[1] === 'ocr_par') { if (words.length && pe[pe.length - 1] !== words.length - 1) pe.push(words.length - 1); continue; }
    if (m[1] === 'ocr_line') { line = { first: words.length, box: bbox(m[2]) }; lines.push(line); continue; }
    const end = s.indexOf('</span>', re.lastIndex);
    const text = unent(s.slice(re.lastIndex, end < 0 ? undefined : end).replace(/<[^>]*>/g, '')).trim();
    if (!text) continue;
    words.push([...bbox(m[2]), text]);
    if (line) line.last = words.length - 1;
  }
  return pageLayout(w, h, words, lines, pe);
}

// One page of an older book's _djvu.xml (an <OBJECT> with its <WORD coords="left,bottom,right,top">),
// the same shape as parseHocr. Books scanned before about 2020 have this instead of hOCR.
export function parseDjvuPage(xml) {
  const s = String(xml || '');
  const attr = (n) => Number((s.match(new RegExp(`<OBJECT[^>]*\\b${n}="(\\d+)"`)) || [])[1]) || 0;
  const words = [], lines = [], pe = [];
  const re = /<(PARAGRAPH|LINE)\b[^>]*>|<WORD\b[^>]*coords="(\d+),(\d+),(\d+),(\d+)[^"]*"[^>]*>([\s\S]*?)<\/WORD>/g;
  let m, line = null;
  while ((m = re.exec(s))) {
    if (m[1] === 'PARAGRAPH') { if (words.length && pe[pe.length - 1] !== words.length - 1) pe.push(words.length - 1); continue; }
    if (m[1] === 'LINE') { line = { first: words.length, box: [] }; lines.push(line); continue; }
    const text = unent(m[6].replace(/<[^>]*>/g, '')).trim();
    if (!text) continue;
    const [l, b, r, t] = [m[2], m[3], m[4], m[5]].map(Number);
    words.push([l, t, r, b, text]);
    if (line) { line.last = words.length - 1; line.box = line.box.length ? [Math.min(line.box[0], l), Math.min(line.box[1], t), Math.max(line.box[2], r), Math.max(line.box[3], b)] : [l, t, r, b]; }
  }
  return pageLayout(attr('width'), attr('height'), words, lines, pe);
}
// The whole _djvu.xml: leaf number (from usemap="<sub>_0039.djvu") to that page's text.
export function splitDjvu(xml) {
  const out = new Map(), s = String(xml || '');
  let at = s.indexOf('<OBJECT');
  while (at >= 0) {
    const end = s.indexOf('</OBJECT>', at), part = s.slice(at, end < 0 ? undefined : end);
    const leaf = Number((part.match(/usemap="[^"]*?_(\d{4,5})\.djvu"/) || [])[1]);
    if (Number.isFinite(leaf)) out.set(leaf, parseDjvuPage(part));
    at = end < 0 ? -1 : s.indexOf('<OBJECT', end);
  }
  return out;
}

const NUM = /^\W*(\d+|[ivxlc]+)\W*$/i;
// The running head and the page number: { skip: the words never read aloud, num: the number printed on the page }.
function pageLayout(w, h, words, lines, pe) {
  if (words.length && pe[pe.length - 1] !== words.length - 1) pe.push(words.length - 1);
  const real = lines.filter((l) => l.last != null && l.last >= l.first);
  const br = real.map((l) => l.last);
  // The running head (short lines at the very top in capitals, or with the page
  // number at either end: "12 • The Art of Seduction", "The Siren • 11") and a
  // page number alone at the foot. OCR often adds a stray letter: one-letter
  // bits do not count.
  const skip = [];
  let num = '';
  const bits = (t) => t.split(/\s+/).filter((x) => x.replace(/[^\p{L}\p{N}]/gu, '').length >= 2 || /^\d$/.test(x));
  const number = (x) => NUM.test(x);
  const caps = (b) => { const letters = b.filter((x) => !number(x)).join('').replace(/[^\p{L}]/gu, ''); return !letters || letters.replace(/[^\p{Lu}]/gu, '').length >= letters.length * 0.8; };
  for (const l of real) {
    const n = l.last - l.first + 1, b = bits(words.slice(l.first, l.last + 1).map((x) => x[4]).join(' '));
    const top = h && l.box[3] < h * 0.09, foot = h && l.box[1] > h * 0.9;
    const ends = b.length && (number(b[0]) ? b[0] : number(b[b.length - 1]) ? b[b.length - 1] : '');
    if ((top && n <= 10 && (!b.length || caps(b) || ends)) || (foot && n <= 3 && b.every(number))) {
      for (let i = l.first; i <= l.last; i++) skip.push(i);
      const d = (ends || (b.length === 1 && b[0]) || '').replace(/\W/g, '');
      if (!num && /^\d{1,4}$/.test(d)) num = d;
    }
  }
  return { w, h, words, br, pe, skip, num };
}

// Printed page numbers read off the pages themselves, for a book archive.org has none for: a number
// counts when the next or previous numbered page (within 3) agrees with it, and a gap between two
// agreeing runs is filled in. nums[i] is the number found on page i, or ''.
export function printedNumbers(nums) {
  const n = nums.length, out = Array(n).fill(''), off = nums.map((x, i) => (x ? Number(x) - i : null));
  for (let i = 0; i < n; i++) {
    if (off[i] == null) continue;
    let ok = false;
    for (let k = 1; k <= 3 && !ok; k++) ok = off[i + k] === off[i] || off[i - k] === off[i];
    if (ok) out[i] = String(off[i] + i);
  }
  let last = -1;
  for (let i = 0; i < n; i++) {
    if (!out[i]) continue;
    if (last >= 0 && i - last > 1 && Number(out[last]) - last === Number(out[i]) - i) for (let j = last + 1; j < i; j++) out[j] = String(Number(out[last]) + j - last);
    last = i;
  }
  return out.map((x) => (Number(x) > 0 ? x : ''));
}

// archive.org's own title and author, made readable: some uploads have the web address as the title
// ("the-art-of-seduction-robert-greene") and a whole biography as the author.
const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);
export function tidyMeta(id, title, creator) {
  let author = String([].concat(creator || [])[0] || '').replace(/\s+/g, ' ').trim();
  if (author.length > 60) author = author.split(/,|\s+(?:is|was|has|author of|lives)\b/)[0].trim().slice(0, 60);
  let t = String(title || '').replace(/\s+/g, ' ').trim();
  if (!t || t === id || (!/\s/.test(t) && /[-_]/.test(t))) {
    let words = (t || id).replace(/[-_.]+/g, ' ').trim().toLowerCase().split(' ');
    const name = author.toLowerCase().replace(/,.*$/, '').split(/\s+/).filter(Boolean);
    if (name.length && words.slice(-name.length).join(' ') === name.join(' ')) words = words.slice(0, -name.length);
    t = words.map((x, i) => (i && SMALL.has(x) ? x : x.charAt(0).toUpperCase() + x.slice(1))).join(' ');
  }
  return { title: t.slice(0, 300) || id, author: author.slice(0, 200) };
}

// The words of a page as sentences to read aloud: [[first word, last word, text]].
// A word broken at a line end ("pre-" "judice") is read whole; Mr. and Mrs. do not
// end a sentence; a paragraph's end does, unless the next paragraph carries on in lower case. open: the last sentence runs on to the next page.
const ABBR = /^(mr|mrs|ms|dr|st|jr|sr|vs|etc|mt|no|vol|ch|esq|rev|capt|col|gen|lt|messrs|i\.e|e\.g|viz|cf)\.$/i;
export function sentences(p) {
  const skip = new Set(p.skip || []), br = new Set(p.br || []), pe = new Set(p.pe || []);
  const out = [];
  let start = -1, text = '', joinNext = false;
  const close = (i) => { if (start >= 0 && text.trim()) out.push([start, i, text.replace(/\s+/g, ' ').trim()]); start = -1; text = ''; };
  for (let i = 0; i < p.words.length; i++) {
    if (skip.has(i)) continue;
    let t = p.words[i][4];
    if (start < 0) start = i;
    const next = p.words[i + 1]?.[4] || '';
    const broken = br.has(i) && !pe.has(i) && /[a-z]-$/i.test(t) && /^[a-z]/.test(next);
    if (broken) t = t.slice(0, -1);
    text += (joinNext ? '' : ' ') + t;
    joinNext = broken;
    const bare = t.replace(/["'”’)\]]+$/, '');
    // A paragraph ends a sentence when it ends in punctuation or the next starts afresh (a heading such as
    // CHAPTER II); OCR sometimes splits a paragraph mid-sentence, and then the next one starts in lower case.
    if ((/[.!?]$/.test(bare) && !ABBR.test(bare)) || (pe.has(i) && (/[.!?:;"'”’)]$/.test(t) || /^[\p{Lu}\p{N}'"‘“]/u.test(next)))) close(i);
    else if (text.length > 600 && /[,;:]$/.test(t)) close(i);
  }
  const open = start >= 0;
  close(p.words.length - 1);
  return { list: out, open };
}

// A search row from archive.org to what the page shows.
export const searchRow = (d) => ({ id: d.identifier, title: String(d.title || d.identifier).slice(0, 200), author: [].concat(d.creator || [])[0] || '', year: String(d.year || d.date || '').slice(0, 4), pages: Number(d.imagecount) || null });

// The pages of a book from BookReaderJSIA: [{ l: hOCR page (the jp2 file's number), w, h, p: printed page number }].
export function bookPages(jsia, pageNumbers) {
  const br = jsia?.data?.brOptions || {};
  const flat = (br.data || []).flat();
  const label = new Map(((pageNumbers && pageNumbers.pages) || []).map((x) => [x.leafNum, x.pageNumber || '']));
  return flat.map((x) => {
    const file = Number((String(x.uri || '').match(/_(\d{4,5})\.(?:jp2|jpg|tif)/i) || [])[1]);
    return { l: Number.isFinite(file) ? file : x.leafNum, w: x.width, h: x.height, p: label.get(x.leafNum) || '' };
  });
}

// ---------- archive.org
// archive.org now and then leaves a connection hanging or answers 5xx, and a
// name lookup can fail once on a cold cache: up to two more tries.
async function get(url, { json = true, range, max = 25e6, ms = 30000 } = {}, tries = 2) {
  let r;
  try { r = await fetch(url, { headers: { ...UA, ...(range ? { range } : {}) }, signal: AbortSignal.timeout(ms), redirect: 'follow' }); }
  catch (e) { if (tries && /CONNECT_TIMEOUT|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket/i.test(String(e?.cause?.code) + String(e?.cause?.message))) return get(url, { json, range, max, ms }, tries - 1); throw e; }
  if ((r.status >= 500 || (range && r.status === 200)) && tries) { r.body?.cancel().catch(() => {}); return get(url, { json, range, max, ms }, tries - 1); }   // 200 to a Range: that copy sent the whole file
  if (!r.ok && r.status !== 206) throw Object.assign(new Error(`archive.org answered ${r.status}`), { status: r.status });
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > max) throw new Error('archive.org sent more than expected');
  return json ? JSON.parse(buf.toString('utf8')) : buf;
}
const iaError = (e) => {
  if (e?.status === 404) return 'archive.org has no book at that address. Copy the link from the book\'s page again.';
  if (/timeout|abort/i.test(String(e?.name) + String(e?.message))) return 'archive.org took too long to answer. Try again in a minute.';
  if (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONN/i.test(String(e?.message) + String(e?.cause?.code))) return 'Could not reach archive.org. Check that this computer is online.';
  return e?.message || 'archive.org did not answer as expected.';
};

// Free books only: borrow-only (lending library) items are left out.
export async function searchBooks(q) {
  const words = String(q || '').trim().slice(0, 120);
  if (!words) return [];
  const id = bookIdent(words);
  if (id && /archive\.org/i.test(words)) {
    const m = await get(`${IA}/metadata/${encodeURIComponent(id)}`).catch((e) => { throw new Error(iaError(e)); });
    if (!m.metadata) return [];
    return [{ ...searchRow({ identifier: id, ...m.metadata }), free: m.metadata['access-restricted-item'] !== 'true' && m.metadata['access-restricted-item'] !== true }];
  }
  const query = `(${words.replace(/[()":]/g, ' ')}) AND mediatype:texts AND imagecount:[2 TO 5000] AND NOT access-restricted-item:true`;
  const url = `${IA}/advancedsearch.php?q=${encodeURIComponent(query)}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=year&fl[]=date&fl[]=imagecount&sort[]=downloads+desc&rows=20&output=json`;
  const r = await get(url).catch((e) => { throw new Error(iaError(e)); });
  return (r.response?.docs || []).map((d) => ({ ...searchRow(d), free: true }));
}

export async function addBook(input) {
  const id = bookIdent(input);
  if (!id) throw new Error('That is not an archive.org book link. Open the book on archive.org and copy the address (it has /details/ in it).');
  const have = db.prepare('SELECT id FROM books WHERE id = ?').get(id);
  if (have) return bookRow(id);
  let m;
  try { m = await get(`${IA}/metadata/${encodeURIComponent(id)}`); } catch (e) { throw new Error(iaError(e)); }
  const md = m.metadata;
  if (!md) throw new Error('archive.org has no book called that. Copy the link from the book\'s page again.');
  if (md['access-restricted-item'] === 'true' || md['access-restricted-item'] === true) throw new Error('That book is borrow-only on archive.org (a lending library loan), so it is copy-protected and Switchboard cannot keep it. Books with PDF or EPUB under "Download options" work.');
  if (md.mediatype !== 'texts') throw new Error('That archive.org item is not a book (it is listed as ' + (md.mediatype || 'something else') + ').');
  const files = (m.files || []).map((f) => f.name);
  const zip = files.find((f) => /_jp2\.(zip|tar)$/i.test(f));
  if (!zip) throw new Error('That item has no page scans to read (it may be a PDF or EPUB only). Pick a scanned copy of the book.');
  const sub = zip.replace(/_jp2\.(zip|tar)$/i, '');
  const itemPath = m.dir;
  let jsia, err;
  for (const server of [...new Set([m.d1, m.d2, m.server].filter(Boolean))]) {   // the item's two copies: the other answers when one is busy
    try { jsia = await get(`https://${server}/BookReader/BookReaderJSIA.php?id=${encodeURIComponent(id)}&itemPath=${encodeURIComponent(itemPath)}&server=${encodeURIComponent(server)}&format=jsonp&subPrefix=${encodeURIComponent(sub)}`); break; }
    catch (e) { err = e; }
  }
  if (!jsia) throw new Error(iaError(err));
  if (jsia?.data?.data?.isRestricted) throw new Error('That book is borrow-only on archive.org, so Switchboard cannot keep it.');
  const pages = bookPages(jsia, m.page_numbers);
  if (!pages.length) throw new Error('archive.org did not list the pages of that book. Try another copy of it.');
  const hocr = files.includes(`${sub}_hocr.html`) && files.includes(`${sub}_hocr_pageindex.json.gz`);
  const data = { sub, hocr, djvu: !hocr && files.includes(`${sub}_djvu.xml`), rtl: md['page-progression'] === 'rl', start: Math.max(0, pages.findIndex((p) => p.l === Number(jsia.data.brOptions.titleLeaf))), pages };
  const { title, author } = tidyMeta(id, md.title, md.creator);
  db.prepare('INSERT INTO books (id, title, author, year, pages, data, added_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, title, author, String(md.year || md.date || '').slice(0, 4), pages.length, JSON.stringify(data), Date.now());
  mkdirSync(dir(id), { recursive: true });
  return bookRow(id);
}

// ---------- the library
// Books added before titles were tidied (Nov 10 2026): the web address as the title, a biography as the author.
for (const r of db.prepare('SELECT id, title, author FROM books').all()) {
  const t = tidyMeta(r.id, r.title, r.author);
  if (t.title !== r.title || t.author !== (r.author || '')) db.prepare('UPDATE books SET title = ?, author = ? WHERE id = ?').run(t.title, t.author, r.id);
}
const rowOut = (r) => r && ({ id: r.id, title: r.title, author: r.author || '', year: r.year || '', pages: r.pages, page: r.page, shelf: r.shelf, tags: JSON.parse(r.tags || '[]'), addedAt: r.added_at, readAt: r.read_at || null, audio: r.audio ? JSON.parse(r.audio) : null });
function bookRow(id) { return rowOut(db.prepare('SELECT * FROM books WHERE id = ?').get(id)); }
export function library() {
  const marks = new Map(db.prepare("SELECT book, COUNT(*) n FROM book_marks GROUP BY book").all().map((r) => [r.book, r.n]));
  return db.prepare('SELECT * FROM books ORDER BY COALESCE(read_at, added_at) DESC').all().map((r) => {
    const b = rowOut(r), d = JSON.parse(r.data);
    return { ...b, label: d.pages[b.page]?.p || '', marks: marks.get(b.id) || 0 };
  });
}
export function book(id) {
  const r = db.prepare('SELECT * FROM books WHERE id = ?').get(id);
  if (!r) throw new Error('That book is not in your library.');
  const d = JSON.parse(r.data);
  return { ...rowOut(r), ...d, pages: d.pages.length, leaves: d.pages, marks: marks(id) };   // leaves: each page's size and printed number
}
const markOut = (m) => ({ id: m.id, page: m.page, kind: m.kind, start: m.start, end: m.end, color: m.color, quote: m.quote || '', note: m.note || '', tags: JSON.parse(m.tags || '[]'), at: m.at });
const marks = (id) => db.prepare('SELECT * FROM book_marks WHERE book = ? ORDER BY page, COALESCE(start, -1), at').all(id).map(markOut);

export function setProgress(id, page) {
  const b = db.prepare('SELECT pages FROM books WHERE id = ?').get(id);
  if (!b) throw new Error('That book is not in your library.');
  const n = Math.max(0, Math.min(b.pages - 1, Math.round(Number(page) || 0)));
  db.prepare('UPDATE books SET page = ?, read_at = ? WHERE id = ?').run(n, Date.now(), id);
  return n;
}
export function editBook(id, { shelf, tags, title, author }) {
  const b = db.prepare('SELECT id FROM books WHERE id = ?').get(id);
  if (!b) throw new Error('That book is not in your library.');
  if (shelf !== undefined) { if (!SHELVES.includes(shelf)) throw new Error('A shelf is reading, want or finished.'); db.prepare('UPDATE books SET shelf = ? WHERE id = ?').run(shelf, id); }
  if (tags !== undefined) db.prepare('UPDATE books SET tags = ? WHERE id = ?').run(JSON.stringify(tagList(tags)), id);
  if (title) db.prepare('UPDATE books SET title = ? WHERE id = ?').run(String(title).slice(0, 300), id);
  if (author !== undefined) db.prepare('UPDATE books SET author = ? WHERE id = ?').run(String(author).slice(0, 200), id);
  return bookRow(id);
}
export function removeBook(id) {
  db.prepare('DELETE FROM book_marks WHERE book = ?').run(id);
  db.prepare('DELETE FROM books WHERE id = ?').run(id);
  if (okId(id)) rmSync(dir(id), { recursive: true, force: true });
}

// Bookmarks (one a page), highlights and notes (on a run of words, or on the page).
export function addMark(id, m) {
  const b = db.prepare('SELECT pages FROM books WHERE id = ?').get(id);
  if (!b) throw new Error('That book is not in your library.');
  const kind = ['bookmark', 'highlight', 'note'].includes(m.kind) ? m.kind : null;
  if (!kind) throw new Error('A mark is a bookmark, a highlight or a note.');
  const page = Math.round(Number(m.page));
  if (!(page >= 0 && page < b.pages)) throw new Error('That page is not in the book.');
  if (kind === 'bookmark') {
    const had = db.prepare("SELECT id FROM book_marks WHERE book = ? AND page = ? AND kind = 'bookmark'").get(id, page);
    if (had) return markOut(db.prepare('SELECT * FROM book_marks WHERE id = ?').get(had.id));
  }
  const start = Number.isInteger(m.start) && m.start >= 0 ? m.start : null, end = Number.isInteger(m.end) && m.end >= (start ?? 0) ? m.end : start;
  if (kind === 'highlight' && start == null) throw new Error('A highlight needs the words it covers.');
  const color = COLORS.includes(m.color) ? m.color : (kind === 'highlight' ? 'yellow' : null);
  const r = db.prepare('INSERT INTO book_marks (book, page, kind, start, end, color, quote, note, tags, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, page, kind, start, end, color, String(m.quote || '').slice(0, 4000), String(m.note || '').slice(0, 8000), JSON.stringify(tagList(m.tags)), Date.now());
  return markOut(db.prepare('SELECT * FROM book_marks WHERE id = ?').get(r.lastInsertRowid));
}
export function editMark(mid, { note, color, tags }) {
  const m = db.prepare('SELECT * FROM book_marks WHERE id = ?').get(Number(mid));
  if (!m) throw new Error('That highlight or note is gone.');
  if (note !== undefined) db.prepare('UPDATE book_marks SET note = ? WHERE id = ?').run(String(note).slice(0, 8000), m.id);
  if (color !== undefined && COLORS.includes(color)) db.prepare('UPDATE book_marks SET color = ? WHERE id = ?').run(color, m.id);
  if (tags !== undefined) db.prepare('UPDATE book_marks SET tags = ? WHERE id = ?').run(JSON.stringify(tagList(tags)), m.id);
  return markOut(db.prepare('SELECT * FROM book_marks WHERE id = ?').get(m.id));
}
export function removeMark(mid) { db.prepare('DELETE FROM book_marks WHERE id = ?').run(Number(mid)); }

// ---------- pages: a picture and its words, kept once fetched
const pageOf = (id, n) => {
  const r = db.prepare('SELECT data FROM books WHERE id = ?').get(id);
  if (!r) throw Object.assign(new Error('That book is not in your library.'), { status: 404 });
  const d = JSON.parse(r.data), i = Math.round(Number(n));
  if (!(i >= 0 && i < d.pages.length)) throw Object.assign(new Error('That page is not in the book.'), { status: 404 });
  return { d, i, page: d.pages[i] };
};
const inflight = new Map();
const once = (key, fn) => { if (!inflight.has(key)) inflight.set(key, fn().finally(() => inflight.delete(key))); return inflight.get(key); };

export async function pageImage(id, n, big = false) {
  const { i } = pageOf(id, n);
  const f = dir(id, `${big ? 'b' : 'n'}${i}.jpg`);
  if (existsSync(f)) return readFileSync(f);
  return once(f, async () => {
    const buf = await get(`${IA}/download/${encodeURIComponent(id)}/page/n${i}.jpg?scale=${big ? 1 : 2}`, { json: false, max: 8e6 }).catch((e) => { throw new Error(iaError(e)); });
    mkdirSync(dir(id), { recursive: true }); writeFileSync(f, buf);
    return buf;
  });
}
export async function cover(id) {
  const f = dir(id, 'cover.jpg');
  if (existsSync(f)) return readFileSync(f);
  return once(f, async () => {
    const buf = await get(`${IA}/services/img/${encodeURIComponent(id)}`, { json: false, max: 2e6 }).catch((e) => { throw new Error(iaError(e)); });
    mkdirSync(dir(id), { recursive: true }); writeFileSync(f, buf);
    return buf;
  });
}

async function pageIndex(id, d) {
  const f = dir(id, 'pageindex.json');
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  return once(f, async () => {
    const gz = await get(`${IA}/download/${encodeURIComponent(id)}/${encodeURIComponent(d.sub)}_hocr_pageindex.json.gz`, { json: false, max: 5e6 });
    const idx = JSON.parse(gunzipSync(gz).toString('utf8'));
    mkdirSync(dir(id), { recursive: true }); writeFileSync(f, JSON.stringify(idx));
    return idx;
  });
}
export async function pageText(id, n) {
  const { d, i, page } = pageOf(id, n);
  const f = dir(id, `t${i}.json`);
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  if (!d.hocr && d.djvu !== false) { await djvuText(id, d); if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8')); }
  if (!d.hocr) return { w: page.w, h: page.h, words: [], br: [], pe: [], skip: [], said: [], open: false, none: true };
  return once(f, async () => {
    const idx = await pageIndex(id, d).catch((e) => { throw new Error(iaError(e)); });
    const at = idx[page.l];
    let p = { w: page.w, h: page.h, words: [], br: [], pe: [], skip: [] };
    if (at && at[3] > at[2]) {
      const html = (await get(`${IA}/download/${encodeURIComponent(id)}/${encodeURIComponent(d.sub)}_hocr.html`, { json: false, range: `bytes=${at[2]}-${at[3] - 1}`, max: 3e6 }).catch((e) => { throw new Error(iaError(e)); })).toString('utf8');
      p = parseHocr(html);
    }
    const s = sentences(p);
    const out = { ...p, said: s.list, open: s.open };
    mkdirSync(dir(id), { recursive: true }); writeFileSync(f, JSON.stringify(out));
    return out;
  });
}
const save = (id, i, out) => { mkdirSync(dir(id), { recursive: true }); writeFileSync(dir(id, `t${i}.json`), JSON.stringify(out)); };
const textOut = (p) => { const s = sentences(p); return { ...p, said: s.list, open: s.open }; };
// An older book's words come in one file (_djvu.xml, 5 to 30 MB): read once, kept a page a file, and the
// page numbers printed on the pages filled in where archive.org has none.
function djvuText(id, d) {
  return once('djvu:' + id, async () => {
    let xml;
    try { xml = (await get(`${IA}/download/${encodeURIComponent(id)}/${encodeURIComponent(d.sub)}_djvu.xml`, { json: false, max: 120e6, ms: 180e3 })).toString('utf8'); }
    catch (e) {
      if (e.status !== 404) throw new Error(iaError(e));
      xml = '';
    }
    const byLeaf = splitDjvu(xml);
    const r = db.prepare('SELECT data FROM books WHERE id = ?').get(id); if (!r) return;
    const data = JSON.parse(r.data);
    data.pages.forEach((pg, i) => { const p = byLeaf.get(pg.l); save(id, i, textOut(p ? scaleTo(p, pg) : { w: pg.w, h: pg.h, words: [], br: [], pe: [], skip: [] })); });
    if (!data.pages.some((p) => p.p)) { const nums = printedNumbers(data.pages.map((pg) => byLeaf.get(pg.l)?.num || '')); data.pages.forEach((p, i) => { p.p = nums[i]; }); }
    data.djvu = byLeaf.size > 0;
    db.prepare('UPDATE books SET data = ? WHERE id = ?').run(JSON.stringify(data), id);
  });
}
// The text was read off the full scan; the page list may give a different size for the same picture.
const scaleTo = (p, pg) => {
  if (!p.w || !pg.w || (p.w === pg.w && p.h === pg.h)) return p;
  const kx = pg.w / p.w, ky = pg.h / (p.h || pg.h);
  return { ...p, w: pg.w, h: pg.h, words: p.words.map(([a, b, c, e, t]) => [Math.round(a * kx), Math.round(b * ky), Math.round(c * kx), Math.round(e * ky), t]) };
};

// The pages around the one asked for, fetched quietly a few at a time so turning the page is instant
// (the one being looked at is never kept waiting behind them).
const queue = [];
let fetching = 0;
function pump() {
  while (fetching < 2 && queue.length) {
    const job = queue.shift();
    fetching++;
    job().catch(() => {}).finally(() => { fetching--; pump(); });
  }
}
export function prefetch(id, n, { big = false, ahead = 4, behind = 2 } = {}) {
  let d;
  try { d = pageOf(id, n).d; } catch { return; }
  const want = [];
  for (let k = 1; k <= ahead; k++) want.push(n + k);
  for (let k = 1; k <= behind; k++) want.push(n - k);
  queue.length = 0;   // a newer page was asked for: what was queued for the old one can wait
  for (const i of want.filter((x) => x >= 0 && x < d.pages.length)) {
    if (!existsSync(dir(id, `${big ? 'b' : 'n'}${i}.jpg`))) queue.push(() => pageImage(id, i, big));
    if (!existsSync(dir(id, `t${i}.json`))) queue.push(() => pageText(id, i));
  }
  pump();
}

// ---------- audiobooks: a LibriVox recording of the same book, when there is one
export async function findAudiobook(id) {
  const b = bookRow(id);
  if (!b) throw new Error('That book is not in your library.');
  const title = b.title.replace(/[^\p{L}\p{N}\s']/gu, ' ').split(/\s+/).filter((w) => w.length > 2).slice(0, 6).join(' ');
  const surname = (b.author.split(',')[0] || '').replace(/[^\p{L}\s-]/gu, ' ').trim().split(/\s+/).pop() || '';
  const q = `collection:librivoxaudio AND title:(${title})${surname ? ` AND creator:(${surname})` : ''}`;
  const r = await get(`${IA}/advancedsearch.php?q=${encodeURIComponent(q)}&fl[]=identifier&fl[]=title&fl[]=creator&rows=8&output=json`).catch((e) => { throw new Error(iaError(e)); });
  return (r.response?.docs || []).map((x) => ({ id: x.identifier, title: String(x.title || x.identifier), by: [].concat(x.creator || [])[0] || '' }));
}
const clock = (s) => { const p = String(s || '').split(':').map(Number); return p.some((x) => !Number.isFinite(x)) ? 0 : p.reduce((a, x) => a * 60 + x, 0); };
export async function setAudiobook(id, { recording, track, pos }) {
  const b = bookRow(id);
  if (!b) throw new Error('That book is not in your library.');
  if (recording === null) { db.prepare('UPDATE books SET audio = NULL WHERE id = ?').run(id); return null; }
  let a = b.audio;
  if (recording && recording !== a?.id) {
    if (!okId(recording)) throw new Error('That is not a LibriVox recording.');
    const m = await get(`${IA}/metadata/${encodeURIComponent(recording)}`).catch((e) => { throw new Error(iaError(e)); });
    if (![].concat(m.metadata?.collection || []).includes('librivoxaudio')) throw new Error('That is not a LibriVox recording.');
    const tracks = (m.files || []).filter((f) => /_64kb\.mp3$/i.test(f.name)).sort((x, y) => (Number(x.track) || 0) - (Number(y.track) || 0) || x.name.localeCompare(y.name, undefined, { numeric: true }))
      .map((f) => ({ file: f.name, title: String(f.title || f.name.replace(/_64kb\.mp3$/i, '')).slice(0, 120), secs: clock(f.length) || Math.round(Number(f.length) || 0) }));
    if (!tracks.length) throw new Error('That recording has no chapters to play.');
    a = { id: recording, title: String(m.metadata.title || recording), tracks, track: 0, pos: 0 };
  }
  if (!a) throw new Error('Pick a recording first.');
  if (track !== undefined) a.track = Math.max(0, Math.min(a.tracks.length - 1, Math.round(Number(track) || 0)));
  if (pos !== undefined) a.pos = Math.max(0, Math.round(Number(pos) || 0));
  db.prepare('UPDATE books SET audio = ? WHERE id = ?').run(JSON.stringify(a), id);
  return a;
}

// For the board: the shelf, small.
export const booksForBoard = () => library().map((b) => ({ id: b.id, title: b.title, author: b.author, year: b.year, pages: b.pages, page: b.page, label: b.label, shelf: b.shelf, tags: b.tags, readAt: b.readAt, addedAt: b.addedAt, marks: b.marks, audio: b.audio ? { title: b.audio.title, track: b.audio.track, tracks: b.audio.tracks.length } : null }));
