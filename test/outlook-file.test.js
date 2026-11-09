// An Outlook attachment is served with the type and name Microsoft lists for
// it, never ones written into the address (review L1). Microsoft is a stand-in here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-outlookfile-'));
const { setSetting } = await import('../lib/db.js');
setSetting('microsoft', { tenant: 'common', clientId: 'test-client', refreshToken: 'test-refresh' });
const MID = 'AAMkAGI2TG93AAA=', FID = 'AAMkAGI2TAttach1=';
globalThis.fetch = async (u) => {
  const s = String(u);
  const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (s.includes('/oauth2/v2.0/token')) return json({ access_token: 'tok', expires_in: 3600 });
  if (s.endsWith('/$value')) return new Response(Buffer.from([0x89, 0x50, 0x4e, 0x47]), { status: 200 });
  if (s.includes('/attachments')) return json({ value: [{ '@odata.type': '#microsoft.graph.fileAttachment', id: FID, name: 'photo.png', contentType: 'image/png', size: 4, isInline: false }] });
  return new Response('{}', { status: 404 });
};
const { route } = await import('../lib/routes/inbox.js');

async function get(path) {
  const url = new URL('http://127.0.0.1' + path);
  let status = 0, headers = {}, body = null;
  const res = { headersSent: false, writableEnded: false, writeHead(s, h) { status = s; headers = h || {}; this.headersSent = true; }, setHeader() {}, end(b) { body = b; this.writableEnded = true; } };
  await route({ req: { method: 'GET' }, res, path: url.pathname, url });
  return { status, headers, body };
}

test('an Outlook file keeps the type and name Microsoft gives it, whatever the address says (review L1)', async () => {
  const r = await get(`/api/outlook/file?m=${encodeURIComponent(MID)}&f=${encodeURIComponent(FID)}&t=text%2Fhtml&n=evil.html`);
  assert.equal(r.status, 200);
  assert.equal(r.headers['Content-Type'], 'image/png', 'shown as the picture it is');
  assert.match(r.headers['Content-Disposition'], /filename="photo\.png"/);
  // A file Microsoft does not list for that message is not served.
  const none = await get(`/api/outlook/file?m=${encodeURIComponent(MID)}&f=${encodeURIComponent('AAMkAGI2TOther99=')}`);
  assert.equal(none.status, 404);
});
