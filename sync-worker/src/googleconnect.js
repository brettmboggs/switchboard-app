// Connecting Google (Gmail and Google Calendar) on the web board, the way
// GitHub connects (src/connect.js): a browser cannot hold a Google web
// client's secret, so this service does the code exchange and hands the tokens
// straight to the board after the # (never stored here); the board seals them
// into the person's own encrypted account data. Google's access tokens last an
// hour, and renewing one needs the secret too, so the board asks here for a
// fresh one: the refresh token passes through, is used once, and is not kept.
// GOOGLE_CONNECT_CLIENT_ID (a variable) and GOOGLE_CONNECT_CLIENT_SECRET (a
// secret) are a "Web application" client whose redirect is
// https://<board>/v1/oauth/callback/google/connect.
//   POST /v1/connect/google/ticket          signed in: a one-use ticket
//   GET  /v1/connect/google/start?ticket=   to Google
//   GET  /v1/oauth/callback/google/connect  back from Google: to the board, tokens after the #
//   POST /v1/connect/google/refresh         signed in { refresh }: { access, expiresIn }
const SCOPES = 'openid email https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/calendar';
const rand = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
const board = (env) => env.BOARD_URL ? String(env.BOARD_URL).replace(/\/$/, '') : null;
export const googleConnectOn = (env) => !!(env.GOOGLE_CONNECT_CLIENT_ID && env.GOOGLE_CONNECT_CLIENT_SECRET && board(env));
const redirect = (env) => `${board(env)}/v1/oauth/callback/google/connect`;
const token = async (env, params) => {
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: env.GOOGLE_CONNECT_CLIENT_ID, client_secret: env.GOOGLE_CONNECT_CLIENT_SECRET, ...params }) });
  return r.json().catch(() => ({}));
};

export async function googleBefore({ req, env, url, bad }) {
  const path = url.pathname;
  if (req.method === 'GET' && path === '/v1/connect/google/start') {
    if (!googleConnectOn(env)) return bad('Google is not set up on this sync service yet.', 404);
    const t = String(url.searchParams.get('ticket') || '');
    const row = /^[0-9a-f]{64}$/.test(t) ? await env.DB.prepare('SELECT account_id FROM oauth_codes WHERE code_hash = ? AND created_at > ?').bind(await sha('gconnect:' + t), Date.now() - 5 * 60e3).first() : null;
    if (!row) return bad('That link has run out. Press Connect Google again.', 401);
    await env.DB.prepare('DELETE FROM oauth_codes WHERE code_hash = ?').bind(await sha('gconnect:' + t)).run();
    const state = rand(24);
    await env.DB.prepare("INSERT INTO oauth_states (state, provider, client_state, return_to, verifier, created_at) VALUES (?, 'g-connect', '', ?, '', ?)").bind(state, board(env) + '/', Date.now()).run();
    const q = new URLSearchParams({ client_id: env.GOOGLE_CONNECT_CLIENT_ID, redirect_uri: redirect(env), response_type: 'code', scope: SCOPES, access_type: 'offline', prompt: 'consent select_account', include_granted_scopes: 'true', state });
    return Response.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + q, 302);
  }
  if (req.method === 'GET' && path === '/v1/oauth/callback/google/connect') {
    const state = String(url.searchParams.get('state') || ''), code = String(url.searchParams.get('code') || '');
    const row = /^[0-9a-f]{48}$/.test(state) ? await env.DB.prepare("SELECT * FROM oauth_states WHERE state = ? AND provider = 'g-connect' AND created_at > ?").bind(state, Date.now() - 15 * 60e3).first() : null;
    if (!row) return bad('This connection has expired. Start again from the board.');
    await env.DB.prepare('DELETE FROM oauth_states WHERE state = ?').bind(state).run();
    const back = (frag) => Response.redirect(row.return_to + '#' + new URLSearchParams(frag), 302);
    if (!code) return back({ 'gconnect-error': url.searchParams.get('error') === 'access_denied' ? 'Connecting Google was cancelled.' : 'Google did not connect. Try again.' });
    try {
      const j = await token(env, { grant_type: 'authorization_code', code, redirect_uri: redirect(env) });
      if (!j.access_token || !j.refresh_token) return back({ 'gconnect-error': j.error_description || 'Google did not give access. Try again, and tick every box Google shows.' });
      return back({ gconnect: j.refresh_token, gaccess: j.access_token, gexp: String(j.expires_in || 3600), gscope: j.scope || '' });
    } catch { return back({ 'gconnect-error': 'Google could not be reached. Try again.' }); }
  }
  return null;
}

export async function googleAfter({ req, env, path, body, acct, json, bad, limited }) {
  if (req.method === 'POST' && path === '/v1/connect/google/ticket') {
    if (!googleConnectOn(env)) return bad('Google is not set up on this sync service yet.', 404);
    const t = rand(32);
    await env.DB.prepare('INSERT INTO oauth_codes (code_hash, account_id, is_new, email, created_at) VALUES (?, ?, 0, NULL, ?)').bind(await sha('gconnect:' + t), acct.id, Date.now()).run();
    return json({ ticket: t });
  }
  if (req.method === 'POST' && path === '/v1/connect/google/refresh') {
    if (!googleConnectOn(env)) return bad('Google is not set up on this sync service yet.', 404);
    if (await limited(env, 'oauth', acct.id)) return bad('Too many tries. Wait a few minutes and try again.', 429);
    const refresh = String(body.refresh || '');
    if (!refresh || refresh.length > 600) return bad('Connect Google again.', 400);
    const j = await token(env, { grant_type: 'refresh_token', refresh_token: refresh });
    if (!j.access_token) return bad(j.error === 'invalid_grant' ? 'Google signed you out. Connect Google again.' : 'Google did not answer. Try again in a minute.', j.error === 'invalid_grant' ? 401 : 502);
    return json({ access: j.access_token, expiresIn: j.expires_in || 3600 });
  }
  return null;
}
