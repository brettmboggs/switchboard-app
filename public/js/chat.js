// The Chat view on Sessions: how a Claude session opens. Its own transcript
// as a clean conversation (the user, the agent, its tool calls folded to one line
// each), the message bar as the one place to type, and the agent's questions
// (permissions, choices) as buttons, read off its screen (lib/agentmenu.js).
// "Chat | Terminal" on the session's bar is kept per session; Settings, General,
// "Sessions open in" picks what they start as (Chat unless changed), and the
// first chat asks once whether to keep it.
// The server reads the transcript by byte offset and sends only what is new
// (lib/routes/sessionview.js); this file appends only what is new, keeps about
// 150 messages on screen with "Show earlier", and follows the bottom until
// the user scrolls up. Agent text is drawn with DOM nodes, never as HTML.
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.

const CHAT_PAGE = 150;            // messages drawn at a time
const CHAT_DOM_MAX = 450;         // past this many on screen, the oldest are taken off (Show earlier puts them back)
const CHAT_KEEP = 3000;           // messages kept in memory per session
const chatModes = store.get('chatModes', {});   // session key -> 'chat' | 'term'
let cv = null;                    // the open chat: { key, id, file, start, end, items, first, tools, ids, ... }

// Agents besides Claude whose conversation Switchboard can read (lib/chatview.js).
const CHAT_AGENTS = new Set(['localai', 'lmstudio', 'codex']);
// Why a session cannot show as a chat (null when it can).
function chatBlocked(t) {
  if (!t) return 'No session.';
  // A session started as some other command can still be Claude (an agent
  // starting its own workers, say): once Claude reports itself it gets a chat too.
  if (t.agent !== 'claude' && !t.claude_id && !CHAT_AGENTS.has(t.agent)) return `Chat view reads the conversation an agent keeps. ${t.agentName} keeps none Switchboard can read yet, so it shows its terminal.`;
  return null;
}
function chatOn(key) {
  const t = termByKey(key);
  return !!(t && !chatBlocked(t) && (chatModes[key] || defaultView()) === 'chat');
}
const defaultView = () => (S?.prefs?.sessionView === 'term' ? 'term' : 'chat');
// A new default from Settings or the first-time note: every session follows it.
function useSessionView(v) {
  for (const k of Object.keys(chatModes)) delete chatModes[k];
  store.set('chatModes', chatModes);
  store.set('viewAsked', true);
  if (S) S.prefs = { ...S.prefs, sessionView: v };
}
// A session that can be a chat but is showing its terminal: the terminal is
// then the one place to type, so the message bar steps aside.
const termOnly = (key) => { const t = termByKey(key); return !!(t && !chatBlocked(t) && !chatOn(key)); };
// "Chat | Terminal" on the session's bar.
function chatToggle(t) {
  const why = chatBlocked(t), on = chatOn(t.key);
  return `<div class="tb-seg" role="group" aria-label="View"><button type="button" class="tb-segb" data-cview="chat" aria-pressed="${on}" ${why ? `aria-disabled="true" title="${esc(why)}"` : 'title="Read the session as a conversation"'}>Chat</button><button type="button" class="tb-segb" data-cview="term" aria-pressed="${!on}" title="The agent's own terminal">Terminal</button></div>`;
}
function setChatMode(key, mode) {
  chatModes[key] = mode; store.set('chatModes', chatModes);
  render();
  if (mode === 'chat') $('q-text')?.focus();
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-cview]');
  if (b) {
    if (b.getAttribute('aria-disabled') === 'true') { toast(b.title); return; }
    setChatMode(currentTerm, b.dataset.cview); return;
  }
  if (e.target.closest('[data-chat-answer]')) { setChatMode(currentTerm, 'term'); return; }
  const pv = e.target.closest('[data-view-pick]');
  if (pv) {
    const v = pv.dataset.viewPick;
    useSessionView(v);
    api('/api/settings', { prefs: { sessionView: v } }).catch(() => {});
    $('chat-first')?.remove();
    if (v === 'term') toast('Sessions open in the terminal now. Change it any time in Settings, General.');
    render(); return;
  }
  const pick = e.target.closest('[data-menu-pick]');
  if (pick) {
    const i = Number(pick.dataset.menuPick);
    // "Type something": the answer is written in the message bar, then sent as the choice.
    if (TYPE_OWN.test(cv?.menu?.options?.[i]?.label || '')) { cv.typeOwn = i; renderChatLive(); $('q-text').placeholder = 'Type your answer, Enter sends it'; $('q-text').focus(); return; }
    answerMenu(i); return;
  }
  if (e.target.closest('[data-chat-earlier]')) { chatEarlier(); return; }
  if (e.target.closest('#chat-jump')) { chatToBottom(true); return; }
  const cp = e.target.closest('[data-chat-copy]');
  if (cp) {
    const code = cp.closest('.cm-code')?.querySelector('code')?.textContent || '';
    navigator.clipboard.writeText(code).then(() => { cp.textContent = 'Copied'; setTimeout(() => { cp.textContent = 'Copy'; }, 1200); }, () => toast('Could not copy.'));
  }
});

// ---------- the view itself
function chatHost() {
  let host = $('chat-host');
  if (host) return host;
  host = document.createElement('div');
  host.id = 'chat-host'; host.className = 'chat-host'; host.hidden = true;
  host.innerHTML = `<div class="chat-scroll" id="chat-scroll"><div class="chat-col">
      ${store.get('viewAsked', false) ? '' : `<div class="chat-first" id="chat-first" role="note"><p><b>Sessions open as a chat now.</b> Prefer Claude's own terminal? Pick one; you can change it any time in Settings, General, or with Chat | Terminal on a session.</p><div class="cf-btns"><button type="button" class="btn btn--primary btn--sm" data-view-pick="chat">Keep chat</button><button type="button" class="btn btn--sm" data-view-pick="term">Use the terminal</button></div></div>`}
      <button class="btn btn--sm chat-earlier" type="button" data-chat-earlier hidden>Show earlier</button>
      <div class="chat-list" id="chat-list" aria-label="Conversation"></div>
      <div class="chat-live" id="chat-live" aria-live="polite"></div></div></div>
    <button class="btn btn--sm chat-jump" id="chat-jump" type="button" hidden>Jump to latest <span aria-hidden="true">↓</span></button>`;
  $('term-host').after(host);
  const sc = host.querySelector('#chat-scroll');
  sc.addEventListener('scroll', () => {
    if (!cv) return;
    const near = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 48;
    if (near) { cv.stick = true; cv.auto = false; $('chat-jump').hidden = true; }
    else if (!cv.auto) cv.stick = false;
  }, { passive: true });
  // the user reaching for the wheel or the keys always wins over following the bottom.
  sc.addEventListener('wheel', (e) => { if (cv && e.deltaY < 0) { cv.auto = false; cv.stick = false; } }, { passive: true });
  return host;
}
function chatFont() {
  const host = $('chat-host');
  if (host) host.style.setProperty('--chat-k', String((Number(S?.prefs?.termSize) || 13.5) / 13.5));
}

function openChat(key) {
  const host = chatHost();
  host.hidden = false;
  chatFont();
  const t = termByKey(key);
  if (cv?.key === key) {
    renderChatLive();
    if (Date.now() - cv.lastFetch > 2000) fetchChat();   // in case a file event was missed
    return;
  }
  clearInterval(cv?.menuTimer);
  cv = { key, id: t.id, file: null, start: 0, end: 0, items: [], first: 0, tools: new Map(), ids: new Set(), stick: true, auto: false, busy: false, again: false, lastFetch: 0, why: null, menu: null, menuTimer: null };
  cv.menuTimer = setInterval(watchMenu, 1500);
  watchMenu();
  $('chat-list').textContent = '';
  $('chat-jump').hidden = true;
  host.querySelector('[data-chat-earlier]').hidden = true;
  renderChatLive();
  fetchChat();
  if (!window.chatStream && typeof es !== 'undefined' && es) {
    window.chatStream = true;
    es.addEventListener('chat', (e) => { if (cv && e.data === cv.id) fetchChat(); });
  }
  setTimeout(() => { if (document.activeElement === document.body) $('q-text')?.focus(); }, 30);
}
function closeChat() {
  const host = $('chat-host');
  if (host) host.hidden = true;
  if (!cv) return;
  clearInterval(cv.menuTimer);
  cv = null;
  $('chat-list').textContent = '';
  $('chat-live').textContent = '';
}

async function fetchChat() {
  const c = cv;
  if (!c) return;
  if (c.busy) { c.again = true; return; }
  c.busy = true; c.lastFetch = Date.now();
  try {
    const q = c.file ? `?file=${encodeURIComponent(c.file)}&from=${c.end}` : '';
    const r = await api(termPath(termByKey(c.key) || { id: c.id }, 'chat') + q);
    if (cv !== c) return;
    if (!r.file) { c.why = r.why; renderChatLive(); return; }
    c.why = null;
    if (r.reset || r.file !== c.file) {
      c.file = r.file; c.start = r.start; c.end = r.end;
      c.items = []; c.tools = new Map(); c.ids = new Set();
      $('chat-list').textContent = '';
      chatTake(r.messages);
      c.first = Math.max(0, c.items.length - CHAT_PAGE);
      $('chat-list').append(chatNodes(c.items.slice(c.first)));
      chatEarlierButton();
      renderChatLive();
      chatToBottom(false);
    } else {
      c.end = r.end;
      const before = c.items.length;
      chatTake(r.messages);
      const fresh = c.items.slice(before);
      if (fresh.length) {
        $('chat-list').append(chatNodes(fresh));
        chatTrim();
      }
      renderChatLive();
      if (fresh.length || r.messages.length) { if (c.stick) chatToBottom(true); else if (fresh.length) $('chat-jump').hidden = false; }
    }
  } catch { /* the next event or refresh tries again */ }
  finally { c.busy = false; if (c.again && cv === c) { c.again = false; fetchChat(); } }
}

// Take messages into memory: tool results join their tool call; everything
// else becomes an item. Returns nothing; items are appended to cv.items.
function chatTake(messages, into) {
  const c = cv, list = into || c.items;
  for (const m of messages) {
    if (m.k === 'result') {
      let tool = m.id === '@shell' ? [...c.tools.values()].reverse().find((x) => x.name === 'Shell' && !x.res) : c.tools.get(m.id);
      if (!tool) continue;
      tool.res = m;
      if (tool.el) chatToolState(tool);
      continue;
    }
    if (c.ids.has(m.id)) continue;
    c.ids.add(m.id);
    if (m.k === 'tool') c.tools.set(m.id, m);
    list.push(m);
  }
  if (!into && c.items.length > CHAT_KEEP) {
    const gone = c.items.splice(0, c.items.length - CHAT_KEEP);
    for (const m of gone) { m.el?.remove(); c.ids.delete(m.id); if (m.k === 'tool') c.tools.delete(m.id); }
    c.first = Math.max(0, c.first - gone.length);
    c.start = 0;   // what came before is no longer kept: the terminal has it
  }
}

// Too many on screen while following the bottom: take the oldest off.
function chatTrim() {
  const c = cv;
  if (!c.stick || c.items.length - c.first <= CHAT_DOM_MAX) return;
  const upto = c.items.length - CHAT_PAGE;
  for (let i = c.first; i < upto; i++) { c.items[i].el?.remove(); c.items[i].el = null; }
  c.first = upto;
  chatEarlierButton();
}
function chatEarlierButton() {
  const b = document.querySelector('[data-chat-earlier]');
  if (b && cv) b.hidden = !(cv.first > 0 || cv.start > 0);
}

// "Show earlier": the next page from memory, or from the file before what we have.
async function chatEarlier() {
  const c = cv;
  if (!c) return;
  const sc = $('chat-scroll'), list = $('chat-list');
  const keepPos = (fn) => { const h = sc.scrollHeight; fn(); sc.scrollTop += sc.scrollHeight - h; };
  if (c.first > 0) {
    const from = Math.max(0, c.first - CHAT_PAGE);
    keepPos(() => list.prepend(chatNodes(c.items.slice(from, c.first))));
    c.first = from;
    chatEarlierButton();
    return;
  }
  if (!(c.start > 0)) return;
  try {
    const r = await api(termPath(termByKey(c.key) || { id: c.id }, 'chat') + `?file=${encodeURIComponent(c.file)}&before=${c.start}`);
    if (cv !== c || r.file !== c.file) return;
    const older = [];
    chatTake(r.messages, older);
    c.items = older.concat(c.items);
    c.start = r.start;
    keepPos(() => list.prepend(chatNodes(older)));
    chatEarlierButton();
  } catch (err) { toast(err.message, { kind: 'error' }); }
}

function chatToBottom(smooth) {
  const sc = $('chat-scroll');
  if (!sc || !cv) return;
  cv.stick = true;
  $('chat-jump').hidden = true;
  const go = () => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (smooth && !reduce) { cv.auto = true; sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' }); setTimeout(() => { if (cv) cv.auto = false; }, 700); }
    else sc.scrollTop = sc.scrollHeight;
  };
  requestAnimationFrame(go);
}

// ---------- the agent's questions, as buttons
// While the agent works, waits or starts, look at its screen every 1.5 s for a
// question (cheap: one tmux capture). The server types the answer only if the
// same question is still on screen.
async function watchMenu() {
  const c = cv, t = termByKey(c?.key);
  if (!c || !t || c.menuBusy) return;
  // A session on another computer has no file event here: look for new messages every few seconds.
  if (t.remote && Date.now() - c.lastFetch > 2500) fetchChat();
  if (!['running', 'waiting', 'starting'].includes(t.state) && !c.menu) return;
  c.menuBusy = true;
  try {
    const r = await api(termPath(t, 'menu'));
    if (cv !== c) return;
    if ((r.menu?.sig || null) !== (c.menu?.sig || null)) { c.menu = r.menu; renderChatLive(); renderTermCompose(); }
  } catch { /* the next look tries again */ }
  finally { c.menuBusy = false; }
}
const TYPE_OWN = /^Type something\b/i;
async function answerMenu(index, text) {
  const c = cv;
  if (!c?.menu) return;
  const sig = c.menu.sig;
  c.typeOwn = null; $('q-text').placeholder = 'Message the agent, or drop a file, picture or conversation here';
  document.querySelectorAll('[data-menu-pick]').forEach((b) => { b.disabled = true; });
  try {
    const r = await api(termPath(termByKey(c.key) || { id: c.id }, 'menu'), { sig, index, ...(text ? { text } : {}) });
    if (cv !== c) return;
    c.menu = r.menu || null;
    renderChatLive(); renderTermCompose();
    load();
  } catch (err) {
    toast(err.message, { kind: 'error' });
    if (cv === c) { c.menu = null; renderChatLive(); watchMenu(); }
  }
}
// Writing a message while the agent asks permission means "no, do this
// instead": answer No first, then the message goes straight in.
function menuNoIndex() {
  const opts = cv?.menu?.options || [];
  const i = opts.findIndex((o) => /^No\b/i.test(o.label));
  return i;
}

// What the agent is doing now, from its newest tool call that has no result yet.
const TOOL_VERB = { Bash: 'Running', Shell: 'Running', Read: 'Reading', Write: 'Writing', Edit: 'Editing', MultiEdit: 'Editing', NotebookEdit: 'Editing', Grep: 'Searching', Glob: 'Looking for files', WebFetch: 'Reading a web page', WebSearch: 'Searching the web', Task: 'Working with a helper', Agent: 'Working with a helper', TodoWrite: 'Planning' };
// The same, said after the fact, for the line each finished call leaves.
const TOOL_DONE = { Bash: 'Ran a command', Shell: 'Ran a command', Read: 'Read a file', Write: 'Wrote a file', Edit: 'Edited a file', MultiEdit: 'Edited a file', NotebookEdit: 'Edited a notebook', Grep: 'Searched', Glob: 'Looked for files', WebFetch: 'Read a web page', WebSearch: 'Searched the web', Task: 'Asked a helper', Agent: 'Asked a helper', TodoWrite: 'Updated the to-do list', ToolSearch: 'Looked up its tools', Skill: 'Used a skill', ExitPlanMode: 'Shared a plan', AskUserQuestion: 'Asked you' };
// A tool's name in words: mcp__switchboard__switchboard_overview is "Switchboard: overview".
function toolWords(name, past) {
  const n = String(name || '');
  const mcp = /^mcp__(.+?)__(.+)$/.exec(n);
  if (mcp) {
    const server = mcp[1].replace(/^(claude_ai|plugin_[^_]+)_/, '').replace(/[_-]+/g, ' ').trim();
    const what = mcp[2].replace(new RegExp('^' + mcp[1].replace(/[^a-z0-9]/gi, '.') + '_', 'i'), '').replace(new RegExp('^' + server.replace(/[^a-z0-9]/gi, '.') + '_', 'i'), '').replace(/[_-]+/g, ' ').trim();
    const who = server.charAt(0).toUpperCase() + server.slice(1);
    return `${past ? 'Used' : 'Using'} ${who}${what ? `: ${what}` : ''}`;
  }
  const map = past ? TOOL_DONE : TOOL_VERB;
  if (map[n]) return map[n];
  return `${past ? 'Used' : 'Using'} ${n.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase()}`;
}
function chatDoing() {
  const items = cv?.items || [];
  for (let i = items.length - 1; i >= 0 && i >= items.length - 30; i--) {
    const m = items[i];
    if (m.k === 'tool') return m.res ? null : { verb: toolWords(m.name), sum: m.sum || '' };
    if (m.k === 'text' || m.k === 'user') return null;
  }
  return null;
}

// The bottom of the conversation: the agent's question with its choices as
// buttons, a "needs you" card when the question could not be read, what it is
// doing while it works, or why there is nothing yet.
function renderChatLive() {
  const el = $('chat-live'), t = termByKey(cv?.key);
  if (!el || !t) return;
  let html = '';
  const q = cv.menu;
  if (q) {
    const no = menuNoIndex();
    html = `<div class="chat-ask" role="group" aria-label="${esc(t.agentName)} is asking">
      <div class="ca-head">${esc(t.agentName)} is asking${q.title ? ` · <span>${esc(q.title)}</span>` : ''}</div>
      ${q.tabs ? `<div class="ca-tabs">${q.tabs.map((tb) => `<span class="${tb.done ? 'done' : ''}">${tb.done ? '✓ ' : ''}${esc(tb.label)}</span>`).join('<span class="ca-sep">›</span>')}</div>` : ''}
      ${q.lines.map((l) => l.code ? `<pre class="ca-code">${esc(l.t)}</pre>` : `<p class="ca-line">${esc(l.t)}</p>`).join('')}
      ${q.question ? `<p class="ca-q">${esc(q.question)}</p>` : ''}
      <div class="ca-opts">${q.options.map((o, i) => `<button type="button" class="ca-opt${i === 0 ? ' first' : ''}${o.submit ? ' ca-submit' : ''}${o.checked ? ' checked' : ''}${cv.typeOwn === i ? ' typing' : ''}" data-menu-pick="${i}"${o.checked !== undefined ? ` aria-pressed="${o.checked}"` : ''}><span class="ca-n">${o.submit ? '→' : o.checked !== undefined && !TYPE_OWN.test(o.label) ? (o.checked ? '☑' : '☐') : (o.n ?? i + 1)}</span><span>${esc(o.label)}${o.hint ? `<small class="ca-hint">${esc(o.hint)}</small>` : ''}</span></button>`).join('')}</div>
      ${(q.notes || []).length ? `<p class="ca-notes">${q.notes.map(esc).join(' · ')}</p>` : ''}
      ${cv.typeOwn != null ? `<p class="ca-how">Type your answer in the message bar below; Enter sends it.</p>` : q.multi ? `<p class="ca-how">Tick every one that applies, then Submit.</p>` : no >= 0 ? `<p class="ca-how">Or write below what to do instead, and it answers No for you.</p>` : ''}
    </div>`;
  } else if (t.state === 'waiting') {
    html = `<div class="chat-wait"><div class="cw-head">Needs you</div><p class="cw-q">${esc(t.detail || `${t.agentName} is asking for a decision.`)}</p><p class="cw-how">This question could not be read here. Answer it in the terminal, then come back.</p><button class="btn btn--primary btn--sm" type="button" data-chat-answer>Open the terminal</button></div>`;
  } else if (cv.why) {
    html = `<p class="chat-empty">${esc({ starting: 'Waiting for Claude to start. The conversation shows here as soon as it does.', nofile: 'Nothing said yet. Write below and the conversation shows here.', unreadable: 'Could not read this conversation. The terminal still has everything.' }[cv.why] || 'Nothing to show yet.')}</p>`;
  } else if (t.state === 'running') {
    const d = chatDoing();
    html = `<div class="chat-working"><span class="cwk-dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="cwk-verb">${esc(d?.verb || 'Thinking')}</span>${d?.sum ? `<span class="cwk-sum">${esc(d.sum)}</span>` : ''}</div>`;
  }
  if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; if (html && cv.stick) chatToBottom(true); }
}

// ---------- drawing messages
function chatNodes(items) {
  const frag = document.createDocumentFragment();
  for (const m of items) { if (!m.el) m.el = chatNode(m); frag.append(m.el); }
  return frag;
}
const elt = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const chatTime = (at) => at ? new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';

function chatNode(m) {
  if (m.k === 'user') {
    const row = elt('div', 'cm cm-user');
    const b = elt('div', 'cm-bubble', m.t);
    if (m.images) b.append(elt('span', 'cm-img', m.images === 1 ? 'Image' : `${m.images} images`));
    b.title = chatTime(m.at);
    row.append(b);
    return row;
  }
  if (m.k === 'text') {
    const row = elt('div', 'cm cm-agent');
    row.append(chatMd(m.t));
    fileLinks(row);
    return row;
  }
  if (m.k === 'note') return elt('div', 'cm cm-note', m.t);
  if (m.files?.length) return sentFiles(m);
  // A tool call: one line, opened to show what went in and what came back.
  const d = elt('details', 'cm cm-tool');
  const s = elt('summary');
  const nm = elt('span', 'ct-name', toolWords(m.name, true));
  nm.title = m.name;
  s.append(elt('span', 'ct-mark'), nm, elt('span', 'ct-sum', m.sum || ''));
  d.append(s);
  d.chatItem = m;
  m.el = d;
  chatToolState(m);
  return d;
}
function chatToolState(m) {
  const d = m.el;
  d.classList.toggle('done', !!m.res && !m.res.err);
  d.classList.toggle('err', !!m.res?.err);
  if (d.open) chatToolBody(m, true);
}
// Built only when opened, so a long session costs one line per tool call.
document.addEventListener('toggle', (e) => {
  const d = e.target;
  if (d.classList?.contains('cm-tool') && d.open && d.chatItem) chatToolBody(d.chatItem);
}, true);
function chatToolBody(m, again) {
  const d = m.el;
  let body = d.querySelector('.ct-body');
  if (body && !again) return;
  if (!body) { body = elt('div', 'ct-body'); d.append(body); }
  body.textContent = '';
  if (m.input && m.input !== '{}') {
    body.append(elt('div', 'ct-label', 'Details'));
    const main = toolMain(m.input);
    if (main) body.append(elt('p', 'ct-main', main));
    const raw = elt('details', 'ct-raw'); raw.append(elt('summary', null, 'Everything it sent'), elt('pre', 'ct-pre', m.input));
    body.append(raw);
  }
  if (m.res) body.append(elt('div', 'ct-label', m.res.err ? 'Error' : 'Result'), elt('pre', 'ct-pre' + (m.res.err ? ' err' : ''), m.res.t || '(nothing)'));
  else body.append(elt('div', 'ct-label', 'No result yet'));
}

// The one field that says what a tool call was about, in words.
function toolMain(input) {
  let o; try { o = JSON.parse(input); } catch { return ''; }
  if (!o || typeof o !== 'object') return '';
  const pick = [['command', 'Command'], ['file_path', 'File'], ['notebook_path', 'File'], ['path', 'Folder'], ['pattern', 'Looking for'], ['query', 'Looking for'], ['url', 'Page'], ['description', 'About'], ['prompt', 'Asked']];
  for (const [k, w] of pick) if (typeof o[k] === 'string' && o[k].trim()) return `${w}: ${o[k].trim().slice(0, 400)}`;
  return '';
}

// ---------- markdown, the safe little subset: paragraphs, headings, lists,
// quotes, code blocks, tables, inline code, bold, italics and links.
function chatMd(src) {
  const frag = document.createDocumentFragment();
  const lines = String(src).replace(/\r/g, '').split('\n');
  const isList = (l) => /^\s*([-*+]|\d+[.)])\s+/.test(l);
  const isTable = (i) => /^\s*\|.*\|\s*$/.test(lines[i]) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || '');
  const blockStart = (i) => /^\s*(`{3,}|~{3,})/.test(lines[i]) || /^#{1,6}\s/.test(lines[i]) || /^\s*>/.test(lines[i]) || isList(lines[i]) || isTable(i);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^\s*(`{3,}|~{3,})\s*([\w+#.-]*)/);
    if (fence) {
      const code = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) code.push(lines[i++]);
      i++;
      const box = elt('div', 'cm-code'), head = elt('div', 'cc-head');
      head.append(elt('span', 'cc-lang', fence[2] || 'code'));
      const copy = elt('button', 'cc-copy', 'Copy'); copy.type = 'button'; copy.dataset.chatCopy = '';
      head.append(copy);
      const pre = elt('pre'); pre.append(elt('code', null, code.join('\n')));
      box.append(head, pre);
      frag.append(box);
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { const el = elt(h[1].length <= 2 ? 'h3' : 'h4', 'cm-h'); chatInline(h[2], el); frag.append(el); i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { frag.append(elt('hr')); i++; continue; }
    if (/^\s*>/.test(line)) {
      const q = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
      const bq = elt('blockquote'); bq.append(chatMd(q.join('\n'))); frag.append(bq);
      continue;
    }
    if (isTable(i)) {
      const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      const wrap = elt('div', 'cm-table'), table = elt('table'), thead = elt('thead'), tr = elt('tr');
      for (const c of cells(lines[i])) { const th = elt('th'); chatInline(c, th); tr.append(th); }
      thead.append(tr); table.append(thead);
      i += 2;
      const tbody = elt('tbody');
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        const r = elt('tr');
        for (const c of cells(lines[i++])) { const td = elt('td'); chatInline(c, td); r.append(td); }
        tbody.append(r);
      }
      table.append(tbody); wrap.append(table); frag.append(wrap);
      continue;
    }
    if (isList(line)) {
      // Nested by indent: a stack of open lists.
      const stack = [];
      while (i < lines.length && (isList(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && stack.length))) {
        const l = lines[i++];
        const m = l.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
        if (!m) { const last = stack.at(-1)?.el.lastElementChild; if (last) { last.append(document.createElement('br')); chatInline(l.trim(), last); } continue; }
        const indent = m[1].replace(/\t/g, '  ').length, ordered = /\d/.test(m[2]);
        while (stack.length && indent < stack.at(-1).indent) stack.pop();
        if (!stack.length || indent > stack.at(-1).indent) {
          const list = elt(ordered ? 'ol' : 'ul');
          if (ordered && parseInt(m[2], 10) > 1) list.start = parseInt(m[2], 10);
          if (stack.length) (stack.at(-1).el.lastElementChild || stack.at(-1).el).append(list); else frag.append(list);
          stack.push({ indent, el: list });
        }
        const li = elt('li');
        const box = m[3].match(/^\[([ xX])\]\s+(.*)$/);
        if (box) { li.className = 'task' + (box[1] !== ' ' ? ' checked' : ''); chatInline(box[2], li); } else chatInline(m[3], li);
        stack.at(-1).el.append(li);
      }
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !(para.length && blockStart(i))) para.push(lines[i++]);
    const p = elt('p');
    para.forEach((l, n) => { if (n) p.append(document.createElement('br')); chatInline(l, p); });
    frag.append(p);
  }
  return frag;
}
const CHAT_INLINE = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)|\*\*([^*\n]+?)\*\*|__([^_\n]+?)__|(?<![\w*])\*([^*\s][^*\n]*?)\*(?![\w*])|(?<![\w])_([^_\s][^_\n]*?)_(?![\w])|\[([^\]\n]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])|(?<![\w/:.~-])((?:~|\.{1,2})?\/?(?:[\w@+-][\w.@+-]*\/)+[\w@+-][\w.@+-]*\.[A-Za-z][A-Za-z0-9]{0,7}(?::\d+)?)(?![\w/])/g;
function chatInline(text, parent) {
  let last = 0;
  for (const m of String(text).matchAll(CHAT_INLINE)) {
    if (m.index > last) parent.append(document.createTextNode(text.slice(last, m.index)));
    last = m.index + m[0].length;
    if (m[1]) { const t = m[2].replace(/^ (.*) $/, '$1'); parent.append(looksLikePath(t) ? pathEl('code', 'cm-ic', t, t) : elt('code', 'cm-ic', t)); }
    else if (m[3] || m[4]) { const b = elt('strong'); chatInline(m[3] || m[4], b); parent.append(b); }
    else if (m[5] || m[6]) { const em = elt('em'); chatInline(m[5] || m[6], em); parent.append(em); }
    else if (m[7]) parent.append(chatLink(m[8], m[7]));
    else if (m[9]) parent.append(chatLink(m[9], m[9]));
    else if (m[10]) parent.append(pathEl('span', null, m[10], m[10]));
  }
  if (last < text.length) parent.append(document.createTextNode(text.slice(last)));
}
function chatLink(href, label) {
  if (!/^https?:\/\//i.test(href)) return looksLikePath(href) ? pathEl('span', null, label, href) : elt('span', null, label);
  const a = elt('a', null, label);
  a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
  return a;
}

// Drop a conversation, text or an image on the chat, like on the terminal.
document.addEventListener('dragover', (e) => { if (e.target.closest?.('#chat-host')) { e.preventDefault(); $('q-prompt')?.classList.add('drop'); } });
document.addEventListener('dragleave', (e) => { if (e.target.closest?.('#chat-host') && !e.relatedTarget?.closest?.('#chat-host')) $('q-prompt')?.classList.remove('drop'); });
document.addEventListener('drop', (e) => {
  if (!e.target.closest?.('#chat-host')) return;
  e.preventDefault(); $('q-prompt')?.classList.remove('drop');
  const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'));
  if (files.length) { files.forEach(addImage); return; }
  const key = e.dataTransfer.getData('application/x-switchboard-thread');
  addToComposer(key ? bringText(key) : e.dataTransfer.getData('text/plain'));
});
