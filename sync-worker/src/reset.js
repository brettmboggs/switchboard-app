// Forgot password (docs/DECISIONS.md, Nov 6 2026). The person asks with their
// email; this service emails a one-time code (and, when the web board is on, a
// link to it with the code filled in). Sending the code back with a new
// password proves they own the email, and the account gets the new password.
//
// The password also makes the key that locks the account's synced data, and
// this service never has that key. So a reset cannot open the old data here:
// it clears the account's encrypted documents, recovery key and sharing key,
// and signs out every computer and browser. Each one still has its own copy of
// the data, and uploads it, locked with the new password, when it signs in
// again. They stay in every shared project: the computer of whoever made the
// code (or the owner) locks each project to their new keys, with the same
// access, on its next sync.
//
// Two ways to get a code:
//   - a teammate: the owner or an admin of a shared project the person is in
//     makes one in Settings, Team, and gives it to them by text or in person
//     (the owner's pick, Nov 6: no email service to set up). That admin could use
//     it themselves, but they already run the projects it opens again for
//     them; anyone else's project asks its owner to compare check codes
//     first, and the person finds they are signed out;
//   - by email, when the service can send it: Resend (a free plan), with
//     RESEND_API_KEY a Worker secret and MAIL_FROM a variable such as
//     "Switchboard <reset@example.com>" on a domain verified there.
//
//   POST /v1/reset/issue   { email }  (signed in)               { code }
//   POST /v1/reset/start   { email }                           always { ok } (does not say who has an account)
//   POST /v1/reset/finish  { email, code, salt, auth, device } { token }

const ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';   // no I, L, O, U: read back without mistakes
const CODE_LEN = 12, KEEP = 30 * 60e3, TRIES = 5;
export const normCode = (t) => String(t || '').toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1').replace(/[^0-9A-Z]/g, '');
export const mailOn = (env) => !!(env.RESEND_API_KEY && env.MAIL_FROM);

function newCode() {
  const b = crypto.getRandomValues(new Uint8Array(CODE_LEN));
  return [...b].map((x) => ALPHA[x % 32]).join('');
}

async function sendMail(env, to, code, link) {
  const shown = code.match(/.{4}/g).join('-');
  const text = [
    'Someone asked to reset the password for your Switchboard account.',
    '',
    `Your code: ${shown}`,
    ...(link ? ['', `Or open this link to set a new password: ${link}`] : []),
    '',
    'It works once, for 30 minutes. Setting a new password signs out your computers; sign in on each again',
    'with the new password and it uploads your data again. If you did not ask for this, ignore this email.'
  ].join('\n');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject: `Your Switchboard reset code: ${shown}`, text })
  });
  return res.ok;
}

async function keepCode(env, sha256, accountId, code) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM password_resets WHERE account_id = ? OR created_at < ?').bind(accountId, Date.now() - KEEP),
    env.DB.prepare('INSERT INTO password_resets (account_id, code_hash, tries, created_at) VALUES (?, ?, 0, ?)').bind(accountId, await sha256(accountId + ':' + code), Date.now())
  ]);
}

// A teammate's code: only for someone in a shared project where the asker is owner or admin.
export async function resetIssue({ req, env, path, body, acct, json, bad, limited, sha256, cleanEmail }) {
  if (req.method !== 'POST' || path !== '/v1/reset/issue') return null;
  const email = cleanEmail(body.email);
  const target = await env.DB.prepare('SELECT id FROM accounts WHERE email = ?').bind(email).first();
  const may = target && target.id !== acct.id && await env.DB.prepare(
    "SELECT 1 FROM share_members me JOIN share_members them ON them.share_id = me.share_id WHERE me.account_id = ? AND me.role IN ('owner', 'admin') AND me.status = 'joined' AND them.account_id = ?"
  ).bind(acct.id, target.id).first();
  if (!may) return bad('You can make a reset code only for someone with an account who is in a project you own or run.', 403);
  if (await limited(env, 'reset', email, 3600e3)) return bad('A few codes have been made for them in the last hour. Use the newest one, or try again later.', 429);
  const code = newCode();
  await keepCode(env, sha256, target.id, code);
  return json({ code: code.match(/.{4}/g).join('-') });
}

export async function resetRoute({ req, env, path, body, json, bad, limited, sha256, slowHash, rand, issueToken, cleanEmail, validEmail, boardUrl }) {
  if (req.method !== 'POST' || (path !== '/v1/reset/start' && path !== '/v1/reset/finish')) return null;
  const email = cleanEmail(body.email);
  if (!validEmail(email)) return bad('Enter the email of your Switchboard account.');

  if (path === '/v1/reset/start') {
    if (!mailOn(env)) return bad('Codes are not sent by email here. Ask whoever invited you to a shared project: they can make you one in Settings, Team, Reset their password.', 503);
    if (await limited(env, 'reset', email, 3600e3)) return bad('A few codes have gone to that email in the last hour. Use the newest one, or try again later.', 429);
    const acct = await env.DB.prepare('SELECT id FROM accounts WHERE email = ?').bind(email).first();
    if (!acct) return json({ ok: true });
    const code = newCode();
    await keepCode(env, sha256, acct.id, code);
    const link = boardUrl ? `${boardUrl}/#reset=${code}&email=${encodeURIComponent(email)}` : null;
    let sent = false;
    try { sent = await sendMail(env, email, code, link); } catch {}
    if (!sent) {
      await env.DB.prepare('DELETE FROM password_resets WHERE account_id = ?').bind(acct.id).run();
      return bad('The email could not be sent just now. Try again in a few minutes.', 502);
    }
    return json({ ok: true });
  }

  // finish
  const wrong = () => bad('That code is not right, or it has run out. Check the newest email, or ask for a new code.', 400);
  if (!/^[0-9a-f]{32}$/.test(body.salt || '') || !/^[0-9a-f]{64}$/.test(body.auth || '')) return bad('Bad reset request.');
  const acct = await env.DB.prepare('SELECT id FROM accounts WHERE email = ?').bind(email).first();
  if (!acct) return wrong();
  const row = await env.DB.prepare('SELECT code_hash, tries, created_at FROM password_resets WHERE account_id = ?').bind(acct.id).first();
  if (!row || Date.now() - row.created_at > KEEP || row.tries >= TRIES) return wrong();
  if ((await sha256(acct.id + ':' + normCode(body.code))) !== row.code_hash) {
    await env.DB.prepare('UPDATE password_resets SET tries = tries + 1 WHERE account_id = ?').bind(acct.id).run();
    return wrong();
  }
  const authSalt = rand(16), id = acct.id;
  await env.DB.batch([
    env.DB.prepare('UPDATE accounts SET salt = ?, auth_hash = ?, auth_salt = ?, fails = 0, locked_until = NULL WHERE id = ?').bind(body.salt, await slowHash(body.auth, authSalt), authSalt, id),
    env.DB.prepare('DELETE FROM password_resets WHERE account_id = ?').bind(id),
    // Every computer and browser signs in again with the new password.
    env.DB.prepare('DELETE FROM tokens WHERE account_id = ?').bind(id),
    env.DB.prepare('DELETE FROM pairings WHERE account_id = ?').bind(id),
    // Locked with the old password's key: nobody can open these any more.
    env.DB.prepare('DELETE FROM docs WHERE account_id = ?').bind(id),
    env.DB.prepare('DELETE FROM key_wraps WHERE account_id = ?').bind(id),
    // Their projects stay theirs: the owner's or an admin's computer locks each one to the new sharing key
    // once it is made (share-core.js, relockAfterReset).
    env.DB.prepare('DELETE FROM share_keys WHERE account_id = ?').bind(id)
  ]);
  return json({ token: await issueToken(env, id, body.device) });
}
