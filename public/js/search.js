// Ctrl K searches everything as you type: sessions (here and on your other
// computers), people on your projects' pages, conversations (mail of any age
// from people, and Teams), calendar events (a month back, two ahead), money
// (bills, invoices, payments, charges and receipts), notebook pages, notes,
// to-dos, reminders and routines, your projects, and Switchboard's own
// features (so "monitor" finds the System monitor). Enter still adds what was typed unless a result is picked.
// The server searches the notebook and the mail (lib/search.js); the rest is
// already on the page and is searched here.
let cmdHits = [], cmdSel = -1, cmdTimer = null;
let searchPool = [];   // conversations found by search, so one older than the board's can still open
const CMD_LABEL = { event: 'Event', bill: 'Bill', paid: 'Paid', invoice: 'Invoice', charge: 'Charge', receipt: 'Receipt', page: 'Page', note: 'Note', todo: 'To-do', reminder: 'Reminder', routine: 'Routine', term: 'Session', person: 'Person', project: 'Project', feature: 'Feature', connect: 'Set up' };
const convoLabel = (k) => k === 'teams' ? 'Teams' : k === 'outlook' ? 'Outlook' : String(k || '').startsWith('voice') ? 'Text' : 'Email';

function cmdMatcher(q) {
  const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const words = fold(q).split(/\s+/).filter(Boolean);
  return words.length ? (text) => { const t = fold(text); return words.every((w) => t.includes(w)); } : () => false;
}

// What is on the page already: sessions, people, projects, features.
function localHits(q) {
  const hit = cmdMatcher(q);
  const terms = allTerms().filter((t) => hit(`${termLabel(t)} ${t.name} ${t.cwd} ${t.prompt || ''} ${t.agentName || ''}`)).slice(0, 4)
    .map((t) => ({ type: 'term', key: t.key, space: t.space, title: termLabel(t), line: t.prompt || t.detail || t.cwd }));
  const people = [];
  for (const s of S.spaces) for (const p of profileOf(s.id).people) {
    if (hit(`${p.name} ${p.role} ${p.email} ${p.phone}`)) people.push({ type: 'person', project: s.id, space: s.id, title: p.name || p.email || p.phone, line: [p.role, s.name, p.email, p.phone].filter(Boolean).join(' · ') });
  }
  const projects = S.spaces.filter((s) => hit(s.name)).slice(0, 3).map((s) => ({ type: 'project', project: s.id, space: s.id, title: s.name, line: profileOf(s.id).about.slice(0, 120) }));
  const features = SETUP.filter((e) => hit(`${e.title} ${e.why}`)).sort((a, b) => hit(b.title) - hit(a.title)).slice(0, 3)
    .map((e) => ({ type: e.kind === 'connect' ? 'connect' : 'feature', id: e.id, title: e.title, line: e.why.slice(0, 140) }));
  const m = S.money || {};
  const money = [
    ...(m.bills || []).filter((b) => hit(b.text)).map((b) => ({ type: 'bill', open: { type: 'item', key: String(b.id) }, space: b.space, title: b.text, line: `−${$$(b.amount)}${b.next ? ' · next ' + dayOnly(b.next) : ''}` })),
    ...(m.invoices || []).filter((v) => hit(v.text)).map((v) => ({ type: 'invoice', open: { type: 'invoice', key: String(v.id) }, space: v.space, title: v.text, line: `${$$(v.amount)} owed${v.due_at ? ' · due ' + dayOnly(v.due_at) : ''}` })),
    ...(m.paid || []).filter((p) => hit(p.text)).map((p) => ({ type: 'paid', open: { type: 'item', key: String(p.id) }, space: p.space, title: p.text, line: `+${$$(p.amount)} · ${dayOnly(p.created_at)}` })),
    ...(m.mail || []).filter((x) => hit(`${x.merchant || ''} ${x.from_name || ''} ${x.subject || ''}`)).map((x) => ({ type: x.kind === 'charge' ? 'charge' : 'receipt', open: { type: 'money', key: x.msg_id }, space: x.space, title: x.merchant || x.from_name || x.from_addr, line: `${x.amount ? $$(x.amount) + ' · ' : ''}${dayOnly(x.date)}` }))
  ].slice(0, 4);
  const events = cmdEvents.list.filter((e) => hit(`${e.title} ${e.location || ''} ${e.calendarName || ''}`))
    .sort((a, b) => Math.abs(a.start - Date.now()) - Math.abs(b.start - Date.now())).slice(0, 3)
    .map((e) => ({ type: 'event', start: e.start, space: e.space, title: e.title, line: `${dayOnly(e.start)}${e.allDay ? '' : ' ' + new Date(e.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}${e.location ? ' · ' + e.location.split('\n')[0] : ''}` }));
  return { terms, people: people.slice(0, 4), projects, features, money, events };
}

// Calendar events for search: asked once when Ctrl K opens (the server keeps
// each calendar's answer five minutes), a month back and two months ahead.
let cmdEvents = { at: 0, list: [] };
function cmdLoadEvents() {
  if (Date.now() - cmdEvents.at < 5 * 60e3 || !(S?.calendars || []).length) return;
  cmdEvents.at = Date.now();
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const from = d.getTime() - 30 * 86400e3, to = d.getTime() + 69 * 86400e3;
  api(`/api/calendar?from=${from}&to=${to}`).then((r) => { cmdEvents = { at: Date.now(), list: r.events || [] }; }).catch(() => { cmdEvents.at = 0; });
}

function drawCmdResults() {
  const host = $('cmd-results');
  if (!host) return;
  host.innerHTML = cmdHits.map((r, i) => `<li><button type="button" class="cmd-hit ${i === cmdSel ? 'sel' : ''}" data-cmd-hit="${i}">${r.space ? tag(r.space) : '<span></span>'}<span class="k">${r.type === 'convo' ? convoLabel(r.kind) : r.type === 'target' ? (r.act === 'sesh' ? 'Send to' : r.act === 'note-page' ? 'Add to' : '') : CMD_LABEL[r.type] || ''}</span><span class="t">${esc(r.title)}${r.line && r.line !== r.title ? `<span class="muted"> · ${esc(r.line)}</span>` : ''}</span></button></li>`).join('');
  host.hidden = !cmdHits.length;
}

function cmdOpen(r) {
  closeDialog('cmd-scrim');
  if (r.type === 'target') return runTarget(r);
  if (r.type === 'term') return openTerm(r.key);
  if (r.type === 'event') {
    const day = new Date(r.start); day.setHours(0, 0, 0, 0);
    const first = new Date(day); first.setDate(1);
    cal.month = first.getTime(); cal.day = day.getTime();
    if (page !== 'calendar') location.hash = '#calendar'; else renderCalendar();
    return;
  }
  if (r.open) { keepSel = r.open; if (page !== 'money') location.hash = '#money'; else { selected = keepSel; keepSel = null; render(); } return; }
  if (r.type === 'person' || r.type === 'project') { location.hash = '#project/' + encodeURIComponent(r.project); return; }
  if (r.type === 'feature' || r.type === 'connect') { const e = SETUP.find((x) => x.id === r.id); if (e) openSetup(e); return; }
  if (r.type === 'convo') {
    inboxTab = (S.email || []).some((x) => x.key === r.key) || (!S.threads.some((x) => x.key === r.key) && r.space === 'personal') ? 'personal' : 'business';
    store.set('inboxTab', inboxTab);
    inboxSource = 'all';
    selected = { type: 'thread', key: r.key };
    if (page !== 'inbox') { keepSel = selected; location.hash = '#inbox'; } else render();
    return;
  }
  if (r.type === 'page') return openPage(r.uid, r.line && r.line !== r.title ? r.line : null);
  notesTab = r.type === 'note' ? 'quick' : r.type === 'routine' ? 'routines' : 'tasks';
  store.set('notesTab', notesTab);
  keepSel = { type: r.type === 'routine' ? 'routine' : 'item', key: String(r.id) };
  if (page !== 'notes') location.hash = '#notes'; else { selected = keepSel; keepSel = null; render(); }
}
// nav.js asks this first on Enter: true when a result was picked and opened.
function cmdPick() { if (cmdSel < 0 || !cmdHits[cmdSel]) return false; cmdOpen(cmdHits[cmdSel]); return true; }

$('cmd-input').addEventListener('input', (e) => {
  const q = e.target.value.trim();
  clearTimeout(cmdTimer);
  // "note …" and "sesh …" list where it can go instead (cmdtarget.js).
  if (cmdTargets(q)) return;
  const to = captureSpace(); $('cmd-hint').textContent = to === 'all' ? '' : `Goes to ${spaceOf(to).name} unless you add @project`;
  if (q.length < 2) { cmdHits = []; cmdSel = -1; drawCmdResults(); return; }
  cmdTimer = setTimeout(async () => {
    const r = await api('/api/search?all=1&q=' + encodeURIComponent(q)).catch(() => ({ results: [], convos: [] }));
    if ($('cmd-input').value.trim() !== q) return;
    const convos = (r.convos || []).slice(0, 4).map((t) => ({ ...t, type: 'convo', title: t.who, line: (t.subject || t.snippet) + (t.older ? ` · ${dayOnly(t.date)}` : '') }));
    searchPool = r.convos || [];
    const l = localHits(q);
    // Who and what you work on first, then what was said, then where it lives and what Switchboard can do.
    cmdHits = [...l.terms, ...l.people, ...convos, ...l.events, ...l.money, ...(r.results || []).slice(0, 5), ...l.projects, ...l.features].slice(0, 14);
    cmdSel = -1; drawCmdResults();
  }, 120);
});
$('cmd-input').addEventListener('keydown', (e) => {
  if (!cmdHits.length || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
  e.preventDefault();
  cmdSel = e.key === 'ArrowDown' ? Math.min(cmdHits.length - 1, cmdSel + 1) : Math.max(-1, cmdSel - 1);
  drawCmdResults();
});
document.addEventListener('click', (e) => { const h = e.target.closest('[data-cmd-hit]'); if (h) cmdOpen(cmdHits[+h.dataset.cmdHit]); });
