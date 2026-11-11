// Email drafts (lib/drafts.js): yours, or written for you by an assistant
// through your Gmail. A draft that answers a conversation shows at the bottom
// of it in Inbox; Edit opens To, Cc, Subject and the text; Send sends it in
// that thread, Save draft puts the new version back in your Drafts (so Gmail
// shows the same), Discard moves it to Trash. Drafts are listed in Inbox, Drafts; one
// for a new email, with no conversation yet, opens in Inbox's right column.
// One of the page's scripts in public/js, loaded in order by index.html.
// Draft text came from outside: esc() on all of it.

const draftEditing = new Set();   // keys of drafts open for editing: the board's refreshes leave them alone
const findDraft = (key) => (S.drafts || []).find((d) => d.key === key);
const draftsFor = (threadKey) => (S.drafts || []).filter((d) => d.thread === threadKey);
// A draft's conversation when the board does not list it (older, or you wrote last).
const draftThread = (key) => {
  const d = (S.drafts || []).find((x) => x.thread === key);
  if (!d) return null;
  const [, account, threadId] = key.split(':');
  return { key, kind: 'mail', account, threadId, who: d.to || 'Draft', from: d.to, subject: d.subject, snippet: '', date: d.date, space: 'personal', link: null };
};

function draftHtml(d) {
  const editing = draftEditing.has(d.key);
  const head = `<div class="dr-head"><span class="dr-tag">Draft</span><span class="dr-to">${d.to ? 'To ' + esc(d.to) : 'No one yet'}${d.cc ? ` · Cc ${esc(d.cc)}` : ''}</span><span class="dr-when mono">${esc(when(d.date))}</span></div>`;
  if (!editing) {
    return `<article class="cv-draft" data-draft="${esc(d.key)}">${head}
      ${d.subject ? `<p class="dr-subject">${esc(d.subject)}</p>` : ''}<div class="dr-text">${esc(d.text || '(empty)')}</div>
      <div class="actions"><button class="btn btn--primary" type="button" data-draft-act="edit">Edit</button><button class="btn" type="button" data-draft-act="send">Send</button><button class="btn btn--quiet" type="button" data-draft-act="discard">Discard</button></div></article>`;
  }
  const field = (n, label, v) => `<label class="dr-field"><span>${label}</span><input class="field" name="${n}" value="${esc(v || '')}" autocomplete="off" spellcheck="false"></label>`;
  return `<article class="cv-draft editing" data-draft="${esc(d.key)}">${head}
    <div class="dr-form">${field('to', 'To', d.to)}${field('cc', 'Cc', d.cc)}${field('subject', 'Subject', d.subject)}
      <label class="sr" for="dr-${esc(d.id)}">Draft</label><textarea class="field dr-body" id="dr-${esc(d.id)}" name="text" rows="8">${esc(d.text || '')}</textarea></div>
    <div class="actions"><button class="btn btn--primary" type="button" data-draft-act="send">Send</button><button class="btn" type="button" data-draft-act="save">Save draft</button><button class="btn btn--quiet" type="button" data-draft-act="cancel">Cancel</button><span class="grow"></span><button class="btn btn--quiet" type="button" data-draft-act="discard">Discard</button></div>
    <p class="cv-hint">Nothing goes until you press Send. Save draft keeps it in your Drafts, where Gmail shows it too.</p></article>`;
}

// In an open conversation (convo.js): its drafts under the messages.
function paintDrafts() {
  const host = $('cv-drafts'); if (!host || !CV) return;
  if (host.querySelector('.cv-draft.editing')) return;   // being edited: leave it
  const html = draftsFor(CV.key).map(draftHtml).join('');
  if (host.dataset.html !== html) { host.innerHTML = html; host.dataset.html = html; }
}
// The side panel, for a draft with no conversation (detail.js).
function draftDetail(x, kick) {
  return kick('Email draft') + `<div class="cv-drafts">${draftHtml(x)}</div>`;
}
const draftPanelBusy = () => !!document.querySelector('#detail .cv-draft.editing, #convo .cv-draft.editing');

// The list of drafts is Inbox, Drafts (inbox.js); one in a conversation opens it.

function draftFields(card) {
  const v = (n) => card.querySelector(`[name="${n}"]`)?.value;
  const d = findDraft(card.dataset.draft);
  return { to: v('to') ?? d?.to ?? '', cc: v('cc') ?? d?.cc ?? '', subject: v('subject') ?? d?.subject ?? '', text: v('text') ?? d?.text ?? '' };
}
function redrawDraft(card) {
  const d = findDraft(card.dataset.draft);
  if (d) card.outerHTML = draftHtml(d); else card.remove();
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-draft-act]'); if (!b) return;
  const card = b.closest('[data-draft]'), key = card.dataset.draft, d = findDraft(key);
  if (!d) { toast('That draft is gone. It may have been sent or deleted somewhere else.'); card.remove(); return; }
  const act = b.dataset.draftAct;
  if (act === 'edit') { draftEditing.add(key); redrawDraft(card); document.querySelector(`[data-draft="${CSS.escape(key)}"] textarea`)?.focus(); return; }
  if (act === 'cancel') { draftEditing.delete(key); redrawDraft(card); return; }
  if (act === 'discard' && b.dataset.sure !== '1') {
    b.dataset.sure = '1'; b.textContent = 'Discard it?';
    setTimeout(() => { if (b.isConnected) { b.dataset.sure = ''; b.textContent = 'Discard'; } }, 4000);
    return;
  }
  const fields = draftFields(card);
  card.querySelectorAll('button').forEach((x) => { x.disabled = true; });
  b.textContent = act === 'send' ? 'Sending…' : act === 'save' ? 'Saving…' : 'Discarding…';
  try {
    const r = await api('/api/drafts/' + act, { account: d.account, id: d.id, ...fields });
    draftEditing.delete(key);
    S.drafts = (S.drafts || []).filter((x) => x.key !== key);
    card.remove();
    toast(act === 'send' ? `Sent to ${fields.to}.` : act === 'save' ? 'Saved to your Drafts.' : 'Discarded. It is in your mail\'s Trash if you need it back.');
    if (act === 'send' && CV && r.thread === CV.key) setTimeout(() => { if (CV?.key === r.thread) pullConvo(); }, 300);
    if (selected?.type === 'draft') selected = null;
    await load();
  } catch (err) {
    toast(err.message, { kind: 'error' });
    card.querySelectorAll('button').forEach((x) => { x.disabled = false; });
    b.textContent = act === 'send' ? 'Send' : act === 'save' ? 'Save draft' : 'Discard';
  }
});
