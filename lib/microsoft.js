// Microsoft 365 (work Teams chats and Outlook mail) through Microsoft Graph.
// Read only. Sign-in is the device-code flow: Switchboard shows a short code,
// the user enters it at microsoft.com/devicelogin, and Switchboard keeps the
// refresh token in its local database. Needs an app registration in the
// tenant (see README) with delegated Chat.Read, Mail.Read and User.Read.
import { getSetting, setSetting } from './db.js';
import { spaceForPeople } from './spaces.js';
import { alert } from './notify.js';
import { friendlyError } from './friendly.js';

// Automated senders never count as someone waiting on the user.
const AUTOMATED = /(no-?reply|do-?not-?reply|notifications?@|alerts?@|weekly@|digest@|news(letter)?@|updates?@|@update\.|@(e|em|mail|email|news|info|marketing)\.|mailer-daemon|postmaster|teams\.mail\.microsoft|@microsoft\.com$|calendar-notification)/i;
const RECEIPT = /(receipt|invoice|your (order|subscription|bill|payment)|payment (received|confirmation)|renew|billing|billed)/i;
const money = (s) => { const m = s && s.match(/\$\s?([\d,]+\.\d{2})/); return m ? parseFloat(m[1].replace(/,/g, '')) : null; };

// Reading needs the first set; replying, archiving and marking read need the second.
// A sign-in made before replies existed only has the first, and keeps working.
const READ_SCOPES = 'offline_access User.Read Chat.Read Mail.Read';
const SCOPES = READ_SCOPES + ' ChatMessage.Send Mail.Send Mail.ReadWrite';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const DAYS = 14;

export const msConfig = () => getSetting('microsoft', null);
const save = (c) => setSetting('microsoft', c);

let token = { value: null, exp: 0 };
let state = { at: null, ok: null, error: null, threads: [], receipts: [], recent: [], chats: [], signIn: null };
export const microsoft = () => state;

async function form(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

const authority = (tenant) => `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0`;

// Step 1: ask Microsoft for a code. Step 2 runs in the background until the user
// signs in, the code expires, or he cancels.
export async function startSignIn({ tenant, clientId, space }, onChange) {
  tenant = (tenant || '').trim(); clientId = (clientId || '').trim();
  if (!tenant || !clientId) return { error: 'Enter the tenant (Directory ID) and the Application (client) ID.' };
  const r = await form(`${authority(tenant)}/devicecode`, { client_id: clientId, scope: SCOPES });
  if (r.status !== 200) {
    const msg = r.json.error_description?.split('\r\n')[0] || '';
    if (/AADSTS50194|not configured as a multi-tenant/i.test(msg)) return { error: 'The Switchboard app only allows its own company so far. Use "Your own app registration" below with your tenant ID, or ask for multi-company sign-in to be switched on.' };
    return { error: msg || 'Microsoft refused the request. Check the two IDs.' };
  }
  save({ ...(msConfig() || {}), tenant, clientId, space: space || 'personal', refreshToken: null, account: null });
  state = { ...state, ok: null, error: null, signIn: { code: r.json.user_code, url: r.json.verification_uri, expires: Date.now() + r.json.expires_in * 1000 } };
  pollSignIn(tenant, clientId, r.json.device_code, (r.json.interval || 5) * 1000, onChange);
  return { code: r.json.user_code, url: r.json.verification_uri };
}

async function pollSignIn(tenant, clientId, deviceCode, every, onChange) {
  while (state.signIn && Date.now() < state.signIn.expires) {
    await new Promise((res) => setTimeout(res, every));
    const r = await form(`${authority(tenant)}/token`, { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: clientId, device_code: deviceCode });
    if (r.status === 200) {
      save({ ...msConfig(), refreshToken: r.json.refresh_token, canWrite: /Mail\.Send/i.test(r.json.scope || '') });
      token = { value: r.json.access_token, exp: Date.now() + (r.json.expires_in - 120) * 1000 };
      state = { ...state, signIn: null };
      await pollMicrosoft();
      onChange?.();
      return;
    }
    const err = r.json.error;
    if (err === 'authorization_pending') continue;
    if (err === 'slow_down') { every += 5000; continue; }
    state = { ...state, signIn: null, ok: false, error: r.json.error_description?.split('\r\n')[0] || err };
    onChange?.();
    return;
  }
  if (state.signIn) { state = { ...state, signIn: null, ok: false, error: 'The code expired before sign-in finished. Try Connect again.' }; onChange?.(); }
}

export function disconnect() {
  save(null);
  token = { value: null, exp: 0 };
  state = { at: null, ok: null, error: null, threads: [], receipts: [], recent: [], chats: [], signIn: null };
}

async function accessToken() {
  if (token.value && Date.now() < token.exp) return token.value;
  const c = msConfig();
  if (!c?.refreshToken) return null;
  let r = await form(`${authority(c.tenant)}/token`, { grant_type: 'refresh_token', client_id: c.clientId, refresh_token: c.refreshToken, scope: c.canWrite === false ? READ_SCOPES : SCOPES });
  if (r.status !== 200 && /AADSTS65001/.test(r.json.error_description || '') && c.canWrite !== false) {
    save({ ...c, canWrite: false });
    r = await form(`${authority(c.tenant)}/token`, { grant_type: 'refresh_token', client_id: c.clientId, refresh_token: c.refreshToken, scope: READ_SCOPES });
  } else if (r.status === 200 && c.canWrite === undefined) save({ ...msConfig(), canWrite: true });
  if (r.status !== 200) throw new Error(r.json.error_description?.split('\r\n')[0] || 'Microsoft sign-in expired. Connect again in Settings.');
  if (r.json.refresh_token) save({ ...msConfig(), refreshToken: r.json.refresh_token });
  token = { value: r.json.access_token, exp: Date.now() + (r.json.expires_in - 120) * 1000 };
  return token.value;
}

async function graph(path, method = 'GET', body, extraHeaders = {}) {
  const t = await accessToken();
  const res = await fetch(path.startsWith('http') ? path : GRAPH + path, {
    method, headers: { Authorization: `Bearer ${t}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 202 || res.status === 204) return {};
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message || friendlyError(`${res.status}`, 'Microsoft'));
  return json;
}

const text = (html) => String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

// The other person's name in a one-on-one chat, looked up once.
const names = new Map();
async function oneOnOneName(chatId, meId) {
  if (names.has(chatId)) return names.get(chatId);
  let name = 'Teams chat';
  try {
    const d = await graph(`/me/chats/${encodeURIComponent(chatId)}/members`);
    name = (d.value || []).find((m) => m.userId !== meId)?.displayName || name;
  } catch {}
  names.set(chatId, name);
  return name;
}

let busy = false;
const notified = new Set();
export async function pollMicrosoft() {
  const c = msConfig();
  if (!c?.refreshToken || busy) return;
  busy = true;
  try {
    if (!c.account) {
      const me = await graph('/me?$select=id,displayName,mail,userPrincipalName');
      save({ ...msConfig(), account: { id: me.id, name: me.displayName, email: (me.mail || me.userPrincipalName || '').toLowerCase() } });
    }
    const me = msConfig().account;
    const since = Date.now() - DAYS * 86400e3;
    const space = (t) => spaceForPeople(t) || c.space || 'personal';
    const threads = [];
    const receipts = [];
    const recent = [];
    const all = [];   // every recent chat, whoever spoke last: the Inbox's Teams folder, so a chat can be opened again after it is answered

    // Teams chats: all of them for the Teams folder; those whose last message is from someone else are waiting on you.
    const chats = await graph('/me/chats?$expand=lastMessagePreview&$top=50&$orderby=lastMessagePreview/createdDateTime desc');
    for (const ch of chats.value || []) {
      const p = ch.lastMessagePreview;
      if (!p || p.isDeleted || p.messageType !== 'message') continue;
      const at = Date.parse(p.createdDateTime);
      const fromId = p.from?.user?.id;
      if (!fromId) continue;
      {
        const mine = fromId === me.id, who = mine ? 'You' : (p.from.user.displayName || 'Teams');
        const title = ch.chatType === 'oneOnOne' ? (ch.topic || (mine ? await oneOnOneName(ch.id, me.id) : who)) : (ch.topic || 'Group chat');
        const read = ch.viewpoint?.lastMessageReadDateTime ? Date.parse(ch.viewpoint.lastMessageReadDateTime) : 0;
        all.push({ key: `teams:${ch.id}`, account: me.email, threadId: ch.id, who: title, from: who, subject: 'Teams chat', snippet: `${who}: ${text(p.body?.content).slice(0, 300)}`, date: at, unread: !mine && read < at, kind: 'teams', space: space(title + ' microsoft teams'), count: 1, link: ch.webUrl, replied: mine });
      }
      if (at < since) continue;
      if (fromId === me.id) {
        // the user spoke last: not waiting, but still a live conversation.
        if (Date.now() - at < 7 * 86400e3) {
          const title = ch.chatType === 'oneOnOne' ? (ch.topic || await oneOnOneName(ch.id, me.id)) : (ch.topic || 'Group chat');
          recent.push({ key: `teams:${ch.id}`, account: me.email, threadId: ch.id, who: title, from: 'You', subject: 'Teams chat', snippet: 'You: ' + text(p.body?.content).slice(0, 300), date: at, unread: false, kind: 'teams', space: space(title + ' microsoft teams'), count: 1, link: ch.webUrl, replied: true });
        }
        continue;
      }
      const read = ch.viewpoint?.lastMessageReadDateTime ? Date.parse(ch.viewpoint.lastMessageReadDateTime) : 0;
      const who = p.from.user.displayName || 'Teams';
      const title = ch.chatType === 'oneOnOne' ? who : (ch.topic || `Group chat · ${who}`);
      const snippet = text(p.body?.content).slice(0, 400);
      threads.push({
        key: `teams:${ch.id}`, account: me.email, threadId: ch.id, who: title, from: who,
        subject: ch.chatType === 'oneOnOne' ? 'Teams chat' : `${who} in ${ch.topic || 'a group chat'}`,
        snippet, date: at, unread: read < at, kind: 'teams', space: space(title + ' ' + who + ' microsoft teams'),
        count: 1, link: ch.webUrl
      });
      if (read < at && Date.now() - at < 10 * 60e3 && !notified.has(ch.id + at)) { notified.add(ch.id + at); alert('teams', `Teams · ${who}`, snippet.slice(0, 140)); }
    }

    // Outlook: focused inbox mail newer than your last reply in that conversation.
    const iso = new Date(since).toISOString();
    const [inbox, sent] = await Promise.all([
      graph(`/me/mailFolders/inbox/messages?$top=50&$select=id,conversationId,subject,bodyPreview,from,receivedDateTime,isRead,webLink,inferenceClassification&$filter=receivedDateTime ge ${iso}&$orderby=receivedDateTime desc`),
      graph(`/me/mailFolders/sentitems/messages?$top=50&$select=conversationId,sentDateTime&$filter=sentDateTime ge ${iso}&$orderby=sentDateTime desc`)
    ]);
    const lastSent = new Map();
    for (const m of sent.value || []) lastSent.set(m.conversationId, Math.max(lastSent.get(m.conversationId) || 0, Date.parse(m.sentDateTime)));
    const seenConv = new Set();
    for (const m of inbox.value || []) {
      if (seenConv.has(m.conversationId)) continue;      // newest per conversation only
      seenConv.add(m.conversationId);
      const at = Date.parse(m.receivedDateTime);
      const from = m.from?.emailAddress || {};
      const addr = (from.address || '').toLowerCase();
      if (addr === me.email) continue;
      if (RECEIPT.test(m.subject || '')) {
        receipts.push({ account: me.email, msg_id: m.id, thread_id: m.conversationId, from_name: from.name || addr, from_addr: addr, subject: m.subject, snippet: m.bodyPreview || '', date: at, kind: 'receipt', amount: money(`${m.subject} ${m.bodyPreview}`), merchant: from.name || addr, space: space(`${addr} ${from.name} ${m.subject}`), link: m.webLink });
        continue;
      }
      if (AUTOMATED.test(addr) || m.inferenceClassification === 'other') continue;
      if ((lastSent.get(m.conversationId) || 0) > at) continue;
      threads.push({
        key: `outlook:${m.conversationId}`, account: me.email, threadId: m.conversationId,
        who: from.name || from.address, from: from.address, subject: m.subject || '(no subject)',
        snippet: m.bodyPreview || '', date: at, unread: !m.isRead, kind: 'outlook', messageId: m.id,
        space: space(`${from.address} ${from.name} ${m.subject}`), count: 1, link: m.webLink
      });
    }
    state = { ...state, at: Date.now(), ok: true, error: null, threads, receipts, recent, chats: all };
  } catch (e) {
    state = { ...state, at: Date.now(), ok: false, error: friendlyError(e, 'Microsoft') };
  } finally { busy = false; }
}

// ---------------------------------------------------------------------------
// Acting, only on the user's click. Needs the reply permissions (Connect again in
// Settings if this sign-in predates them).

function needWrite() {
  if (msConfig()?.canWrite === false) throw new Error('Replies need one more Microsoft sign-in: Settings, Microsoft 365, Connect.');
}

export const canWrite = () => msConfig()?.canWrite !== false;

export async function chatMessages(chatId) {
  const me = msConfig()?.account?.id;
  const d = await graph(`/me/chats/${encodeURIComponent(chatId)}/messages?$top=20`);
  return (d.value || []).filter((m) => m.messageType === 'message' && !m.deletedDateTime).map((m) => ({
    from_name: m.from?.user?.displayName || 'Someone', from_me: m.from?.user?.id === me ? 1 : 0,
    snippet: text(m.body?.content).slice(0, 800), date: Date.parse(m.createdDateTime)
  }));
}

// images: [{ type: 'image/png', data: base64 }], sent as Teams' own inline
// pictures (hostedContents), so the other person sees the picture itself.
export async function sendChat(chatId, body, images = []) {
  needWrite();
  const html = String(body || '').split(/\n/).map((l) => l.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))).join('<br>');
  const pics = images.map((_, i) => `<div><img src="../hostedContents/${i + 1}/$value" alt="picture"></div>`).join('');
  const msg = { body: { contentType: 'html', content: (html ? `<div>${html}</div>` : '') + pics } };
  if (images.length) msg.hostedContents = images.map((im, i) => ({ '@microsoft.graph.temporaryId': String(i + 1), contentBytes: im.data, contentType: im.type }));
  const sent = await graph(`/me/chats/${encodeURIComponent(chatId)}/messages`, 'POST', msg);
  state = { ...state, threads: state.threads.filter((t) => t.key !== `teams:${chatId}`) };
  return { id: sent?.id || null };
}

export async function outlookMessages(conversationId) {
  const me = msConfig()?.account?.email;
  const d = await graph(`/me/messages?$filter=conversationId eq '${conversationId.replace(/'/g, "''")}'&$top=15&$select=from,bodyPreview,receivedDateTime`);
  return (d.value || []).map((m) => ({
    from_name: m.from?.emailAddress?.name || m.from?.emailAddress?.address, from_me: (m.from?.emailAddress?.address || '').toLowerCase() === me ? 1 : 0,
    snippet: m.bodyPreview || '', date: Date.parse(m.receivedDateTime)
  })).sort((a, b) => b.date - a.date);
}

// images: [{ type, data (base64) }], attached to the reply (Graph takes about 3 MB in one request).
export async function replyOutlook(messageId, body, images = []) {
  needWrite();
  const attachments = images.map((im, i) => ({ '@odata.type': '#microsoft.graph.fileAttachment', name: `picture-${i + 1}.${({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' })[im.type] || 'png'}`, contentType: im.type, contentBytes: im.data }));
  await graph(`/me/messages/${encodeURIComponent(messageId)}/reply`, 'POST', { comment: String(body || '').replace(/\n/g, '<br>'), ...(attachments.length ? { message: { attachments } } : {}) });
  state = { ...state, threads: state.threads.filter((t) => t.messageId !== messageId) };
}

export async function archiveOutlook(messageId) {
  needWrite();
  await graph(`/me/messages/${encodeURIComponent(messageId)}`, 'PATCH', { isRead: true });
  await graph(`/me/messages/${encodeURIComponent(messageId)}/move`, 'POST', { destinationId: 'archive' });
  state = { ...state, threads: state.threads.filter((t) => t.messageId !== messageId) };
}

export async function readOutlook(messageId) {
  needWrite();
  await graph(`/me/messages/${encodeURIComponent(messageId)}`, 'PATCH', { isRead: true });
}

// The conversation view (lib/conversation.js): one page of the newest messages,
// raw from Graph. Asked every few seconds while a chat is open, so it is one
// small request: no members, no paging.
export const meAccount = () => msConfig()?.account || null;
export async function chatPage(chatId, top = 30) {
  const d = await graph(`/me/chats/${encodeURIComponent(chatId)}/messages?$top=${Math.min(50, top)}`);
  return d.value || [];
}
export async function outlookPage(conversationId, top = 30) {
  const d = await graph(`/me/messages?$filter=conversationId eq '${conversationId.replace(/'/g, "''")}'&$top=${Math.min(50, top)}&$select=id,from,subject,receivedDateTime,uniqueBody,bodyPreview,hasAttachments`, 'GET', null, { Prefer: 'outlook.body-content-type="text"' });
  return d.value || [];
}

// Whole conversations, for handing to an agent (oldest first, full text).
export async function fullChat(chatId, max = 15) {
  const me = msConfig()?.account?.id;
  const d = await graph(`/me/chats/${encodeURIComponent(chatId)}/messages?$top=${max}`);
  return (d.value || []).filter((m) => m.messageType === 'message' && !m.deletedDateTime)
    .map((m) => ({ from: m.from?.user?.id === me ? 'You' : (m.from?.user?.displayName || 'Someone'), date: Date.parse(m.createdDateTime), text: text(m.body?.content) }))
    .sort((a, b) => a.date - b.date);
}
export async function fullOutlook(conversationId, max = 6) {
  const me = msConfig()?.account?.email;
  const d = await graph(`/me/messages?$filter=conversationId eq '${conversationId.replace(/'/g, "''")}'&$top=${max}&$select=from,receivedDateTime,body,uniqueBody`, 'GET', null, { Prefer: 'outlook.body-content-type="text"' });
  return (d.value || []).map((m) => {
    const addr = (m.from?.emailAddress?.address || '').toLowerCase();
    return { from: addr === me ? 'You' : (m.from?.emailAddress?.name || addr), date: Date.parse(m.receivedDateTime), text: String(m.uniqueBody?.content || m.body?.content || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim() };
  }).sort((a, b) => a.date - b.date);
}

// A picture inside a Teams message (its hostedContents), for the Inbox to show:
// only Graph's own chat-message picture addresses, fetched with this sign-in.
// The address must be exactly what it says after the URL parser tidies it: a \ (read as /) or a
// "..", even written as %2e%2e, would otherwise climb to any Graph address ending in $value (review M4).
const HOSTED = /^https:\/\/graph\.microsoft\.com\/(v1\.0|beta)\/chats\/[^/?#\\]+\/messages\/[^/?#\\]+\/hostedContents\/[^/?#\\]+\/\$value$/;
export function isHostedUrl(u) {
  const s = String(u || '');
  if (!HOSTED.test(s)) return false;
  let p; try { p = new URL(s); } catch { return false; }
  return p.href === s && p.hostname === 'graph.microsoft.com' && !p.pathname.split('/').some((seg) => seg === '.' || seg === '..');
}
export async function hostedBytes(url) {
  if (!isHostedUrl(url)) throw Object.assign(new Error('Not a Teams picture.'), { status: 400 });
  const res = await fetch(url, { headers: { Authorization: `Bearer ${await accessToken()}` } });
  if (!res.ok) throw Object.assign(new Error(friendlyError(`${res.status}`, 'Microsoft')), { status: res.status === 404 ? 404 : 502 });
  const type = res.headers.get('content-type') || 'image/png';
  return { type: /^image\//.test(type) ? type : 'application/octet-stream', buf: Buffer.from(await res.arrayBuffer()) };
}

// An emoji reaction on a Teams message, added or taken back, as Teams shows it.
export async function reactChat(chatId, messageId, emoji, on = true) {
  needWrite();
  await graph(`/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/${on ? 'setReaction' : 'unsetReaction'}`, 'POST', { reactionType: emoji });
}

// Files on Outlook messages, for the Inbox (public/js/mailfiles.js): the list
// (names, types, sizes) and one file's bytes, with this sign-in.
export const okOutlookId = (id) => /^[A-Za-z0-9_\-+/=]{10,400}$/.test(String(id || ''));
export async function outlookFiles(messageId) {
  if (!okOutlookId(messageId)) throw Object.assign(new Error('That message is not in your mail.'), { status: 400 });
  const d = await graph(`/me/messages/${encodeURIComponent(messageId)}/attachments?$select=id,name,contentType,size,isInline`);
  return (d.value || []).filter((a) => a['@odata.type'] === '#microsoft.graph.fileAttachment' && okOutlookId(a.id))
    .map((a) => ({ id: a.id, name: String(a.name || 'file').replace(/[\r\n"\\/]/g, '').slice(0, 200), type: String(a.contentType || 'application/octet-stream').toLowerCase(), size: Number(a.size) || 0, inline: !!a.isInline }));
}
export async function outlookFile(messageId, attachmentId) {
  if (!okOutlookId(messageId) || !okOutlookId(attachmentId)) throw Object.assign(new Error('That file is not in your mail.'), { status: 400 });
  const res = await fetch(`${GRAPH}/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}/$value`, { headers: { Authorization: `Bearer ${await accessToken()}` } });
  if (!res.ok) throw Object.assign(new Error(friendlyError(`${res.status}`, 'Microsoft')), { status: res.status === 404 ? 404 : 502 });
  return Buffer.from(await res.arrayBuffer());
}
