// Team chat: a channel for each shared project, and one-to-one chats between
// people who share a project (schema-v8.sql).
//
// End to end: every line is sealed on the sender's computer. A project
// channel's key is made from the project key (src/shares.js), which this
// service never sees; a one-to-one chat's key is made by the two computers
// from their own sharing keys (X25519), which this service cannot open. Edits,
// deletions, reactions and pins are sealed lines in the same log, signed
// inside by whoever wrote them, so the service cannot tell them apart or make
// one up. So it knows who wrote in which channel, when and how much, how far
// each person has read, and when someone is typing; nothing that was said.
//
// Who may read or write: a project channel, the project's joined members; a
// one-to-one chat, its two people while they still share a project.
//
// Routes (signed in):
//   GET  /v1/chat                    the channels this account is in, each with its newest line and who has read how far
//   GET  /v1/chat/<chan>?after=<seq> up to 200 lines after that one (more: true when there are more)
//   POST /v1/chat/<chan>             { body } a sealed line, appended; everyone in the channel is told over the relay
//   POST /v1/chat/<chan>/seen        { seq } read up to there; the others are told
//   POST /v1/chat/<chan>/typing      the others are told, nothing is stored
const MAX_BODY = 700 * 1024, PAGE = 200;
const okChan = (c) => /^[pd][0-9a-f]{24}$/.test(c);
const hexOf = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
// The same two accounts always get the same chat, whoever opens it first.
export const directChan = async (a, b) => 'd' + (await hexOf('switchboard-dm:' + [a, b].sort().join(':'))).slice(0, 24);

export async function chatRoute({ req, env, path, url, body, acct, json, bad, notice, limited }) {
  if (path !== '/v1/chat' && !path.startsWith('/v1/chat/')) return null;
  const now = Date.now();
  const emailOf = async (id) => (await env.DB.prepare('SELECT email FROM accounts WHERE id = ?').bind(id).first())?.email || null;
  // Everyone who shares a joined project with this account (and has joined it too).
  const teammates = async (id) => (await env.DB.prepare("SELECT DISTINCT a.id, a.email FROM share_members m1 JOIN share_members m2 ON m2.share_id = m1.share_id JOIN accounts a ON a.id = m2.account_id WHERE m1.account_id = ? AND m1.status = 'joined' AND m2.status = 'joined' AND m2.account_id != ?").bind(id, id).all()).results;
  const projectMembers = async (share) => (await env.DB.prepare("SELECT m.account_id, a.email FROM share_members m JOIN accounts a ON a.id = m.account_id WHERE m.share_id = ? AND m.status = 'joined'").bind(share).all()).results;
  const seenOf = async (chan) => Object.fromEntries((await env.DB.prepare('SELECT a.email, s.seq FROM chat_seen s JOIN accounts a ON a.id = s.account_id WHERE s.chan = ?').bind(chan).all()).results.map((r) => [r.email, r.seq]));
  const lastOf = async (chan) => (await env.DB.prepare('SELECT MAX(seq) AS n, MAX(at) AS at FROM chat_log WHERE chan = ?').bind(chan).first()) || { n: 0, at: 0 };

  // Who is in a channel: [{ account_id, email }], or null when this account is not.
  async function people(chan) {
    if (chan[0] === 'p') {
      const all = await projectMembers(chan.slice(1));
      return all.some((m) => m.account_id === acct.id) ? all : null;
    }
    const d = await env.DB.prepare('SELECT a_id, b_id FROM chat_direct WHERE chan = ?').bind(chan).first();
    if (!d || (d.a_id !== acct.id && d.b_id !== acct.id)) return null;
    const other = d.a_id === acct.id ? d.b_id : d.a_id;
    if (!(await teammates(acct.id)).some((t) => t.id === other)) return null;   // no project in common any more
    return [{ account_id: acct.id, email: await emailOf(acct.id) }, { account_id: other, email: await emailOf(other) }];
  }
  const tell = async (list, msg, skipMe = false) => { for (const p of list) if (!skipMe || p.account_id !== acct.id) await notice(env, p.account_id, msg); };

  if (path === '/v1/chat') {
    if (req.method !== 'GET') return bad('Not found.', 404);
    const out = [];
    const shares = (await env.DB.prepare("SELECT share_id FROM share_members WHERE account_id = ? AND status = 'joined'").bind(acct.id).all()).results;
    for (const s of shares) {
      const chan = 'p' + s.share_id, last = await lastOf(chan);
      out.push({ chan, kind: 'project', share: s.share_id, members: (await projectMembers(s.share_id)).map((m) => m.email), last: last.n || 0, at: last.at || 0, seen: await seenOf(chan) });
    }
    for (const t of await teammates(acct.id)) {
      const chan = await directChan(acct.id, t.id);
      await env.DB.prepare('INSERT OR IGNORE INTO chat_direct (chan, a_id, b_id, created_at) VALUES (?, ?, ?, ?)').bind(chan, acct.id, t.id, now).run();
      const last = await lastOf(chan);
      out.push({ chan, kind: 'direct', with: t.email, last: last.n || 0, at: last.at || 0, seen: await seenOf(chan) });
    }
    return json({ channels: out });
  }

  const m = path.match(/^\/v1\/chat\/([pd][0-9a-f]{24})(?:\/(seen|typing))?$/);
  if (!m || !okChan(m[1])) return bad('Not found.', 404);
  const [, chan, what] = m;
  const list = await people(chan);
  if (!list) return bad('That chat is gone, or you are no longer in it.', 404);

  if (!what && req.method === 'GET') {
    const after = Math.max(0, Number(url.searchParams.get('after')) || 0);
    const { results } = await env.DB.prepare('SELECT l.seq, l.at, l.body, a.email AS sender FROM chat_log l LEFT JOIN accounts a ON a.id = l.sender_id WHERE l.chan = ? AND l.seq > ? ORDER BY l.seq LIMIT ?').bind(chan, after, PAGE + 1).all();
    return json({ messages: results.slice(0, PAGE).map((r) => ({ seq: r.seq, at: r.at, from: r.sender, body: r.body })), more: results.length > PAGE, seen: await seenOf(chan) });
  }
  if (req.method !== 'POST') return bad('Not found.', 404);

  if (!what) {
    if (typeof body.body !== 'string' || !body.body || body.body.length > MAX_BODY) return bad('That message is too big. Send fewer or smaller pictures at a time.', 413);
    if (await limited(env, 'chatday', acct.id, 86400e3)) return bad('That is a lot of messages for one day. Try again tomorrow.', 429);
    let seq = 0;
    // The next number in the channel; two people sending at the same moment both get one.
    for (let i = 0; i < 4 && !seq; i++) {
      try {
        const r = await env.DB.prepare('INSERT INTO chat_log (chan, seq, sender_id, body, at) SELECT ?, COALESCE(MAX(seq), 0) + 1, ?, ?, ? FROM chat_log WHERE chan = ? RETURNING seq').bind(chan, acct.id, body.body, now, chan).first();
        seq = r?.seq || 0;
      } catch { /* taken: try the next one */ }
    }
    if (!seq) return bad('Could not save that message. Try again.', 503);
    // Your own read mark moves with what you send.
    await env.DB.prepare('INSERT INTO chat_seen (chan, account_id, seq, at) VALUES (?, ?, ?, ?) ON CONFLICT(chan, account_id) DO UPDATE SET seq = MAX(seq, excluded.seq), at = excluded.at').bind(chan, acct.id, seq, now).run();
    await tell(list, { type: 'chat', chan, seq });
    return json({ seq, at: now });
  }
  if (what === 'seen') {
    const seq = Math.max(0, Math.floor(Number(body.seq) || 0));
    const last = (await lastOf(chan)).n || 0;
    if (seq > last) return bad('That is past the newest message.');
    await env.DB.prepare('INSERT INTO chat_seen (chan, account_id, seq, at) VALUES (?, ?, ?, ?) ON CONFLICT(chan, account_id) DO UPDATE SET seq = MAX(seq, excluded.seq), at = excluded.at').bind(chan, acct.id, seq, now).run();
    await tell(list, { type: 'chat', chan, seen: 1 });
    return json({ ok: true });
  }
  // Typing: passed on, never stored.
  const me = list.find((p) => p.account_id === acct.id)?.email;
  await tell(list, { type: 'chat', chan, typing: me }, true);
  return json({ ok: true });
}
