// "Bring in a conversation" on a session: recent conversations, one message at a
// time. Add (or drag) brings in just that message, with who sent it and when;
// the arrow opens the conversation's earlier messages, each with its own Add.
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
let bringOpen = null;
const bringFull = {};   // thread key -> { date, messages } from /api/thread/full

// Recent conversations from the server (/api/bring), fetched when the list opens;
// what waits in the Inbox comes first, so it is there before the fetch returns.
let bringPool = [], bringAt = 0;
const bringAllThreads = () => { const seen = new Set(); return [...S.threads, ...S.recent, ...(S.email || []), ...bringPool].filter((x) => !seen.has(x.key) && seen.add(x.key)); };
const bringThread = (key) => bringAllThreads().find((t) => t.key === key);
async function bringFetch(force) {
  if (!force && Date.now() - bringAt < 30e3) return;
  bringAt = Date.now();
  try { bringPool = (await api('/api/bring')).list || []; } catch { bringAt = 0; }
  renderBringPop();
}
const stamp = (t) => new Date(t).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// The conversation's messages in full, oldest first; fetched once per new message.
async function fullMessages(x) {
  const c = bringFull[x.key];
  if (c && c.date === x.date) return c.messages;
  const d = await api(`/api/thread/full?key=${encodeURIComponent(x.key)}`);
  bringFull[x.key] = { date: x.date, messages: d.messages || [] };
  return bringFull[x.key].messages;
}

function oneMessage(x, m) {
  const via = VIA[x.kind] || 'Email';
  const subject = x.subject && (x.kind === 'mail' || x.kind === 'outlook') ? `, subject "${x.subject}"` : '';
  const who = m.from === 'You' ? `you to ${x.who}` : m.from;
  return `${via} from ${who}, ${stamp(m.date)}${subject}:\n${m.text}`;
}

// "key" is the newest message from them; "key|3" is the conversation's fourth message.
async function bringText(v) {
  const cut = v.lastIndexOf('|');
  const idx = cut > 0 && /^\d+$/.test(v.slice(cut + 1)) ? Number(v.slice(cut + 1)) : null;
  const x = bringThread(idx === null ? v : v.slice(0, cut));
  if (!x) return '';
  let m = null;
  try {
    const msgs = await fullMessages(x);
    m = idx !== null ? msgs[idx] : ([...msgs].reverse().find((y) => y.from !== 'You') || msgs[msgs.length - 1]);
  } catch {}
  return oneMessage(x, m || { from: x.who, date: x.date, text: x.snippet || x.subject || '' });
}

function toggleBring(key) {
  bringOpen = bringOpen === key ? null : key;
  const x = bringOpen && bringThread(bringOpen);
  if (x && bringFull[x.key]?.date !== x.date) fullMessages(x).catch(() => { bringFull[x.key] = { date: x.date, messages: [], error: true }; }).finally(() => { renderBringPop(); if (page === 'sessions') renderDetail(); });
  renderBringPop(); if (page === 'sessions') renderDetail();
}

// The session's project's conversations first; a search finds any of them,
// and the rest fold out under "Other projects". A conversation from another
// project can be linked to this one: that adds a rule (Settings, Projects)
// with the sender's address, or the Teams chat's name, so it comes here from now on.
let bringQ = '', bringAll = false;
const bringHay = (x) => `${x.who} ${x.from || ''} ${x.subject || ''} ${x.snippet || ''}`.toLowerCase();
// What a rule for this conversation would match: an address for mail, the name for a chat.
const linkText = (x) => x.kind === 'teams' ? x.who : /@/.test(x.from || '') ? String(x.from).toLowerCase() : null;

function bringRow(x, t, side = false) {
  const open = bringOpen === x.key, c = bringFull[x.key];
  const other = !inSpace(x, t.space);
  const link = other && linkText(x) ? `<button class="bring-more bring-link" type="button" data-bring-link="${esc(x.key)}" title="Messages from ${esc(linkText(x))} go to ${esc(spaceOf(t.space).name)} from now on">Link to ${esc(spaceOf(t.space).name)}</button>` : '';
  const head = `<div class="bring-item${open ? ' open' : ''}${x.unread ? ' unread' : ''}" draggable="true" data-bring="${esc(x.key)}">
    <button class="bring-add" type="button" data-bring-add="${esc(x.key)}" title="Add to your message"><span class="bi-who">${other ? tag(x.space) : ''}${esc(x.who)}</span><span class="bi-when">${when(x.date)}</span><span class="bi-s">${esc(x.snippet || x.subject || '')}</span></button>
    <span class="bring-acts">${link}${side ? `<button class="bring-more" type="button" data-bring-add="${esc(x.key)}">Add to message</button>` : ''}<button class="bring-more" type="button" data-bring-more="${esc(x.key)}" aria-expanded="${open}">${open ? 'Close' : 'Earlier'}</button>${side ? `<button class="bring-more" type="button" data-msg-hide="${esc(x.key)}" title="Hide until someone writes again">Hide</button>` : ''}</span></div>`;
  if (!open) return head;
  const msgs = c && c.date === x.date ? c.messages : null;
  const body = !msgs ? `<p class="bring-none">Getting messages…</p>`
    : !msgs.length ? `<p class="bring-none">${c.error ? 'Could not get the messages.' : 'No messages found.'}</p>`
    : msgs.map((m, i) => ({ m, i })).reverse().slice(0, 12).map(({ m, i }) => `<button class="bring-msg" type="button" draggable="true" data-bring="${esc(x.key)}|${i}" data-bring-add="${esc(x.key)}|${i}" title="Add to your message"><span class="bi-who">${esc(m.from)}</span><span class="bi-when">${when(m.date)}</span><span class="bi-s">${esc(m.text)}</span></button>`).join('');
  return head + `<div class="bring-msgs">${body}</div>`;
}

function bringList(t) {
  let list = bringAllThreads().sort((a, b) => b.date - a.date);
  const q = bringQ.trim().toLowerCase();
  if (q) list = list.filter((x) => bringHay(x).includes(q));
  // Personal is a project like any other: its own first, the rest folded away.
  const mine = list.filter((x) => inSpace(x, t.space));
  const rest = list.filter((x) => !inSpace(x, t.space));
  const name = esc(spaceOf(t.space).name);
  const top = mine.length ? mine.slice(0, q ? 30 : 15).map((x) => bringRow(x, t)).join('')
    : `<p class="bring-none">${q ? `Nothing in ${name} matches.` : `No recent messages in ${name} yet. Open Other projects and use Link to ${name} on a conversation, and messages from that person come here from now on.`}</p>`;
  const showRest = bringAll || (q && !mine.length);
  const more = !rest.length ? '' : `<button class="bring-fold" type="button" data-bring-all aria-expanded="${showRest}">${showRest ? 'Hide other projects' : `Other projects (${rest.length})`}</button>${showRest ? rest.slice(0, 30).map((x) => bringRow(x, t)).join('') : ''}`;
  return `<div class="bring">${top}${more}</div>`;
}

async function bringLink(key) {
  const x = bringThread(key), t = termByKey(currentTerm), v = x && linkText(x);
  if (!x || !t || !v) return;
  try {
    const cur = await api('/api/settings');
    const rules = (cur.rules || []).filter((r) => r[0].toLowerCase() !== v.toLowerCase());
    await api('/api/settings', { rules: [[v, t.space], ...rules], rulesWas: cur.rulesWas });
    toast(`Messages from ${v} go to ${spaceOf(t.space).name} now. Change it in Settings, Projects.`);
    await load();
    await bringFetch(true);
  } catch (err) { toast(err.message, { kind: 'error' }); }
}

// The list opens over the message bar, from the button beside the paperclip:
// messages go where the message is written. The head (with the search) is
// drawn once per opening, so typing in it is never interrupted; the list under it redraws.
let bringShown = false;
function renderBringPop() {
  const el = $('bring-pop'), t = termByKey(currentTerm);
  if (!el) return;
  $('q-bring')?.setAttribute('aria-expanded', String(bringShown && !!t));
  if (!bringShown || !t) { el.hidden = true; el.textContent = ''; return; }
  if (!el.querySelector('.bring-head') || el.dataset.term !== t.key) {
    el.dataset.term = t.key;
    el.innerHTML = `<div class="bring-head"><b>Bring in a message</b><span>${esc(spaceOf(t.space).name)} first. Click one to add it, or drag it in.</span><button class="btn btn--ghost btn--sm" type="button" data-bring-close>Close</button>
      <label for="bring-q" class="sr">Find a conversation</label><input id="bring-q" class="bring-q" type="search" placeholder="Find a person, subject or words" autocomplete="off" value="${esc(bringQ)}"></div><div class="bring-body"></div>`;
  }
  const body = el.querySelector('.bring-body'), html = bringList(t);
  el.hidden = false;
  if (body.dataset.html !== html) { const top = el.scrollTop; body.innerHTML = html; body.dataset.html = html; el.scrollTop = top; }
}
document.addEventListener('input', (e) => { if (e.target.id === 'bring-q') { bringQ = e.target.value; renderBringPop(); } });
document.addEventListener('click', (e) => {
  if (e.target.closest('#q-bring')) { bringShown = !bringShown; if (!bringShown) { bringQ = ''; bringAll = false; } renderBringPop(); if (bringShown) { $('bring-q')?.focus(); bringFetch(); } return; }
  if (e.target.closest('[data-bring-close]')) { bringShown = false; bringQ = ''; bringAll = false; renderBringPop(); $('q-text')?.focus(); return; }
  if (e.target.closest('[data-bring-all]')) { bringAll = !bringAll; renderBringPop(); return; }
  const lk = e.target.closest('[data-bring-link]');
  if (lk) { lk.disabled = true; bringLink(lk.dataset.bringLink); return; }
  if (bringShown && e.target.isConnected && !e.target.closest('#bring-pop')) { bringShown = false; bringQ = ''; bringAll = false; renderBringPop(); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && bringShown) { bringShown = false; bringQ = ''; bringAll = false; renderBringPop(); $('q-text')?.focus(); } });

// ---------- Messages under the session list: the session's project's latest
// conversations (waiting on you or recently replied), always in view, so a
// message about this work is seen while working on it. Add puts it into what
// you are writing (or, on Terminal, types it in at the cursor); Earlier opens
// the conversation's earlier messages; All opens the full list with search.
function sessionMessages(t) {
  if (!t || t.remote) return '';
  const name = spaceOf(t.space).name;
  const hidden = msgHidden();
  const all = bringAllThreads().filter((x) => inSpace(x, t.space));
  const list = all.filter((x) => !(hidden[x.key] >= x.date)).sort((a, b) => b.date - a.date).slice(0, 6);
  const gone = all.length - all.filter((x) => !(hidden[x.key] >= x.date)).length;
  return `<section class="ses-msgs" aria-label="Messages for ${esc(name)}"><div class="ses-msgs-head"><h3 class="kicker">Messages · ${esc(name)}</h3><span>${list.length ? `<button class="btn btn--ghost btn--sm" type="button" data-msg-clear title="Hide all of these until someone writes again">Clear all</button>` : ''}<button class="btn btn--ghost btn--sm" type="button" data-bring-open>All</button></span></div>
    ${list.length ? `<div class="bring">${list.map((x) => bringRow(x, t, true)).join('')}</div>` : `<p class="muted small ses-msgs-none">${gone ? `All caught up. A conversation you hid comes back when someone writes again.` : `No messages for ${esc(name)} in the last two weeks. Email and Teams chats land here once they are in ${esc(name)}: Settings, Projects decides which project a person's messages belong to.`}</p>`}</section>`;
}
// Hidden from this list (not from Inbox) until a newer message comes: key -> the
// newest message's time when it was hidden. Kept in this computer's settings.
const msgHidden = () => S?.prefs?.msgHidden || {};
function hideMsgs(keys) {
  const h = { ...msgHidden() };
  for (const k of keys) { const x = bringThread(k); if (x) h[k] = x.date; }
  // Only the newest 300 are kept; an old one has long since left the list anyway.
  const kept = Object.fromEntries(Object.entries(h).sort((a, b) => b[1] - a[1]).slice(0, 300));
  S.prefs.msgHidden = kept;
  if (page === 'sessions') renderDetail();
  api('/api/settings', { prefs: { msgHidden: kept } }).catch((err) => toast(err.message, { kind: 'error' }));
}
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-bring-open]')) { $('q-bring')?.click(); return; }
  const h = e.target.closest('[data-msg-hide]');
  if (h) { hideMsgs([h.dataset.msgHide]); return; }
  if (e.target.closest('[data-msg-clear]')) {
    const keys = [...document.querySelectorAll('.ses-msgs [data-msg-hide]')].map((b) => b.dataset.msgHide);
    hideMsgs(keys);
    toast(keys.length === 1 ? 'Cleared. It comes back when someone writes again.' : `Cleared ${keys.length}. Each comes back when someone writes again.`);
  }
});
