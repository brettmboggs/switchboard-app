// Forgot password on the sync service (sync-worker/src/reset.js): its routes
// over node:sqlite shaped like D1, with the worker's helpers and the email send
// faked. (The worker's index.js needs Cloudflare's runtime, so it is not loaded.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { resetRoute, resetIssue } = await import('../sync-worker/src/reset.js');
const { createHash, pbkdf2Sync, randomBytes } = await import('node:crypto');
const sha256 = async (t) => createHash('sha256').update(t).digest('hex');
const slowHash = async (auth, salt) => pbkdf2Sync(auth, Buffer.from(salt, 'hex'), 1000, 32, 'sha256').toString('hex');
const rand = (n) => randomBytes(n).toString('hex');
const json = (body, status = 200) => ({ status, json: body });
const helpers = {
  json, bad: (error, status = 400) => json({ error }, status), limited: async () => false, sha256, slowHash, rand,
  issueToken: async (env, id) => { const t = rand(32); env.DB.prepare('INSERT INTO tokens (token_hash, account_id, created_at) VALUES (?, ?, 0)').bind(await sha256(t), id).now(); return t; },
  cleanEmail: (e) => String(e || '').trim().toLowerCase(), validEmail: (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e), boardUrl: 'https://board.example.test'
};
async function signup(env, email) {
  const id = rand(16), authSalt = rand(16), auth = rand(32);
  env.DB.prepare('INSERT INTO accounts (id, email, salt, auth_hash, auth_salt, created_at) VALUES (?, ?, ?, ?, ?, 0)').bind(id, email.toLowerCase(), rand(16), await slowHash(auth, authSalt), authSalt).now();
  return { id, token: await helpers.issueToken(env, id) };
}

function makeEnv(extra = {}) {
  const sdb = new DatabaseSync(':memory:');
  for (const f of ['schema.sql', 'schema-v2.sql', 'schema-v3.sql', 'schema-v5.sql', 'schema-v9.sql']) sdb.exec(readFileSync(join(root, 'sync-worker', f), 'utf8'));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a), first: async () => sdb.prepare(sql).get(...args) ?? null, all: async () => ({ results: sdb.prepare(sql).all(...args) }),
    run: async () => ({ meta: { changes: Number(sdb.prepare(sql).run(...args).changes) } }), now: () => sdb.prepare(sql).run(...args)
  });
  const DB = { prepare: (sql) => stmt(sql), batch: async (list) => { sdb.exec('BEGIN'); try { for (const s of list) s.now(); sdb.exec('COMMIT'); } catch (e) { sdb.exec('ROLLBACK'); throw e; } } };
  return { sdb, env: { DB, RESEND_API_KEY: 're_test', MAIL_FROM: 'Switchboard <reset@example.test>', ...extra } };
}

const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url) === 'https://api.resend.com/emails') { sent.push(JSON.parse(opts.body)); return new Response('{}', { status: 200 }); }
  return realFetch(url, opts);
};

async function post(env, path, body) {
  return resetRoute({ req: { method: 'POST' }, env, path, body, ...helpers });
}
const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
const codeFrom = (mail) => mail.text.match(/Your code: ([0-9A-Z-]+)/)[1];

test('a code by email sets a new password, signs everyone out and clears what the old one locked', async () => {
  const { sdb, env } = makeEnv();
  const email = 'Someone@Example.test';
  const up = await signup(env, email), id = up.id;
  sdb.prepare("INSERT INTO docs (account_id, name, version, body, updated_at) VALUES (?, 'items', 1, 'x', 0)").run(id);
  sdb.prepare("INSERT INTO share_keys (account_id, pub, sign_pub, wrapped, updated_at) VALUES (?, 'p', 's', 'w', 0)").run(id);
  sdb.prepare("INSERT INTO share_members (share_id, account_id, role, status, lock, created_at) VALUES ('a', ?, 'member', 'joined', 'l', 0), ('b', ?, 'owner', 'joined', 'l', 0)").run(id, id);

  sent.length = 0;
  assert.deepEqual((await post(env, '/v1/reset/start', { email })).json, { ok: true });
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].to, ['someone@example.test']);
  const code = codeFrom(sent[0]);

  const salt = hex(16), auth = hex(32);
  const bad = await post(env, '/v1/reset/finish', { email, code: 'AAAA-AAAA-AAAA', salt, auth });
  assert.equal(bad.status, 400);
  const ok = await post(env, '/v1/reset/finish', { email, code: code.toLowerCase(), salt, auth });
  assert.equal(ok.status, 200);
  assert.match(ok.json.token, /^[0-9a-f]{64}$/);

  // Every old sign-in is gone; the new password is the one kept; the code is used up.
  assert.equal(sdb.prepare('SELECT COUNT(*) AS n FROM tokens WHERE token_hash = ?').get(await sha256(up.token)).n, 0);
  const row = sdb.prepare('SELECT salt, auth_hash, auth_salt, fails FROM accounts').get();
  assert.equal(row.salt, salt);
  assert.equal(row.auth_hash, await slowHash(auth, row.auth_salt));
  assert.equal(row.fails, 0);
  assert.equal((await post(env, '/v1/reset/finish', { email, code, salt: hex(16), auth: hex(32) })).status, 400);
  assert.equal(sdb.prepare('SELECT COUNT(*) AS n FROM docs').get().n, 0);
  assert.equal(sdb.prepare('SELECT COUNT(*) AS n FROM share_keys').get().n, 0);
  // Still in both projects: the owner's computer locks them to the new keys.
  assert.deepEqual(sdb.prepare('SELECT share_id FROM share_members ORDER BY share_id').all().map((r) => r.share_id), ['a', 'b']);
});

test('an unknown email gets the same answer and no email; five wrong codes use one up', async () => {
  const { env } = makeEnv();
  sent.length = 0;
  assert.deepEqual((await post(env, '/v1/reset/start', { email: 'nobody@example.test' })).json, { ok: true });
  assert.equal(sent.length, 0);

  const email = 'two@example.test';
  await signup(env, email);
  await post(env, '/v1/reset/start', { email });
  const code = codeFrom(sent.at(-1));
  for (let i = 0; i < 5; i++) assert.equal((await post(env, '/v1/reset/finish', { email, code: 'ZZZZZZZZZZZZ', salt: hex(16), auth: hex(32) })).status, 400);
  assert.equal((await post(env, '/v1/reset/finish', { email, code, salt: hex(16), auth: hex(32) })).status, 400);
});

test('without email set up, asking for an emailed code says where to get one', async () => {
  const { env } = makeEnv({ RESEND_API_KEY: '' });
  const r = await post(env, '/v1/reset/start', { email: 'a@example.test' });
  assert.equal(r.status, 503);
  assert.match(r.json.error, /Reset their password/);
});

test('the owner or an admin of a shared project can make a code for someone in it, and nobody else can', async () => {
  const { sdb, env } = makeEnv({ RESEND_API_KEY: '' });
  const owner = await signup(env, 'owner@example.test'), member = await signup(env, 'member@example.test'), other = await signup(env, 'other@example.test');
  sdb.prepare("INSERT INTO share_members (share_id, account_id, role, status, lock, created_at) VALUES ('s', ?, 'owner', 'joined', 'l', 0), ('s', ?, 'member', 'joined', 'l', 0)").run(owner.id, member.id);
  const issue = (acct, email) => resetIssue({ req: { method: 'POST' }, env, path: '/v1/reset/issue', body: { email }, acct, ...helpers });

  assert.equal((await issue({ id: other.id }, 'member@example.test')).status, 403);
  assert.equal((await issue({ id: member.id }, 'owner@example.test')).status, 403);
  assert.equal((await issue({ id: owner.id }, 'nobody@example.test')).status, 403);
  const r = await issue({ id: owner.id }, 'Member@Example.test');
  assert.equal(r.status, 200);
  assert.match(r.json.code, /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);

  // Email is off here, and says where a code comes from instead.
  assert.match((await post(env, '/v1/reset/start', { email: 'member@example.test' })).json.error, /Settings, Team/);
  const ok = await post(env, '/v1/reset/finish', { email: 'member@example.test', code: r.json.code, salt: hex(16), auth: hex(32) });
  assert.equal(ok.status, 200);
  assert.equal(sdb.prepare('SELECT COUNT(*) AS n FROM share_members').get().n, 2);
});

