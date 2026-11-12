// Clicks and keys across the board, and sending conversations into a session.
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
// ---------- actions
// One line at the bottom. An error ({ kind: 'error' }) gets a red edge and
// stays longer; anything else is gone in three seconds.
// With { undo }, it carries an Undo button (Ctrl+Z does the same) and stays
// as long as the undo can still be taken.
let toastTimer, toastUndo = null;
// With { action: { label, run } }, any other button (Copy details on an error).
function toast(msg, { kind = 'ok', undo = null, action = null, ms } = {}) {
  const t = $('toast'); t.textContent = msg; t.classList.toggle('error', kind === 'error'); t.classList.add('show');
  toastUndo = undo;
  const btn = undo ? { label: 'Undo', run: () => takeUndo() } : action;
  t.classList.toggle('has-undo', !!btn);
  if (btn) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'toast-undo'; b.textContent = btn.label;
    b.addEventListener('click', () => btn.run(b));
    t.append(' ', b);
  }
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.classList.remove('show', 'has-undo'); toastUndo = null; }, ms || (action ? 10000 : kind === 'error' ? 6000 : 3200));
}
function takeUndo() { const u = toastUndo; if (!u) return false; toastUndo = null; u(); return true; }
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z' || e.shiftKey || !toastUndo) return;
  if (e.target.closest?.('input, textarea, [contenteditable="true"], .xterm')) return;   // their own undo
  e.preventDefault(); takeUndo();
});

// ---------- Undo for Done, Delete and archive: each waits a few seconds before
// it happens. What is waiting is hidden at once (every load() filters it out, so
// a board refresh does not bring it back); Undo cancels it. Leaving the page
// sends what is still waiting, so nothing is lost by closing the tab.
const UNDO_MS = 6000;
const undoWaiting = new Map();   // 'item:12' or 'thread:<key>' -> { timer, send }
function hideWaiting() {
  if (!undoWaiting.size || !S) return;
  const gone = (k) => undoWaiting.has(k);
  S.items = (S.items || []).filter((i) => !gone('item:' + i.id));
  for (const k of ['bills', 'paid', 'invoices']) if (S.money?.[k]) S.money[k] = S.money[k].filter((i) => !gone('item:' + i.id));
  S.threads = (S.threads || []).filter((t) => !gone('thread:' + t.key));
  S.tasks = (S.tasks || []).filter((t) => !gone('task:' + t.key));
}
function doLater(id, msg, path, body) {
  const send = (keepalive) => fetch(path, { method: 'POST', keepalive, headers: { 'Content-Type': 'application/json', 'X-Switchboard': '1' }, body: JSON.stringify(body) });
  const timer = setTimeout(async () => {
    try { const r = await send(false); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || HTTP_WORDS[r.status] || 'That did not go through. Try again.'); }
    catch (e) { toast(e.message, { kind: 'error' }); }
    finally { undoWaiting.delete(id); load(); }
  }, UNDO_MS);
  undoWaiting.set(id, { timer, send });
  hideWaiting(); render();
  toast(msg, { ms: UNDO_MS, undo: () => { clearTimeout(timer); undoWaiting.delete(id); load(); toast('Undone.'); } });
}
window.addEventListener('pagehide', () => {
  for (const w of undoWaiting.values()) { clearTimeout(w.timer); w.send(true); }
  undoWaiting.clear();
});
const tomorrow9 = () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d.getTime(); };

async function act(name, btn) {
  if (name === 'compose') return openCompose();
  const x = selected && find(selected.type, selected.key);
  if (!x) return;
  const t = selected.type;
  if (name === 'send' && t === 'thread') return convoSend(x);   // shown at once, in the conversation
  if (btn) btn.disabled = true;
  try {
    stopDictation(); await dictated;
    if (name === 'open-term') { openTerm(x.termId); return; }
    else if (name === 'move') {
      const r = await api('/api/terms', { cwd: x.cwd, resume: x.id });
      toast('Reopened inside Switchboard.'); openTerm(r.id); return;
    }
    else if (name === 'to-session') {
      const termId = $('ts-term').value;
      await api(`/api/terms/${termId}/queue`, { text: await messageFor(x), source: `${VIA[x.kind] || 'Email'} · ${x.who}` });
      toast('Queued. It goes in when the session is free.');
    }
    else if (name === 'link') {
      const l = (S.links || []).find((l) => l.chat_key === x.key);
      if (l) await api('/api/links', { chatKey: x.key, unlink: true });
      else await api('/api/links', { chatKey: x.key, termId: $('ts-term').value, who: x.who });
      toast(l ? 'Unlinked.' : 'Linked. New messages from this chat get queued into the session.');
    }
    else if (name === 'focus') await api('/api/focus', { windowId: x.windowId, sessionId: x.id });
    else if (name === 'seen') { await api('/api/seen', { sessionId: x.id }); selected = null; toast('Cleared. It comes back when the session asks for you again.'); }
    else if (name === 'clear') {
      if (t === 'run') { for (const r of S.runs.filter((r) => r.repo === x.repo && r.title === x.title)) await api('/api/clear', { key: `run:${r.id}` }); }
      else await api('/api/clear', { key: t === 'review' ? `pr:${x.id}` : x.key });
      selected = null; toast('Cleared. It comes back if something new happens.');
    } else if (name === 'rerun') {
      for (const r of S.runs.filter((r) => r.repo === x.repo && r.title === x.title && r.state === 'failed')) await api('/api/github/rerun', { fullName: r.fullName, runId: r.id });
      toast('Re-running the failed jobs.');
    } else if (name === 'approve') { await api('/api/github/approve', { repo: x.repo, number: x.number }); toast('Approved.'); }
    else if (name === 'merge') {
      if (mergeArmed !== x.id) { mergeArmed = x.id; renderDetail(); setTimeout(() => { if (mergeArmed === x.id) { mergeArmed = null; renderDetail(); } }, 5000); return; }
      mergeArmed = null; await api('/api/github/merge', { repo: x.repo, number: x.number }); selected = null; toast('Merged.');
    } else if (name === 'send') {
      const text = $('r-text').value.trim();
      if (!text) { toast('Write something first.'); return; }
      await api('/api/reply', { key: x.key, text, from: $('r-from')?.value, messageId: x.messageId, track: mtTrackValue('r-track') });
      delete draft[x.key];
      if (t === 'awaiting') await api('/api/clear', { key: 'await:' + x.key });
      selected = null; toast('Sent.');
    } else if (name === 'archive') { selected = null; extra = { key: null, html: '' }; doLater('thread:' + x.key, x.kind === 'mail' ? 'Archived.' : 'Done.', '/api/archive', { key: x.key, messageId: x.messageId }); return; }
    else if (name === 'read') { await api('/api/read', { key: x.key, messageId: x.messageId }); toast('Marked read.'); }
    else if (name === 'snooze-thread') {
      const until = btn.dataset.hours === 'tomorrow' ? tomorrow9() : Date.now() + Number(btn.dataset.hours) * 3600e3;
      await api('/api/clear', { key: x.key, until }); selected = null; toast('Snoozed until ' + when(until) + '.');
    } else if (name === 'stop-waiting') { await api('/api/clear', { key: 'await:' + x.key }); selected = null; toast('Stopped waiting.'); }
    else if (name === 'paid') { await api(`/api/items/${x.id}/paid`, {}); selected = null; toast('Marked paid.'); }
    else if (name === 'done' || name === 'delete') { selected = null; extra = { key: null, html: '' }; doLater('item:' + x.id, name === 'done' ? 'Done.' : 'Deleted.', `/api/items/${Number(x.id)}/${name}`, {}); return; }
    else if (name === 'undo') { await api(`/api/items/${Number(x.id)}/undo`, {}); selected = null; toast('Back on the list.'); }
    else if (name === 'snooze') {
      const until = btn.dataset.hours === 'tomorrow' ? tomorrow9() : Date.now() + Number(btn.dataset.hours) * 3600e3;
      await api(`/api/items/${x.id}/snooze`, { until }); toast('Moved to ' + when(until) + '.');
    }
    extra = { key: null, html: '' };
    await load();
  } catch (e) { toast(e.message, { kind: 'error' }); }
  finally { if (btn && btn.isConnected) btn.disabled = false; }
}

document.addEventListener('input', (e) => {
  if (e.target.id === 'r-text' && selected) draft[selected.key] = e.target.value;
});

document.addEventListener('click', (e) => {
  const close = e.target.closest('[data-close]');
  if (close) { closeDialog(close.dataset.close); return; }
  const nf = e.target.closest('[data-now]');
  if (nf) { nowFilter = nf.dataset.now; store.set('nowFilter', nowFilter); render(); return; }
  const tb = e.target.closest('[data-tab]');
  if (tb) { inboxTab = tb.dataset.tab; inboxSource = 'all'; store.set('inboxTab', inboxTab); selected = null; render(); return; }
  const a = e.target.closest('[data-act]');
  if (a) { act(a.dataset.act, a); return; }
  const it = e.target.closest('[data-type]');
  if (it) {
    if (it.dataset.type === 'window') { api('/api/focus', { windowId: Number(it.dataset.key) }).catch(() => {}); closeDialog('windows-scrim'); return; }
    // Google signed Switchboard out: its Sign in button is in Settings, Connections, Calendars.
    if (it.dataset.type === 'google') { openSettings('connections').then(() => $('cal-google')?.scrollIntoView({ block: 'center' })); return; }
    selected = { type: it.dataset.type, key: it.dataset.key };
    extra = { key: null, html: '' };
    mergeArmed = null;
    if (it.dataset.type === 'rterm') { openTerm(it.dataset.key); return; }
    if (it.classList.contains('job') && it.dataset.type === 'session') {
      const s = find('session', it.dataset.key);
      if (s?.termId) { openTerm(s.termId); return; }
      if (s?.windowId) api('/api/focus', { windowId: s.windowId, sessionId: s.id }).then(load).catch(() => {});
    }
    render();
    return;
  }
  if (e.target.closest('#needs')) { nowFilter = 'needs'; store.set('nowFilter', nowFilter); project = 'all'; store.set('space', project); if (location.hash !== '#now') location.hash = '#now'; else route(); return; }
  if (e.target.closest('#update-btn')) {
    // Changes committed on this computer and not on GitHub: the first click says
    // so and the button becomes Update anyway (they are kept on a backup branch).
    const b = $('update-btn'), force = b.dataset.force === '1'; b.disabled = true; b.textContent = 'Updating…';
    api('/api/update', { force }).then(() => toast(S.version?.app ? 'Downloading the update. Switchboard restarts by itself when it is in.' : 'Updated. Restarting, the page reloads in a moment.')).catch((err) => {
      const mine = err.data?.localCommits;
      toast(err.message, { kind: 'error', ms: mine ? 12000 : undefined }); b.disabled = false;
      if (mine) { b.dataset.force = '1'; b.textContent = 'Update anyway'; } else { delete b.dataset.force; b.textContent = 'Update ready'; }
    });
    return;
  }
  if (e.target.closest('#open-cmd')) { openCmd(); return; }
  if (e.target.closest('#open-windows')) { renderWindows(); openDialog('windows-scrim'); return; }
  if (e.target.closest('#open-settings, #status')) { openSettings(); return; }
  if (e.target.closest('#refresh')) { toast('Checking everything…'); api('/api/refresh', {}).then(() => { toast('Up to date.'); load(); }).catch((err) => toast(err.message, { kind: 'error' })); return; }
  if (e.target.closest('#ms-disconnect')) { api('/api/microsoft/disconnect', {}).then(load).then(renderMsStatus); return; }
  const rm = e.target.closest('[data-remove-gmail]');
  if (rm) { api('/api/gmail', { remove: rm.dataset.removeGmail }).then(openSettings); return; }
  if (e.target.classList.contains('scrim') && e.target.id) closeDialog(e.target.id);
});

document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'notes-add') return;
  e.preventDefault();
  const v = $('notes-input').value.trim();
  if (!v) return;
  try { const item = await api('/api/capture', { line: v, space: project }); $('notes-input').value = ''; toast(`Added · ${spaceOf(item.space).name}`); await load(); $('notes-input')?.focus(); }
  catch (err) { toast(err.message, { kind: 'error' }); }
});

// ---------- sending conversations into a session
// The conversation as one block for an agent: where it came from, then every
// recent message in full with who said it and when. Falls back to the preview
// if the full text cannot be fetched.
async function messageFor(t) {
  const where = VIA[t.kind] || 'Email';
  const head = `${where} conversation with ${t.who}${t.subject && (t.kind === 'mail' || t.kind === 'outlook') ? `, subject "${t.subject}"` : ''}:`;
  try {
    const d = await api(`/api/thread/full?key=${encodeURIComponent(t.key)}`);
    if (d.messages?.length) return head + '\n\n' + d.messages.map((m) => `${m.from}, ${when(m.date)}:\n${m.text}`).join('\n\n');
  } catch {}
  return `${head}\n\n${t.who}, ${when(t.date)}:\n${t.snippet || t.subject || ''}`;
}
const lastThread = {};

function toSession(t) {
  const terms = S.terms || [];
  if (!terms.length) return `<p class="note-line">Start a session on the Sessions page to send conversations into Claude.</p>`;
  const linked = (S.links || []).find((l) => l.chat_key === t.key);
  return `<div class="section-label">Claude</div><div class="composer"><div class="row">
    <label for="ts-term" class="sr">Session</label><select id="ts-term" style="flex:1">${terms.map((x) => `<option value="${esc(x.id)}" ${linked?.term_id === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
    <button class="btn btn--primary" type="button" data-act="to-session">Send to session</button>
    ${t.kind === 'teams' ? `<button class="btn" type="button" data-act="link">${linked ? 'Unlink' : 'Link chat'}</button>` : ''}</div>
    <span class="note-line">${linked ? `Linked: new messages here are queued into ${esc((terms.find((x) => x.id === linked.term_id) || {}).name || 'the session')}.` : 'Queued, and typed in when Claude finishes what it is doing.'}</span></div>`;
}

// ---------- Something went wrong: a failure on the page is never silent. One
// line at the bottom, with Copy details (what failed, where, which version and
// browser) to paste into a bug report. Nothing is sent anywhere.
let lastOops = 0;
function oops(err, where) {
  const msg = String(err?.message || err || 'Unknown error');
  // Not ours: a browser extension's script, or the browser's harmless resize note.
  if (/ResizeObserver loop|Script error\.?$|Failed to fetch|NetworkError|Load failed/.test(msg) || /chrome-extension:|moz-extension:/.test(String(err?.stack || where || ''))) return;
  if (Date.now() - lastOops < 10000) return;
  lastOops = Date.now();
  const v = (typeof S !== 'undefined' && S?.version) || {};
  const details = [
    `Switchboard ${v.pkg || '?'} (${v.sha || v.build || '?'}, ${v.channel || 'no channel'})`,
    `Page: ${location.hash || '#now'}`,
    `When: ${new Date().toISOString()}`,
    `Browser: ${navigator.userAgent}`,
    `Error: ${msg}`,
    where ? `At: ${where}` : '',
    err?.stack ? `\n${err.stack}` : ''
  ].filter(Boolean).join('\n');
  toast(oopsWords(msg, where || err?.stack || ''), { kind: 'error', action: { label: 'Copy details', run: (b) => {
    navigator.clipboard.writeText(details).then(() => { b.textContent = 'Copied'; }).catch(() => { b.textContent = 'Could not copy'; });
  } } });
  console.error('Switchboard:', details);
}
// Which part of the page it was, and what is worth trying, from the file it
// happened in and the kind of error.
const OOPS_AREA = { 'now.js': 'Now', 'rundown.js': 'the morning rundown', 'inbox.js': 'Inbox', 'convo.js': 'the conversation', 'detail.js': 'the side panel', 'sessions.js': 'Sessions', 'chat.js': 'the session chat', 'ci.js': 'Builds', 'checks.js': 'Browser checks', 'checksauth.js': 'Browser checks, sign-in', 'pages.js': 'Money', 'costs.js': 'Recurring costs', 'notebook.js': 'Notes', 'editor.js': 'the note editor', 'settings.js': 'Settings', 'connections.js': 'Settings, Connections', 'project.js': 'the project page', 'feeds.js': 'Reading', 'tasks.js': 'Todoist', 'voice.js': 'talk to type', 'sysmon.js': 'the System monitor' };
function oopsWords(msg, where) {
  const file = (String(where).match(/\/js\/([a-z]+\.js)/) || [])[1];
  const area = OOPS_AREA[file] ? `${OOPS_AREA[file].charAt(0).toUpperCase()}${OOPS_AREA[file].slice(1)} hit a problem` : 'Something on this page hit a problem';
  if (/Cannot read propert|undefined|null/i.test(msg)) return `${area}: something it shows was missing, often a connection that has not finished loading. Wait a moment or reload; if it keeps happening, use Copy details.`;
  if (/QuotaExceeded|quota/i.test(msg)) return `${area}: the browser's storage for Switchboard is full. Drafts may not be kept; clearing this site's data in the browser fixes it.`;
  if (/NotAllowedError|Permission/i.test(msg)) return `${area}: the browser did not allow it (a microphone, the clipboard or notifications). Allow it in the browser's site settings and try again.`;
  if (/is not a function|is not defined/i.test(msg)) return `${area}: part of the page did not load properly, often half way through an update. Reload the page.`;
  return `${area}. Reload the page; if it happens again, use Copy details and send it along.`;
}
window.addEventListener('error', (e) => oops(e.error || e.message, e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : ''));
window.addEventListener('unhandledrejection', (e) => oops(e.reason, 'a promise'));
