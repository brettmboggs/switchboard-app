// Switchboard sync service. Accounts, device tokens, and encrypted documents.
//
// Every document is encrypted on the user's computer with the account key, which
// this service never sees. Two ways to have one:
//   - email and password: the computer derives an auth key (sent here, stored as
//     a slow hash) and the account key (never sent) from the password;
//   - Sign in with Google, GitHub or Microsoft: this service confirms who it is,
//     the first computer makes a random account key, and later computers get it
//     from one already signed in (pairing) or from the recovery key. The copy kept
//     here is locked with the recovery key, which only the user has.

import { sealForHook } from './hookbox.js';

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const rand = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async (s) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));

async function slowHash(auth, saltHex) {
  const key = await crypto.subtle.importKey('raw', enc.encode(auth), 'PBKDF2', false, ['deriveBits']);
  const salt = Uint8Array.from(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256));
}

function same(a, b) {   // constant-time compare of two hex strings
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const bad = (error, status = 400) => json({ error }, status);
const cleanEmail = (e) => String(e || '').trim().toLowerCase();
const validEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && e.length < 200;
const MAX_DOC = 900 * 1024;

// Push to the phone. The text is fixed here on purpose: a computer only says what
// kind of thing happened, never what it was.
const PUSH_TEXT = { waiting: 'A session needs you.', builds: 'A build failed.' };
const PUSH_GAP = 60e3;          // at most one push per kind per minute per account
const PUSH_TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,80}\]$/;
const MAX_PHONES = 10;

async function issueToken(env, accountId, device) {
  const token = rand(32);
  await env.DB.prepare('INSERT INTO tokens (token_hash, account_id, device, created_at, last_used) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256(token), accountId, String(device || '').slice(0, 80), Date.now(), Date.now()).run();
  return token;
}

// ---- Sign in with a provider. Client ids and secrets are Worker secrets
// (wrangler secret put GOOGLE_CLIENT_ID, ...); a provider without them is not offered.
const PROVIDERS = {
  google: {
    auth: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', scope: 'openid email profile',
    async who(t) { const u = await (await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${t}` } })).json(); return { subject: u.sub, email: u.email, verified: !!u.email_verified }; }
  },
  github: {
    auth: 'https://github.com/login/oauth/authorize', token: 'https://github.com/login/oauth/access_token', scope: 'read:user user:email',
    async who(t) {
      const h = { Authorization: `Bearer ${t}`, 'User-Agent': 'switchboard-sync', Accept: 'application/vnd.github+json' };
      const u = await (await fetch('https://api.github.com/user', { headers: h })).json();
      const emails = await (await fetch('https://api.github.com/user/emails', { headers: h })).json().catch(() => []);
      const main = Array.isArray(emails) ? emails.find((e) => e.primary && e.verified) : null;
      return { subject: String(u.id || ''), email: main?.email || null, verified: !!main };
    }
  },
  microsoft: {
    auth: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token', scope: 'openid email profile',
    // Microsoft does not promise the email is verified, so it is never used to find an account.
    async who(t) { const u = await (await fetch('https://graph.microsoft.com/oidc/userinfo', { headers: { Authorization: `Bearer ${t}` } })).json(); return { subject: u.sub, email: u.email || null, verified: false }; }
  }
};
// The test sign-in exists only for a local copy of the service (wrangler dev);
// it is refused on any public address even if the flag were ever set there.
let localService = false;
const creds = (env, p) => p === 'dev' ? (env.DEV_OAUTH === '1' && localService ? {} : null)
  : (env[`${p.toUpperCase()}_CLIENT_ID`] && env[`${p.toUpperCase()}_CLIENT_SECRET`] ? { id: env[`${p.toUpperCase()}_CLIENT_ID`], secret: env[`${p.toUpperCase()}_CLIENT_SECRET`] } : null);
// Only this computer's own Switchboard may receive a sign-in.
const RETURN_OK = /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}\/auth\/done$/;
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const backTo = (ret, params) => Response.redirect(ret + '?' + new URLSearchParams(params), 302);

// The account for a confirmed identity: the one it signed in to before; else,
// for a verified email, the account with that email; else a new account.
async function accountForIdentity(env, provider, who, linkTo) {
  const known = await env.DB.prepare('SELECT account_id FROM identities WHERE provider = ? AND subject = ?').bind(provider, who.subject).first();
  if (known) return { id: known.account_id, isNew: false };
  const email = cleanEmail(who.email);
  let id = linkTo || null, isNew = false;
  if (!id && who.verified && validEmail(email)) id = (await env.DB.prepare('SELECT id FROM accounts WHERE email = ?').bind(email).first())?.id || null;
  if (!id) {
    const fallback = validEmail(email) ? email : `${provider}-${who.subject}@users.switchboard`;
    if (await env.DB.prepare('SELECT 1 FROM accounts WHERE email = ?').bind(fallback).first()) {
      throw new Error('There is already a Switchboard account with that email. Sign in to it first, then add this sign-in in Settings.');
    }
    id = rand(16); isNew = true;
    await env.DB.prepare("INSERT INTO accounts (id, email, salt, auth_hash, auth_salt, created_at) VALUES (?, ?, ?, '', '', ?)").bind(id, fallback, rand(16), Date.now()).run();
  }
  await env.DB.prepare('INSERT INTO identities (provider, subject, account_id, email, created_at) VALUES (?, ?, ?, ?, ?)').bind(provider, who.subject, id, email || null, Date.now()).run();
  return { id, isNew };
}

// ---- Rate limits: how often one internet address (or one account, or one
// webhook) may try something in a window (ten minutes unless said otherwise).
// Over the limit, it waits; nothing else changes.
//   hook     posts to one webhook, per ten minutes
//   hookday  posts to all of an account's webhooks, per day (keeps D1 writes in the free plan)
//   hookbad  posts to a webhook address that does not exist, per internet address
const LIMITS = { signin: 30, oauth: 40, pair: 12, hook: 30, hookday: 1000, hookbad: 20 };
async function limited(env, kind, who, span = 600e3) {
  const now = Date.now(), win = Math.floor(now / span);
  const key = `${kind}:${who}:${win}`;
  // Stored in ten-minute steps: the step in which this window ends, so old rows can be swept.
  const ends = Math.floor(((win + 1) * span - 1) / 600e3);
  const row = await env.DB.prepare('INSERT INTO rate_limits (key, n, win) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET n = n + 1 RETURNING n').bind(key, ends).first();
  if (Math.random() < 0.02) await env.DB.prepare('DELETE FROM rate_limits WHERE win < ?').bind(Math.floor(now / 600e3) - 1).run();
  return (row?.n || 0) > LIMITS[kind];
}
const slowDown = () => bad('Too many tries. Wait a few minutes and try again.', 429);

async function relayNotice(env, accountId, msg) {
  try { await env.RELAY.get(env.RELAY.idFromName(accountId)).fetch('https://relay/notice', { method: 'POST', body: JSON.stringify(msg) }); } catch {}
}

async function accountFor(req, env) {
  const m = (req.headers.get('Authorization') || '').match(/^Bearer ([0-9a-f]{64})$/);
  if (!m) return null;
  const h = await sha256(m[1]);
  const row = await env.DB.prepare('SELECT account_id, last_used FROM tokens WHERE token_hash = ?').bind(h).first();
  if (!row) return null;
  // At most one write an hour per computer: writes are the scarce part of the free plan.
  if (Date.now() - (row.last_used || 0) > 3600e3) await env.DB.prepare('UPDATE tokens SET last_used = ? WHERE token_hash = ?').bind(Date.now(), h).run();
  return { id: row.account_id, tokenHash: h };
}

// ---- Webhooks in: anything (IFTTT, Zapier, a phone shortcut, a script) posts to
// /v1/in/<secret>. The message is sealed to the webhook's public key at once and
// stored; the account's computers are told over the relay, collect it, open it
// and delete it. This service never reads it: it does not even parse the body.
const MAX_HOOK = 16 * 1024, HOOK_WAITING = 100, HOOK_KEEP = 7 * 86400e3, MAX_HOOKS = 20;
async function hookIn(req, env, url, secret, ip) {
  if (req.method !== 'POST') return bad('Send a POST to this address.', 405);
  const hook = await env.DB.prepare('SELECT id, account_id, pub FROM webhooks WHERE secret_hash = ?').bind(await sha256(secret)).first();
  if (!hook) return (await limited(env, 'hookbad', ip)) ? slowDown() : bad('There is no webhook at this address. Copy the link again from Switchboard.', 404);
  if (await limited(env, 'hook', hook.id)) return slowDown();
  if (await limited(env, 'hookday', hook.account_id, 86400e3)) return bad('This account has had 1,000 webhook messages today. Try again tomorrow.', 429);
  if (Number(req.headers.get('Content-Length') || 0) > MAX_HOOK) return bad('Too large: keep it under 16 KB.', 413);
  const text = await req.text();
  if (new TextEncoder().encode(text).length > MAX_HOOK) return bad('Too large: keep it under 16 KB.', 413);
  const waiting = await env.DB.prepare('SELECT COUNT(*) AS n FROM webhook_inbox WHERE hook_id = ?').bind(hook.id).first();
  if ((waiting?.n || 0) >= HOOK_WAITING) return bad(`${HOOK_WAITING} messages are already waiting for this webhook. Open Switchboard on a computer to collect them.`, 429);
  const blob = await sealForHook(hook.pub, JSON.stringify({ type: (req.headers.get('Content-Type') || '').slice(0, 200), query: url.search.slice(1, 2000), body: text, at: Date.now() }));
  await env.DB.prepare('INSERT INTO webhook_inbox (id, hook_id, account_id, blob, created_at) VALUES (?, ?, ?, ?, ?)').bind(rand(16), hook.id, hook.account_id, blob, Date.now()).run();
  // Nobody collected these in a week: the computers were all gone. Drop them.
  if (Math.random() < 0.05) await env.DB.prepare('DELETE FROM webhook_inbox WHERE created_at < ?').bind(Date.now() - HOOK_KEEP).run();
  await relayNotice(env, hook.account_id, { type: 'hooks' });
  return json({ ok: true }, 202);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;
    localService = /^(127\.0\.0\.1|localhost)$/.test(url.hostname);
    const ip = req.headers.get('CF-Connecting-IP') || 'local';
    // Before the JSON parsing below: a webhook's body is whatever the sender sends.
    const hin = path.match(/^\/v1\/in\/([0-9a-f]{64})$/);
    if (hin) return hookIn(req, env, url, hin[1], ip);
    let body = {};
    if (req.method === 'POST' || req.method === 'PUT') {
      const text = await req.text();
      if (text.length > MAX_DOC + 4096) return bad('Too large.', 413);
      try { body = JSON.parse(text || '{}'); } catch { return bad('Bad JSON.'); }
    }

    if (path === '/' || path === '/v1') return json({ service: 'switchboard-sync', ok: true });
    if (req.method === 'POST' && ['/v1/salt', '/v1/signup', '/v1/login'].includes(path) && await limited(env, 'signin', ip)) return slowDown();
    if ((path === '/v1/oauth/start' || path === '/v1/oauth/redeem' || path.startsWith('/v1/oauth/callback/')) && await limited(env, 'oauth', ip)) return slowDown();

    // The salt for an email, so the client can derive its keys before logging in.
    // Unknown emails get a stable made-up salt, so this does not reveal who has an account.
    if (req.method === 'POST' && path === '/v1/salt') {
      const email = cleanEmail(body.email);
      if (!validEmail(email)) return bad('Enter a valid email.');
      const row = await env.DB.prepare('SELECT salt FROM accounts WHERE email = ?').bind(email).first();
      return json({ salt: row ? row.salt : (await sha256('switchboard-unknown:' + email)).slice(0, 32) });
    }

    if (req.method === 'POST' && path === '/v1/signup') {
      const email = cleanEmail(body.email);
      if (!validEmail(email)) return bad('Enter a valid email.');
      if (!/^[0-9a-f]{32}$/.test(body.salt || '') || !/^[0-9a-f]{64}$/.test(body.auth || '')) return bad('Bad sign-up request.');
      const exists = await env.DB.prepare('SELECT 1 FROM accounts WHERE email = ?').bind(email).first();
      if (exists) return bad('There is already an account for that email. Sign in instead.', 409);
      const id = rand(16), authSalt = rand(16);
      await env.DB.prepare('INSERT INTO accounts (id, email, salt, auth_hash, auth_salt, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(id, email, body.salt, await slowHash(body.auth, authSalt), authSalt, Date.now()).run();
      return json({ token: await issueToken(env, id, body.device) });
    }

    if (req.method === 'POST' && path === '/v1/login') {
      const email = cleanEmail(body.email);
      const row = await env.DB.prepare('SELECT * FROM accounts WHERE email = ?').bind(email).first();
      if (!row || !/^[0-9a-f]{64}$/.test(body.auth || '')) return bad('Wrong email or password.', 401);
      if (row.locked_until && Date.now() < row.locked_until) return bad('Too many wrong passwords. Try again in 15 minutes.', 429);
      if (!same(await slowHash(body.auth, row.auth_salt), row.auth_hash)) {
        const fails = row.fails + 1;
        await env.DB.prepare('UPDATE accounts SET fails = ?, locked_until = ? WHERE id = ?')
          .bind(fails >= 10 ? 0 : fails, fails >= 10 ? Date.now() + 15 * 60e3 : null, row.id).run();
        return bad('Wrong email or password.', 401);
      }
      await env.DB.prepare('UPDATE accounts SET fails = 0, locked_until = NULL WHERE id = ?').bind(row.id).run();
      return json({ token: await issueToken(env, row.id, body.device) });
    }

    // ---- Sign in with a provider
    if (req.method === 'GET' && path === '/v1/providers') {
      return json({ providers: [...Object.keys(PROVIDERS), 'dev'].filter((p) => creds(env, p)) });
    }

    // The browser comes here from the user's Switchboard, goes on to the provider,
    // and is sent back to that Switchboard (only ever 127.0.0.1 or localhost).
    if (req.method === 'GET' && path === '/v1/oauth/start') {
      const provider = url.searchParams.get('provider') || '', ret = url.searchParams.get('return') || '', clientState = url.searchParams.get('state') || '';
      const c = creds(env, provider);
      if (!c) return bad('That sign-in is not available.');
      if (!RETURN_OK.test(ret) || !/^[0-9a-f]{32,64}$/.test(clientState)) return bad('Bad sign-in request.');
      // Adding a sign-in to an account already open on that computer.
      let link = '';
      const ticket = url.searchParams.get('link');
      if (ticket) {
        const t = await env.DB.prepare('SELECT account_id FROM oauth_codes WHERE code_hash = ? AND created_at > ?').bind(await sha256('link:' + ticket), Date.now() - 5 * 60e3).first();
        if (!t) return bad('That link has expired. Try again from Settings.');
        link = t.account_id;
      }
      const state = rand(24), verifier = rand(32);
      await env.DB.prepare('DELETE FROM oauth_states WHERE created_at < ?').bind(Date.now() - 15 * 60e3).run();
      await env.DB.prepare('INSERT INTO oauth_states (state, provider, client_state, return_to, verifier, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(state + (link ? ':' + link : ''), provider, clientState, ret, verifier, Date.now()).run();
      const callback = `${url.origin}/v1/oauth/callback/${provider}`;
      if (provider === 'dev') return Response.redirect(`${callback}?code=${encodeURIComponent(url.searchParams.get('email') || 'dev@example.com')}&state=${state}`, 302);
      const p = PROVIDERS[provider];
      const challenge = b64url(await crypto.subtle.digest('SHA-256', enc.encode(verifier)));
      const q = new URLSearchParams({ client_id: c.id, redirect_uri: callback, response_type: 'code', scope: p.scope, state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account' });
      return Response.redirect(`${p.auth}?${q}`, 302);
    }

    const cb = path.match(/^\/v1\/oauth\/callback\/(google|github|microsoft|dev)$/);
    if (req.method === 'GET' && cb) {
      const provider = cb[1], code = url.searchParams.get('code') || '', state = url.searchParams.get('state') || '';
      const row = await env.DB.prepare("SELECT * FROM oauth_states WHERE (state = ? OR state LIKE ?) AND provider = ? AND created_at > ?").bind(state, state + ':%', provider, Date.now() - 15 * 60e3).first();
      if (!row || !/^[0-9a-f]{48}$/.test(state)) return bad('This sign-in has expired. Start again from Switchboard.');
      await env.DB.prepare('DELETE FROM oauth_states WHERE state = ?').bind(row.state).run();
      const linkTo = row.state.includes(':') ? row.state.split(':')[1] : null;
      if (!code) return backTo(row.return_to, { state: row.client_state, error: url.searchParams.get('error_description') || 'Sign-in was cancelled.' });
      try {
        let who;
        if (provider === 'dev') who = { subject: code, email: code, verified: true };
        else {
          const c = creds(env, provider);
          const t = await (await fetch(PROVIDERS[provider].token, {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
            body: new URLSearchParams({ client_id: c.id, client_secret: c.secret, code, redirect_uri: `${url.origin}/v1/oauth/callback/${provider}`, grant_type: 'authorization_code', code_verifier: row.verifier })
          })).json();
          if (!t.access_token) throw new Error(t.error_description || 'The provider did not confirm the sign-in.');
          who = await PROVIDERS[provider].who(t.access_token);
        }
        if (!who.subject) throw new Error('The provider did not say who you are.');
        const { id, isNew } = await accountForIdentity(env, provider, who, linkTo);
        const one = rand(32);
        await env.DB.prepare('DELETE FROM oauth_codes WHERE created_at < ?').bind(Date.now() - 10 * 60e3).run();
        await env.DB.prepare('INSERT INTO oauth_codes (code_hash, account_id, is_new, email, created_at) VALUES (?, ?, ?, ?, ?)').bind(await sha256(one), id, isNew ? 1 : 0, cleanEmail(who.email) || null, Date.now()).run();
        return backTo(row.return_to, { state: row.client_state, code: one, ...(linkTo ? { linked: '1' } : {}) });
      } catch (e) {
        return backTo(row.return_to, { state: row.client_state, error: String(e.message || e) });
      }
    }

    // The computer trades the one-time code for its own token.
    if (req.method === 'POST' && path === '/v1/oauth/redeem') {
      if (!/^[0-9a-f]{64}$/.test(body.code || '')) return bad('Bad sign-in code.');
      const h = await sha256(body.code);
      const row = await env.DB.prepare('SELECT * FROM oauth_codes WHERE code_hash = ? AND created_at > ?').bind(h, Date.now() - 2 * 60e3).first();
      await env.DB.prepare('DELETE FROM oauth_codes WHERE code_hash = ?').bind(h).run();
      if (!row) return bad('This sign-in has expired. Start again.', 401);
      const acctRow = await env.DB.prepare('SELECT email FROM accounts WHERE id = ?').bind(row.account_id).first();
      return json({ token: await issueToken(env, row.account_id, body.device), email: acctRow?.email || row.email, isNew: !!row.is_new });
    }

    const acct = await accountFor(req, env);
    if (!acct) return bad('Signed out. Sign in again.', 401);

    // ---- Devices: every computer signed in to this account, and removing one.
    if (req.method === 'GET' && path === '/v1/devices') {
      const { results } = await env.DB.prepare('SELECT token_hash, device, created_at, last_used FROM tokens WHERE account_id = ? ORDER BY last_used DESC').bind(acct.id).all();
      return json({ devices: results.map((r) => ({ id: r.token_hash.slice(0, 16), name: r.device || 'A computer', since: r.created_at, lastUsed: r.last_used, me: r.token_hash === acct.tokenHash })) });
    }
    const dm = path.match(/^\/v1\/devices\/([0-9a-f]{16})\/remove$/);
    if (req.method === 'POST' && dm) {
      if (acct.tokenHash.startsWith(dm[1])) return bad('To remove this computer, sign out on it.');
      const gone = await env.DB.prepare('SELECT token_hash, device FROM tokens WHERE account_id = ? AND substr(token_hash, 1, 16) = ?').bind(acct.id, dm[1]).first();
      if (!gone) return bad('That computer is not on this account.', 404);
      await env.DB.prepare('DELETE FROM tokens WHERE token_hash = ?').bind(gone.token_hash).run();
      await env.DB.prepare('DELETE FROM pairings WHERE token_hash = ?').bind(gone.token_hash).run();
      // Cut its live link now, and tell the account's other computers.
      try { await env.RELAY.get(env.RELAY.idFromName(acct.id)).fetch('https://relay/kick', { method: 'POST', body: JSON.stringify({ tokenId: dm[1] }) }); } catch {}
      await relayNotice(env, acct.id, { type: 'devices', removed: gone.device || 'A computer' });
      return json({ ok: true });
    }

    // What this account has: how a new computer can get its key.
    if (req.method === 'GET' && path === '/v1/account') {
      const a = await env.DB.prepare('SELECT email, auth_hash FROM accounts WHERE id = ?').bind(acct.id).first();
      const ids = (await env.DB.prepare('SELECT provider, email FROM identities WHERE account_id = ?').bind(acct.id).all()).results;
      const wrap = await env.DB.prepare("SELECT 1 FROM key_wraps WHERE account_id = ? AND kind = 'recovery'").bind(acct.id).first();
      const docs = await env.DB.prepare('SELECT COUNT(*) AS n FROM docs WHERE account_id = ?').bind(acct.id).first();
      return json({ email: a?.email, hasPassword: !!a?.auth_hash, hasRecovery: !!wrap, hasData: (docs?.n || 0) > 0, identities: ids });
    }

    // A ticket to add another sign-in to this account (used once, five minutes).
    if (req.method === 'POST' && path === '/v1/oauth/link') {
      const ticket = rand(32);
      await env.DB.prepare('INSERT INTO oauth_codes (code_hash, account_id, is_new, email, created_at) VALUES (?, ?, 0, NULL, ?)').bind(await sha256('link:' + ticket), acct.id, Date.now()).run();
      return json({ ticket });
    }

    if (path === '/v1/keys/recovery') {
      if (req.method === 'GET') {
        const w = await env.DB.prepare("SELECT blob FROM key_wraps WHERE account_id = ? AND kind = 'recovery'").bind(acct.id).first();
        return w ? json({ blob: w.blob }) : bad('This account has no recovery key.', 404);
      }
      if (req.method === 'PUT') {
        if (typeof body.blob !== 'string' || body.blob.length > 2000) return bad('Bad recovery key.');
        await env.DB.prepare("INSERT INTO key_wraps (account_id, kind, blob, updated_at) VALUES (?, 'recovery', ?, ?) ON CONFLICT(account_id, kind) DO UPDATE SET blob = excluded.blob, updated_at = excluded.updated_at")
          .bind(acct.id, body.blob, Date.now()).run();
        return json({ ok: true });
      }
    }

    // ---- Pairing: a new computer asks; a computer already signed in approves.
    if (req.method === 'POST' && path === '/v1/pair') {
      if (await limited(env, 'pair', acct.id)) return slowDown();
      if (!/^[A-Za-z0-9+/=]{40,80}$/.test(body.pub || '')) return bad('Bad pairing request.');
      await env.DB.prepare('DELETE FROM pairings WHERE created_at < ?').bind(Date.now() - 15 * 60e3).run();
      const id = rand(12);
      await env.DB.prepare("INSERT INTO pairings (id, account_id, token_hash, name, pub, status, created_at) VALUES (?, ?, ?, ?, ?, 'waiting', ?)")
        .bind(id, acct.id, acct.tokenHash, String(body.name || 'A computer').slice(0, 80), body.pub, Date.now()).run();
      await relayNotice(env, acct.id, { type: 'pair' });
      return json({ id });
    }
    if (req.method === 'GET' && path === '/v1/pair') {
      const { results } = await env.DB.prepare("SELECT id, name, pub, created_at FROM pairings WHERE account_id = ? AND status = 'waiting' AND token_hash != ? AND created_at > ?")
        .bind(acct.id, acct.tokenHash, Date.now() - 10 * 60e3).all();
      return json({ requests: results });
    }
    const pm = path.match(/^\/v1\/pair\/([0-9a-f]{24})$/);
    if (pm && req.method === 'GET') {
      const r = await env.DB.prepare('SELECT status, pub2, box FROM pairings WHERE id = ? AND account_id = ? AND token_hash = ?').bind(pm[1], acct.id, acct.tokenHash).first();
      return r ? json(r) : bad('Not found.', 404);
    }
    if (pm && req.method === 'POST') {
      const r = await env.DB.prepare("SELECT token_hash FROM pairings WHERE id = ? AND account_id = ? AND status = 'waiting'").bind(pm[1], acct.id).first();
      if (!r || r.token_hash === acct.tokenHash) return bad('That request is gone.', 404);
      if (body.approve) {
        if (typeof body.box !== 'string' || body.box.length > 2000 || !/^[A-Za-z0-9+/=]{40,80}$/.test(body.pub2 || '')) return bad('Bad approval.');
        await env.DB.prepare("UPDATE pairings SET status = 'approved', pub2 = ?, box = ? WHERE id = ?").bind(body.pub2, body.box, pm[1]).run();
      } else {
        await env.DB.prepare("UPDATE pairings SET status = 'denied' WHERE id = ?").bind(pm[1]).run();
      }
      await relayNotice(env, acct.id, { type: 'pair' });
      return json({ ok: true });
    }

    // Live link between this account's computers.
    if (path === '/v1/relay') {
      if (req.headers.get('Upgrade') !== 'websocket') return bad('Expected a WebSocket.', 426);
      const stub = env.RELAY.get(env.RELAY.idFromName(acct.id));
      // Tag the connection with which signed-in computer it is, so removing that
      // computer can close it. Set here, never taken from the client.
      const headers = new Headers(req.headers);
      headers.set('X-Token-Id', acct.tokenHash.slice(0, 16));
      return stub.fetch(new Request(req.url, { method: req.method, headers }));
    }

    // A phone gives its push token (or takes it back).
    if (req.method === 'POST' && path === '/v1/push/register') {
      const token = String(body.token || '');
      if (!PUSH_TOKEN.test(token)) return bad('Bad push token.');
      const others = await env.DB.prepare('SELECT COUNT(*) AS n FROM push_tokens WHERE account_id = ? AND token != ?').bind(acct.id, token).first();
      if (others.n >= MAX_PHONES) return bad('Too many phones on this account.', 409);
      await env.DB.prepare('INSERT INTO push_tokens (token, account_id, device, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(token) DO UPDATE SET account_id = excluded.account_id, device = excluded.device')
        .bind(token, acct.id, String(body.device || '').slice(0, 80), Date.now()).run();
      return json({ ok: true });
    }
    if (req.method === 'POST' && path === '/v1/push/unregister') {
      await env.DB.prepare('DELETE FROM push_tokens WHERE token = ? AND account_id = ?').bind(String(body.token || ''), acct.id).run();
      return json({ ok: true });
    }

    // A computer says something needs the user; ping every phone on the account.
    if (req.method === 'POST' && path === '/v1/push') {
      const kind = String(body.kind || '');
      if (!PUSH_TEXT[kind]) return bad('Unknown kind.');
      const now = Date.now();
      // Claim the slot first: only the first caller in each minute goes on to send.
      const claim = await env.DB.prepare('INSERT INTO push_sent (account_id, kind, at) VALUES (?, ?, ?) ON CONFLICT(account_id, kind) DO UPDATE SET at = excluded.at WHERE push_sent.at <= ?')
        .bind(acct.id, kind, now, now - PUSH_GAP).run();
      if (!claim.meta.changes) return json({ sent: 0, throttled: true });
      const { results } = await env.DB.prepare('SELECT token FROM push_tokens WHERE account_id = ?').bind(acct.id).all();
      if (!results.length) return json({ sent: 0 });
      let tickets = [];
      try {
        const res = await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(results.map((r) => ({ to: r.token, title: 'Switchboard', body: PUSH_TEXT[kind], sound: 'default', data: { kind } })))
        });
        tickets = ((await res.json().catch(() => ({}))).data) || [];
      } catch { return json({ sent: 0, error: 'Could not reach the push service.' }); }
      // A phone that uninstalled the app or turned notifications off: stop pinging it.
      const dead = results.filter((r, i) => tickets[i]?.details?.error === 'DeviceNotRegistered');
      for (const r of dead) await env.DB.prepare('DELETE FROM push_tokens WHERE token = ?').bind(r.token).run();
      return json({ sent: results.length - dead.length });
    }

    if (req.method === 'POST' && path === '/v1/logout') {
      await env.DB.prepare('DELETE FROM tokens WHERE token_hash = ?').bind(acct.tokenHash).run();
      return json({ ok: true });
    }

    // ---- Webhooks: the account's computers register each one (a hash of its
    // secret and its public key), collect what arrived, and delete it.
    if (req.method === 'GET' && path === '/v1/webhooks') {
      const { results } = await env.DB.prepare('SELECT id, created_at FROM webhooks WHERE account_id = ?').bind(acct.id).all();
      return json({ hooks: results });
    }
    if (req.method === 'GET' && path === '/v1/webhooks/inbox') {
      const { results } = await env.DB.prepare('SELECT id, hook_id, blob, created_at FROM webhook_inbox WHERE account_id = ? ORDER BY created_at LIMIT 200').bind(acct.id).all();
      return json({ messages: results });
    }
    if (req.method === 'POST' && path === '/v1/webhooks/inbox/delete') {
      const ids = (Array.isArray(body.ids) ? body.ids : []).filter((x) => /^[0-9a-f]{32}$/.test(x)).slice(0, 200);
      if (ids.length) {
        const del = env.DB.prepare('DELETE FROM webhook_inbox WHERE id = ? AND account_id = ?');
        await env.DB.batch(ids.map((id) => del.bind(id, acct.id)));
      }
      return json({ ok: true, deleted: ids.length });
    }
    const wm = path.match(/^\/v1\/webhooks\/([0-9a-f]{32})(\/remove)?$/);
    if (wm && req.method === 'PUT' && !wm[2]) {
      if (!/^[0-9a-f]{64}$/.test(body.hash || '') || !/^[A-Za-z0-9+/]{43}=$/.test(body.pub || '')) return bad('Bad webhook.');
      const cur = await env.DB.prepare('SELECT account_id FROM webhooks WHERE id = ?').bind(wm[1]).first();
      if (cur && cur.account_id !== acct.id) return bad('That webhook belongs to another account.', 409);
      if (!cur) {
        const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM webhooks WHERE account_id = ?').bind(acct.id).first();
        if ((n?.n || 0) >= MAX_HOOKS) return bad(`An account can have ${MAX_HOOKS} webhooks. Remove one first.`, 409);
      }
      try {
        await env.DB.prepare('INSERT INTO webhooks (id, account_id, secret_hash, pub, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET secret_hash = excluded.secret_hash, pub = excluded.pub')
          .bind(wm[1], acct.id, body.hash, body.pub, Date.now()).run();
      } catch { return bad('That link is already in use. Make a new one.', 409); }
      return json({ ok: true });
    }
    if (wm && req.method === 'POST' && wm[2]) {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM webhooks WHERE id = ? AND account_id = ?').bind(wm[1], acct.id),
        env.DB.prepare('DELETE FROM webhook_inbox WHERE hook_id = ? AND account_id = ?').bind(wm[1], acct.id)
      ]);
      return json({ ok: true });
    }

    if (req.method === 'GET' && path === '/v1/docs') {
      const { results } = await env.DB.prepare('SELECT name, version, updated_at FROM docs WHERE account_id = ?').bind(acct.id).all();
      return json({ docs: results });
    }

    const m = path.match(/^\/v1\/docs\/([a-z][a-z0-9-]{0,40})$/);
    if (m && req.method === 'GET') {
      const row = await env.DB.prepare('SELECT version, body, updated_at FROM docs WHERE account_id = ? AND name = ?').bind(acct.id, m[1]).first();
      return row ? json(row) : json({ version: 0, body: null });
    }
    if (m && req.method === 'PUT') {
      if (typeof body.body !== 'string' || body.body.length > MAX_DOC) return bad('Document missing or too large.', 413);
      const base = Number(body.baseVersion) || 0;
      const now = Date.now();
      // Compare-and-swap, so two computers saving at once can never overwrite each other.
      let changes = 0;
      if (base === 0) {
        try {
          changes = (await env.DB.prepare('INSERT INTO docs (account_id, name, version, body, updated_at) VALUES (?, ?, 1, ?, ?)').bind(acct.id, m[1], body.body, now).run()).meta.changes;
        } catch { changes = 0; }
      } else {
        changes = (await env.DB.prepare('UPDATE docs SET version = version + 1, body = ?, updated_at = ? WHERE account_id = ? AND name = ? AND version = ?')
          .bind(body.body, now, acct.id, m[1], base).run()).meta.changes;
      }
      if (!changes) {
        const cur = await env.DB.prepare('SELECT version, body FROM docs WHERE account_id = ? AND name = ?').bind(acct.id, m[1]).first();
        return json({ error: 'conflict', version: cur?.version || 0, body: cur?.body || null }, 409);
      }
      const version = base + 1;
      await relayNotice(env, acct.id, { type: 'docs' });
      return json({ version });
    }

    return bad('Not found.', 404);
  }
};

// ---------------------------------------------------------------------------
// Relay: each connected computer is one WebSocket, tagged with its device id.
// A message {to, ...} goes to that device ("*" means every other device); the
// rest of the message is ciphertext the relay cannot read. Presence (which
// computers are online, and their names) is sent to everyone on every change.
import { DurableObject } from 'cloudflare:workers';

export class Relay extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // Keep-alive pings are answered by Cloudflare itself, without waking this object.
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}'));
  }
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/kick' && req.method === 'POST') {
      const { tokenId } = await req.json().catch(() => ({}));
      for (const ws of this.ctx.getWebSockets()) if (tokenId && ws.deserializeAttachment()?.tokenId === tokenId) { try { ws.close(4001, 'removed'); } catch {} }
      return new Response('ok');
    }
    if (url.pathname === '/notice' && req.method === 'POST') {
      const msg = JSON.stringify({ ...(await req.json().catch(() => ({}))), from: 'service' });
      for (const ws of this.ctx.getWebSockets()) { try { ws.send(msg); } catch {} }
      return new Response('ok');
    }
    const device = (url.searchParams.get('device') || '').slice(0, 64);
    const name = (url.searchParams.get('name') || 'Computer').slice(0, 80);
    if (!/^[a-z0-9-]{8,64}$/.test(device)) return new Response('bad device', { status: 400 });
    // One connection per device: a reconnect replaces the old one.
    for (const old of this.ctx.getWebSockets(device)) { try { old.close(4000, 'replaced'); } catch {} }
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], [device]);
    pair[1].serializeAttachment({ device, name, since: Date.now(), tokenId: req.headers.get('X-Token-Id') || null });
    this.presence();
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  presence(gone) {
    const live = this.ctx.getWebSockets().filter((w) => w !== gone && w.readyState === 1);
    const msg = JSON.stringify({ type: 'presence', devices: live.map((w) => w.deserializeAttachment()).filter(Boolean).map(({ device, name, since }) => ({ device, name, since })) });
    for (const ws of live) { try { ws.send(msg); } catch {} }
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > 1024 * 1024) return;
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'ping') { try { ws.send('{"type":"pong"}'); } catch {} return; }
    const from = ws.deserializeAttachment()?.device;
    if (!from || !msg.to) return;
    const out = JSON.stringify({ ...msg, from });
    const targets = msg.to === '*' ? this.ctx.getWebSockets().filter((w) => w !== ws) : this.ctx.getWebSockets(String(msg.to));
    for (const t of targets) { try { t.send(out); } catch {} }
  }

  async webSocketClose(ws) { this.presence(ws); }
  async webSocketError(ws) { this.presence(ws); }
}
