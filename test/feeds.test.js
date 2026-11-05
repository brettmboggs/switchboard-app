// News and blogs: RSS and Atom read without a parser package, only plain text
// kept, a site's own feed found, and nothing on this computer or the local
// network fetched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-feeds-'));
const { parseFeed, feedLinkIn, plain, privateAddress, findFeed } = await import('../lib/feeds.js');

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Acme Blog</title><link>https://example.com</link>
  <item><title>Spring &amp; summer</title><link>https://example.com/p/1</link><guid>p1</guid><pubDate>Tue, 03 Nov 2026 10:00:00 GMT</pubDate>
    <description><![CDATA[<p>Hello <script>alert(1)</script><b>world</b></p>]]></description></item>
  <item><title>Second</title><link>javascript:alert(1)</link><description>&lt;img src=x onerror=alert(1)&gt;Plain</description></item>
</channel></rss>`;
const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><title type="text">Sam's notes</title>
  <entry><title>Atom post</title><id>tag:example.com,2026:1</id><updated>2026-11-02T08:00:00Z</updated>
    <link rel="self" href="https://example.com/self"/><link rel="alternate" href="/posts/1"/><summary>Short</summary></entry></feed>`;

test('RSS: title, link, date, plain summary; bad links dropped', () => {
  const f = parseFeed(RSS, 'https://example.com/feed');
  assert.equal(f.title, 'Acme Blog');
  assert.equal(f.items.length, 2);
  assert.deepEqual(f.items[0], { guid: 'p1', title: 'Spring & summer', link: 'https://example.com/p/1', date: Date.parse('2026-11-03T10:00:00Z'), summary: 'Hello world' });
  assert.equal(f.items[1].link, '');
  assert.equal(f.items[1].summary, 'Plain');   // escaped HTML is taken out too
});

test('Atom: the alternate link, made absolute', () => {
  const f = parseFeed(ATOM, 'https://example.com/atom.xml');
  assert.equal(f.title, "Sam's notes");
  assert.equal(f.items[0].link, 'https://example.com/posts/1');
  assert.equal(f.items[0].guid, 'tag:example.com,2026:1');
  assert.equal(f.items[0].date, Date.parse('2026-11-02T08:00:00Z'));
});

test('a page names its feed', () => {
  assert.equal(feedLinkIn('<head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head>', 'https://example.com/blog/'), 'https://example.com/feed.xml');
  assert.equal(feedLinkIn('<link rel="stylesheet" href="/a.css">', 'https://example.com/'), null);
  assert.equal(plain('a &lt;b&gt;bold&lt;/b&gt; &#x263A;'), 'a bold ☺');
});

test('nothing on this computer or the local network', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.1', '172.20.0.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:127.0.0.1', '100.64.0.1']) assert.ok(privateAddress(ip), ip);
  for (const ip of ['93.184.216.34', '1.1.1.1', '2606:4700::1111']) assert.ok(!privateAddress(ip), ip);
  await assert.rejects(() => findFeed('http://127.0.0.1:4747/api/state'), /local network/);
  await assert.rejects(() => findFeed('http://localhost/feed'), /local network/);
  await assert.rejects(() => findFeed('file:///etc/passwd'), /https/);
});

test('a news page with no feed: its article links become posts', async () => {
  const { pageArticles } = await import('../lib/feeds.js');
  const html = `<title>Newsroom \\ Acme</title>
    <a href="/news/product">Product</a><a href="/news/">All news</a><a href="/about">About Acme Corp today</a>
    <a href="/news/spring-launch"><h3>Our spring launch is here</h3><p>Today we ship the thing.</p></a>
    <a href="https://example.com/news/fall-update?ref=x#top"><span><h2>An update for the fall</h2></span></a>
    <a href="/news/spring-launch">Read more about our spring launch</a>
    <a href="/news/2026/deep/path">A post too deep to count</a>
    <a href="https://other.test/news/elsewhere">A post on another site entirely</a>`;
  const r = pageArticles(html, 'https://example.com/news');
  assert.equal(r.title, 'Newsroom \\ Acme');
  assert.deepEqual(r.items.map((i) => [i.title, i.link, i.summary]), [
    ['Our spring launch is here', 'https://example.com/news/spring-launch', 'Today we ship the thing.'],
    ['An update for the fall', 'https://example.com/news/fall-update', '']
  ]);
});

test('a post leaves Reading once read; Mark all read empties it', async () => {
  const { reading, markRead, markAllRead } = await import('../lib/feeds.js');
  const { db, setSetting } = await import('../lib/db.js');
  setSetting('feeds', [{ id: 'f1', url: 'https://example.com/feed', name: 'Acme Blog', space: 'personal' }]);
  const add = db.prepare('INSERT INTO feed_items (feed, guid, title, link, summary, date) VALUES (?, ?, ?, ?, ?, ?)');
  for (const g of ['a', 'b', 'c']) add.run('f1', g, 'Post ' + g, 'https://example.com/' + g, '', Date.now());
  assert.equal(reading().length, 3);
  markRead('f1', 'b');
  assert.deepEqual(reading().map((i) => i.guid).sort(), ['a', 'c']);
  markAllRead(['f1']);
  assert.deepEqual(reading(), []);
});

test('a quiet feed keeps its 3 newest posts, however old', async () => {
  const { parseFeed } = await import('../lib/feeds.js');
  const day = 86400e3, now = Date.now();
  const rss = `<rss><channel><title>Quiet</title>${[90, 60, 45, 120].map((d, i) => `<item><title>Old ${i}</title><link>https://example.com/${i}</link><guid>q${i}</guid><pubDate>${new Date(now - d * day).toUTCString()}</pubDate></item>`).join('')}</channel></rss>`;
  const { items } = parseFeed(rss, 'https://example.com/feed');
  assert.equal(items.length, 4);
  // store() is inside the module: go through the same path a poll takes.
  const mod = await import('../lib/feeds.js');
  const { db, setSetting } = await import('../lib/db.js');
  setSetting('feeds', [{ id: 'quiet', url: 'https://example.com/feed', name: 'Quiet', space: 'personal' }]);
  mod._store('quiet', items, now);
  assert.deepEqual(db.prepare("SELECT guid FROM feed_items WHERE feed = 'quiet' ORDER BY date DESC").all().map((r) => r.guid), ['q2', 'q1', 'q0']);
});
