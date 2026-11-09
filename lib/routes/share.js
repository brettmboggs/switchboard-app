// Shared projects and your team (lib/share.js): add someone to a project with
// what they may see and edit, change that, make someone an admin, remove
// them, leave, stop; the invite email (previewed, then sent on your click from
// your own mail); an invite link opened on this computer; and which sync
// service this computer uses (your own, if you run one).
// Called by server.js for every request after its host and header checks;
// sends a response when the path is one of these, otherwise does nothing.
import { sessions, sessionChat, sessionSend, inviteBase, shareProject, acceptShare, leaveShare, leaveSpace, removeMember, removePerson, resetCodeFor, stopSharing, shareState, setAccess, setRole, pagesHere, answerInvite, admitInvite, cancelInvite, trustNewKeys, markChecked, keepInviteLink, LEVELS, SHARE_KINDS } from '../share.js';
import { setSyncServer, syncStatus } from '../sync.js';
import { inviteEmail } from '../emails/invite.js';
import { sendBranded, sendAddresses } from '../gmail.js';
import { getSetting, setSetting } from '../db.js';
import { cloneRepo, codeRoots } from '../clone.js';
import { friendlyError } from '../friendly.js';
import { send, readJson } from '../http.js';

const kindsFrom = (k) => k && typeof k === 'object' ? Object.fromEntries(SHARE_KINDS.filter((x) => LEVELS.includes(k[x])).map((x) => [x, k[x]])) : undefined;
// Only a link this Switchboard makes goes into an invite email.
const okLink = (l) => typeof l === 'string' && l.startsWith(inviteBase() + '#join?') && /[?&]t=[0-9a-f]{64}(&|$)/.test(l) && l.length < 800;
const me = () => getSetting('sync', null)?.email || '';
const myName = () => getSetting('profileName', null) || me().split('@')[0].replace(/^\w/, (c) => c.toUpperCase());

function inviteMail(b) {
  if (!okLink(b.link)) throw new Error('That invitation link is not one Switchboard made. Invite them again.');
  const to = String(b.to || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new Error('Who should the email go to?');
  const from = sendAddresses().find((a) => a.address.toLowerCase() === String(b.from || '').toLowerCase())?.address || sendAddresses()[0]?.address || null;
  const name = String(b.fromName || myName()).slice(0, 60);
  return { to, from, fromName: name, ...inviteEmail({ inviterName: name, project: String(b.project || ''), link: b.link, kinds: kindsFrom(b.kinds) || {}, account: !!b.account }) };
}

export async function route({ req, res, path, url, changed }) {
  if (path !== '/api/share' && !path.startsWith('/api/share/') && path !== '/api/sync-server') return;
  if (req.method === 'GET' && path === '/api/share') return send(res, 200, shareState());
  // How many pages a project has, for "Share the 12 pages already here?".
  if (req.method === 'GET' && path === '/api/share/pages') return send(res, 200, { count: pagesHere(String(url.searchParams.get('space') || '')) });
  // A shared project's sessions (you are a member): from its owner's computer, while it is online.
  if (req.method === 'GET' && path === '/api/share/sessions') { try { return send(res, 200, { sessions: await sessions(String(url.searchParams.get('space') || '')) }); } catch (e) { return e.offline ? send(res, 200, { offline: e.message }) : send(res, 400, { error: friendlyError(e, 'the sync service') }); } }
  if (req.method === 'GET' && path === '/api/share/session') {
    try { return send(res, 200, await sessionChat(String(url.searchParams.get('space') || ''), String(url.searchParams.get('term') || ''), { file: url.searchParams.get('file') || undefined, from: url.searchParams.get('from') ?? undefined, before: url.searchParams.get('before') ?? undefined })); }
    catch (e) { return send(res, 400, { error: friendlyError(e, 'the session') }); }
  }
  if (req.method !== 'POST') return;
  const b = await readJson(req);
  // Your own sync service (before signing in). Empty goes back to the product's.
  if (path === '/api/sync-server') {
    try { const server = setSyncServer(String(b.url || '')); changed(); return send(res, 200, { ok: true, server, account: syncStatus() }); }
    catch (e) { return send(res, 400, { error: friendlyError(e, 'the sync service') }); }
  }
  const act = path === '/api/share' ? 'invite' : path.slice('/api/share/'.length);
  const space = String(b.space || ''), id = String(b.id || '');
  try {
    let out = {};
    if (act === 'invite') out = await shareProject(space, String(b.email || ''), String(b.name || ''), { kinds: kindsFrom(b.kinds), existing: b.existing === 'private' ? 'private' : 'share' });
    else if (act === 'access') out = { kinds: await setAccess(space, String(b.email || ''), kindsFrom(b.kinds) || {}) };
    else if (act === 'role') await setRole(String(b.email || ''), b.role === 'admin' ? 'admin' : 'member');
    else if (act === 'accept') out = await acceptShare(id);
    else if (act === 'answer') out = await answerInvite(id, !!b.yes);
    else if (act === 'decline') await leaveShare(id);
    else if (act === 'leave') await leaveSpace(space);
    else if (act === 'remove') await removeMember(space, String(b.email || ''));
    else if (act === 'remove-person') out = { projects: await removePerson(String(b.email || '')) };
    else if (act === 'reset-code') out = { code: await resetCodeFor(String(b.email || '')) };
    // Someone who answered an invitation without its link: the owner checks the address and lets them in.
    else if (act === 'admit') out = await admitInvite(space, id);
    // Check codes (Team): keep someone's new keys once the codes match; mark someone checked.
    else if (act === 'keys-trust') out = await trustNewKeys(String(b.email || ''), String(b.code || ''));
    else if (act === 'keys-checked') markChecked(String(b.email || ''), !!b.yes);
    else if (act === 'cancel-invite') await cancelInvite(space, id);
    else if (act === 'stop') await stopSharing(space);
    // An invite link opened here (#join): kept, and used once this account can.
    else if (act === 'link') keepInviteLink(String(b.token || ''), String(b.project || ''));
    // The invite email: what it will say, then sent on the click.
    else if (act === 'mail-preview') { const m = inviteMail(b); out = { to: m.to, from: m.from, fromName: m.fromName + ' via Switchboard', subject: m.subject, text: m.text, html: m.html, canSend: !!m.from }; }
    else if (act === 'mail-send') { const m = inviteMail(b); const r = await sendBranded(m); out = { sent: true, from: r.from }; }
    // A shared repo, copied into one of your code folders with your own GitHub sign-in.
    else if (act === 'clone') out = await cloneRepo(String(b.repo || ''), b.root ? String(b.root) : null);
    else if (act === 'roots') out = { roots: codeRoots() };
    else if (act === 'session-send') out = await sessionSend(space, String(b.term || ''), String(b.text || ''));
    // Yours: let one person's messages into one of your sessions without asking each time.
    else if (act === 'session-auto') {
      // From a held "Jordan asks" line (its queue id), or by person and session.
      const ask = b.queue != null ? getSetting('askFrom', {})[String(b.queue)] : null;
      const who = String(ask?.email || b.email || '').toLowerCase(), t = String(ask?.term || b.term || '');
      if (!who || !t) throw new Error('That message is not one someone asked to send.');
      const all = getSetting('sessionAuto', {}), m = { ...(all[who] || {}) };
      if (b.on === false) delete m[t]; else m[t] = true;
      setSetting('sessionAuto', { ...all, [who]: m });
      out = { email: who, term: t };
    }
    else return send(res, 404, { error: 'Not found.' });
    changed();
    return send(res, 200, { ok: true, ...out, share: shareState() });
  } catch (e) {
    return send(res, 400, { error: friendlyError(e, act.startsWith('mail') ? 'your mail server' : act === 'clone' ? 'GitHub' : 'the sync service') });
  }
}
