// Clicks and keys across the board, and sending conversations into a session.
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
// ---------- actions
// One line at the bottom. An error ({ kind: 'error' }) gets a red edge and
// stays longer; anything else is gone in three seconds.
let toastTimer;
function toast(msg, { kind = 'ok' } = {}) {
  const t = $('toast'); t.textContent = msg; t.classList.toggle('error', kind === 'error'); t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), kind === 'error' ? 6000 : 3200);
}
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
    else if (name === 'seen') await api('/api/seen', { sessionId: x.id });
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
      await api('/api/reply', { key: x.key, text, from: $('r-from')?.value, messageId: x.messageId });
      delete draft[x.key];
      if (t === 'awaiting') await api('/api/clear', { key: 'await:' + x.key });
      selected = null; toast('Sent.');
    } else if (name === 'archive') { await api('/api/archive', { key: x.key, messageId: x.messageId }); selected = null; toast('Done.'); }
    else if (name === 'read') { await api('/api/read', { key: x.key, messageId: x.messageId }); toast('Marked read.'); }
    else if (name === 'snooze-thread') {
      const until = btn.dataset.hours === 'tomorrow' ? tomorrow9() : Date.now() + Number(btn.dataset.hours) * 3600e3;
      await api('/api/clear', { key: x.key, until }); selected = null; toast('Snoozed until ' + when(until) + '.');
    } else if (name === 'stop-waiting') { await api('/api/clear', { key: 'await:' + x.key }); selected = null; toast('Stopped waiting.'); }
    else if (name === 'paid') { await api(`/api/items/${x.id}/paid`, {}); selected = null; toast('Marked paid.'); }
    else if (['done', 'delete', 'undo'].includes(name)) { await api(`/api/items/${x.id}/${name}`, {}); selected = null; toast({ done: 'Done.', delete: 'Deleted.', undo: 'Back on the list.' }[name]); }
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
  const sp = e.target.closest('.space');
  if (sp) { project = sp.dataset.space; store.set('space', project); selected = null; render(); return; }
  const nf = e.target.closest('[data-now]');
  if (nf) { nowFilter = nf.dataset.now; store.set('nowFilter', nowFilter); render(); return; }
  const tb = e.target.closest('[data-tab]');
  if (tb) { inboxTab = tb.dataset.tab; inboxSource = 'all'; store.set('inboxTab', inboxTab); selected = null; render(); return; }
  const src = e.target.closest('[data-source]');
  if (src) { inboxSource = src.dataset.source; render(); return; }
  const a = e.target.closest('[data-act]');
  if (a) { act(a.dataset.act, a); return; }
  const it = e.target.closest('[data-type]');
  if (it) {
    if (it.dataset.type === 'window') { api('/api/focus', { windowId: Number(it.dataset.key) }).catch(() => {}); closeDialog('windows-scrim'); return; }
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
    const b = $('update-btn'); b.disabled = true; b.textContent = 'Updating…';
    api('/api/update', {}).then(() => toast('Updated. Restarting, the page reloads in a moment.')).catch((err) => { toast(err.message, { kind: 'error' }); b.disabled = false; b.textContent = 'Update ready'; });
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
