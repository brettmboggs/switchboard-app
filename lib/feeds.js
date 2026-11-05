// News and blogs (RSS and Atom): feeds you follow, quietly, in one list on
// Inbox, Reading. Never a "needs you": reading is for when there is time.
// The list of feeds is a setting (it syncs); the posts are fetched by each
// computer and kept for 30 days, with what has been read.
//
// Safety: only the title, link, date and a short plain-text summary of each
// post are kept; a post's HTML is never shown. Feeds are fetched over http(s)
// only, never from this computer or the local network (a feed address cannot
// be used to make Switchboard read its own API or a router's page), and each
// download stops at 2 MB.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { db, getSetting, setSetting } from './db.js';
import { readCapped } from './calendar.js';
import { friendlyError } from './friendly.js';

db.exec(`CREATE TABLE IF NOT EXISTS feed_items (
  feed TEXT NOT NULL, guid TEXT NOT NULL, title TEXT, link TEXT, summary TEXT, date INTEGER, read_at INTEGER,
  PRIMARY KEY (feed, guid))`);

export const feeds = () => getSetting('feeds', []);   // [{ id, url, name, space, kind? }]; kind 'page': a news page watched for new article links
const saveFeeds = (list) => setSetting('feeds', list);
const KEEP = 30 * 86400e3, MAX = 2 * 1024 * 1024;

// ---- reading the XML (RSS 2.0, RSS 1.0 and Atom), without a parser package
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(parseInt(e[1] === 'x' || e[1] === 'X' ? e.slice(2) : e.slice(1), e[1] === 'x' || e[1] === 'X' ? 16 : 10) || 32) : ENT[e.toLowerCase()] ?? m);
// Text with any markup taken out (twice: feeds often escape their HTML once).
const noCode = (s) => s.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ');
export const plain = (s) => noCode(decode(noCode(decode(String(s || ''))).replace(/<[^>]*>/g, ' '))).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const inner = (xml, name) => { const m = xml.match(new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${name}>`, 'i')); return m ? m[1] : ''; };
const attr = (tag, name) => (tag.match(new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i')) || [])[1] || '';
const okLink = (u, base) => { try { const x = new URL(decode(u).trim(), base); return ['http:', 'https:'].includes(x.protocol) ? x.href : ''; } catch { return ''; } };
const when = (s) => { const t = Date.parse(plain(s)); return Number.isFinite(t) ? t : null; };

export function parseFeed(xml, base) {
  const text = String(xml || '');
  const atom = /<feed[\s>]/i.test(text) && !/<rss[\s>]/i.test(text);
  const head = text.split(/<(?:item|entry)[\s>]/i)[0];
  const title = plain(inner(head, 'title')).slice(0, 120);
  const blocks = [...text.matchAll(atom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi)].map((m) => m[0]);
  const items = blocks.slice(0, 100).map((b) => {
    let link = '';
    if (atom) {
      const links = [...b.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
      const best = links.find((l) => /rel\s*=\s*["']alternate["']/i.test(l)) || links.find((l) => !/rel\s*=/i.test(l)) || links[0] || '';
      link = okLink(attr(best, 'href'), base);
    } else link = okLink(plain(inner(b, 'link')) || attr((b.match(/<link\b[^>]*>/i) || [''])[0], 'href'), base);
    const guid = plain(inner(b, atom ? 'id' : 'guid')) || link || plain(inner(b, 'title'));
    const date = when(inner(b, atom ? 'updated' : 'pubDate') || inner(b, 'published') || inner(b, 'date'));
    const summary = plain(inner(b, atom ? 'summary' : 'description') || inner(b, 'content')).slice(0, 280);
    return { guid: guid.slice(0, 500), title: plain(inner(b, 'title')).slice(0, 300) || '(untitled)', link, date, summary };
  }).filter((i) => i.guid);
  return { title, items };
}

// A web page's own feed, when it names one (<link rel="alternate" type="application/rss+xml">).
export function feedLinkIn(html, base) {
  for (const [tag] of String(html).matchAll(/<link\b[^>]*>/gi)) {
    if (/rel\s*=\s*["']?alternate/i.test(tag) && /type\s*=\s*["']application\/(rss|atom)\+xml/i.test(tag)) {
      const u = okLink(attr(tag, 'href'), base);
      if (u) return u;
    }
  }
  return null;
}

// A news page with no feed (anthropic.com/news is one): its articles are the
// links one level under the page's own path (/news/<article>), each titled by
// the heading inside the link. Links of one or two words ("Announcements",
// "Product") are sections, not articles. Pages carry no dates, so the first
// time an article is seen is its date; the page's order is kept.
export function pageArticles(html, pageUrl) {
  const page = new URL(pageUrl);
  const base = page.pathname.replace(/\/+$/, '') + '/';
  const title = plain(inner(String(html), 'title')).slice(0, 120);
  const seen = new Map();
  for (const m of String(html).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const link = okLink(attr('<a ' + m[1] + '>', 'href'), page.href);
    if (!link) continue;
    const u = new URL(link); u.hash = ''; u.search = '';
    if (u.host !== page.host || !u.pathname.startsWith(base)) continue;
    const rest = u.pathname.slice(base.length).replace(/\/+$/, '');
    if (!rest || rest.includes('/')) continue;
    const head = (m[2].match(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i) || [])[1];
    const t = plain(head || m[2]).slice(0, 300);
    if (t.split(/\s+/).length < 3 || seen.has(u.href)) continue;
    seen.set(u.href, { guid: u.href, title: t, link: u.href, date: null, summary: plain((m[2].match(/<p\b[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || '').slice(0, 280) });
  }
  return { title, items: [...seen.values()].slice(0, 60) };
}

// ---- fetching, never from this computer or the local network
export function privateAddress(ip) {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::' || v.startsWith('fe80') || v.startsWith('fc') || v.startsWith('fd')) return true;
    const m = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); return m ? privateAddress(m[1]) : false;
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}
async function safeUrl(u) {
  let x; try { x = new URL(u); } catch { throw new Error('That is not a web address.'); }
  if (!['http:', 'https:'].includes(x.protocol)) throw new Error('A feed address starts with https:// or http://.');
  const host = x.hostname.replace(/^\[|\]$/g, '');
  if (/^localhost$|\.local(host)?$/i.test(host)) throw new Error('Feeds on this computer or the local network are not read.');
  const ips = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => { throw new Error(`Could not find ${host}. Check the address for a typo, and that this computer is online.`); })).map((r) => r.address);
  if (ips.some(privateAddress)) throw new Error('Feeds on this computer or the local network are not read.');
  return x;
}
async function get(url) {
  let at = url;
  for (let hop = 0; hop < 5; hop++) {
    const u = await safeUrl(at);
    const r = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Switchboard feed reader', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.5' } });
    if ([301, 302, 303, 307, 308].includes(r.status)) { await r.body?.cancel().catch(() => {}); at = new URL(r.headers.get('location') || '', u).href; continue; }
    if (!r.ok) { await r.body?.cancel().catch(() => {}); throw new Error(`The site did not answer (${r.status}).`); }
    return { url: u.href, text: await readCapped(r, MAX) };
  }
  throw new Error('The site kept sending Switchboard elsewhere.');
}
// A feed from an address that is a feed, or a page that names one.
// A feed from an address that is a feed, or a page that names one, or a news
// page with article links. A single post (…/whats-new/2026-w37) usually has
// none of these, so its parent page (…/whats-new) is tried once as well.
async function feedAt(url) {
  let r = await get(url);
  if (/<(rss|feed|rdf:RDF)[\s>]/i.test(r.text)) return { url: r.url, ...parseFeed(r.text, r.url) };
  const link = feedLinkIn(r.text, r.url);
  if (link) {
    r = await get(link);
    if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(r.text)) throw new Error('That feed link did not open a feed.');
    return { url: r.url, ...parseFeed(r.text, r.url) };
  }
  const p = pageArticles(r.text, r.url);
  return p.items.length >= 3 ? { url: r.url, kind: 'page', ...p } : null;
}
export async function findFeed(address) {
  let a = String(address || '').trim();
  if (!/^[a-z]+:\/\//i.test(a)) a = 'https://' + a;
  const found = await feedAt(a);
  if (found) return found;
  const up = new URL(a); up.search = ''; up.hash = '';
  const parts = up.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  if (parts.length) {
    up.pathname = '/' + parts.slice(0, -1).join('/');
    const parent = await feedAt(up.href).catch(() => null);
    if (parent) return parent;
  }
  throw new Error('No feed found there, and no list of articles on that page. Try the site\'s news or blog page, or its RSS link.');
}

// ---- the list
const put = () => db.prepare('INSERT INTO feed_items (feed, guid, title, link, summary, date) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(feed, guid) DO UPDATE SET title = excluded.title, link = excluded.link, summary = excluded.summary');   // a post keeps the date it was first seen
// Posts from the last 30 days, and always a feed's 3 newest: a quiet feed
// (one post a month) still shows its latest when it is followed.
const NEWEST = 3;
export function _store(feedId, items, now = Date.now()) { return store(feedId, items, now); }   // for the tests
function store(feedId, items, now = Date.now()) {
  const ins = put(); let n = 0;
  const newest = new Set(items.filter((i) => i.date).sort((a, b) => b.date - a.date).slice(0, NEWEST).map((i) => i.guid));
  items.forEach((i, k) => { if (i.date && now - i.date > KEEP && !newest.has(i.guid)) return; ins.run(feedId, i.guid, i.title, i.link, i.summary, i.date || now - k * 1000); n++; });
  db.prepare('DELETE FROM feed_items WHERE feed = ? AND date < ? AND guid NOT IN (SELECT guid FROM feed_items WHERE feed = ? ORDER BY date DESC LIMIT ?)').run(feedId, now - KEEP, feedId, NEWEST);
  return n;
}

export async function addFeed(address, space = 'personal') {
  const f = await findFeed(address);
  const list = feeds();
  if (list.some((x) => x.url === f.url)) throw new Error('You already follow that feed.');
  const entry = { id: Math.random().toString(36).slice(2, 10), url: f.url, name: (f.title || new URL(f.url).hostname).slice(0, 80), space, ...(f.kind === 'page' ? { kind: 'page' } : {}) };
  saveFeeds([...list, entry]);
  store(entry.id, f.items);
  status.set(entry.id, { at: Date.now(), ok: true, error: null });
  return entry;
}
export function removeFeed(id) {
  saveFeeds(feeds().filter((f) => f.id !== id));
  db.prepare('DELETE FROM feed_items WHERE feed = ?').run(id);
}
export function editFeed(id, { name, space }) {
  saveFeeds(feeds().map((f) => f.id === id ? { ...f, ...(name ? { name: String(name).slice(0, 80) } : {}), ...(space ? { space: String(space) } : {}) } : f));
}
export function markRead(feed, guid, read = true) {
  db.prepare('UPDATE feed_items SET read_at = ? WHERE feed = ? AND guid = ?').run(read ? Date.now() : null, feed, guid);
}
export function markAllRead(feedIds) {
  const st = db.prepare('UPDATE feed_items SET read_at = ? WHERE feed = ? AND read_at IS NULL');
  for (const id of feedIds) st.run(Date.now(), id);
}

const status = new Map();   // feed id -> { at, ok, error }
export const feedStatus = () => feeds().map((f) => ({ ...f, ...(status.get(f.id) || {}) }));
// For the board: the newest unread posts, with their feed. A post leaves the
// list once it is read (opened, or Mark all read); unread ones go after 30 days.
export function reading(limit = 150) {
  const by = new Map(feeds().map((f) => [f.id, f]));
  return db.prepare('SELECT feed, guid, title, link, summary, date, read_at FROM feed_items WHERE read_at IS NULL ORDER BY date DESC LIMIT ?').all(limit)
    .filter((i) => by.has(i.feed)).map((i) => ({ ...i, key: `${i.feed}:${i.guid}`, feedName: by.get(i.feed).name, space: by.get(i.feed).space || 'personal' }));
}

let busy = false;
export async function pollFeeds() {
  if (busy) return false;
  busy = true;
  let changed = false;
  try {
    for (const f of feeds()) {
      try {
        const r = await get(f.url);
        const { items } = f.kind === 'page' ? pageArticles(r.text, r.url) : parseFeed(r.text, r.url);
        const before = db.prepare('SELECT COUNT(*) AS n FROM feed_items WHERE feed = ?').get(f.id).n;
        store(f.id, items);
        if (db.prepare('SELECT COUNT(*) AS n FROM feed_items WHERE feed = ?').get(f.id).n !== before) changed = true;
        status.set(f.id, { at: Date.now(), ok: true, error: null });
      } catch (e) { status.set(f.id, { at: Date.now(), ok: false, error: friendlyError(e, 'the site') }); }
    }
    return changed;
  } finally { busy = false; }
}
