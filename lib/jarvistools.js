// What Jarvis can do in Switchboard: its tools (for the local model) and the
// quick commands it understands without any model ("go to builds", "what
// needs me", "remind me tomorrow at 9 to call the bank"). Every tool goes
// through Switchboard's own API on this computer, so it does exactly what the
// page would, with the same checks. Things only the page can do (show a page,
// open a session) come back as actions for the page to carry out.
import { remember, forget, recall, card } from './jarvismemory.js';

const PAGE_WORDS = {
  deck: 'deck', home: 'deck', dashboard: 'deck', now: 'now', 'needs you': 'now', sessions: 'sessions', session: 'sessions', terminal: 'sessions', terminals: 'sessions',
  builds: 'builds', build: 'builds', actions: 'builds', ci: 'builds', checks: 'checks', 'browser checks': 'checks', tests: 'checks',
  calendar: 'calendar', schedule: 'calendar', inbox: 'inbox', mail: 'inbox', email: 'inbox', messages: 'inbox',
  money: 'money', finances: 'money', bills: 'money', invoices: 'money', notes: 'notes', notebook: 'notes', unsorted: 'unsorted', settings: 'settings', monitor: 'monitor', system: 'monitor'
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
  { name: 'read_all', description: 'Read out the whole of what a session last said, after read_session gave only its start.', parameters: { type: 'object', properties: {} } }
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
let lastRead = null;   // { name, text } the last session read out, for "read it all"

// Runs one tool. Returns { say, action } (say: what to tell the model, action: for the page).
export async function runTool(api, name, a = {}) {
  if (name === 'show_page') {
    const page = PAGE_WORDS[String(a.page || '').toLowerCase()] || a.page;
    if (!PAGES.includes(page)) return { say: `There is no page called ${a.page}.` };
    return { say: `Showing ${page}.`, action: { go: page } };
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
  if (/^(what('s| is) up|status|what needs me|anything (new|for me)|what('s| is) (going on|happening)|catch me up|brief me|what did i miss)$/.test(low)) return ['whats_up', {}];
  if (/^(list|show|what are) (my |the )?sessions$|^what('s| is) running$/.test(low)) return ['list_sessions', {}];
  if ((m = low.match(/^(?:open|go to|switch to|show)\s+(?:the\s+)?(.+?)\s+session$/))) return ['open_session', { session: m[1] }];
  if ((m = low.match(/^what did (?:the\s+)?(.+?)(?:\s+session)? (?:say|write|answer)$/))) return ['read_session', { session: m[1] }];
  if ((m = t.match(/^(?:hey |ok |okay )?(?:jarvis,?\s*)?(?:please\s+)?remember(?: that)?\s+(.{3,})$/i)) && !/^me\b/i.test(m[1])) return ['remember', { fact: m[1] }];
  if ((m = t.match(/^(?:hey |ok |okay )?(?:jarvis,?\s*)?forget(?: about| that)?\s+(.{3,})$/i))) return ['forget', { what: m[1] }];
  if (/^what do you (know|remember) about me$|^what have you (noted|remembered)$/.test(low)) return ['what_i_know', {}];
  if (/^(read (it|that|them|me it) all|read (me )?(the rest|all of it|the whole thing)|keep reading|go on)$/.test(low)) return ['read_all', {}];
  if (/^(remind|todo |to do |task |add .+ to |paid |invoice|bill |log |note )/.test(low)) return ['add', { line: t.replace(/^(hey |ok |okay )?jarvis,?\s*/i, '') }];
  return null;
}
