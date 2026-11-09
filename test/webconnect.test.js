// The web board's own connections (public/js/web/connect.js, sync-worker/src/connect.js):
// Microsoft 365 by the browser's own PKCE sign-in and Graph, GitHub through the
// service's one exchange, each against a stand-in for that service. The tokens
// land in the person's own account settings (which sync sealed), never stored by
// the sync service; Teams and Outlook arrive as Inbox conversations; a reply goes
// on the click; GitHub's builds and reviews show.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const { makeConnect } = await import('../public/js/web/connect.js');
const { makeData } = await import('../public/js/web/data.js');
const { connectBefore, connectAfter } = await import('../sync-worker/src/connect.js');
const here = dirname(fileURLToPath(import.meta.url));

// Microsoft and GitHub, as far as the board uses them.
const sent = [];
const answer = (j, status = 200) => new Response(JSON.stringify(j), { status, headers: { 'Content-Type': 'application/json' } });
async function fakeFetch(url, opts = {}) {
  const u = String(url);
  if (u.includes('/oauth2/v2.0/token')) { const b = new URLSearchParams(opts.body); sent.push(['token', b.get('grant_type'), b.get('code_verifier'), b.get('client_id')]); return answer({ access_token: 'ms-access', refresh_token: 'ms-refresh', expires_in: 3600 }); }
  if (u.endsWith('/v1.0/me')) return answer({ id: 'me-1', mail: 'jordan@acme.example', displayName: 'Jordan' });
  if (u.includes('/me/chats?')) return answer({ value: [{ id: 'c1', topic: null, webUrl: 'https://teams.example/c1', lastMessagePreview: { createdDateTime: '2026-11-05T10:00:00Z', from: { user: { id: 'u2', displayName: 'Ana Ruiz' } }, body: { content: '<p>Can we talk?</p>' } } }] });
  if (u.includes('/mailFolders/inbox/messages')) return answer({ value: [{ id: 'm1', subject: 'Acme contract', from: { emailAddress: { name: 'Ana Ruiz', address: 'ana@client.example' } }, receivedDateTime: '2026-11-05T09:00:00Z', bodyPreview: 'Attached', isRead: false }] });
  if (u.includes('/chats/c1/messages') && opts.method === 'POST') { sent.push(['teams-reply', JSON.parse(opts.body).body.content]); return answer({ id: 'n' }, 201); }
  if (u.includes('/chats/c1/messages')) return answer({ value: [{ id: '2', messageType: 'message', from: { user: { id: 'me-1', displayName: 'Jordan' } }, body: { contentType: 'text', content: 'Sure' }, createdDateTime: '2026-11-05T10:05:00Z' }, { id: '1', messageType: 'message', from: { user: { id: 'u2', displayName: 'Ana Ruiz' } }, body: { contentType: 'html', content: '<p>Can we talk?</p>' }, createdDateTime: '2026-11-05T10:00:00Z' }] });
  if (u.includes('/me/sendMail')) { sent.push(['mail', JSON.parse(opts.body).message.toRecipients[0].emailAddress.address]); return new Response(null, { status: 202 }); }
  if (u === 'https://api.github.com/user') return answer({ login: 'jordan-dev' });
  if (u.includes('/user/repos')) return answer([{ full_name: 'jordan-dev/side', name: 'side', pushed_at: new Date().toISOString() }]);
  if (u.includes('/actions/runs')) return answer({ workflow_runs: [{ id: 5, name: 'CI', head_branch: 'main', status: 'completed', conclusion: 'failure', display_title: 'Fix it', html_url: 'https://github.com/jordan-dev/side/actions/runs/5', updated_at: new Date().toISOString() }] });
  if (u.includes('/search/issues')) return answer({ items: [{ id: 9, number: 3, title: 'Please review', repository_url: 'https://api.github.com/repos/acme/core', html_url: 'https://github.com/acme/core/pull/3', user: { login: 'sam' }, updated_at: new Date().toISOString() }] });
  return answer({ error: { message: 'unexpected ' + u } }, 404);
}
const store = new Map();
const session = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
let assigned = null;
const loc = { origin: 'https://board.example.com', pathname: '/', search: '', hash: '', assign: (u) => { assigned = u; } };
globalThis.history = { replaceState: (a, b, u) => { const x = new URL(u, loc.origin); loc.search = x.search; loc.hash = x.hash; } };
const data = makeData();
data.setSetting('sync', { server: 'https://sync.example.com', token: 't'.repeat(64), email: 'jordan@example.com', key: 'k' });
data.setSetting('rules', [['acme', 'acme']]);
const call = async (server, path) => path === '/v1/providers' ? { status: 200, json: { connect: { microsoft: { clientId: 'spa-id', tenant: 'organizations' }, github: true } } } : path === '/v1/connect/github/ticket' ? { status: 200, json: { ticket: 'a'.repeat(64) } } : { status: 404, json: {} };
const cx = makeConnect({ data, call, base: 'https://sync.example.com', fetchFn: fakeFetch, loc, session });

test('Microsoft 365: PKCE from the browser, tokens kept in your own (sealed, synced) settings', async () => {
  await cx.startMicrosoft();
  const u = new URL(assigned);
  assert.equal(u.origin, 'https://login.microsoftonline.com');
  assert.equal(u.searchParams.get('client_id'), 'spa-id');
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://board.example.com/');
  assert.match(u.searchParams.get('scope'), /Chat\.ReadWrite/);
  const want = JSON.parse(session.getItem('sb-ms'));
  loc.search = `?code=abc&state=${u.searchParams.get('state')}`;
  assert.deepEqual(await cx.finish(), { connected: 'Microsoft 365' });
  assert.equal(loc.search, '', 'the address is cleaned');
  assert.deepEqual(sent.find((x) => x[0] === 'token'), ['token', 'authorization_code', want.verifier, 'spa-id']);
  assert.equal(data.getSetting('webConnections', {}).microsoft.email, 'jordan@acme.example');
  assert.ok(data.docs.settings.read().webConnections, 'it travels in your own account (sealed with your key)');
  // A sign-in this browser did not start is refused.
  loc.search = '?code=abc&state=forged';
  assert.match((await cx.finish()).error, /did not start here/);
});

test('Teams and Outlook arrive as Inbox conversations; a conversation opens; a reply goes on the click', async () => {
  const c = await cx.refresh();
  assert.deepEqual(c.threads.map((t) => [t.kind, t.who, t.space]).sort(), [['outlook', 'Ana Ruiz', 'acme'], ['teams', 'Ana Ruiz', 'personal']]);
  const conv = await cx.conversation('teams:c1');
  assert.deepEqual(conv.messages.map((m) => [m.from_name, m.text, m.from_me]), [['Ana Ruiz', 'Can we talk?', 0], ['Jordan', 'Sure', 1]], 'oldest first, the app\'s shape');
  assert.equal(await cx.reply('teams:c1', 'Yes, at 3?'), true);
  assert.deepEqual(sent.find((x) => x[0] === 'teams-reply'), ['teams-reply', 'Yes, at 3?']);
  assert.equal(await cx.sendMail('sam@example.com', 'Hi', 'Join'), 'jordan@acme.example');
});

test('GitHub: the service\'s exchange, the token back after the #, builds and reviews from the browser', async () => {
  await cx.startGithub();
  assert.equal(assigned, `https://sync.example.com/v1/connect/github/start?ticket=${'a'.repeat(64)}`);
  loc.hash = '#ghconnect=gho_secret';
  assert.deepEqual(await cx.finish(), { connected: 'GitHub' });
  assert.equal(loc.hash, '', 'the token leaves the address at once');
  assert.equal(data.getSetting('webConnections', {}).github.login, 'jordan-dev');
  const c = await cx.refresh();
  assert.deepEqual(c.runs.map((r) => [r.fullName, r.state]), [['jordan-dev/side', 'failed']]);
  assert.deepEqual(c.reviews.map((r) => [r.repo, r.number, r.space]), [['acme/core', 3, 'acme']]);
  cx.disconnect('github');
  assert.equal(data.getSetting('webConnections', {}).github, undefined);
});

test('the service\'s GitHub exchange: a one-use ticket, back to the board only, the token never stored', async () => {
  const sdb = new DatabaseSync(':memory:');
  for (const f of ['schema.sql', 'schema-v2.sql']) sdb.exec(readFileSync(join(here, '../sync-worker', f), 'utf8'));
  const stmt = (sql, args = []) => ({ bind: (...a) => stmt(sql, a), first: async () => sdb.prepare(sql).get(...args) ?? null, run: async () => ({ meta: { changes: Number(sdb.prepare(sql).run(...args).changes) } }) });
  const env = { DB: { prepare: (sql) => stmt(sql) }, GITHUB_CLIENT_ID: 'gh-id', GITHUB_CLIENT_SECRET: 'gh-secret', BOARD_URL: 'https://board.example.com' };
  const json = (b, status = 200) => new Response(JSON.stringify(b), { status }), bad = (error, status = 400) => json({ error }, status);
  const t = await (await connectAfter({ req: { method: 'POST' }, env, path: '/v1/connect/github/ticket', acct: { id: 'a-jordan' }, json, bad })).json();
  const start = await connectBefore({ req: { method: 'GET' }, env, url: new URL(`https://sync.example.com/v1/connect/github/start?ticket=${t.ticket}`), bad });
  const to = new URL(start.headers.get('Location'));
  assert.equal(to.origin, 'https://github.com');
  assert.equal(to.searchParams.get('redirect_uri'), 'https://sync.example.com/v1/oauth/callback/github/connect');
  assert.equal((await connectBefore({ req: { method: 'GET' }, env, url: new URL(`https://sync.example.com/v1/connect/github/start?ticket=${t.ticket}`), bad })).status, 401, 'the ticket works once');
  const real = globalThis.fetch;
  globalThis.fetch = async (u, o) => { assert.match(String(o.body), /client_secret=gh-secret/); return new Response(JSON.stringify({ access_token: 'gho_new' })); };
  try {
    const back = await connectBefore({ req: { method: 'GET' }, env, url: new URL(`https://sync.example.com/v1/oauth/callback/github/connect?code=c&state=${to.searchParams.get('state')}`), bad });
    assert.equal(back.headers.get('Location'), 'https://board.example.com/#ghconnect=gho_new');
  } finally { globalThis.fetch = real; }
  const everything = JSON.stringify([...sdb.prepare("SELECT * FROM oauth_states").all(), ...sdb.prepare('SELECT * FROM oauth_codes').all()]);
  assert.ok(!everything.includes('gho_new'), 'not stored');
});

test('a personal Microsoft account turned away for Teams is asked again for mail only, and its mail still comes', async () => {
  await cx.startMicrosoft();
  const state = new URL(assigned).searchParams.get('state');
  loc.search = `?error=invalid_scope&error_description=${encodeURIComponent('AADSTS70000: The provided scope Chat.ReadWrite is not supported for personal accounts')}&state=${state}`;
  assert.deepEqual(await cx.finish(), { pending: true });
  const again = new URL(assigned);
  assert.ok(!/Chat\./.test(again.searchParams.get('scope')) && /Mail\.ReadWrite/.test(again.searchParams.get('scope')), again.searchParams.get('scope'));
  loc.search = `?code=abc&state=${again.searchParams.get('state')}`;
  assert.deepEqual(await cx.finish(), { connected: 'Microsoft 365' });
  assert.doesNotMatch(data.getSetting('webConnections', {}).microsoft.scope, /Chat\./);
  const c = await cx.refresh();
  assert.deepEqual(c.threads.filter((t) => t.kind !== 'mail').map((t) => t.kind), ['outlook'], 'no Teams call for a personal account; Outlook mail still comes');
});
