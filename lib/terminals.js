// Claude sessions that Switchboard runs itself. Each one is the real `claude`
// program inside its own tmux session ("sb-<slug>"), so it keeps running when
// Switchboard restarts and can be opened from any terminal with
// `tmux attach -t sb-<slug>`. The page shows it through a pty attached to that
// tmux session; messages are typed in with tmux's paste buffer.
//
// The hook script passes SWITCHBOARD_TERM, so Claude's session id and its
// running / waiting / finished state tie back to the terminal here. That is
// what lets queued messages wait until the session is free.
import { ollamaModels, lmstudioModels, lmsPath, MODEL_NAME as LOCAL_MODEL } from './localai.js';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { OSC_TITLE, cleanTitle } from './termtitle.js';
import { join, basename, dirname } from 'node:path';
import pty from 'node-pty';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chmodSync } from 'node:fs';

// node-pty's prebuilt macOS helper ("spawn-helper") can lose its execute bit when
// npm unpacks it, and then every session fails with "posix_spawnp failed".
// Put the bit back on every start.
if (process.platform !== 'win32') {
  try {
    const root = dirname(createRequire(import.meta.url).resolve('node-pty/package.json'));
    for (const sub of ['prebuilds/darwin-arm64', 'prebuilds/darwin-x64', 'build/Release']) {
      const f = join(root, sub, 'spawn-helper');
      if (existsSync(f)) try { chmodSync(f, 0o755); } catch {}
    }
  } catch {}
}
import { hiddenKeys } from './hidden.js';
import { db, getSetting, DATA_DIR } from './db.js';
import { spaceFor } from './spaces.js';
import { termStatus } from './claude.js';

for (const sql of [
  `CREATE TABLE IF NOT EXISTS terms (
    id TEXT PRIMARY KEY, name TEXT, cwd TEXT, space TEXT,
    claude_id TEXT, created_at INTEGER, ended_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT, term_id TEXT, text TEXT, source TEXT,
    held INTEGER NOT NULL DEFAULT 1, created_at INTEGER, sent_at INTEGER
  )`,
  `ALTER TABLE terms ADD COLUMN agent TEXT`,
  `ALTER TABLE terms ADD COLUMN command TEXT`,
  `ALTER TABLE terms ADD COLUMN model TEXT`,     // what was asked for at start (claude --model, codex --model)
  `ALTER TABLE terms ADD COLUMN effort TEXT`,    // claude --effort
  `CREATE TABLE IF NOT EXISTS links (
    chat_key TEXT PRIMARY KEY, term_id TEXT, who TEXT, auto INTEGER NOT NULL DEFAULT 0, last_at INTEGER
  )`
]) { try { db.exec(sql); } catch {} }

// tmux matches the start of a name when there is no exact match, so "sb-x" could
// reach "sb-x-2". Every target says exactly which session it means ("=name").
const exact = (id) => '=' + id;
const pane = (id) => '=' + id + ':';

const tmux = (args, input) => new Promise((resolve, reject) => {
  const p = execFile('tmux', args, { timeout: 5000 }, (err, out, errOut) => err ? reject(new Error((errOut || err.message).trim())) : resolve(out));
  if (input !== undefined) { p.stdin.write(input); p.stdin.end(); }
});

// tmux keeps sessions alive across Switchboard restarts. Where it is missing
// (Windows, a Mac without Homebrew's tmux) Switchboard runs Claude itself in a
// pty and keeps the recent output to replay to whoever opens the terminal; those
// sessions end when Switchboard restarts.
export const MODE = (() => {
  if (process.platform === 'win32' || process.env.SWITCHBOARD_SESSIONS === 'direct') return 'direct';
  try { execFileSync('tmux', ['-V'], { stdio: 'ignore', timeout: 3000 }); return 'tmux'; } catch { return 'direct'; }
})();
const direct = new Map();   // id -> { pty, buf, subs: Set<fn>, exits: Set<fn> }

function alive() {
  if (MODE === 'direct') return new Set(direct.keys());
  try { return new Set(execFileSync('tmux', ['ls', '-F', '#{session_name}'], { timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().split('\n').filter(Boolean)); }
  catch { return new Set(); }
}

// ---- agents. Claude Code reports its state through hooks; every other agent is
// judged by its output: printing means busy, a few quiet seconds means free.
// models / efforts: the choices New session offers for the agent (Claude Code's
// `--model` aliases and `--effort` levels; `long` is the suffix for its 1M
// context). modelFree: the agent takes any model name (codex --model).
// A local model's chat: its server, how to start that server if it is not
// running, and where the conversation is kept (one file per session, by id
// and start time, since a folder's session id comes back after it ends).
const LOCAL_SERVERS = {
  ollama: { url: 'http://127.0.0.1:11434', name: 'Ollama', start: () => ['ollama', 'serve'] },
  lmstudio: { url: 'http://127.0.0.1:1234', name: 'LM Studio', start: () => [lmsPath() || 'lms', 'server', 'start'] }
};
export const chatLog = (id, created) => join(DATA_DIR, 'chats', `${id}-${created}.jsonl`);
const LOCAL_CHAT = fileURLToPath(new URL('../bin/localchat.mjs', import.meta.url));
export function localChatCommand(kind, model, log) {
  const s = LOCAL_SERVERS[kind];
  return [process.execPath, LOCAL_CHAT, '--server', s.url, '--model', model, '--name', s.name, '--log', log, '--start', JSON.stringify(s.start())].map(shellQuote).join(' ');
}

export const AGENTS = {
  claude: {
    name: 'Claude Code', cmd: 'claude', resume: '--resume',
    models: [['', 'Default'], ['sonnet', 'Sonnet', true], ['opus', 'Opus', true], ['haiku', 'Haiku']], long: '[1m]',   // true: has a 1M-context form
    efforts: [['', 'Default'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['max', 'Max']]
  },
  codex: { name: 'Codex (ChatGPT)', cmd: 'codex', modelFree: true },
  gemini: { name: 'Gemini', cmd: 'gemini' },
  aider: { name: 'Aider', cmd: 'aider' },
  // A model on this computer (lib/localai.js): the ones Ollama has pulled, or
  // the ones downloaded in LM Studio (its lms tool may not be on the PATH).
  localai: { name: 'Local model (Ollama)', cmd: 'ollama', local: 'ollama' },
  lmstudio: { name: 'Local model (LM Studio)', cmd: 'lms', local: 'lmstudio' },
  custom: { name: 'Other command', cmd: null }
};
// What a start request may ask for: a model alias or id, and one of Claude's effort levels.
const MODEL_OK = /^[a-z0-9.[\]-]{1,40}$/i;
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
export function startOptions(agent, model, effort) {
  const def = AGENTS[agent] || AGENTS.custom;
  model = String(model || '').trim(); effort = String(effort || '').trim().toLowerCase();
  if (def.local) {
    if (!model) throw new Error('Pick a model. Get one in Settings, Connections, Local AI models.');
    if (!LOCAL_MODEL.test(model)) throw new Error('That model name has characters Switchboard does not pass on.');
    return { model, effort: null };
  }
  if (!def.models && !def.modelFree) model = '';
  if (!def.efforts) effort = '';
  if (model && !MODEL_OK.test(model)) throw new Error('That model name has characters Switchboard does not pass on.');
  if (effort && !EFFORTS.has(effort)) throw new Error('Effort is low, medium, high, xhigh or max.');
  return { model: model || null, effort: effort || null };
}
const onPath = (cmd) => { try { execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; } };
// Where each agent keeps its sign-in, so Settings can say whether it is ready.
const SIGN_IN = { codex: ['.codex', 'auth.json'], gemini: ['.gemini', 'oauth_creds.json'], claude: ['.claude.json'] };
export function installedAgents() {
  return Object.entries(AGENTS).map(([id, a]) => ({
    id, name: a.name, installed: id === 'lmstudio' ? !!lmsPath() : a.cmd ? onPath(a.cmd) : true,
    signedIn: SIGN_IN[id] ? existsSync(join(homedir(), ...SIGN_IN[id])) : null,
    models: a.local ? localModelList(a.local) : a.models || null, long: a.long || null, efforts: a.efforts || null, modelFree: !!a.modelFree
  }));
}
// The downloaded models, for the New session dropdown.
function localModelList(which) {
  if (which === 'lmstudio') {
    const list = lmstudioModels();
    return list.length ? list.map((m) => [m.id, m.name]) : [['', 'No models yet: download one in LM Studio']];
  }
  const list = ollamaModels();
  return list.length ? list.map((m) => [m.id, m.id]) : [['', 'No models yet: get one in Settings, Connections']];
}

const activity = new Map();   // term id -> { at: last output, sig: last screen signature }
const QUIET_MS = 5000;
const markActive = (id) => activity.set(id, { ...(activity.get(id) || {}), at: Date.now() });
function activityState(id) {
  const a = activity.get(id);
  if (!a?.at) return 'idle';
  return Date.now() - a.at < QUIET_MS ? 'running' : 'idle';
}
// tmux sessions do not stream to Switchboard unless someone is watching, so look
// at the screen every couple of seconds instead.
export function sampleActivity() {
  if (MODE !== 'tmux') return;
  for (const t of db.prepare("SELECT id FROM terms WHERE ended_at IS NULL AND COALESCE(agent, 'claude') != 'claude'").all()) {
    let out = '';
    try { out = execFileSync('tmux', ['capture-pane', '-p', '-t', pane(t.id)], { timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).toString(); } catch { continue; }
    const a = activity.get(t.id) || {};
    if (a.sig !== out) activity.set(t.id, { at: a.sig === undefined ? 0 : Date.now(), sig: out });
  }
}

// A tmux session named sb-* that Switchboard has no open record of (it lost track,
// or the record was closed by mistake) is adopted back, with its folder.
function adopt(live) {
  if (MODE !== 'tmux') return;
  const known = new Set(db.prepare('SELECT id FROM terms WHERE ended_at IS NULL').all().map((r) => r.id));
  for (const id of live) {
    if (!id.startsWith('sb-') || known.has(id)) continue;
    let cwd = null;
    try { cwd = execFileSync('tmux', ['display-message', '-p', '-t', pane(id), '#{pane_current_path}'], { timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch {}
    const old = db.prepare('SELECT claude_id FROM terms WHERE id = ?').get(id);
    db.prepare('INSERT OR REPLACE INTO terms (id, name, cwd, space, claude_id, created_at, ended_at) VALUES (?, ?, ?, ?, ?, ?, NULL)')
      .run(id, cwd ? basename(cwd) : id.slice(3), cwd, spaceFor(cwd, cwd && basename(cwd)) || 'personal', null, Date.now());
    void old;   // the old Claude id belonged to the closed session; the hook binds the new one
  }
}

// ---- what a session is about. Claude Code names the terminal after the work
// ("Union city picker in Estimating"); that is the session's name on the board
// until the user gives it one of their own. tmux keeps each pane's title; a direct
// session takes it from the program's output.
let paneTitles = { at: 0, map: new Map() };
function titleOf(id) {
  if (MODE === 'direct') return cleanTitle(direct.get(id)?.title);
  if (Date.now() - paneTitles.at > 3000) {
    const map = new Map();
    try {
      for (const line of execFileSync('tmux', ['list-panes', '-a', '-F', '#{session_name}\t#{pane_title}'], { timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().split('\n')) {
        const i = line.indexOf('\t');
        if (i > 0 && !map.has(line.slice(0, i))) map.set(line.slice(0, i), cleanTitle(line.slice(i + 1)));
      }
    } catch {}
    paneTitles = { at: Date.now(), map };
  }
  return paneTitles.map.get(id) || '';
}
// A name is the user's own when it is not the folder's name the session started with.
const ownName = (t) => !!t.name && t.name !== (t.cwd ? basename(t.cwd) : t.id.slice(3));

export function listTerms() {
  const live = alive();
  adopt(live);
  const rows = db.prepare('SELECT * FROM terms WHERE ended_at IS NULL ORDER BY created_at').all();
  for (const t of rows) if (!live.has(t.id)) db.prepare('UPDATE terms SET ended_at = ? WHERE id = ?').run(Date.now(), t.id);
  return db.prepare('SELECT * FROM terms WHERE ended_at IS NULL ORDER BY created_at').all().map((t) => {
    const s = t.claude_id ? db.prepare('SELECT state, detail, prompt, updated_at, seen FROM sessions WHERE id = ?').get(t.claude_id) : null;
    const queued = db.prepare('SELECT * FROM queue WHERE term_id = ? AND sent_at IS NULL ORDER BY created_at').all(t.id);
    const links = db.prepare('SELECT * FROM links WHERE term_id = ?').all(t.id);
    const hooked = (t.agent || 'claude') === 'claude' && s;
    // live: what Claude Code reports about itself as it runs (model, effort, context used, cost; lib/claude.js).
    // The project follows the rules as they are now, not as they were when it
    // started, so a project made later takes in its sessions (Nov 5 2026).
    const space = t.cwd ? (spaceFor(t.cwd, basename(t.cwd)) || 'personal') : t.space;
    return { ...t, space, agent: t.agent || 'claude', agentName: (AGENTS[t.agent || 'claude'] || AGENTS.custom).name, mode: MODE, state: hooked ? s.state : ((t.agent || 'claude') === 'claude' ? 'starting' : activityState(t.id)), detail: s?.detail || null, prompt: s?.prompt || null, updatedAt: s?.updated_at || t.created_at, queued, links, title: titleOf(t.id), named: ownName(t), live: termStatus(t.id, t.claude_id) };
  });
}

// Folders a session can start in: the projects inside the usual code folders
// (~/dev, ~/code, ~/Projects, ~/source/repos, ~/Documents/GitHub, or the one set
// in Settings), newest first.
export function folders() {
  const set = getSetting('codeRoot', null);
  const roots = [set, 'dev', 'code', 'Projects', 'projects', 'src', 'source/repos', 'Documents/GitHub', 'GitHub']
    .filter(Boolean).map((r) => (r.startsWith('/') || /^[A-Za-z]:/.test(r)) ? r : join(homedir(), r)).filter(existsSync);
  const seen = new Set(), out = [];
  for (const root of roots) {
    let entries = [];
    try { entries = readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const d of entries) {
      if (!d.isDirectory() || d.name.startsWith('.') || d.name === 'node_modules') continue;
      const p = join(root, d.name);
      if (seen.has(p)) continue;
      seen.add(p);
      let m = 0; try { m = statSync(p).mtimeMs; } catch {}
      const copy = copyOf(p);
      out.push({ path: p, name: d.name, m, ...(copy ? { copyOf: copy } : {}), ...gitKind(p, copy) });
    }
  }
  // Whose repos are yours: the GitHub owner most of them share. A repo from
  // another owner is marked (someone else's code you cloned, or a fork), never hidden by itself.
  const owners = {};
  for (const f of out) if (f.owner) owners[f.owner] = (owners[f.owner] || 0) + 1;
  const you = Object.entries(owners).sort((a, b) => b[1] - a[1])[0]?.[0];
  for (const f of out) if (f.owner && you && f.owner !== you) f.others = true;
  const hidden = hiddenKeys();
  for (const f of out) if (hidden.has('folder:' + f.path)) f.hidden = true;
  return out.sort((a, b) => b.m - a.m);
}
// What a folder is: a repo (a .git folder), an agent's side copy (copyOf), or
// not a repo at all. A repo's GitHub owner comes from its origin remote, and a
// remote called upstream means it is a fork. Read from .git/config, no git run.
function gitKind(p, copy) {
  if (copy) return { kind: 'copy' };
  try { if (!statSync(join(p, '.git')).isDirectory()) return { kind: 'none' }; } catch { return { kind: 'none' }; }
  let cfg = ''; try { cfg = readFileSync(join(p, '.git', 'config'), 'utf8'); } catch {}
  const origin = cfg.match(/\[remote "origin"\][^[]*?url\s*=\s*(\S+)/);
  const gh = origin?.[1].match(/github\.com[:/]([^/]+)\/([^/\s]+?)(?:\.git)?$/i);
  return { kind: 'repo', ...(gh ? { owner: gh[1], repo: gh[1] + '/' + gh[2] } : {}), ...(/\[remote "upstream"\]/.test(cfg) ? { fork: true } : {}) };
}
// A git worktree (an agent's side copy of a repo, for one branch) has a .git
// file pointing back at the main repo instead of a .git folder. The picker puts
// these under the repo they copy, so the list is your repos, not every copy.
function copyOf(p) {
  try {
    const g = join(p, '.git');
    if (!statSync(g).isFile()) return null;
    const m = readFileSync(g, 'utf8').match(/^gitdir:\s*(.+?)[\\/]\.git[\\/]worktrees[\\/]/m);
    return m ? basename(m[1].trim()) : null;
  } catch { return null; }
}

export async function startTerm({ cwd, resume, agent = 'claude', command, setup = false, model, effort }) {
  ({ model, effort } = startOptions(agent, model, effort));
  // Setup (install or sign in to an agent, from Settings) runs in the home folder
  // and leaves a shell open afterwards, so the result stays on screen.
  if (setup) {
    cwd = homedir();
    command = process.platform === 'win32' ? command : `${command}; exec "\${SHELL:-sh}"`;
  }
  if (!cwd || !existsSync(cwd)) throw new Error('Pick a folder that exists.');
  const base = basename(cwd).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24) || 'session';
  const taken = alive();
  let id = `sb-${base}`, n = 2;
  while (taken.has(id)) id = `sb-${base}-${n++}`;
  const def = AGENTS[agent] || AGENTS.custom;
  const created = Date.now();
  let cmd;
  if (agent === 'custom') {
    cmd = String(command || '').trim();
    if (!cmd) throw new Error('Type the command to run.');
  } else {
    cmd = def.cmd + (resume && def.resume ? ` ${def.resume} ${resume.replace(/[^a-zA-Z0-9-]/g, '')}` : '');
    // The model and effort asked for on New session. Quoted: "[1m]" is a glob to the shell.
    // A local model runs Switchboard's own chat (bin/localchat.mjs) against the
    // model's local server, so the Chat view has a transcript to read.
    if (def.local) cmd = localChatCommand(def.local, model, chatLog(id, created));
    else {
      if (model) cmd += ` --model ${shellQuote(model)}`;
      if (effort) cmd += ` --effort ${effort}`;
    }
  }
  const record = () => db.prepare('INSERT OR REPLACE INTO terms (id, name, cwd, space, claude_id, created_at, agent, command, model, effort) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, basename(cwd), cwd, spaceFor(cwd, basename(cwd)) || 'personal', agent === 'claude' ? (resume || null) : null, created, agent, cmd, model, effort);
  if (MODE === 'direct') { startDirect(id, cwd, cmd); record(); markActive(id); return id; }
  // Start it in its own systemd scope where that exists (Linux), so restarting the
  // Switchboard service never takes the tmux server, and Claude, down with it.
  const args = ['new-session', '-d', '-s', id, '-c', cwd, '-x', '160', '-y', '45', '-e', `SWITCHBOARD_TERM=${id}`, cmd];
  await new Promise((resolve, reject) => {
    const scoped = process.platform === 'linux';
    execFile(scoped ? 'systemd-run' : 'tmux', scoped ? ['--user', '--scope', '--quiet', '--collect', 'tmux', ...args] : args, { timeout: 10000 },
      (err, out, errOut) => err ? reject(new Error((errOut || err.message).trim())) : resolve());
  });
  // No tmux status bar, mouse wheel scrolls, the window follows the newest viewer's size, and
  // passthrough on so an agent's copy (wrapped in tmux passthrough) reaches the viewer's clipboard.
  for (const [k, v] of [['status', 'off'], ['mouse', 'on'], ['history-limit', '20000'], ['allow-passthrough', 'on']]) {
    await tmux(['set-option', '-t', pane(id), k, v]).catch(() => {});
  }
  await windowLook(id);
  record();
  markActive(id);
  return id;
}

function startDirect(id, cwd, cmd) {
  const win = process.platform === 'win32';
  const p = pty.spawn(win ? (process.env.ComSpec || 'cmd.exe') : (process.env.SHELL || '/bin/sh'), win ? ['/c', cmd] : ['-lc', cmd], {
    name: 'xterm-256color', cols: 160, rows: 45, cwd,
    env: { ...process.env, TERM: 'xterm-256color', SWITCHBOARD_TERM: id }
  });
  const t = { pty: p, buf: '', subs: new Set(), exits: new Set() };
  p.onData((d) => {
    markActive(id);
    for (const m of d.matchAll(OSC_TITLE)) t.title = m[1];
    t.buf = (t.buf + d).slice(-400000);
    for (const fn of t.subs) fn(d);
  });
  p.onExit(() => {
    direct.delete(id);
    db.prepare('UPDATE terms SET ended_at = ? WHERE id = ?').run(Date.now(), id);
    for (const fn of t.exits) fn();
  });
  direct.set(id, t);
}

export async function closeTerm(id) {
  if (MODE === 'direct') { try { direct.get(id)?.pty.kill(); } catch {} direct.delete(id); }
  else await tmux(['kill-session', '-t', exact(id)]).catch(() => {});
  db.prepare('UPDATE terms SET ended_at = ? WHERE id = ?').run(Date.now(), id);
  db.prepare('DELETE FROM links WHERE term_id = ?').run(id);
}

// the user's own name for a session (the tab label). Empty puts the folder name back.
export function renameTerm(id, name) {
  const t = db.prepare('SELECT cwd FROM terms WHERE id = ?').get(id);
  if (!t) return false;
  const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  db.prepare('UPDATE terms SET name = ? WHERE id = ?').run(clean || (t.cwd ? basename(t.cwd) : id.slice(3)), id);
  return true;
}

// Called from the hook route: ties Claude's session id to the terminal it runs in.
export function bindClaude(termId, claudeId) {
  if (!termId || !claudeId) return;
  db.prepare('UPDATE terms SET claude_id = ? WHERE id = ? AND (claude_id IS NULL OR claude_id != ?)').run(claudeId, termId, claudeId);
}

// Text typed into a session is prose, never control codes. A message from the
// agent API, a linked chat or another computer must not carry escape sequences
// that could drive the terminal, nor the end-of-paste marker that would turn the
// rest of it into keystrokes. Newline and tab stay; CR becomes newline; the rest
// of C0, DEL, C1 and ESC go.
export function cleanForTerminal(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\x1b\[201~/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\x80-\x9f]/g, '');
}

// Type a message into the session as one paste, then Enter.
export async function typeInto(id, text) {
  text = cleanForTerminal(text);
  if (MODE === 'direct') {
    const t = direct.get(id); if (!t) throw new Error('That session is closed.');
    t.pty.write('\x1b[200~' + text + '\x1b[201~');
    await new Promise((r) => setTimeout(r, 150));
    t.pty.write('\r');
    return;
  }
  // Each message gets its own tmux buffer: a shared one let two sessions sent to
  // at the same moment both receive whichever message was loaded last.
  const buf = `sb-${id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await tmux(['load-buffer', '-b', buf, '-'], text);
  await tmux(['paste-buffer', '-p', '-d', '-b', buf, '-t', pane(id)]);
  await new Promise((r) => setTimeout(r, 150));
  await tmux(['send-keys', '-t', pane(id), 'Enter']);
}

// The session's screen as plain text, for reading the question it is asking
// (lib/agentmenu.js). Sessions run without tmux (Windows, a Mac without it)
// keep only raw output, so they return null and the Chat view offers the
// terminal instead.
export async function screenText(id) {
  if (MODE === 'direct') return null;
  try { return await tmux(['capture-pane', '-p', '-t', pane(id)]); } catch { return null; }
}
// Named keys (Up, Down, Enter) pressed in the session, one at a time.
const KEYS = new Set(['Up', 'Down', 'Enter', 'Escape', 'Tab']);
export async function pressKeys(id, keys) {
  if (MODE === 'direct') throw new Error('Answer this one in the terminal.');
  for (const k of keys) {
    if (!KEYS.has(k)) throw new Error('Not a key Switchboard presses.');
    await tmux(['send-keys', '-t', pane(id), k]);
    await new Promise((r) => setTimeout(r, 40));
  }
  markActive(id);
}

export async function interrupt(id) {
  if (MODE === 'direct') { direct.get(id)?.pty.write('\x1b'); return; }
  await tmux(['send-keys', '-t', pane(id), 'Escape']);
}

// ---- the queue
export function enqueue(termId, text, { source = 'You', held = false } = {}) {
  const r = db.prepare('INSERT INTO queue (term_id, text, source, held, created_at) VALUES (?, ?, ?, ?, ?)').run(termId, cleanForTerminal(text), source, held ? 1 : 0, Date.now());
  return Number(r.lastInsertRowid);
}
export const releaseItem = (id) => db.prepare('UPDATE queue SET held = 0 WHERE id = ?').run(id);
export const dropItem = (id) => db.prepare('DELETE FROM queue WHERE id = ? AND sent_at IS NULL').run(id);
export const editItem = (id, text) => db.prepare('UPDATE queue SET text = ? WHERE id = ? AND sent_at IS NULL').run(cleanForTerminal(text), id);

// A session is free when Claude has finished its turn (or is open and idle).
const FREE = new Set(['finished', 'idle']);

// Deliver everything released for every free session, as one message each.
export async function deliver() {
  let sent = 0;
  for (const t of listTerms()) {
    if (!FREE.has(t.state)) continue;
    const ready = t.queued.filter((q) => !q.held);
    if (!ready.length) continue;
    const text = ready.map((q) => q.text).join('\n\n');
    await typeInto(t.id, text);
    const now = Date.now();
    for (const q of ready) db.prepare('UPDATE queue SET sent_at = ? WHERE id = ?').run(now, q.id);
    // Mark it busy now so a second tick does not send again before it reports back.
    markActive(t.id);
    if (t.claude_id) db.prepare(`UPDATE sessions SET state = 'running', updated_at = ? WHERE id = ?`).run(now, t.claude_id);
    sent++;
  }
  return sent;
}

// Send right away: stop the current turn if it is working, then type it in.
export async function sendNow(termId, text) {
  const t = listTerms().find((x) => x.id === termId);
  if (!t) throw new Error('That session is closed.');
  if (t.state === 'running' || t.state === 'waiting') { await interrupt(termId); await new Promise((r) => setTimeout(r, 700)); }
  await typeInto(termId, text);
  markActive(termId);
  if (t.claude_id) db.prepare(`UPDATE sessions SET state = 'running', updated_at = ? WHERE id = ?`).run(Date.now(), t.claude_id);
}

// ---- links: a Teams chat feeding a session
export function link(chatKey, termId, who) {
  db.prepare('INSERT INTO links (chat_key, term_id, who, auto, last_at) VALUES (?, ?, ?, 0, ?) ON CONFLICT(chat_key) DO UPDATE SET term_id = excluded.term_id, who = excluded.who')
    .run(chatKey, termId, who || null, Date.now());
}
export const unlink = (chatKey) => db.prepare('DELETE FROM links WHERE chat_key = ?').run(chatKey);
export const setAuto = (chatKey, auto) => db.prepare('UPDATE links SET auto = ? WHERE chat_key = ?').run(auto ? 1 : 0, chatKey);
export const allLinks = () => db.prepare('SELECT * FROM links').all();

// New messages from a linked chat become queue items, held unless the link is automatic.
export function feedLinked(chatKey, messages) {
  const l = db.prepare('SELECT * FROM links WHERE chat_key = ?').get(chatKey);
  if (!l) return 0;
  const fresh = messages.filter((m) => !m.from_me && m.date > (l.last_at || 0)).sort((a, b) => a.date - b.date);
  for (const m of fresh) {
    const time = new Date(m.date).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    enqueue(l.term_id, `${m.from_name} in Teams (${time}): ${m.snippet}`, { source: `Teams · ${m.from_name}`, held: !l.auto });
  }
  if (fresh.length) db.prepare('UPDATE links SET last_at = ? WHERE chat_key = ?').run(Math.max(...fresh.map((m) => m.date)), chatKey);
  return fresh.length;
}

// ---- the live view: one pty per open browser terminal, attached to tmux
// A program draws at one size, so each session has one size: the view in use
// (last opened, resized, focused or typed in) sets it. Every view is told that
// size in-band, as a private escape sequence the page's terminal picks up, and
// views of another size scale the same picture to fit instead of clipping it.
// In-band so it also crosses the relay to other computers unchanged.
const dimsSeq = (c, r) => `\x1b]7747;${c}x${r}\x07`;

export function attach(id, cols, rows) {
  // Only a session Switchboard made (sb-*) and still has open: never any other
  // tmux session on the computer, whatever name the page or a peer asks for.
  if (!/^sb-[\w-]+$/.test(String(id)) || !db.prepare('SELECT 1 FROM terms WHERE id = ? AND ended_at IS NULL').get(id)) throw new Error('closed');
  if (MODE === 'direct') {
    // A viewer on a pty Switchboard owns: replay recent output, then stream.
    const t = direct.get(id);
    if (!t) throw new Error('closed');
    let sub = null, exit = null;
    return {
      onData(fn) { sub = fn; t.subs.add(fn); setTimeout(() => fn((t.buf || '') + dimsSeq(t.pty.cols, t.pty.rows)), 0); },
      onExit(fn) { exit = fn; t.exits.add(fn); },
      write(d) { t.pty.write(d); },
      resize(c, r) { try { t.pty.resize(c, r); } catch {} for (const fn of t.subs) fn(dimsSeq(c, r)); },
      kill() { if (sub) t.subs.delete(sub); if (exit) t.exits.delete(exit); }
    };
  }
  const p = pty.spawn('tmux', ['attach-session', '-t', exact(id)], {
    name: 'xterm-256color', cols: cols || 120, rows: rows || 40, cwd: homedir(),
    env: { ...process.env, TERM: 'xterm-256color' }
  });
  let out = null, last = '', timer = null;
  const report = () => tmux(['display-message', '-p', '-t', pane(id), '#{window_width}x#{window_height}']).then((o) => {
    const d = o.trim();
    if (d && d !== last && out) { last = d; const [c, r] = d.split('x'); out(dimsSeq(c, r)); }
  }).catch(() => {});
  // Resizes run one after another, so an older size can never land after a newer one.
  let chain = Promise.resolve();
  const fitWindow = (c, r) => { chain = chain.then(() => tmux(['resize-window', '-t', pane(id), '-x', String(c), '-y', String(r)]).catch(() => {})).then(report); };
  // No size here: the view sends its real one as soon as it has laid out.
  windowLook(id);
  timer = setInterval(report, 1000);   // another view may take the size at any time
  const stop = () => clearInterval(timer);
  p.onExit(stop);
  return {
    onData: (fn) => { out = fn; p.onData(fn); report(); },
    onExit: (fn) => p.onExit(fn),
    write: (d) => p.write(d),
    resize(c, r) { try { p.resize(c, r); } catch {} fitWindow(c, r); },
    kill: () => { stop(); p.kill(); }
  };
}

// Blank space, not dots, wherever a view is bigger than the window.
// How Switchboard's tmux sessions look when shown on Sessions: no green
// status bar (it takes the terminal's bottom row, which pushed Claude's own
// last line off the screen; the session's bar above shows the same things),
// and blank fill where a smaller view leaves space. Set on every start and
// attach, so sessions started before this change get it too.
function windowLook(id) {
  return Promise.all([
    tmux(['set-option', '-t', pane(id), 'status', 'off']),   // this session only; set-option takes "=name:", not "=name"
    tmux(['set-option', '-w', '-t', pane(id), 'fill-character', ' '])
  ].map((p) => p.catch(() => {})));
}

// ---- one-off commands (browser checks, lib/browserchecks.js): run a program in a
// folder with no window, keep the end of its output, and stop it and everything it
// started (a test runner's browser and dev server too) when it runs too long or is
// cancelled. Node's own folder goes first on PATH, so npx is found under systemd
// and launchd too.
const runEnv = (env) => ({ ...process.env, ...env, PATH: dirname(process.execPath) + (process.platform === 'win32' ? ';' : ':') + (process.env.PATH || process.env.Path || '') });

// npx through node itself, so its arguments never pass through a shell.
export function npxArgs(args) {
  const bin = dirname(process.execPath);
  const cli = [join(bin, 'node_modules/npm/bin/npx-cli.js'), join(bin, '../lib/node_modules/npm/bin/npx-cli.js')].find((f) => existsSync(f));
  return cli ? [process.execPath, [cli, ...args]] : [process.platform === 'win32' ? 'npx.cmd' : 'npx', args];
}

// command: [file, args] runs it directly; a string runs it through the system shell
// (sh, or cmd.exe on Windows), as if typed in a terminal in that folder.
// Returns { done: Promise<{ code, output, timedOut, cancelled }>, cancel() }.
export function runCommand(command, { cwd, env = {}, timeoutMs = 10 * 60e3, maxOutput = 200e3 } = {}) {
  const win = process.platform === 'win32', typed = typeof command === 'string';
  const [file, args] = typed ? (win ? [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${command}"`]] : ['/bin/sh', ['-c', command]]) : command;
  let output = '', timedOut = false, cancelled = false, p;
  try { p = spawn(file, args, { cwd, env: runEnv(env), detached: !win, windowsHide: true, windowsVerbatimArguments: win && typed, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { return { done: Promise.resolve({ code: -1, output: e.message, timedOut, cancelled }), cancel() {} }; }
  const take = (d) => { output += d; if (output.length > maxOutput) output = output.slice(-maxOutput); };
  p.stdout.on('data', take); p.stderr.on('data', take);
  const stop = () => {
    if (p.exitCode !== null || !p.pid) return;
    if (win) { try { execFileSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch {} return; }
    try { process.kill(-p.pid, 'SIGTERM'); } catch {}
    setTimeout(() => { try { process.kill(-p.pid, 'SIGKILL'); } catch {} }, 5000).unref();
  };
  const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
  const done = new Promise((resolve) => {
    p.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, output: output + '\n' + e.message, timedOut, cancelled }); });
    p.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? -1, output, timedOut, cancelled }); });
  });
  return { done, cancel() { cancelled = true; stop(); } };
}

// One argument quoted for the system shell, for a path added to a typed command.
export const shellQuote = (s) => process.platform === 'win32' ? `"${String(s).replace(/"/g, '""')}"` : `'${String(s).replace(/'/g, `'\\''`)}'`;
