# Switchboard

<!-- pitch:start (made by npm run pitch from docs/headlines.json; edit that) -->

**One screen for everything that wants your attention: your AI coding agents, builds, email, Teams, calendar, bills and packages.**

Anything that needs you turns orange, and you can answer it right there without opening the other app. It runs on your own computer: your passwords and mail never pass through anyone else's server, and nothing is ever sent without your click.

**What makes it different**

- **Orange means it needs you.** An agent waiting for an answer, a build that failed, a reply you owe, a bill due, a late package, the chickens to feed: one board, one colour for "you". Everything else stays quiet, so a glance tells you whether you can keep working.
- **Your AI agents live inside it.** Claude Code, Codex, Gemini and local models run inside Switchboard, and a Claude session reads like a clean chat: its permission prompts and multiple-choice questions are buttons, messages queue while they work, any file they mention opens with a click, and the bar shows the model, how much context is used and what it has cost so far.
- **Your agents can talk back.** Switchboard is an MCP server, so the agents themselves can read your board: what needs you, how the builds are doing. A stuck agent puts a card on your board instead of sitting silently in a terminal, and one session can hand work to another.
- **Work finds the session it is about.** A Teams message or email about a project shows up beside the coding session for that project. One click puts it into what you send the agent, with who sent it and when. A notes page goes in the same way.
- **Reply without opening the other app.** Gmail, any other mail account, Teams, Outlook, Google Voice texts and your team's own end-to-end encrypted chat in one Inbox that reads like a chat app. Reply, archive or snooze from there, and close the dozen tabs: you still see everything.
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
| **The Deck** | Home. Jarvis at the centre as a living core that reacts to your voice, the time and weather, what it last said, and a command line; around it every system as a live module (needs you, sessions, builds, inbox, calendar, money, notes, browser checks, projects) with its number and top lines. Click a module and it zooms open into its full page; Esc, the wordmark or "back" returns. Pages, projects, search and settings sit in the ring across the top. One dark theme (the HUD): navy glass, lit cyan lines, orange only for what needs you. |
| **AI plans** | Your Claude plan's 5-hour and weekly limits on the Deck and Now, each as a small chart from the start of the window to its reset: how much is used, when it resets, and where your pace lands by then, in plain words ("On track, lands near 77%, room for 22% a day" or "Runs out about 7:20 PM at this pace"), plus what each day of the week used. A Claude session's bar on Sessions has a tiny gauge for each. It reads the numbers Claude Code already sends Switchboard with its status line, and Codex's from its own session logs, so there is nothing to connect; readings are kept on this computer for 35 days. Click the card for the **AI plans page**: a big chart of the window you can hover (with last week's line to compare), when in the week you use the plan, every past week and where it ended (a summary of each window is kept for good), the last four weeks day by day, your habits, and the sessions that took the most (put down to the session whose status line saw the jump). A tab for each plan; nothing leaves the computer. |
| **Jarvis** | The voice of Switchboard: the glowing core on the Deck and the orb on every other page. Hold **Ctrl+Space** anywhere and talk (or click and type); let go and he answers out loud and does it. The common things work instantly with no AI at all: "go to builds", "what needs me", "open the switchboard session", "remind me tomorrow at 9 to call the bank", "add eggs to shopping". Anything else goes to a model on your own computer (LM Studio, Ollama or llama.cpp; the smallest one you have, or the one you pick in the panel), which can do anything Switchboard can: every action on the page is in one catalogue (`lib/jarvisactions.js`, about 200 of them: mail, calendar, money, notes, projects, files, settings, connections, checks, routines, tasks, sharing, updates, the network test), and he finds the one you mean by its words and runs it. Anything that removes or can't easily be undone waits for your yes; anything that would reach another person (a reply, a chat, a review, an invitation) he leaves for you to send. "Test my internet" runs the network test with no model and he says the result when it ends. He answers in under a second: the model's private "thinking" is switched off, the model loads while you are still holding the keys, and each sentence is spoken the moment it is written. Hold the keys again to stop him; two soft tones say he is listening and that he heard you. He can speak up unasked (Settings, General, Jarvis): when a session needs you or sessions finish, and a short morning brief on your first click of the day ("brief me" any time). He remembers: "remember that…" adds to a short card of facts about you (capped at about 400 words' worth so he stays quick), "forget…" takes out, "what did I say about…" searches the last 90 days of what was said, and a nightly tidy by the same local model keeps the card current, with every version kept for Undo (Settings, General, What Jarvis knows; his manner is set there too). It hears through talk to type and speaks with your browser's own voice. Free and private: the model runs on this computer and only 127.0.0.1 is ever asked. |
| **Calendar** | A month of everything on your connected calendars, with a day opened underneath: times, places, and which calendar. It opens from **Calendar** on Now's Today line (or G then C); it has no place on the rail. It reads the same calendars as Now (private links, or iCloud, Fastmail and Yahoo through your email account) and asks each only when you look, keeping the answer five minutes. **Google Calendar** signs in with one button (Settings, Connections, Calendars): Google's own page opens in a new tab and you sign in there; Switchboard keeps only a refresh token, locked on this computer, and never sees your password. Then **Add event**, and click an event to change or delete it; every change is your click on Save or Delete. Calendars added by link, iCloud or Fastmail stay read only for now. Repeating events: a change affects that one occurrence. For a copy of Switchboard to offer the Google button it needs the app's Google client: the id is in `lib/product.js`, the secret is read from `~/.config/switchboard/google-client.json` (`{"clientId", "clientSecret"}`, mode 0600) or `SWITCHBOARD_GOOGLE_CLIENT_SECRET`, and is not kept in the repository. |
| **Now** | Everything in flight as cards with one state each: needs you, working, waiting on someone else, done. Today's calendar, weather, packages. Until noon, a **morning rundown** at the top: the day in one sentence (meetings, what needs you, bills this week, packages, routines), four figures, the schedule beside the lists, and Read aloud with a voice on your computer. |
| **Sessions** | Claude Code, Codex, Gemini CLI, Aider or any command, running inside Switchboard in a real terminal (tmux on Linux and macOS, so sessions survive restarts). Grouped by repo, renamable, with a live state bar, one prompt with talk-to-type and images, and a queue: messages wait and go in when the agent is free. Sessions on your other computers show up too. Claude sessions (and Codex and local model sessions) open as a **chat**: the session's own transcript as a clean conversation with one message bar, tool calls folded to one line, what it is doing while it works, and its permission prompts and questions as buttons. New session picks the model (Sonnet, Opus, Haiku, 1M context) and effort, remembered per folder; typing `/` in the message bar lists Claude's commands and the folder's skills with what each does, and `/model` opens Claude's picker as buttons; the session's bar reads its model, effort, context used and cost live ("Opus 5.5 · high · 39% · $0.42"). Files the agent names are links when they exist on this computer, in Chat and in Terminal view alike: a click shows a document as a page, code with the named line lit, or a picture, with Open (its own app) and Show in folder; pictures it sends show in the chat. A session on your other computer works too: that computer sends the file over, and Open stays on that computer. Only files in your home, temp or the session's folder, never keys or secrets, and a script is only ever shown in its folder, never run. Opt in (Settings, General): git status and the branch's pull request on each session's bar, and terminals drawn by the graphics card (WebGL). Under a session's messages, its project's notes (and those tied to its repo): Add to message puts a page, or one section of it, in what you are writing. The folder picker for a new session lists your repos first, then folders that are not repos and agents' side copies in groups of their own; **New folder…** at the top makes one for something with no repo yet (a new client): a name, made in your code folder as a git repo (untick to skip), and if you tick it a private repo on your GitHub too, then the session starts there. |
| **Sessions, Builds** | GitHub Actions, live, in GitHub's colours: yellow glowing while a run goes, green passed, red failed, with jobs and the current step. Checks every 10 seconds while something runs. Each session shows its own repo's runs. Re-run failed jobs or cancel. |
| **Browser checks** (a tab on Sessions) | Opt in. A project's own Playwright tests, or "this page must load and show this text", run in a headless browser (no window, nothing to keep open) on a click or every hour, 6 hours or day. One line per check with its light. Click one to see what failed, with screenshots. A failure becomes a Needs-you card. A project's tests can run **signed in** to a site that needs it: you press Sign in, a normal browser window opens on your computer, and you sign in yourself on the site's own page (including any code or MFA). Give the address of the site you are testing: Done saves only once the window is back on that site, which is when its own sign-in tokens exist. Switchboard never sees, types or asks for a password, code or answer; it keeps only the browser's sign-in state in a file only your account can read (`~/.config/switchboard/auth/<check id>.json`, mode 0600), outside every project, never logged, never shown on the page or to an agent, and never sent anywhere. The test command gets its path in `SB_AUTH_STATE`, only for that check. If the sign-in runs out, the test prints a line with `SIGNIN_EXPIRED`; the check pauses (it never retries by itself) and a Needs-you card asks you to sign in again. Sign out, removing the check, or changing its folder or sign-in page deletes the file. Agents can add and read checks for you (they can name the sign-in page, but only you can sign in). `node scripts/setup.mjs browser` also gives your agents a headless Playwright MCP server. |
| **Inbox** | Conversations waiting on a reply from email (Gmail or any IMAP account), Google Voice texts and voicemail, Teams chats and Outlook. Pick one and it opens large beside a narrow list, like Teams or Discord: messages grouped by who sent them, day by day, links clickable, your reply box pinned at the bottom. It stays put while the board updates, and it is live: an open Teams chat is checked every 4 seconds while you can see it, mail on every mail check. Your reply shows at once and is confirmed when it has gone. Reply, archive, snooze, or bring one message into an agent session. Pictures people send show as pictures, in email, Google Voice texts, Outlook and Teams, and other attachments show with their name and size, to save; they come from the mail server or Microsoft when the conversation is opened and are kept in memory only. Paste, drop or attach pictures in a reply (email, Outlook, Teams) and they arrive as real pictures. Teams chats also show emoji reactions; hover a message to react. Teams does not let other apps see whether someone read a message, so there is no "seen". |
| **Drafts** | Your email drafts, including ones an assistant writes for you through your Gmail, show in Inbox: one that answers a conversation sits at the bottom of it, marked Draft; the rest are listed at the top of Inbox. **Edit** opens To, Cc, Subject and the text; **Send** sends it in its thread, **Save draft** puts the new version back in your Drafts (so Gmail on your phone shows the same), **Discard** moves it to your mail's Trash. Read from the Drafts folder with the rest of your mail; nothing is sent until you press Send. |
| **Notes** | A notebook: pages per project with a formatting toolbar like an email (headings, size, bold, italic, underline, strikethrough, bullets, numbers, checklists, quotes), a mic that types where the caret is, #tags, search, a calculator (end a line with `=`), lists you add to from Ctrl K, logs with totals, and `today …` for a timed line on the day's page. Send to session sends the bullet you are on (an arrow at its end), the bullets you selected, or the whole page (or a quick note) to a session: you see exactly what goes, can change it, and can add a line saying what to do with it. Plus quick notes (with a mic), reminders, to-dos, and chores that come back on their own ("trash every tue at 7pm"). A line you sent to a Claude Code session (Send to session, the queue, or pasted in) gets a small mark after it: sent to which session, then **Claude finished** once that session's turn ends. Finished only means the turn ended, so you tick it off yourself: click the mark, **Mark done** (a checklist line is ticked, any other line crossed out). Marks stay on this computer and are never saved into the note. |
| **Projects** (on the left) | Each client, business or part of life has its own page: what is in flight there, its conversations, sessions, notes and files (drop them on the page, any type up to 1 GB; they stay on this computer), and on the side what you do for them, the people with every email address and phone number they use (a work address and a Gmail on one person; **Merge with…** folds two rows that are the same person into one, keeping every address; mail and texts from any of them sort into that project; with everyone you have written to in that project's mail offered under Found in your mail: Add or Hide), and links to their site, its admin, the repo and anything else you open for them. To narrow a list to one project, use the picker at the top of Now, Sessions, Inbox, Money or Notes. **In this project**, at the top of each project's page, shows everything that belongs to it, by kind: repos and folders, people, addresses and Teams chats, and pages or single sections of pages. **Add to this project** searches everything Switchboard knows. Anything can belong to more than one project. A note can be tied to one repo, so it shows only beside that repo's sessions. **Unsorted**, under the projects on the left, lists the repos, folders, people and chats with no project yet, with the likely project to file each in one click. **Hide** takes clutter (folders that are not repos, a sender) out of every list and the session folder picker, without deleting anything; Show them brings it back. |
| **Reading** (a tab on Inbox) | News and blogs you follow (RSS and Atom; type a site and its feed is found, and a news page with no feed, such as anthropic.com/news, is watched for new article links instead), newest first, unread in bold, kept 30 days. Never on Now and never orange: reading is for when there is time. Only each post's title, link, date and a short plain-text summary are kept; a post's own HTML is never shown. |
| **Money** | Invoices you sent and are waiting on, bills and when they are due, payments in, card charges and receipts read from alert emails. **Recurring costs**: rent, hosting, software, insurance, each with how often and its project, totalled per month and per year and split by project (each project's page shows its own); charges in your email that come back like a subscription are offered with Add or Not recurring. No bank connection needed. |
| **Local AI models** (Settings, Connections) | Run models on this computer with Ollama: install it, get a starter model and start it as a session (New session, Agent: Local model), all from Switchboard. Private, free, works offline. If you use LM Studio, the models you downloaded there start as sessions too (Agent: Local model (LM Studio)). A local model session reads like a chat, the same as a Claude session: Switchboard's own small chat program (`bin/localchat.mjs`) talks to the model through Ollama's or LM Studio's server on this computer, starts that server if it is not running, keeps the conversation in a file in Switchboard's data folder, and the terminal shows it too. llama.cpp's server and Jan are listed when they run. Only `127.0.0.1` is ever asked. |
| **System monitor** (Settings, System) | How busy this computer is, live: processor (and each thread), memory split into in use, cached and free, graphics, network speed, storage left, temperatures and fans where the computer shares them, and the apps using the most (grouped, sortable, searchable). A line at the top says in words what is straining ("Memory is 93% full; Chrome holds 6.0 GB"). Charts keep two minutes. Linux, macOS and Windows; it reads numbers only while it is open, keeps no history, sends nothing, and never asks for admin rights. |
| **Network test** (Settings, System; Test speed on the monitor) | A speed test built in. One click measures download and upload on 8 connections at once (10 s each, the first 3 s of TCP finding its speed left out), latency and jitter with the line quiet, packet loss, and bufferbloat: how far latency rises while the line is full, graded A+ to F, which is what makes calls stutter while someone downloads. Every ping is drawn as a dot, so you can see it. It pings your router too, so a slow result can be put down to Wi-Fi or to the internet beyond, and notes when the cable to your router caps the result. Then what it is good for in plain words (4K video, calls, games, how long 50 GB takes) and every past test, kept on this computer. It runs from Switchboard's server against Cloudflare's public speed test (free, no account, the nearest of its cities), not in the browser, so the browser's limits never show in the numbers. Router, Wi-Fi and packet-loss readings are Linux first. |
| **Files and pictures** | Drop, paste or pick any file: into a session's message bar (it goes to the agent as the file's location, so Claude Code and Codex can open pictures, PDFs, spreadsheets or code), onto a session's terminal (its location is typed at the cursor), into a note (a picture shows in the page, anything else is a link), or onto a project's page. Up to 1 GB each, written straight to disk. They stay on the computer they were added on: synced notes show a picture only there. A click on a project's file or a file link in a note (a double-click on a picture in a note) opens it inside Switchboard: pictures full size, PDFs in the browser's PDF viewer, text and Markdown as a page, with ‹ › through the files beside it, Download, Copy picture or text, Open in its own app, Show in folder, and **Move or copy** to any project's Files, into any note, or to a session (its agent is told where the file is). Web pages, SVGs and every other type are never shown as a page: they open in their own app or download, so a dropped web page cannot run in Switchboard. |
| **Keyboard** | `?` lists every shortcut; G then a letter goes to a page (G I for Inbox); `,` opens Settings. In the Switchboard app, Ctrl+Q quits it like any app (Cmd+Q on a Mac); your sessions keep running. In a Claude session's terminal, Shift+Enter starts a new line and Ctrl+Enter sends now, even while Claude is working (the keys Claude Code itself uses: Ctrl+J, and Ctrl+X Ctrl+S). |
| **Ctrl K** | Search everything, and type it once. A few letters find sessions (on every computer), people on your projects' pages, emails (any age, from people) and Teams chats, calendar events (a month back, two ahead), money (bills, invoices, payments, charges and receipts), notebook pages, notes, reminders, projects, and Switchboard's own features ("monitor" finds the System monitor); arrow down and Enter opens one. It searches only what is already on this computer. Or type `remind fri 9am call the bank`, `bill rent 1200 on the 1st`, `todo send the proposal by thu`, or anything else as a note. The mic beside the box lets you say it instead. |
| **Your agents can use it** | Switchboard is an MCP server, so your coding agents (Claude Code and Codex today, Gemini CLI too) can see what needs you, put a needs-you card on your board when they are blocked, read build status, and run other sessions for you: one session you talk to can start others, give them work, read their answers and end them when done. |
| **Every computer** | An optional end-to-end encrypted account links your computers. Your settings and notes follow you, and you can use a session running on one computer from another. |
| **Web board** | A full Switchboard in a browser at your own domain, with nothing to install: your own projects, notes and to-dos, your Teams, Outlook and GitHub, and the projects shared with you, all end to end encrypted and opened in the browser. |
| **Team chat** | A chat for each shared project and one-to-one chats with the people you share a project with, in the Inbox like any conversation (the Team chat chips above the list open one). Things Teams cannot give us: who has seen each message, who is typing, edit and delete your own (everyone sees "edited"), reply to a message, @mention someone (an alert, and a push to their phone saying only "A teammate wrote to you."), and pin a message for everyone. Pictures too. End to end encrypted (see Your Switchboard account, below). |
| **Team and shared projects** | Settings, Team: invite someone once by email (they need not have Switchboard yet; the link makes their account and puts them in), pick which of your projects they are in, and for each kind (pages, to-dos, repos, activity, About card) None, See or Edit. Admins can invite too. Repos open in Codespaces, as a ZIP, on GitHub, or clone to their computer with their own sign-in. End to end encrypted; never mail, terminals or sign-ins (see Your Switchboard account, below). |

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
| Granola | Sign in with Granola on its own page (any plan, the free one too): Granola's MCP server (mcp.granola.ai), OAuth with no secret, the sign-in token locked on disk with this computer's key. On Granola's Business plan an API key (public-api.granola.ai) works instead | Every 10 min (notes changed since the last look; the first look goes back 30 days, all the free plan shows) | Reads only: each meeting's summary, attendees and your own notes, as a page in Notes in the project it belongs to: a Granola folder named like the project, else the people in it (your address rules), else its title, else Personal; move any page to any project. Only Granola's list and read tools are ever called; never the transcript; nothing goes back to Granola | A Granola account |
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
- **Jarvis stays on this computer.** Its quick commands use no model. Anything
  else goes to a model running locally (LM Studio, Ollama or llama.cpp on
  127.0.0.1); what you say is never sent to an online AI. Its tools are
  Switchboard's own API, with the same checks as the page: it can do anything
  the page can, asks before anything that removes, and never sends mail or
  messages to people. What it remembers (its card of facts, and a log
  of what was said, kept 90 days) is in Switchboard's database on this
  computer; Settings shows the card, to edit or undo.
- **Sync is end-to-end encrypted.** Your password makes two keys on your
  computer: one signs in, the other locks your data before it leaves. The sync
  service (`sync-worker/`, a Cloudflare Worker with D1) only ever stores
  ciphertext. Nobody, including whoever runs the service, can read it.
  **Forgot password?** takes a one-time code, from whoever runs a shared
  project you are in (or by email, if the service is set up to send it); with
  it you set a new password. The service cannot unlock the old
  copy, so it clears it and signs out your computers, and each one sends its own
  copy up again, locked with the new password, when you sign in on it.
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
- **The network test sends only test data.** It downloads and uploads random
  bytes to Cloudflare's public speed test (speed.cloudflare.com) and pings
  1.1.1.1 and your router; Cloudflare sees your IP address, as with any site.
  Results are kept on this computer without the IP address, and a test only
  runs when you press GO. At gigabit speeds one test moves about 2 GB.
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
  365, GitHub (through the `gh` CLI), calendars (ICS links), Granola meeting
  notes (an API key; they become pages in Notes) and weather, and it
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
  `switchboard_send_to_session`, `switchboard_start_session`,
  `switchboard_read_session` (a session's state and last messages; it can
  wait until that session finishes), `switchboard_end_session` (only a
  session the caller started), `switchboard_actions`, `switchboard_checks`,
  `switchboard_add_check` (set up a page or Playwright check and read its
  results) and `switchboard_notes` (the user's notes for the folder or
  project you work in, with their checkboxes, and each picture or file in
  them as `[picture name: '/path/on/this/computer']`, so open it to see it). Use
  `switchboard_add` with kind `needs` only when you truly need the user.
  Start, message and end other sessions only when the user asked you to work
  with other sessions; every one you start shows in their Sessions like one
  they started, and only you (or they) can end it.
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

**Ctrl K** puts anything on the board in one line, typed or said: the mic
beside the box talks to type (Enter stops it so you can check the words;
Enter again sends):

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
Settings); one undo takes the words back out. `today picked up the parts` in Ctrl K
puts "6:10 PM · picked up the parts" on a page called, say, "Tue Nov 4" in the
project you are in, making it the first time. **Send to session** goes with
what you are working on, not the page: a small arrow sits at the end of the
line the caret is on, and the bar's button says what it will send ("Send this
line", "Send selection"). Either opens a picker of your open sessions with
that bullet (and the bullets under it) or the selected bullets, still bullets;
Whole page is one click there. No session running in the project's folder?
The picker offers **Start a session in** that folder (or any other folder
from a list): Start and send opens a new session there and your note goes in
as soon as the agent is ready. Each quick note has its own. It shows exactly what will go in a box
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
Each queued message has **Send now** (stops what the agent is doing and puts
it in at once) and **Edit** (takes it out of the queue and back into the
message bar, after whatever you had typed). In Terminal view a click goes to
the agent, so Claude Code's own clickable parts work (open a running fork or
helper, Esc to come back), while a drag selects text on this screen and copies
it. **End leaves nothing behind**: every process a session started, however
deep, and even one that detached itself (an MCP server, a dev server, a
browser a script opened), carries the session's tag (`SWITCHBOARD_TERM`) and
is stopped with it; the same goes for a session that ends by itself.
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
`node scripts/setup.mjs hooks` adds them to an install made before). A
session leaves Needs you on Now once you have dealt with it, whether or not
you write back: Your turn goes when the session has been open on Sessions for a
few seconds, when you jump to its window, or after 3 hours; either one goes at
once with **Clear** in its panel on Now. It comes back the next time the
session finishes, asks a question or wants a permission. **Messages**, beside the paperclip,
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
Forgot the password? Whoever owns or runs a shared project you are in presses
**Reset their password** on your card in Settings, Team, and gives you the
one-time code it shows (30 minutes). You press **Forgot password?** under Sign
in (in the app or on the web board), enter it with a new password, and you are
signed in. The old synced copy was locked with the old password, so
the service clears it (with the recovery key and sharing key) and signs out
every computer and browser; sign in on each with the new password and it uploads
what it has. You stay in every shared project, with the same access: as soon as
your new password is set, the service tells whoever gave you the code, and
their Switchboard locks each project they run to your new keys (no new invite,
no check codes to compare). Projects someone else runs ask them to compare
check codes in Team first.
The service is in `sync-worker/` (deploy with `npx wrangler deploy` after
creating the D1 database and running its schema files in order, through
`schema-v9.sql`). Optional: to email codes too (Email me a code, and a link
that opens the web board with the code filled in), give it a free
[Resend](https://resend.com) account with your domain verified there:
`npx wrangler secret put RESEND_API_KEY`, and `MAIL_FROM` (for example
`Switchboard <reset@your-domain>`) under `[vars]` in `sync-worker/wrangler.toml`.

**Your team and shared projects.** Settings, Team is people first: invite
someone once, by email, then choose which of your projects they are in (add or
take away any time), whether they are an admin (an admin invites, removes, and
changes what people can do, in the projects they are admin of; only the owner
makes admins), and for each kind of thing **None, See or Edit**:

- pages and notes, with their checklists (any page can be **Only me** and never leaves; when a project is first shared you are asked whether the pages already in it go too). A page someone else shared stays in the project for everyone: × takes it off your own card, and moving it to another project gives you a copy of your own there
- to-dos, reminders and quick notes
- repos: only the repos' names, so each person's Switchboard shows the project's builds and pull requests with their own GitHub sign-in, with **Open in Codespaces** (nothing to install), **Download ZIP**, **Open on GitHub** and, in the app, **Clone to this computer** (into one of your code folders, with gh or git and your own sign-in)
- activity: what each person is working on, a session's name and whether it is working, waiting or done, plus pushes and pull requests; never what is in a terminal, a prompt or a message
- the About card: what the project is, its people and links
- browser checks (their results), sessions, conversations, calendar, money and files (below), each off until you turn it on

**Sessions**, shared: someone you give Sessions to sees your sessions in that
project live, as the Chat view (the transcript as the app shows it, tool calls
folded), from your computer through the relay while it is on ("Sam's computer
is offline" otherwise); never the terminal itself, keystrokes, or a session in
another project. With **Send** they can ask to send a message: it waits in the
session's queue as "Jordan asks" with Send when free, and as a Needs you card,
until you let it in; "Always let them in" lets that person's messages into that
session from then on. Their request is signed with their key and sealed to
yours; the answer is sealed to theirs. **Conversations** sorted into the
project (mail, Teams, Outlook) can be read by people you give them to; replies
stay yours (it says so beside the switch: these are other people's words).
**Calendar** events, **Money** (bills, invoices, payments), **Files** (names
and sizes) and **Browser checks** come from your computer the same way. A
**section** of a page added to a project on its own is shared as a read-only
page; the rest of that page stays yours. **Give everything** (a co-founder)
turns every kind on as far as it goes.

Share on a project's page opens the same controls for that project. Never
shared: your other projects, your sign-ins and tokens, signatures, and the raw
terminal; each person keeps their own sign-ins.

**Inviting.** Invite takes an email address. Switchboard then shows the invite
email (To, From, Subject and what it says) and sends it only when you click
Send, from your own connected mail with the name "you via Switchboard": a
branded email with one button, "Join Acme on Switchboard". Without a mail
account, Copy link. Following the link and making the Switchboard account with
that address (or signing in, if they have one) is joining: there is no second
step. If your computer is offline then, they see "You're in. Acme opens as soon
as Sam's Switchboard is online", and it finishes by itself. The link works
once, for 14 days, only for that address, and you can cancel it in Settings,
Team. Someone who sees the invitation on Now and joins there, without the
link, only asks: the sync service does not check that an account really owns
its address, so you get **Let in** beside their address in Settings, Team, and
they are in once you click it.

**Keys you can check.** Each person's keys come from the sync service, so
Switchboard keeps them the first time it sees them (on all your computers)
and never locks anything to keys that later differ: Team then says "Sam's
keys changed on the sync service", with their old and new check codes, and
nothing new goes to them until you choose. **Check codes**, at the end of
Team, shows your code and each person's: read them to each other by phone or
in person, and Mark checked. Until the web board exists, the link opens a small page on your sync
service (`/join`) with Open in Switchboard (the app on their computer; the
port can be changed, for a second copy) and the other way in: Settings,
Account, **Have an invite? Paste the link**. The invitation rides after the
`#` in the link, so it never reaches the sync service's logs.

To try the invitee's side on one computer, run a second copy
(`SWITCHBOARD_PORT=4801 SWITCHBOARD_DATA=$(mktemp -d) npm start`), open it in a
private window, make an account there with the invited address, and paste the
link (or set the join page's port to 4801 and press Open in Switchboard).

Privacy: each shared project has a key, and each kind in it a key of its own;
a person gets only the keys of the kinds they may see, locked to their own
public key, so a kind they may not see is a sealed box to them. Every page,
to-do, deletion, About card, repo list and activity line is signed by whoever
wrote it, and every Switchboard accepts it only if the signed policy says that
person may edit that kind, so a See-only person's changes are refused by
everyone else's Switchboard. The policy (who is in, with their signing key and
what each may do) is signed by the owner or an admin, and the list of admins by
the owner, whose key each Switchboard pins the first time; so the sync service
can neither add nor promote anyone, nor change what leaves your computer. An
invite for someone without an account is kept on the service as a hash of the
address and of the link's secret, and a signed list of what they may do.
Taking someone off, or someone leaving, or changing who may see a kind, gives
the project new keys; people keep the copies they already had. Projects shared
before the team (0.2.5 and 0.2.6) are moved over by the owner's Switchboard the
first time it sees them; until then the others' Switchboards wait. Everyone in
a shared project should update to this version. The code is `lib/share.js`,
`lib/routes/share.js`, `lib/emails/` and `sync-worker/src/shares.js`; the
service's tables are `schema-v5.sql` and `schema-v6.sql`.

**Team chat.** Each shared project has a chat for everyone in it, and you have
a one-to-one chat with each person you share a project with; open them from
the Team chat chips at the top of the Inbox. Privacy: every line is sealed on
the writer's computer and signed by them. A project chat's key is made from the
project key, so someone taken off the project reads nothing written after, and
someone who joins reads from when they joined; a one-to-one chat's key is made
by the two computers from their sharing keys, so nobody else, the sync service
included, can open it. Edits, deletions, reactions and pins are sealed lines
too, and only the writer's own edit or delete is believed. The sync service
keeps the sealed lines, who wrote each and when, and how far each person has
read (for "Seen"); "typing" is passed on and never kept. Alerts (Settings,
Notifications, "A teammate writes to you or @mentions you") come for a
one-to-one message or an @mention, never for every line in a busy chat, and the
phone push carries no words. The code is `lib/chat.js`, `lib/routes/chat.js`,
`public/js/teamchat.js` and `sync-worker/src/chat.js`; its table is
`schema-v8.sql`. Not on the web board yet.

**Your own sync service.** The account, sync, sharing and the relay all run on
one sync service, and anyone can run their own: `sync-worker/` on your own
Cloudflare account (change `database_id` in `wrangler.toml` to your own D1
database, run each `schema*.sql` in order, `npx wrangler deploy`, and add a
custom domain route if you want one). Then, on each computer before signing in,
Settings, Account, Sync service: your address. Sign-in with Google, Microsoft
or GitHub works there once you add that provider's client id and secret as
Worker secrets; email and password always works. A web board at your own
domain is designed in docs/WEB-BOARD.md.

**The web board.** Anyone with a Switchboard account can use it in a browser
at your own domain, with nothing to install: their own full Switchboard, not a
view of someone else's. Their own projects (made, renamed, coloured and grouped
in Settings, Projects), pages and notes in the same editor, to-dos, reminders
and quick notes, Ctrl K, Now, Notes, the project pages and Settings (Account,
Projects, and Team for projects they run, so they can invite people too). From
the projects shared with them it also has **Sessions** (follow and send to the
sharer's sessions, live, as the Chat view), **Builds**, **Browser checks**,
**Calendar** and **Money**, with whatever the sharer chose for each; those
come from the sharer's computer and are read there, not changed. Starting
sessions of their own, the System monitor and app-password mail need the app. It is
all kept in their own account through the same encrypted documents as the app,
opened and re-sealed in the browser, so when they install the app or sign in on
another computer it is all there. The projects they were invited to sit beside
their own, marked Shared, with what the inviter chose; their own projects and
notes are private to them unless they share one themselves. Invite emails'
button opens it, and making the account there is joining.

They can connect their own **Microsoft 365** (Teams chats and Outlook mail, in
Inbox, with replies on their click; any work, school or personal Microsoft
account, and a personal one brings its mail without Teams), **Google** (Gmail in
Inbox, with replies in the same thread on their click, and their Google
calendars on Calendar) and **GitHub** (their builds, and the pull requests
waiting on them) in Settings, Account. Google and GitHub go through the sync
service once for the exchange their sign-in needs (and Google each hour, to renew
the access), and the tokens are handed straight to the browser and sealed in the
person's own account; the service keeps none of them. Microsoft's sign-in runs from
the browser straight to Microsoft (PKCE) and Graph is called from the browser;
GitHub needs one exchange with a secret, which the sync service does and hands
the token straight back after the `#`, never keeping it. Both tokens are kept
in the person's own account, sealed. Mail by app password (iCloud, Fastmail
and others) works only in the app: a browser cannot reach a mail server.

What only exists on a computer (running sessions and terminals, local mail,
files, calendars by link, Money from mail, the System monitor) is not shown,
except what a shared project brings: a project's sessions, live from its
owner's computer, and what its owner publishes. Everything is opened in the
browser: the account key comes from the password there (scrypt), the project
keys and signatures are checked there, and edits are signed and sealed there
before they go; the service never has anything readable. The session stays in
that browser (IndexedDB, sealed with a key the browser will not export) until
Sign out, which wipes it; a private window forgets it when closed. The share
logic is one module, `public/js/shared/share-core.js`, run by the app
(`lib/share.js`) and the browser (`public/js/web/client.js`) alike.

To connect Microsoft 365 on the board, the Microsoft app registration whose
client id is the Worker variable `MS_SPA_CLIENT_ID` needs a **Single-page
application** platform with your board's address as its redirect URI (for
example `https://board.example.com/`), and the delegated permissions User.Read,
Chat.ReadWrite, ChatMessage.Send, Mail.ReadWrite, Mail.Send and offline_access;
`MS_SPA_TENANT` is `organizations` unless you set it (`common` also lets
personal Microsoft accounts in). A browser keeps a Microsoft sign-in for a day,
then asks again. To connect GitHub, a GitHub OAuth app with the callback
`https://<your board>/v1/oauth/callback/github/connect`, as the Worker secrets
`GITHUB_CONNECT_CLIENT_ID` and `GITHUB_CONNECT_CLIENT_SECRET`.

To turn it on for your own sync service: in `sync-worker/wrangler.toml`,
uncomment the `routes` line near the top with your board's name and set
`BOARD_URL` under `[vars]` to the same address, then `npx wrangler deploy`
(it hashes the page's files for their integrity checks first). With your
domain's DNS on Cloudflare, that adds the one record for that name and nothing
else. Invite links then open the board. The design and what cannot work in a
browser are in docs/WEB-BOARD.md.

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
| `lib/chat.js` | Team chat: project and one-to-one chats, sealed and signed, through the sync service |
| `lib/claude.js` | Agent session states from Claude Code hooks (helpers counted) |
| `lib/projects.js`, `lib/routes/projects.js`, `public/js/project.js`, `public/js/people.js` | A project's own page: its profile (about, people, links) and its files |
| `lib/terminals.js` | Sessions Switchboard runs (tmux or a pty), the queue, linked chats |
| `lib/transcript.js`, `lib/agentmenu.js`, `lib/gitinfo.js`, `lib/routes/sessionview.js` | The chat's transcript reader (by byte offset), the agent's on-screen question read as choices, the session bar's change counts, and their API |
| `lib/feeds.js` | News and blogs: RSS and Atom, read without a parser package |
| `lib/localai.js` | Local AI models: Ollama, LM Studio, llama.cpp and Jan on localhost |
| `lib/calendar.js`, `lib/caldav.js`, `lib/weather.js`, `lib/deliveries.js` | Calendars (links, and iCloud, Fastmail and Yahoo accounts over CalDAV), weather, packages |
| `lib/capture.js`, `lib/routines.js`, `lib/pages.js` | Ctrl K, chores, the notebook |
| `lib/browserchecks.js` | Browser checks: headless Playwright runs, schedules, results |
| `lib/checkauth.js`, `scripts/signin.mjs` | Signed-in checks: the visible sign-in window and the private saved sign-in |
| `lib/webhooks.js` | Webhooks in (local and through the sync service) |
| `lib/sync.js`, `lib/relay.js`, `lib/secrets.js`, `lib/share.js` | Encrypted account and sync, the live link between computers, the on-disk key; shared projects |
| `lib/desktop.js` | Windows, focus, notifications, keychain: the OS-specific parts |
| `lib/sysmon.js`, `lib/sysprobe.js` | The System monitor's numbers (processor from Node; apps, graphics, sensors and network per OS) |
| `lib/jarvis.js`, `lib/jarvistools.js`, `lib/jarvisapi.js`, `lib/jarvisactions.js` | Jarvis: quick commands, the local model, and the catalogue of every action he can run |
| `lib/speedtest.js` | The network test: Cloudflare's speed test, pings, bufferbloat, the words, past results (`lib/sysprobe.js` finds the router and the link) |
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
