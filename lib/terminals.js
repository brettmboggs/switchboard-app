// Claude sessions that Switchboard runs itself. Each one is the real `claude`
// program inside its own tmux session ("sb-<slug>"), so it keeps running when
// Switchboard restarts and can be opened from any terminal with
// `tmux attach -t sb-<slug>`. The page shows it through a pty attached to that
// tmux session; messages are typed in with tmux's paste buffer.
//
// The hook script passes SWITCHBOARD_TERM, so Claude's session id and its
// running / waiting / finished state tie back to the terminal here. That is
// what lets queued messages wait until the session is free.
import { execFile, execFileSync, spawn } from 'node:child_process';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename, dirname } from 'node:path';
import pty from 'node-pty';
import { createRequire } from 'node:module';
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
import { db, getSetting } from './db.js';
import { spaceFor } from './spaces.js';

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
export const AGENTS = {
  claude: { name: 'Claude Code', cmd: 'claude', resume: '--resume' },
  codex: { name: 'Codex (ChatGPT)', cmd: 'codex' },
  gemini: { name: 'Gemini', cmd: 'gemini' },
  aider: { name: 'Aider', cmd: 'aider' },
  custom: { name: 'Other command', cmd: null }
};
const onPath = (cmd) => { try { execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; } };
// Where each agent keeps its sign-in, so Settings can say whether it is ready.
const SIGN_IN = { codex: ['.codex', 'auth.json'], gemini: ['.gemini', 'oauth_creds.json'], claude: ['.claude.json'] };
export function installedAgents() {
  return Object.entries(AGENTS).map(([id, a]) => ({
    id, name: a.name, installed: a.cmd ? onPath(a.cmd) : true,
    signedIn: SIGN_IN[id] ? existsSync(join(homedir(), ...SIGN_IN[id])) : null
  }));
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
    return { ...t, agent: t.agent || 'claude', agentName: (AGENTS[t.agent || 'claude'] || AGENTS.custom).name, mode: MODE, state: hooked ? s.state : ((t.agent || 'claude') === 'claude' ? 'starting' : activityState(t.id)), detail: s?.detail || null, prompt: s?.prompt || null, updatedAt: s?.updated_at || t.created_at, queued, links };
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
      out.push({ path: p, name: d.name, m });
    }
  }
  return out.sort((a, b) => b.m - a.m);
}

export async function startTerm({ cwd, resume, agent = 'claude', command, setup = false }) {
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
  let cmd;
  if (agent === 'custom') {
    cmd = String(command || '').trim();
    if (!cmd) throw new Error('Type the command to run.');
  } else {
    cmd = def.cmd + (resume && def.resume ? ` ${def.resume} ${resume.replace(/[^a-zA-Z0-9-]/g, '')}` : '');
  }
  const record = () => db.prepare('INSERT OR REPLACE INTO terms (id, name, cwd, space, claude_id, created_at, agent, command) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, basename(cwd), cwd, spaceFor(cwd, basename(cwd)) || 'personal', agent === 'claude' ? (resume || null) : null, Date.now(), agent, cmd);
  if (MODE === 'direct') { startDirect(id, cwd, cmd); record(); markActive(id); return id; }
  // Start it in its own systemd scope where that exists (Linux), so restarting the
  // Switchboard service never takes the tmux server, and Claude, down with it.
  const args = ['new-session', '-d', '-s', id, '-c', cwd, '-x', '160', '-y', '45', '-e', `SWITCHBOARD_TERM=${id}`, cmd];
  await new Promise((resolve, reject) => {
    const scoped = process.platform === 'linux';
    execFile(scoped ? 'systemd-run' : 'tmux', scoped ? ['--user', '--scope', '--quiet', '--collect', 'tmux', ...args] : args, { timeout: 10000 },
      (err, out, errOut) => err ? reject(new Error((errOut || err.message).trim())) : resolve());
  });
  // No tmux status bar, mouse wheel scrolls, and the window follows the newest viewer's size.
  for (const [k, v] of [['status', 'off'], ['mouse', 'on'], ['history-limit', '20000']]) {
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

// Brett's own name for a session (the tab label). Empty puts the folder name back.
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

// Type a message into the session as one paste, then Enter.
export async function typeInto(id, text) {
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

export async function interrupt(id) {
  if (MODE === 'direct') { direct.get(id)?.pty.write('\x1b'); return; }
  await tmux(['send-keys', '-t', pane(id), 'Escape']);
}

// ---- the queue
export function enqueue(termId, text, { source = 'You', held = false } = {}) {
  const r = db.prepare('INSERT INTO queue (term_id, text, source, held, created_at) VALUES (?, ?, ?, ?, ?)').run(termId, text, source, held ? 1 : 0, Date.now());
  return Number(r.lastInsertRowid);
}
export const releaseItem = (id) => db.prepare('UPDATE queue SET held = 0 WHERE id = ?').run(id);
export const dropItem = (id) => db.prepare('DELETE FROM queue WHERE id = ? AND sent_at IS NULL').run(id);
export const editItem = (id, text) => db.prepare('UPDATE queue SET text = ? WHERE id = ? AND sent_at IS NULL').run(text, id);

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
function windowLook(id) {
  return tmux(['set-option', '-w', '-t', pane(id), 'fill-character', ' ']).catch(() => {});
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
