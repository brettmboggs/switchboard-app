# Switchboard

<!-- pitch:start (made by npm run pitch from docs/headlines.json; edit that) -->

**One screen for everything that wants your attention: your AI coding agents, builds, email, Teams, calendar, bills and packages.**

Anything that needs you turns orange, and you can answer it right there without opening the other app. It runs on your own computer: your passwords and mail never pass through anyone else's server, and nothing is ever sent without your click.

**What makes it different**

- **Orange means it needs you.** An agent waiting for an answer, a build that failed, a reply you owe, a bill due, a late package, the chickens to feed: one board, one colour for "you". Everything else stays quiet, so a glance tells you whether you can keep working.
- **Your AI agents live inside it.** Claude Code, Codex, Gemini and local models run inside Switchboard, and a Claude session reads like a clean chat: its permission prompts and multiple-choice questions are buttons, messages queue while they work, any file they mention opens with a click, and the bar shows the model, how much context is used and what it has cost so far.
- **Your agents can talk back.** Switchboard is an MCP server, so the agents themselves can read your board: what needs you, how the builds are doing. A stuck agent puts a card on your board instead of sitting silently in a terminal, and one session can hand work to another.
- **Work finds the session it is about.** A Teams message or email about a project shows up beside the coding session for that project. One click puts it into what you send the agent, with who sent it and when. A notes page goes in the same way.
- **Reply without opening the other app.** Gmail, any other mail account, Teams, Outlook and Google Voice texts in one Inbox that reads like a chat app. Reply, archive or snooze from there, and close the dozen tabs: you still see everything.
- **Every computer, one board.** Sign in on each computer and every session shows on all of them. Open a session running on your desktop from your laptop and it is a chat there too, questions and all. Settings and notes follow you, end-to-end encrypted.
- **Private, light and yours.** One small local server, one SQLite file and a plain web page, using far less memory than the browser tabs and apps it replaces. No middleman server, no subscription, and nothing sent on your behalf: every email and message goes when you click.

The short version, with every feature listed and a 20-second demo for each of these: [docs/PITCH.md](docs/PITCH.md).

<!-- pitch:end -->

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
| **Calendar** | A month of everything on your connected calendars, with a day opened underneath: times, places, and which calendar. It opens from **Calendar** on Now's Today line (or G then C); it has no place on the rail. It reads the same calendars as Now (private links, or iCloud, Fastmail and Yahoo through your email account) and asks each only when you look, keeping the answer five minutes. **Google Calendar** signs in with one button (Settings, Connections, Calendars): Google's own page opens in a new tab and you sign in there; Switchboard keeps only a refresh token, locked on this computer, and never sees your password. Then **Add event**, and click an event to change or delete it; every change is your click on Save or Delete. Calendars added by link, iCloud or Fastmail stay read only for now. Repeating events: a change affects that one occurrence. For a copy of Switchboard to offer the Google button it needs the app's Google client: the id is in `lib/product.js`, the secret is read from `~/.config/switchboard/google-client.json` (`{"clientId", "clientSecret"}`, mode 0600) or `SWITCHBOARD_GOOGLE_CLIENT_SECRET`, and is not kept in the repository. |
| **Now** | Everything in flight as cards with one state each: needs you, working, waiting on someone else, done. Today's calendar, weather, packages. Until noon, a **morning rundown** at the top: the day in one sentence (meetings, what needs you, bills this week, packages, routines), four figures, the schedule beside the lists, and Read aloud with a voice on your computer. |
| **Sessions** | Claude Code, Codex, Gemini CLI, Aider or any command, running inside Switchboard in a real terminal (tmux on Linux and macOS, so sessions survive restarts). Grouped by repo, renamable, with a live state bar, one prompt with talk-to-type and images, and a queue: messages wait and go in when the agent is free. Sessions on your other computers show up too. Claude sessions (and Codex and local model sessions) open as a **chat**: the session's own transcript as a clean conversation with one message bar, tool calls folded to one line, what it is doing while it works, and its permission prompts and questions as buttons. New session picks the model (Sonnet, Opus, Haiku, 1M context) and effort, remembered per folder; typing `/` in the message bar lists Claude's commands and the folder's skills with what each does, and `/model` opens Claude's picker as buttons; the session's bar reads its model, effort, context used and cost live ("Opus 5.5 · high · 39% · $0.42"). Files the agent names are links when they exist on this computer, in Chat and in Terminal view alike: a click shows a document as a page, code with the named line lit, or a picture, with Open (its own app) and Show in folder; pictures it sends show in the chat. A session on your other computer works too: that computer sends the file over, and Open stays on that computer. Only files in your home, temp or the session's folder, never keys or secrets, and a script is only ever shown in its folder, never run. Opt in (Settings, General): git status and the branch's pull request on each session's bar, and terminals drawn by the graphics card (WebGL). Under a session's messages, its project's notes (and those tied to its repo): Add to message puts a page, or one section of it, in what you are writing. The folder picker for a new session lists your repos first, then folders that are not repos and agents' side copies in groups of their own. |
| **Sessions, Builds** | GitHub Actions, live, in GitHub's colours: yellow glowing while a run goes, green passed, red failed, with jobs and the current step. Checks every 10 seconds while something runs. Each session shows its own repo's runs. Re-run failed jobs or cancel. |
| **Browser checks** (a tab on Sessions) | Opt in. A project's own Playwright tests, or "this page must load and show this text", run in a headless browser (no window, nothing to keep open) on a click or every hour, 6 hours or day. One line per check with its light. Click one to see what failed, with screenshots. A failure becomes a Needs-you card. A project's tests can run **signed in** to a site that needs it: you press Sign in, a normal browser window opens on your computer, and you sign in yourself on the site's own page (including any code or MFA). Give the address of the site you are testing: Done saves only once the window is back on that site, which is when its own sign-in tokens exist. Switchboard never sees, types or asks for a password, code or answer; it keeps only the browser's sign-in state in a file only your account can read (`~/.config/switchboard/auth/<check id>.json`, mode 0600), outside every project, never logged, never shown on the page or to an agent, and never sent anywhere. The test command gets its path in `SB_AUTH_STATE`, only for that check. If the sign-in runs out, the test prints a line with `SIGNIN_EXPIRED`; the check pauses (it never retries by itself) and a Needs-you card asks you to sign in again. Sign out, removing the check, or changing its folder or sign-in page deletes the file. Agents can add and read checks for you (they can name the sign-in page, but only you can sign in). `node scripts/setup.mjs browser` also gives your agents a headless Playwright MCP server. |
| **Inbox** | Conversations waiting on a reply from email (Gmail or any IMAP account), Google Voice texts and voicemail, Teams chats and Outlook. Pick one and it opens large beside a narrow list, like Teams or Discord: messages grouped by who sent them, day by day, links clickable, your reply box pinned at the bottom. It stays put while the board updates, and it is live: an open Teams chat is checked every 4 seconds while you can see it, mail on every mail check. Your reply shows at once and is confirmed when it has gone. Reply, archive, snooze, or bring one message into an agent session. |
| **Drafts** | Your email drafts, including ones an assistant writes for you through your Gmail, show in Inbox: one that answers a conversation sits at the bottom of it, marked Draft; the rest are listed at the top of Inbox. **Edit** opens To, Cc, Subject and the text; **Send** sends it in its thread, **Save draft** puts the new version back in your Drafts (so Gmail on your phone shows the same), **Discard** moves it to your mail's Trash. Read from the Drafts folder with the rest of your mail; nothing is sent until you press Send. |
| **Notes** | A notebook: pages per project with a formatting toolbar like an email (headings, size, bold, italic, underline, strikethrough, bullets, numbers, checklists, quotes), a mic that types where the caret is, #tags, search, a calculator (end a line with `=`), lists you add to from Ctrl K, logs with totals, and `today …` for a timed line on the day's page. Send to session sends a whole page, the text you selected, or the line you are on (or a quick note) to a session: you see exactly what goes, can change it, and can add a line saying what to do with it. Plus quick notes (with a mic), reminders, to-dos, and chores that come back on their own ("trash every tue at 7pm"). |
| **Projects** (on the left) | Each client, business or part of life has its own page: what is in flight there, its conversations, sessions, notes and files (drop them on the page, any type up to 1 GB; they stay on this computer), and on the side what you do for them, the people with their email and phone (with everyone you have written to in that project's mail offered under Found in your mail: Add or Hide), and links to their site, its admin, the repo and anything else you open for them. To narrow a list to one project, use the picker at the top of Now, Sessions, Inbox, Money or Notes. **In this project**, at the top of each project's page, shows everything that belongs to it, by kind: repos and folders, people, addresses and Teams chats, and pages or single sections of pages. **Add to this project** searches everything Switchboard knows. Anything can belong to more than one project. A note can be tied to one repo, so it shows only beside that repo's sessions. **Unsorted**, under the projects on the left, lists the repos, folders, people and chats with no project yet, with the likely project to file each in one click. **Hide** takes clutter (folders that are not repos, a sender) out of every list and the session folder picker, without deleting anything; Show them brings it back. |
| **Reading** (a tab on Inbox) | News and blogs you follow (RSS and Atom; type a site and its feed is found, and a news page with no feed, such as anthropic.com/news, is watched for new article links instead), newest first, unread in bold, kept 30 days. Never on Now and never orange: reading is for when there is time. Only each post's title, link, date and a short plain-text summary are kept; a post's own HTML is never shown. |
| **Money** | Invoices you sent and are waiting on, bills and when they are due, payments in, card charges and receipts read from alert emails. **Recurring costs**: rent, hosting, software, insurance, each with how often and its project, totalled per month and per year and split by project (each project's page shows its own); charges in your email that come back like a subscription are offered with Add or Not recurring. No bank connection needed. |
| **Local AI models** (Settings, Connections) | Run models on this computer with Ollama: install it, get a starter model and start it as a session (New session, Agent: Local model), all from Switchboard. Private, free, works offline. If you use LM Studio, the models you downloaded there start as sessions too (Agent: Local model (LM Studio)). A local model session reads like a chat, the same as a Claude session: Switchboard's own small chat program (`bin/localchat.mjs`) talks to the model through Ollama's or LM Studio's server on this computer, starts that server if it is not running, keeps the conversation in a file in Switchboard's data folder, and the terminal shows it too. llama.cpp's server and Jan are listed when they run. Only `127.0.0.1` is ever asked. |
| **System monitor** (Settings, System) | How busy this computer is, live: processor (and each thread), memory split into in use, cached and free, graphics, network speed, storage left, temperatures and fans where the computer shares them, and the apps using the most (grouped, sortable, searchable). A line at the top says in words what is straining ("Memory is 93% full; Chrome holds 6.0 GB"). Charts keep two minutes. Linux, macOS and Windows; it reads numbers only while it is open, keeps no history, sends nothing, and never asks for admin rights. |
| **Files and pictures** | Drop, paste or pick any file: into a session's message bar (it goes to the agent as the file's location, so Claude Code and Codex can open pictures, PDFs, spreadsheets or code), onto a session's terminal (its location is typed at the cursor), into a note (a picture shows in the page, anything else is a link that downloads it), or onto a project's page. Up to 1 GB each, written straight to disk. They stay on the computer they were added on: synced notes show a picture only there. Pictures show inside Switchboard; every other type only ever downloads, so a dropped web page cannot run in it. |
| **Keyboard** | `?` lists every shortcut; G then a letter goes to a page (G I for Inbox); `,` opens Settings. In the Switchboard app, Ctrl+Q quits it like any app (Cmd+Q on a Mac); your sessions keep running. In a Claude session's terminal, Shift+Enter starts a new line and Ctrl+Enter sends now, even while Claude is working (the keys Claude Code itself uses: Ctrl+J, and Ctrl+X Ctrl+S). |
| **Ctrl K** | Search everything, and type it once. A few letters find sessions (on every computer), people on your projects' pages, emails (any age, from people) and Teams chats, calendar events (a month back, two ahead), money (bills, invoices, payments, charges and receipts), notebook pages, notes, reminders, projects, and Switchboard's own features ("monitor" finds the System monitor); arrow down and Enter opens one. It searches only what is already on this computer. Or type `remind fri 9am call the bank`, `bill rent 1200 on the 1st`, `todo send the proposal by thu`, or anything else as a note. |
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
| Calendars | Private calendar links (ICS): Google, Outlook, iCloud, any. iCloud, Fastmail and Yahoo also straight from the email account (CalDAV): tick the calendars, no link | Every 10 min | Reads | The private link, or the mail's app password (sent only over https to that provider) |
| Todoist | Todoist's API v1 with your personal API token (Todoist, Settings, Integrations, Developer); the token is locked on disk with this computer's key | Every 5 min | Reads tasks due today or overdue. Closes one when you click Done | A Todoist account (free) |
| Trello | Trello's REST API with an API key (trello.com/power-ups/admin) and a token you allow on Trello's own page; both locked on disk | Every 5 min | Reads cards on your boards with a due date of today or earlier, not complete. Marks the due date complete when you click Done | A Trello account (free) |
| Asana | Asana's API with a personal access token (app.asana.com/0/my-apps); locked on disk | Every 5 min | Reads open tasks assigned to you, due today or earlier, in each workspace. Completes one when you click Done | An Asana account (free) |
| Notion | Notion's API with an internal integration's secret (notion.so/my-integrations), locked on disk; Notion only lets it see the databases you share with it | Every 5 min | Reads pages in your task database with a date of today or earlier and not done (a Done checkbox, or a status in the Complete group). Sets it done when you click Done | A Notion account (free) |
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
- **Updates:** a git-checkout install checks GitHub every half hour.
  **Update ready** pulls, installs, restarts (exit code 75 tells the
  supervisor to start it again) and reloads the page. tmux sessions keep running.
  In the app, the app asks GitHub Releases every half hour and tells the server
  what it found, so the same **Update ready** button shows; a click downloads
  the new version, then the app restarts on it. Settings, About has **Check for
  updates** and an optional switch to install updates on their own when no agent
  is working (and, without tmux, when no session is open). Each tagged release is
  published by itself once every installer has built.
- **OS-specific code** lives only in `lib/desktop.js`, `lib/terminals.js`,
  `lib/sysprobe.js` (the System monitor) and `scripts/setup.mjs`. Everything else is the same on Linux, macOS and Windows.

## Privacy and security

- **Only your computer can use it.** The server listens on `127.0.0.1` only.
  Every request must come with the Host `127.0.0.1` or `localhost`, and every
  change needs an `X-Switchboard: 1` header, so a web page open in your browser
  cannot drive it. The page has a strict Content Security Policy, and loads
  nothing from Google or any other third party: its typefaces ship with it.
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
  nothing anywhere. Viewing a session from your other computer, the part on
  screen goes to it sealed with your account key, like its terminal does, and
  only when that computer shares its sessions. Text is drawn as plain text, never as HTML. Answering a
  question from the chat presses only arrow keys and Enter in that session,
  and only after a click.
- **The agent tools leave your mail out.** The MCP tools cover the board, your
  sessions and their builds and checks; mail, chats and money are not offered
  to agents on purpose. (A program running as you on this computer can still
  ask the local server, as the page does: Switchboard trusts your own user
  account, like any app on your computer.)
- **Project files stay on this computer.** Files dropped on a project's page
  are kept in the data folder (`projects/<id>/files`), private to your user
  account, and are never synced or sent anywhere. They open only as a
  download, never inside the page. A project's about, people and links are a
  setting, so they sync, encrypted, like your projects do. Links are kept
  only if they are web, mail or phone links. Found in your mail is read from
  mail already on this computer (people you wrote to in that project, and
  people who wrote to you there whom you have written to); nothing new is
  fetched for it, and senders like no-reply never show.
- **Feeds never reach inward.** A feed address is only fetched over http(s)
  from the public internet: an address on this computer or the local network
  (Switchboard's own API, a router's page) is refused, redirects included.
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
  built (see "The app" below); public downloads come once releases are public.
- **To connect things:** Settings, Connections. It shows only your connections; everything else is under Add a connection, by kind, with Add (and Remove from list for one you don't use). The welcome card on Now walks
  through it.
- **MCP:** setup registers a `switchboard` MCP server with each coding agent
  it finds (Claude Code, Codex, Gemini CLI). Its tools are `switchboard_overview`, `switchboard_add`,
  `switchboard_projects`, `switchboard_sessions`,
  `switchboard_send_to_session`, `switchboard_actions`, `switchboard_checks`,
  `switchboard_add_check` (set up a page or Playwright check and read its
  results) and `switchboard_notes` (the user's notes for the folder or
  project you work in, with their checkboxes). Use
  `switchboard_add` with kind `needs` only when you truly need the user.
- **Claude Code wiring:** setup adds hooks (`bin/hook.sh` posting to
  `/hook/claude`, events SessionStart, UserPromptSubmit, Notification, Stop,
  SubagentStart, SubagentStop, SessionEnd, PostToolUse, PreToolUse for AskUserQuestion, PreModelSwitch and
  PostModelSwitch) and, only if the person has none, a status line
  (`bin/statusline.sh` posting Claude Code's status JSON to
  `/hook/claude/status`), which is where a session's model, effort, context
  used and cost on the Sessions bar come from. Both scripts print nothing,
  time out after a second and always exit 0.
- **Rules for agents working on this repo** are in [AGENTS.md](AGENTS.md).
  Plans and their status are in [docs/ROADMAP.md](docs/ROADMAP.md).

## Install

You need **Node 22.13 or newer** (nodejs.org) and **git**; on Linux also
`build-essential` and `python3`, so the terminal library (`node-pty`) can
compile. Optional: **Claude
Code** or another agent, the **GitHub CLI** (`gh auth login`), and on macOS
**tmux** (`brew install tmux`) so sessions survive restarts.

```sh
git clone -b stable https://github.com/brettmboggs/switchboard-app.git
cd switchboard-app
npm install
npm run setup
```

`-b stable` means updates come from releases (the Stable channel); leave it
out, or pick Latest in Settings, General, About, to get every change as it
lands. Settings, General, About shows the version you have.

`npm run setup` adds the Claude Code hooks, registers the MCP server with each
agent installed, starts Switchboard, makes it start at login, and adds a
launcher:

| | Starts at login with | Launcher | Logs |
|---|---|---|---|
| Linux | systemd user service | app menu | `journalctl --user -u switchboard -f` |
| macOS | launchd agent | `~/Applications/Switchboard.app` | `~/Library/Logs/switchboard.log` |
| Windows | hidden starter in the Startup folder (`bin/run.mjs`) | Start menu | none yet |

Then open Switchboard: the welcome walks through projects and connections.
To take it all back out, use **Settings, General, Remove Switchboard** (or
`npm run uninstall`). It removes the Claude Code hooks and status line,
Switchboard's tools in each coding agent, the headless browser, the launcher and
start at login. It leaves your own settings alone (the first setup also keeps a copy of
your Claude settings at `~/.claude/settings.json.before-switchboard`). A tick
box also deletes your data: the data folder and this computer's keychain entry.
In the app, **Quit and finish** does the last step; then drag the app to the
Trash. On Windows the installed app is also in Add or remove programs.
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
sits in the tray. It starts at login and updates from GitHub Releases: the
page's **Update ready** button shows when there is a new version, one click.
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
note call Sam about the invoice     pick a page: a checkbox at its bottom (or a new page,
                                    or a quick note); note groceries: eggs names the page
sesh add a test for the button      pick a session: the message goes in (queued if it is busy)
shopping eggs, milk                 onto the page called Shopping (any page with a checklist)
log eggs 14                         an entry in the page "Eggs log", which shows totals
anything else                       a note
```

With `note` and `sesh` you pick where it goes from the list and stay on the
page you are on. Ctrl K also searches as you type: pages, notes, reminders and chores. Arrow
down to a result and press Enter to open it. Enter without picking one adds
the line as above.

**Notebook.** In a page, a line ending in `=` shows its answer
(`3 bags × $12.50 =` shows $37.50); `feed = 3 × 12.50` names a number to use
later, and `total =` adds up the lines above it, back to a heading. The mic
on the formatting bar talks to type at the caret (Live or Private, as in
Settings); one undo takes the words back out. `today fed the goats` in Ctrl K
puts "6:10 PM · fed the goats" on a page called, say, "Tue Nov 4" in the
project you are in, making it the first time. **Send to session** (beside
Pin on a page, and on each quick note) opens a picker of your open sessions.
It sends the text you selected, the line the caret is on (a bullet with the
bullets under it), or the whole page, and shows exactly what will go in a box
you can edit. A line above it is optional and starts empty ("Summarise these
notes into to-dos" and "Turn this into a plan" are one click). **Send** puts
it in now, or queues it until the agent is free; **Edit in the message bar**
puts it in the session's message bar instead, where nothing goes until you
press Enter.
Pages are stored as HTML and pass through one sanitiser (`public/js/sanitize.js`)
on load, paste and save, so nothing but the editor's own tags survives.

Add `@project` to file it in a project. **Projects and rules** live in
Settings. A rule is `text -> project`: when the text appears as a whole word
in a repo folder, a window title, or an email's sender, recipients or subject,
that thing goes to that project. First match wins.

**Sessions:** New session, pick an agent and a folder, and for Claude the
**Model** (Default, Sonnet, Opus, Haiku, with a 1M-context box for Sonnet and
Opus) and **Effort** (Default, Low, Medium, High, Max), remembered per folder
and passed as `claude --model` / `--effort`; Codex takes an optional model
name. Type in the terminal
as usual, or use the prompt under it: it types your message in when the agent
is free, or queues it while the agent works (Interrupt sends it right away).
Type `/` at the start of a message and a menu lists Claude Code's commands
(`/model`, `/effort`, `/clear`, `/compact`, `/context`, `/cost`, `/rename`,
`/plan`, `/resume`, `/help`, `/status`, `/diff`, `/review`,
`/security-review`) and the folder's own skills (`.claude/skills`,
`.claude/commands`, and your `~/.claude/skills`) with one line each; arrow
keys and Enter or Tab pick one, Enter again sends it. `/model` opens Claude's
picker, shown as buttons in Chat (`/effort` is a slider, so it opens in the
terminal; `/effort high` as a typed command works, and like `/model sonnet`
it saves that as your default for new sessions, which is Claude Code's own
behaviour). The session's bar reads its model, effort, context used and cost
("Opus 5.5 · high · 39% · $0.42") live from Claude Code's status line once
`npm run setup` has installed it (`bin/statusline.sh`, set only if you have no
status line of your own; the comment in `scripts/setup.mjs` shows how to chain
yours), and the model alone from the SessionStart and PostModelSwitch hooks.
Every session is one line in the right-hand panel, grouped under its repo:
named by what it is working on (Claude Code's own title for it, such as
"Login form in Checkout", read from tmux or the terminal), or by
your name for it if you gave one, and what it is doing (Working,
Your turn, Needs you, with how long it has waited), plus a second line only
when there is more to know (2 queued, build failed). The order holds still,
orange marks only what needs you, and the list follows the project picker at
the top of the page. The open session's bar carries its branch, build, linked
chats and folder, with **Stop** (interrupts what the agent is doing, like
pressing Esc; the session stays open, and the button is grey when there is
nothing to stop), **End** (asks "End this session?" in the same place, End it
or Keep, and waits for you), and More (rename, linked chats, copy the tmux
command). A session whose agent sent helpers (sub-agents) off to work stays
**Working**, with "2 helpers still working", until the last one is back; only
then is it Your turn (from Claude Code's SubagentStart and SubagentStop hooks;
`node scripts/setup.mjs hooks` adds them to an install made before). **Messages**, beside the paperclip,
brings in a message: the session's project's recent emails, texts and Teams
chats come first (mail either way in the last 60 days from people you have
written to or that a rule puts in a project, never newsletters), with a search,
and the other projects fold out below. Click one to add its newest message,
Earlier for the rest of the conversation, or drag it in. **Link to** a project
on a conversation from elsewhere adds a rule (Settings, Projects) with that
person's address, or the Teams chat's name, so their messages belong to that
project from then on.
Double-click a line to rename it. "Move into Switchboard" on a VS Code session
reopens it here with `claude --resume`. Claude sessions open as a chat
unless you pick Terminal (Settings, Look, **Sessions open in**, also offered
once the first time). **Chat | Terminal** on the session's bar switches one
session, remembered per session. There is always one place to type: the message bar in Chat, the
terminal itself in Terminal. When Claude asks permission or offers choices
(including "trust this folder?"), Switchboard reads the question off its
screen and shows it as buttons; a click moves to that choice and presses
Enter, only if the same question is still on screen. Writing a message
instead answers No and sends it. Sessions run without tmux (Windows, a Mac
without it) cannot have their screen read, so those questions show **Open the
terminal**. Chat reads Claude Code sessions, on this computer or on your other ones
(through the same encrypted relay as their terminals; the computer the session
runs on reads the transcript and sends back only the part being shown). Other
agents show their terminal. Copying in a session's terminal (Claude Code's
copy, or selecting with the mouse in tmux) lands on the clipboard of the
computer you are using, through the terminal's own copy code (OSC 52), not the
one the session runs on. Selecting text with the mouse is each screen's own:
a drag highlights only on the computer doing it, and letting go copies it
there (Cmd C on a Mac copies too). One session still has one screen size and
one scroll position, shared by every computer showing it. **Builds** and **Browser checks** are tabs on Sessions (old
`#actions` links still land on Builds).

### Connecting Microsoft 365 (Teams and Outlook)

Settings, Connections, **Sign in with Microsoft** uses the Switchboard app
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

**Phone push.** The phone app registers an Expo push token with the sync service
(`/v1/push/register`); a computer pings it (`/v1/push`) when a session needs you
or a GitHub build fails, after the Settings switches and quiet hours. The service
sends fixed text ("A session needs you." / "A build failed."), so it, Expo, Apple
and Google only learn that something of that kind happened. At most one ping per
kind per minute per account. Expo's push service is free. The tables are in
`schema.sql` (all `IF NOT EXISTS`); after changing `sync-worker/`, run it and
`npx wrangler deploy`.

## Where things live

| Path | What |
|---|---|
| `server.js` | Setup, security checks, the board state, background work |
| `lib/routes/*.js` | The API, one file per area: board, inbox, sessions, settings, connections, account, webhooks, notebook, routines, agent API, system |
| `lib/github.js` | GitHub Actions runs (live) and review requests |
| `lib/gmail.js`, `lib/mailservers.js` | Email over IMAP, sorting (mail, Voice, charges, receipts), provider lookup |
| `lib/microsoft.js` | Teams and Outlook through Microsoft Graph |
| `lib/conversation.js` | One open conversation (Teams, Outlook, mail, texts) for the Inbox's conversation view |
| `lib/claude.js` | Agent session states from Claude Code hooks (helpers counted) |
| `lib/projects.js`, `lib/routes/projects.js`, `public/js/project.js` | A project's own page: its profile (about, people, links) and its files |
| `lib/terminals.js` | Sessions Switchboard runs (tmux or a pty), the queue, linked chats |
| `lib/transcript.js`, `lib/agentmenu.js`, `lib/gitinfo.js`, `lib/routes/sessionview.js` | The chat's transcript reader (by byte offset), the agent's on-screen question read as choices, the session bar's change counts, and their API |
| `lib/feeds.js` | News and blogs: RSS and Atom, read without a parser package |
| `lib/localai.js` | Local AI models: Ollama, LM Studio, llama.cpp and Jan on localhost |
| `lib/calendar.js`, `lib/caldav.js`, `lib/weather.js`, `lib/deliveries.js` | Calendars (links, and iCloud, Fastmail and Yahoo accounts over CalDAV), weather, packages |
| `lib/capture.js`, `lib/routines.js`, `lib/pages.js` | Ctrl K, chores, the notebook |
| `lib/browserchecks.js` | Browser checks: headless Playwright runs, schedules, results |
| `lib/checkauth.js`, `scripts/signin.mjs` | Signed-in checks: the visible sign-in window and the private saved sign-in |
| `lib/webhooks.js` | Webhooks in (local and through the sync service) |
| `lib/sync.js`, `lib/relay.js`, `lib/secrets.js` | Encrypted account and sync, the live link between computers, the on-disk key |
| `lib/desktop.js` | Windows, focus, notifications, keychain: the OS-specific parts |
| `lib/sysmon.js`, `lib/sysprobe.js` | The System monitor's numbers (processor from Node; apps, graphics, sensors and network per OS) |
| `lib/db.js` | SQLite at `~/.local/share/switchboard/switchboard.db` |
| `bin/hook.sh`, `bin/mcp.mjs`, `bin/run.mjs` | Claude hook, the MCP server, the Windows supervisor |
| `scripts/setup.mjs` | Install and uninstall on each OS |
| `scripts/publish.mjs` | Ships a release: exports the tree through a personal-data gate, bumps the version, tags, moves `stable` |
| `scripts/notices.mjs`, `THIRD-PARTY-NOTICES.txt` | The licences of everything bundled (`npm run notices` regenerates the file) |
| `eslint.config.js`, `scripts/page-globals.mjs` | `npm run lint`: an undefined name or an eval fails; the page scripts' shared names are listed by the script |
| `public/` | The page: `index.html`, `css/` (tokens, base, layout, components, pages; see docs/DESIGN.md), `fonts/`, `setup.js` (the feature registry), `js/*.js` |
| `sync-worker/` | The optional sync service (Cloudflare Worker + D1) |
| `test/` | `npm test` (node:test) |

**Related:** [switchboard-mobile](https://github.com/brettmboggs/switchboard-mobile),
the phone app (Expo), which joins your account as one more device.

## Contributing

Read [AGENTS.md](AGENTS.md) first. It is the one set of rules for people and
for every coding agent (CLAUDE.md just imports it). In short: keep personal
data out of the code, keep OS-specific calls in their three files, give every
new feature a setup-registry entry (`public/setup.js`), keep this README
current, and run `npm test`. Plans and their status are in
[docs/ROADMAP.md](docs/ROADMAP.md).
