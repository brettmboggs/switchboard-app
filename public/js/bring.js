// "Bring in a conversation" on a session: recent conversations, one message at a
// time. Add (or drag) brings in just that message, with who sent it and when;
// the arrow opens the conversation's earlier messages, each with its own Add.
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
let bringOpen = null;
const bringFull = {};   // thread key -> { date, messages } from /api/thread/full

const bringThread = (key) => [...S.threads, ...S.recent].find((t) => t.key === key);
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
  if (x && bringFull[x.key]?.date !== x.date) fullMessages(x).catch(() => { bringFull[x.key] = { date: x.date, messages: [], error: true }; }).finally(renderBringPop);
  renderBringPop();
}

// One row per recent conversation: click it (or drag it) to add its newest
// message; Earlier opens the conversation, one row per message.
function bringList(t) {
  const seen = new Set();
  const list = [...S.threads, ...S.recent].filter((x) => !seen.has(x.key) && seen.add(x.key))
    .filter((x) => x.space === t.space || t.space === 'personal').slice(0, 8);
  if (!list.length) return '<p class="bring-none">No recent messages for this project.</p>';
  return `<div class="bring">${list.map((x) => {
    const open = bringOpen === x.key, c = bringFull[x.key];
    const head = `<div class="bring-item${open ? ' open' : ''}" draggable="true" data-bring="${esc(x.key)}">
      <button class="bring-add" type="button" data-bring-add="${esc(x.key)}" title="Add to your message"><span class="bi-who">${esc(x.who)}</span><span class="bi-when">${when(x.date)}</span><span class="bi-s">${esc(x.snippet || x.subject || '')}</span></button>
      <button class="bring-more" type="button" data-bring-more="${esc(x.key)}" aria-expanded="${open}">${open ? 'Close' : 'Earlier'}</button></div>`;
    if (!open) return head;
    const msgs = c && c.date === x.date ? c.messages : null;
    const body = !msgs ? `<p class="bring-none">Getting messages…</p>`
      : !msgs.length ? `<p class="bring-none">${c.error ? 'Could not get the messages.' : 'No messages found.'}</p>`
      : msgs.map((m, i) => ({ m, i })).reverse().slice(0, 12).map(({ m, i }) => `<button class="bring-msg" type="button" draggable="true" data-bring="${esc(x.key)}|${i}" data-bring-add="${esc(x.key)}|${i}" title="Add to your message"><span class="bi-who">${esc(m.from)}</span><span class="bi-when">${when(m.date)}</span><span class="bi-s">${esc(m.text)}</span></button>`).join('');
    return head + `<div class="bring-msgs">${body}</div>`;
  }).join('')}</div>`;
}

// The list opens over the message bar, from the button beside the paperclip:
// messages go where the message is written.
let bringShown = false;
function renderBringPop() {
  const el = $('bring-pop'), t = termByKey(currentTerm);
  if (!el) return;
  $('q-bring')?.setAttribute('aria-expanded', String(bringShown && !!t));
  if (!bringShown || !t) { el.hidden = true; el.dataset.html = ''; return; }
  const html = `<div class="bring-head"><b>Bring in a message</b><span>Click one to add it to your message, or drag it in.</span><button class="btn btn--ghost btn--sm" type="button" data-bring-close>Close</button></div>${bringList(t)}`;
  el.hidden = false;
  if (el.dataset.html !== html) { const top = el.scrollTop; el.innerHTML = html; el.dataset.html = html; el.scrollTop = top; }
}
document.addEventListener('click', (e) => {
  if (e.target.closest('#q-bring')) { bringShown = !bringShown; renderBringPop(); return; }
  if (e.target.closest('[data-bring-close]')) { bringShown = false; renderBringPop(); $('q-text')?.focus(); return; }
  if (bringShown && e.target.isConnected && !e.target.closest('#bring-pop')) { bringShown = false; renderBringPop(); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && bringShown) { bringShown = false; renderBringPop(); $('q-text')?.focus(); } });
