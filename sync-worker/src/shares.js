// Shared projects: one project's notes and to-dos, shared between accounts.
//
// End to end: each shared project has its own random key, made on the owner's
// computer. Every account has an X25519 key pair for sharing; this service
// keeps the public half, and the private half only locked with the account key
// (which it never sees). A member's copy of the project key is locked to their
// public key. The project's document is ciphertext. So this service knows who
// shares with whom and how big the document is, and nothing that is in it.
// Removing someone, or someone leaving, makes the owner's (or an admin's)
// computer choose a new key (a new "epoch") and lock it to whoever is left.
//
// Roles: owner, admin (invites, removes, changes what is shared) and member.
// This service keeps a role per member to decide who may invite and remove,
// but the computers believe only the roster: the list of admins signed with the
// owner's signing key (Ed25519), which this service stores and cannot forge.
// So a service that promoted someone would get them nothing on anyone's screen.
//
// Routes (signed in):
//   GET  /v1/share-key                 this account's sharing keys { pub, signPub, wrapped }
//   PUT  /v1/share-key                 set them, once { pub, signPub, wrapped }
//   GET  /v1/share-key/lookup?email=   someone's public keys, to invite them
//   GET  /v1/shares                    the shared projects this account is in
//   POST /v1/shares                    share a project { lock, body, roster, rosterSig }
//   POST /v1/shares/<id>/roster        a new signed roster { roster, rosterSig, admins: [email] } (owner)
//   GET  /v1/shares/<id>/doc           the document (members and invited)
//   PUT  /v1/shares/<id>/doc           save it { body, baseVersion, epoch } (members)
//   POST /v1/shares/<id>/invite        { email, lock, epoch } (owner or admin)
//   POST /v1/shares/<id>/accept        (invited)
//   POST /v1/shares/<id>/leave         decline or leave (anyone but the owner)
//   POST /v1/shares/<id>/rekey         { epoch, locks: {email: lock}, body, baseVersion, remove? } (owner or admin)
//   POST /v1/shares/<id>/stop          stop sharing (owner)
//   GET  /v1/shares/<id>/live          a WebSocket for the project's live things (sessions), members only.
//                                      Each connection is tagged here with its account (device "a<id>-<suffix>",
//                                      name = its email); what goes through is sealed to one person's key.
// Invites for people with no account yet (schema-v6.sql):
//   POST /v1/shares/<id>/pending       { emailHash, tokenHash, grant, sig } (owner or admin)
//   GET  /v1/shares/<id>/pending       the project's waiting and accepted invites (owner or admin)
//   POST /v1/shares/<id>/pending/<pid>/cancel   (owner or admin; also once it is turned into a member)
//   GET  /v1/share-invites             invites for this account's email, by its hash
//   POST /v1/share-invites/redeem      { token }: the invite link, used once by an account with the invited email: that is joining
//   POST /v1/share-invites/<pid>/accept|decline   (one that arrived without its link: accept only asks; the owner lets them in)
const MAX_MEMBERS = 20, MAX_SHARES = 50, MAX_PENDING = 30, PENDING_DAYS = 14;
const hexOf = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
const okHash = (h) => typeof h === 'string' && /^[0-9a-f]{64}$/.test(h);
const okPub = (p) => typeof p === 'string' && /^[A-Za-z0-9+/=]{40,200}$/.test(p);
const okLock = (l) => typeof l === 'string' && l.length < 2000;
const okSig = (r, s) => typeof r === 'string' && r.length < 20000 && typeof s === 'string' && s.length < 200;

export async function shareRoute({ req, env, path, url, body, acct, json, bad, notice, limited, maxDoc }) {
  if (!path.startsWith('/v1/share')) return null;
  const now = Date.now();
  const me = await env.DB.prepare('SELECT email FROM accounts WHERE id = ?').bind(acct.id).first();

  if (path === '/v1/share-key') {
    if (req.method === 'GET') {
      const row = await env.DB.prepare('SELECT pub, sign_pub, wrapped FROM share_keys WHERE account_id = ?').bind(acct.id).first();
      return json(row ? { pub: row.pub, signPub: row.sign_pub, wrapped: row.wrapped } : { pub: null, signPub: null, wrapped: null });
    }
    if (req.method === 'PUT') {
      if (!okPub(body.pub) || !okPub(body.signPub) || typeof body.wrapped !== 'string' || body.wrapped.length > 4096) return bad('That key is not right.');
      // Set once: replacing it would leave every project already shared with this account unopenable.
      const cur = await env.DB.prepare('SELECT pub FROM share_keys WHERE account_id = ?').bind(acct.id).first();
      if (cur && cur.pub !== body.pub) return bad('This account already has a sharing key.', 409);
      await env.DB.prepare('INSERT OR REPLACE INTO share_keys (account_id, pub, sign_pub, wrapped, updated_at) VALUES (?, ?, ?, ?, ?)').bind(acct.id, body.pub, body.signPub, body.wrapped, now).run();
      // New keys (a new account, or one after a password reset): whoever runs their projects syncs now,
      // so a reset someone started from Team locks those projects to them again within seconds.
      if (!cur) {
        const { results } = await env.DB.prepare("SELECT DISTINCT o.account_id FROM share_members me JOIN share_members o ON o.share_id = me.share_id WHERE me.account_id = ? AND o.account_id != ? AND o.role IN ('owner', 'admin')").bind(acct.id, acct.id).all();
        for (const x of results) await notice(env, x.account_id, { type: 'shares' });
      }
      return json({ ok: true });
    }
  }
  if (req.method === 'GET' && path === '/v1/share-key/lookup') {
    if (await limited(env, 'pair', acct.id)) return bad('Too many tries. Wait a few minutes and try again.', 429);
    const email = String(url.searchParams.get('email') || '').trim().toLowerCase();
    const a = await env.DB.prepare('SELECT id FROM accounts WHERE email = ?').bind(email).first();
    if (!a) return bad('No Switchboard account uses that email. Ask them to make one (Settings, Account), then invite them again.', 404);
    if (a.id === acct.id) return bad('That is your own account.');
    const k = await env.DB.prepare('SELECT pub, sign_pub FROM share_keys WHERE account_id = ?').bind(a.id).first();
    if (!k) return bad('They have an account, but their Switchboard has not been updated and opened since sharing came out. Ask them to update it and open it once.', 409);
    return json({ pub: k.pub, signPub: k.sign_pub });
  }

  // ---- invites waiting for someone to make an account (or to open Switchboard)
  if (path === '/v1/share-invites' && req.method === 'GET') {
    const h = await hexOf('switchboard-invite:' + String(me?.email || '').toLowerCase());
    const { results } = await env.DB.prepare("SELECT p.id, p.share_id, p.grant_body, p.grant_sig, p.status, a.email AS inviter FROM share_pending p JOIN accounts a ON a.id = p.inviter_id WHERE p.email_hash = ? AND p.expires_at > ? AND (p.status = 'waiting' OR p.account_id = ?)").bind(h, now, acct.id).all();
    return json({ invites: results.map((r) => ({ id: r.id, share: r.share_id, grant: r.grant_body, sig: r.grant_sig, status: r.status, inviter: r.inviter })) });
  }
  if (path === '/v1/share-invites/redeem' && req.method === 'POST') {
    if (await limited(env, 'pair', acct.id)) return bad('Too many tries. Wait a few minutes and try again.', 429);
    const th = await hexOf(String(body.token || ''));
    const p = await env.DB.prepare('SELECT * FROM share_pending WHERE token_hash = ?').bind(th).first();
    if (!p || p.expires_at <= now) return bad('That invitation link has run out (they last 14 days) or was cancelled. Ask for a new one.', 404);
    // 'asked': this account answered it without the link; the link now makes that a join.
    if (p.status !== 'waiting' && !(p.status === 'asked' && p.account_id === acct.id)) return p.account_id === acct.id ? json({ ok: true, share: p.share_id, inviter: null }) : bad('That invitation link was already used.', 409);
    const h = await hexOf('switchboard-invite:' + String(me?.email || '').toLowerCase());
    if (p.email_hash !== h) return bad('That invitation is for a different email address. Sign in, or make your account, with the address it was sent to.', 403);
    await env.DB.prepare("UPDATE share_pending SET status = 'accepted', account_id = ? WHERE id = ?").bind(acct.id, p.id).run();
    const mgr = (await env.DB.prepare("SELECT account_id FROM share_members WHERE share_id = ? AND role IN ('owner', 'admin')").bind(p.share_id).all()).results;
    for (const x of [{ account_id: p.inviter_id }, ...mgr]) await notice(env, x.account_id, { type: 'shares' });
    const inviter = await env.DB.prepare('SELECT email FROM accounts WHERE id = ?').bind(p.inviter_id).first();
    return json({ ok: true, share: p.share_id, inviter: inviter?.email || null });
  }
  const pi = path.match(/^\/v1\/share-invites\/([0-9a-f]{24})\/(accept|decline)$/);
  if (pi && req.method === 'POST') {
    const h = await hexOf('switchboard-invite:' + String(me?.email || '').toLowerCase());
    const p = await env.DB.prepare('SELECT * FROM share_pending WHERE id = ? AND email_hash = ? AND expires_at > ?').bind(pi[1], h, now).first();
    if (!p) return bad('That invitation is gone: it was cancelled, or it is more than 14 days old. Ask for a new one.', 404);
    if (pi[2] === 'decline') { await env.DB.prepare('DELETE FROM share_pending WHERE id = ?').bind(p.id).run(); return json({ ok: true }); }
    // Without the link's secret this is only asking: this service does not check that an account owns its
    // address, so the owner's computer lets them in only when the owner says so (docs/REVIEW-2026-11-05.md H2).
    if (p.status !== 'waiting') return p.account_id === acct.id ? json({ ok: true, share: p.share_id }) : bad('That invitation was already used.', 409);
    await env.DB.prepare("UPDATE share_pending SET status = 'asked', account_id = ? WHERE id = ?").bind(acct.id, p.id).run();
    // The inviter's computers (and the project's other admins') hand over the keys on their next look; tell them now.
    const mgr = (await env.DB.prepare("SELECT account_id FROM share_members WHERE share_id = ? AND role IN ('owner', 'admin')").bind(p.share_id).all()).results;
    for (const x of [{ account_id: p.inviter_id }, ...mgr]) await notice(env, x.account_id, { type: 'shares' });
    return json({ ok: true, share: p.share_id });
  }

  const members = async (id) => (await env.DB.prepare('SELECT m.account_id, m.role, m.status, a.email FROM share_members m JOIN accounts a ON a.id = m.account_id WHERE m.share_id = ?').bind(id).all()).results;
  const tellAll = async (id, also = []) => { for (const m of [...await members(id), ...also]) await notice(env, m.account_id, { type: 'shares' }); };

  if (path === '/v1/shares') {
    if (req.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT s.id, s.epoch, s.version, s.needs_rekey, s.roster, s.roster_sig, m.role, m.status, m.lock FROM share_members m JOIN shares s ON s.id = m.share_id WHERE m.account_id = ?').bind(acct.id).all();
      const out = [];
      for (const r of results) out.push({ id: r.id, epoch: r.epoch, version: r.version, role: r.role, status: r.status, lock: r.lock, roster: r.roster, rosterSig: r.roster_sig, needsRekey: (r.role === 'owner' || r.role === 'admin') && !!r.needs_rekey, members: (await members(r.id)).map((m) => ({ email: m.email, role: m.role, status: m.status })) });
      return json({ shares: out, email: me?.email });
    }
    if (req.method === 'POST') {
      if (!okLock(body.lock) || typeof body.body !== 'string' || body.body.length > maxDoc || !okSig(body.roster, body.rosterSig)) return bad('Missing the project, its key or its roster.');
      const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM share_members WHERE account_id = ? AND role = 'owner'").bind(acct.id).first();
      if ((n?.n || 0) >= MAX_SHARES) return bad(`You share ${MAX_SHARES} projects already.`);
      const id = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('');
      await env.DB.batch([
        env.DB.prepare('INSERT INTO shares (id, owner_id, epoch, needs_rekey, version, body, roster, roster_sig, created_at, updated_at) VALUES (?, ?, 1, 0, 1, ?, ?, ?, ?, ?)').bind(id, acct.id, body.body, body.roster, body.rosterSig, now, now),
        env.DB.prepare("INSERT INTO share_members (share_id, account_id, role, status, lock, created_at) VALUES (?, ?, 'owner', 'joined', ?, ?)").bind(id, acct.id, body.lock, now)
      ]);
      return json({ id, epoch: 1, version: 1 });
    }
  }

  const m = path.match(/^\/v1\/shares\/([0-9a-f]{24})\/(doc|invite|accept|leave|rekey|stop|roster|pending|live)(?:\/([0-9a-f]{24})\/cancel)?$/);
  if (!m) return bad('Not found.', 404);
  const [, id, what, pid] = m;
  const share = await env.DB.prepare('SELECT * FROM shares WHERE id = ?').bind(id).first();
  const mine = share && await env.DB.prepare('SELECT role, status FROM share_members WHERE share_id = ? AND account_id = ?').bind(id, acct.id).first();
  if (!share || !mine) return bad('That shared project is gone, or you are no longer in it.', 404);
  const owner = mine.role === 'owner', manager = owner || mine.role === 'admin';

  if (what === 'pending') {
    if (!manager) return bad('Only the person who shared this project, or an admin, can see or change its invitations.', 403);
    if (req.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT p.id, p.grant_body, p.grant_sig, p.status, p.created_at, p.expires_at, a.email AS accepted_by FROM share_pending p LEFT JOIN accounts a ON a.id = p.account_id WHERE p.share_id = ? AND p.expires_at > ?').bind(id, now).all();
      return json({ pending: results.map((r) => ({ id: r.id, grant: r.grant_body, sig: r.grant_sig, status: r.status, acceptedBy: r.accepted_by, at: r.created_at, expires: r.expires_at })) });
    }
    if (req.method !== 'POST') return bad('Not found.', 404);
    if (pid) { await env.DB.prepare('DELETE FROM share_pending WHERE id = ? AND share_id = ?').bind(pid, id).run(); return json({ ok: true }); }
    if (!okHash(body.emailHash) || !okHash(body.tokenHash) || !okSig(body.grant, body.sig)) return bad('That invitation is not right.');
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM share_pending WHERE share_id = ? AND expires_at > ?').bind(id, now).first();
    if ((n?.n || 0) >= MAX_PENDING) return bad(`${MAX_PENDING} invitations are already waiting in this project. Cancel some first.`);
    if (Math.random() < 0.1) await env.DB.prepare('DELETE FROM share_pending WHERE expires_at < ?').bind(now).run();
    const newId = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('');
    // One waiting invitation per person per project: a new one replaces the old.
    await env.DB.prepare('DELETE FROM share_pending WHERE share_id = ? AND email_hash = ?').bind(id, body.emailHash).run();
    await env.DB.prepare("INSERT INTO share_pending (id, share_id, email_hash, token_hash, inviter_id, grant_body, grant_sig, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'waiting', ?, ?)")
      .bind(newId, id, body.emailHash, body.tokenHash, acct.id, body.grant, body.sig, now, now + PENDING_DAYS * 86400e3).run();
    return json({ id: newId, expires: now + PENDING_DAYS * 86400e3 });
  }
  // The project's live channel: one relay room per shared project, for its joined members.
  if (what === 'live') {
    if (mine.status !== 'joined') return bad('Join the project first.', 403);
    if (req.headers.get('Upgrade') !== 'websocket' || !env.RELAY) return bad('Expected a WebSocket.', 426);
    const suffix = String(url.searchParams.get('suffix') || '').replace(/[^a-z0-9]/g, '').slice(0, 12) || 'x';
    const live = new URL(req.url);
    live.searchParams.set('device', `a${String(acct.id).replace(/[^a-z0-9]/gi, '').slice(0, 16).toLowerCase()}-${suffix}`);
    live.searchParams.set('name', me?.email || 'someone');
    const headers = new Headers(req.headers);
    headers.set('X-Token-Id', String(acct.tokenHash || '').slice(0, 16));
    return env.RELAY.get(env.RELAY.idFromName('share:' + id)).fetch(new Request(live.href, { method: req.method, headers }));
  }
  if (what === 'doc' && req.method === 'GET') return json({ version: share.version, epoch: share.epoch, body: share.body });
  if (what === 'doc' && req.method === 'PUT') {
    if (mine.status !== 'joined') return bad('Accept the invitation first.', 403);
    if (typeof body.body !== 'string' || body.body.length > maxDoc) return bad('Document missing or too large.', 413);
    if (Number(body.epoch) !== share.epoch) return json({ error: 'rekeyed', epoch: share.epoch }, 409);
    const changes = (await env.DB.prepare('UPDATE shares SET version = version + 1, body = ?, updated_at = ? WHERE id = ? AND version = ? AND epoch = ?')
      .bind(body.body, now, id, Number(body.baseVersion) || 0, share.epoch).run()).meta.changes;
    if (!changes) return json({ error: 'conflict' }, 409);
    await tellAll(id);
    return json({ version: (Number(body.baseVersion) || 0) + 1 });
  }
  if (req.method !== 'POST') return bad('Not found.', 404);

  if (what === 'invite') {
    if (!manager) return bad('Only the person who shared this project, or an admin, can invite others.', 403);
    const email = String(body.email || '').trim().toLowerCase();
    const a = await env.DB.prepare('SELECT id FROM accounts WHERE email = ?').bind(email).first();
    if (!a) return bad('No Switchboard account uses that email.', 404);
    if (!okLock(body.lock) || Number(body.epoch) !== share.epoch) return json({ error: 'rekeyed', epoch: share.epoch }, 409);
    const cur = await env.DB.prepare('SELECT status FROM share_members WHERE share_id = ? AND account_id = ?').bind(id, a.id).first();
    if (cur?.status === 'joined') return bad('They are in this project already.');
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM share_members WHERE share_id = ?').bind(id).first();
    if (!cur && (n?.n || 0) >= MAX_MEMBERS) return bad(`A project can be shared with up to ${MAX_MEMBERS - 1} people.`);
    await env.DB.prepare("INSERT OR REPLACE INTO share_members (share_id, account_id, role, status, lock, created_at) VALUES (?, ?, 'member', 'invited', ?, ?)").bind(id, a.id, body.lock, now).run();
    await tellAll(id);
    return json({ ok: true });
  }
  if (what === 'accept') {
    if (mine.status === 'joined') return json({ ok: true });
    await env.DB.prepare("UPDATE share_members SET status = 'joined' WHERE share_id = ? AND account_id = ?").bind(id, acct.id).run();
    await tellAll(id);
    return json({ ok: true });
  }
  if (what === 'leave') {
    if (owner) return bad('You shared this project. Stop sharing it instead.');
    await env.DB.prepare('DELETE FROM share_members WHERE share_id = ? AND account_id = ?').bind(id, acct.id).run();
    // They had the key: the owner's computer picks a new one next time it looks.
    if (mine.status === 'joined') await env.DB.prepare('UPDATE shares SET needs_rekey = 1 WHERE id = ?').bind(id).run();
    await tellAll(id, [{ account_id: acct.id }]);
    return json({ ok: true });
  }
  if (what === 'roster') {
    if (!owner) return bad('Only the person who shared this project can make someone an admin.', 403);
    if (!okSig(body.roster, body.rosterSig)) return bad('That roster is not right.');
    const admins = new Set((Array.isArray(body.admins) ? body.admins : []).map((e) => String(e).toLowerCase()));
    const all = await members(id);
    await env.DB.batch([
      env.DB.prepare('UPDATE shares SET roster = ?, roster_sig = ? WHERE id = ?').bind(body.roster, body.rosterSig, id),
      ...all.filter((x) => x.role !== 'owner').map((x) => env.DB.prepare('UPDATE share_members SET role = ? WHERE share_id = ? AND account_id = ?').bind(admins.has(x.email) ? 'admin' : 'member', id, x.account_id))
    ]);
    await tellAll(id);
    return json({ ok: true });
  }
  if (what === 'stop') {
    if (!owner) return bad('Only the person who shared this project can stop sharing it.', 403);
    const was = await members(id);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM share_members WHERE share_id = ?').bind(id),
      env.DB.prepare('DELETE FROM shares WHERE id = ?').bind(id)
    ]);
    for (const x of was) await notice(env, x.account_id, { type: 'shares' });
    return json({ ok: true });
  }
  if (what === 'rekey') {
    if (!manager) return bad('Only the person who shared this project, or an admin, can do that.', 403);
    const epoch = Number(body.epoch);
    if (epoch !== share.epoch + 1) return json({ error: 'rekeyed', epoch: share.epoch }, 409);
    if (typeof body.body !== 'string' || body.body.length > maxDoc) return bad('Document missing or too large.', 413);
    if (Number(body.baseVersion) !== share.version) return json({ error: 'conflict' }, 409);
    const all = await members(id);
    const removed = body.remove ? all.find((x) => x.email === String(body.remove).toLowerCase() && x.role !== 'owner') : null;
    if (body.remove && !removed) return bad('They are not in this project.', 404);
    if (removed?.role === 'admin' && !owner) return bad('Only the person who shared this project can remove an admin.', 403);
    const stay = all.filter((x) => x !== removed);
    const locks = body.locks || {};
    // Everyone who stays gets the new key, or nobody does.
    if (stay.some((x) => !okLock(locks[x.email]))) return json({ error: 'members-changed' }, 409);
    await env.DB.batch([
      ...(removed ? [env.DB.prepare('DELETE FROM share_members WHERE share_id = ? AND account_id = ?').bind(id, removed.account_id)] : []),
      ...stay.map((x) => env.DB.prepare('UPDATE share_members SET lock = ? WHERE share_id = ? AND account_id = ?').bind(locks[x.email], id, x.account_id)),
      env.DB.prepare('UPDATE shares SET epoch = ?, needs_rekey = 0, version = version + 1, body = ?, updated_at = ? WHERE id = ?').bind(epoch, body.body, now, id)
    ]);
    for (const x of all) await notice(env, x.account_id, { type: 'shares' });
    return json({ ok: true, epoch, version: share.version + 1 });
  }
  return bad('Not found.', 404);
}
