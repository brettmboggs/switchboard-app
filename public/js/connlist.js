// Settings, Connections, kept short: "Your connections" shows only what you
// use (connected, or added and not finished yet); everything else waits under
// "Add a connection" as a tile with Add, next to what is coming. Add moves its
// card up, open and ready to sign in; Remove from list takes an unconnected one
// back down. Something connected always stays up top (its own Disconnect or
// Sign out takes it away). The list is a pref (prefs.connections), so it
// follows the account; until someone picks, it starts from the welcome's
// choices, or from only what is connected.
// One of the page's scripts in public/js, loaded in order by index.html.

const CONN_CATS = [['all', 'All'], ['messages', 'Messages'], ['calendars', 'Calendars'], ['money', 'Money'], ['coding', 'Coding'], ['automation', 'Automation']];
// Every card in the pane, by its data-conn key: what it is, and when it counts as connected.
const CONN_CATALOG = [
  { key: 'email', cat: 'messages', name: 'Email', what: 'Gmail, iCloud, Yahoo, Fastmail or work mail: people, not ads, with reply and archive.', on: (S) => S.status.gmail.length > 0 },
  { key: 'microsoft', cat: 'messages', name: 'Teams and Outlook', what: 'Work chats and mail; reply without opening Teams.', on: (S) => !!S.status.microsoft?.connected },
  { key: 'mailtrack', cat: 'messages', name: 'Mail tracking', what: 'Your own tracker: who opens and clicks what you send, and which senders track you.', on: (S) => !!S.mailtrack?.connected },
  { key: 'calendars', cat: 'calendars', name: 'Calendars', what: 'Google, Outlook, iCloud, school and team calendars on Now and Calendar.', on: (S) => (S.calendars || []).length > 0 },
  { key: 'granola', cat: 'calendars', name: 'Granola', what: 'Your meeting notes in Notes, in the right project, for you and your sessions.', on: (S) => !!S.granola?.connected },
  { key: 'bank-alerts', cat: 'money', name: 'Bank and card alerts', what: 'Charges, receipts and payments read from alert emails. No bank sign-in.', on: (S) => S.status.gmail.length > 0 },
  { key: 'github', cat: 'coding', name: 'GitHub', what: 'Builds as they run, and pull requests waiting on you.', on: (S) => S.status.github.ok === true },
  { key: 'claude', cat: 'coding', name: 'Claude Code', what: 'Run Claude sessions inside Switchboard and see which need you.', on: (S) => !!S.status.hooks },
  { key: 'codex', cat: 'coding', name: 'ChatGPT (Codex)', what: 'OpenAI\'s coding agent, signed in with your ChatGPT plan.', on: (S) => agentReady(S, 'codex') },
  { key: 'gemini', cat: 'coding', name: 'Gemini', what: 'Google\'s coding agent, signed in with your Google account.', on: (S) => agentReady(S, 'gemini') },
  { key: 'localai', cat: 'coding', name: 'Local AI models', what: 'Switchboard\'s own model, Ollama or LM Studio: private, free models that run on this computer.', on: (S) => (S.agents || []).some((a) => (a.id === 'engine' || a.id === 'localai' || a.id === 'lmstudio') && a.installed) },
  { key: 'tasks', cat: 'automation', name: 'Todoist', what: 'Tasks due today on Now; Done ticks them off in Todoist.', on: (S) => !!S.taskStatus?.todoist?.connected },
  { key: 'trello', cat: 'automation', name: 'Trello', what: 'Cards with a due date on Now when due; Done marks them complete.', on: (S) => !!S.taskStatus?.trello?.connected },
  { key: 'asana', cat: 'automation', name: 'Asana', what: 'Tasks assigned to you, due today, on Now; Done completes them.', on: (S) => !!S.taskStatus?.asana?.connected },
  { key: 'notion', cat: 'automation', name: 'Notion', what: 'Your Notion task database\'s due pages on Now; Done ticks them off.', on: (S) => !!S.taskStatus?.notion?.connected },
  { key: 'feeds', cat: 'automation', name: 'News and blogs', what: 'Sites and blogs you follow, quietly on Inbox, Reading.', on: (S) => (S.feedCount || 0) > 0 || (S.reading || []).length > 0 },
  { key: 'voice', cat: 'automation', name: 'Read-aloud voice', what: 'A natural voice on this computer that reads your books aloud, and can be Jarvis\'s voice.', on: (S) => !!S.voice?.installed },
  { key: 'webhooks', cat: 'automation', name: 'Links for other apps (webhooks)', what: 'IFTTT, Zapier, Home Assistant or a script puts things on your board.', on: (S) => (S.webhooks || 0) > 0 }
];
// Setup registry ids (public/setup.js) to the card they open.
const SETUP_CONN = { gmail: 'email', email: 'email', microsoft: 'microsoft', mailtrack: 'mailtrack', readaloud: 'voice', calendars: 'calendars', 'account-calendars': 'calendars', github: 'github', claude: 'claude', codex: 'codex', gemini: 'gemini', localai: 'localai', lmstudio: 'localai', tasks: 'tasks', granola: 'granola', trello: 'trello', asana: 'asana', notion: 'notion', feeds: 'feeds', webhooks: 'webhooks' };
let connCat = 'all';

const connOn = (c) => { try { return !!c.on(S); } catch { return false; } };
// What the person added. Before they ever choose: what the welcome's picks point at.
function connAdded() {
  if (Array.isArray(S.prefs?.connections)) return S.prefs.connections;
  const uses = S.prefs?.welcome?.uses || [];
  if (!uses.length) return [];
  return [...new Set(SETUP.filter((e) => e.kind === 'connect' && SETUP_CONN[e.id] && (e.uses === 'all' || e.uses.some((u) => uses.includes(u)))).map((e) => SETUP_CONN[e.id]))];
}
const connShown = (c) => connOn(c) || connAdded().includes(c.key);
async function connSave(list) {
  S.prefs = { ...S.prefs, connections: list };
  renderConnList();
  await api('/api/settings', { prefs: { connections: list } }).catch((err) => toast(err.message, { kind: 'error' }));
}
// Add a connection to the list: its card comes up top and is pointed at.
async function connAdd(key) {
  if (!connAdded().includes(key)) await connSave([...connAdded(), key]);
  const el = document.querySelector(`#pane-connections [data-conn="${key}"]`);
  if (el) flash(el);
}
// "Set up" from the welcome or What's new opens a card: make sure it is in the list first.
function connEnsureFor(setupId) {
  const key = SETUP_CONN[setupId];
  const c = key && CONN_CATALOG.find((x) => x.key === key);
  if (c && !connShown(c)) return connSave([...connAdded(), key]);
}

function renderConnList() {
  const pane = $('pane-connections'); if (!pane) return;
  for (const c of CONN_CATALOG) {
    const el = pane.querySelector(`[data-conn="${c.key}"]`); if (!el) continue;
    el.classList.toggle('conn-off', !connShown(c));
    el.querySelector(':scope > .conn-remove')?.remove();
    if (connShown(c) && !connOn(c)) el.insertAdjacentHTML('beforeend', `<button class="btn btn--ghost conn-remove" type="button" data-conn-remove="${c.key}">Remove from list</button>`);
  }
  const shop = $('conn-shop'); if (!shop) return;
  const tiles = CONN_CATALOG.filter((c) => !connShown(c)).map((c) => `<div class="conn-tile" data-cat-of="${c.cat}"><b>${esc(c.name)}</b><span class="acct-line">${esc(c.what)}</span><button class="btn btn--sm" type="button" data-conn-add="${c.key}">Add</button></div>`);
  const soon = CONN_NEXT.map((c) => `<div class="conn-tile conn-soon" data-cat-of="${esc(c.cat)}"><b>${esc(c.name)}</b><span class="acct-line">${esc(c.what)}</span><span class="conn-needs">Coming soon · ${esc(c.needs)}</span></div>`);
  $('conn-cats').innerHTML = CONN_CATS.map(([id, n]) => `<button class="chip" type="button" data-conn-cat="${id}" aria-pressed="${connCat === id}">${n}</button>`).join('');
  shop.innerHTML = [...tiles, ...soon].join('');
  $('conn-mine-empty').hidden = CONN_CATALOG.some(connShown);
  filterConnections();
  connWatch.takeRecords();   // our own changes are not a reason to run again
}
// The cards are redrawn by their own code (renderDev, the local AI card, ...)
// whenever their status changes; sort them again each time, at once.
const connWatch = new MutationObserver(() => renderConnList());
if ($('pane-connections')) connWatch.observe($('pane-connections'), { childList: true, subtree: true });

document.addEventListener('click', (e) => {
  const add = e.target.closest('[data-conn-add]');
  if (add) { connAdd(add.dataset.connAdd); return; }
  const rm = e.target.closest('[data-conn-remove]');
  if (rm) { const key = rm.dataset.connRemove; connSave(connAdded().filter((k) => k !== key)); toast('Moved down to Add a connection.'); return; }
  const cat = e.target.closest('[data-conn-cat]');
  if (cat) { connCat = cat.dataset.connCat; renderConnList(); }
});
