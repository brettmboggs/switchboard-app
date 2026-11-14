// Switchboard: one local server on 127.0.0.1:4747. It serves the board, takes
// Claude Code hook events, polls Gmail and GitHub, and talks to the desktop.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, getSetting, setSetting, isCleared } from './lib/db.js';
import { spaces, knowOwnAddresses } from './lib/spaces.js';
import { profiles } from './lib/projects.js';
import { send } from './lib/http.js';
import { startSecrets, secretsState } from './lib/secrets.js';
import { route as boardRoutes } from './lib/routes/board.js';
import { route as accountRoutes } from './lib/routes/account.js';
import { route as settingsRoutes } from './lib/routes/settings.js';
import { route as connectionRoutes } from './lib/routes/connections.js';
import { route as sessionRoutes } from './lib/routes/sessions.js';
import { route as systemRoutes } from './lib/routes/system.js';
import { route as webhookRoutes } from './lib/routes/webhooks.js';
import { route as slashRoutes } from './lib/routes/slash.js';
import { route as routineRoutes } from './lib/routes/routines.js';
import { route as pageRoutes } from './lib/routes/pages.js';
import { pageList } from './lib/pages.js';
import { route as agentRoutes } from './lib/routes/agentapi.js';
import { route as sessionViewRoutes } from './lib/routes/sessionview.js';
import { route as checkRoutes } from './lib/routes/browserchecks.js';
import { route as calendarRoutes } from './lib/routes/calendar.js';
import { route as googleRoutes, googleStatus } from './lib/routes/google.js';
import { route as inboxRoutes } from './lib/routes/inbox.js';
import { route as projectRoutes } from './lib/routes/projects.js';
import { route as sortingRoutes } from './lib/routes/sorting.js';
import { route as shareRoutes } from './lib/routes/share.js';
import { route as chatRoutes } from './lib/routes/chat.js';
import { chatThreads, chatBoard, startChat } from './lib/chat.js';
import { shareState, changedBy, sharedBy, startShares, setRepoSource, setActivitySource, setCiSource, setSource, setLiveHandler, sharedRepos } from './lib/share.js';
import { termRow, readChat } from './lib/chatview.js';
import { makeSessionHandler } from './lib/sessshare.js';
import { enqueue } from './lib/terminals.js';
import { threadMessages } from './lib/gmail.js';
import { listFiles } from './lib/projects.js';
import { folders as codeFolders } from './lib/terminals.js';
import { spaceFor } from './lib/spaces.js';
import { belongsAll } from './lib/belongs.js';
import { unsortedCount } from './lib/sorting.js';
import { route as costRoutes } from './lib/routes/costs.js';
import { recurringGuesses } from './lib/costs.js';
import { pollLocalAI } from './lib/localai.js';
import { route as feedRoutes } from './lib/routes/feeds.js';
import { route as taskRoutes } from './lib/routes/tasks.js';
import { route as granolaRoutes } from './lib/routes/granola.js';
import { route as fileRoutes } from './lib/routes/files.js';
import { route as draftRoutes } from './lib/routes/drafts.js';
import { readAllDrafts, drafts } from './lib/drafts.js';
import { route as localFileRoutes } from './lib/routes/localfile.js';
import { route as jarvisRoutes } from './lib/routes/jarvis.js';
import { route as usageRoutes } from './lib/routes/usage.js';
import { route as speedtestRoutes } from './lib/routes/speedtest.js';
import { route as flipRoutes } from './lib/routes/flips.js';
import { route as aiRoutes } from './lib/routes/ai.js';
import * as engine from './lib/engine.js';
import { sweepChats } from './lib/localchats.js';
import { route as mailtrackRoutes } from './lib/routes/mailtrack.js';
import { route as bookRoutes } from './lib/routes/books.js';
import { route as dashboardRoutes } from './lib/routes/dashboard.js';
import { dueChecks } from './lib/dashboard.js';
import { booksForBoard } from './lib/books.js';
import { voiceStatus } from './lib/tts.js';
import { pollMailtrack, mailtrackForBoard } from './lib/mailtrack.js';
import { tidyNow, tidyDue, sweepModels } from './lib/jarvis.js';
import { pollTasks, tasks, taskStatus } from './lib/tasks.js';
import { pollGranola, granolaStatus } from './lib/granola.js';
import { noteMarks } from './lib/notemarks.js';
import { pollFeeds, reading, feeds } from './lib/feeds.js';
import { pollGsa, pollEbay, pollAuctions, ebayDue, flipsBrief, alertable, takeGsaNews } from './lib/flips.js';
import { checksForBoard, startChecks } from './lib/browserchecks.js';
import { routines } from './lib/routines.js';
import { hookInLocal, startWebhooks, collect as collectWebhooks, hooks as webhookList } from './lib/webhooks.js';
// Team chat first: it answers the Inbox's conversation routes for its own "team:" keys only.
const ROUTES = [chatRoutes, boardRoutes, accountRoutes, settingsRoutes, connectionRoutes, sessionRoutes, systemRoutes, webhookRoutes, routineRoutes, pageRoutes, agentRoutes, checkRoutes, calendarRoutes, googleRoutes, sessionViewRoutes, inboxRoutes, slashRoutes, projectRoutes, sortingRoutes, shareRoutes, costRoutes, feedRoutes, taskRoutes, granolaRoutes, fileRoutes, localFileRoutes, draftRoutes, jarvisRoutes, usageRoutes, speedtestRoutes, mailtrackRoutes, bookRoutes, dashboardRoutes, flipRoutes, aiRoutes];

// How the page looks and opens, set in Settings, Appearance.
// welcome: { done, seen: [setup ids], uses: [use ids], hideLeft } (see public/setup.js)
// sessionView: how Claude sessions open, 'chat' or 'term' (each session's
// Chat | Terminal switch overrides it). devChips, termGpu: the Sessions extras.
// All in Settings, Look. (The old chatView switch is dropped.)
const PREFS = { theme: 'light', textSize: 'm', termSize: 13.5, startPage: 'now', voice: 'live', welcome: null, sessionView: 'chat', devChips: false, termGpu: true, autoUpdate: false, rundown: true, msgHidden: {}, connections: null, jvSpeakUp: false, jvBrief: true, jvPersona: '' };
// Which coding agents are installed and signed in, checked at most once a minute.
let agentCache = { at: 0, list: [] };
const agentsNow = () => { if (Date.now() - agentCache.at > 60e3) agentCache = { at: Date.now(), list: installedAgents() }; return agentCache.list; };
import { sessionsForBoard, lastHookAt, sessionFolders } from './lib/claude.js';
import { pollGithub, liveGithub, github, watchFolders, repoFor, watchShared, ghLogin } from './lib/github.js';
import { gmailStatus, pollGmail, mailThreads, moneyFromMail, sendAddresses, awaitingReply, deliveriesForBoard, accounts as mailAccounts } from './lib/gmail.js';
// People on a project's About card sort its mail; your own addresses never do (lib/spaces.js).
knowOwnAddresses(() => [...sendAddresses().map((a) => a.address), ...mailAccounts().map((a) => a.email)]);
import { listWindows } from './lib/desktop.js';

import { weather, pollWeather } from './lib/weather.js';
import { usageForBoard, readCodexLimits } from './lib/usage.js';
import { calendars, calendarStatus, events as calendarEvents, pollCalendars, tickEvents } from './lib/calendar.js';
import { alert } from './lib/notify.js';
import { voiceState } from './lib/voice.js';
import { nextDue } from './lib/capture.js';
import { WebSocketServer } from 'ws';
import { updateState, checkForUpdate, currentSha, applyUpdate } from './lib/update.js';
import { autoUpdateOk } from './lib/routes/system.js';
import { MODE as SESSION_MODE } from './lib/terminals.js';
import { syncStatus, signIn, startSync, onUnlocked } from './lib/sync.js';

import { startRelay, restartRelay, relayState, remoteTerms, publishTerms, openRemote } from './lib/relay.js';
import { installedAgents, sampleActivity, listTerms, deliver, allLinks, feedLinked, attach } from './lib/terminals.js';
import { microsoft, msConfig, pollMicrosoft, canWrite, chatMessages } from './lib/microsoft.js';
import { friendlyError } from './lib/friendly.js';

// Named in Activity Monitor, Task Manager and ps, instead of a bare "node".
process.title = 'switchboard';
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
  const team = chatThreads();
  const threads = [...mail.waiting, ...microsoft().threads, ...team.waiting]
    .filter((t) => !isCleared(t.key, t.date))
    .sort((a, b) => b.date - a.date);
  const email = mail.email.filter((t) => !isCleared(t.key, t.date)).slice(0, 60);
  const recent = [...mail.recent, ...microsoft().recent, ...team.recent].sort((a, b) => b.date - a.date).slice(0, 40);
  const teamsChats = microsoft().chats || [];   // every recent Teams chat, for the Inbox's Teams folder
  const awaiting = awaitingReply().filter((t) => !isCleared('await:' + t.key, t.date));
  const items = db.prepare('SELECT * FROM items WHERE done_at IS NULL ORDER BY COALESCE(due_at, created_at) ASC').all();
  const recentDone = db.prepare(`SELECT * FROM items WHERE done_at > ? AND kind IN ('note', 'todo', 'reminder') ORDER BY done_at DESC LIMIT 20`).all(now - 3 * 86400e3);
  const bills = items.filter((i) => i.kind === 'bill').map((b) => ({ ...b, next: nextDue(b, now) }));
  const invoices = items.filter((i) => i.kind === 'invoice');
  const paid = db.prepare(`SELECT * FROM items WHERE kind = 'paid' AND created_at > ? ORDER BY created_at DESC`).all(now - 60 * 86400e3);
  const windows = await listWindows();
  return {
    now,
    spaces: spaces(), profiles: profiles(), reading: reading(), feedCount: feeds().length, flips: flipsBrief(), tasks: tasks(), taskStatus: taskStatus(), granola: granolaStatus(), noteMarks: noteMarks(), prefs: { ...PREFS, ...getSetting('prefs', {}) }, belongs: belongsAll(), unsorted: unsortedCount(), share: shareState(), chat: chatBoard(), changedBy: changedBy(), sharedBy: sharedBy(), sharedPrs: github().sharedPrs || [], voice: voiceState(), engine: engine.brief(), agents: agentsNow(),
    webhooks: webhookList().length,
    deliveries: deliveriesForBoard(), mailtrack: mailtrackForBoard(), books: booksForBoard(), voice: voiceStatus(),
    routines: routines(),
    pages: pageList(),
    checks: checksForBoard(),
    events: calendarEvents().filter((e) => e.end > now && e.start < now + 7 * 86400e3), calendars: calendarStatus(), weather: weather(), usage: usageForBoard(),
    sessions: sessions.map((x) => ({ ...x, termId: termBy.get(x.id) || null, ci: repoFor(x.cwd) })), runs, reviews, actions: gh.actions, threads, email, awaiting, recent, teamsChats, drafts: drafts(),
    terms: terms.map((t) => ({ ...t, ci: repoFor(t.cwd) })), links: allLinks(), remoteTerms: remoteTerms(), relay: relayState(),
    items: items.filter((i) => ['note', 'todo', 'reminder'].includes(i.kind)),
    recentDone,
    money: { mail: [...moneyFromMail(), ...microsoft().receipts].sort((a, b) => b.date - a.date), bills, paid, invoices, guesses: recurringGuesses(now) },
    sendAs: sendAddresses(),
    windows,
    version: (() => { const u = updateState(); return { build: BUILD, pkg: u.pkg, sha: u.sha, channel: u.channel, behind: u.behind, subjects: u.subjects, error: u.error, busy: u.busy, app: u.app }; })(),
    platform: process.platform, sessionMode: SESSION_MODE,
    account: syncStatus(),
    status: {
      secrets: secretsState(),
      hooks: lastHookAt(),
      github: { at: gh.at, ok: gh.ok, error: gh.error },
      gmail: gmailStatus(),
      google: googleStatus(),
      microsoft: (() => { const m = microsoft(), c = msConfig(); return { connected: !!c?.refreshToken, email: c?.account?.email || null, at: m.at, ok: m.ok, error: m.error, signIn: m.signIn, canWrite: canWrite() }; })()
    }
  };
}

// ---- helpers
// A fingerprint of the page's own files: an open page reloads itself when the
// server comes back with different ones (an update, or a local change).
const PAGE_JS = readdirSync(new URL('./public/js/', import.meta.url)).filter((f) => /^[a-z]+\.js$/.test(f)).sort();
// The web board's modules (public/js/web/): loaded here too, where they see they are not on the board and do nothing.
const WEB_JS = readdirSync(new URL('./public/js/web/', import.meta.url)).filter((f) => /^[a-z]+\.js$/.test(f));
// The core both the app and the web board run (public/js/shared/): the page imports it too.
const SHARED_JS = readdirSync(new URL('./public/js/shared/', import.meta.url)).filter((f) => /^[a-z-]+\.js$/.test(f));
// The stylesheets: public/css and one folder down (components/, pages/), by name.
const PAGE_CSS = readdirSync(new URL('./public/css/', import.meta.url), { recursive: true }).map((f) => String(f).replaceAll('\\', '/')).filter((f) => /^[a-z-]+(\/[a-z-]+)?\.css$/.test(f)).sort();
// The fonts ship with Switchboard (public/fonts, licences in LICENSES.md there); static, so not in BUILD.
const FONTS = readdirSync(new URL('./public/fonts/', import.meta.url)).filter((f) => /^[a-z-]+\.woff2$/.test(f));
const BUILD = createHash('sha1').update(['index.html', 'setup.js', ...PAGE_CSS.map((f) => 'css/' + f), ...PAGE_JS.map((f) => 'js/' + f)].map((f) => { try { return readFileSync(new URL('./public/' + f, import.meta.url)); } catch { return ''; } }).join('\n')).digest('hex').slice(0, 12);

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/setup.js': ['setup.js', 'text/javascript; charset=utf-8'],
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
  if (!ALLOWED_HOSTS.has(req.headers.host || '')) return send(res, 403, { error: 'Switchboard only answers on this computer, at 127.0.0.1 or localhost. Open it from that address.' });
  let url; try { url = new URL(req.url, `http://${req.headers.host}`); } catch { return send(res, 400, { error: 'That address is not one Switchboard can read. Check it and try again.' }); }
  const path = url.pathname;

  // The page's scripts: only names in public/js, nothing else on disk.
  const js = path.match(/^\/js\/([a-z]+\.js)$/);
  if (req.method === 'GET' && js && PAGE_JS.includes(js[1])) {
    try { return send(res, 200, await readFile(join(HERE, 'public', 'js', js[1])), 'text/javascript; charset=utf-8'); }
    catch { return send(res, 404, 'missing', 'text/plain'); }
  }
  const wjs = path.match(/^\/js\/web\/([a-z]+\.js)$/);
  if (req.method === 'GET' && wjs && WEB_JS.includes(wjs[1])) {
    try { return send(res, 200, await readFile(join(HERE, 'public', 'js', 'web', wjs[1])), 'text/javascript; charset=utf-8'); }
    catch { return send(res, 404, 'missing', 'text/plain'); }
  }
  const sjs = path.match(/^\/js\/shared\/([a-z-]+\.js)$/);
  if (req.method === 'GET' && sjs && SHARED_JS.includes(sjs[1])) {
    try { return send(res, 200, await readFile(join(HERE, 'public', 'js', 'shared', sjs[1])), 'text/javascript; charset=utf-8'); }
    catch { return send(res, 404, 'missing', 'text/plain'); }
  }
  const css = path.match(/^\/css\/([a-z-]+(?:\/[a-z-]+)?\.css)$/);
  if (req.method === 'GET' && css && PAGE_CSS.includes(css[1])) {
    try { return send(res, 200, await readFile(join(HERE, 'public', 'css', ...css[1].split('/'))), 'text/css; charset=utf-8'); }
    catch { return send(res, 404, 'missing', 'text/plain'); }
  }
  const font = path.match(/^\/fonts\/([a-z-]+\.woff2)$/);
  if (req.method === 'GET' && font && FONTS.includes(font[1])) {
    try { return send(res, 200, await readFile(join(HERE, 'public', 'fonts', font[1])), 'font/woff2'); }
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
    catch (e) { console.error(e); return send(res, 500, { error: 'Switchboard could not take that message: ' + friendlyError(e, 'the sender') }); }
  }

  // A read of the board's data only from its own page (or typed in, or a script with no browser
  // around it): another site cannot even start one, with an <img> or a link (review L1).
  const site = req.headers['sec-fetch-site'];
  if (req.method === 'GET' && path.startsWith('/api/') && site && site !== 'same-origin' && site !== 'none') return send(res, 403, { error: 'Switchboard only shares its data with its own page. Open Switchboard itself and try there.' });

  // Anything that changes state must carry this header. Browsers cannot add it
  // cross-site without a preflight, which this server never approves.
  if (req.method === 'POST' && req.headers['x-switchboard'] !== '1') return send(res, 403, { error: 'Switchboard only takes changes from its own page. Reload Switchboard and try again.' });

  try {
    // Each area of the board answers its own paths (lib/routes/); the first
    // one that responds ends the request.
    const ctx = { req, res, path, url, changed, boardState, clients, PORT, PREFS, agentsNow };
    for (const route of ROUTES) {
      await route(ctx);
      if (res.headersSent || res.writableEnded) return;
    }

    return send(res, 404, { error: 'Switchboard does not have that. Reload the page and try again.' });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: friendlyError(e, 'a service Switchboard uses') });
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
  // Drafts after the mail, so a draft's conversation is known by then (lib/drafts.js).
  const mailAndDrafts = () => pollGmail().then(changed).then(() => readAllDrafts()).then((c) => c && changed()).catch(() => {});
  mailAndDrafts();
  setInterval(() => pollGithub().then(changed), 2 * 60e3);
  // GitHub Actions, live: the folders sessions work in, and a quick check every
  // 10 seconds that only asks GitHub when a run is going or a session's repo
  // may have just been pushed to (lib/github.js).
  let liveBusy = false;
  setInterval(() => { if (liveBusy) return; liveBusy = true; liveGithub().then((moved) => { if (moved) changed(); }).catch(() => {}).finally(() => { liveBusy = false; }); }, 10e3);
  setInterval(mailAndDrafts, 90e3);
  pollMicrosoft().then(changed);
  // Every 30 seconds: three small Graph requests. An open chat is also checked
  // every few seconds on its own (lib/conversation.js, public/js/convo.js).
  setInterval(() => pollMicrosoft().then(feedLinks).then(changed), 30e3);
  currentSha().then(() => checkForUpdate()).then(changed);
  startSync(changed);
  // Shared projects: their repos (names only) from this computer's folders in
  // the project, and what you are working on in it, for the others' Activity:
  // a session's name and state, pushes and pull requests. Never what is in a terminal.
  const projectRepos = (space) => {
    const also = new Set(belongsAll().filter((b) => b.space === space && b.key.startsWith('repo:')).map((b) => b.key.slice(5)));
    return codeFolders().filter((f) => f.kind === 'repo' && f.repo && (spaceFor(f.path, f.name) === space || also.has(f.name))).map((f) => f.repo);
  };
  setRepoSource(projectRepos);
  const ACT = { running: 'working', starting: 'working', waiting: 'waiting', finished: 'done', idle: 'idle' };
  setActivitySource((space) => {
    const repos = new Set(projectRepos(space)), me = ghLogin();
    const sessions = listTerms().filter((t) => t.space === space).map((t) => ({ kind: 'session', name: t.name, state: ACT[t.state] || 'idle', at: t.updatedAt || t.created_at }));
    const code = !me ? [] : github().actions.filter((a) => repos.has(a.fullName)).flatMap((a) => a.runs.filter((r) => r.actor === me && (r.event === 'push' || r.event === 'pull_request'))
      .map((r) => ({ kind: r.event === 'push' ? 'push' : 'pr', repo: a.fullName, branch: r.branch, at: r.createdAt })));
    // One line per push or pull request: the newest run of each.
    const seen = new Set();
    return [...sessions, ...code.sort((x, y) => y.at - x.at).filter((c) => { const k = c.kind + c.repo + c.branch; return !seen.has(k) && seen.add(k); })];
  });
  // Builds and pull requests on those repos, as your GitHub sign-in sees them: published for the web board.
  setCiSource((space, repos) => {
    const want = new Set(repos), gh = github();
    return { runs: gh.runs.filter((r) => want.has(r.fullName)), prs: (gh.sharedPrs || []).filter((p) => want.has(p.repo)) };
  });
  // What else a project has, for the people it is shared with when you give them that kind
  // (each off until you do): browser checks' results, its conversations, calendar events, money, files.
  const lastRun = (c) => c.runs.find((r) => r.state === 'success' || r.state === 'failure' || r.state === 'running');
  setSource('checks', (space) => checksForBoard().filter((c) => c.space === space).map((c) => { const r = lastRun(c); return { name: c.name, state: !r ? 'never' : r.state === 'success' ? 'passed' : r.state === 'failure' ? 'failed' : 'running', at: r?.endedAt || r?.startedAt || null, detail: r?.summary || '' }; }));
  setSource('conversations', (space) => {
    const mail = mailThreads(), m = microsoft();
    const seen = new Set(), list = [...mail.waiting, ...mail.email, ...mail.recent, ...(m.threads || []), ...(m.recent || [])].filter((t) => t.space === space && !seen.has(t.key) && seen.add(t.key)).sort((a, b) => b.date - a.date).slice(0, 15);
    return list.map((t) => {
      const [kind, ...rest] = String(t.key).split(':');
      // Mail is on this computer; a Teams or Outlook conversation goes as its latest message.
      const messages = kind === 'mail' ? threadMessages(rest[0], rest.slice(1).join(':'), 8).reverse().map((x) => ({ from: x.from_me ? 'Me' : x.from_name || x.from_addr, date: x.date, text: x.snippet || '' })) : [{ from: t.who, date: t.date, text: t.snippet || '' }];
      return { key: t.key, kind: String(t.kind || kind).startsWith('voice') ? 'voice' : kind, who: t.who, subject: t.subject, date: t.date, snippet: t.snippet, messages };
    });
  });
  setSource('calendar', (space) => calendarEvents().filter((e) => e.space === space && e.end > Date.now() - 86400e3).slice(0, 60).map((e) => ({ title: e.title, start: e.start, end: e.end, where: e.location || e.where || '', allDay: !!e.allDay })));
  setSource('money', (space) => db.prepare("SELECT kind, text, amount, due_at, cadence, created_at FROM items WHERE space = ? AND kind IN ('bill', 'invoice', 'paid') AND (done_at IS NULL OR kind = 'paid') ORDER BY created_at DESC LIMIT 60").all(space).map((i) => ({ kind: i.kind, text: i.text, amount: i.amount, due_at: i.due_at, at: i.created_at, cadence: i.cadence })));
  setSource('files', (space) => { try { return listFiles(space).map((f) => ({ name: f.name, size: f.size, at: f.at })); } catch { return []; } });
  // Sessions, for the people a project shares them with (lib/share.js live): which sessions run in
  // that project, a session's Chat view (the transcript as the app shows it; never the terminal
  // itself, never keystrokes), and a message to send, which waits in the session's queue as
  // "Jordan asks" until you release it, unless you let that person straight into that session.
  setLiveHandler(makeSessionHandler({ listTerms, termRow, readChat, enqueue, getSetting, setSetting, changed }));
  watchShared(sharedRepos);
  startShares(changed);
  startChat(changed);   // team chat (lib/chat.js): new lines also arrive over the relay
  onUnlocked(() => { restartRelay(); collectWebhooks(changed); changed(); });
  startRelay(changed);
  startWebhooks(changed);
  setInterval(publishTerms, 30e3);
  // A checkout with automatic updates on (Settings, About) updates itself when it is safe;
  // the app does the same through its reports (lib/routes/system.js).
  setInterval(() => checkForUpdate().then((u) => { changed(); if (u.behind && !u.app && autoUpdateOk(PREFS)) applyUpdate().catch(() => {}); }), 30 * 60e3);
  setInterval(() => deliver().then((n) => n && changed()).catch(() => {}), 5e3);
  // Agents without hooks: watch their screens, and tell the page when one goes busy or quiet.
  let lastStates = '';
  setInterval(() => {
    sampleActivity();
    const sig = listTerms().map((t) => t.id + t.state).join('|');
    if (sig !== lastStates) { lastStates = sig; changed(); publishTerms(); }
  }, 2e3);
  setInterval(tickReminders, 15e3);
  // Jarvis's nightly tidy of what he knows (lib/jarvismemory.js): checked each hour, never starts LM Studio.
  // A local model LM Studio has let go of but whose process lingers on the graphics card: stopped (lib/jarvis.js).
  setInterval(() => sweepModels().catch(() => {}), 2 * 60e3);
  // Switchboard's own model (lib/engine.js): one left running across a restart is taken over; it stops after its idle minutes.
  engine.adopt().catch(() => {});
  setInterval(() => engine.sweep().then((c) => c && changed()).catch(() => {}), 60e3);
  // Past Local AI chats clear themselves after 30 days (lib/localchats.js).
  const sweepLocalChats = () => { try { if (sweepChats()) changed(); } catch (e) { console.warn('[localchats]', e.message); } };
  sweepLocalChats(); setInterval(sweepLocalChats, 60 * 60e3);
  setInterval(() => { if (tidyDue()) tidyNow({ wake: false }).catch((e) => console.warn('[jarvis] tidy', e.message)); }, 60 * 60e3);
  // Codex's plan limits, from its newest session log (Claude Code's come with its status line).
  readCodexLimits(); setInterval(() => { if (readCodexLimits()) changed(); }, 5 * 60e3);
  // Models on this computer (Ollama, LM Studio): a quick look now and every minute.
  pollLocalAI().then((c) => c && changed()).catch(() => {});
  setInterval(() => pollLocalAI().then((c) => c && changed()).catch(() => {}), 60e3);
  // Task apps (Todoist): soon after start, then every 5 minutes.
  setTimeout(() => pollTasks().then((c) => c && changed()).catch(() => {}), 8e3);
  setInterval(() => pollTasks().then((c) => c && changed()).catch(() => {}), 5 * 60e3);
  // Granola meeting notes into Notes (lib/granola.js): soon after start, then every 10 minutes.
  setTimeout(() => pollGranola().then((c) => c && changed()).catch(() => {}), 20e3);
  setInterval(() => pollGranola().then((c) => c && changed()).catch(() => {}), 10 * 60e3);
  // Your mail tracker (lib/mailtrack.js): opens and clicks every two minutes, and the incoming mail just read.
  pollMailtrack().then((c) => c && changed()).catch(() => {});
  setInterval(() => pollMailtrack().then((c) => c && changed()).catch(() => {}), 2 * 60e3);
  // Project dashboards' website checks that are due (lib/dashboard.js): hourly look, each site on its own schedule.
  setInterval(() => dueChecks(changed).catch(() => {}), 60 * 60e3);
  // Flips (lib/flips.js): eBay every five minutes or so (a good listing goes
  // fast; a new deal is an alert; ebayDue spaces the looks under eBay's daily
  // limit), auction sites' alert emails every 10 minutes, GSA's surplus list
  // every half hour (hourly on the shared key). None runs
  // until set up.
  const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
  const flipAlert = (fresh) => {
    const where = { misspelled: ' (misspelled)', pickup: ' (pickup near you)', ending: ' (auction ending)' };
    const worth = fresh.filter(alertable).sort((a, b) => b.hot - a.hot);
    for (const d of worth.slice(0, 3)) {
      const what = d.auction ? `bid up to ${money(d.bidTo)}${d.endsAt ? `, ends ${new Date(d.endsAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ''}` : `${money(d.total)}, about ${money(d.v.profit)} profit after fees`;
      alert('flips', `${d.hot ? 'Hot deal' : 'Deal'}${d.how === 'alert' ? ` on ${d.sourceName}` : where[d.how] || ''}: ${d.name.slice(0, 60)}`, `${what}; sells for about ${money(d.sells)}`);
    }
    if (fresh.length) changed();
  };
  const gsaAlert = (c) => { for (const l of takeGsaNews().slice(0, 2)) alert('flips', `Surplus lot near you: ${l.name.slice(0, 60)}`, `${l.city}, ${l.state}; matches ${l.hits.join(', ')}; ${l.bid ? money(l.bid) + ' bid' : 'no bids yet'}`); if (c) changed(); };
  setTimeout(() => { pollGsa().then(gsaAlert).catch(() => {}); pollEbay().then(flipAlert).catch(() => {}); }, 40e3);
  setTimeout(() => pollAuctions().then(flipAlert).catch(() => {}), 120e3);
  setInterval(() => { if (ebayDue()) pollEbay().then(flipAlert).catch(() => {}); }, 60e3);
  setInterval(() => pollAuctions().then(flipAlert).catch(() => {}), 10 * 60e3);   // auction sites' alert emails (lib/flipmail.js)
  setInterval(() => pollGsa().then(gsaAlert).catch(() => {}), 30 * 60e3);
  // News and blogs: soon after start, then every 30 minutes (feeds change slowly).
  setTimeout(() => pollFeeds().then((c) => c && changed()).catch(() => {}), 20e3);
  setInterval(() => pollFeeds().then((c) => c && changed()).catch(() => {}), 30 * 60e3);
  pollCalendars().then((c) => c && changed());
  setInterval(() => pollCalendars().then((c) => c && changed()), 10 * 60e3);
  setInterval(() => pollCalendars({ only: 'google' }).then((c) => c && changed()), 60e3);   // Google every minute: a change on the phone shows here soon
  setInterval(tickEvents, 30e3);
  pollWeather().then((c) => c && changed());
  setInterval(() => pollWeather().then((c) => c && changed()), 30 * 60e3);
  setInterval(tickWindows, 3e3);
  setInterval(changed, 60e3);   // keeps "4 min ago" honest
}
