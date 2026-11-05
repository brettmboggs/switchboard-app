#!/usr/bin/env node
// Switchboard as an MCP server: the tools any coding agent (Claude Code, Codex,
// Gemini CLI, Cursor…) can use to see what needs the user, put things on the
// board, see sessions and GitHub Actions runs, set up and read browser checks,
// and queue a message into another session. `npm run setup` registers it with
// each agent that is installed.
//
// MCP over stdio: one JSON-RPC message per line on stdin and stdout; anything
// else goes to stderr. It talks only to Switchboard on this computer
// (127.0.0.1), with the same header the page uses. Mail, chats and money are
// left out on purpose: an agent never reads the user's inbox through this.
// No dependencies, so it starts in a few milliseconds.
import { execFileSync } from 'node:child_process';

const PORT = Number(process.env.SWITCHBOARD_PORT || 4747);
const BASE = `http://127.0.0.1:${PORT}`;
const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
let client = 'An agent';

async function sb(path, body) {
  let r;
  try {
    r = await fetch(BASE + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Switchboard': '1' }, body: JSON.stringify(body) });
  } catch { throw new Error(`Switchboard isn't running on this computer (nothing on 127.0.0.1:${PORT}). Start it from the apps menu, or npm start in its folder.`); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Switchboard answered ${r.status}.`);
  return data;
}

// The repo of the folder the agent works in, for "my repo's runs".
function cwdRepo() {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: process.cwd(), timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    const m = /github\.com[:/]+([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?\s*$/i.exec(url);
    return m ? `${m[1]}/${m[2]}` : null;
  } catch { return null; }
}

const ago = (t) => { const m = Math.round((Date.now() - t) / 60e3); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const STATE = { running: 'working', waiting: 'needs the user', finished: 'finished, the user\'s turn', idle: 'ready', starting: 'starting' };
const allSessions = (s) => [
  ...(s.terms || []).map((t) => ({ key: t.id, name: t.name, where: 'this computer', repo: t.ci?.fullName || null, branch: t.ci?.branch || null, state: t.state, agent: t.agentName, queued: t.queued?.length || 0, cwd: t.cwd })),
  ...(s.remoteTerms || []).map((t) => ({ key: `r:${t.device}:${t.id}`, name: t.name, where: t.deviceName, repo: null, branch: null, state: t.state, agent: t.agentName, queued: t.queued?.length || 0, cwd: t.cwd, device: t.device, id: t.id }))
];

const TOOLS = [
  {
    name: 'switchboard_overview',
    title: 'What needs the user',
    description: 'What needs the user right now on their Switchboard: agent sessions waiting on them, failed or running GitHub Actions builds, pull requests to review, and reminders or to-dos that are due. Read-only.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    async run() {
      const s = await sb('/api/state');
      const now = Date.now(), out = [];
      const ses = allSessions(s).filter((t) => t.state === 'waiting' || t.state === 'finished');
      if (ses.length) out.push('Sessions waiting on the user:', ...ses.map((t) => `- ${t.name} (${t.agent}, ${t.where}): ${STATE[t.state]}`));
      const runs = (s.actions || []).flatMap((a) => a.runs.slice(0, 6).filter((r) => r.state === 'running' || r.state === 'queued' || (r.state === 'failure' && now - r.updatedAt < 86400e3)).map((r) => ({ ...r, repo: a.fullName })));
      if (runs.length) out.push('GitHub Actions:', ...runs.map((r) => `- ${r.repo} · ${r.workflow} on ${r.branch}: ${r.state} (${ago(r.updatedAt)}) · ${r.title}`));
      if (s.reviews?.length) out.push('Pull requests waiting on the user\'s review:', ...s.reviews.map((p) => `- ${p.repo} #${p.number}: ${p.title} (by ${p.author})`));
      const due = (s.items || []).filter((i) => (i.kind === 'todo' || i.kind === 'reminder') && i.due_at && i.due_at <= now);
      if (due.length) out.push('Due now:', ...due.map((i) => `- ${i.kind}: ${i.text}`));
      return out.length ? out.join('\n') : 'Nothing needs the user right now.';
    }
  },
  {
    name: 'switchboard_add',
    title: 'Put something on the user\'s board',
    description: 'Put an item on the user\'s Switchboard. kind "needs" (default) shows at once as a Needs-you card with a desktop alert: use it when you are blocked on the user or something important happened, not for routine progress. "todo" and "reminder" can have a due time ("fri 9am", "in 2h", or an ISO date); "note" is just kept. project is a Switchboard project name (see switchboard_projects); left out, it goes to Personal.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'What it is, in one plain sentence.' },
        kind: { type: 'string', enum: ['needs', 'todo', 'reminder', 'note'] },
        project: { type: 'string' },
        due: { type: 'string', description: 'When, for todo and reminder: "tomorrow 9am", "in 30 min", an ISO date.' }
      },
      required: ['text'], additionalProperties: false
    },
    async run(a) {
      const r = await sb('/api/agent/item', { text: a.text, kind: a.kind || 'needs', project: a.project, due: a.due, from: client });
      return `On the board: ${r.kind === 'todo' && (a.kind || 'needs') === 'needs' ? 'needs you' : r.kind} in ${r.space}${r.due_at ? `, due ${new Date(r.due_at).toLocaleString()}` : ''}.`;
    }
  },
  {
    name: 'switchboard_projects',
    title: 'The user\'s projects',
    description: 'The projects on the user\'s Switchboard (for the project field of switchboard_add). Read-only.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    async run() { const s = await sb('/api/state'); return s.spaces.map((x) => `- ${x.name}${x.group ? ` (${x.group})` : ''}`).join('\n'); }
  },
  {
    name: 'switchboard_sessions',
    title: 'Agent sessions',
    description: 'Every agent session Switchboard runs, on this computer and the user\'s other computers: name, agent, state, repo and branch, queued messages. Read-only.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    async run() {
      const list = allSessions(await sb('/api/state'));
      return list.length ? list.map((t) => `- ${t.name} [${t.key}] · ${t.agent} · ${t.where} · ${STATE[t.state] || t.state}${t.repo ? ` · ${t.repo}${t.branch ? '@' + t.branch : ''}` : ''}${t.queued ? ` · ${t.queued} queued` : ''}${t.cwd ? ` · ${t.cwd}` : ''}`).join('\n') : 'No sessions are open.';
    }
  },
  {
    name: 'switchboard_send_to_session',
    title: 'Queue a message into another session',
    description: 'Queue a message into another agent session (by its name or [key] from switchboard_sessions). It is typed in when that session is free, labelled as coming from you. Use it to hand work to a session in another repo; the user sees it in that session\'s queue.',
    inputSchema: {
      type: 'object',
      properties: { session: { type: 'string', description: 'Session name or key.' }, text: { type: 'string' } },
      required: ['session', 'text'], additionalProperties: false
    },
    async run(a) {
      const list = allSessions(await sb('/api/state'));
      const want = String(a.session).trim();
      const hits = list.filter((t) => t.key === want || t.name === want);
      if (hits.length !== 1) throw new Error(hits.length ? `More than one session is called "${want}". Use its key: ${hits.map((t) => t.key).join(', ')}.` : `No session "${want}". Open ones: ${list.map((t) => t.name).join(', ') || 'none'}.`);
      const t = hits[0], source = `${client} (agent)`;
      if (t.device) await sb(`/api/remote/${t.device}/${encodeURIComponent(t.id)}/queue`, { text: a.text, source });
      else await sb(`/api/terms/${encodeURIComponent(t.key)}/queue`, { text: a.text, source });
      return `Queued into ${t.name}. It goes in when that session is free.`;
    }
  },
  {
    name: 'switchboard_actions',
    title: 'GitHub Actions runs',
    description: 'Recent GitHub Actions runs as Switchboard sees them live: state (running, queued, success, failure, cancelled), workflow, branch, jobs and the step that is on. repo is "owner/name"; left out, the repo of the folder you work in. Read-only.',
    inputSchema: { type: 'object', properties: { repo: { type: 'string' } }, additionalProperties: false },
    annotations: { readOnlyHint: true },
    async run(a) {
      const s = await sb('/api/state');
      const want = (a.repo || cwdRepo() || '').toLowerCase();
      const repos = (s.actions || []).filter((r) => !want || r.fullName.toLowerCase() === want || r.name.toLowerCase() === want);
      if (!repos.length) return want ? `No recent runs for ${want}. Switchboard watches repos pushed in the last 3 days and the repos of open sessions.` : 'No recent runs.';
      return repos.map((r) => [`${r.fullName}:`, ...r.runs.slice(0, 8).map((x) => `- ${x.state} · ${x.workflow} #${x.number} on ${x.branch} · ${x.title} · ${ago(x.updatedAt)}${(x.jobs || []).length ? ` · jobs: ${x.jobs.map((j) => `${j.name}=${j.state}${j.step ? ` (${j.step})` : ''}`).join(', ')}` : ''} · ${x.url}`)].join('\n')).join('\n\n');
    }
  },
  {
    name: 'switchboard_checks',
    title: 'Browser checks and their results',
    description: 'The user\'s browser checks (Sessions, Browser checks): pages that must load and show some text, and projects\' Playwright tests, run headless on a click or a schedule. For each: what it checks, how often, its newest run (passed, failed, running) with the summary and, for a failure, which tests failed and why. Read-only.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    async run() {
      const list = (await sb('/api/state')).checks || [];
      if (!list.length) return 'No browser checks yet. Add one with switchboard_add_check.';
      const EVERY = { 0: 'on a click', 60: 'every hour', 360: 'every 6 hours', 1440: 'every day' };
      return list.map((c) => {
        const r = c.runs.find((x) => x.state === 'running' || x.state === 'queued') || c.runs.find((x) => ['success', 'failure', 'cancelled'].includes(x.state));
        const what = c.kind === 'page' ? `page ${c.url}${c.expect ? ` must show "${c.expect}"` : ''}` : `tests in ${c.folder}: ${c.command}`;
        const si = c.signin ? ` · sign-in: ${{ ok: 'signed in (saved ' + ago(c.signin.savedAt) + ')', expired: 'needs sign-in (it ran out)', none: 'needs sign-in (not signed in yet)', starting: 'sign-in window opening', open: 'sign-in window open', saving: 'saving the sign-in' }[c.signin.state] || c.signin.state}` : '';
        const head = `- ${c.name} [${c.id}] · ${what} · ${EVERY[c.every] || ''}${si} · ${r ? `${r.state}${r.endedAt ? ' ' + ago(r.endedAt) : ''}${r.summary ? ': ' + r.summary : ''}` : 'not run yet'}`;
        const fails = r?.state === 'failure' ? (r.failures || []).slice(0, 5).map((f) => `    failed: ${f.title}${f.file ? ` (${f.file}${f.line ? ':' + f.line : ''})` : ''}${f.error ? ' · ' + String(f.error).split('\n')[0].slice(0, 200) : ''}`) : [];
        return [head, ...fails].join('\n');
      }).join('\n');
    }
  },
  {
    name: 'switchboard_add_check',
    title: 'Add a browser check',
    description: 'Set up a browser check for the user: kind "page" opens url in a headless browser and fails if it will not load or never shows the expect text; kind "tests" runs a project\'s own Playwright tests (folder is its full path; command defaults to "npx playwright test" and may only be the project\'s test runner: npx playwright test, npm test or npm run <script>). every is minutes between runs: 0 (only on a click, the default), 60, 360 or 1440. project is a Switchboard project name. It runs once right away unless run_now is false; a failure becomes a Needs-you card for the user. Read results with switchboard_checks. For a site that needs sign-in, a tests check can have signin_url (the sign-in page, https): only the person can sign in, in a window on their own computer (Sign in on the check); you never see or handle any password, and the check does not run until they have.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['page', 'tests'] }, signin_url: { type: 'string' },
        url: { type: 'string' }, expect: { type: 'string' },
        folder: { type: 'string' }, command: { type: 'string' },
        name: { type: 'string' }, project: { type: 'string' },
        every: { type: 'integer', enum: [0, 60, 360, 1440] },
        run_now: { type: 'boolean' }
      },
      required: ['kind'], additionalProperties: false
    },
    async run(a) {
      // A "tests" check runs its command in a shell on this computer. From an agent
      // only the project's own test runner may be set up; anything else is for the
      // person to add themselves in Sessions, Browser checks.
      if (a.kind === 'tests' && a.command && !/^(npx playwright test|npm test|npm run [\w:.-]+|pnpm (test|run [\w:.-]+)|yarn (test|run [\w:.-]+))( [\w./:=-]+)*$/.test(String(a.command).trim())) {
        throw new Error('From here a tests check can only run the project\'s test runner (npx playwright test, npm test, npm run <script>, with plain arguments). Ask the person to add any other command in Sessions, Browser checks.');
      }
      let space;
      if (a.project) {
        const want = String(a.project).toLowerCase();
        const hit = (await sb('/api/state')).spaces.find((x) => x.name.toLowerCase() === want || x.id === want);
        if (!hit) throw new Error(`No project called "${a.project}". See switchboard_projects.`);
        space = hit.id;
      }
      // agent: true tells the server this came from an agent, so it applies the same rule.
      const r = await sb('/api/checks', { kind: a.kind, url: a.url, expect: a.expect, folder: a.folder, command: a.command, name: a.name, space, every: a.every || 0, signin_url: a.signin_url, agent: true });
      const runs = a.run_now !== false && !a.signin_url;   // a signed-in check waits for the person to sign in
      if (runs) await sb('/api/checks/run', { id: r.id });
      if (a.signin_url) return `Added browser check [${r.id}]. It cannot run until the user presses Sign in on it (Sessions, Browser checks) and signs in themselves; tell them so.`;
      return `Added browser check [${r.id}]${runs ? ' and started a run' : ''}. The user sees it in Sessions, Browser checks; read the result with switchboard_checks.`;
    }
  }
];

// ---- JSON-RPC over stdio
const write = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
async function handle(m) {
  const { id, method, params = {} } = m;
  if (id === undefined) return;   // notifications (initialized, cancelled): nothing to answer
  try {
    if (method === 'initialize') {
      client = params.clientInfo?.name || client;
      const v = VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : VERSIONS[0];
      return write({ id, result: { protocolVersion: v, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'switchboard', title: 'Switchboard', version: '1.0.0' },
        instructions: 'The user\'s Switchboard: what needs them, their board, their agent sessions, live GitHub Actions and browser checks. Use switchboard_add with kind "needs" only when you truly need the user.' } });
    }
    if (method === 'ping') return write({ id, result: {} });
    if (method === 'tools/list') return write({ id, result: { tools: TOOLS.map(({ run, ...t }) => t) } });
    if (method === 'tools/call') {
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) return write({ id, error: { code: -32602, message: `Unknown tool: ${params.name}` } });
      try { return write({ id, result: { content: [{ type: 'text', text: await tool.run(params.arguments || {}) }] } }); }
      catch (e) { return write({ id, result: { content: [{ type: 'text', text: e.message }], isError: true } }); }
    }
    write({ id, error: { code: -32601, message: `Method not found: ${method}` } });
  } catch (e) { write({ id, error: { code: -32603, message: e.message } }); }
}

let buf = '';
const pending = new Set();
const run = (m) => { const p = handle(m).finally(() => pending.delete(p)); pending.add(p); };
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    let m; try { m = JSON.parse(line); } catch { write({ id: null, error: { code: -32700, message: 'Parse error' } }); continue; }
    if (Array.isArray(m)) m.forEach(run); else run(m);
  }
});
// The agent closed the connection: answer what is still in hand, then go.
process.stdin.on('end', () => Promise.allSettled([...pending]).then(() => process.exit(0)));
