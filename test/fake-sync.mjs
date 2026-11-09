// A stand-in for the sync service, for the web board's tests: the real share
// routes (sync-worker/src/shares.js) over node:sqlite shaped like D1; sign-up,
// salt, sign-in and sign-out kept simple; the relay as a WebSocket that takes
// the web board's token from the subprotocol list, as the worker does; and the
// board itself through the real sync-worker/src/board.js, with public/ as its
// files. Not a test file: test/web*.test.js start it.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { WebSocketServer } from 'ws';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

export async function startFakeSync({ board = true } = {}) {
  // The board's integrity hashes, as the deploy makes them.
  execFileSync(process.execPath, [join(root, 'scripts', 'board-manifest.mjs')]);
  const { shareRoute } = await import('../sync-worker/src/shares.js');
  const { resetRoute, resetIssue } = await import('../sync-worker/src/reset.js');
  const { serveBoard } = await import('../sync-worker/src/board.js?' + Date.now());
  const sdb = new DatabaseSync(':memory:');
  for (const f of ['schema.sql', 'schema-v2.sql', 'schema-v5.sql', 'schema-v6.sql', 'schema-v9.sql']) sdb.exec(readFileSync(join(root, 'sync-worker', f), 'utf8'));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a), first: async () => sdb.prepare(sql).get(...args) ?? null, all: async () => ({ results: sdb.prepare(sql).all(...args) }),
    run: async () => ({ meta: { changes: Number(sdb.prepare(sql).run(...args).changes) } }), now: () => sdb.prepare(sql).run(...args)
  });
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
  const ASSETS = { fetch: async (r) => { const p = join(root, 'public', decodeURIComponent(new URL(r.url).pathname)); return existsSync(p) && !p.includes('..') ? new Response(readFileSync(p), { headers: { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' } }) : new Response('Not found', { status: 404 }); } };
  const env = { DB: { prepare: (sql) => stmt(sql), batch: async (list) => { sdb.exec('BEGIN'); try { for (const s of list) s.now(); sdb.exec('COMMIT'); } catch (e) { sdb.exec('ROLLBACK'); throw e; } } }, ...(board ? { ASSETS, BOARD_URL: 'http://board.test' } : {}) };
  const tokens = new Map(), sockets = new Map(), notices = [], rooms = new Map();
  const sha = (s) => createHash('sha256').update(s).digest('hex');
  const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  const notice = async (e, id, msg) => { notices.push([id, msg.type]); for (const ws of sockets.get(id) || []) { try { ws.send(JSON.stringify({ ...msg, from: 'service' })); } catch {} } };
  const issue = (id) => { const t = randomBytes(32).toString('hex'); tokens.set(t, id); return t; };
  async function handle(req, url, text) {
    const path = url.pathname, body = text ? JSON.parse(text) : {};
    if (req.method === 'GET' && path === '/v1/providers') return json({ providers: [], ...(board ? { board: env.BOARD_URL } : {}) });
    if (req.method === 'POST' && path === '/v1/salt') { const a = sdb.prepare('SELECT salt FROM accounts WHERE email = ?').get(String(body.email).toLowerCase()); return a ? json({ salt: a.salt }) : json({ error: 'No account with that email.' }, 404); }
    if (req.method === 'POST' && path === '/v1/signup') {
      const email = String(body.email).trim().toLowerCase();
      if (sdb.prepare('SELECT 1 FROM accounts WHERE email = ?').get(email)) return json({ error: 'There is already an account with that email.' }, 409);
      const id = 'a-' + randomBytes(6).toString('hex');
      sdb.prepare('INSERT INTO accounts (id, email, salt, auth_hash, auth_salt, created_at) VALUES (?, ?, ?, ?, ?, 0)').run(id, email, body.salt, sha(body.auth), '');
      return json({ token: issue(id) });
    }
    if (req.method === 'POST' && path === '/v1/login') {
      const a = sdb.prepare('SELECT id, auth_hash FROM accounts WHERE email = ?').get(String(body.email).toLowerCase());
      return a && a.auth_hash === sha(body.auth) ? json({ token: issue(a.id) }) : json({ error: 'That email and password do not match.' }, 401);
    }
    // Forgot password: the real routes (sync-worker/src/reset.js), with this stand-in's simple hash and tokens.
    const resetHelpers = { json, bad: (error, status = 400) => json({ error }, status), limited: async () => false, sha256: async (s) => sha(s), slowHash: async (a) => sha(a), rand: (n) => randomBytes(n).toString('hex'),
      issueToken: async (e, id) => issue(id), cleanEmail: (e) => String(e || '').trim().toLowerCase(), validEmail: (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e), boardUrl: null };
    const rs = await resetRoute({ req, env, path, body, ...resetHelpers });
    if (rs) {
      // The worker's reset signs out every computer: here, drop that account's tokens too.
      if (path === '/v1/reset/finish' && rs.status === 200) { const id = sdb.prepare('SELECT id FROM accounts WHERE email = ?').get(String(body.email).trim().toLowerCase()).id, keep = (await rs.clone().json()).token; for (const [k, v] of tokens) if (v === id && k !== keep) tokens.delete(k); }
      return rs;
    }
    const t = (req.headers.authorization || '').replace(/^Bearer /, '');
    const acct = tokens.get(t);
    if (!acct) return json({ error: 'Signed out.' }, 401);
    const ri = await resetIssue({ req, env, path, body, acct: { id: acct }, ...resetHelpers });
    if (ri) return ri;
    if (req.method === 'POST' && path === '/v1/logout') { tokens.delete(t); return json({ ok: true }); }
    // The account's own sealed documents, with the worker's compare-and-swap.
    if (req.method === 'GET' && path === '/v1/docs') return json({ docs: sdb.prepare('SELECT name, version, updated_at FROM docs WHERE account_id = ?').all(acct) });
    const dm = path.match(/^\/v1\/docs\/([a-z][a-z0-9-]{0,40})$/);
    if (dm && req.method === 'GET') return json(sdb.prepare('SELECT version, body, updated_at FROM docs WHERE account_id = ? AND name = ?').get(acct, dm[1]) || { version: 0, body: null });
    if (dm && req.method === 'PUT') {
      const base = Number(body.baseVersion) || 0;
      const changes = base === 0
        ? (() => { try { return Number(sdb.prepare('INSERT INTO docs (account_id, name, version, body, updated_at) VALUES (?, ?, 1, ?, ?)').run(acct, dm[1], body.body, Date.now()).changes); } catch { return 0; } })()
        : Number(sdb.prepare('UPDATE docs SET version = version + 1, body = ?, updated_at = ? WHERE account_id = ? AND name = ? AND version = ?').run(body.body, Date.now(), acct, dm[1], base).changes);
      if (!changes) return json({ error: 'conflict' }, 409);
      await notice(env, acct, { type: 'docs' });
      return json({ version: base + 1 });
    }
    return (await shareRoute({ req, env, path, url, body, acct: { id: acct }, json, bad: (error, status = 400) => json({ error }, status), notice, limited: async () => false, maxDoc: 900 * 1024 })) || json({ error: 'Not found.' }, 404);
  }
  const server = createServer(async (req, res) => {
    let text = ''; for await (const c of req) text += c;
    const url = new URL(req.url, 'http://127.0.0.1');
    let r;
    try {
      if (req.method === 'GET' && board && url.pathname === '/join') r = Response.redirect(new URL('/', svcBase()).href, 302);   // as the worker does; the # stays in the browser
      else if (req.method === 'GET' && board && !url.pathname.startsWith('/v1')) r = await serveBoard({ method: 'GET' }, env, url);
      else r = await handle(req, url, text);
    } catch (e) { r = json({ error: e.message }, 500); }
    const headers = {}; r.headers.forEach((v, k) => { headers[k] = v; });
    res.writeHead(r.status, headers); res.end(Buffer.from(await r.arrayBuffer()));
  });
  // The relay: the token from "Authorization: Bearer" (computers) or the subprotocol "tok.<token>" (the web board).
  const wss = new WebSocketServer({ noServer: true, handleProtocols: (set) => set.has('switchboard') ? 'switchboard' : false });
  server.on('upgrade', (req, socket, head) => {
    const proto = (req.headers['sec-websocket-protocol'] || '').match(/(?:^|,\s*)tok\.([0-9a-f]{64})(?:,|$)/);
    const t = proto?.[1] || (req.headers.authorization || '').replace(/^Bearer /, '');
    const acct = tokens.get(t);
    // A shared project's live room (as the worker's "live" route and its Relay): joined members only,
    // each connection tagged here with its account and email, messages routed by "to", presence to all.
    const live = req.url.match(/^\/v1\/shares\/([0-9a-f]{24})\/live\?suffix=([a-z0-9]+)/);
    if (acct && live) {
      const joined = sdb.prepare("SELECT 1 FROM share_members WHERE share_id = ? AND account_id = ? AND status = 'joined'").get(live[1], acct);
      if (!joined) { socket.destroy(); return; }
      const email = sdb.prepare('SELECT email FROM accounts WHERE id = ?').get(acct).email;
      const device = `a${acct.replace(/[^a-z0-9]/gi, '').slice(0, 16).toLowerCase()}-${live[2].slice(0, 12)}`;
      wss.handleUpgrade(req, socket, head, (ws) => {
        const room = rooms.get(live[1]) || new Map();
        rooms.set(live[1], room);
        room.set(device, { ws, name: email, since: Date.now() });
        const presence = () => { const msg = JSON.stringify({ type: 'presence', devices: [...room].map(([d, x]) => ({ device: d, name: x.name, since: x.since })) }); for (const x of room.values()) try { x.ws.send(msg); } catch {} };
        presence();
        ws.on('message', (raw) => { let m; try { m = JSON.parse(String(raw)); } catch { return; } if (!m.to) return; const out = JSON.stringify({ ...m, from: device }); for (const [d, x] of room) if (m.to === '*' ? d !== device : d === m.to) try { x.ws.send(out); } catch {} });
        ws.on('close', () => { room.delete(device); presence(); });
      });
      return;
    }
    if (!acct || !req.url.startsWith('/v1/relay')) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (!sockets.has(acct)) sockets.set(acct, new Set());
      sockets.get(acct).add(ws);
      ws.on('close', () => sockets.get(acct)?.delete(ws));
    });
  });
  let svcBaseValue = '';
  const svcBase = () => svcBaseValue;
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  svcBaseValue = base;
  // An account made straight in the service, for the owner's Switchboard in Node.
  const account = (id, email) => { sdb.prepare("INSERT INTO accounts (id, email, salt, auth_hash, auth_salt, created_at) VALUES (?, ?, '', '', '', 0)").run(id, email); return { server: base, token: issue(id), key: randomBytes(32).toString('hex'), email }; };
  return { base, sdb, notices, sockets, rooms, account, close: () => { wss.close(); server.closeAllConnections?.(); server.close(); } };
}
