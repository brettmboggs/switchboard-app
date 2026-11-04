// The Chat view on Sessions: a Claude session's own transcript as a clean
// conversation (Brett, the agent, its tool calls folded to one line each),
// with "Chat | Terminal" on the session's bar. Opt-in: Settings, General.
// The server reads the transcript by byte offset and sends only what is new
// (lib/routes/sessionview.js); this file appends only what is new, keeps about
// 150 messages on screen with "Show earlier", and follows the bottom until
// Brett scrolls up. Agent text is drawn with DOM nodes, never as HTML.
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.

const CHAT_PAGE = 150;            // messages drawn at a time
const CHAT_DOM_MAX = 450;         // past this many on screen, the oldest are taken off (Show earlier puts them back)
const CHAT_KEEP = 3000;           // messages kept in memory per session
const chatModes = store.get('chatModes', {});   // session key -> 'chat' | 'term'
let cv = null;                    // the open chat: { key, id, file, start, end, items, first, tools, ids, ... }

// Why a session cannot show as a chat (null when it can).
function chatBlocked(t) {
  if (!t) return 'No session.';
  if (t.remote) return `Chat view works for sessions on this computer for now. This one runs on ${t.deviceName}, so it shows its terminal.`;
  if (t.agent !== 'claude') return `Chat view reads Claude Code's transcript. ${t.agentName} shows its terminal for now.`;
  return null;
}
function chatOn(key) {
  const t = termByKey(key);
  return !!(t && S?.prefs?.chatView && !chatBlocked(t) && (chatModes[key] || 'chat') === 'chat');
}
// "Chat | Terminal" on the session's bar.
function chatToggle(t) {
  if (!S?.prefs?.chatView) return '';
  const why = chatBlocked(t), on = chatOn(t.key);
  return `<div class="tb-seg" role="group" aria-label="View"><button type="button" class="tb-segb" data-cview="chat" aria-pressed="${on}" ${why ? `aria-disabled="true" title="${esc(why)}"` : 'title="Read the session as a conversation"'}>Chat</button><button type="button" class="tb-segb" data-cview="term" aria-pressed="${!on}" title="The agent's own terminal">Terminal</button></div>`;
}
function setChatMode(key, mode) {
  chatModes[key] = mode; store.set('chatModes', chatModes);
  renderTermBar(); syncTerminal();
  if (mode === 'chat') $('q-text')?.focus();
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-cview]');
  if (b) {
    if (b.getAttribute('aria-disabled') === 'true') { toast(b.title); return; }
    setChatMode(currentTerm, b.dataset.cview); return;
  }
  if (e.target.closest('[data-chat-answer]')) { setChatMode(currentTerm, 'term'); return; }
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
      <button class="chat-earlier" type="button" data-chat-earlier hidden>Show earlier</button>
      <div class="chat-list" id="chat-list" role="log" aria-live="polite" aria-label="Conversation"></div>
      <div class="chat-live" id="chat-live"></div></div></div>
    <button class="chat-jump" id="chat-jump" type="button" hidden>Jump to latest <span aria-hidden="true">↓</span></button>`;
  $('term-host').after(host);
  const sc = host.querySelector('#chat-scroll');
  sc.addEventListener('scroll', () => {
    if (!cv) return;
    const near = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 48;
    if (near) { cv.stick = true; cv.auto = false; $('chat-jump').hidden = true; }
    else if (!cv.auto) cv.stick = false;
  }, { passive: true });
  // Brett reaching for the wheel or the keys always wins over following the bottom.
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
  cv = { key, id: t.id, file: null, start: 0, end: 0, items: [], first: 0, tools: new Map(), ids: new Set(), stick: true, auto: false, busy: false, again: false, lastFetch: 0, why: null };
  $('chat-list').textContent = '';
  $('chat-jump').hidden = true;
  host.querySelector('[data-chat-earlier]').hidden = true;
  renderChatLive();
  fetchChat();
  if (!window.chatStream && typeof es !== 'undefined') {
    window.chatStream = true;
    es.addEventListener('chat', (e) => { if (cv && e.data === cv.id) fetchChat(); });
  }
  setTimeout(() => { if (document.activeElement === document.body) $('q-text')?.focus(); }, 30);
}
function closeChat() {
  const host = $('chat-host');
  if (host) host.hidden = true;
  if (!cv) return;
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
    const r = await api(`/api/terms/${encodeURIComponent(c.id)}/chat${q}`);
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
    const r = await api(`/api/terms/${encodeURIComponent(c.id)}/chat?file=${encodeURIComponent(c.file)}&before=${c.start}`);
    if (cv !== c || r.file !== c.file) return;
    const older = [];
    chatTake(r.messages, older);
    c.items = older.concat(c.items);
    c.start = r.start;
    keepPos(() => list.prepend(chatNodes(older)));
    chatEarlierButton();
  } catch (err) { toast(err.message); }
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

// The bottom of the conversation: a card when the agent needs a decision in
// its own screen, a quiet "Working" while it works, or why there is nothing yet.
function renderChatLive() {
  const el = $('chat-live'), t = termByKey(cv?.key);
  if (!el || !t) return;
  let html = '';
  if (t.state === 'waiting') {
    html = `<div class="chat-wait"><div class="cw-head"><span class="cw-dot"></span>Needs you</div><p class="cw-q">${esc(t.detail || `${t.agentName} is asking for a decision.`)}</p><p class="cw-how">Permissions and questions are answered in the agent's own screen.</p><button class="cw-go" type="button" data-chat-answer>Answer in terminal</button></div>`;
  } else if (cv.why) {
    html = `<p class="chat-empty">${esc({ starting: 'Waiting for Claude to start. The conversation shows here as soon as it does.', nofile: 'Nothing said yet. Write below and the conversation shows here.', unreadable: 'Could not read this session\'s transcript. The terminal still has everything.' }[cv.why] || 'Nothing to show yet.')}</p>`;
  } else if (t.state === 'running') {
    html = `<div class="chat-working" aria-label="Working"><i></i><i></i><i></i></div>`;
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
    return row;
  }
  if (m.k === 'note') return elt('div', 'cm cm-note', m.t);
  // A tool call: one line, opened to show what went in and what came back.
  const d = elt('details', 'cm cm-tool');
  const s = elt('summary');
  s.append(elt('span', 'ct-mark'), elt('span', 'ct-name', m.name), elt('span', 'ct-sum', m.sum || ''));
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
  if (m.input && m.input !== '{}') { body.append(elt('div', 'ct-label', 'Input'), elt('pre', 'ct-pre', m.input)); }
  if (m.res) body.append(elt('div', 'ct-label', m.res.err ? 'Error' : 'Result'), elt('pre', 'ct-pre' + (m.res.err ? ' err' : ''), m.res.t || '(nothing)'));
  else body.append(elt('div', 'ct-label', 'No result yet'));
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
const CHAT_INLINE = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)|\*\*([^*\n]+?)\*\*|__([^_\n]+?)__|(?<![\w*])\*([^*\s][^*\n]*?)\*(?![\w*])|(?<![\w])_([^_\s][^_\n]*?)_(?![\w])|\[([^\]\n]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;
function chatInline(text, parent) {
  let last = 0;
  for (const m of String(text).matchAll(CHAT_INLINE)) {
    if (m.index > last) parent.append(document.createTextNode(text.slice(last, m.index)));
    last = m.index + m[0].length;
    if (m[1]) parent.append(elt('code', 'cm-ic', m[2].replace(/^ (.*) $/, '$1')));
    else if (m[3] || m[4]) { const b = elt('strong'); chatInline(m[3] || m[4], b); parent.append(b); }
    else if (m[5] || m[6]) { const em = elt('em'); chatInline(m[5] || m[6], em); parent.append(em); }
    else if (m[7]) parent.append(chatLink(m[8], m[7]));
    else if (m[9]) parent.append(chatLink(m[9], m[9]));
  }
  if (last < text.length) parent.append(document.createTextNode(text.slice(last)));
}
function chatLink(href, label) {
  if (!/^https?:\/\//i.test(href)) { const s = elt('span', null, label); return s; }
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
