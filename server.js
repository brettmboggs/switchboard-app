// Switchboard: one local server on 127.0.0.1:4747. It serves the board, takes
// Claude Code hook events, polls Gmail and GitHub, and talks to the desktop.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, getSetting, isCleared } from './lib/db.js';
import { spaces } from './lib/spaces.js';
import { send } from './lib/http.js';
import { startSecrets, secretsState } from './lib/secrets.js';
import { route as boardRoutes } from './lib/routes/board.js';
import { route as accountRoutes } from './lib/routes/account.js';
import { route as settingsRoutes } from './lib/routes/settings.js';
import { route as connectionRoutes } from './lib/routes/connections.js';
import { route as sessionRoutes } from './lib/routes/sessions.js';
import { route as systemRoutes } from './lib/routes/system.js';
import { route as webhookRoutes } from './lib/routes/webhooks.js';
import { route as routineRoutes } from './lib/routes/routines.js';
import { route as pageRoutes } from './lib/routes/pages.js';
import { pageList } from './lib/pages.js';
import { route as agentRoutes } from './lib/routes/agentapi.js';
import { route as sessionViewRoutes } from './lib/routes/sessionview.js';
import { route as checkRoutes } from './lib/routes/browserchecks.js';
import { route as inboxRoutes } from './lib/routes/inbox.js';
import { checksForBoard, startChecks } from './lib/browserchecks.js';
import { routines } from './lib/routines.js';
import { hookInLocal, startWebhooks, collect as collectWebhooks, hooks as webhookList } from './lib/webhooks.js';
const ROUTES = [boardRoutes, accountRoutes, settingsRoutes, connectionRoutes, sessionRoutes, systemRoutes, webhookRoutes, routineRoutes, pageRoutes, agentRoutes, checkRoutes, sessionViewRoutes, inboxRoutes];

// How the page looks and opens, set in Settings, Appearance.
// welcome: { done, seen: [setup ids], uses: [use ids], hideLeft } (see public/setup.js)
// chatView, devChips, termGpu: the Sessions extras in Settings, General.
const PREFS = { theme: 'light', textSize: 'm', termSize: 13.5, startPage: 'now', voice: 'live', welcome: null, chatView: false, devChips: false, termGpu: true };
// Which coding agents are installed and signed in, checked at most once a minute.
let agentCache = { at: 0, list: [] };
const agentsNow = () => { if (Date.now() - agentCache.at > 60e3) agentCache = { at: Date.now(), list: installedAgents() }; return agentCache.list; };
import { sessionsForBoard, lastHookAt, sessionFolders } from './lib/claude.js';
import { pollGithub, liveGithub, github, watchFolders, repoFor } from './lib/github.js';
import { gmailStatus, pollGmail, mailThreads, moneyFromMail, sendAddresses, awaitingReply, deliveriesForBoard } from './lib/gmail.js';
import { listWindows } from './lib/desktop.js';

import { weather, pollWeather } from './lib/weather.js';
import { calendars, calendarStatus, events as calendarEvents, pollCalendars, tickEvents } from './lib/calendar.js';
import { alert } from './lib/notify.js';
import { voiceState } from './lib/voice.js';
import { nextDue } from './lib/capture.js';
import { WebSocketServer } from 'ws';
import { updateState, checkForUpdate, currentSha } from './lib/update.js';
import { MODE as SESSION_MODE } from './lib/terminals.js';
import { syncStatus, signIn, startSync, onUnlocked } from './lib/sync.js';

import { startRelay, restartRelay, relayState, remoteTerms, publishTerms, openRemote } from './lib/relay.js';
import { installedAgents, sampleActivity, listTerms, deliver, allLinks, feedLinked, attach } from './lib/terminals.js';
import { microsoft, msConfig, pollMicrosoft, canWrite, chatMessages } from './lib/microsoft.js';

const PORT = Number(process.env.SWITCHBOARD_PORT || 4747);
const HERE = dirname(fileURLToPath(import.meta.url));
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

// ---- live updates: the page keeps one EventSource open and refetches on "changed"
const clients = new Set();
let pending = null;
function changed() {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    for (const res of clients) res.write('event: changed\ndata: 1\n\n');
  }, 150);
}

// ---- the board, in one payload
async function boardState() {
  const now = Date.now();
  const sessions = await sessionsForBoard();
  const terms = listTerms();
  const termBy = new Map(terms.filter((t) => t.claude_id).map((t) => [t.claude_id, t.id]));
  const gh = github();
  const runs = gh.runs.filter((r) => !isCleared(`run:${r.id}`, r.updatedAt));
  const reviews = gh.reviews.filter((r) => !isCleared(`pr:${r.id}`, r.updatedAt));
  const mail = mailThreads();
  const threads = [...mail.waiting, ...microsoft().threads]
    .filter((t) => !isCleared(t.key, t.date))
    .sort((a, b) => b.date - a.date);
  const email = mail.email.filter((t) => !isCleared(t.key, t.date)).slice(0, 60);
  const recent = [...mail.recent, ...microsoft().recent].sort((a, b) => b.date - a.date).slice(0, 40);
  const awaiting = awaitingReply().filter((t) => !isCleared('await:' + t.key, t.date));
  const items = db.prepare('SELECT * FROM items WHERE done_at IS NULL ORDER BY COALESCE(due_at, created_at) ASC').all();
  const recentDone = db.prepare(`SELECT * FROM items WHERE done_at > ? AND kind IN ('note', 'todo', 'reminder') ORDER BY done_at DESC LIMIT 20`).all(now - 3 * 86400e3);
  const bills = items.filter((i) => i.kind === 'bill').map((b) => ({ ...b, next: nextDue(b, now) }));
  const invoices = items.filter((i) => i.kind === 'invoice');
  const paid = db.prepare(`SELECT * FROM items WHERE kind = 'paid' AND created_at > ? ORDER BY created_at DESC`).all(now - 60 * 86400e3);
  const windows = await listWindows();
  return {
    now,
    spaces: spaces(), prefs: { ...PREFS, ...getSetting('prefs', {}) }, voice: voiceState(), agents: agentsNow(),
    webhooks: webhookList().length,
    deliveries: deliveriesForBoard(),
    routines: routines(),
    pages: pageList(),
    checks: checksForBoard(),
    events: calendarEvents().filter((e) => e.end > now && e.start < now + 7 * 86400e3), calendars: calendarStatus(), weather: weather(),
    sessions: sessions.map((x) => ({ ...x, termId: termBy.get(x.id) || null, ci: repoFor(x.cwd) })), runs, reviews, actions: gh.actions, threads, email, awaiting, recent,
    terms: terms.map((t) => ({ ...t, ci: repoFor(t.cwd) })), links: allLinks(), remoteTerms: remoteTerms(), relay: relayState(),
    items: items.filter((i) => ['note', 'todo', 'reminder'].includes(i.kind)),
    recentDone,
    money: { mail: [...moneyFromMail(), ...microsoft().receipts].sort((a, b) => b.date - a.date), bills, paid, invoices },
    sendAs: sendAddresses(),
    windows,
    version: (() => { const u = updateState(); return { build: BUILD, sha: u.sha, behind: u.behind, subjects: u.subjects, error: u.error, busy: u.busy }; })(),
    platform: process.platform, sessionMode: SESSION_MODE,
    account: syncStatus(),
    status: {
      secrets: secretsState(),
      hooks: lastHookAt(),
      github: { at: gh.at, ok: gh.ok, error: gh.error },
      gmail: gmailStatus(),
      microsoft: (() => { const m = microsoft(), c = msConfig(); return { connected: !!c?.refreshToken, email: c?.account?.email || null, at: m.at, ok: m.ok, error: m.error, signIn: m.signIn, canWrite: canWrite() }; })()
    }
  };
}

// ---- helpers
// A fingerprint of the page's own files: an open page reloads itself when the
// server comes back with different ones (an update, or a local change).
const PAGE_JS = readdirSync(new URL('./public/js/', import.meta.url)).filter((f) => /^[a-z]+\.js$/.test(f)).sort();
const BUILD = createHash('sha1').update(['index.html', 'app.css', 'setup.js', ...PAGE_JS.map((f) => 'js/' + f)].map((f) => { try { return readFileSync(new URL('./public/' + f, import.meta.url)); } catch { return ''; } }).join('\n')).digest('hex').slice(0, 12);

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/setup.js': ['setup.js', 'text/javascript; charset=utf-8'],
  '/app.css': ['app.css', 'text/css; charset=utf-8'],
  '/icon.svg': ['icon.svg', 'image/svg+xml'],
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
  '/sw.js': ['sw.js', 'text/javascript; charset=utf-8'],
  '/icon-192.png': ['icon-192.png', 'image/png'],
  '/icon-512.png': ['icon-512.png', 'image/png'],
  '/icon-maskable.png': ['icon-maskable.png', 'image/png'],
  '/vendor/xterm.js': ['../node_modules/@xterm/xterm/lib/xterm.js', 'text/javascript; charset=utf-8'],
  '/vendor/xterm.css': ['../node_modules/@xterm/xterm/css/xterm.css', 'text/css; charset=utf-8'],
  '/vendor/addon-fit.js': ['../node_modules/@xterm/addon-fit/lib/addon-fit.js', 'text/javascript; charset=utf-8'],
  '/vendor/addon-webgl.js': ['../node_modules/@xterm/addon-webgl/lib/addon-webgl.js', 'text/javascript; charset=utf-8']
};

// ---- routes
const server = createServer(async (req, res) => {
  // Only this machine, and only by its own name: stops other sites in the
  // browser from reaching the board through DNS tricks.
  if (!ALLOWED_HOSTS.has(req.headers.host || '')) return send(res, 403, { error: 'host' });
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  // The page's scripts: only names in public/js, nothing else on disk.
  const js = path.match(/^\/js\/([a-z]+\.js)$/);
  if (req.method === 'GET' && js && PAGE_JS.includes(js[1])) {
    try { return send(res, 200, await readFile(join(HERE, 'public', 'js', js[1])), 'text/javascript; charset=utf-8'); }
    catch { return send(res, 404, 'missing', 'text/plain'); }
  }
  if (req.method === 'GET' && STATIC[path]) {
    const [file, type] = STATIC[path];
    try { return send(res, 200, await readFile(join(HERE, 'public', file)), type); }
    catch { return send(res, 404, 'missing', 'text/plain'); }
  }

  // Webhooks in (lib/webhooks.js): scripts on this computer post here with the
  // webhook's secret instead of the header. No web page may: it refuses browsers.
  const hin = path.match(/^\/hook\/in\/([0-9a-f]{64})$/);
  if (hin) {
    try { return await hookInLocal(req, res, hin[1], send, changed); }
    catch (e) { console.error(e); return send(res, 500, { error: 'Switchboard could not take that.' }); }
  }

  // Anything that changes state must carry this header. Browsers cannot add it
  // cross-site without a preflight, which this server never approves.
  if (req.method === 'POST' && req.headers['x-switchboard'] !== '1') return send(res, 403, { error: 'header' });

  try {
    // Each area of the board answers its own paths (lib/routes/); the first
    // one that responds ends the request.
    const ctx = { req, res, path, url, changed, boardState, clients, PORT, PREFS, agentsNow };
    for (const route of ROUTES) {
      await route(ctx);
      if (res.headersSent || res.writableEnded) return;
    }

    return send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: String(e?.message || e) });
  }
});

// ---- background work
// Teams chats linked to a session: new messages become queue items.
async function feedLinks() {
  for (const l of allLinks()) {
    if (!l.chat_key.startsWith('teams:')) continue;
    try { if (feedLinked(l.chat_key, await chatMessages(l.chat_key.slice(6)))) changed(); } catch {}
  }
  await deliver().catch(() => {});
}

async function tickReminders() {
  const due = db.prepare(`SELECT * FROM items WHERE kind IN ('reminder', 'todo', 'routine') AND done_at IS NULL AND due_at IS NOT NULL AND due_at <= ? AND notified_at IS NULL`).all(Date.now());
  for (const r of due) {
    alert('reminders', { reminder: 'Reminder', todo: 'To-do due', routine: 'Time to' }[r.kind], r.text);
    db.prepare('UPDATE items SET notified_at = ? WHERE id = ?').run(Date.now(), r.id);
  }
  if (due.length) changed();
}

let lastWindows = '';
async function tickWindows() {
  const w = await listWindows();
  const sig = w.map((x) => x.id + x.title + x.active).join('|');
  if (sig !== lastWindows) { lastWindows = sig; changed(); }
}

// ---- live terminals over a WebSocket. Same host rule as everything else, plus
// the Origin must be this page: a terminal is a shell, so no other site may open one.
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const origin = req.headers.origin || '';
  if (!ALLOWED_HOSTS.has(req.headers.host || '') || !['http://127.0.0.1:' + PORT, 'http://localhost:' + PORT].includes(origin)) { socket.destroy(); return; }
  // Another computer's session: bridge this browser terminal through the relay.
  const rm = (req.url || '').match(/^\/term\/r\/([0-9a-f]{8,64})\/([\w-]+)(?:\?cols=(\d+)&rows=(\d+))?$/);
  if (rm) { wss.handleUpgrade(req, socket, head, (ws) => openRemote(ws, rm[1], rm[2], Number(rm[3]) || 120, Number(rm[4]) || 40)); return; }
  const m = (req.url || '').match(/^\/term\/([\w-]+)(?:\?cols=(\d+)&rows=(\d+))?$/);
  if (!m) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => {
    let p;
    try { p = attach(m[1], Number(m[2]) || 120, Number(m[3]) || 40); } catch { ws.close(); return; }
    p.onData((d) => { if (ws.readyState === 1) ws.send(d); });
    p.onExit(() => ws.close());
    ws.on('message', (raw) => {
      let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.t === 'in' && typeof msg.d === 'string') p.write(msg.d);
      if (msg.t === 'size' && msg.c > 0 && msg.r > 0) p.resize(Math.min(msg.c, 500), Math.min(msg.r, 200));
    });
    ws.on('close', () => { try { p.kill(); } catch {} });
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Switchboard on http://127.0.0.1:${PORT}`);
  // Connections need their passwords and tokens: start them once this
  // computer's keychain has handed over its key (lib/secrets.js).
  startSecrets(() => { changed(); startAll(); });
  startChecks(changed);   // browser checks need no passwords
});

function startAll() {
  watchFolders(() => [...listTerms().map((t) => t.cwd), ...sessionFolders()]);
  pollGithub().then(changed);
  pollGmail().then(changed);
  setInterval(() => pollGithub().then(changed), 2 * 60e3);
  // GitHub Actions, live: the folders sessions work in, and a quick check every
  // 10 seconds that only asks GitHub when a run is going or a session's repo
  // may have just been pushed to (lib/github.js).
  let liveBusy = false;
  setInterval(() => { if (liveBusy) return; liveBusy = true; liveGithub().then((moved) => { if (moved) changed(); }).catch(() => {}).finally(() => { liveBusy = false; }); }, 10e3);
  setInterval(() => pollGmail().then(changed), 90e3);
  pollMicrosoft().then(changed);
  // Every 30 seconds: three small Graph requests. An open chat is also checked
  // every few seconds on its own (lib/conversation.js, public/js/convo.js).
  setInterval(() => pollMicrosoft().then(feedLinks).then(changed), 30e3);
  currentSha().then(() => checkForUpdate()).then(changed);
  startSync(changed);
  onUnlocked(() => { restartRelay(); collectWebhooks(changed); changed(); });
  startRelay(changed);
  startWebhooks(changed);
  setInterval(publishTerms, 30e3);
  setInterval(() => checkForUpdate().then(changed), 30 * 60e3);
  setInterval(() => deliver().then((n) => n && changed()).catch(() => {}), 5e3);
  // Agents without hooks: watch their screens, and tell the page when one goes busy or quiet.
  let lastStates = '';
  setInterval(() => {
    sampleActivity();
    const sig = listTerms().map((t) => t.id + t.state).join('|');
    if (sig !== lastStates) { lastStates = sig; changed(); publishTerms(); }
  }, 2e3);
  setInterval(tickReminders, 15e3);
  pollCalendars().then((c) => c && changed());
  setInterval(() => pollCalendars().then((c) => c && changed()), 10 * 60e3);
  setInterval(tickEvents, 30e3);
  pollWeather().then((c) => c && changed());
  setInterval(() => pollWeather().then((c) => c && changed()), 30 * 60e3);
  setInterval(tickWindows, 3e3);
  setInterval(changed, 60e3);   // keeps "4 min ago" honest
}
