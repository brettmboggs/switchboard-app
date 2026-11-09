// One open conversation, for the Inbox's conversation view: the newest
// messages of a Teams chat, an Outlook conversation or a mail / Google Voice
// thread, oldest first, each with a stable id so the page can add new ones
// without redrawing the rest. The page asks every few seconds while a Teams
// chat is open, so identical asks within a moment share one Graph request.
import { threadMessages } from './gmail.js';
import { chatPage, outlookPage, meAccount, isHostedUrl } from './microsoft.js';

const LIMITS = { teams: 50, outlook: 50, mail: 200 };   // Graph's page size caps at 50
const FRESH = { teams: 1500, outlook: 4000, mail: 0 };    // ms an answer is reused
const cache = new Map();                                  // key|limit -> { at, p }

export function parseKey(key) {
  const [kind, ...rest] = String(key || '').split(':');
  if (kind === 'mail') return { kind, account: rest[0], id: rest.slice(1).join(':') };
  if (kind === 'teams' || kind === 'outlook') return { kind, id: rest.join(':') };
  return null;
}

// Teams and Outlook bodies are HTML: keep the words, the line breaks and the links.
const ENT = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };
export function htmlToText(html) {
  return String(html || '')
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => {
      const l = label.replace(/<[^>]+>/g, '').trim();
      return !l || l === href || !/^https?:/i.test(href) ? (l || href) : `${l} (${href})`;
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|h\d|tr|blockquote|ul|ol)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENT[e.toLowerCase()] ?? m))
    .replace(/ /g, ' ')
    .split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const gist = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 40);

// Oldest first, one per id, at most `limit` (the newest). A reply Switchboard
// sent is stored at once as "local-…"; when the mail server's own copy arrives,
// the local stand-in goes.
export function tidy(list, limit) {
  const seen = new Set();
  const real = list.filter((m) => m.from_me && !String(m.id).startsWith('local-')).map((m) => gist(m.text)).filter(Boolean);
  return list
    .filter((m) => m.id && !seen.has(m.id) && seen.add(m.id))
    .filter((m) => { const g = gist(m.text); return !(String(m.id).startsWith('local-') && g && real.some((r) => r.startsWith(g) || g.startsWith(r))); })
    .sort((a, b) => a.date - b.date)
    .slice(-limit);
}

// Teams' older reaction names, as the emoji Teams draws for them.
const REACTION = { like: '👍', heart: '❤️', laugh: '😆', surprised: '😮', sad: '😢', angry: '😡' };
// Pictures in a Teams message: Graph addresses (hostedContents) that only this
// sign-in can open, so the page asks for them through /api/teams/picture.
export function teamsPictures(html) {
  return [...String(html || '').matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi)].map((x) => x[1].replace(/&amp;/g, '&'))
    .filter(isHostedUrl)
    .slice(0, 10).map((u) => '/api/teams/picture?u=' + encodeURIComponent(u));
}
// Reactions on a message, one per emoji: how many, who, and whether one is yours.
export function teamsReactions(list, meId) {
  const by = new Map();
  for (const r of list || []) {
    const emoji = REACTION[r.reactionType] || r.reactionType;
    if (!emoji) continue;
    const e = by.get(emoji) || { emoji, n: 0, mine: false, who: [] };
    e.n++; if (r.user?.user?.id && r.user.user.id === meId) e.mine = true;
    if (r.user?.user?.displayName) e.who.push(r.user.user.displayName);
    by.set(emoji, e);
  }
  return [...by.values()];
}

export function fromTeams(raw, meId) {
  return (raw || []).filter((m) => m.messageType === 'message' && !m.deletedDateTime).map((m) => {
    const files = (m.attachments || []).filter((a) => a.contentType === 'reference' && a.contentUrl).map((a) => `Attachment: ${a.name || 'file'} ${a.contentUrl}`);
    const pictures = m.body?.contentType === 'html' ? teamsPictures(m.body.content) : [];
    const body = m.body?.contentType === 'html' ? htmlToText(m.body.content) : String(m.body?.content || '').trim();
    return {
      id: m.id, from_name: m.from?.user?.displayName || m.from?.application?.displayName || 'Someone', from_me: m.from?.user?.id && m.from.user.id === meId ? 1 : 0,
      text: [body, ...files].filter(Boolean).join('\n') || (pictures.length ? '' : '(no text)'), date: Date.parse(m.createdDateTime), edited: m.lastEditedDateTime ? Date.parse(m.lastEditedDateTime) : null,
      ...(pictures.length ? { pictures } : {}), ...(m.reactions?.length ? { reactions: teamsReactions(m.reactions, meId) } : {})
    };
  });
}

export function fromOutlook(raw, meEmail) {
  return (raw || []).map((m) => {
    const addr = (m.from?.emailAddress?.address || '').toLowerCase();
    const body = m.uniqueBody?.content ?? m.body?.content ?? m.bodyPreview ?? '';
    const text = m.uniqueBody?.contentType === 'html' || m.body?.contentType === 'html' ? htmlToText(body) : String(body).replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
    return { id: m.id, from_name: m.from?.emailAddress?.name || addr, from_addr: addr, from_me: addr && addr === meEmail ? 1 : 0, subject: m.subject || '', text, date: Date.parse(m.receivedDateTime), ...(m.hasAttachments ? { hasFiles: true } : {}) };
  });
}

export function fromMail(rows) {
  return (rows || []).map((r) => ({ id: r.msg_id, from_name: r.from_me ? 'You' : (r.from_name || r.from_addr), from_addr: r.from_addr, from_me: r.from_me ? 1 : 0, subject: r.subject || '', text: r.snippet || '', date: r.date }));
}

async function fetchOne(k, limit) {
  if (k.kind === 'teams') return fromTeams(await chatPage(k.id, limit), meAccount()?.id);
  if (k.kind === 'outlook') return fromOutlook(await outlookPage(k.id, limit), meAccount()?.email);
  return fromMail(threadMessages(k.account, k.id, limit));
}

// { messages: oldest first, more: true when earlier ones may exist }
export async function conversation(key, limit = 40) {
  const k = parseKey(key);
  if (!k || !k.id) throw Object.assign(new Error('Unknown conversation.'), { status: 400 });
  const n = Math.max(1, Math.min(LIMITS[k.kind], Math.floor(Number(limit) || 40)));
  const ck = `${key}|${n}`;
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < FRESH[k.kind]) return hit.p;
  const p = fetchOne(k, n).then((list) => ({ messages: tidy(list, n), more: list.length >= n && n < LIMITS[k.kind] }));
  cache.set(ck, { at: Date.now(), p });
  p.catch(() => cache.delete(ck));
  if (cache.size > 40) cache.delete(cache.keys().next().value);
  return p;
}

// After a reply: the next ask goes to the source, not the cache.
export function forget(key) {
  for (const k of cache.keys()) if (k.startsWith(key + '|')) cache.delete(k);
}
