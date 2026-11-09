// Team chat on the page (lib/chat.js): a channel for each shared project and
// one-to-one chats with your teammates, opened in the Inbox's conversation view
// (convo.js) with its composer, mic, pictures and reactions (teamspics.js).
// What this adds there, which Teams cannot give us:
//   Seen       under your messages, who has read up to there (hover a message for everyone)
//   Typing     "Jordan is typing…" above the reply box
//   Edit, Delete   on your own messages, in place; everyone sees "edited" or "deleted"
//   Reply      quote a message in yours; click the quote to jump to it
//   @mention   type @ and a name; they get an alert and a phone push
//   Pin        keep a message at hand in Details, for everyone in the chat
// Start a chat from the chips above the Inbox list.
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
let TC = { key: null, reply: null, members: [], pins: [], unreadable: 0, editing: null, sideHtml: '' };
const tcOn = () => CV && CV.kind === 'team';

// ---------- Inbox: start a chat
function tcStartHtml() {
  const list = S?.chat?.channels || [];
  if (!list.length || !['all', 'team'].includes(inboxSource)) return '';
  return `<div class="tc-start" role="group" aria-label="Team chat"><span class="tc-start-label">Team chat</span>${list.map((c) => `<button class="chip" type="button" data-tc-open="${esc(c.key)}" title="${c.kind === 'project' ? `Everyone in ${esc(c.who)}` : `Just you and ${esc(c.who)}`}">${c.kind === 'project' ? '# ' : ''}${esc(c.who)}</button>`).join('')}</div>`;
}
// A chat with nothing in it yet is not in the lists; this is it, for find().
function tcThread(key) {
  const c = (S?.chat?.channels || []).find((x) => x.key === key);
  return c ? { key: c.key, kind: 'team', who: c.who, from: c.who, subject: c.kind === 'project' ? 'Project chat' : 'Team chat', snippet: '', date: 0, space: c.space, count: 0, replied: true } : null;
}

// ---------- in the conversation
function tcComposerTop(x) {
  return `<div class="tc-typing" id="tc-typing" aria-live="polite"></div><div class="tc-replying" id="tc-replying" hidden></div><div class="tc-mention" id="tc-mention" role="listbox" aria-label="People to mention" hidden></div>`;
}
const tcHint = (x) => x.subject === 'Project chat' ? `Goes to everyone in ${x.who}, sealed so only they can read it.` : `Goes to ${x.who} alone, sealed so only the two of you can read it.`;

// The message a reply quotes, above its text.
function tcQuote(m) {
  if (!m.reply) return '';
  return `<button class="tc-quote" type="button" data-tc-goto="${esc(m.reply.id)}" title="Show that message"><b>${esc(m.reply.from_name)}</b> ${esc(m.reply.text)}</button>`;
}
// @Name in a message, marked. A message that mentions you has its @words marked whatever your name is to them.
function tcText(m) {
  let html = linkify(m.text);
  if (m.mention) return html.replace(/(^|\s)(@[\p{L}\p{N}._-]+)/gu, (x, sp, t) => `${sp}<span class="tc-at">${t}</span>`);
  for (const p of [...TC.members.map((x) => x.name), 'You'].filter(Boolean)) {
    html = html.replace(new RegExp('@' + p.split(/\s+/)[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\p{N}])', 'giu'), (t) => `<span class="tc-at">${t}</span>`);
  }
  return html;
}
// Under a message: deleted, edited, pinned, seen; and its buttons on hover.
function tcExtras(m) {
  if (cvStandIn(m)) return '';
  if (m.deleted) return `<div class="tc-gone">${m.from_me ? 'You deleted this message.' : 'This message was deleted.'}</div>`;
  const marks = [m.edited ? `<span title="Edited ${esc(new Date(m.edited).toLocaleString())}">edited</span>` : '', m.pinned ? '<span>pinned</span>' : ''].filter(Boolean).join(' · ');
  const seen = m.from_me && m.seen?.length ? `<div class="tc-seen" title="Seen by ${esc((m.seenBy || m.seen).join(', '))}">Seen by ${esc(m.seen.join(', '))}</div>` : '';
  const acts = `<span class="tc-acts" role="group" aria-label="Message actions"><button type="button" data-tc="reply">Reply</button><button type="button" data-tc="pin">${m.pinned ? 'Unpin' : 'Pin'}</button>${m.from_me ? '<button type="button" data-tc="edit">Edit</button><button type="button" data-tc="delete">Delete</button>' : ''}</span>`;
  return (marks ? `<div class="tc-marks">${marks}</div>` : '') + acts + seen;
}
function tcSide() {
  const pins = TC.pins.length ? `<div class="section-label">Pinned</div><div class="tc-pins">${TC.pins.map((p) => `<button class="tc-pin" type="button" data-tc-goto="${esc(p.id)}"><b>${esc(p.from_name)}</b> ${esc(p.text)}<span class="muted">Pinned by ${esc(p.by)}</span></button>`).join('')}</div>` : '';
  const who = `<div class="section-label">In this chat</div><p class="note-line">${esc(['You', ...TC.members.map((x) => x.name)].join(', '))}</p>`;
  const old = TC.unreadable ? `<p class="note-line">${TC.unreadable} earlier line${TC.unreadable === 1 ? ' is' : 's are'} from before you joined, so this computer has no key for ${TC.unreadable === 1 ? 'it' : 'them'}.</p>` : '';
  return pins + who + old;
}

// After each fetch: who is typing, pins and people, and your read mark.
function tcAfterPull(d) {
  if (TC.key !== CV.key) TC = { key: CV.key, reply: null, members: [], pins: [], unreadable: 0, editing: null, sideHtml: '' };
  TC.members = d.members || []; TC.pins = d.pins || []; TC.unreadable = d.unreadable || 0;
  const t = $('tc-typing');
  if (t) { const n = d.typing || []; t.textContent = !n.length ? '' : n.length === 1 ? `${n[0]} is typing…` : n.length === 2 ? `${n[0]} and ${n[1]} are typing…` : 'Several people are typing…'; }
  const side = tcSide();
  if (side !== TC.sideHtml) { TC.sideHtml = side; CV.sideHtml = ''; paintSide(); }
  if (!document.hidden && CV.atBottom && d.last > (d.seenUpTo || 0)) api('/api/chat/seen', { key: CV.key }).catch(() => {});
}
function tcReplyTake() { const r = TC.reply?.id || null; TC.reply = null; tcDrawReply(); return r; }
function tcDrawReply() {
  const el = $('tc-replying'); if (!el) return;
  el.hidden = !TC.reply;
  el.innerHTML = TC.reply ? `<span>Replying to <b>${esc(TC.reply.from_name)}</b>: ${esc(String(TC.reply.text || 'A picture').slice(0, 120))}</span><button type="button" data-tc="unreply" aria-label="Do not reply to it">×</button>` : '';
}

// ---------- edit and delete, in place (no browser dialogs)
function tcEdit(m) {
  const el = cvList().querySelector(`.cv-msg[data-id="${CSS.escape(m.id)}"] .cv-content`);
  if (!el) return;
  TC.editing = m.id;
  const box = document.createElement('div');
  box.className = 'tc-edit';
  box.innerHTML = `<label class="sr" for="tc-edit-text">Edit your message</label><textarea id="tc-edit-text" rows="2">${esc(m.text)}</textarea><div class="form-row"><button class="btn btn--primary" type="button" data-tc="save">Save</button><button class="btn" type="button" data-tc="cancel">Cancel</button><span class="note-line">Everyone sees it was edited.</span></div>`;
  el.querySelector('.cv-text')?.replaceWith(box);
  if (!el.contains(box)) el.prepend(box);
  const ta = box.querySelector('textarea'); ta.focus(); ta.selectionStart = ta.value.length;
}
async function tcSaveEdit(m) {
  const text = $('tc-edit-text')?.value || '';
  try { await api('/api/chat/act', { key: CV.key, what: 'edit', id: m.id, text }); m.text = text.trim(); m.edited = Date.now(); TC.editing = null; redraw(m); pullConvo(); }
  catch (e) { toast('Not saved: ' + e.message, { kind: 'error' }); }
}
async function tcAct(m, what, extra = {}) {
  try { await api('/api/chat/act', { key: CV.key, what, id: m.id, ...extra }); pullConvo(); }
  catch (e) { toast(e.message, { kind: 'error' }); }
}

// ---------- @mention suggestions
function tcMentionList() {
  const ta = $('r-text'), box = $('tc-mention');
  if (!ta || !box) return;
  const before = ta.value.slice(0, ta.selectionStart), at = before.match(/(^|\s)@([\p{L}\p{N}._-]*)$/u);
  const q = at ? at[2].toLowerCase() : null;
  const hits = q === null ? [] : TC.members.filter((x) => x.name.toLowerCase().startsWith(q) || x.email.startsWith(q)).slice(0, 6);
  box.hidden = !hits.length;
  box.innerHTML = hits.map((x, i) => `<button type="button" role="option" aria-selected="${i === 0}" data-tc-at="${esc(x.name.split(/\s+/)[0])}">${esc(x.name)}<span class="muted">${esc(x.email)}</span></button>`).join('');
}
function tcMentionPick(name) {
  const ta = $('r-text'); if (!ta) return;
  const pos = ta.selectionStart, before = ta.value.slice(0, pos).replace(/@[\p{L}\p{N}._-]*$/u, '@' + name + ' ');
  ta.value = before + ta.value.slice(pos); ta.selectionStart = ta.selectionEnd = before.length;
  draft[CV.key] = ta.value; $('tc-mention').hidden = true; ta.focus();
}

document.addEventListener('click', (e) => {
  const open = e.target.closest('[data-tc-open]');
  if (open) { selected = { type: 'thread', key: open.dataset.tcOpen }; render(); return; }
  if (!tcOn()) return;
  const go = e.target.closest('[data-tc-goto]');
  if (go) {
    const el = cvList().querySelector(`.cv-msg[data-id="${CSS.escape(go.dataset.tcGoto)}"]`);
    if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('tc-flash'); setTimeout(() => el.classList.remove('tc-flash'), 1600); } else toast('That message is further back. Load earlier messages to see it.');
    return;
  }
  const at = e.target.closest('[data-tc-at]');
  if (at) { tcMentionPick(at.dataset.tcAt); return; }
  const b = e.target.closest('[data-tc]');
  if (!b) return;
  if (b.dataset.tc === 'unreply') { TC.reply = null; tcDrawReply(); return; }
  const m = CV.byId.get(b.closest('.cv-msg')?.dataset.id);
  if (!m) return;
  const what = b.dataset.tc;
  if (what === 'reply') { TC.reply = { id: m.id, from_name: m.from_me ? 'yourself' : m.from_name, text: m.text }; tcDrawReply(); $('r-text')?.focus(); }
  else if (what === 'pin') tcAct(m, 'pin', { on: !m.pinned });
  else if (what === 'edit') tcEdit(m);
  else if (what === 'save') tcSaveEdit(m);
  else if (what === 'cancel') { TC.editing = null; redraw(m); }
  else if (what === 'delete') { b.dataset.tc = 'delete-yes'; b.textContent = 'Delete for everyone?'; b.classList.add('tc-sure'); setTimeout(() => { if (b.isConnected) { b.dataset.tc = 'delete'; b.textContent = 'Delete'; b.classList.remove('tc-sure'); } }, 4000); }
  else if (what === 'delete-yes') tcAct(m, 'delete');
});
document.addEventListener('input', (e) => {
  if (!tcOn() || e.target.id !== 'r-text') return;
  if (e.target.value.trim()) api('/api/chat/typing', { key: CV.key }).catch(() => {});
  tcMentionList();
});
document.addEventListener('keydown', (e) => {
  if (!tcOn()) return;
  if (e.target.id === 'tc-edit-text') {
    const m = CV.byId.get(TC.editing);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); TC.editing = null; if (m) redraw(m); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && m) { e.preventDefault(); tcSaveEdit(m); }
    return;
  }
  if (e.target.id === 'r-text' && !$('tc-mention')?.hidden && (e.key === 'Tab' || e.key === 'Enter') && !e.ctrlKey && !e.metaKey) {
    const first = $('tc-mention').querySelector('[data-tc-at]');
    if (first) { e.preventDefault(); tcMentionPick(first.dataset.tcAt); }
  }
}, true);
