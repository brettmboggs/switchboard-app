// Ctrl K with a target, from any page (Nov 5 2026): type a word, then what to
// say, and pick where it goes in the list; you stay on the page you are on.
//   note call Sam about the invoice     a checkbox at the bottom of a page you pick
//                                       (the one you added to last comes first),
//                                       a new page, or a quick note as before
//   note groceries: eggs                the page named before the colon
//   sesh add a test for the button      a message to a session you pick (queued
//                                       if it is busy), or a new session
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here. The
// list is search.js's own (cmdHits), so arrows, Enter and clicks work the same.
const TARGET_WORDS = { note: 'note', notes: 'note', sesh: 'sesh', session: 'sesh' };
let ntDraft = null;   // a message for the session about to be started (sessions.js puts it in its box)
function cmdTargets(q) {
  const m = q.match(/^(\w+)\s+([\s\S]+)$/);
  const kind = m && TARGET_WORDS[m[1].toLowerCase()];
  if (!kind) return false;
  let text = m[2].trim();
  if (kind === 'note') {
    // "note groceries: eggs": the page is named before the colon.
    const named = text.match(/^([^:]{2,60}):\s*(.+)$/), pages = S.pages || [];
    const byName = named && pages.find((p) => (p.title || '').toLowerCase().replace(/\s+list$/, '') === named[1].trim().toLowerCase().replace(/\s+list$/, ''));
    if (byName) text = named[2].trim();
    const last = store.get('lastNotePage', null), here = captureSpace();
    const score = (p) => (byName && p.uid === byName.uid ? 1e15 : 0) + (p.uid === last ? 1e14 : 0) + (here !== 'all' && inSpace(p, here) ? 1e13 : 0) + (p.checks?.total ? 1e12 : 0) + (p.updated_at || 0);
    const list = [...pages].sort((a, b) => score(b) - score(a)).slice(0, 6);
    cmdHits = [
      ...list.map((p) => ({ type: 'target', act: 'note-page', uid: p.uid, text, space: p.space, title: p.title || 'Untitled', line: `adds "${text}" as a checkbox at the bottom${p.uid === last ? ' · where you added last' : ''}` })),
      { type: 'target', act: 'note-new', text, title: named && !byName ? `New page "${named[1].trim()}"` : 'New page', line: `starts with "${named && !byName ? named[2].trim() : text}" as its first checkbox`, newTitle: named && !byName ? named[1].trim() : '', item: named && !byName ? named[2].trim() : text },
      { type: 'target', act: 'note-quick', text: m[2].trim(), title: 'Just a quick note', line: 'saved on its own, as before' }
    ];
  } else {
    const order = { waiting: 0, finished: 1, idle: 2, running: 3, starting: 4 };
    const terms = allTerms().sort((a, b) => (order[a.state] ?? 5) - (order[b.state] ?? 5));
    cmdHits = [
      ...terms.slice(0, 7).map((t) => ({ type: 'target', act: 'sesh', key: t.key, text, space: t.space, title: termLabel(t), line: (TERM_STATE[t.state] || t.state) + (t.state === 'running' || t.state === 'starting' ? ' · queued until it is free' : '') })),
      { type: 'target', act: 'sesh-new', text, title: 'New session…', line: 'pick a folder; your message waits in its box' }
    ];
  }
  cmdSel = 0; drawCmdResults();
  $('cmd-hint').textContent = kind === 'note' ? 'Pick the page · Enter adds it · you stay where you are' : 'Pick the session · Enter sends it · you stay where you are';
  return true;
}
// A new page's title from a long note: cut at a word with an ellipsis, never
// mid-word; the whole note is the page's first checkbox either way.
function shortTitle(s, n = 80) { return s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, '') + '…'; }
async function runTarget(r) {
  try {
    if (r.act === 'note-page') {
      const res = await api('/api/note-add', { uid: r.uid, text: r.text });
      store.set('lastNotePage', r.uid);
      toast(`Added to ${res.title}.`, { action: { label: 'Open', run: () => openPage(r.uid) } });
    } else if (r.act === 'note-new') {
      const p = await api('/api/pages', { title: r.newTitle || shortTitle(r.item), body: `<ul class="checklist"><li data-checked="false">${esc(r.item)}</li></ul>`, space: captureSpace() === 'all' ? 'personal' : captureSpace() });
      store.set('lastNotePage', p.uid);
      toast(`New page "${p.title}", your whole note as its first checkbox.`, { action: { label: 'Open', run: () => openPage(p.uid) } });
    } else if (r.act === 'note-quick') {
      const item = await api('/api/capture', { line: 'note ' + r.text, space: captureSpace() });
      toast(`Note saved · ${spaceOf(item.space).name}`);
    } else if (r.act === 'sesh') {
      const t = termByKey(r.key);
      if (!t) throw new Error('That session has ended. Pick another one.');
      await api(termPath(t, 'queue'), { text: r.text });
      const free = t.state === 'finished' || t.state === 'idle' || t.state === 'waiting';
      toast(free ? `Sent to ${termLabel(t)}.` : `Queued for ${termLabel(t)}. It goes in when the agent is free.`);
    } else if (r.act === 'sesh-new') {
      ntDraft = r.text;
      openNewTerm();
      return;
    }
    await load();
  } catch (err) { toast(err.message, { kind: 'error' }); }
}
