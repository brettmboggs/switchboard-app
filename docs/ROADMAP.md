# Switchboard roadmap

Switchboard is one screen for everything that needs you: messages, work,
money, reminders, and (for people who use them) AI sessions. It should be
useful to anyone who juggles too many tabs, apps and conversations: an office
worker, a small business, a family, a homestead. AI is one connection among
many, not the point.

## How we build

- One item at a time. Nothing starts until the last one is tested and in use.
- Every item has a test list. It ships when each line has been checked on a
  real install (and on Mac / Windows where it touches them, or marked
  unverified there).
- Connections first: every program that offers a free way in is worth
  connecting. A connection is: sign in once in Settings, Accounts; its items
  show on Now and Inbox in the right project; replying or acting works without
  leaving Switchboard; a broken connection says so in one line.
- No paid services yet. Free tiers are fine.
- Less on screen, not more. A feature that adds clutter has to earn it.

Effort: S (an evening), M (a few days), L (a week or more).

## Next up

### 0. Ready for other people (from docs/REVIEW.md, Nov 3)
The full check of Nov 3 (security, design, release process, maintainability)
is in docs/REVIEW.md with its findings and an ordered plan; the reasons
behind the shape of the code are in docs/DECISIONS.md. In short, before the
first public release: de-personalised strings, LICENSE, SECURITY.md and
PRIVACY.md, CI in both repos, scripts/publish.mjs with a personal-data gate,
a stable branch for git installs, a CHANGELOG and the v0.1.0 tag; then the
security to-dos, the server and sanitiser tests, and the design system
(tokens, split CSS, self-hosted fonts, a new face and a real logo). Brett's
own items are in it too: model and effort pickers and a slash menu for
sessions, voice to text in Notes with send-to-session, and the fixed
"Show me" buttons.


### 1. Sign in, rebuilt (M-L)
Today: email and password; the password is also the key that encrypts synced
data (nobody can read or reset it).

- Sign in with Google and with GitHub (both free). Microsoft personal and work
  accounts too.
- Apple sign-in needs the paid Apple Developer program ($99/yr): parked until
  paid services are allowed.
- The encryption key no longer comes from a password. The first computer makes
  it. A new computer gets it by pairing: sign in, then approve it on a computer
  you already use (a six-digit code shown on both). Like signing in to
  WhatsApp on a laptop.
- A recovery key (a printable line of words) for when no other computer is at
  hand. Shown once at sign-up, with a nudge to save it.
- Email and password stays as an option.
- A real first screen: what Switchboard is, one button per sign-in, "use
  without an account" (everything stays on this computer).
- Later: passkeys.
- Signing out should offer to remove this computer's copy of the account's
  data, so a shared family computer never merges one person's data into the
  next person's account.

Status (Nov 3): built and tested end to end against a local sync service;
deployed; GitHub live. Next: test pairing from the Mac, then Google and
Microsoft (each needs its app registered and two Worker secrets).

Test list: new account with Google, with GitHub, with email; second computer
pairs by code; recovery key restores on a fresh install; old password accounts
keep working (moved over on next sign-in); sign out and back in; wrong or
expired code; each on Linux, Mac, Windows.

### 2. A real welcome (S-M)
Replace the first-run checklist with a short setup: pick what you want to
connect (cards with logos), name your projects (or start from a template:
Work, Family, Small business, Homestead), done. Every page gets a helpful
empty state that says what will show there and how to connect it.

Status (Nov 3): built. The setup registry (public/setup.js) drives the
welcome, "New in Switchboard" on Now and "left to connect"; a test fails if a
connection has no entry. Remaining: more empty states as pages grow.

## Agents and the phone

- Phone app: brettmboggs/switchboard-mobile (Expo, private). The phone is one
  more device on the account: it signs in to the sync service and talks
  through it and the relay, never to 127.0.0.1. First: Now (what needs you),
  sessions (state, queue a message, Esc), Actions, and push when a session
  needs you or a build fails. Brett starts the Apple side from the Mac.

## Agreed next (Brett, Nov 3), in this order

1. Deliveries. Done Nov 3.
2. Chores and routines. Done Nov 3: typed in Ctrl K ("feed the animals every
   day at 6am and 6pm", "filter every 90 days", "trash every tue at 7pm"), or
   picked from sixteen ideas on Notes; due ones are Needs-you cards with an
   alert; Done sets the next time, Skip, 1 hour; change when or rename.
3. Notebook. Done Nov 3: pages in projects with a formatting toolbar (style,
   size, bold, italic, underline, strikethrough, bullets, numbers, checklists,
   quote, line, indent, clear, undo), #tags, search in Ctrl K, sync; lists
   from Ctrl K ("shopping eggs"), the calculator ("3 × $12.50 ="), logs with
   totals ("log eggs 14"). Waiting on Brett's notes once he has used it.
4. Morning rundown: one beautiful card (weather, meetings, bills, what needs
   you, packages), read aloud if wanted. Design first; only ships if it looks
   great.
5. Connections, one after another: the free ones that need nothing from Brett
   first (RSS, Home Assistant, Todoist / Trello / Notion with a pasted key),
   then Slack and Discord (each needs a small app registered).

## Connections

Ordered by how many people they help per hour of work.

| Connection | What it brings | How | Effort |
|---|---|---|---|
| Any email (IMAP) | iCloud, Yahoo, AOL, Fastmail, Zoho, Proton (Bridge), most others by Thunderbird's directory | Done Nov 3. Outlook.com and Hotmail need Microsoft sign-in (next to do here) | S |
| Calendars | Today's events on Now; a heads-up 10 min before | Done Nov 3 by private calendar link (Google, Outlook, iCloud, any .ics). Next: iCloud/Fastmail/Yahoo through the email account's app password (CalDAV); a co-owned work tenant's calendar waits on its owner's okay | M |
| Slack | Messages and mentions in Inbox, reply | Slack app, free | M |
| Discord | DMs and mentions | Discord bot or OAuth, free | M |
| Google Drive / Docs | Files shared with you, comments that mention you | Google API, free | M |
| Todoist, Trello, Asana, Notion | Tasks due, assigned to you | Each has a free API | S each |
| Package tracking | Deliveries arriving today | Done Nov 3: Packages in the Today card, read from shipping emails (FedEx, UPS, USPS, DHL, Amazon, any shop); delayed is a Needs-you card. Outlook mail not read for it yet | S |
| Bank and cards | Balances, bills due, big charges | Teller free tier (now: alert emails) | M |
| Phone texts | SMS on Inbox | Google Voice (have, via email); Android companion app later | L |
| iMessage | Mac only, read local messages | Messages database on the Mac | M (Mac) |
| WhatsApp | Business accounts only (personal has no API) | WhatsApp Cloud API | M, limited |
| Home Assistant | Sensors, alerts (freezer, gate, water) | Local REST API, free | M |
| Weather | Today, frost and storm alerts | Done Nov 3: Open-Meteo forecast, NWS warnings in the US | S |
| System monitor | How busy this computer is (processor, memory, graphics, network, storage, temperatures, fans, apps) in Settings | Done Nov 4: live page, Linux verified; Mac and Windows unverified. Next: Windows fan and CPU temperature only through a tool the person runs (LibreHardwareMonitor) | M |
| Webhooks in | Anything else (IFTTT, Zapier, Home Assistant, a phone shortcut, a script) posts a note, to-do, reminder or "needs you" | Done Nov 3: a private link per webhook, on this computer and (signed in) from anywhere through the sync service, which seals each message to the webhook's own key | S |
| RSS | News, blogs, forums | Plain feeds | S |
| Browser tabs | Open tabs grouped by project, close a project's tabs at once | A small browser extension | M |
| Codex and Gemini sessions | "Needs you" like Claude | Watch their output (today) or their hooks if they add them | M |

## For everyone, not only AI users

- Shared spaces: invite family or a coworker into a project; shared lists,
  notes and reminders, each person on their own account. (L, needs the new
  accounts first.)
- Lists: groceries, packing, supplies. Check off together. (S)
- Recurring chores and routines: feed animals at 6, change the filter every 90
  days, rent on the 1st. They show on Now when due. (S-M, builds on reminders)
- Logs: a quick timestamped entry for anything (eggs collected, mileage,
  hours worked, a call). Totals by week and month. (M)
- Inventory: what you have and where, with "running low". (M)
- People: one page per person with every conversation across email, texts,
  Teams and Slack. (M)
- Phone and tablet: see Now and reply from your phone, through the relay you
  already have for computers. (L)

## Polish

- Search everything from Ctrl K: messages, notes, sessions, people. (M)
- Undo for archive, done and delete. (S)
- Keyboard shortcuts with a cheat sheet on ?. (S)
- Remember scroll position and selection per page. (S)
- Accessibility pass: focus order, screen reader labels, contrast in dark. (S)
- Tests for each connection's parsing, and a smoke test that loads every page.
  (M, ongoing)
- Error reports: a "something went wrong" line with a copy-details button,
  never a silent failure. (S)
- Mobile-friendly layout for small windows. (M)

## Security

Switchboard can type into terminals, so a hole in it is a remote shell. The
rules every change keeps:

- The server listens on 127.0.0.1 only; every POST needs the X-Switchboard
  header and a local Host; terminals need a same-origin WebSocket.
- The page runs only its own scripts (Content-Security-Policy), and all text
  from outside (mail, chats, calendars, weather, feeds) goes through esc().
  HTML from outside is shown only in a sandboxed frame.
- Synced data and relay messages are encrypted on the computer; the sync
  service stores ciphertext and slow hashes. New computers get the key only
  by approval with a matching code, the recovery key, or the password.
- Sign-in only ever returns to 127.0.0.1 / localhost; state and PKCE checked.
- No secrets in the repo; product secrets are Worker secrets.
- npm audit stays at 0; no new dependency without a real need.

Open, in order:
1. Done Nov 3: Settings, Accounts lists every computer on the account with
   Remove (cuts its live link at once), and a per-computer switch for whether
   other computers may see and use its sessions.
2. Done Nov 3: rate limits on sign-in, sign-in links and pairing.
3. Done Nov 3: passwords, tokens and private links are locked on disk with
   this computer's own key, kept in the OS keychain (GNOME Keyring / KWallet,
   macOS Keychain, Windows DPAPI). Linux verified; Mac and Windows unverified.
4. A security review pass after each big feature (/code-review). (ongoing)

## Maintainability

- Tests for every parser and every crypto step (npm test); the setup registry
  test; one place for OS-specific code.
- Done Nov 3: the page split into ten files in public/js, and the API into
  six files in lib/routes (server.js from 650 lines to 250). No build step.
- Next: settings.js on the page (500 lines) splits further when it next grows.

## Known issues

- Terminal still glitches when the same session is open on two computers at
  once (reported Nov 3, after the "device in use sets the size, others scale"
  fix). Reproduce with the Mac and Linux both showing one session; check the
  Mac is on the latest version first, since the scaling needs both sides updated.

## Parked

- Apple sign-in and anything else that costs money (until paid services are
  allowed).
- A co-owned work tenant's Microsoft 365 data beyond Teams and Outlook (needs the co-owner's okay; see docs/HANDOFF.md).
- Automatic sending of anything. Every send stays an explicit click.

## Done recently

- Sessions: model and effort (Nov 4). New session has Model (Default, Sonnet,
  Opus, Haiku, a 1M-context box) and Effort (Default to Max) for Claude and a
  model box for Codex, remembered per folder, passed as `--model` / `--effort`
  and kept on the session. Typing `/` in the message bar lists Claude's
  commands and the folder's skills (`.claude/skills`, `.claude/commands`,
  `~/.claude/skills`; lib/slash.js) with one line each; `/model` opens
  Claude's picker, which the agent-menu reader now shows as buttons (checked
  against the real one). The session's bar reads "Opus 5.5 · high · 39% ·
  $0.42" live from Claude Code's status line (bin/statusline.sh, set by setup
  only for someone with no status line of their own) and from the SessionStart
  and PostModelSwitch hooks. `/effort` is a slider, so it stays in the terminal.
- Release plumbing (Nov 4): Settings, General, About shows the version, build
  and computer with Check for updates and an Updates: Stable | Latest switch
  (lib/update.js moves the checkout's upstream between origin/stable and
  origin/main); `npm run setup` picks stable when the remote has it; README
  clones `-b stable`. `scripts/publish.mjs` gained `--version`, `--tag`
  (tag plus the public `stable` branch), `--dry-gate-only` and `--help`.
  `scripts/notices.mjs` writes THIRD-PARTY-NOTICES.txt, which the desktop
  bundle carries. ESLint (flat config, no plugins, page scripts' shared names
  generated) runs in CI with a weekly schedule; Dependabot weekly.
- Notes, voice and sessions (Nov 4): a mic on the page editor's bar that
  dictates at the caret through the editor's own insert path (one undo, the
  sanitiser on save), and one on Quick notes; Send to session on a page and
  on each quick note (picker of open sessions, a ready-made or free-text line
  above the text, lands in the message bar, Enter sends); `today …` in Ctrl K
  for a timed line on the day's page per project; the sanitiser in its own
  file (public/js/sanitize.js) with a headless-Chrome test, which caught
  `<svg><script>` slipping its text through (foreign elements keep lowercase
  tag names).

- Sessions named by their work: Claude Code's terminal title (the topic it
  sets, status glyph dropped) is a session's name everywhere until Brett
  renames it; clearing the name goes back to it. tmux pane titles, or the
  title codes in a direct session's output (Mac and Windows: unverified). (Nov 3)
- Sessions as lines: the tab strip is gone. The panel's one job is picking a
  session: one row each, grouped by repo without the repo name repeated,
  state in a column of words, a second line only for a queue or a failed
  build, a fixed order, orange only for needs you; it follows the project
  filter and shares the console's top and bottom edges. The session's own
  things sit with it: branch, build, linked chats on its bar; Stop and More
  (rename, linked chats, End session asks twice) always in reach. Bring in a
  message opens from the message bar. Page tabs and queued messages are words,
  not pills. (Nov 3)
- Sessions grows tabs: Sessions · Builds (the old Actions page, its light on
  the Sessions link; #actions still works) · Browser checks (one line per
  check, one "Add a check" with a short form, details on click). PAGES in
  core.js takes a parent, so later kinds of session (plain chat with your
  account, a desktop worker) slot in as more tabs. Agents get
  switchboard_checks and switchboard_add_check. (Nov 3)
- Terminal view fits (Nov 3, late): tmux's status bar is off for Switchboard's
  sessions (it took the bottom row, pushing Claude's last line off), the
  terminal's inner space moved onto xterm itself (its fit ignored the box's
  padding and drew a row too many), and Sessions sit 28 px clear of the
  window's bottom, with a closed bottom edge when there is no message bar.
- Never lose a draft (Nov 3, late): an update's reload waits while Brett types
  or dictates (a quiet minute, no filled text box in use), and drafts are kept
  in the browser, so a reload or a closed tab brings them back.
- Sessions open as a chat (Nov 3, late), or the terminal: Settings, Look,
  "Sessions open in", offered once in the first chat. One place to
  type (the message bar in Chat; in Terminal the bar steps aside). Claude's
  permission prompts and questions are read off its tmux screen
  (lib/agentmenu.js) and shown as buttons; an answer is arrow keys and Enter,
  sent only if the same question (same sig) is still up. A message while it
  asks answers No and goes straight in. The working line says what it is
  doing (its newest tool call without a result). Not yet: Codex in Chat (its
  rollouts in ~/.codex/sessions hold messages; tool calls not yet checked),
  reading the screen without tmux (Windows), streaming text as it is written
  (the transcript only gets whole messages).
- Chat view on Sessions (first version, Nov 3): Claude Code's own
  transcript read by byte offset (tail, then only what is new; never the whole
  file) and drawn as a conversation with safe markdown, tool calls on one line
  that open to input and result, a "Needs you" card with Answer in terminal.
  Updates come from a file watch as a small "chat" event, not polling. Claude
  only: Codex's rollout format could not be checked here; remote sessions keep
  the terminal. Also opt in: changed files, ahead/behind and the branch's pull
  request with checks on the session bar (git every 20 s per folder at most,
  gh once per branch per 3 min), and terminals drawn by the GPU (xterm WebGL,
  falls back on failure or context loss). (Nov 3)
- Inbox conversations like Teams or Discord: a picked conversation opens large
  beside a narrow list (Details folds out on the right), messages grouped by
  sender with initials, day separators, clickable links, chat bubbles for
  Teams and texts and cards for email, the reply box pinned at the bottom. It
  is drawn once and only added to, so board refreshes no longer reset it or
  scroll it to the top; it follows new messages only when you are at the
  bottom ("new messages" otherwise). Live: an open Teams chat is checked every
  4 s while visible (lib/conversation.js, one small Graph request), mail on
  every mail check and right after a reply; replies show at once and are
  confirmed. Teams inbox poll 60 s to 30 s. (Nov 3)
- The Switchboard app (desktop/, Tauri v2): download, double-click, own icon,
  window and tray icon; bundles Node and starts the server unless one is
  already running; starts at login; signed updates from GitHub Releases. The
  Desktop app workflow builds Windows, Mac and Linux installers into a draft
  release. Left for Brett: the two updater secrets, where public releases live
  (the repo is private), Mac signing. See desktop/README.md. (Nov 3)
- Terminal redesigned as one console card: a bar with the session's state and
  how long it has been in it, agent, branch, build light, queued count and
  folder, text size, Copy and Stop; JetBrains Mono and sixteen colours tuned to
  the counter; an orange line when it has focus; the message bar in the same
  ink. Session tabs: repo label over compact pills, the open one solid. (Nov 3)
- Browser checks, with no browser open: a project's Playwright tests (folder
  plus command, the project's own Playwright) or a page that must load and
  show some text, run in headless Chromium on a click or hourly / 6-hourly /
  daily, one at a time. Actions page card with the same lights as GitHub runs;
  the panel shows failing tests, their errors and screenshots, earlier runs and
  the output; a failure is a Needs-you card on Now until it passes or is
  cleared. Opt in: `node scripts/setup.mjs browser` installs the pinned
  Playwright MCP's Chromium and registers a headless "playwright" MCP server
  with Claude Code, Codex and Gemini CLI (`browser remove` or `remove` takes it
  out). Playwright is not a dependency. A project without Playwright tests can
  use page checks today. (Nov 3)
- Switchboard as an MCP server (bin/mcp.mjs, no dependencies): Claude Code,
  Codex and Gemini CLI get tools to see what needs Brett, put a note, to-do,
  reminder or needs-you on the board, list sessions on every computer, queue
  a message into another session, and read live Actions runs. Mail, chats and
  money are left out on purpose. `npm run setup` (or `node scripts/setup.mjs
  mcp`) registers it with each agent installed. (Nov 3)
- Sessions grouped under the repo they work in (worktrees and clones of one
  repo together), branch shown when it isn't main; rename a session from its
  panel or by double-clicking its tab (empty name puts the folder back). (Nov 3)
- AGENTS.md is the one rules file for every agent (Codex, Gemini, Cursor,
  Copilot read it); CLAUDE.md imports it. (Nov 3)
- Notebook: pages with a formatting toolbar like an email, checklists, a
  calculator, lists from Ctrl K and logs with totals; search; synced. (Nov 3)
- Chores and routines: things that come back on their own, on Now when due,
  with ideas to pick from on Notes. (Nov 3)
- Packages: shipping emails become one line each in the Today card (out for
  delivery with its window, arriving Thursday, delivered, ready for pickup);
  delayed is a Needs-you card; Track it opens the courier's page. (Nov 3)
- Webhooks in: a private link per webhook for IFTTT, Zapier, Home Assistant,
  a phone shortcut or a script; Settings, Accounts, with Test and New link. (Nov 3)
- GitHub Actions, live: an Actions page with every recent run per repo in
  GitHub's colours (yellow glowing while it runs, green, red), jobs and the
  step that is on, re-run failed and cancel. Checks every 10 s while a run is
  going and every 20 s for the repos sessions work in; a push from a session
  is looked at on the next check. Each session shows its repo's runs (its
  branch first) and a light on its tab. (Nov 3)
- Bring in a message: Add on a session brings in one message with who sent it
  and when, not the whole conversation; the arrow lists earlier messages,
  each with its own Add. (Nov 3)
- Settings rebuilt: sections, account cards, project editor, notification
  switches and quiet hours, theme and text size. (Nov 3)
- Talk to type in any browser: Live (browser speech) or Private (Whisper on
  this computer). Enter stops dictation, Enter again sends. (Nov 3)
- Terminal stays readable on every device at once. (Nov 3)
- Paste images into the message bar. (Nov 3)
