// Google on the web board (public/js/web/connect.js, sync-worker/src/googleconnect.js),
// against a stand-in for Google: the service's exchange hands the tokens back after the #
// and keeps nothing; each hour's access token is renewed through the service; Gmail threads
// arrive in Inbox, open, and get a reply in the same thread on the click; your calendars'
// events come in for Calendar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const { makeConnect } = await import('../public/js/web/connect.js');
const { makeData } = await import('../public/js/web/data.js');
const { googleBefore, googleAfter } = await import('../sync-worker/src/googleconnect.js');
const here = dirname(fileURLToPath(import.meta.url));
const answer = (j, status = 200) => new Response(JSON.stringify(j), { status, headers: { 'Content-Type': 'application/json' } });
const b64 = (s) => Buffer.from(s).toString('base64url');
const sent = [];

// ---- the service's half
const sdb = new DatabaseSync(':memory:');
for (const f of ['schema.sql', 'schema-v2.sql']) sdb.exec(readFileSync(join(here, '../sync-worker', f), 'utf8'));
const stmt = (sql, args = []) => ({ bind: (...a) => stmt(sql, a), first: async () => sdb.prepare(sql).get(...args) ?? null, run: async () => ({ meta: { changes: Number(sdb.prepare(sql).run(...args).changes) } }) });
const env = { DB: { prepare: (sql) => stmt(sql) }, BOARD_URL: 'https://board.example.com', GOOGLE_CONNECT_CLIENT_ID: 'web-id', GOOGLE_CONNECT_CLIENT_SECRET: 'web-secret' };
const json = (b, status = 200) => answer(b, status), bad = (error, status = 400) => answer({ error }, status);

test('the service\'s Google exchange: a one-use ticket, to Google and back to the board, nothing stored', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, o) => {
    if (String(u) === 'https://oauth2.googleapis.com/token') { const b = new URLSearchParams(o.body); sent.push(['token', b.get('grant_type'), b.get('client_secret'), b.get('redirect_uri')]); return b.get('grant_type') === 'refresh_token' ? answer({ access_token: 'g-access-2', expires_in: 3599 }) : answer({ access_token: 'g-access', refresh_token: 'g-refresh', expires_in: 3599, scope: 'openid email gmail.modify' }); }
    return realFetch(u, o);
  };
  try {
    const t = await (await googleAfter({ req: { method: 'POST' }, env, path: '/v1/connect/google/ticket', body: {}, acct: { id: 'a1' }, json, bad, limited: async () => false })).json();
    const go = await googleBefore({ req: { method: 'GET' }, env, url: new URL('https://board.example.com/v1/connect/google/start?ticket=' + t.ticket), bad });
    const to = new URL(go.headers.get('location'));
    assert.equal(to.origin, 'https://accounts.google.com');
    assert.equal(to.searchParams.get('redirect_uri'), 'https://board.example.com/v1/oauth/callback/google/connect');
    assert.equal(to.searchParams.get('access_type'), 'offline');
    assert.match(to.searchParams.get('scope'), /gmail\.modify.*calendar/);
    assert.equal((await googleBefore({ req: { method: 'GET' }, env, url: new URL('https://board.example.com/v1/connect/google/start?ticket=' + t.ticket), bad })).status, 401, 'a ticket works once');
    const back = await googleBefore({ req: { method: 'GET' }, env, url: new URL(`https://board.example.com/v1/oauth/callback/google/connect?state=${to.searchParams.get('state')}&code=xyz`), bad });
    const home = new URL(back.headers.get('location'));
    assert.equal(home.origin + home.pathname, 'https://board.example.com/');
    const h = new URLSearchParams(home.hash.slice(1));
    assert.equal(h.get('gconnect'), 'g-refresh');
    assert.equal(h.get('gaccess'), 'g-access');
    assert.deepEqual(sent.at(-1), ['token', 'authorization_code', 'web-secret', 'https://board.example.com/v1/oauth/callback/google/connect']);
    for (const row of sdb.prepare('SELECT * FROM oauth_states').all()) assert.ok(!JSON.stringify(row).includes('g-refresh'));
    const r = await (await googleAfter({ req: { method: 'POST' }, env, path: '/v1/connect/google/refresh', body: { refresh: 'g-refresh' }, acct: { id: 'a1' }, json, bad, limited: async () => false })).json();
    assert.deepEqual(r, { access: 'g-access-2', expiresIn: 3599 });
  } finally { globalThis.fetch = realFetch; }
});

// ---- the board's half, against a stand-in Google
const msg = (id, from, subject, text, at, extra = {}) => ({ id, internalDate: String(at), labelIds: extra.labels || ['INBOX'], snippet: text.slice(0, 40),
  payload: { mimeType: 'multipart/alternative', headers: [{ name: 'From', value: from }, { name: 'To', value: 'jordan@gmail.example' }, { name: 'Subject', value: subject }, { name: 'Message-ID', value: `<${id}@mail>` }], parts: [{ mimeType: 'text/plain', body: { data: b64(text) } }, { mimeType: 'text/html', body: { data: b64('<p>' + text + '</p>') } }] } });
const thread = { id: 't1', messages: [msg('m1', 'Ana Ruiz <ana@acme.example>', 'Acme contract', 'Can you sign it?', 1000, { labels: ['INBOX', 'UNREAD'] }), msg('m2', 'Jordan <jordan@gmail.example>', 'Re: Acme contract', 'Looking now', 2000)] };
async function fakeGoogle(url, opts = {}) {
  const u = String(url);
  if (u.startsWith('https://openidconnect.googleapis.com/v1/userinfo')) return answer({ email: 'jordan@gmail.example' });
  if (u.includes('/gmail/v1/users/me/threads?')) return answer({ threads: [{ id: 't1' }] });
  if (u.includes('/gmail/v1/users/me/threads/t1')) return answer(thread);
  if (u.includes('/gmail/v1/users/me/messages/send')) { const b = JSON.parse(opts.body); sent.push(['gmail-send', b.threadId, Buffer.from(b.raw, 'base64url').toString()]); return answer({ id: 'm3' }); }
  if (u.includes('/calendar/v3/users/me/calendarList')) return answer({ items: [{ id: 'primary', summary: 'Jordan' }] });
  if (u.includes('/calendar/v3/calendars/primary/events')) return answer({ items: [{ id: 'e1', summary: 'Acme site visit', location: 'Main St', start: { dateTime: '2026-11-10T15:00:00Z' }, end: { dateTime: '2026-11-10T16:00:00Z' }, htmlLink: 'https://calendar.example/e1' }, { id: 'e2', status: 'cancelled', start: { date: '2026-11-11' }, end: { date: '2026-11-12' } }] });
  return answer({ error: { message: 'unexpected ' + u } }, 404);
}
const loc = { origin: 'https://board.example.com', pathname: '/', search: '', hash: '', assign: (u) => { loc.assigned = u; } };
globalThis.history = { replaceState: (a, b, u) => { const x = new URL(u, loc.origin); loc.search = x.search; loc.hash = x.hash; } };
const data = makeData();
data.setSetting('sync', { server: 'https://sync.example.com', token: 't'.repeat(64), email: 'jordan@example.com', key: 'k' });
data.setSetting('rules', [['acme', 'acme']]);
let renewals = 0;
const call = async (server, path) => path === '/v1/providers' ? { status: 200, json: { connect: { google: true } } }
  : path === '/v1/connect/google/ticket' ? { status: 200, json: { ticket: 'b'.repeat(64) } }
  : path === '/v1/connect/google/refresh' ? (renewals++, { status: 200, json: { access: 'g-access-new', expiresIn: 3600 } }) : { status: 404, json: {} };
const cx = makeConnect({ data, call, base: 'https://sync.example.com', fetchFn: fakeGoogle, loc, session: null });

test('Google on the board: connect, Gmail in Inbox, open, reply in the thread, and your calendar', async () => {
  await cx.startGoogle();
  assert.equal(loc.assigned, 'https://sync.example.com/v1/connect/google/start?ticket=' + 'b'.repeat(64));
  loc.hash = '#' + new URLSearchParams({ gconnect: 'g-refresh', gaccess: 'g-access', gexp: '3599' });
  assert.deepEqual(await cx.finish(), { connected: 'Google' });
  assert.equal(loc.hash, '', 'the tokens leave the address bar');
  const g = data.getSetting('webConnections', {}).google;
  assert.equal(g.email, 'jordan@gmail.example');
  assert.equal(g.refresh, 'g-refresh');
  assert.ok(data.docs.settings.read().webConnections.v.google, 'kept in your own account (sealed with your key)');

  const c = await cx.refresh();
  assert.deepEqual(c.threads.map((t) => [t.key, t.kind, t.who, t.subject, t.unread, t.count, t.space]), [['gmail:t1', 'mail', 'Jordan', 'Acme contract', true, 2, 'acme']]);
  assert.deepEqual(c.events.map((e) => [e.title, e.location, e.space, e.calendarName]), [['Acme site visit', 'Main St', 'acme', 'Jordan']], 'cancelled events left out');
  const conv = await cx.conversation('gmail:t1');
  assert.deepEqual(conv.messages.map((m) => [m.from_name, m.text, m.from_me]), [['Ana Ruiz', 'Can you sign it?', 0], ['Jordan', 'Looking now', 1]]);

  assert.equal(await cx.reply('gmail:t1', 'Signed, thanks'), true);
  const [, threadId, raw] = sent.find((x) => x[0] === 'gmail-send');
  assert.equal(threadId, 't1');
  assert.match(raw, /^To: Ana Ruiz <ana@acme\.example>\r\nSubject: Re: Acme contract\r\nIn-Reply-To: <m1@mail>/, 'to whoever wrote last that is not you, in the thread');
  assert.equal(Buffer.from(raw.split('\r\n\r\n')[1], 'base64').toString(), 'Signed, thanks');

  // An hour later the access token is renewed through the service.
  data.setSetting('webConnections', { ...data.getSetting('webConnections', {}), google: { ...g, exp: Date.now() - 1 } });
  await cx.refresh();
  assert.equal(renewals, 1);
  assert.equal(data.getSetting('webConnections', {}).google.access, 'g-access-new');
  assert.equal(cx.status().google.connected, true);
});
