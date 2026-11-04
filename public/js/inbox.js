// The Inbox page: the conversations waiting on you, by Business or Personal and
// by where they came from. Picking one opens it large beside the list
// (convo.js); the list then narrows to a column, like Teams or Discord.
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
const VIA = { mail: 'Email', 'voice-text': 'Text', 'voice-mail': 'Voicemail', 'voice-call': 'Missed call', teams: 'Teams', outlook: 'Outlook' };
const SOURCE = { all: () => true, email: (t) => t.kind === 'mail', texts: (t) => t.kind.startsWith('voice'), teams: (t) => t.kind === 'teams', outlook: (t) => t.kind === 'outlook' };

let inboxShown = '';   // the list as last drawn: the board refreshes often, and an unchanged list is left alone

function renderInbox() {
  const biz = S.threads.filter(inProject), per = S.email.filter(inProject);
  const base = inboxTab === 'business' ? biz : per;
  const list = base.filter(SOURCE[inboxSource]);
  const srcCount = (k) => base.filter(SOURCE[k]).length;
  let html = `<div class="page-head inbox-head"><h1>Inbox</h1><div class="chips">
      <button class="chip ${biz.length ? 'hot' : ''}" type="button" data-tab="business" aria-pressed="${inboxTab === 'business'}">Business <span class="c">${biz.length}</span></button>
      <button class="chip" type="button" data-tab="personal" aria-pressed="${inboxTab === 'personal'}">Personal <span class="c">${per.length}</span></button>
    </div><span class="grow"></span><button class="btn go" type="button" data-act="compose">New email</button></div>
    <div class="chips">${[['all', 'All'], ['email', 'Email'], ['texts', 'Texts and calls'], ['teams', 'Teams'], ['outlook', 'Outlook']].filter(([k]) => k === 'all' || srcCount(k) || (inboxTab === 'business' && S.recent.filter(inProject).some(SOURCE[k]))).map(([k, n]) => `<button class="chip" type="button" data-source="${k}" aria-pressed="${inboxSource === k}">${n} <span class="c">${srcCount(k)}</span></button>`).join('')}</div>
    <section class="card"><div class="list">`;
  const sub = (t) => t.kind === 'mail' || t.kind === 'outlook' ? `${t.subject}${t.snippet ? ' · ' + t.snippet : ''}` : (t.snippet || t.subject);
  const threadRow = (t) => row({ type: 'thread', key: t.key, space: t.space, title: t.who, via: VIA[t.kind] || 'Email', sub: sub(t), right: `<span class="mono muted">${ago(t.date)}</span>` });
  const recent = inboxTab === 'business' ? S.recent.filter(inProject).filter(SOURCE[inboxSource]).filter((r) => !list.some((t) => t.key === r.key)) : [];
  html += list.map((t) => row({ type: 'thread', key: t.key, space: t.space, title: t.who, via: VIA[t.kind] || 'Email', sub: sub(t), right: `<span class="mono ${inboxTab === 'business' && Date.now() - t.date > 2 * 86400e3 ? 'late' : 'muted'}">${ago(t.date)}</span>`, bold: t.unread })).join('')
    || (!S.status.gmail.length && !S.status.microsoft?.connected
      ? `<div class="empty-cta"><p class="empty">Connect your email or Teams, and conversations waiting on you show here: from people, not ads.</p><div class="form-row"><button class="btn go" type="button" data-setup-link="gmail">Connect email</button><button class="btn" type="button" data-setup-link="microsoft">Connect Teams and Outlook</button></div></div>`
      : empty(inboxTab === 'business' ? 'No business conversation is waiting on a reply.' : 'Nothing from people you have written to.'));
  html += `</div></section>`;
  if (recent.length) html += `<section class="card"><h2>Replied, last 7 days <span class="count">${recent.length}</span></h2><div class="list">${recent.map(threadRow).join('')}</div></section>`;
  // Same list as before: leave it, so nothing flickers and the scroll stays put.
  const el = $('page');
  if (html !== inboxShown || el.dataset.view !== 'inbox') { el.innerHTML = html; inboxShown = html; el.dataset.view = 'inbox'; }
}
