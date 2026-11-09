// The page an invite link opens on the sync service (sync-worker/src/joinpage.js):
// the same for everyone (the invitation stays after the #, in the browser),
// nothing from anywhere else, and a self-hoster's own download address.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { joinPage } = await import('../sync-worker/src/joinpage.js');

test('the join page: no outside files, a strict policy, Open in Switchboard and the paste way', async () => {
  const r = joinPage({});
  const html = await r.text();
  assert.equal(r.status, 200);
  assert.match(r.headers.get('Content-Security-Policy'), /default-src 'none'/);
  assert.match(r.headers.get('Content-Security-Policy'), /img-src 'none'/);
  assert.equal(r.headers.get('Referrer-Policy'), 'no-referrer');
  assert.ok(!/<(script|link|img)[^>]+src=/i.test(html), 'nothing loaded from anywhere');
  assert.match(html, /Open in Switchboard/);
  assert.match(html, /Have an invite\? Paste the link/);
  assert.match(html, /location\.hash/, 'the invitation is read in the browser');
  assert.match(html, /releases\/latest/);
  assert.ok(!html.includes('%DOWNLOAD%'));
});

test('a self-hosted service can point at its own downloads, and nothing else gets in', async () => {
  assert.match(await joinPage({ DOWNLOAD_URL: 'https://example.com/get' }).text(), /href="https:\/\/example\.com\/get"/);
  assert.ok(!(await joinPage({ DOWNLOAD_URL: 'javascript:alert(1)' }).text()).includes('javascript:'));
  assert.ok(!(await joinPage({ DOWNLOAD_URL: 'https://x.example/"><script>' }).text()).includes('"><script>'));
});
