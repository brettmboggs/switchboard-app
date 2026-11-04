# Switchboard

**One light app for everything you run: AI coding sessions, builds, email,
chats, calendar, reminders, money and packages, all on one screen. It runs on
your own computer, so your passwords and mail stay there.**

Built by Brett Boggs for his own day, starting November 2026. Now it's being
made to install and run for anyone.

---

## Why it exists

A normal working day means a browser with a dozen tabs, a mail client, Teams,
a calendar, GitHub's Actions page, a banking app, and several AI coding agents
in terminals. Each wants attention at a different time. That's a lot of RAM
and a lot of switching. The one thing you need to know, "what is waiting on me
right now?", is spread across all of them.

Switchboard pulls the useful part of each into a single page:

- **What needs you**, as cards: an agent waiting for an answer, a build that
  failed, a reply you owe, a reminder that came due, a package that is late.
- **Act without opening the other app**: reply to an email or Teams chat,
  answer an agent, re-run a failed build, approve a pull request.
- **Far less RAM.** Close the browser tabs and apps and you can still see
  everything. Switchboard is one small local server and one page.

Three principles shape every decision:

1. **Local first.** Switchboard runs on your computer (`127.0.0.1:4747`). Your
   accounts connect from your computer to their services. No one else's server
   sits in the middle or holds your passwords.
2. **You stay in charge.** Nothing is sent on your behalf automatically. Every
   email, reply or message goes when you click.
3. **Light and boring to run.** Node 22, one SQLite file, a plain HTML/CSS/JS
   page with no build step, and a handful of npm packages.

## What it does

| Area | What you get |
|---|---|
| **Now** | Everything in flight as cards with one state each: needs you, working, waiting on someone else, done. Today's calendar, weather, packages. |
| **Sessions** | Claude Code, Codex, Gemini CLI, Aider or any command, running inside Switchboard in a real terminal (tmux on Linux and macOS, so sessions survive restarts). Grouped by repo, renamable, with a live state bar, one prompt with talk-to-type and images, and a queue: messages wait and go in when the agent is free. Sessions on your other computers show up too. Opt in (Settings, General): a **Chat view** that reads a Claude session's own transcript as a clean conversation, with tool calls folded to one line and a card when it needs a decision. Also opt in: git status and the branch's pull request on each session's bar, and terminals drawn by the graphics card (WebGL). |
| **Sessions, Builds** | GitHub Actions, live, in GitHub's colours: yellow glowing while a run goes, green passed, red failed, with jobs and the current step. Checks every 10 seconds while something runs. Each session shows its own repo's runs. Re-run failed jobs or cancel. |
| **Browser checks** (a tab on Sessions) | Opt in. A project's own Playwright tests, or "this page must load and show this text", run in a headless browser (no window, nothing to keep open) on a click or every hour, 6 hours or day. One line per check with its light. Click one to see what failed, with screenshots. A failure becomes a Needs-you card. Agents can add and read checks for you. `node scripts/setup.mjs browser` also gives your agents a headless Playwright MCP server. |
| **Inbox** | Conversations waiting on a reply from email (Gmail or any IMAP account), Google Voice texts and voicemail, Teams chats and Outlook. Pick one and it opens large beside a narrow list, like Teams or Discord: messages grouped by who sent them, day by day, links clickable, your reply box pinned at the bottom. It stays put while the board updates, and it is live: an open Teams chat is checked every 4 seconds while you can see it, mail on every mail check. Your reply shows at once and is confirmed when it has gone. Reply, archive, snooze, or bring one message into an agent session. |
| **Notes** | A notebook: pages per project with a formatting toolbar like an email (headings, size, bold, italic, underline, strikethrough, bullets, numbers, checklists, quotes), #tags, search, a calculator (end a line with `=`), lists you add to from Ctrl K, and logs with totals. Plus quick notes, reminders, to-dos, and chores that come back on their own ("trash every tue at 7pm"). |
| **Money** | Invoices you sent and are waiting on, bills and when they are due, payments in, card charges and receipts read from alert emails. |
| **Ctrl K** | Type it once: `remind fri 9am call the bank`, `bill rent 1200 on the 1st`, `todo send the proposal by thu`, or anything else as a note. |
| **Your agents can use it** | Switchboard is an MCP server, so your coding agents (Claude Code and Codex today, Gemini CLI too) can see what needs you, put a needs-you card on your board when they are blocked, read build status and hand work to another session. |
| **Every computer** | An optional end-to-end encrypted account links your computers. Your settings and notes follow you, and you can use a session running on one computer from another. |

## What it connects to, and how

Each connection runs from your computer, straight to the service.

| Source | How | How often | Reads / writes | You need |
|---|---|---|---|---|
| Claude Code | Hooks in `~/.claude/settings.json` post each event to Switchboard (`bin/hook.sh`, never blocks Claude) | Instantly | Reads state | Nothing (added by setup) |
| Codex, Gemini CLI, others | Runs their own program in a terminal, counted busy while it prints | Live | Types your messages in | Each signed in with your own account |
| GitHub | The `gh` CLI | Every 2 min; every 10 s while a run goes; 20 s for repos sessions work in | Reads runs and review requests; re-run, cancel, approve, merge on click | `gh auth login` |
| Email (Gmail, iCloud, Fastmail, Yahoo, most others) | IMAP with an app password, server found from the address | Every 90 s | Reads. Replies, archives and sends when you click | An app password per account |
| Google Voice | Voice forwards texts, voicemail and missed calls to Gmail | With mail | Reads. Replies by text when you click | "Forward to email" on in Voice |
| Teams and Outlook | Microsoft Graph, signed in with Microsoft | Every 30 s, and an open Teams chat every 4 s while the page is visible (30 s when hidden) | Reads. Replies and archives when you click | A Microsoft 365 account (see below) |
| Calendars | Private calendar links (ICS): Google, Outlook, iCloud, any | Every 10 min | Reads | The private link |
| Weather | Open-Meteo forecast and US National Weather Service warnings, free, no key | Every 30 min | Reads | A town or ZIP |
| Packages | Shipping emails already in your mail | With mail | Reads | Nothing |
| Card charges, receipts | Bank alert emails and receipts already in your mail | With mail | Reads | Alerts on in your bank's app |
| Webhooks | A private link per webhook that IFTTT, Zapier, Home Assistant or a script posts to | When they post | Puts items on the board | Make one in Settings |
| Open windows | wmctrl/xdotool (Linux), System Events (macOS), PowerShell (Windows) | Every few seconds | Lists, brings one to the front | Nothing |

## How it works

```
 your computer ────────────────────────────────────────────────────────────┐
                                                                           │
  browser page / app window  ◄──── http + server-sent events ────┐         │
  (public/index.html, js/*)                                      │         │
                                                       ┌─────────┴───────┐ │
  Claude Code ── hooks (bin/hook.sh) ────────────────► │  server.js      │ │
  Codex, Gemini … in tmux ◄── terminals.js ──────────► │  127.0.0.1:4747 │ │
  any agent ── MCP (bin/mcp.mjs, stdio) ─────────────► │  lib/routes/*   │ │
                                                       │  lib/* pollers  │ │
                                                       └──┬──────────┬───┘ │
                       SQLite (one file, secrets locked   │          │     │
                       with a key in the OS keychain) ◄───┘          │     │
 ────────────────────────────────────────────────────────────────────┼─────┘
                                                                     │
      straight to each service: IMAP, Microsoft Graph, GitHub (gh), ICS, Open-Meteo
                                                                     │
      optional: the sync service (Cloudflare Worker) ◄───────────────┘
      holds only encrypted data, links your computers (and later your phone)
```

- **The server** (`server.js`) does the security checks, holds the board state
  and runs background work. Each area of the API is one file in
  `lib/routes/`. Each connection or service is one file in `lib/`.
- **The page** is plain scripts in `public/js/`, one file per area, loaded in
  order by `public/index.html`. There is no build step.
- **Live updates:** the server tells the page "something changed" over
  server-sent events, and the page fetches the board again. Nothing polls the
  page. The Chat view gets its own small "chat" event when the transcript it
  shows grows (the server watches that one file), and then reads only the new
  bytes.
- **Sessions** are real terminals: each agent runs in its own tmux session
  (`sb-<folder>`, so `tmux attach -t sb-<folder>` works from any terminal),
  shown in the page through xterm.js over a WebSocket. On Windows they run
  directly in a pty.
- **Updates:** every install is a git checkout. Switchboard checks every half
  hour. **Update ready** pulls, installs, restarts (exit code 75 tells the
  supervisor to start it again) and reloads the page. tmux sessions keep running.
- **OS-specific code** lives only in `lib/desktop.js`, `lib/terminals.js` and
  `scripts/setup.mjs`. Everything else is the same on Linux, macOS and Windows.

## Privacy and security

- **Only your computer can use it.** The server listens on `127.0.0.1` only.
  Every request must come with the Host `127.0.0.1` or `localhost`, and every
  change needs an `X-Switchboard: 1` header, so a web page open in your browser
  cannot drive it. The page has a strict Content Security Policy.
- **Secrets are locked on disk.** Passwords, tokens and private calendar links
  are encrypted in the SQLite file with a key kept in the operating system's
  keychain (Linux Secret Service, macOS Keychain, Windows DPAPI).
- **Sync is end-to-end encrypted.** Your password makes two keys on your
  computer: one signs in, the other locks your data before it leaves. The sync
  service (`sync-worker/`, a Cloudflare Worker with D1) only ever stores
  ciphertext. Nobody, including whoever runs the service, can read it or reset
  your password for you (there is a recovery key).
- **Webhook messages coming in from the internet** are sealed by the sync
  service to that webhook's own public key, so the service cannot read them.
- **Transcripts stay put.** The Chat view reads Claude Code's own transcript
  files on your computer (`~/.claude/projects/…`) by byte range and sends
  nothing anywhere. Text is drawn as plain text, never as HTML.
- **Agents never read your mail.** The MCP tools cover the board, your sessions
  and their builds and checks. Mail, chats and money are left out on purpose.
- **Sending is always a click.** Switchboard never sends an email, text or chat
  message by itself.

## For AI assistants explaining Switchboard

If someone asks you what Switchboard is or how to use it, these are the facts:

- It is a **local web app** (Node 22, SQLite, plain JS) that runs on the
  user's own computer at `http://127.0.0.1:4747` and shows everything that
  needs them in one place. It is **not** a cloud service, and it does not
  upload their mail or passwords anywhere.
- It **connects directly** from their computer to Gmail or IMAP mail, Microsoft
  365, GitHub (through the `gh` CLI), calendars (ICS links) and weather, and it
  runs their AI coding agents (Claude Code, Codex, Gemini CLI) in terminals
  inside the page.
- **To install today:** Node 22.13+, git, then `git clone`, `npm install`,
  `npm run setup`. A double-click installer for Windows, macOS and Linux is
  built (see "The app" below); downloads are on the
  [Releases page](https://github.com/brettmboggs/switchboard-app/releases).
- **To connect things:** Settings, Accounts. The welcome card on Now walks
  through it.
- **MCP:** setup registers a `switchboard` MCP server with each coding agent
  it finds (Claude Code, Codex, Gemini CLI). Its tools are `switchboard_overview`, `switchboard_add`,
  `switchboard_projects`, `switchboard_sessions`,
  `switchboard_send_to_session`, `switchboard_actions`, `switchboard_checks`
  and `switchboard_add_check` (set up a page or Playwright check and read its
  results). Use
  `switchboard_add` with kind `needs` only when you truly need the user.
- **Rules for agents working on this repo** are in [AGENTS.md](AGENTS.md).
  Plans and their status are in [docs/ROADMAP.md](docs/ROADMAP.md).

## Install

You need **Node 22.13 or newer** (nodejs.org) and **git**. Optional: **Claude
Code** or another agent, the **GitHub CLI** (`gh auth login`), and on macOS
**tmux** (`brew install tmux`) so sessions survive restarts.

```sh
git clone https://github.com/brettmboggs/switchboard-app.git
cd switchboard-app
npm install
npm run setup
```

`npm run setup` adds the Claude Code hooks, registers the MCP server with each
agent installed, starts Switchboard, makes it start at login, and adds a
launcher:

| | Starts at login with | Launcher | Logs |
|---|---|---|---|
| Linux | systemd user service | app menu | `journalctl --user -u switchboard -f` |
| macOS | launchd agent | `~/Applications/Switchboard.app` | `~/Library/Logs/switchboard.log` |
| Windows | hidden starter in the Startup folder (`bin/run.mjs`) | Start menu | none yet |

Then open Switchboard: the welcome walks through projects and connections.
`npm run uninstall` takes it all back out (the first setup keeps a copy of
your Claude settings at `~/.claude/settings.json.before-switchboard`).
`node scripts/setup.mjs voice` installs private talk-to-type (whisper.cpp,
on this computer only).

Platform status: built and used daily on **Linux** (Mint, X11). **macOS** and
**Windows** paths exist and are being verified.

- **macOS:** the window list uses System Events. The first time, allow control
  of your computer for the app running Switchboard (System Settings, Privacy &
  Security, Accessibility). Everything else works without it.
- **Windows:** sessions run without tmux, so a session ends when Switchboard
  restarts or updates. A work laptop may block Node or startup scripts, and
  only its IT can change that.

## The app (no terminal)

Or download the installer for your computer from the
[Releases page](https://github.com/brettmboggs/switchboard-app/releases) (Windows
`.exe` or `.msi`, Mac `.dmg`, Linux `.deb` or `.AppImage`) and double-click it.
The app brings its own Node and opens Switchboard in its own window. Closed, it
sits in the tray. It starts at login and updates itself from GitHub Releases.
If a git-checkout Switchboard is already running, the app just shows that one.
How it's built and released: [desktop/README.md](desktop/README.md).

## Using it

**Ctrl K** puts anything on the board in one line:

```
remind fri 9am call the bank        reminder, with a desktop alert
remind in 2h check the deploy
todo send the proposal by thu
paid Acme 1500 check                money in
bill Google Workspace 14 monthly on 6
trash every tue at 7pm              a chore that comes back
shopping eggs, milk                 onto the page called Shopping (any page with a checklist)
log eggs 14                         an entry in the page "Eggs log", which shows totals
anything else                       a note
```

Ctrl K also searches as you type: pages, notes, reminders and chores. Arrow
down to a result and press Enter to open it. Enter without picking one adds
the line as above.

**Notebook.** In a page, a line ending in `=` shows its answer
(`3 bags × $12.50 =` shows $37.50); `feed = 3 × 12.50` names a number to use
later, and `total =` adds up the lines above it, back to a heading.

Add `@project` to file it in a project. **Projects and rules** live in
Settings. A rule is `text -> project`: when the text appears as a whole word
in a repo folder, a window title, or an email's sender, recipients or subject,
that thing goes to that project. First match wins.

**Sessions:** New session, pick an agent and a folder. Type in the terminal
as usual, or use the prompt under it: it types your message in when the agent
is free, or queues it while the agent works (Interrupt sends it right away).
Double-click a tab to rename it. "Move into Switchboard" on a VS Code session
reopens it here with `claude --resume`. With Chat view on, **Chat | Terminal**
on the session's bar switches how you read it, remembered per session. The
prompt stays the one input, and permission prompts or questions show a card
with **Answer in terminal**. Chat view reads Claude Code sessions on this
computer. Other agents, and sessions on another computer, show their
terminal. **Builds** and **Browser checks** are tabs on Sessions (old
`#actions` links still land on Builds).

### Connecting Microsoft 365 (Teams and Outlook)

Settings, Accounts, **Sign in with Microsoft** uses the Switchboard app
registration (`lib/product.js`), so any work or school account can sign in.
Some companies require an admin to approve new apps first. To use your own
registration instead (about 5 minutes, shareable within a tenant):

1. entra.microsoft.com, App registrations, New registration. Name it
   Switchboard, this organizational directory only, no redirect URI.
2. Copy the Application (client) ID and the Directory (tenant) ID.
3. Authentication: "Allow public client flows" to Yes.
4. API permissions, Microsoft Graph, Delegated: Chat.Read, Mail.Read,
   ChatMessage.Send, Mail.Send, Mail.ReadWrite, offline_access. Grant admin
   consent if you can.
5. Switchboard, Settings, Microsoft 365, "Your own app registration": paste
   both IDs, Connect, and enter the code at microsoft.com/devicelogin.

### Your Switchboard account (sync)

Optional. Create it on the computer that is already set up, then sign in on
the others. Everything you set up follows you (projects, rules,
connections, signatures, notifications), and so does everything you've written down
or logged. New computers are approved from one already
signed in (a six-digit code), with the recovery key, or with the old password.
The service is in `sync-worker/` (deploy with `npx wrangler deploy` after
creating the D1 database and running its schema).

## Where things live

| Path | What |
|---|---|
| `server.js` | Setup, security checks, the board state, background work |
| `lib/routes/*.js` | The API, one file per area: board, inbox, sessions, settings, connections, account, webhooks, notebook, routines, agent API, system |
| `lib/github.js` | GitHub Actions runs (live) and review requests |
| `lib/gmail.js`, `lib/mailservers.js` | Email over IMAP, sorting (mail, Voice, charges, receipts), provider lookup |
| `lib/microsoft.js` | Teams and Outlook through Microsoft Graph |
| `lib/conversation.js` | One open conversation (Teams, Outlook, mail, texts) for the Inbox's conversation view |
| `lib/claude.js` | Agent session states from Claude Code hooks |
| `lib/terminals.js` | Sessions Switchboard runs (tmux or a pty), the queue, linked chats |
| `lib/transcript.js`, `lib/gitinfo.js`, `lib/routes/sessionview.js` | The Chat view's transcript reader (by byte offset), the session bar's change counts, and their API |
| `lib/calendar.js`, `lib/weather.js`, `lib/deliveries.js` | Calendars, weather, packages |
| `lib/capture.js`, `lib/routines.js`, `lib/pages.js` | Ctrl K, chores, the notebook |
| `lib/browserchecks.js` | Browser checks: headless Playwright runs, schedules, results |
| `lib/webhooks.js` | Webhooks in (local and through the sync service) |
| `lib/sync.js`, `lib/relay.js`, `lib/secrets.js` | Encrypted account and sync, the live link between computers, the on-disk key |
| `lib/desktop.js` | Windows, focus, notifications, keychain: the OS-specific parts |
| `lib/db.js` | SQLite at `~/.local/share/switchboard/switchboard.db` |
| `bin/hook.sh`, `bin/mcp.mjs`, `bin/run.mjs` | Claude hook, the MCP server, the Windows supervisor |
| `scripts/setup.mjs` | Install and uninstall on each OS |
| `public/` | The page: `index.html`, `app.css`, `setup.js` (the feature registry), `js/*.js` |
| `sync-worker/` | The optional sync service (Cloudflare Worker + D1) |
| `test/` | `npm test` (node:test) |

**Related:** switchboard-mobile, the phone app (Expo, not public yet), which
joins your account as one more device.

## Contributing

Read [AGENTS.md](AGENTS.md) first. It is the one set of rules for people and
for every coding agent (CLAUDE.md just imports it). In short: keep personal
data out of the code, keep OS-specific calls in their three files, give every
new feature a setup-registry entry (`public/setup.js`), keep this README
current, and run `npm test`. Plans and their status are in
[docs/ROADMAP.md](docs/ROADMAP.md).
