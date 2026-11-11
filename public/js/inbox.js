// The Inbox page, laid out like a mail app (Nov 10 2026: the old page stacked
// three rows of filters and the drafts above the mail): folders on the left (Business, Personal, Drafts,
// Replied, Tracking, Reading, then the team chats), the folder's list in the
// middle, one row of two lines each, and on the right the open conversation
// (convo.js) or, with nothing open, what the folder has to say (inboxPane()).
// The three columns fill the window; only the lists and the conversation
// scroll, each in its own box. Reading has no right pane: its list takes it.
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
const VIA = { mail: 'Email', 'voice-text': 'Text', 'voice-mail': 'Voicemail', 'voice-call': 'Missed call', teams: 'Teams', outlook: 'Outlook', team: 'Team chat' };
const SOURCE = { all: () => true, email: (t) => t.kind === 'mail', texts: (t) => t.kind.startsWith('voice'), teams: (t) => t.kind === 'teams', outlook: (t) => t.kind === 'outlook', team: (t) => t.kind === 'team' };
const SOURCE_NAME = { all: 'Everything', email: 'Email', texts: 'Texts and calls', teams: 'Teams', outlook: 'Outlook', team: 'Team chat' };
const IB_FOLDERS = { business: 'Business', personal: 'Personal', teams: 'Teams', drafts: 'Drafts', replied: 'Replied', tracking: 'Tracking', reading: 'Reading' };
const IB_EMPTY = { business: 'No business conversation is waiting on a reply.', personal: 'Nothing from people you have written to.', drafts: 'No drafts.', replied: 'Nothing you replied to in the last 7 days.', teams: 'No Teams chats yet. They show here once Microsoft 365 is connected and has checked in.' };

// A row's small mark for where it came from, in place of a boxed EMAIL label.
const IB_ICON = {
  mail: '<path d="M3 6.5h18v11H3z"/><path d="m3 7 9 6.5L21 7"/>',
  outlook: '<path d="M3 6.5h18v11H3z"/><path d="m3 7 9 6.5L21 7"/>',
  teams: '<path d="M4 5h16v11H9l-5 4z"/>',
  team: '<path d="M4 5h16v11H9l-5 4z"/><path d="M9 9.5h6M9 12.5h4"/>',
  'voice-text': '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M10 18h4"/>',
  'voice-call': '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  'voice-mail': '<circle cx="6.5" cy="12" r="3.5"/><circle cx="17.5" cy="12" r="3.5"/><path d="M6.5 15.5h11"/>',
  draft: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
};
const ibIcon = (kind) => `<svg class="ib-ico" viewBox="0 0 24 24" aria-hidden="true">${IB_ICON[kind] || IB_ICON.mail}</svg>`;

let inboxShown = '';   // the page as last drawn: the board refreshes often, and an unchanged page is left alone

// One row, two lines that never wrap: who and when, then where it came from and what it says.
function ibRow({ type, key, space, who, kind, via, sub, right = '', when = '', bold, late }) {
  return `<button class="item ib-row ${bold ? 'bold' : ''} ${isSel(type, key) ? 'sel' : ''}" type="button" data-type="${type}" data-key="${esc(key)}">
    ${tag(space)}<span class="t" title="${esc(who)}">${esc(who)}</span><span class="ib-when mono ${late ? 'late' : 'muted'}">${when}</span>
    <span class="ib-src" title="${esc(via)}">${ibIcon(kind)}<span class="sr">${esc(via)}</span></span><span class="s" title="${esc(sub)}">${esc(sub)}</span><span class="ib-mark">${right}</span></button>`;
}
const ibSub = (t) => t.kind === 'mail' || t.kind === 'outlook' ? `${t.subject}${t.snippet ? ' · ' + t.snippet : ''}` : (t.snippet || t.subject || '');
const threadRow = (t, late) => ibRow({ type: 'thread', key: t.key, space: t.space, who: t.who, kind: t.kind, via: VIA[t.kind] || 'Email', sub: ibSub(t), right: mtThreadMark(t), when: ago(t.date), bold: t.unread, late });
const draftRow = (d) => ibRow({ type: d.thread ? 'thread' : 'draft', key: d.thread || d.key, space: 'personal', who: d.to || 'New email, no one yet', kind: 'draft', via: 'Draft', sub: [d.subject, (d.text || '').split('\n')[0]].filter(Boolean).join(' · '), when: ago(d.date) });

function ibLists() {
  const biz = S.threads.filter(inProject), per = S.email.filter(inProject);
  const replied = S.recent.filter(inProject).filter((r) => !biz.some((t) => t.key === r.key) && !per.some((t) => t.key === r.key));
  return { business: biz, personal: per, replied, teams: (S.teamsChats || []).filter(inProject), drafts: S.drafts || [] };
}

function ibFolders(L) {
  const unreadPosts = readingList().filter((i) => !i.read_at).length;
  const opened = (S.mailtrack?.emails || []).filter((e) => e.status === 'opened' || e.status === 'clicked').length;
  const n = { business: L.business.length, personal: L.personal.length, teams: L.teams.filter((t) => t.unread).length, drafts: L.drafts.length, replied: L.replied.length, tracking: opened, reading: unreadPosts };
  const folder = (k) => `<button class="ib-folder" type="button" data-tab="${k}" aria-current="${inboxTab === k && !tcPicked() ? 'true' : 'false'}"><span class="nm">${IB_FOLDERS[k]}</span><span class="n${k === 'business' && n[k] ? ' hot' : ''}">${n[k] || ''}</span></button>`;
  const chans = (S.chat?.channels || []).filter(inProject);
  const waiting = new Set([...L.business, ...L.personal].map((t) => t.key));
  const chat = chans.length ? `<div class="ib-label">Team chat</div>${chans.map((c) => `<button class="ib-folder" type="button" data-tc-open="${esc(c.key)}" aria-current="${tcPicked() === c.key}" title="${c.kind === 'project' ? `Everyone in ${esc(c.who)}` : `Just you and ${esc(c.who)}`}"><span class="nm">${c.kind === 'project' ? '<span class="ib-hash">#</span>' : ''}${esc(c.who)}</span><span class="n">${waiting.has(c.key) ? '•' : ''}</span></button>`).join('')}` : '';
  return `<nav class="ib-nav" aria-label="Inbox folders"><h1 class="page-title">Inbox</h1><button class="btn btn--primary ib-new" type="button" data-act="compose">New email</button>
    <div class="ib-folders">${['business', 'personal', ...(S.status.microsoft?.connected ? ['teams'] : []), 'drafts', 'replied', 'tracking', 'reading'].map(folder).join('')}${chat}</div>
    <div class="ib-foot">${projectPicker()}</div></nav>`;
}
// The team chat that is open, so its folder is lit instead of the list's.
const tcPicked = () => (selected?.type === 'thread' && (S.chat?.channels || []).some((c) => c.key === selected.key) ? selected.key : '');

// The middle column: the folder's title, a filter where there is one, and its rows.
function ibList(L) {
  if (inboxTab === 'reading') return bkListHtml();   // books.js (posts from feeds.js inside it)
  if (inboxTab === 'tracking') return mtListHtml();
  const base = L[inboxTab] || L.business, isDrafts = inboxTab === 'drafts';
  const kinds = isDrafts ? [] : Object.keys(SOURCE).filter((k) => k !== 'all' && base.some(SOURCE[k]));
  if (inboxSource !== 'all' && !kinds.includes(inboxSource)) inboxSource = 'all';
  const list = isDrafts ? base : base.filter(SOURCE[inboxSource]);
  const filter = kinds.length > 1 ? `<label class="sr" for="ib-source">Show</label><select id="ib-source" class="field field--sm" data-source-pick>${['all', ...kinds].map((k) => `<option value="${k}" ${inboxSource === k ? 'selected' : ''}>${SOURCE_NAME[k]} ${k === 'all' ? base.length : base.filter(SOURCE[k]).length}</option>`).join('')}</select>` : '';
  const rows = isDrafts ? list.map(draftRow).join('') : list.map((t) => threadRow(t, inboxTab === 'business' && Date.now() - t.date > 2 * 86400e3)).join('');
  const none = !S.status.gmail.length && !S.status.microsoft?.connected && !isDrafts
    ? `<div class="empty-cta"><p class="empty">Connect your email or Teams, and conversations waiting on you show here: from people, not ads.</p><div class="form-row"><button class="btn btn--primary" type="button" data-setup-link="gmail">Connect email</button><button class="btn" type="button" data-setup-link="microsoft">Connect Teams and Outlook</button></div></div>`
    : empty(IB_EMPTY[inboxTab] || IB_EMPTY.business);
  const title = inboxTab === 'replied' ? 'Replied, 7 days' : IB_FOLDERS[inboxTab] || 'Business';
  return `<div class="ib-head"><h2>${title}</h2><span class="count">${list.length || ''}</span><span class="grow"></span>${filter}</div>
    <div class="ib-rows list">${rows || none}</div>`;
}

// The right column with nothing open: a draft for a new email, the tracking
// detail, or a quiet line. convo.js shows it in the conversation's place.
function inboxPane() {
  if (inboxTab === 'reading') return bkPaneHtml();   // the open book (books.js, bookreader.js)
  if (inboxTab === 'tracking' && mtOn()) return `<div class="ib-pane-body mt-side">${MT.sel ? mtDetailHtml() : mtOthersHtml()}</div>`;
  const d = selected?.type === 'draft' && findDraft(selected.key);
  if (d) return `<div class="ib-pane-body">${draftDetail(d, (t) => `<div class="kicker">${t}</div>`)}</div>`;
  const L = ibLists(), waiting = L.business.length + L.personal.length;
  return `<div class="ib-pane-empty"><p class="ib-pane-big">${waiting ? 'Pick a conversation' : 'Nothing is waiting on you'}</p>
    <p class="muted">${waiting ? 'It opens here, with the reply box under it. Esc closes it.' : 'New conversations from people show in Business and Personal.'}</p></div>`;
}
const inboxWide = () => page === 'inbox' && inboxTab === 'reading' && !bkShowing() && !convoWanted();   // Posts take the room; a team chat opened from Reading still gets the right column

function renderInbox() {
  if (!IB_FOLDERS[inboxTab]) inboxTab = 'business';
  const L = ibLists();
  const html = `<div class="ib">${ibFolders(L)}<section class="card ib-list" aria-label="${esc(IB_FOLDERS[inboxTab])}">${ibList(L)}</section></div>`;
  document.body.toggleAttribute('data-ib-wide', inboxWide());
  // Same page as before: leave it, so nothing flickers and the scroll stays put.
  const el = $('page');
  if (html !== inboxShown || el.dataset.view !== 'inbox') {
    const f = el.contains(document.activeElement) && document.activeElement.id, at = f && document.activeElement.selectionStart;   // a box being typed in keeps its place
    el.innerHTML = html; inboxShown = html; el.dataset.view = 'inbox';
    if (f && $(f)) { $(f).focus(); try { $(f).selectionStart = $(f).selectionEnd = at; } catch { /* not a text box */ } }
  }
}

document.addEventListener('change', (e) => {
  const s = e.target.closest?.('[data-source-pick]');
  if (s) { inboxSource = s.value; render(); }
});
