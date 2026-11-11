// The detail panel on the right, and render(), which draws the current page.
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
// ---------- detail panel
function find(type, key) {
  if (type === 'session') return S.sessions.find((s) => s.id === key);
  if (type === 'run') return S.runs.find((r) => String(r.id) === key);
  if (type === 'ci') return ciRun(key);
  if (type === 'review') return S.reviews.find((r) => String(r.id) === key);
  if (type === 'thread') return [...S.threads, ...S.email, ...S.recent, ...(S.teamsChats || [])].find((t) => t.key === key) || convoThread(key) || searchPool.find((t) => t.key === key) || draftThread(key) || tcThread(key);
  if (type === 'awaiting') return S.awaiting.find((t) => t.key === key);
  if (type === 'invoice') return S.money.invoices.find((i) => String(i.id) === key);
  if (type === 'item') return [...S.items, ...S.money.bills, ...S.money.paid].find((i) => String(i.id) === key);
  if (type === 'done') return S.recentDone.find((i) => String(i.id) === key);
  if (type === 'money') return S.money.mail.find((m) => m.msg_id === key);
  if (type === 'window') return S.windows.find((w) => String(w.id) === key);
  if (type === 'delivery') return findDelivery(key);
  if (type === 'routine') return findRoutine(key);
  if (type === 'check') return findCheck(key);
  if (type === 'task') return findTask(key);
  if (type === 'draft') return findDraft(key);
  return null;
}

let extra = { key: null, html: '' };
const loadingExtra = new Set();
// How a GitHub run ended, in words (GitHub's own word is in the tooltip).
const RUN_WORD = { success: 'Passed', failure: 'Failed', timed_out: 'Took too long', startup_failure: 'Could not start', action_required: 'Waiting for approval', cancelled: 'Cancelled', skipped: 'Skipped', neutral: 'Finished', stale: 'Out of date' };
function loadExtra(key, url, fmt) {
  if (extra.key === key || loadingExtra.has(key)) return;
  loadingExtra.add(key);
  api(url).then((d) => { extra = { key, html: fmt(d) }; renderDetail(); }).catch((e) => { extra = { key, html: `<p class="note-line">${esc(e.message)}</p>` }; renderDetail(); }).finally(() => loadingExtra.delete(key));
}
const msgsHtml = (d) => { if (selected) lastThread[selected.key] = (d.messages.find((m) => !m.from_me) || {}).snippet; return msgsHtmlInner(d); };
const msgsHtmlInner = (d) => `<div class="thread-msgs">${d.messages.slice().reverse().map((m) => `<div class="msg ${m.from_me ? 'me' : ''}"><span class="who">${esc(m.from_me ? 'You' : m.from_name)} · ${when(m.date)}</span>${esc(m.snippet || '')}</div>`).join('') || '<p class="note-line">No messages in the last 14 days.</p>'}</div>`;

// Reply from the address set on the project (Settings, Projects, fifth column).
function guessFrom(t) {
  const mine = S.sendAs.map((a) => a.address);
  const from = spaceOf(t.space).from;
  return (from && mine.includes(from)) ? from : mine[0];
}

// The panel is there only when it has something to show: a picked item, or
// the session list on Sessions. Otherwise the page has the width (data-panel).
const panelShows = (on) => { document.body.dataset.panel = on ? 'on' : 'off'; };
function renderDetail() {
  const el = $('detail');
  panelShows(page === 'sessions' || selected?.type === 'newcost' || (page !== 'inbox' && !CV && !!(selected && find(selected.type, selected.key))));
  if (page === 'sessions') {
    // Keep the box being typed in (the message bar, or a session's new name) through redraws.
    const fid = ['q-text', 'rename-input'].includes(document.activeElement?.id) ? document.activeElement.id : null;
    const pos = fid ? document.activeElement.selectionStart : null;
    el.innerHTML = termDetail();
    if (fid && $(fid)) { $(fid).focus(); $(fid).selectionStart = $(fid).selectionEnd = pos; }
    return;
  }
  // Inbox has its own right column (inbox.js, convo.js); the panel steps aside.
  if (CV || page === 'inbox') { if (el.innerHTML) el.innerHTML = ''; return; }
  // A new recurring cost (costs.js): its form, left alone while it is open.
  if (selected?.type === 'newcost') { if (!costFormOpen('new')) el.innerHTML = `<div class="kicker">New recurring cost</div>` + costFormHtml(costForm?.prefill, 'new'); return; }
  // A draft being edited (drafts.js): left as it is while the board refreshes.
  if (selected?.type === 'draft' && draftPanelBusy()) return;
  const x = selected && find(selected.type, selected.key);
  // A project's page has its own side column: the panel only opens for a picked card.
  if (!x && page === 'project') { el.innerHTML = ''; return; }
  if (!x) {
    const label = project === 'all' ? 'Everything' : spaceOf(project).name;
    const hints = { now: 'Click a card to see it here and act on it. Session cards also jump straight to their window.', inbox: 'Pick a conversation to read it and reply without leaving.', money: 'Log money with Ctrl+K: invoice, paid, bill.', notes: 'Ctrl+K works from any page.', builds: 'Runs update by themselves while they go. Click one for its jobs, to re-run what failed, or to cancel it.', checks: 'Click a check for its last runs, what failed and screenshots.' };
    const n = page === 'inbox' ? inboxCount(project) : needsCount(project);
    const head = page === 'builds' ? `${ciActiveCount()} running` : page === 'checks' ? (n => n ? `${n} check${n === 1 ? '' : 's'}` : 'No checks yet')((S.checks || []).filter(inProject).length) : page === 'inbox' ? `${n} waiting on a reply` : `${n} need${n === 1 ? 's' : ''} you`;
    el.innerHTML = `<div class="kicker">${esc(label)}</div><h2>${head}</h2><p class="muted">${hints[page]}</p>`;
    return;
  }
  const t = selected.type;
  const kick = (label) => `<div class="kicker">${tag(x.space)}${esc(spaceOf(x.space).name)} · ${esc(label)}</div>`;
  let html = '';
  if (t === 'session') {
    html = kick('Claude session') + `<h2>${esc(x.repo || 'Claude')}</h2>
      <dl class="facts"><dt>State</dt><dd>${esc({ waiting: 'Needs you', finished: 'Your turn', running: 'Working', idle: 'Idle' }[x.state] || x.state)}${x.detail ? ' · ' + esc(x.detail) : ''}</dd>
      ${x.cwd ? `<dt>Folder</dt><dd title="${esc(x.cwd)}">${esc(x.cwd.split(/[\\/]/).filter(Boolean).pop() || x.cwd)}</dd>` : ''}${x.termId ? '' : `<dt>Window</dt><dd>${esc(x.windowTitle || 'Not found yet. It is found the next time you send this session a message.')}</dd>`}<dt>Updated</dt><dd>${since(x.updatedAt)}</dd></dl>
      ${x.prompt ? `<div class="mono muted">Last message to it</div><div class="quote">${esc(x.prompt)}</div>` : ''}
      ${x.lastMessage ? `<div class="mono muted" style="margin-top:10px">Its last reply</div><div class="quote">${esc(x.lastMessage)}</div>` : ''}
      <div class="actions">${x.termId ? `<button class="btn btn--primary" data-act="open-term" type="button">Open in Sessions</button>` : x.windowId ? `<button class="btn btn--primary" data-act="focus" type="button">Jump to window</button>` : ''}${x.state === 'finished' || x.state === 'waiting' ? `<button class="btn" data-act="seen" type="button" title="Take it off Needs you. It comes back when the session asks for you again.">Clear</button>` : ''}
      ${!x.termId && x.cwd ? `<button class="btn" data-act="move" type="button">Move into Switchboard</button>` : ''}</div>
      ${!x.termId && x.cwd ? `<p class="note-line">Move: close this session in VS Code first, then it reopens here with the same conversation.</p>` : ''}
      ${extra.key === x.id ? extra.html : ''}`;
    loadExtra(x.id, `/api/session/${encodeURIComponent(x.id)}`, (d) => `<ul class="tl">${d.events.map((e) => `<li><span class="when">${when(e.at)}</span> ${esc(e.what)}${e.more ? ' · ' + esc(e.more) : ''}</li>`).join('')}</ul>`);
  } else if (t === 'run') {
    const sib = S.runs.filter((r) => r.repo === x.repo && r.title === x.title);
    const failed = sib.filter((r) => r.state === 'failed');
    html = kick('GitHub Actions') + `<h2>${esc(x.title)}</h2>
      <ul class="tl">${sib.map((r) => `<li><a href="${safeHref(r.url)}" target="_blank" rel="noopener">${esc(r.workflow)}</a> · <span${r.conclusion ? ` title="${esc(r.conclusion)}"` : ''}>${esc(RUN_WORD[r.conclusion] || (r.conclusion ? String(r.conclusion).replace(/_/g, ' ') : 'Running'))}</span></li>`).join('')}</ul>
      <dl class="facts"><dt>Project</dt><dd title="On GitHub: ${esc(x.fullName)}">${esc(x.repo || x.fullName)}</dd><dt>Branch</dt><dd>${esc(x.branch)}</dd><dt>Updated</dt><dd>${since(x.updatedAt)}</dd></dl>
      <div class="actions">${failed.length ? `<button class="btn btn--primary" data-act="rerun" type="button">Re-run failed</button>` : ''}<a class="btn" href="${safeHref(x.url)}" target="_blank" rel="noopener">Open on GitHub</a><button class="btn" data-act="clear" type="button">Clear</button></div>`;
  } else if (t === 'ci') {
    html = ciDetail(x, kick);
  } else if (t === 'review') {
    html = kick('Pull request') + `<h2>${esc(x.title)}</h2>
      <dl class="facts"><dt>Project</dt><dd>${esc(x.repo)} #${Number(x.number)}</dd><dt>By</dt><dd>${esc(x.author)}</dd><dt>Updated</dt><dd>${since(x.updatedAt)}</dd></dl>
      <div class="actions"><a class="btn" href="${safeHref(x.url)}" target="_blank" rel="noopener">Read it on GitHub</a><button class="btn btn--primary" data-act="approve" type="button">Approve</button>
      <button class="btn ${mergeArmed === x.id ? 'btn--danger' : ''}" data-act="merge" type="button">${mergeArmed === x.id ? 'Click again to merge' : 'Merge'}</button><button class="btn" data-act="clear" type="button">Clear</button></div>`;
  } else if (t === 'awaiting') {
    html = kick('Waiting on them') + `<h2>${esc(x.subject)}</h2>
      <dl class="facts"><dt>To</dt><dd>${esc(x.who)}</dd><dt>Sent</dt><dd>${when(x.date)} · ${since(x.date)}</dd></dl>
      ${extra.key === x.key ? extra.html : ''}
      <div class="composer"><label for="r-from" class="sr">From</label><select id="r-from">${S.sendAs.map((a) => `<option value="${esc(a.address)}" ${a.address === guessFrom(x) ? 'selected' : ''}>From ${esc(a.address)}</option>`).join('')}</select>${x.kind === 'mail' ? mtToggle('r-track') : ''}
      <label for="r-text" class="sr">Follow up</label><textarea id="r-text" placeholder="Follow up…">${esc(draft[x.key] || '')}</textarea>
      <div class="row"><button class="mic" type="button" data-mic="r-text" title="Talk to type"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg><span class="sr">Dictate</span></button><button class="btn btn--primary" type="button" data-act="send">Send follow-up</button><span class="note-line">Goes in the same thread. Ctrl+Enter sends.</span></div></div>
      <div class="actions"><button class="btn" data-act="stop-waiting" type="button">Stop waiting</button>${x.link ? `<a class="btn" href="${safeHref(x.link)}" target="_blank" rel="noopener">Open in Gmail</a>` : ''}</div>`;
    loadExtra(x.key, `/api/thread?key=${encodeURIComponent(x.key)}`, msgsHtml);
  } else if (x.shared && (t === 'invoice' || t === 'item')) {
    // From a shared project (the web board): what its owner's computer shares, to read.
    const label = t === 'invoice' ? 'Invoice out' : { bill: 'Recurring cost', paid: 'Payment' }[x.kind] || 'Item';
    html = kick(label) + `<h2>${esc(x.text)}</h2>
      <dl class="facts">${x.amount != null ? `<dt>Amount</dt><dd>${$$(x.amount)}</dd>` : ''}${x.kind === 'bill' ? `<dt>Next</dt><dd>${x.next ? dayOnly(x.next) : 'no date'} · ${esc(CADENCE_WORD[x.cadence] || x.cadence)}</dd>` : x.due_at ? `<dt>Due</dt><dd>${dayOnly(x.due_at)}</dd>` : ''}<dt>Project</dt><dd>${esc(spaceOf(x.space).name)}</dd></dl>
      <p class="muted small">Shared with you from ${esc(spaceOf(x.space).name)}. Changes are made in the Switchboard of whoever shares it.</p>`;
  } else if (t === 'invoice') {
    html = kick('Invoice out') + `<h2>${esc(x.text)}</h2>
      <dl class="facts"><dt>Amount</dt><dd>${$$(x.amount)}</dd><dt>Sent</dt><dd>${when(x.created_at)}</dd>${x.due_at ? `<dt>Due</dt><dd>${dayOnly(x.due_at)}</dd>` : ''}</dl>
      <div class="actions"><button class="btn btn--primary" data-act="paid" type="button">Mark paid</button><button class="btn" data-act="delete" type="button">Delete</button></div>`;
  } else if (t === 'item' && x.kind === 'bill') {
    // A recurring cost is its own form: change any of it and Save (costs.js).
    if (costFormOpen(String(x.id))) return;
    costForm = { key: String(x.id) };
    html = kick('Recurring cost') + `<h2>${esc(x.text)}</h2><p class="muted">${$$(x.amount)} ${esc(CADENCE_WORD[x.cadence] || x.cadence)} · ${$$(monthly(x))} a month</p>` + costFormHtml(x, String(x.id));
  } else if (t === 'item' || t === 'done') {
    const label = { note: 'Note', todo: 'To-do', reminder: 'Reminder', paid: 'Payment', bill: 'Bill' }[x.kind] || 'Item';
    html = kick(label) + `<h2>${esc(x.text)}</h2>
      <dl class="facts">${x.due_at && x.kind !== 'bill' ? `<dt>Due</dt><dd>${when(x.due_at)}</dd>` : ''}${x.kind === 'bill' ? `<dt>Next</dt><dd>${x.next ? dayOnly(x.next) : 'no date'} · ${esc(CADENCE_WORD[x.cadence] || x.cadence)}</dd>` : ''}${x.amount != null ? `<dt>Amount</dt><dd>${$$(x.amount)}</dd>` : ''}<dt>Added</dt><dd>${when(x.created_at)}</dd></dl>
      <div class="actions">${t === 'done' ? `<button class="btn" data-act="undo" type="button">Not done</button>` : (x.kind === 'reminder' || x.kind === 'todo') ? `<button class="btn btn--primary" data-act="done" type="button">Done</button><button class="btn" data-act="snooze" data-hours="1" type="button">1 hour</button><button class="btn" data-act="snooze" data-hours="tomorrow" type="button">Tomorrow 9am</button>` : ''}<button class="btn" data-act="delete" type="button">Delete</button></div>`;
  } else if (t === 'routine') {
    html = routineDetail(x, kick);
  } else if (t === 'delivery') {
    html = deliveryDetail(x, kick);
  } else if (t === 'check') {
    html = checkDetail(x, kick);
  } else if (t === 'task') {
    html = taskDetail(x, kick);
  } else if (t === 'draft') {
    html = draftDetail(x, kick);
  } else if (t === 'money') {
    html = kick(x.kind === 'charge' ? 'Card or bank alert' : 'Receipt') + `<h2>${esc(x.merchant || x.from_name)}</h2>
      <dl class="facts">${x.amount != null ? `<dt>Amount</dt><dd>${$$(x.amount)}</dd>` : ''}<dt>Subject</dt><dd>${esc(x.subject)}</dd><dt>From</dt><dd>${esc(x.from_addr)}</dd><dt>Date</dt><dd>${when(x.date)}</dd></dl>
      <div class="quote">${esc(x.snippet || '')}</div><div class="actions">${x.link ? `<a class="btn" href="${safeHref(x.link)}" target="_blank" rel="noopener">Open</a>` : ''}</div>`;
  }
  // Keep a half-written reply, and the cursor, when the board refreshes underneath.
  const focused = document.activeElement?.id === 'r-text';
  const pos = focused ? document.activeElement.selectionStart : null;
  const fromVal = $('r-from')?.value;
  el.innerHTML = html;
  if (fromVal && $('r-from')) $('r-from').value = fromVal;
  if (focused && $('r-text')) { $('r-text').focus(); $('r-text').selectionStart = $('r-text').selectionEnd = pos; }
}

// ---------- render everything
function render() {
  if (!S) return;
  renderShell();
  ({ deck: renderDeck, now: renderNow, sessions: renderSessions, builds: renderActionsPage, checks: renderChecksPage, calendar: renderCalendar, inbox: renderInbox, money: renderMoney, notes: renderNotes, usage: renderUsagePage, project: renderProject, unsorted: renderUnsorted })[page]();
  document.body.dataset.page = page;
  syncConvo();
  $('term-host').hidden = page !== 'sessions' || !currentTerm;
  $('term-bar').hidden = page !== 'sessions' || !currentTerm;
  // One place to type: the message bar in a chat, the terminal itself on Terminal.
  const soloTerm = page === 'sessions' && !!currentTerm && termOnly(currentTerm);
  $('term-compose').hidden = page !== 'sessions' || !currentTerm || soloTerm;
  document.body.classList.toggle('term-only', soloTerm);   // the terminal is the last box: pages/sessions.css gives it a bottom edge
  renderImages();
  renderAccountPrompts();
  if (page === 'sessions') { syncTerminal(); renderTermCompose(); } else closeTerminal();
  seeOpenSession();
  renderDetail();
  renderWindows();
  alignPanel();
  bvPaint();   // the reading-aloud player: under the book, or in the corner elsewhere (bookvoice.js)
}

// The panel on the right starts level with the first block under the page's
// title (a card, the tiles), not with the title itself, so the right column's
// top edge lines up with the left's. Sessions lays its panel out itself; in a
// narrow window the panel sits underneath and needs no lining up.
const wideFrame = matchMedia('(min-width: 1281px)');
function alignPanel() {
  const panel = document.querySelector('.frame > .panel'), pg = $('page');
  if (!panel || !pg) return;
  let lead = 0;
  if (wideFrame.matches && page !== 'sessions') {
    const first = [...pg.children].find((el) => !el.matches('.page-head, .sessions-head, .chips') && el.offsetParent !== null);
    if (first) lead = (first.getBoundingClientRect().top - pg.getBoundingClientRect().top) / (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--zoom')) || 1);
  }
  const px = Math.max(0, Math.round(lead)) + 'px';
  if (panel.style.marginTop !== px) panel.style.marginTop = px;
}
addEventListener('resize', alignPanel);

function renderWindows() {
  const wins = S.windows.filter((w) => project === 'all' || w.space === project);
  $('windows').innerHTML = wins.map((w) => row({ type: 'window', key: String(w.id), space: w.space || 'personal', title: w.folder || w.app, sub: w.title, via: w.app, cls: w.active ? 'active-win' : '' })).join('') || empty('No windows for this project.');
}
