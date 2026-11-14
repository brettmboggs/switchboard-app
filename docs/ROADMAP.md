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
  connecting. A connection is: sign in once in Settings, Connections; its items
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

Web board, the full product (Nov 6, Brett): step 1 done, clicked through in a
test copy: Sessions, Builds, Browser checks, Calendar and Money on the board
from what shared projects share. Next: 2. General, Look and Notifications in
the board's Settings, Gmail and Google Calendar by Google sign-in (needs a
Google sign-in client); 3. editing money, calendar and checks from the board.

Forgot password (Nov 6, Brett): a one-time code from a teammate (Settings,
Team, Reset their password) and a new password. The person stays in every
project with the same access: the code-maker's computer re-locks them within
seconds. Clicked through end to end in a test copy (invite, join, reset,
back with everything, edits flow both ways). Codes by email are built but off
(no Resend account). Next: a way for someone in no shared project (Brett
himself) to reset without email.

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

- Phone app: brettmboggs/switchboard-mobile (Expo, private). Working on
  Brett's Mac (Nov 4). The phone is one
  more device on the account: it signs in to the sync service and talks
  through it and the relay, never to 127.0.0.1. First: Now (what needs you),
  sessions (state, queue a message, Esc), Actions, and push when a session
  needs you or a build fails. Brett starts the Apple side from the Mac.
- Phone, Nov 5: the phone may also read Calendar (GET /api/calendar), add,
  change and delete events (/api/calendar/event), and press Done on a task
  app's task (/api/tasks/close); never connecting Todoist or Google. The sync
  service lists the phones that get pings (GET /v1/push/list) so the phone
  can stop pings to an old install or Expo Go (whose banners show Expo's icon).
- Phone, Nov 8: Jarvis as a walkie-talkie. The phone may ask Jarvis
  (POST /api/jarvis, waited on up to 45 seconds) and warm its model
  (/api/jarvis/warm); it hears you on the phone and speaks the answer in the
  phone's voice. Never Jarvis's memory or the streamed route.

## Agreed next (Brett, Nov 3), in this order

1. Deliveries. Done Nov 3.
2. Chores and routines. Done Nov 3: typed in Ctrl K ("walk the dog every
   day at 6am and 6pm", "filter every 90 days", "trash every tue at 7pm"), or
   picked from sixteen ideas on Notes; due ones are Needs-you cards with an
   alert; Done sets the next time, Skip, 1 hour; change when or rename.
3. Notebook. Done Nov 3: pages in projects with a formatting toolbar (style,
   size, bold, italic, underline, strikethrough, bullets, numbers, checklists,
   quote, line, indent, clear, undo), #tags, search in Ctrl K, sync; lists
   from Ctrl K ("shopping eggs"), the calculator ("3 × $12.50 ="), logs with
   totals ("log eggs 14"). Waiting on Brett's notes once he has used it.
4. Morning rundown. Done Nov 4: until noon the top of Now is one card (the
   day in a sentence, four figures, the schedule beside needs you, bills this
   week, routines and packages), Read aloud with a voice on the computer only,
   Done for today, Rundown on the Today card at any hour, a switch in
   Settings, Look.
5. Connections, one after another: the free ones that need nothing from Brett
   first (RSS, Home Assistant, Todoist / Trello / Notion with a pasted key),
   then Slack and Discord (each needs a small app registered).

## Agents: next (Brett, Nov 4)

- Local AI models, easily. First part done Nov 4: Settings, Connections,
  Local AI models installs Ollama (one click, in a session), starts it, and
  gets a starter model (llama3.2, qwen2.5-coder:7b, gemma3:4b); New session's
  Agent "Local model (Ollama)" lists the pulled models and runs `ollama run`.
  LM Studio, llama.cpp's server and Jan show when they answer on localhost.
  Done Nov 4: LM Studio's downloaded models start sessions the same way
  (Agent "Local model (LM Studio)", `lms chat <model>`; lms found on the PATH
  or in ~/.lmstudio/bin). Tested on Linux with Gemma 4 12B.
  Done Nov 5: local sessions read like a chat (bin/localchat.mjs against the
  model's own server; checked end to end against a stand-in LM Studio server,
  not yet a real model). Codex in the Chat view done Nov 5 (its rollout log;
  approvals still answered in Terminal). Next: Claude Code or Codex pointed
  at a local model. Mac and Windows install commands unverified.
  Done Nov 13: Switchboard runs the model itself (lib/engine.js, llama-server
  from LM Studio's engines, sized to the card) and owns the card; Jarvis and
  Local AI sessions (Sessions, New session) share it, and Bionic is no longer needed. Next: download
  a model from the page (today LM Studio or Bionic downloads it); Mac and
  Windows engine folders unverified.
- Outlook.com and Hotmail: parked (Nov 4). Outlook.com mail has no app
  passwords since 2024, so it needs Microsoft sign-in with personal accounts
  allowed on the Switchboard app (a setting in Microsoft Entra, Brett's), and
  Switchboard holds one Microsoft account at a time today.

## Project dashboards (Brett, Nov 11) — first part done Nov 11

Done Nov 11: the Dashboard tab on every project (templates, tiles, Set up),
website checks from outside (pages, links, speed in a headless browser on
Lighthouse's scale, Google PageSpeed with a free key), fixes worst first,
numbers of your own, the analysis in words, the baseline and change since,
weekly re-checks, Make PDF into the project's Files, CSV, and Jarvis entries.
Next: Search Console, Analytics and Business Profile once a client gives
access (sign-in per lib/checkauth.js's pattern), a live page the client can
open without Switchboard (the web board's share links), and an AI-written
monthly summary from Jarvis's model.

Every project gets a dashboard of its own, set up for what that project is:
pick the tiles from a catalogue, or start from a template (a client's website,
a product, a household). It reads plainly at a glance, carries its
own analysis in words, and exports outside Switchboard as a PDF report (the
browser's own print to PDF, no new dependency) and the numbers as CSV.

First real use: SEO and marketing for a client (meeting Fri Nov 13). What it
has to do there:
- **Baseline first.** A dated snapshot of every measurable thing on day one,
  before any work, so every later number is "from here to here". This is the
  part that can't be made up later: miss the start and the proof is gone.
- **Track over time.** The same readings on a schedule (weekly), kept in the
  project, drawn as charts that fill the screen (no scrolling).
- **Analysis.** What moved since the baseline and since last time, what
  probably caused it (work done, logged as notes in the project), what to do
  next; written by Jarvis's model or Claude.
- **The report.** One click: a clean PDF with the baseline, the change, the
  charts and the analysis, ready to hand the client.

What can be measured for free (No paid services rule):
- With the client's permission (they add Brett as a user; sign-in follows
  lib/checkauth.js's pattern): Google Search Console (clicks, impressions,
  click rate, average position per search and per page, pages indexed),
  Google Analytics 4 (visits from search, leads, calls, sales), Google
  Business Profile (rating, review count, calls, direction requests; its API
  needs Google's approval, which can take weeks), Bing Webmaster Tools
  (incoming links).
- Public, no permission needed: speed and Core Web Vitals (PageSpeed
  Insights), a crawl of their site (titles, descriptions, headings, broken
  links, structured data, images), the public star rating and review count,
  whether AI assistants mention them, and uptime (browser checks).
- Paid only: daily rank tracking for many keywords, full backlink indexes
  (DataForSEO, Ahrefs, Semrush). Needs Brett's yes on the paid rule, perhaps
  billed to the client.

Rules it keeps: a client's data stays in its own project (Shared accounts
rule); Jarvis can read any dashboard and make the report ("how is <client>
doing", "export the report"); a tile is a new component with its own CSS file
and a paragraph in DESIGN.md.

Open questions for Brett: listed in the Nov 11 conversation; answers go here.

## Connections

Ordered by how many people they help per hour of work.

| Connection | What it brings | How | Effort |
|---|---|---|---|
| Any email (IMAP) | iCloud, Yahoo, AOL, Fastmail, Zoho, Proton (Bridge), most others by Thunderbird's directory | Done Nov 3. Outlook.com and Hotmail need Microsoft sign-in (next to do here) | S |
| Calendars | Today's events on Now; a heads-up 10 min before | Done Nov 3 by private calendar link (Google, Outlook, iCloud, any .ics). Done Nov 4: iCloud, Fastmail and Yahoo straight from the email account's app password (CalDAV, lib/caldav.js), tested against a stand-in server only, not yet a real account; a co-owned work tenant's calendar waits on its owner's okay | M |
| Slack | Messages and mentions in Inbox, reply | Slack app, free | M |
| Discord | DMs and mentions | Discord bot or OAuth, free | M |
| Google Drive / Docs | Files shared with you, comments that mention you | Google API, free | M |
| Todoist, Trello, Asana, Notion | Tasks due, assigned to you | All four done (Todoist Nov 4; Trello, Asana, Notion Nov 5, lib/taskapps.js): pasted keys, due today or overdue on Now, Done closes it in the app, each its own card and tile. Checked against stand-ins and each service's own refusal of a wrong key; no real account tried yet | S each |
| Package tracking | Deliveries arriving today | Done Nov 3: Packages in the Today card, read from shipping emails (FedEx, UPS, USPS, DHL, Amazon, any shop); delayed is a Needs-you card. Outlook mail not read for it yet | S |
| Bank and cards | Balances, bills due, big charges | Teller free tier (now: alert emails) | M |
| Phone texts | SMS on Inbox | Google Voice (have, via email); Android companion app later | L |
| iMessage | Mac only, read local messages | Messages database on the Mac | M (Mac) |
| WhatsApp | Business accounts only (personal has no API) | WhatsApp Cloud API | M, limited |
| Home Assistant | Sensors, alerts (freezer, gate, water) | Local REST API, free | M |
| Weather | Today, frost and storm alerts | Done Nov 3: Open-Meteo forecast, NWS warnings in the US | S |
| System monitor | How busy this computer is (processor, memory, graphics, network, storage, temperatures, fans, apps) in Settings | Done Nov 4: live page, Linux verified; Mac and Windows unverified. Next: Windows fan and CPU temperature only through a tool the person runs (LibreHardwareMonitor) | M |
| Calendar by voice and Ctrl K | One line adds, moves, renames or cancels an event on a Google calendar ("lunch with Sam fri noon to my calendar"); Jarvis reads the calendar back; Add event always on the Calendar page | Done Nov 10: tried end to end on Brett's Google calendar: added, moved, renamed, cancelled with a yes, all through Jarvis's quick commands; an event made on Google directly reached the board in 22 s. Google read every minute; duplicates from an old link hidden. Next: Google push notifications through the sync service for instant updates | S |
| Mail tracking | Brett's mail tracker through Switchboard: tracked sends and replies, Inbox, Tracking with opens, clicks and verdicts, "Tracks you" on mail from senders who track you, alerts, Jarvis | Done Nov 10: tried end to end against the tracker Worker run locally (registered, pixel and link answered, a likely-person open with its reasons, a Mailtrack sender caught). Waits for Brett's token for his live tracker. Next: Outlook replies tracked; clean tracked links in received mail; decide whether the tracker's code moves into this repo | M |
| Books and read aloud | Brett's notes, Nov 10: read archive.org books like a book, bookmarks, highlights, notes, tags, a library, read aloud. Inbox, Reading: free archive.org books on their own scans with an OCR word layer (highlight, note, read from here), Width/Page/Text/Night, shelves and tags, sentence-by-sentence read aloud with Piper (Ryan, American) or the built-in voice, LibriVox audiobooks, a corner player on other pages, Jarvis "continue reading", "read to me" | Done Nov 10: tried on Pride and Prejudice (1927 scan) in a test copy: added, highlighted, noted, read aloud across a page turn, LibriVox chapter played. Next: library, places and notes synced between computers; a PDF or EPUB from disk; keep a whole book offline in one go; highlights out to a Notes page; Jarvis speaking with Piper is a switch, off until Brett picks it | L |
| Network test | A speed test built in (download, upload, latency, jitter, packet loss, bufferbloat, router vs internet, past results) in Settings, System and on the monitor | Done Nov 10: Linux verified on cable. Mac and Windows unverified (router and loss Linux first; Wi-Fi details need nmcli). Jarvis runs it ("test my internet") and says the result. One screen, no scrolling. Next: a scheduled test to catch slow evenings | M |
| Jarvis does everything | Every action in Switchboard is in one catalogue Jarvis searches and runs (find_action, do_action); deletes wait for a yes, sends stay Brett's click; a test keeps every route in it | Done Nov 10: catalogue of 242 routes, tried on the live server with the tools directly. The model path waits for LM Studio to be running. Next: voice yes for deletes tried by voice | M |
| Webhooks in | Anything else (IFTTT, Zapier, Home Assistant, a phone shortcut, a script) posts a note, to-do, reminder or "needs you" | Done Nov 3: a private link per webhook, on this computer and (signed in) from anywhere through the sync service, which seals each message to the webhook's own key | S |
| RSS | News, blogs, forums | Done Nov 4: follow a site or its feed (RSS 1.0, 2.0, Atom; a site's own feed link is found) in Settings, Connections; posts on Inbox, Reading, kept 30 days, never on Now | S |
| Browser tabs | Open tabs grouped by project, close a project's tabs at once | A small browser extension | M |
| Codex and Gemini sessions | "Needs you" like Claude | Watch their output (today) or their hooks if they add them | M |

## For everyone, not only AI users

- Shared spaces, now a team (L). Built Nov 5: Settings, Team, people first;
  per person their projects, admin or member, and None / See / Edit per kind
  (pages with Only me, to-dos, repos with Codespaces, ZIP, GitHub and Clone,
  activity, About), each kind its own key, every change signed and checked by
  everyone; invites by email before an account exists (one-use link, 14 days,
  joining in one step; branded email from your own mail); your own sync
  service; 0.2.6 shares move over by themselves. Needs schema-v6.sql deployed.
  Web board (stage 2) built Nov 5: the sync service serves the page at your
  own domain; members sign up, join and work in shared projects in a browser
  (pages, to-dos, About, repos, builds and pull requests from members' own
  GitHub, activity), live over the relay. Not yet on the web: sign-in with
  Google, Microsoft or GitHub. The board is now each person's own full
  Switchboard (projects, notes, to-dos, Team), synced to their account, with
  Microsoft 365 and GitHub connected in the browser; every kind a project has
  is shared on its own, sessions live with Send and Approve. Next: the same
  share core for sessions on the board's own Sessions page, Gmail by Google
  sign-in in the browser, pictures in replies on the board. Then: sessions through the relay
  (stage 3), shared conversations (stage 4), merging two edits to one page,
  files, Windows and Mac checked by hand.
  Team chat built Nov 5: a channel per shared project and one-to-one chats
  with teammates, in the Inbox, end to end encrypted, with seen, typing, edit
  and delete your own, reply, @mention and pin; alerts and phone pushes for
  one-to-one messages and mentions. Needs schema-v8.sql and a worker deploy.
  Not yet: on the web board, files other than pictures, search inside chats.
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

- Signed-in browser checks (Nov 4): built, Linux only so far. Needs a first real run against a Microsoft sign-in, and a look on Mac and Windows (file modes, the window).

- Messages beside sessions (Nov 4, Brett): a Teams message from a teammate about
  a project never showed while working in it; linking was a manual step hidden
  behind Messages. Now the session's project's newest conversations are always
  under the session list. Next, if wanted: new messages from a person also
  queue into the session by themselves (the links table does this for a Teams
  chat once linked).

- Claude's multiple-choice questions in the chat (Nov 4, Brett): AskUserQuestion's
  tabs, descriptions, tick boxes, Submit, Type something and the review are
  read off the screen and answered from the chat; checked end to end against
  a real Claude Code 2.1 session.

- Files everywhere (Nov 4, Brett): any file into a session's chat or
  terminal, pictures and files in notes, project files of any type up to 1 GB,
  streamed to disk (lib/attachments.js). Not yet: files to a session on another
  computer, and syncing a note's pictures to other computers.

- Search everything from Ctrl K. Done Nov 5: sessions (here and remote), people
  on project pages, 60 days of mail and Teams, pages and notes, projects, and
  Switchboard's features (lib/search.js, public/js/search.js); then calendar
  events, money and mail past 60 days (Nov 5). Mail is only as old as this
  computer keeps it (about two weeks on the first install); searching Gmail
  itself for older mail is not done.
- Undo for archive, done and delete. Done Nov 4: six seconds, Undo on the
  toast or Ctrl+Z; a closed tab still sends it.
- Keyboard shortcuts with a cheat sheet on ?. Done Nov 4: ? for the sheet,
  G then N / S / B / I / M / O to go to a page, comma for Settings.
- Remember scroll position and selection per page. Done Nov 4: per tab
  (sessionStorage), a link to a given item wins.
- Accessibility pass: focus order, screen reader labels, contrast in dark.
  Done Nov 4: every page, Settings pane and dialog scanned in light and dark
  for unnamed controls and text under 4.5:1 (3:1 large); two fixed (the Done
  pill, the current page's count in dark). Screen reader run-through by a
  person still to do.
- Tests for each connection's parsing, and a smoke test that loads every page.
  (M, ongoing)
- Error reports: a "something went wrong" line with a copy-details button,
  never a silent failure. Done Nov 4 for the page (any uncaught error);
  server-side failures still show only where a click reports them.
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
  Nov 4: still there, but small. Moving from one computer to the other, the
  terminal shows the other computer's size until you click in it; the click
  fixes it at once. Resting the mouse on it (aaf5cc6, 400 ms) did not fix it,
  so the claim is probably not being sent, or not taking effect, until a key
  or click. Look at what the click does that the hover does not (term.focus,
  the relay's size message) before trying anything else. Low priority.

## Parked

- Apple sign-in and anything else that costs money (until paid services are
  allowed).
- A co-owned work tenant's Microsoft 365 data beyond Teams and Outlook (needs the co-owner's okay; see docs/HANDOFF.md).
- Automatic sending of anything. Every send stays an explicit click.

## Done recently

- Granola (Nov 6, Brett's notes): Settings, Connections, Sign in with Granola
  (any plan; an API key on Business); meeting notes from the last 30 days,
  then every new or changed one, come into Notes as pages, in the project of
  their Granola folder, people or title. Run on Brett's free account: a real
  note came in. The API key route is tested only against a stand-in.
- Sessions run other sessions (Nov 6, Brett's notes): an agent can start a
  session in a folder with a first message, read what any session here said
  (waiting until it finishes), and end the ones it started. Tested against a
  stand-in server, the session routes on a test copy, and one real run (start
  with a first message, wait for the answer, end). Done the same day: Send to session in Notes offers to
  start a session in the note's project folders (or any folder) when none is
  open, and the note goes in once it is ready. Checked on a test copy (the
  start request stubbed) and a real start through the same route.
- Email drafts in Inbox (Nov 5, Brett): every draft in the Drafts folder,
  in its conversation or at the top of Inbox; Edit, Send, Save draft, Discard.
  Checked on Gmail end to end with two test drafts (save shows in Gmail in the
  same thread, discard leaves nothing); Send uses the reply path and was not
  tried with a real recipient. Other IMAP accounts read their Drafts folder the
  same way, untried.
- Ctrl+Q quits the Switchboard app (Nov 5, Brett): the page side is live and
  checked; the app side (desktop/src-tauri/src/main.rs) needs the next desktop
  release, untested until then.
- From Brett's build notes (Nov 5): a session started as another command that
  turns out to be Claude (a project's own worker sessions) opens as a chat too; the morning
  rundown no longer repeats the Needs-you list that sits right under it (its
  figure and sentence stay); the dots on a session's event list are no longer
  cut off; in a Claude session's terminal Shift+Enter is a new line and
  Ctrl+Enter sends now.
- Connections as a list you choose (Nov 5, Brett): Settings, Connections
  shows Your connections (connected or added) and, below, Add a connection:
  tiles by category with Add, and what is coming. Remove from list on any card
  not connected. Set up from the welcome or What's new adds the card first.
- File names in the chat open (Nov 5): a file an agent names that exists on
  this computer is a link, in Chat and in Terminal view; the reader shows markdown as a page, code with the
  named line lit, pictures full size, and Open, Show in folder, Copy where it
  is. Files it sends (SendUserFile) are cards with the picture shown. Linux
  checked (Nemo picks the file out); Mac (open -R) and Windows (explorer
  /select) unverified. Sessions on another computer too (Nov 5): that computer
  checks the names and sends the text or picture (up to 450 KB) over the
  relay; Open and Show in folder stay there. Not yet tried with a real Mac
  session (both computers need this version).
- The pitch (Nov 5): seven headline features with a one-paragraph "why it's
  cool" and a 20-second demo each (docs/headlines.json); npm run pitch writes
  docs/PITCH.md (headlines, then every feature from the setup registry) and
  the top of README.md; test/pitch.test.js keeps them in step. Next, when
  wanted: videos from the demo scripts.
- Projects as pages (Nov 4): a project on the rail opens its own page
  (#project/<id>): in flight, conversations, sessions, notes, files dropped on
  the page (kept on this computer, 50 MB each, download only), and on the side
  About, People (name, role, email, phone; Found in your mail offers everyone
  written to in that project, Add or Hide) and Links (site, admin, repo).
  Files stay on one computer until that is a problem (Brett, Nov 4); admin
  links stay links, no stored client passwords.
  Filtering a list by project moved to a picker in the head of Now, Sessions,
  Builds, Inbox, Money and Notes. Ctrl K files into the open project's page.
- What belongs to a project (Nov 5, Brett): In this project on each project's
  page (repos, people, addresses, chats, pages and sections; Add searches
  everything; many projects per thing; a note tied to one repo), Unsorted with
  Hide (folders that are not repos, forks and agents' copies told apart in the
  folder picker), notes beside sessions and switchboard_notes for agents, and
  Ctrl K note / sesh with a picked target. Next, when wanted: the same target
  pattern for mail, event and bill; drag from Unsorted onto a project on the
  rail; Brett to tweak the look once his real data is in it.
- Sessions (Nov 4): End is on the bar and asks once in place, with no timer;
  Stop says what it does and is grey when there is nothing to stop. A session
  stays Working while its helpers (sub-agents) run and says so, and is Your
  turn only when the last is back (SubagentStart / SubagentStop hooks;
  `node scripts/setup.mjs hooks` refreshes an older install).
- News and blogs (Nov 4): Settings, Connections, News and blogs follows a
  site (its feed is found) or a feed address, per project; Inbox, Reading
  lists the newest posts, unread in bold, a click opens the post and marks it
  read, Mark all read. Checked every 30 minutes. A news page with no feed is
  watched instead: its article links one level under the page become posts,
  dated when first seen. A single post's address (…/whats-new/2026-w37) tries
  its parent page too. Read posts leave the list; each feed keeps its 3
  newest however old, so a quiet feed is not empty. Only plain text is kept;
  nothing on this computer or the local network is fetched.
- Calendars from an email account (Nov 4): an iCloud, Fastmail or Yahoo
  account in Switchboard shows "Find calendars" under Calendars; tick the
  calendars, pick a project, Add. Read over CalDAV with the mail's app
  password, only over https and only to that provider's own hosts (a redirect
  elsewhere is refused before the password is sent). Unverified against a
  real account: nobody here has one yet.
- Recurring costs (Nov 4): Money has a Recurring costs card (a month and a
  year, split by project, add and edit in the side panel, weekly, monthly,
  every 3 months or yearly); each project's page has its own. Charges and
  receipts from the email seen in two or more months at about the same amount
  are offered (Add fills the form; Not recurring is remembered). Bank balances
  (Teller) and Stripe wait until someone needs them (Brett, Nov 4).
- Settings, Connections (Nov 4): every connection in its own section,
  grouped (Messages, Calendars, Money, Coding and sessions, Automation) with
  a search box and "Coming next" saying what each needs; Account keeps the
  Switchboard sign-in and computers.
- New session's folder list (Nov 4): your folders first; agents' git worktrees
  (a .git file pointing back at a repo) in "Agents' work copies" at the end,
  each named with the repo it copies, and left out of Browser checks' list.
- Dialogs keep their frame (Nov 4): Settings' sections, title and Done stay
  put and only the pane scrolls; the same for every sheet and the System
  monitor, and DESIGN.md makes it the rule for anything new.
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
  release. In daily use on Brett's Linux machine (Nov 4: the AppImage opens
  its window onto the already-running service); tray and self-update still
  unchecked. Left for Brett: the two updater secrets, where public releases live
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
- Jarvis (Nov 8, Brett: "lets make Jarvis"): the orb in the corner, hold
  Ctrl+Space and talk. Quick commands with no model (pages, what needs me,
  open a session, reminders and to-dos); anything else to a local model
  (LM Studio or Ollama) with Switchboard's tools; real work handed to a Claude
  session. Tested on Linux with the quick commands; the model path waits for
  LM Studio to be installed again (its models are still on disk). Next: a
  better voice (Piper), a wake word, and the futuristic redesign.
- AI plan limits with a forecast (Nov 8, Brett's build notes): Claude's 5-hour
  and weekly windows (and Codex's) as charts on the Deck and Now, where the
  pace lands at reset, the time it would run out, each day's use, and a gauge
  per window on a Claude session's bar. Done; tested with a simulated week.
- Jarvis, from the repo hunt (Nov 8; OpenClaw, nanobot, Leon, OpenJarvis,
  Pipecat, ethanplusai/jarvis): answers in under a second (thinking off,
  streamed sentence by sentence, model warmed on Ctrl+Space, talk over to stop,
  tones); speaking up about sessions (switch, off by default); a spoken
  morning brief; memory (a capped card, a searched log, a nightly tidy with
  Undo); his manner set in Settings; a backup model server and a stop on
  repeated tool failures. Done, tested on Linux with LM Studio and Gemma 4.
  Next: voice approvals (Brett to decide), a wake word, a better voice.
