// Books (lib/books.js): an archive.org link to its id, one page of archive.org's
// OCR (hOCR) to words, lines and paragraphs, the running head left out, and the
// sentences read aloud. No network: archive.org itself is not called here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-books-'));
const { bookIdent, parseHocr, parseDjvuPage, splitDjvu, printedNumbers, tidyMeta, sentences, bookPages, addMark, library } = await import('../lib/books.js');
const { db } = await import('../lib/db.js');
const { quick } = await import('../lib/jarvistools.js');

test('an archive.org link, or an id, to the book id', () => {
  assert.equal(bookIdent('https://archive.org/details/prideprejudice0000jane_d3g4'), 'prideprejudice0000jane_d3g4');
  assert.equal(bookIdent('https://archive.org/details/prideprejudice0000jane_d3g4/page/n5/mode/2up'), 'prideprejudice0000jane_d3g4');
  assert.equal(bookIdent('archive.org/stream/abc.def-1/abc_djvu.txt'), 'abc.def-1');
  assert.equal(bookIdent('pride_and_prejudice'), 'pride_and_prejudice');
  assert.equal(bookIdent('not an id at all'), null);
  assert.equal(bookIdent('../../etc'), null);
});

const word = (x, y, t) => `<span class="ocrx_word" id="w" title="bbox ${x} ${y} ${x + 50} ${y + 20}; x_wconf 95">${t}</span>`;
const line = (y, ...ws) => `<span class="ocr_line" id="l" title="bbox 100 ${y} 900 ${y + 20}; baseline 0 -5">${ws.map((t, i) => word(100 + i * 60, y, t)).join('')}</span>`;
const page = `<div class="ocr_page" id="page_000021" title="image &quot;x.jp2&quot;; bbox 0 0 1000 2000; ppageno 0">
  <div class="ocr_carea" title="bbox 100 40 900 60"><p class="ocr_par" title="bbox 100 40 900 60">${line(40, 'e', 'PRIDE', 'AND', 'PREJUDICE', 'xvi')}</p></div>
  <div class="ocr_carea" title="bbox 100 200 900 400"><p class="ocr_par" title="bbox 100 200 900 400">
    ${line(200, 'Mr.', 'Bennet', 'was', 'so', 'odd', 'a', 'mix-')}${line(230, 'ture', 'of', 'quick', 'parts.', 'She', 'was')}${line(260, 'a', 'woman', 'of', 'mean')}</p>
  <p class="ocr_par" title="bbox 100 300 900 330">${line(300, '&#8216;Ah,', 'you', 'do', 'not', 'know', 'what', 'I', 'suffer.&#8217;')}</p></div>
  <div class="ocr_carea" title="bbox 480 1900 520 1920"><p class="ocr_par" title="bbox 480 1900 520 1920">${line(1900, '25')}</p></div></div>`;

test('a page of OCR: words in order with their boxes, lines, paragraphs, the running head and page number left out of reading', () => {
  const p = parseHocr(page);
  assert.equal(p.w, 1000); assert.equal(p.h, 2000);
  assert.equal(p.words[0][4], 'e');
  assert.deepEqual(p.words[1].slice(0, 4), [160, 40, 210, 60]);
  assert.equal(p.words.find((w) => w[4].startsWith('‘'))[4], '‘Ah,');
  const skipped = p.skip.map((i) => p.words[i][4]);
  assert.deepEqual(skipped, ['e', 'PRIDE', 'AND', 'PREJUDICE', 'xvi', '25']);
  assert.equal(p.br.length, 6);
  assert.equal(p.pe.length, 4);
});

test('sentences to read aloud: a word split at a line end is whole, Mr. does not end one, an unfinished one runs on', () => {
  const s = sentences(parseHocr(page));
  assert.deepEqual(s.list.map((x) => x[2]), ['Mr. Bennet was so odd a mixture of quick parts.', 'She was a woman of mean', '‘Ah, you do not know what I suffer.’']);
  assert.equal(s.open, false);
  const cut = sentences({ words: [[0, 0, 1, 1, 'It'], [0, 0, 1, 1, 'was']], br: [1], pe: [1] });   // the page ends mid-sentence
  assert.equal(cut.open, true);
});

const dword = (l, t, text) => `<WORD coords="${l},${t + 20},${l + 50},${t},${t + 18}">${text}</WORD>`;
const djvu = (leaf, ...lines) => `<OBJECT data="file://x.djvu" height="2000" type="image/x.djvu" usemap="a book_${String(leaf).padStart(4, '0')}.djvu" width="1000">
<PARAM name="PAGE" value="a book_${leaf}.djvu"/><HIDDENTEXT><PAGECOLUMN><REGION>${lines.map((ws) => `<PARAGRAPH><LINE>${ws.map((w) => dword(...w)).join('')}</LINE></PARAGRAPH>`).join('')}</REGION></PAGECOLUMN></HIDDENTEXT></OBJECT>`;

test('an older book\'s _djvu.xml: each page by its leaf, boxes turned to left top right bottom, a mixed-case running head with its number left out of reading', () => {
  const xml = `<DjVuXML><BODY>${djvu(38, [[700, 50, 'The'], [760, 50, 'Siren'], [820, 50, '•'], [880, 50, '11']], [[100, 300, 'She'], [160, 300, 'was'], [220, 300, 'here.']])}${djvu(39, [[100, 50, '12'], [160, 50, '•'], [220, 50, 'The'], [280, 50, 'Art']])}</BODY></DjVuXML>`;
  const pages = splitDjvu(xml);
  assert.deepEqual([...pages.keys()], [38, 39]);
  const p = pages.get(38);
  assert.equal(p.w, 1000); assert.equal(p.h, 2000);
  assert.deepEqual(p.words[4], [100, 300, 150, 320, 'She']);
  assert.deepEqual(p.skip.map((i) => p.words[i][4]), ['The', 'Siren', '•', '11']);
  assert.equal(p.num, '11'); assert.equal(pages.get(39).num, '12');
  assert.deepEqual(sentences(p).list.map((x) => x[2]), ['She was here.']);
  assert.equal(parseDjvuPage('').words.length, 0);
});

test('printed page numbers read off the pages: two that agree count, a stray number does not, gaps between agreeing pages fill in', () => {
  assert.deepEqual(printedNumbers(['', '', '3', '4', '', '6', '99', '8', '', '']), ['', '', '3', '4', '5', '6', '7', '8', '', '']);
  assert.deepEqual(printedNumbers(['', '7', '', '', '', '']), ['', '', '', '', '', '']);
});

test('a title that is the web address, and a biography for an author, made readable', () => {
  assert.deepEqual(tidyMeta('the-art-of-seduction-robert-greene', 'the-art-of-seduction-robert-greene', 'Robert Greene, author of The 48 Laws of Power, has a degree in classical literature. He lives in Los Angeles.'), { title: 'The Art of Seduction', author: 'Robert Greene' });
  assert.deepEqual(tidyMeta('x', 'Pride and Prejudice', ['Austen, Jane, 1775-1817', 'Someone']), { title: 'Pride and Prejudice', author: 'Austen, Jane, 1775-1817' });
  assert.equal(tidyMeta('abc_123', '', '').title, 'Abc 123');
});

test('the pages of a book: the hOCR page comes from the scan file, the printed page number from page_numbers', () => {
  const jsia = { data: { brOptions: { data: [[{ width: 10, height: 20, leafNum: 1, uri: 'https://x/BookReaderImages.php?zip=/a_jp2.zip&file=a_jp2/a_0001.jp2&id=a' }], [{ width: 11, height: 21, leafNum: 3, uri: 'https://x/BookReaderImages.php?file=a_jp2/a_0003.jp2' }]] } } };
  assert.deepEqual(bookPages(jsia, { pages: [{ leafNum: 3, pageNumber: '7' }] }), [{ l: 1, w: 10, h: 20, p: '' }, { l: 3, w: 11, h: 21, p: '7' }]);
});

test('marks: a bookmark once a page, a highlight needs its words, colours are the four', () => {
  db.prepare("INSERT INTO books (id, title, author, year, pages, data, added_at) VALUES ('b1', 'A Book', 'Sam', '1900', 3, ?, 1)").run(JSON.stringify({ sub: 'b1', hocr: true, pages: [{ l: 0 }, { l: 1 }, { l: 2 }] }));
  const a = addMark('b1', { kind: 'bookmark', page: 1 }), b = addMark('b1', { kind: 'bookmark', page: 1 });
  assert.equal(a.id, b.id);
  assert.throws(() => addMark('b1', { kind: 'highlight', page: 1 }), /needs the words/);
  assert.throws(() => addMark('b1', { kind: 'bookmark', page: 9 }), /not in the book/);
  const h = addMark('b1', { kind: 'highlight', page: 2, start: 3, end: 5, color: 'orange', quote: 'x', tags: 'Love, love, Plot ' });
  assert.equal(h.color, 'yellow');
  assert.deepEqual(h.tags, ['love', 'plot']);
  assert.equal(library().find((x) => x.id === 'b1').marks, 2);
});

test('Jarvis: continue reading, read to me, stop, where am I', () => {
  assert.deepEqual(quick('continue reading'), ['book', { do: 'open' }]);
  assert.deepEqual(quick('read to me'), ['book', { do: 'read' }]);
  assert.deepEqual(quick('stop reading'), ['book', { do: 'stop' }]);
  assert.deepEqual(quick('where did i leave off'), ['book', { do: 'where' }]);
  assert.deepEqual(quick('keep reading'), ['read_all', {}]);   // still the session read-out
});
