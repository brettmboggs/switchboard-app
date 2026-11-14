// What Jarvis can do in Switchboard: its tools (for the local model) and the
// quick commands it understands without any model ("go to builds", "what
// needs me", "remind me tomorrow at 9 to call the bank"). Every tool goes
// through Switchboard's own API on this computer, so it does exactly what the
// page would, with the same checks. Things only the page can do (show a page,
// open a session) come back as actions for the page to carry out.
import { remember, forget, recall, card } from './jarvismemory.js';
import { findActions, describe, runAction } from './jarvisapi.js';
import { parseEventLine } from './eventline.js';
import { parseEdit } from './eventedit.js';
import { parseWhen } from './capture.js';

const PAGE_WORDS = {
  deck: 'deck', home: 'deck', dashboard: 'deck', now: 'now', 'needs you': 'now', sessions: 'sessions', session: 'sessions', terminal: 'sessions', terminals: 'sessions',
  builds: 'builds', build: 'builds', actions: 'builds', ci: 'builds', checks: 'checks', 'browser checks': 'checks', tests: 'checks',
  calendar: 'calendar', schedule: 'calendar', inbox: 'inbox', mail: 'inbox', email: 'inbox', messages: 'inbox',
  money: 'money', flips: 'flips', flip: 'flips', deals: 'flips', 'flip log': 'fliplog', 'my flips': 'fliplog', finances: 'money', bills: 'money', invoices: 'money', notes: 'notes', notebook: 'notes', unsorted: 'unsorted', settings: 'settings', monitor: 'monitor', system: 'monitor',
  usage: 'usage', 'ai plans': 'usage', 'ai plan': 'usage', 'plan limits': 'usage', limits: 'usage', 'claude usage': 'usage',
  network: 'network', 'network test': 'network', 'speed test': 'network', speedtest: 'network', internet: 'network', 'internet speed': 'network'
};
export const PAGES = [...new Set(Object.values(PAGE_WORDS))];

const STATE = { running: 'working', waiting: 'needs you', finished: 'done, your turn', idle: 'ready', starting: 'starting' };
const ago = (t) => { const m = Math.round((Date.now() - t) / 60e3); return m < 1 ? 'just now' : m < 60 ? `${m} minutes ago` : m < 1440 ? `${Math.round(m / 60)} hours ago` : `${Math.round(m / 1440)} days ago`; };
const label = (t) => (!t.named && t.title) || t.name;
const sessionsOf = (s) => (s.terms || []).map((t) => ({ key: t.key || t.id, id: t.id, name: label(t), folder: t.name, state: t.state, agent: t.agentName, repo: t.ci?.fullName || null }));

// The local API, called as the page calls it.
export function makeApi(port) {
  return async (path, body) => {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Switchboard': '1' }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `Switchboard answered ${r.status}.`);
    return data;
  };
}

// One session from what was said: its name, folder or repo, loosely.
export function findSession(list, want) {
  const w = String(want || '').toLowerCase().replace(/\b(the|session|one)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  if (!w) return null;
  const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return list.find((t) => norm(t.name) === w || norm(t.folder) === w)
    || list.find((t) => norm(t.name).includes(w) || norm(t.folder).includes(w) || norm(t.repo).includes(w))
    || list.find((t) => w.split(' ').every((p) => norm(t.name + ' ' + t.folder).includes(p))) || null;
}

// What needs you, said aloud: short, the important things first.
export function overview(s) {
  const out = [];
  const ses = sessionsOf(s).filter((t) => t.state === 'waiting' || t.state === 'finished');
  const asks = ses.filter((t) => t.state === 'waiting'), done = ses.filter((t) => t.state === 'finished');
  if (asks.length) out.push(`${asks.length === 1 ? asks[0].name + ' needs you' : asks.length + ' sessions need you: ' + asks.map((t) => t.name).join(', ')}.`);
  if (done.length) out.push(`${done.length === 1 ? done[0].name + ' finished and it is your turn' : done.length + ' sessions finished: ' + done.map((t) => t.name).join(', ')}.`);
  const busy = sessionsOf(s).filter((t) => t.state === 'running').length;
  if (busy) out.push(`${busy} ${busy === 1 ? 'session is' : 'sessions are'} working.`);
  const failed = (s.actions || []).filter((a) => a.runs[0]?.state === 'failure' && Date.now() - a.runs[0].updatedAt < 86400e3);
  if (failed.length) out.push(`The build failed in ${failed.map((a) => a.name).join(', ')}.`);
  const running = (s.actions || []).reduce((n, a) => n + a.runs.filter((r) => r.state === 'running' || r.state === 'queued').length, 0);
  if (running) out.push(`${running} ${running === 1 ? 'build is' : 'builds are'} running.`);
  if (s.reviews?.length) out.push(`${s.reviews.length} pull ${s.reviews.length === 1 ? 'request waits' : 'requests wait'} for your review.`);
  const due = (s.items || []).filter((i) => (i.kind === 'todo' || i.kind === 'reminder') && i.due_at && i.due_at <= Date.now());
  if (due.length) out.push(`Due now: ${due.slice(0, 3).map((i) => i.text).join('; ')}${due.length > 3 ? `, and ${due.length - 3} more` : ''}.`);
  const mail = (s.threads || []).length;
  if (mail) out.push(`${mail} ${mail === 1 ? 'conversation waits' : 'conversations wait'} on a reply.`);
  return out.length ? out.join(' ') : 'Nothing needs you right now. All clear.';
}

// ---- the tools, for the local model
export const TOOLS = [
  { name: 'show_page', description: 'Show a page of Switchboard on screen.', parameters: { type: 'object', properties: { page: { type: 'string', enum: PAGES } }, required: ['page'] } },
  { name: 'whats_up', description: 'What needs the user right now: sessions waiting or finished, failed or running builds, reviews, things due, mail waiting. Use for any "status", "what\'s going on", "anything for me" question.', parameters: { type: 'object', properties: {} } },
  { name: 'list_sessions', description: 'The agent sessions open in Switchboard, with what each is doing.', parameters: { type: 'object', properties: {} } },
  { name: 'open_session', description: 'Open one agent session on screen, by its name, folder or project.', parameters: { type: 'object', properties: { session: { type: 'string' } }, required: ['session'] } },
  { name: 'read_session', description: 'What one session last said, to tell the user.', parameters: { type: 'object', properties: { session: { type: 'string' } }, required: ['session'] } },
  { name: 'send_to_session', description: 'Send a message to an agent session (it goes in when the session is free). Use when the user wants a session to do something.', parameters: { type: 'object', properties: { session: { type: 'string' }, message: { type: 'string' } }, required: ['session', 'message'] } },
  { name: 'start_session', description: 'Start a new Claude Code session in one of the user\'s code folders (by folder name), with a first message saying what to do. Use for real work: coding, fixing, research, writing.', parameters: { type: 'object', properties: { folder: { type: 'string' }, message: { type: 'string' } }, required: ['folder', 'message'] } },
  { name: 'add', description: 'Add to the user\'s board. line is one line in Switchboard\'s capture words: "remind fri 9am call the bank", "todo send the proposal by thu", "add eggs to shopping", "paid Acme 1500", "note the gate code is 4411". End with @project to file it in a project.', parameters: { type: 'object', properties: { line: { type: 'string' } }, required: ['line'] } },
  { name: 'builds', description: 'Recent GitHub builds, for one project or all.', parameters: { type: 'object', properties: { project: { type: 'string' } } } },
  { name: 'remember', description: 'Note a lasting fact about the user to remember from now on (a person, a preference, a standing arrangement). Not for reminders or to-dos: use add for those.', parameters: { type: 'object', properties: { fact: { type: 'string' } }, required: ['fact'] } },
  { name: 'forget', description: 'Remove a note about the user, by what it is about.', parameters: { type: 'object', properties: { what: { type: 'string' } }, required: ['what'] } },
  { name: 'recall', description: 'Search what the user said to you before (the last 90 days), when they ask about an earlier conversation.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'read_all', description: 'Read out the whole of what a session last said, after read_session gave only its start.', parameters: { type: 'object', properties: {} } },
  { name: 'add_event', description: 'Put an event on the user\'s calendar. line is one plain line with what and when: "lunch with Sam fri noon", "dentist tue 3-4pm", "flight to Denver 12/3 6:15am for 3 hours", "oil change tomorrow" (no time: all day). Add "to the family calendar" to pick a calendar.', parameters: { type: 'object', properties: { line: { type: 'string' } }, required: ['line'] } },
  { name: 'edit_event', description: 'Change an event on the user\'s calendar, in one plain line: "move lunch with Sam to 1pm", "reschedule dentist to thu 2-3pm", "rename the dentist event to cleaning", "cancel lunch with Sam friday". A cancel asks the user first; when they say yes, call again with confirmed true.', parameters: { type: 'object', properties: { line: { type: 'string' }, confirmed: { type: 'boolean' } }, required: ['line'] } },
  { name: 'calendar', description: 'What is on the user\'s calendar: today, tomorrow, a weekday, a date like 11/20, or "week" for the next seven days.', parameters: { type: 'object', properties: { when: { type: 'string' } } } },
  { name: 'email_opens', description: 'Mail tracking: whether an email the user sent was opened or clicked. who: a name or address to ask about, or empty for the latest emails.', parameters: { type: 'object', properties: { who: { type: 'string' } } } },
  { name: 'network_test', description: 'Test how fast the internet is (download, upload, latency, bufferbloat; about 25 s, shown on screen and spoken when done), or with when "last" tell the last result.', parameters: { type: 'object', properties: { when: { type: 'string', enum: ['now', 'last'] } } } },
  { name: 'flip_check', description: 'Is this a good buy to resell? Looks up what it sells for on eBay and says the profit after fees at that price and the most to pay or bid. Opens the answer on Flips.', parameters: { type: 'object', properties: { what: { type: 'string', description: 'brand and model, like RTX 3070 Founders Edition' }, price: { type: 'number', description: 'price or current bid in dollars' }, site: { type: 'string', enum: ['ebay', 'shopgoodwill', 'propertyroom', 'auction', 'store', 'cash'] } }, required: ['what'] } },
  { name: 'models', description: 'AI models on this computer: Switchboard\'s own (the one you think with, also Local AI sessions\') and any LM Studio holds. List what is loaded (do list), load Switchboard\'s model now (do load), or unload them all to free the graphics card and memory (do unload). Unloading is easily undone: the model loads again on the next question.', parameters: { type: 'object', properties: { do: { type: 'string', enum: ['list', 'load', 'unload'] } }, required: ['do'] } },
  { name: 'computer_load', description: 'What is using this computer right now: memory, processor and graphics card, the biggest apps and whether each is safe to end, and anything big sitting idle.', parameters: { type: 'object', properties: { by: { type: 'string', enum: ['memory', 'processor'] } } } },
  { name: 'end_app', description: 'Close a running program, found by a word for it (comfyui, vite, chrome). Asks the user first; when they say yes, call again with confirmed true. force true makes one that would not close stop.', parameters: { type: 'object', properties: { what: { type: 'string' }, confirmed: { type: 'boolean' }, force: { type: 'boolean' } }, required: ['what'] } },
  { name: 'book', description: 'The book being read (Inbox, Reading): open it where it was left (do open), read it aloud from there (do read), stop reading aloud (do stop), say where the user is (do where), or bookmark the page on screen (do bookmark).', parameters: { type: 'object', properties: { do: { type: 'string', enum: ['open', 'read', 'stop', 'where', 'bookmark'] } }, required: ['do'] } },
  { name: 'find_action', description: 'Find how to do anything else in Switchboard (mail, calendar, money, notes, projects, files, settings, connections, checks, routines, tasks, sharing, updates and more). Describe what you want in a few words; it lists matching actions with their ids and inputs. Then use do_action.', parameters: { type: 'object', properties: { what: { type: 'string' } }, required: ['what'] } },
  { name: 'do_action', description: 'Run one action found with find_action, by its id, with its inputs in args. Actions marked delete wait for the user to say yes: ask, then call again with confirmed true. Actions marked send are never run: the user sends things themselves. For a big answer such as board.state, set only to the part you need (calendars, items, threads, terms, actions, money).', parameters: { type: 'object', properties: { id: { type: 'string' }, args: { type: 'object' }, confirmed: { type: 'boolean' }, only: { type: 'string' } }, required: ['id'] } }
];

// A session's words as they are said aloud: code, links and file paths become
// a word for what they are, and only the first two sentences are read; the rest
// waits for "read it all".
export function speakable(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' (some code) ').replace(/`([^`]{1,40})`/g, '$1').replace(/`[^`]*`/g, ' (some code) ')
    .replace(/https?:\/\/\S+?(?=[.,;:!?)]?(\s|$))/g, 'a link').replace(/(?:~|\.{0,2})?(?:\/[\w.@-]+){2,}/g, (m) => m.split('/').pop())
    .replace(/[*_#>|]+/g, ' ').replace(/\s+/g, ' ').trim();
}
export function firstSentences(text, n = 2) {
  const parts = String(text).match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) || [];
  return parts.slice(0, n).join('').trim();
}
let pending = null;    // { line, at } a calendar delete waiting for the user's yes
let pendingEnd = null; // { what, force, at } a program to end, waiting for the user's yes
let lastRead = null;   // { name, text } the last session read out, for "read it all"

// ---- the System monitor (lib/procs.js): what is using the computer, and ending programs
const gbSay = (b) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(1)} GB` : `${Math.round(b / 1048576)} MB`);
const LEVEL_SAY = { safe: 'safe to end', ask: 'ask first', keep: 'keep' };
const hours = (s) => (s >= 7200 ? `${Math.round(s / 3600)} hours` : s >= 3600 ? 'an hour' : `${Math.round(s / 60)} minutes`);
async function computerLoad(api, by) {
  const s = await api('/api/system');
  const g = s.gpus?.[0];
  const top = [...(s.apps || [])].sort((x, y) => y[by] - x[by]).slice(0, 3)
    .map((x) => `${x.name} ${by === 'mem' ? gbSay(x.mem) : `${Math.round(x.cpu)}%`}${x.level ? `, ${LEVEL_SAY[x.level]}` : ''}`);
  const out = [`Memory is ${Math.round(s.mem.pct)}% used, ${gbSay(s.mem.avail)} free. The processor is at ${Math.round(s.cpu.pct)}%.${g?.memUsed != null && g.memTotal ? ` The graphics card holds ${gbSay(g.memUsed)} of ${gbSay(g.memTotal)}.` : ''}`];
  if (top.length) out.push(`Biggest by ${by === 'mem' ? 'memory' : 'processor'}: ${top.join('; ')}.`);
  if (s.hog) out.push(`${s.hog.what} is holding ${gbSay(s.hog.mem)}, has been open ${hours(s.hog.age)} and is idle. Say "end ${s.hog.name === 'python' || s.hog.name === 'node' ? s.hog.what.split(' in ').pop() : s.hog.name}" to close it.`);
  return { say: out.join(' '), action: { window: 'monitor' } };
}
async function endApp(api, what, confirmed, force) {
  if (!what) return { say: 'Which program should I close?' };
  const { apps = [] } = await api('/api/system/find?q=' + encodeURIComponent(what));
  if (!apps.length) return { say: `Nothing running matches ${what}, or it is part of the system and stays.` };
  const mem = apps.reduce((n, x) => n + x.mem, 0), names = [...new Set(apps.map((x) => x.what))];
  const label = names.length === 1 ? names[0] : `${apps.length} programs (${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''})`;
  if (!confirmed) {
    pendingEnd = { what, force, at: Date.now() };
    const ask = apps.find((x) => x.level === 'ask');
    return { say: `${force ? 'Force end' : 'End'} ${label}, holding ${gbSay(mem)}?${ask ? ` ${ask.why}` : ''} Say yes to end it.` };
  }
  const r = await api('/api/system/end', { targets: apps.map((x) => ({ pid: x.pid, start: x.start })), sure: true, force });
  if (r.left?.length) return { say: `${label} has not closed after 5 seconds. Say "force end ${what}" to make it stop.` };
  return { say: r.ended?.length ? `Closed ${label}. That freed about ${gbSay(mem)}.` : `${label} had already closed.` };
}

// Runs one tool. Returns { say, action } (say: what to tell the model, action: for the page).
export async function runTool(api, name, a = {}) {
  if (name === 'show_page') {
    const page = PAGE_WORDS[String(a.page || '').toLowerCase()] || a.page;
    if (!PAGES.includes(page)) return { say: `There is no page called ${a.page}.` };
    return { say: `Showing ${page}.`, action: { go: page } };
  }
  if (name === 'find_action') {
    const hits = findActions(a.what);
    return { say: hits.length ? hits.map(describe).join('\n') : `Nothing in Switchboard matches "${a.what}". Try other words.` };
  }
  if (name === 'do_action') return runAction(api, String(a.id || ''), a.args || {}, a.confirmed === true, a.only || '');
  if (name === 'add_event') {
    const line = String(a.line || '').trim();
    const r = await api('/api/capture', { line: parseEventLine(line) ? line : 'event ' + line });
    const at = r.allDay ? new Date(r.start).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : new Date(r.start).toLocaleString('en-US', { weekday: 'long', hour: 'numeric', minute: '2-digit' });
    return { say: `Added ${r.text}, ${at}${r.allDay ? ', all day' : ''}, on ${r.calendarName}.` };
  }
  if (name === 'yes' && pendingEnd && Date.now() - pendingEnd.at < 120e3) { const p = pendingEnd; pendingEnd = null; return runTool(api, 'end_app', { what: p.what, force: p.force, confirmed: true }); }
  if (name === 'no' && pendingEnd) { pendingEnd = null; return { say: 'Okay, I left it running.' }; }
  if (name === 'computer_load') return computerLoad(api, a.by === 'processor' ? 'cpu' : 'mem');
  if (name === 'end_app') return endApp(api, String(a.what || '').trim(), a.confirmed === true, a.force === true);
  if (name === 'edit_event' || name === 'yes') {
    const line = name === 'yes' ? pending?.line : String(a.line || '').trim();
    if (name === 'yes' && (!pending || Date.now() - pending.at > 120e3)) { pending = null; return { say: 'Nothing is waiting for a yes.' }; }
    if (!parseEdit(line)) return { say: 'Say it like "move lunch with Sam to 1pm", "rename the dentist event to cleaning" or "cancel lunch with Sam".' };
    const r = await api('/api/capture', { line, confirmed: name === 'yes' || a.confirmed === true, editOnly: true });
    pending = r.kind === 'confirm' ? { line, at: Date.now() } : null;
    return { say: r.kind === 'confirm' ? `${r.question} Say yes to delete it.` : r.say };
  }
  if (name === 'no') { const had = !!pending; pending = null; return { say: had ? 'Okay, I left it.' : 'Okay.' }; }
  if (name === 'calendar') {
    const { from, to, label } = dayRange(a.when);
    const r = await api(`/api/calendar?from=${from}&to=${to}`);
    const list = (r.events || []).filter((e) => e.end > Date.now() || label !== 'today').sort((x, y) => x.start - y.start);
    if (!list.length) return { say: `Nothing on your calendar ${label}.` };
    const t = (e) => (e.allDay ? 'all day' : new Date(e.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(':00', ''));
    const day = (e) => (label === 'this week' ? new Date(e.start).toLocaleDateString('en-US', { weekday: 'long' }) + ' ' : '');
    return { say: `${label.charAt(0).toUpperCase() + label.slice(1)}: ${list.slice(0, 8).map((e) => `${day(e)}${t(e)}, ${e.title}`).join('; ')}${list.length > 8 ? `; and ${list.length - 8} more` : ''}.` };
  }
  if (name === 'email_opens') {
    const m = await api('/api/mailtrack');
    if (!m.connected) return { say: 'Mail tracking is not connected. Settings, Connections, Mail tracking.' };
    const w = String(a.who || '').toLowerCase().trim();
    const list = (m.emails || []).filter((e) => !w || e.to.some((r) => `${r.name || ''} ${r.email}`.toLowerCase().includes(w)));
    if (!list.length) return { say: w ? `No tracked email to ${a.who} lately.` : 'Nothing tracked yet.' };
    const one = (e) => { const n = (e.opens?.human || 0) + (e.opens?.likely || 0), to = e.to[0]?.name || e.to[0]?.email || 'them'; return e.status === 'clicked' ? `${to} opened "${e.subject}" and clicked a link, ${ago(e.lastActivityAt)}` : e.status === 'opened' ? `${to} opened "${e.subject}"${n > 1 ? ` ${n} times` : ''}, last ${ago(e.lastActivityAt)}` : `"${e.subject}" to ${to} has not been opened yet`; };
    return { say: list.slice(0, w ? 1 : 3).map(one).join('. ') + '.' };
  }
  if (name === 'book') {
    const what = String(a.do || 'open');
    if (what === 'stop') return { say: 'Stopped reading.', action: { readStop: true } };
    if (what === 'bookmark') return { say: 'Bookmarked.', action: { bookmark: true } };
    const { books = [] } = await api('/api/books');
    const b = books.filter((x) => x.shelf === 'reading').sort((x, y) => (y.readAt || y.addedAt) - (x.readAt || x.addedAt))[0] || books[0];
    if (!b) return { say: 'Your library is empty. Add a book on Inbox, Reading: search archive.org or paste a book\'s link.', action: { go: 'inbox', reading: true } };
    const where = `page ${b.label || b.page + 1} of ${b.title}, ${Math.round((b.page + 1) / b.pages * 100)} percent through`;
    if (what === 'where') return { say: `You are on ${where}.` };
    return { say: what === 'read' ? `Reading ${b.title} from page ${b.label || b.page + 1}.` : `Opening ${b.title} at page ${b.label || b.page + 1}.`, action: { book: b.id, read: what === 'read' } };
  }
  if (name === 'flip_check') {
    const r = await api('/api/flips/price', { what: a.what, price: a.price, site: a.site });
    const $ = (n) => `${Math.round(n)} dollars`;
    const action = { go: 'flips', flipCheck: { what: a.what, price: a.price, site: a.site } };
    if (!r.sells) return { say: r.note || `I could not find what ${a.what} sells for.`, action };
    const v = r.verdict;
    if (!v.cost) return { say: `${r.name} sells for about ${$(r.sells)} on eBay. To make it worth it, pay no more than ${$(v.max)}${r.site === 'ebay' ? '' : ` on ${r.siteLabel}`}.`, action };
    const word = v.light === 'good' ? 'Good deal' : v.light === 'thin' ? 'Thin' : 'Bad deal';
    return { say: `${word}. It sells for about ${$(r.sells)}; at ${$(r.price)} you would make about ${$(v.profit)} after fees and shipping. Pay no more than ${$(v.max)}.`, action };
  }
  if (name === 'models') {
    if (a.do === 'unload') {
      const r = await api('/api/localai/unload', { all: true });
      return { say: r.message || 'Unloaded.' };
    }
    if (a.do === 'load') {
      const r = await api('/api/ai/start', {});
      return { say: `${r.running?.name || 'The model'} is loaded and ready.` };
    }
    const [{ loaded = [] }, own] = await Promise.all([api('/api/localai/loaded', {}), api('/api/ai').catch(() => ({}))]);
    const mine = own.running ? [`${own.running.name} (Switchboard's${own.idleFor != null ? `, idle ${own.idleFor} minute${own.idleFor === 1 ? '' : 's'}` : ', answering'})`] : [];
    const all = [...mine, ...loaded.map((m) => `${m.name}${m.idleMin != null ? `, idle ${m.idleMin} minute${m.idleMin === 1 ? '' : 's'}` : `, ${m.status}`}`)];
    if (!all.length) return { say: 'No models are loaded. The graphics card is free.' };
    return { say: `${all.length} loaded: ${all.join('; ')}. Say "unload models" to free the card.` };
  }
  if (name === 'network_test') {
    if (a.when === 'last') {
      const r = await api('/api/speedtest?history=1');
      const last = r.test?.phase === 'done' ? r.test : (r.history || [])[0];
      if (!last) return { say: 'There is no network test yet. Say "test my internet" and I will run one.' };
      return { say: `${last.summary?.headline || `${Math.round(last.down?.mbps)} down, ${Math.round(last.up?.mbps)} up.`} That was ${ago(last.at)}.` };
    }
    try { await api('/api/speedtest', {}); } catch (e) { if (!/already running/i.test(e.message)) throw e; }
    return { say: 'Testing your internet now. It takes about 25 seconds, and I will tell you how it went.', action: { window: 'speedtest', announce: true } };
  }
  const s = await api('/api/state');
  if (name === 'whats_up') return { say: overview(s) };
  const list = sessionsOf(s);
  if (name === 'list_sessions') return { say: list.length ? list.map((t) => `${t.name} (${t.agent}): ${STATE[t.state] || t.state}`).join('. ') + '.' : 'No sessions are open.' };
  if (['open_session', 'read_session', 'send_to_session'].includes(name)) {
    const t = findSession(list, a.session);
    if (!t) return { say: `No open session matches "${a.session}". Open ones: ${list.map((x) => x.name).join(', ') || 'none'}.` };
    if (name === 'open_session') return { say: `Opened ${t.name}.`, action: { open: t.key } };
    if (name === 'send_to_session') {
      await api(`/api/terms/${encodeURIComponent(t.id)}/queue`, { text: String(a.message || ''), source: 'Jarvis' });
      return { say: `Sent to ${t.name}${t.state === 'running' ? '; it goes in when it is free' : ''}.` };
    }
    const chat = await api(`/api/terms/${encodeURIComponent(t.id)}/chat`).catch(() => ({ messages: [] }));
    const last = speakable((chat.messages || []).filter((m) => m.k === 'text').slice(-1)[0]?.t);
    const start = firstSentences(last);
    lastRead = last ? { name: t.name, text: last.slice(0, 2500) } : null;
    return { say: `${t.name} is ${STATE[t.state] || t.state}.${last ? ' It last said: ' + start + (start.length < last.length - 10 ? ' There is more; say "read it all" for the rest.' : '') : ''}` };
  }
  if (name === 'remember') return { say: remember(a.fact).say };
  if (name === 'forget') return { say: forget(a.what).say };
  if (name === 'what_i_know') { const c = card(); return { say: c ? 'Here is what I have noted: ' + c.split('\n').join('. ').replace(/\.\./g, '.') : 'Nothing yet. Say "remember that…" and I will note it.' }; }
  if (name === 'recall') {
    const hits = recall(a.query);
    return { say: hits.length ? hits.map((h) => `${new Date(h.at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}, ${h.role === 'user' ? 'they said' : 'you said'}: ${h.text}`).join('\n') : 'Nothing about that in what was said before.' };
  }
  if (name === 'read_all') return { say: lastRead ? `${lastRead.name} said: ${lastRead.text}` : 'Nothing to read yet. Ask what a session said first.' };
  if (name === 'start_session') {
    const folders = await api('/api/folders');
    const want = String(a.folder || '').toLowerCase();
    const f = folders.find((x) => x.name.toLowerCase() === want && x.kind !== 'copy') || folders.find((x) => x.name.toLowerCase().includes(want) && x.kind !== 'copy');
    if (!f) return { say: `No code folder called ${a.folder}.` };
    const r = await api('/api/terms', { cwd: f.path, agent: 'claude', text: a.message, source: 'Jarvis' });
    return { say: `Started a Claude session in ${f.name}; it starts on that as soon as it is ready.`, action: { open: r.id } };
  }
  if (name === 'add') {
    const r = await api('/api/capture', { line: String(a.line || '') });
    const when = r.due_at ? ', ' + new Date(r.due_at).toLocaleString('en-US', { weekday: 'long', hour: 'numeric', minute: '2-digit' }) : '';
    return { say: `Added ${r.kind === 'list' ? 'to ' + r.text : 'a ' + (r.kind === 'todo' ? 'to-do' : r.kind)}${when}.` };
  }
  if (name === 'builds') {
    const want = String(a.project || '').toLowerCase();
    const repos = (s.actions || []).filter((r) => !want || r.name.toLowerCase().includes(want) || r.fullName.toLowerCase().includes(want));
    if (!repos.length) return { say: 'No recent builds there.' };
    return { say: repos.slice(0, 4).map((r) => { const x = r.runs[0]; return `${r.name}: ${x.state === 'success' ? 'passed' : x.state === 'failure' ? 'failed' : x.state}, ${ago(x.updatedAt)}`; }).join('. ') + '.' };
  }
  return { say: `I don't have a tool called ${name}.` };
}

// A spoken day as a stretch of time: today (the rest of it), tomorrow, a weekday,
// a date, or the week ahead.
export function dayRange(when, now = new Date()) {
  const w = String(when || 'today').toLowerCase().trim();
  const sod = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
  if (/week/.test(w)) return { from: sod(now), to: sod(now) + 7 * 86400e3, label: 'this week' };
  if (!w || w === 'today' || w === 'now') return { from: sod(now), to: sod(now) + 86400e3, label: 'today' };
  const p = parseWhen(w, now);
  if (!p) return { from: sod(now), to: sod(now) + 86400e3, label: 'today' };
  const d = sod(p.at);
  const label = d === sod(now) + 86400e3 ? 'tomorrow' : 'on ' + new Date(d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  return { from: d, to: d + 86400e3, label };
}

// A page name heard slightly wrong ("beals" for builds): the closest one, if close enough.
function edits(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
export function pageWord(w) {
  w = String(w || '').toLowerCase().trim();
  if (PAGE_WORDS[w]) return PAGE_WORDS[w];
  if (w.length < 4) return null;
  let best = null, score = 99;
  for (const k of Object.keys(PAGE_WORDS)) { const e = edits(w, k); if (e < score && e <= (k.length >= 6 ? Math.floor(k.length / 2) : 1)) { best = PAGE_WORDS[k]; score = e; } }
  return best;
}

// ---- quick commands: the common things, instantly, with no model at all.
// Returns the tool to run, or null when it needs the model.
export function quick(text) {
  const t = String(text || '').trim().replace(/[.!?]+$/, '');
  // Spoken words come back with punctuation ("Go to Bill's!"): match on the plain words.
  const low = t.toLowerCase().replace(/['’]s\b/g, 's').replace(/[^a-z0-9@:$ ]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^(hey |ok |okay )?jarvis\s*/, '').replace(/^(please|can you|could you)\s+/, '');
  let m;
  if (/^(go )?(back|home)$|^(go )?back to the deck$|^close( this| that)?$/.test(low)) return ['show_page', { page: 'deck' }];
  if ((m = low.match(/^(?:go to|open|show(?: me)?|take me to|switch to|pull up)\s+(?:the\s+|my\s+)?([a-z ]+?)(?:\s+(?:page|tab|panel|screen|module|section))?$/)) && pageWord(m[1])) return ['show_page', { page: pageWord(m[1]) }];
  if (/^(what(s|'s| is) up|status|what needs me|anything (new|for me)|what(s|'s| is) (going on|happening)|catch me up|brief me|what did i miss)$/.test(low)) return ['whats_up', {}];
  if (/^(list|show|what are) (my |the )?sessions$|^what(s|'s| is) running$/.test(low)) return ['list_sessions', {}];
  if ((m = low.match(/^(?:open|go to|switch to|show)\s+(?:the\s+)?(.+?)\s+session$/))) return ['open_session', { session: m[1] }];
  if ((m = low.match(/^what did (?:the\s+)?(.+?)(?:\s+session)? (?:say|write|answer)$/))) return ['read_session', { session: m[1] }];
  if ((m = t.match(/^(?:hey |ok |okay )?(?:jarvis,?\s*)?(?:please\s+)?remember(?: that)?\s+(.{3,})$/i)) && !/^me\b/i.test(m[1])) return ['remember', { fact: m[1] }];
  if ((m = t.match(/^(?:hey |ok |okay )?(?:jarvis,?\s*)?forget(?: about| that)?\s+(.{3,})$/i))) return ['forget', { what: m[1] }];
  if (/^what do you (know|remember) about me$|^what have you (noted|remembered)$/.test(low)) return ['what_i_know', {}];
  if ((m = low.match(/^(?:what(?:s| is)? (?:on )?(?:my |the )?(?:calendar|schedule|agenda)|what do i have(?: on)?|what(?:s| is) (?:on |happening )?|whats on|am i (?:free|busy))\s*(?:for |on )?(today|tonight|tomorrow|this week|next week|the week|(?:sun|mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?)(?:day)?|\d{1,2}[ /]\d{1,2})?(?: on my calendar)?$/)) && /calendar|schedule|agenda|have|free|busy|on (today|tomorrow)|tomorrow|today|week/.test(low) && !/^what(?:s| is)? (?:up|going on|happening)$/.test(low)) return ['calendar', { when: (m[1] || 'today').replace(/^(\d{1,2}) (\d{1,2})$/, '$1/$2') }];
  if ((m = low.match(/^(?:did|has) (.+?) (?:open|read|see|opened|seen)(?: (?:my|the|it|that))?(?: (?:email|mail|message|it))?(?: yet)?$/))) return ['email_opens', { who: m[1].replace(/^(?:the|my)\s+/, '') }];
  if (/^(who (opened|read)|any (opens|one open)|tracking|mail tracking|who has opened)( my (emails?|mail))?( today| lately)?$/.test(low)) return ['email_opens', {}];
  if (/^(yes|yeah|yep|yup|sure|do it|go ahead|confirm|yes please|yes delete it)$/.test(low)) return ['yes', {}];
  if (/^(no|nope|never mind|nevermind|dont|do not|leave it|keep it)$/.test(low)) return ['no', {}];
  { const ed = parseEdit(t); if (ed?.sure) return ['edit_event', { line: t.replace(/^(hey |ok |okay )?jarvis,?\s*/i, '').replace(/^(please|can you|could you)\s+/i, '') }]; }
  { const ev = parseEventLine(t.replace(/^(hey |ok |okay )?jarvis,?\s*/i, '').replace(/^(please|can you|could you)\s+/i, '')); if (ev && !ev.error) return ['add_event', { line: t.replace(/^(hey |ok |okay )?jarvis,?\s*/i, '').replace(/^(please|can you|could you)\s+/i, '') }]; }
  if (/^(what was|how was|show me|tell me)( my| the)? (last )?(speed|network|internet) test( result)?$|^how fast was (my |the )?(internet|connection|wifi|wi fi)$/.test(low)) return ['network_test', { when: 'last' }];
  if (/^((run|do|start)( a| the| my)? )?(speed|network|internet) test$|^test (my |the )?(internet|network|connection|speed|wifi|wi fi)( speed)?$|^how fast is (my |the |this )?(internet|connection|wifi|wi fi|network)( right now)?$|^check (my |the )?(internet|connection|network)( speed)?$/.test(low)) return ['network_test', { when: 'now' }];
  if ((m = low.match(/^(?:is (?:an? |the )?|would (?:an? |the )?)?(.+?) (?:for|at) \$? ?(\d+(?:\.\d+)?)(?: dollars| bucks)? (?:be )?(?:a )?(?:good (?:deal|buy|flip)|worth (?:it|buying|flipping)|a deal)$/)) || (m = low.match(/^(?:price check|flip check|check (?:the )?price(?: of| on)?) (.+?)(?: (?:for|at) \$? ?(\d+(?:\.\d+)?))?$/))) return ['flip_check', { what: m[1], ...(m[2] ? { price: Number(m[2]) } : {}) }];
  if (/^(unload|offload|free up|clear)( all)?( the| my)? (local )?(ai )?(models?|gpu|graphics card|vram)$|^free (up )?(the |my )?(gpu|graphics card|vram)$/.test(low)) return ['models', { do: 'unload' }];
  if (/^(load|start|wake( up)?|warm up)( up)?( the| my)? (local )?(ai |main )?(model|qwen|brain|engine)( up)?$/.test(low)) return ['models', { do: 'load' }];
  if (/^(what|which) models? (are |is )?loaded$|^(whats|what is) (on|using) (the |my )?(gpu|graphics card)$/.test(low)) return ['models', { do: 'list' }];
  if (/^(what(s| is) (using|eating|hogging|taking up) (all )?(my |the )?(memory|ram|computer|pc|processor|cpu)|why is (my |the )?(computer|pc) (so )?slow|whats slowing (down )?(my |the )?(computer|pc))$/.test(low)) return ['computer_load', { by: /processor|cpu/.test(low) ? 'processor' : 'memory' }];
  if ((m = low.match(/^(force )?(?:end|quit|kill|force quit|close down|shut down) (?:the |my )?([a-z0-9][a-z0-9 .:-]{1,30}?)(?: app| program| process| server)?$/)) && !/^(it|that|this|the session|session|call|reading|tracking)$/.test(m[2])) return ['end_app', { what: m[2], force: !!m[1] }];
  if (/^((continue|resume) (reading|my book)|open my book|(go )?back to my book|where was i reading)$/.test(low)) return ['book', { do: 'open' }];
  if (/^(read (to me|aloud|my book( to me| aloud)?|me my book|the book( to me| aloud)?)|read me (some|a chapter)|start reading( aloud)?)$/.test(low)) return ['book', { do: 'read' }];
  if (/^(stop|pause) reading( aloud)?$/.test(low)) return ['book', { do: 'stop' }];
  if (/^(what page am i on|where am i in my book|where did i leave off|what am i reading|how far (am i|through my book))$/.test(low)) return ['book', { do: 'where' }];
  if (/^bookmark (this|the) page$/.test(low)) return ['book', { do: 'bookmark' }];
  if (/^(read (it|that|them|me it) all|read (me )?(the rest|all of it|the whole thing)|keep reading|go on)$/.test(low)) return ['read_all', {}];
  if (/^(remind|todo |to do |task |add .+ to |paid |invoice|bill |log |note )/.test(low)) return ['add', { line: t.replace(/^(hey |ok |okay )?jarvis,?\s*/i, '') }];
  return null;
}
