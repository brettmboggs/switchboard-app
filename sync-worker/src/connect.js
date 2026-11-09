// Connecting GitHub on the web board (docs/WEB-BOARD.md): the browser cannot
// hold an OAuth app's secret, so this service does the one exchange GitHub
// requires, and hands the token straight to the board in the address's
// fragment (#ghconnect=…), which the browser keeps and never sends anywhere.
// The token is not stored here; the board seals it into the person's own
// encrypted account data. A GitHub OAuth app has one callback URL, so the
// board can have its own (GITHUB_CONNECT_CLIENT_ID / _SECRET, callback
// https://<board>/v1/oauth/callback/github/connect); without one it uses Sign
// in with GitHub's app (GITHUB_CLIENT_ID / _SECRET), if its callback covers this path.
//   POST /v1/connect/github/ticket            signed in: a one-use ticket (a page cannot send its token on a navigation)
//   GET  /v1/connect/github/start?ticket=     to GitHub, asking for repo access
//   GET  /v1/oauth/callback/github/connect    back from GitHub: to the board, with the token after the #
const rand = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');

const ghApp = (env) => env.GITHUB_CONNECT_CLIENT_ID && env.GITHUB_CONNECT_CLIENT_SECRET ? { id: env.GITHUB_CONNECT_CLIENT_ID, secret: env.GITHUB_CONNECT_CLIENT_SECRET } : env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET ? { id: env.GITHUB_CLIENT_ID, secret: env.GITHUB_CLIENT_SECRET } : null;
export const githubConnectOn = (env) => !!(ghApp(env) && env.BOARD_URL);

export async function connectBefore({ req, env, url, bad }) {
  const path = url.pathname;
  const board = env.BOARD_URL ? String(env.BOARD_URL).replace(/\/$/, '') + '/' : null;
  const gh = ghApp(env);
  if (req.method === 'GET' && path === '/v1/connect/github/start') {
    if (!gh || !board) return bad('GitHub is not set up on this sync service.', 404);
    const t = String(url.searchParams.get('ticket') || '');
    const row = /^[0-9a-f]{64}$/.test(t) ? await env.DB.prepare('SELECT account_id FROM oauth_codes WHERE code_hash = ? AND created_at > ?').bind(await sha('connect:' + t), Date.now() - 5 * 60e3).first() : null;
    if (!row) return bad('That link has run out. Press Connect GitHub again.', 401);
    await env.DB.prepare('DELETE FROM oauth_codes WHERE code_hash = ?').bind(await sha('connect:' + t)).run();
    const state = rand(24);
    await env.DB.prepare("INSERT INTO oauth_states (state, provider, client_state, return_to, verifier, created_at) VALUES (?, 'gh-connect', '', ?, '', ?)").bind(state, board, Date.now()).run();
    const q = new URLSearchParams({ client_id: gh.id, redirect_uri: `${url.origin}/v1/oauth/callback/github/connect`, scope: 'repo read:org', state, allow_signup: 'false' });
    return Response.redirect('https://github.com/login/oauth/authorize?' + q, 302);
  }
  if (req.method === 'GET' && path === '/v1/oauth/callback/github/connect') {
    const state = String(url.searchParams.get('state') || ''), code = String(url.searchParams.get('code') || '');
    const row = /^[0-9a-f]{48}$/.test(state) ? await env.DB.prepare("SELECT * FROM oauth_states WHERE state = ? AND provider = 'gh-connect' AND created_at > ?").bind(state, Date.now() - 15 * 60e3).first() : null;
    if (!row) return bad('This connection has expired. Start again from the board.');
    await env.DB.prepare('DELETE FROM oauth_states WHERE state = ?').bind(state).run();
    const back = (frag) => Response.redirect(row.return_to + '#' + new URLSearchParams(frag), 302);
    if (!code) return back({ 'ghconnect-error': url.searchParams.get('error_description') || 'Connecting GitHub was cancelled.' });
    try {
      const r = await fetch('https://github.com/login/oauth/access_token', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: gh.id, client_secret: gh.secret, code, redirect_uri: `${url.origin}/v1/oauth/callback/github/connect` }) });
      const j = await r.json();
      if (!j.access_token) return back({ 'ghconnect-error': j.error_description || 'GitHub did not give access.' });
      return back({ ghconnect: j.access_token });
    } catch { return back({ 'ghconnect-error': 'GitHub could not be reached. Try again.' }); }
  }
  return null;
}

export async function connectAfter({ req, env, path, acct, json, bad }) {
  if (req.method === 'POST' && path === '/v1/connect/github/ticket') {
    if (!githubConnectOn(env)) return bad('GitHub is not set up on this sync service.', 404);
    const t = rand(32);
    await env.DB.prepare('INSERT INTO oauth_codes (code_hash, account_id, is_new, email, created_at) VALUES (?, ?, 0, NULL, ?)').bind(await sha('connect:' + t), acct.id, Date.now()).run();
    return json({ ticket: t });
  }
  return null;
}
