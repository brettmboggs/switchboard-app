// Books (lib/books.js) and the read-aloud voice (lib/tts.js): the library,
// search and add from archive.org, a page's picture and words, where you are,
// bookmarks, highlights and notes, LibriVox recordings, and speaking a sentence.
import { send, readJson } from '../http.js';
import { searchBooks, addBook, library, book, setProgress, editBook, removeBook, addMark, editMark, removeMark, pageImage, cover, pageText, prefetch, findAudiobook, setAudiobook } from '../books.js';
import { voiceStatus, installVoice, removeVoices, voiceSettings, speak } from '../tts.js';

const picture = (res, buf, type = 'image/jpeg') => {
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': buf.length, 'Cache-Control': 'private, max-age=604800', 'X-Content-Type-Options': 'nosniff' });
  res.end(buf);
};

export async function route({ req, res, path, url, changed }) {
  if (path === '/api/voice' && req.method === 'GET') return send(res, 200, voiceStatus());
  if (path.startsWith('/api/voice/') || path === '/api/tts') {
    if (req.method !== 'POST') return;
    const b = await readJson(req, 64 * 1024);
    try {
      if (path === '/api/tts') {
        const wav = await speak(b.text, b.voice || undefined);
        res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': wav.length, 'Cache-Control': 'no-store' });
        return res.end(wav);
      }
      if (path === '/api/voice/install') { installVoice(String(b.voice || ''), changed); changed(); return send(res, 200, voiceStatus()); }
      if (path === '/api/voice/remove') { removeVoices(); changed(); return send(res, 200, voiceStatus()); }
      if (path === '/api/voice/settings') { const s = voiceSettings(b); changed(); return send(res, 200, s); }
    } catch (e) { return send(res, 400, { error: e.message }); }
    return;
  }
  if (!path.startsWith('/api/books')) return;
  try {
    if (req.method === 'GET') {
      if (path === '/api/books') return send(res, 200, { books: library() });
      if (path === '/api/books/search') return send(res, 200, { results: await searchBooks(url.searchParams.get('q')) });
      let m = path.match(/^\/api\/books\/([\w.-]{1,100})$/);
      if (m) { const r = book(m[1]); pageText(m[1], r.page).catch(() => {}); return send(res, 200, r); }   // the words start coming before the page asks
      if ((m = path.match(/^\/api\/books\/([\w.-]{1,100})\/cover$/))) return picture(res, await cover(m[1]));
      if ((m = path.match(/^\/api\/books\/([\w.-]{1,100})\/page\/(\d{1,5})$/))) { const n = Number(m[2]); const big = url.searchParams.get('big') === '1'; const buf = await pageImage(m[1], n, big); prefetch(m[1], n, { big }); return picture(res, buf); }
      if ((m = path.match(/^\/api\/books\/([\w.-]{1,100})\/text\/(\d{1,5})$/))) return send(res, 200, await pageText(m[1], Number(m[2])));
      if ((m = path.match(/^\/api\/books\/([\w.-]{1,100})\/audiobook$/))) return send(res, 200, { found: await findAudiobook(m[1]) });
      return;
    }
    if (req.method !== 'POST') return;
    const b = await readJson(req, 64 * 1024);
    if (path === '/api/books/add') { const r = await addBook(b.link || b.id); changed(); return send(res, 200, r); }
    let m = path.match(/^\/api\/books\/marks\/(\d{1,12})\/(edit|remove)$/);
    if (m) {
      if (m[2] === 'remove') { removeMark(m[1]); changed(); return send(res, 200, { ok: true }); }
      const r = editMark(m[1], b); changed(); return send(res, 200, r);
    }
    m = path.match(/^\/api\/books\/([\w.-]{1,100})\/(progress|edit|remove|marks|audiobook)$/);
    if (!m) return;
    const [, id, what] = m;
    if (what === 'progress') { const n = setProgress(id, b.page); changed(); return send(res, 200, { page: n }); }
    if (what === 'edit') { const r = editBook(id, b); changed(); return send(res, 200, r); }
    if (what === 'remove') { removeBook(id); changed(); return send(res, 200, { ok: true }); }
    if (what === 'marks') { const r = addMark(id, b); changed(); return send(res, 200, r); }
    if (what === 'audiobook') { const r = await setAudiobook(id, b); changed(); return send(res, 200, { audio: r }); }
  } catch (e) { return send(res, e.status === 404 ? 404 : 400, { error: e.message }); }
}
