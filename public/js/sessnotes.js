// Notes beside a session: the pages and sections in the session's project (its
// main one or also, lib/belongs.js), and those tied to its repo, under its
// messages. Add puts the note's text into what you are writing (on Terminal,
// types it in at the cursor); Open opens the page. Tie a note to a repo on the
// project's page (In this project).
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
const sesNotes = {};   // session key -> { at, list }
function loadSesNotes(t) {
  const repo = String(t.cwd || '').split(/[\\/]/).filter(Boolean).pop() || '';
  const was = sesNotes[t.key];
  if (was && Date.now() - was.at < 30e3 && was.sig === (S.belongs || []).length + '|' + (S.pages || []).length) return was.list;
  sesNotes[t.key] = { at: Date.now(), list: was?.list || [], sig: (S.belongs || []).length + '|' + (S.pages || []).length };
  api(`/api/notes-for?space=${encodeURIComponent(t.space || '')}&repo=${encodeURIComponent(repo)}`).then((list) => {
    const same = JSON.stringify(list) === JSON.stringify(sesNotes[t.key]?.list);
    sesNotes[t.key] = { ...sesNotes[t.key], list };
    if (!same && page === 'sessions' && currentTerm === t.key) renderDetail();
  }).catch(() => {});
  return sesNotes[t.key].list;
}
function sessionNotes(t) {
  if (!t || t.remote) return '';
  const list = loadSesNotes(t);
  if (!list.length) return '';
  const name = spaceOf(t.space).name;
  return `<section class="ses-msgs ses-notes" aria-label="Notes for ${esc(name)}"><div class="ses-msgs-head"><h3 class="kicker">Notes · ${esc(name)}</h3></div><div class="bring">${list.slice(0, 6).map((n) => `<div class="bring-item"><button class="bring-add" type="button" data-note-add="${esc(n.key)}" title="Add this note to your message"><span class="bi-who">${esc(n.title)}${n.section ? ` → ${esc(n.section)}` : ''}</span><span class="bi-when">${n.open ? `${Number(n.open)} open` : ''}</span><span class="bi-s">${n.repo ? `Only in ${esc(n.repo)}` : n.section ? 'One section' : 'Whole page'}</span></button><span class="bring-acts"><button class="bring-more" type="button" data-note-add="${esc(n.key)}">Add to message</button><button class="bring-more" type="button" data-note-open="${esc(n.uid)}">Open</button></span></div>`).join('')}</div></section>`;
}
async function noteForSession(key) {
  const [uid, section] = key.slice(key.indexOf(':') + 1).split('#');
  const r = await api(`/api/note-text?uid=${encodeURIComponent(uid)}${section ? '&section=' + encodeURIComponent(section) : ''}`);
  return `From my notes, "${r.title}${r.section ? ' → ' + r.section : ''}":\n${r.text}`;
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-note-add]');
  if (a) {
    const p = noteForSession(a.dataset.noteAdd).catch((err) => { toast(err.message, { kind: 'error' }); return ''; });
    if (document.body.classList.contains('term-only') && tv.term) { p.then((txt) => { if (txt) { tv.term.paste(txt); tv.term.focus(); } }); return; }
    addToComposer(p); return;
  }
  const o = e.target.closest('[data-note-open]');
  if (o) openPage(o.dataset.noteOpen);
});
