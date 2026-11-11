// The conversation view on the Inbox: one conversation, large, like Teams or
// Discord. It is drawn once when picked and then only added to: new messages
// go in by id, the scroll stays where you left it (it follows new messages
// only when you were already at the bottom), and board refreshes never touch
// the messages or the reply being written. While it is open it checks that one
// conversation by itself: a Teams chat every few seconds, mail on a slower beat
// and whenever the board sees something newer.
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
const CV_PAGE = 40;          // messages asked for at a time
const CV_MAX = { teams: 50, outlook: 50 };
const CV_KEEP = 150;         // most messages kept on screen; older ones come back with "Load earlier"
const CV_GAP = 5 * 60e3;     // a pause this long starts a new group
let CV = null;

const cvChat = (kind) => kind === 'teams' || kind === 'team' || kind === 'voice-text';   // team: team chat (teamchat.js)
const cvStandIn = (m) => !!m.state || /^(pending|local)-/.test(String(m.id));
const cvGist = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 40);
const cvSame = (a, b) => { const x = cvGist(a), y = cvGist(b); return !!x && !!y && (x.startsWith(y) || y.startsWith(x)); };

// Which conversation the page wants open, if any. One stays open after a reply
// takes it off the lists (find() falls back to it).
function convoWanted() {
  if (page !== 'inbox' || !selected || selected.type !== 'thread' || !S) return null;
  return find('thread', selected.key);
}
const convoThread = (key) => (CV && CV.key === key ? CV.thread : null);

// Called by render() on every board refresh: mounts, unmounts, or touches only the header.
function syncConvo() {
  if (page !== 'inbox') delete $('page').dataset.view;
  const x = convoWanted();
  document.body.toggleAttribute('data-convo', !!x);
  if (!x) { if (CV) unmountConvo(); paintPane(); return; }
  if (!CV || CV.key !== x.key) { mountConvo(x); return; }
  CV.thread = x;
  paintHead(); paintSide(); paintDrafts();
  // The board heard of something newer (a poll, a notification): fetch it now.
  if (x.date > CV.newest + 1000) pullConvo();
}

// With nothing open, Inbox's right column says what the folder has to say
// (inbox.js, inboxPane): left alone while a draft in it is being edited.
let paneShown = '';
function paintPane() {
  const host = $('convo');
  if (page !== 'inbox' || inboxWide()) { if (!host.hidden || paneShown) { host.hidden = true; host.innerHTML = ''; paneShown = ''; } bkSync(); return; }
  if (host.querySelector('.cv-draft.editing')) return;
  const html = inboxPane();
  if (html !== paneShown || host.hidden) { host.className = 'convo ib-pane'; host.innerHTML = html; paneShown = html; }
  host.hidden = false;
  bkSync();   // the open book paints itself inside its shell (bookreader.js)
}

// ---------- building blocks
const AV_COLORS = ['#2F5D8A', '#1F7A4D', '#7A3E9D', '#8A6D1F', '#0E7C86', '#B42318', '#5C626C', '#B33300'];
function avatar(name, cls = '') {
  const n = String(name || '?').replace(/[<>"]/g, '').trim();
  const words = n.replace(/@.*/, '').split(/[\s._-]+/).filter((w) => /^\p{L}/u.test(w));
  const ini = ((words[0]?.[0] || n[0] || '?') + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
  let h = 0; for (const c of n.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `<span class="cv-av ${cls}" style="background:${AV_COLORS[h % AV_COLORS.length]}" aria-hidden="true">${esc(ini)}</span>`;
}
const cvDay = (t) => new Date(t).toDateString();
function cvDayLabel(t) {
  const d = new Date(t), today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const diff = Math.round((today - day) / 86400e3);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return d.toLocaleDateString([], { weekday: 'long' });
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) });
}
const cvClock = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
// Escaped first, then web addresses made clickable (opening in a new tab, no referrer).
function linkify(s) {
  return esc(s).replace(/\bhttps?:\/\/[^\s<]+/g, (u) => {
    const [, url, tail] = u.match(/^(.*?)((?:[.,;:!?)\]]|&#39;|&quot;)*)$/);
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>${tail}`;
  });
}

function msgHtml(m, prev, withDay = true) {
  const newDay = !prev || cvDay(prev.date) !== cvDay(m.date);
  const head = !CV.chat || newDay || prev.from_me !== m.from_me || prev.from_name !== m.from_name || m.date - prev.date > CV_GAP || !!prev.state !== !!m.state;
  const name = m.from_me ? 'You' : m.from_name;
  const stamp = `<time datetime="${new Date(m.date).toISOString()}" title="${esc(new Date(m.date).toLocaleString())}">${cvClock(m.date)}</time>`;
  const long = !CV.chat && m.text.length > 1600;
  const cut = CV.kind === 'mail' && !m.from_me && m.text.length >= 560 && !CV.full.has(m.id);
  const subject = !CV.chat && m.subject && m.subject.replace(/^(re|fwd?):\s*/i, '') !== String(CV.thread.subject || '').replace(/^(re|fwd?):\s*/i, '') ? `<span class="cv-msub">${esc(m.subject)}</span>` : '';
  const gutter = !head ? `<span class="cv-hover">${cvClock(m.date)}</span>` : CV.chat && m.from_me ? '<span></span>' : avatar(name);
  return (withDay && newDay ? `<div class="cv-day" role="separator"><span>${cvDayLabel(m.date)}</span></div>` : '')
    + `<div class="cv-msg${head ? ' head' : ''}${m.from_me ? ' me' : ''}${m.state ? ' is-' + m.state : ''}" data-id="${esc(m.id)}">${gutter}<div class="cv-content">`
    + (head ? `<div class="cv-meta">${CV.chat && m.from_me ? '' : `<b>${esc(name)}</b>`}${stamp}${subject}</div>` : '')
    + (CV.kind === 'team' ? tcQuote(m) : '')
    + (m.text ? `<div class="cv-text${long ? ' long' : ''}">${CV.kind === 'team' ? tcText(m) : linkify(m.text)}</div>` : '')
    + cvExtras(m)
    + (long ? `<button class="cv-link" type="button" data-cv="more">Show all of it</button>` : '')
    + (cut ? `<button class="cv-link" type="button" data-cv="full">Show the whole email</button>` : '')
    + (m.state === 'sending' ? `<span class="cv-state">Sending…</span>` : '')
    + `</div></div>`;
}

function composerHtml(x) {
  const ms = S.status.microsoft;
  if ((x.kind === 'teams' || x.kind === 'outlook') && ms && ms.canWrite === false) {
    return `<p class="note-line">Replying in ${x.kind === 'teams' ? 'Teams' : 'Outlook'} needs one more Microsoft sign-in: Settings, Microsoft 365, Connect.</p>`;
  }
  const from = x.kind === 'mail' && S.sendAs.length ? `<div class="cv-from"><label for="r-from">From</label><select id="r-from">${S.sendAs.map((a) => `<option value="${esc(a.address)}" ${a.address === guessFrom(x) ? 'selected' : ''}>${esc(a.address)}</option>`).join('')}</select>${mtToggle('r-track')}</div>` : '';
  const hint = x.kind === 'team' ? tcHint(x) : x.kind.startsWith('voice') ? 'Sends as a text from your Google Voice number.' : x.kind === 'teams' ? 'Sends in the Teams chat.' : x.kind === 'outlook' ? 'Replies in Outlook.' : 'Replies in the same email thread.';
  const ph = cvChat(x.kind) ? `Message ${x.who}` : `Reply to ${x.who}`;
  return `${from}${x.kind === 'team' ? tcComposerTop(x) : ''}<div class="cv-box"><label for="r-text" class="sr">Reply</label><textarea id="r-text" rows="1" placeholder="${esc(ph)}">${esc(draft[x.key] || '')}</textarea>
    <button class="mic" type="button" data-mic="r-text" title="Talk to type"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg><span class="sr">Dictate</span></button>
    ${cvCanAttach(x.kind) ? cvAttachButton() : ''}<button class="btn btn--primary" type="button" data-act="send">Send</button></div>${cvCanAttach(x.kind) ? '<div class="cv-attach" id="cv-attach" hidden></div>' : ''}
    <div class="cv-hint">${hint} <kbd>Ctrl</kbd> <kbd>Enter</kbd> sends. Nothing goes until you send it.</div>`;
}

// ---------- mount, unmount, header, details
function mountConvo(x) {
  if (CV) unmountConvo();
  CV = { key: x.key, kind: x.kind, chat: cvChat(x.kind), thread: x, msgs: [], byId: new Map(), full: new Set(), limit: CV_PAGE, more: false,
    timer: null, fails: 0, busy: false, again: false, loaded: false, atBottom: true, unseen: 0, newest: 0, seq: 0, headHtml: '', sideHtml: '' };
  const host = $('convo');
  paneShown = '';
  host.className = 'convo ' + (CV.chat ? 'cv-chat' : 'cv-mail');
  host.innerHTML = `<header class="cv-head" id="cv-head"></header>
    <div class="cv-body"><div class="cv-main">
      <div class="cv-scroll" id="cv-scroll"><div class="cv-earlier" id="cv-earlier" hidden><button class="btn" type="button" data-cv="earlier">Load earlier messages</button></div>
        <div class="cv-list" id="cv-list" role="log" aria-label="Messages"><p class="cv-note">Opening the conversation…</p></div>
        <div class="cv-drafts" id="cv-drafts"></div></div>
      <button class="btn cv-pill" id="cv-pill" type="button" data-cv="bottom" hidden></button>
    </div><aside class="cv-side" id="cv-side" ${store.get('cvSide', false) ? '' : 'hidden'}></aside></div>
    <div class="cv-compose">${composerHtml(x)}</div>`;
  host.hidden = false;
  $('cv-scroll').addEventListener('scroll', cvOnScroll, { passive: true });
  paintHead(); paintSide(); paintDrafts();
  const ta = $('r-text');
  if (ta) { ta.focus({ preventScroll: true }); ta.selectionStart = ta.selectionEnd = ta.value.length; }
  pullConvo();
}

function unmountConvo() {
  clearTimeout(CV.timer);
  CV = null;
  const host = $('convo');
  host.hidden = true; host.innerHTML = '';
}

function openIn(x) {
  if (!x.link) return '';
  const name = x.kind === 'teams' ? 'Teams' : x.kind === 'outlook' ? 'Outlook' : ((S.status.gmail.find((g) => g.email === x.account) || {}).name || 'Gmail');
  return `<a class="btn" href="${safeHref(x.link)}" target="_blank" rel="noopener">Open in ${esc(name)}</a>`;
}

function paintHead() {
  const x = CV.thread;
  const mailish = x.kind === 'mail' || x.kind === 'outlook';
  const side = !$('cv-side')?.hidden;
  const html = `<button class="cv-back" type="button" data-cv="close" title="Back to the list (Esc)"><span aria-hidden="true">←</span><span class="sr">Back to the list</span></button>${avatar(x.who, 'big')}
    <div class="cv-title"><h2>${esc(x.who)}</h2><div class="cv-sub">${tag(x.space)}<span>${esc(spaceOf(x.space).name)}</span><span class="via">${esc(VIA[x.kind] || 'Email')}</span>${mailish && x.subject ? `<span class="cv-subject">${esc(x.subject)}</span>` : ''}</div></div>
    <div class="cv-acts"><button class="btn" data-act="archive" type="button">Done${x.kind === 'mail' ? ' (archive)' : ''}</button>${openIn(x)}
      <button class="btn btn--quiet" type="button" data-cv="side" aria-pressed="${side}">Details</button></div>`;
  if (html !== CV.headHtml) { CV.headHtml = html; $('cv-head').innerHTML = html; }
}

function paintSide() {
  const x = CV.thread, el = $('cv-side');
  if (!el || el.hidden) return;
  const html = `<div class="section-label">Details</div>
    <dl class="facts">${x.kind === 'mail' || x.kind === 'outlook' ? `<dt>Subject</dt><dd>${esc(x.subject)}</dd>` : ''}${x.replied ? `<dt>Last</dt><dd>You, ${since(x.date)}</dd>` : `<dt>From</dt><dd>${esc(x.from)}</dd><dt>Waiting</dt><dd>${ago(x.date)}</dd>`}</dl>
    <div class="actions">${x.unread && x.kind !== 'teams' ? `<button class="btn" data-act="read" type="button">Mark read</button>` : ''}<button class="btn" data-act="snooze-thread" data-hours="3" type="button">Snooze 3h</button><button class="btn" data-act="snooze-thread" data-hours="tomorrow" type="button">Tomorrow</button></div>
    ${x.kind === 'team' ? tcSide() : toSession(x)}`;
  if (html !== CV.sideHtml) { CV.sideHtml = html; el.innerHTML = html; }
}

// ---------- messages on screen
function cvList() { return $('cv-list'); }
function toBottom() {
  const sc = $('cv-scroll'); if (!sc) return;
  sc.scrollTop = sc.scrollHeight;
  CV.atBottom = true; CV.unseen = 0; $('cv-pill').hidden = true;
}
function cvOnScroll() {
  const sc = $('cv-scroll');
  CV.atBottom = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 48;
  if (CV.atBottom && CV.unseen) { CV.unseen = 0; $('cv-pill').hidden = true; }
}
function showPill() {
  const p = $('cv-pill');
  p.textContent = `${CV.unseen} new message${CV.unseen === 1 ? '' : 's'} ↓`;
  p.hidden = false;
}
function reindex() { CV.byId = new Map(CV.msgs.map((m) => [m.id, m])); }

// Everything again: the first time, after "Load earlier", or when something was removed.
function drawAll(mode) {
  const sc = $('cv-scroll'), fromBottom = sc.scrollHeight - sc.scrollTop;
  cvList().innerHTML = CV.msgs.map((m, i) => msgHtml(m, CV.msgs[i - 1])).join('') || `<p class="cv-note">No messages from the last 14 days here yet.</p>`;
  $('cv-earlier').hidden = !CV.more;
  if (mode === 'bottom') toBottom(); else sc.scrollTop = sc.scrollHeight - fromBottom;
}

function appendMsgs(added, follow) {
  if (!CV.msgs.length || !cvList().querySelector('.cv-msg')) cvList().innerHTML = '';
  const wasBottom = CV.atBottom;
  let prev = CV.msgs[CV.msgs.length - 1], html = '';
  for (const m of added) { html += msgHtml(m, prev); prev = m; CV.msgs.push(m); CV.byId.set(m.id, m); }
  cvList().insertAdjacentHTML('beforeend', html);
  if (CV.msgs.length > CV_KEEP && (wasBottom || follow)) {
    CV.msgs = CV.msgs.slice(-CV_KEEP); reindex(); CV.more = true; CV.limit = CV_PAGE;
    drawAll('bottom'); return;
  }
  if (wasBottom || follow) toBottom();
  else { CV.unseen += added.filter((m) => !m.from_me).length; if (CV.unseen) showPill(); }
}

// One message redrawn where it stands (edited, confirmed, or read in full).
function redraw(m, id = m.id) {
  const el = cvList().querySelector(`.cv-msg[data-id="${CSS.escape(String(id))}"]`);
  if (!el) return;
  const sc = $('cv-scroll'), keep = CV.atBottom;
  const i = CV.msgs.indexOf(m);
  el.outerHTML = msgHtml(m, CV.msgs[i - 1], false);
  if (keep) sc.scrollTop = sc.scrollHeight;
}

// What the server says now, folded into what is on screen.
function mergeMsgs(list) {
  const added = [];
  let older = false, removed = false;
  for (const m of list) {
    const have = CV.byId.get(m.id);
    if (have) {
      // Edited, or its pictures or reactions changed (teamspics.js).
      // (A team chat message you are editing stays as it is until you save or cancel.)
      if (CV.kind === 'team' && TC.editing === have.id) continue;
      if (have.text !== m.text || cvExtrasKey(have) !== cvExtrasKey(m)) {
        have.text = m.text; have.pictures = m.pictures; have.reactions = m.reactions;
        for (const k of ['edited', 'deleted', 'pinned', 'seen', 'seenBy', 'reply']) if (k in m) have[k] = m[k];   // team chat
        redraw(have);
      }
      continue;
    }
    // Our own just-sent reply coming back from the server: the same bubble, now with its real id.
    const mine = m.from_me && CV.msgs.find((x) => x.from_me && cvStandIn(x) && cvSame(x.text, m.text));
    if (mine) { const was = mine.id; CV.byId.delete(was); Object.assign(mine, m); delete mine.state; CV.byId.set(mine.id, mine); redraw(mine, was); continue; }
    if (CV.msgs.length && m.date < CV.newest) older = true;
    added.push(m);
  }
  // Gone at the source (deleted, or a stand-in replaced) within the stretch the server covered.
  if (list.length) {
    const ids = new Set(list.map((m) => m.id)), from = list[0].date;
    const keep = CV.msgs.filter((x) => cvStandIn(x) || x.date < from || ids.has(x.id) || (x.from_me && Date.now() - x.date < 60e3));
    if (keep.length !== CV.msgs.length) { CV.msgs = keep; removed = true; }
  }
  if (older || removed) {
    CV.msgs = [...CV.msgs, ...added].sort((a, b) => (cvStandIn(a) - cvStandIn(b)) || a.date - b.date);
    reindex(); drawAll(CV.atBottom ? 'bottom' : 'keep');
    if (!CV.atBottom && added.some((m) => !m.from_me && m.date >= CV.newest)) { CV.unseen += added.length; showPill(); }
  } else if (added.length) {
    // Stand-ins stay last until they are confirmed.
    const tail = CV.msgs.filter(cvStandIn);
    if (tail.length) { CV.msgs = CV.msgs.filter((x) => !cvStandIn(x)); CV.msgs.push(...added, ...tail); reindex(); drawAll(CV.atBottom ? 'bottom' : 'keep'); }
    else appendMsgs(added, false);
  }
  $('cv-earlier').hidden = !CV.more;
}

function noteNewest() {
  CV.newest = Math.max(0, ...CV.msgs.filter((m) => !cvStandIn(m)).map((m) => m.date));
}

// ---------- asking the server
async function pullConvo() {
  if (!CV) return;
  if (CV.busy) { CV.again = true; return; }
  const key = CV.key;
  CV.busy = true; clearTimeout(CV.timer);
  try {
    const d = await api(`/api/conversation?key=${encodeURIComponent(key)}&limit=${CV.limit}`);
    if (!CV || CV.key !== key) return;
    CV.fails = 0; CV.more = !!d.more;
    if (!CV.loaded) {
      CV.loaded = true;
      const pending = CV.msgs.filter(cvStandIn);
      CV.msgs = [...d.messages, ...pending]; reindex(); drawAll('bottom');
    } else mergeMsgs(d.messages);
    noteNewest();
    if (CV.kind === 'team') tcAfterPull(d);   // typing, pins, seen (teamchat.js)
    cvLoadFiles();   // pictures and files in email and Outlook (mailfiles.js)
  } catch (e) {
    if (!CV || CV.key !== key) return;
    CV.fails++;
    if (!CV.loaded) cvList().innerHTML = `<p class="cv-note">Could not open the conversation: ${esc(e.message)}. Trying again shortly.</p><div class="cv-msg head"><span class="cv-hover"></span><div class="cv-content"><div class="cv-meta"><b>${esc(CV.thread.who)}</b></div><div class="cv-text">${linkify(CV.thread.snippet || CV.thread.subject || '')}</div></div></div>`;
  } finally {
    if (CV && CV.key === key) {
      CV.busy = false;
      if (CV.again) { CV.again = false; pullConvo(); } else cvSchedule();
    }
  }
}

// A Teams chat every 4 seconds while you can see it; mail from this computer's
// copy every 20. Slower when the page is hidden, and slower again after errors.
function cvSchedule() {
  clearTimeout(CV.timer);
  const hidden = document.hidden;
  let ms = CV.kind === 'team' ? (hidden ? 30e3 : 3e3) : CV.kind === 'teams' ? (hidden ? 30e3 : 4e3) : CV.kind === 'outlook' ? (hidden ? 120e3 : 30e3) : (hidden ? 120e3 : 20e3);
  if (CV.fails) ms = Math.min(120e3, ms * 2 ** Math.min(CV.fails, 5));
  CV.timer = setTimeout(pullConvo, ms);
}
document.addEventListener('visibilitychange', () => { if (CV && !document.hidden) pullConvo(); });

// ---------- sending: shown at once, confirmed when the server answers
async function convoSend(x) {
  stopDictation(); await dictated;
  const ta = $('r-text');
  const text = (ta?.value || '').trim();
  const images = cvCanAttach(x.kind) ? cvPicsTake() : [];
  if (!text && !images.length) { toast('Write something first.'); return; }
  const from = $('r-from')?.value;
  ta.value = ''; delete draft[x.key]; ta.focus();
  const m = { id: 'pending-' + (++CV.seq), from_me: 1, from_name: 'You', text, date: Date.now(), state: 'sending', ...(images.length ? { pictures: images.map((im) => `data:${im.type};base64,${im.data}`) } : {}) };
  appendMsgs([m], true);
  try {
    const r = await api('/api/reply', { key: x.key, text, from, messageId: x.messageId, images, track: mtTrackValue('r-track'), ...(x.kind === 'team' ? { replyTo: tcReplyTake() } : {}) });
    if (CV?.key === x.key && CV.byId.get(m.id) === m) {
      const was = m.id;
      if (r.id && !CV.byId.has(r.id)) { CV.byId.delete(was); m.id = r.id; CV.byId.set(m.id, m); }
      delete m.state; redraw(m, was);
    }
    setTimeout(() => { if (CV?.key === x.key) pullConvo(); }, x.kind === 'teams' ? 700 : 100);
    load();
  } catch (e) {
    if (CV?.key === x.key) {
      CV.msgs = CV.msgs.filter((y) => y !== m); reindex(); drawAll(CV.atBottom ? 'bottom' : 'keep');
      const box = $('r-text'); if (box && !box.value) { box.value = text; draft[x.key] = text; }
      if (images.length) cvPicsPutBack(images);
    }
    toast('Not sent: ' + e.message);
  }
}

// The start of an email is kept on this computer; the rest comes from the mail server on request.
async function loadWholeEmail(btn) {
  const key = CV.key, id = btn.closest('.cv-msg')?.dataset.id;
  btn.disabled = true; btn.textContent = 'Getting the whole email…';
  try {
    const d = await api(`/api/thread/full?key=${encodeURIComponent(key)}`);
    if (!CV || CV.key !== key) return;
    for (const f of d.messages || []) {
      const m = f.id && CV.byId.get(f.id);
      if (m && f.text && f.text.length >= m.text.length) { m.text = f.text; CV.full.add(m.id); redraw(m); }
    }
    if (id && !CV.full.has(id)) { CV.full.add(id); const m = CV.byId.get(id); if (m) redraw(m); toast('Only the start of that email is kept here. Open it in your mail for the rest.'); }
  } catch (e) { toast(e.message, { kind: 'error' }); if (btn.isConnected) { btn.disabled = false; btn.textContent = 'Show the whole email'; } }
}

// ---------- clicks and keys inside the conversation
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-cv]');
  if (!b || !CV) return;
  const what = b.dataset.cv;
  if (what === 'close') { selected = null; render(); }
  else if (what === 'bottom') toBottom();
  else if (what === 'earlier') { CV.limit = Math.min(CV.limit + CV_PAGE, CV_MAX[CV.kind] || 400); pullConvo(); }
  else if (what === 'side') { const s = $('cv-side'); s.hidden = !s.hidden; store.set('cvSide', !s.hidden); CV.sideHtml = ''; paintSide(); paintHead(); }
  else if (what === 'more') { b.previousElementSibling?.classList.remove('long'); b.remove(); }
  else if (what === 'full') loadWholeEmail(b);
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !CV || document.querySelector('.scrim.open')) return;
  if (e.target.closest?.('input, textarea, select') && e.target.value) return;
  e.preventDefault();   // the conversation closes; the Deck's Esc (deck.js) stays put
  selected = null; render();
});
