# Decisions

Why Switchboard is built the way it is. One entry per choice that shapes the
code: what was decided, why, and what would change it. New decisions go at
the bottom with the date. Read this before proposing to do something a
different way; if the reason no longer holds, change the entry and the code
together.

## Shape of the program

**Local only, on 127.0.0.1:4747.** (Nov 1 2026) The whole point is that mail
passwords, tokens and transcripts never leave the computer. A hosted
service would need accounts, a privacy policy with teeth, and money. Would
change if: never for the core; a read-only web view goes through the sync
service and relay, not by opening this server.

**Node 22 with `node:sqlite`, no framework, no ORM.** Node 22 is on every
platform, SQLite is one file the person can copy, and `node:sqlite` removes
a native dependency. Would change if: `node:sqlite` is removed or a feature
needs a real database (unlikely for one person's board).

**A plain HTML/CSS/JS page, no build step.** Anyone can open `public/` and
read what runs; an update is `git pull`; agents edit files without a
toolchain. Cost: shared global scope across the page scripts, and CSS has
to be organised by hand (see docs/REVIEW.md section 5 for the system that
replaces "one growing file"). Would change if: the page needs TypeScript or
a component model; ES modules without a bundler are the first step before
that.

**Eight npm dependencies, each with one job, all pinned.** imapflow and
mailparser (mail in), nodemailer (mail out), node-pty and ws (terminals),
three @xterm packages (the terminal on the page). Everything else is
Node's own: fetch, crypto, child_process, sqlite. Fewer packages means
fewer updates, fewer supply-chain surprises, a smaller install for the
desktop app. Would change if: a feature truly cannot be done without one;
then it is added with a line here saying why.

**One server file for the envelope, one route file per area, one lib file
per connection, one page script per area.** Files stay small enough to read
in one sitting, and an agent working on Inbox does not touch Sessions.
`server.js` owns the security checks so a new route cannot forget them.

## Security

**Every request must carry Host 127.0.0.1 or localhost.** Stops DNS
rebinding: a page on evil.example that resolves to 127.0.0.1 still sends its
own Host header and is refused.

**Every POST must carry `X-Switchboard: 1`, and the server never answers a
CORS preflight.** A browser cannot add a custom header cross-site without a
preflight, so no web page can change state. GETs are not gated: the page
needs them from a plain `<script>`-free load, and any program running as
the user could read the SQLite file anyway. Would change if: sandboxed
agents become common on the machine; then a per-install token on GETs.

**The terminal WebSocket checks the exact Origin.** A terminal is a shell.

**Content Security Policy on the page; outside text through `esc()` or DOM
nodes; outside HTML only inside a sandboxed frame.** Mail, chats, calendars,
weather and transcripts are hostile input. The notebook keeps HTML but
through an allow-list sanitiser that copies no URL or style attribute.

**Secrets encrypted in the database with a key in the OS keychain.**
Passwords, tokens and private calendar links are the valuable part of the
file; the keychain is what the OS already protects. A computer without a
keychain gets a private key file. Synced copies are sealed separately with
the account key so no other computer needs this one's key.

**Sync is end to end encrypted; the service stores ciphertext and slow
hashes.** The operator (Brett today) must not be able to read anyone's
board. Cost: no password reset; hence pairing codes and a recovery key.

**Nothing is ever sent on the person's behalf without a click.** Email,
texts, Teams replies, answers to an agent. Automation would be the first
thing a bug or an injected prompt abused.

**Agents get the board, sessions, builds and checks through MCP; never mail,
chats or money.** A prompt-injected agent should not be able to read a
person's inbox through Switchboard. A tests check set up by an agent may
only run the project's own test runner (Nov 3 2026).

**Other computers may use this one's sessions only after the person turns it
on.** (Nov 4 2026) A session is a shell; a fresh install should not hand its
shells to every device on the account by default. Settings, Accounts has the
switch; an install that had it on by the old default needs one click.

**Secrets and personal data never live in the repo.** Product secrets are
Worker secrets; the person's data is in their settings; test fixtures are
made up. The private repo's history is dirty, so releases go out through a
history-free public repo (docs/REVIEW.md section 3).

## Sessions

**Each agent runs in its own tmux session (`sb-<folder>`), attached through
a pty, shown with xterm.js.** tmux is what makes sessions survive a
Switchboard restart or update, lets `tmux attach` reach them from any
terminal, and gives a screen to read questions off. Windows has no tmux, so
there sessions run directly in a pty and end on restart; that is said in the
README rather than hidden.

**Messages are pasted in with tmux's buffer, then Enter.** Typing key by key
is slow and mangles long text; a bracketed paste is what a person pasting
would do. Checked Nov 4: a pasted `/model` followed by Enter opens Claude
Code's model picker, so slash commands go in the same way as messages.

**Claude's state comes from its hooks; other agents are judged by their
output.** Hooks are exact; output-watching ("printing means busy, quiet
means free") is the best available for agents without hooks.

**Chat view reads Claude Code's own transcript by byte offset.** The
transcript is the truth, it is already on disk, and reading only new bytes
keeps a long session cheap. Codex's format was not available to check, so
Codex shows its terminal.

**Questions are read off the screen and answered with arrow keys and Enter,
only if the same question is still on screen.** The answer must go to the
question the person saw, never to whatever replaced it.

**A queued message waits until the agent is free; Interrupt is explicit.**
Nobody wants a message typed into the middle of a tool call.

## Product

**"What needs me right now" is the first screen, as cards with one state
each.** Needs you, working, waiting on them, done. Everything else is a tab.

**Projects are the one way to split things, and rules file things into
them.** Repo folder, window title, email addresses and subjects. One
mechanism for every connection.

**Connections first, each one free.** Every program with a free way in is
worth connecting; sign in once in Settings, items show on Now and Inbox in
the right project, acting works without leaving. No paid services yet.

**The setup registry (`public/setup.js`) is the source of truth for what
exists.** The welcome, New in Switchboard and "left to connect" are built
from it, and a test fails if a connection has no entry, so nothing ships
unseen. It is also the de-facto changelog.

**Updates are a git pull and a restart, exit code 75.** Every install is a
checkout, so an update is cheap and reversible; the supervisor (systemd,
launchd, `bin/run.mjs`, the desktop app) restarts it. Cost: today a push to
the tracked branch is a release for every install; a `stable` branch fixes
that without changing the code.

**The desktop app is a thin shell around the same server.** Tauri, because
it uses the OS webview and costs tens of MB of RAM, not hundreds; the
server runs exactly as it does from a checkout.

## Licence and money

**Fair Source: the Functional Source License, FSL-1.1-MIT.** (Nov 4 2026)
Brett wants to be the first to make money from Switchboard, and would rather
be open source than let others profit from it first. FSL gives everyone the
right to use it, including at work, read it, change it and share it, but not
to offer it as a competing product or service; each release becomes MIT two
years after it ships. Contributions are signed off so the project can
relicense (CONTRIBUTING.md). Would change if: a paid tier never materialises
and adoption matters more, in which case the MIT conversion simply arrives
early.

## Design

**The counter: grey counter-top, paper cards, ink, one signal orange.**
Orange means "needs you" and nothing else, so the eye finds it. Green is
"all clear" and "passed"; red is "failed"; blue is "working".

**Less on screen, not more.** A feature that adds clutter has to earn it.
Connections stay out of sight while they work; only a broken one is named.

**Plain language everywhere, written for a person who is not a developer.**
Buttons say what happens ("Update ready", "End session"), errors say what to
do, and the README is written so an AI assistant can explain Switchboard
from it.

**One design system, documented, before the next redesign.** (Nov 3 2026)
The stylesheet grew by appending and the typeface choice reads as
generated; the fix is tokens, components and a documented face, not another
polish pass. See docs/REVIEW.md section 5.

**The type: Fraunces, Public Sans, JetBrains Mono, shipped with the app.**
(Nov 4 2026) The "paper ledger" pairing from the review, picked by Brett over
the Plex and Archivo options: a warm serif for the few display moments at one
weight (600) through one setting, a plain government sans for the body with
tabular figures, and one mono for readouts, kickers and the terminal instead
of two. The files live in public/fonts under the OFL, so a page load makes no
request to Google; the CSP allows no other font source. Would change if: a
face proves unreadable on Windows at small sizes (then the weight or the
hinting, not the pairing).

**The system: tokens, then components, then pages; no bare values.**
(Nov 4 2026) public/css/tokens.css holds every colour role (light and dark,
plus the always-ink console block the terminal reads at runtime), the spacing
and type scales, radii, shadows and layers. base, layout, six components and
seven page files sit on it, loaded by plain links in index.html. The rule
that keeps it a system: no hex, pixel size, radius or shadow outside
tokens.css, one `.btn` family, one `.card`, one `.row`, one `.field`, one
`.kicker`, one display setting; a new component is a new file and a
paragraph in docs/DESIGN.md. Dialogs open through one helper (focus in,
page inert, Escape closes the top one, focus back). Would change if: a build
step ever arrives, when the split files could be bundled; the structure would
stay.

**The System monitor reads only while it is open, and stays inside what an OS
shares without admin rights.** (Nov 4 2026) The page asks `/api/system` once a
second; the server has no timer and keeps no history (the charts' two minutes
live in the page), so a closed monitor costs nothing. The processor comes from
Node; everything an OS has to be asked for (apps, graphics, temperatures, fans,
network) goes through `lib/sysprobe.js` at most every 2 s on Linux, 3 s on a
Mac and 5 s on Windows, where each reading is a PowerShell start. That file is
a fourth home for OS-specific calls beside desktop.js and terminals.js, because
a monitor is nothing but OS calls and would swamp desktop.js. Temperatures and
fans come from Linux's own sensor files, an NVIDIA driver, a Mac's battery, or
(Windows) a monitoring tool the person already runs (LibreHardwareMonitor or
OpenHardwareMonitor); when an OS keeps them behind admin or a driver, the
monitor says so instead of loading a kernel driver or asking for admin. Apps
are grouped by name, because a browser is thirty processes and one question.
There is no kill button: a monitor that can end programs is a different, riskier
feature. Would change if: Windows or macOS opens these readings to ordinary
programs, or a person asks for history that survives a restart.

**Projects are pages, not a filter (Nov 4).** The rail's projects used to
narrow every list; Brett expected a click on a client to open that client.
Now a project opens its own page (#project/<id>) with its work, people, links
and files, and narrowing a list is a picker in that list's own head, so the
filter is where the list is and a filtered list always says so. The profile is
one `profiles` setting keyed by project id, so it syncs with no new sync path;
files stay on the computer they were dropped on (they can be large, and the
sync service holds small settings, not files) and are served only as
downloads with a sandbox CSP, so a dropped HTML or SVG file cannot run as the
page. Would change if: files need to follow the account (then through the sync
service, sealed like everything else), or a project grows enough to need tabs.

**Your turn waits for helpers (Nov 4).** Claude Code fires Stop when the main
agent's turn ends, even while sub-agents it sent off in the background are
still working, so Switchboard said Your turn too early. The board now counts
helpers per session from SubagentStart and SubagentStop (in memory: a restart
forgets them, which errs on the side of saying Your turn) and keeps the
session Working until the last is back, then waits 20 s for the main agent to
take the result up before calling it your turn. Would change if: Claude Code's
Stop hook starts saying whether background work is still out.

**End is on the bar, and its question waits (Nov 4).** End session used to sit
in More and ask by "click again within 4 seconds", four clicks with a timer.
Now End sits beside Stop and turns into "End this session? End it | Keep" in
the same place, with no timer: two clicks, and nothing ends by a stray
double-click.

**Worktrees are copies, not folders of their own (Nov 4).** Agents make a git
worktree per side task (twelve of one repo on the main development machine), and the
folder picker listed each as a project. They are told apart by their .git
being a file that points at the main repo, and listed last under the repo they
copy instead of hidden, so a session in one can still be started or resumed.
Switchboard never removes them: one may hold work not yet merged.

**Recurring costs from what is already here (Nov 4).** Brett wanted real
tracking of recurring expenses tied to projects, "not a full banking app". A
recurring cost is the bill item that already existed (amount, cadence, next
date, project), so it syncs and Ctrl K's "bill ..." keeps working; Money and
each project's page total them per month. Subscriptions are spotted in the
charge and receipt emails already read (same merchant, two or more months,
within 15% of the amount) and offered, never added on their own. Would change
if: someone connects a bank (Teller) or Stripe, which would feed the same list.

**Account calendars over CalDAV, by hand (Nov 4).** iCloud, Fastmail and Yahoo
serve calendars over CalDAV and take the mail's app password, so a person who
added the mail account only ticks calendars. It is a few PROPFINDs and one
REPORT with fetch and some tolerant XML reading, rather than a CalDAV or XML
package (AGENTS.md: nothing new unless a feature truly needs it). Redirects
are followed by hand and every address must be https on the provider's own
domain, because the request carries the password and a server's answer must
not be able to send it anywhere else. Google is left to its private iCal
link: its CalDAV wants OAuth. Would change if: a provider needs something
the tolerant reader cannot parse, or Google sign-in lands (then its API).

**Local models start with Ollama's own terminal (Nov 4).** A local model is
one more agent, `localai`, whose models are the ones Ollama has pulled, run as
`ollama run <model>` in a session like any other agent. Its state comes from
the screen going quiet, as for Codex. That needs no API client of our own and
works the same in tmux and direct mode. Other servers on localhost (LM Studio,
llama.cpp, Jan) are listed, not started: each has its own way to chat. Only
127.0.0.1 on their default ports is asked, every minute, for a second at most.
Would change if: people want local models in the Chat view, or Claude Code
and Codex pointed at a local server (both can be).

**A copy in a session goes to the computer looking at it (Nov 4).** Claude
Code, inside tmux, copies with the session computer's own tool (xclip) and
also sends the terminal copy code (OSC 52) wrapped for tmux. Switchboard's
tmux sessions allow that passthrough, and the page's terminal puts an OSC 52
copy on the clipboard of the computer showing it, only in the window that has
focus, so the computer being used wins when two show one session. A request
to read the clipboard is never answered. The session computer's own copy
still happens too; that is Claude Code's, not ours. Would change if: a copy
should never touch the session computer (that needs Claude Code to skip
xclip when it is viewed from elsewhere).

**Chat for another computer's session is asked over the relay, not synced
(Nov 4).** The computer the session runs on reads its transcript (the same
code as for its own page, lib/chatview.js) and answers one sealed question at
a time; the viewer asks every few seconds while the chat is open. A reply is
kept under the relay's 1 MB by cutting long texts, never by leaving messages
out, so "new" and "earlier" byte offsets stay right. Syncing transcripts would
copy every session to every computer; asking moves only what is on screen.

**Bring in a message lists the project's people, not just the Inbox (Nov 4).**
The Inbox shows what waits on you, which is too little to bring in from. The
list is mail either way from the last 60 days with people written to or that a
rule places, plus Teams chats, each in the project its rules give it. Linking
a conversation to a project adds an ordinary rule (an address, or a Teams
chat's name) rather than a link per thread: a project is about people, the
rule is visible and editable in Settings, Projects, and it also routes Now and
Inbox. Would change if: one person's threads belong to different projects
(then a per-thread link beside the rules).

**Send to session sends, and shows what goes (Nov 4).** Putting text in the
message bar and waiting for Enter read as "it never went". The dialog now
shows the exact text (the selection, the caret's line, or the page) in a box
that can be edited, starts with no instruction so nothing is summarised unless
asked, and Send queues it like any message. Edit in the message bar keeps the
old way for longer instructions.

**Feeds by hand, and never inward (Nov 4).** RSS 1.0, RSS 2.0 and Atom are
read with a small tolerant reader rather than a parser package: Switchboard
keeps only a post's title, link, date and a short plain-text summary, so it
never needs the rest. Because the server fetches whatever address a person
types, it refuses any address that resolves to this computer or the local
network, checked again on every redirect, so a feed cannot make it read its
own API or a router's admin page. (A name that resolves differently between
the check and the fetch could still slip past; for a person's own feed list
that is accepted.) Posts live on Inbox, Reading, never on Now: nothing in a
feed needs you. Would change if: people want full articles inside
Switchboard (that needs the sanitiser and a sandboxed frame), or feeds start
coming from somewhere other than the person (then pin the resolved address).

**A page without a feed is watched (Nov 4).** Some news pages offer no feed at
all (anthropic.com/news). Rather than say no, Switchboard reads the page's own
links: those one level under its path, titled by the heading inside the link,
and three words or more (one- or two-word links are sections). There are no
dates on such a page, so a post is dated when it is first seen. It breaks if
the site changes its layout, which is why a real feed always wins when there
is one. Would change if: the site publishes a feed (then it is found first).

**Selecting in a session's terminal is the browser's, not tmux's (Nov 4).**
Every computer showing a session is a client of the same tmux session, so a
selection made by tmux showed on all of them and copied on the one running
it. A plain left drag is now handed to xterm as its own selection (the same
as Shift-drag, Option-drag on a Mac): it shows only on that screen and copies
to that computer's clipboard on release. The wheel still goes to tmux, so
scrolling back works as before. What stays shared: the program has one screen,
so one size and one scroll position for everyone. Would change if: someone
needs to click inside a program's screen (a plain click is now a selection;
Shift-click would then have to be the way to pass a click through).

**Undo waits before acting rather than reversing afterwards (Nov 4).** Done,
Delete and archive are held on the page for six seconds, then sent. Reversing
on the server would mean a restore for deleted rows (and their sync) and
moving mail back out of each provider's Archive folder with new UIDs; waiting
needs none of that. The cost: the action reaches other computers six seconds
later. A closed tab sends what is waiting (fetch keepalive on pagehide).
**LM Studio's models are read with `lms ls`, only when its models folder
changes (Nov 4).** LM Studio's HTTP server is off unless someone starts it,
but `lms ls --json` always knows what was downloaded, with the exact names
`lms chat` takes. Asking it wakes LM Studio's background service, so
Switchboard asks once at start and then only when the list of folders under
~/.lmstudio/models changes. Sessions run `lms chat <model>` in a terminal,
like `ollama run`. Would change if: LM Studio's names move away from the
`lms` tool, or someone wants its server's API instead (a Chat view would).

**Test copies get their own keychain entry (Nov 4, review S15).** The usual
data folder keeps the name `local-key`, so nothing moves on an existing
install; any other folder gets `local-key-<hash of the folder>`. Before, a
second copy started with `SWITCHBOARD_DATA` read the real computer's key.

**Update stops and asks when this computer has its own commits (Nov 4).**
Update used to move a diverged checkout to GitHub's version and keep local
commits on a `before-update-*` branch, silently. On a computer where
Switchboard is being built that took three finished commits out of the
working copy (they were recovered from the backup branch). Now the first
click says how many changes GitHub does not have and the button becomes
Update anyway; only that moves them aside. Rebasing them on top was the other
option, but commits here are signed and the service cannot reach the
signing key, so a rebase would stop half way.

**Errors say what happened and what to do (Nov 4).** Brett: errors help most
when they tell a person what is missing or what to try. Switchboard's own
messages were already written that way; the gaps were raw system and network
errors passed through (ENOTFOUND, a certificate, a bare 503) and page crashes.
`lib/friendly.js` turns the first into a sentence naming the other side
("Could not find Todoist on the internet. Check that this computer is
online"); `api()` on the page explains an unreachable server and bare HTTP
statuses; `oopsWords()` names the part of the page that broke and what to try,
with Copy details for the rest. A new message from the server is written the
same way: what happened, then what to do.

**The top bar moved into the rail, Now became rows (Nov 4, the redesign).**
Brett asked for a high polish pass with one rule: nothing deleted, nothing
moved where it cannot be found. The top bar's eight controls each have a
fixed place in the rail (DESIGN.md, Layout), which frees the page's height
and keeps them in one spot on every page. The detail panel showed a hint
sentence when nothing was picked, a third of the screen; it now appears only
with something in it. Now groups by state rather than by project because the
question it answers is "what needs me"; the project is the row's dot, the
picker in the head, and its own page. "New in Switchboard" cards took the
first screen; What's new is a small word, as in Claude's desktop app.

**Files are kept on the computer they were added on, and only pictures show
inline (Nov 4).** Brett asked for media everywhere. One store
(lib/attachments.js) takes any type up to 1 GB, written to disk as it
arrives so a large file never sits in the server's memory. Syncing files
would mean storing them on the sync service (size, cost, and the "no paid
services" rule), so a note carries only the address and another computer
says the file is elsewhere. Pictures in a few plain formats show inline;
everything else, SVG included, is served as a sandboxed download, because a
file shown inline from 127.0.0.1 would run with the page's rights. Agents get
a file as its location on disk, which is how Claude Code and Codex read files.

## Signed-in browser checks (Nov 4, 2026)

A tests check can run against a site behind a sign-in (a work tenant's Microsoft
sign-in was the first). Chosen: the person signs in themselves in a visible
Chromium window on their own computer, started with the project's own Playwright
(scripts/signin.mjs); Switchboard keeps only Playwright's storageState, one file
per check in ~/.config/switchboard/auth (folder 0700, file 0600), outside every
repo and outside the data folder (which syncs and gets backed up). Rejected:
asking for a password or a test account's secret in Switchboard (it would hold a
credential, and MFA breaks it anyway), reusing the person's own browser profile
(that exposes everything they are signed in to), and a retry loop on expiry (an
expired sign-in can lock an account). Guards: the file is offered only to its own
check, as SB_AUTH_STATE; changing the check's folder or sign-in page, signing out
or removing the check deletes it; values from it are scrubbed from stored output;
the board and agent tools carry only "signed in, saved when"; an agent's request to
sign in is refused (only the page's own click opens the window); a check with no
valid sign-in does not run, so scheduling never retries. Expiry is reported by the
suite printing SIGNIN_EXPIRED. Not guarded: a test that writes the state somewhere
else, and traces or screenshots a project's own config keeps, which stay in that
project's run folder on this computer. Windows has no file modes: unverified there.

## Google Calendar: read and write (Nov 4, 2026)

Chosen: Google's own Calendar API with its loopback sign-in for desktop apps
(PKCE), plain fetch, no client library (lib/google.js): one button, Google's page
in a browser tab, a refresh token kept locked like the other tokens, the account's
calendars ticked in Settings. Rejected: a private ICS link (read only), and CalDAV
(Google allows it only with the same sign-in, so it adds nothing). One Google
account for now. The client id is in lib/product.js like the Microsoft one; the
client secret that Google issues to desktop apps is not confidential by Google's
own guidance, but it is kept out of the repository (a file in ~/.config/switchboard,
or an environment variable) until we decide how a release carries it. Until the
app passes Google's verification, Google shows an "unverified app" screen and
refresh tokens last a week in Testing mode; Publish app removes the week. A
repeating event is changed one occurrence at a time (Google's single-event
instances), because editing a whole series is a bigger design. Events are only
changed by a click on Save or Delete in the page.

Calendar has its own page but no place on the rail (Brett, Nov 4 2026): it is
something you look into from Now, not a place you work, so it opens from the
Today line on Now (and G then C), and Now stays lit on the rail while it shows
(OFF_RAIL in public/js/core.js). Another page that is opened rather than lived
in can join it there.

The pitch is made, not written (Brett, Nov 5 2026): the headline features and
their 20-second demos live in docs/headlines.json, and npm run pitch builds
docs/PITCH.md and the top of README.md from it plus the setup registry, so the
full feature list can never fall behind and nothing is forgotten when it is
time to market it. A test fails when they drift; features added after the
"reviewed" date are listed on PITCH.md until someone decides whether they are
headlines. Kept out of public/setup.js so the page does not carry marketing text.

File names in a session's chat open with a click (Brett, Nov 5 2026): an agent
names files all the time ("docs/PITCH.md", a screenshot's full path) and
reading one meant asking again. The page asks the server which names are real
(one batch per drawing; lib/localfile.js) and links only those, so a dotted
word that is not a file stays text. Shown inside Switchboard (markdown as a
page, code with its line, pictures), with Open and Show in folder for the rest,
rather than only handing off to the file manager: one click to read, no app
switch. Limits: files in the home folder, the temp folder or the session's own
folder; never keys or secrets (~/.ssh, .env, Switchboard's own data); programs
and scripts are only shown in their folder, since opening one would run it. All
four calls are POST, so the header and host checks guard them. A session on another
computer asks that computer over the relay (same limits, answered there), and
its files open only there: this computer shows them, it never opens them.
Terminal view gets the same through xterm's link provider: Claude's screen
drops backticks, so a bare name with an extension is a candidate too, and only
real files are underlined (on hover, as xterm draws links).

Connections are a list you choose (Brett, Nov 5 2026): every connection on
one page felt crowded for people who use three of them. Settings, Connections
shows only yours (connected, or added); the rest are tiles under Add a
connection, like an app store. Nothing is turned off or deleted by leaving it
off the list, and a connected one can't be hidden, so nothing working goes out
of sight. The list is a pref (it follows the account); before anyone chooses,
it starts from the welcome's picks. Cards keep their own sign-in code: the list
only shows and hides them (data-conn), and re-sorts when one is redrawn.

Trello, Asana and Notion connect with pasted keys, not a sign-in window
(Nov 5 2026): each hands out personal keys on its own settings page, and an
app registration (OAuth) would mean a developer app per service for every
install. The card links straight to the page that makes the key; for Trello,
Get a token opens Trello's own allow page for the key typed. Notion only sees
databases the person shares with their integration, so Switchboard reads the
first shared one that has a date and a Done checkbox or Complete status, with
a picker when there are several.

Ctrl+Q quits the app, and sessions keep running (Brett, Nov 5 2026): it does
what the tray's Quit does (stops the server the app started, then exits); a
git install's systemd or launchd service is left running, as Quit always has.
The window is a page on 127.0.0.1, which cannot call the app, so the page
navigates to /app/quit and the app's navigation check catches it. The app opens
the page with ?app=quit, so a browser tab (or an older app) never acts on
Ctrl+Q. Not built or tried yet: this machine has no Rust; the next desktop
release carries it.

A local model session runs Switchboard's own chat, not `ollama run` or `lms chat`
(Brett, Nov 5 2026): the Chat view reads a conversation an agent writes down,
and those two keep none. bin/localchat.mjs is still a session in a terminal
(so the queue, Stop, End, other computers and the phone work unchanged); it
talks to the model's own server on 127.0.0.1 (Ollama 11434, LM Studio 1234,
both OpenAI-style) and writes each turn in Claude Code's transcript shape to
the data folder (chats/<session>-<started>.jsonl), so the Chat view needed only
to know where the file is. A thinking model's reasoning is shown dim in the
terminal and not kept. LM Studio's server needs LM Studio (or its background
service) installed and running.

Codex in the Chat view reads Codex's own session log (Nov 5 2026):
~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl, matched to a session by folder
and start time (lib/codexlog.js), its lines turned into the same messages as
Claude's (lib/transcript.js takes a reader per format). Codex's approval
prompts are not read off its screen yet: answer those in Terminal.

Email drafts are read from the Drafts folder over IMAP and kept in their own
table (Brett, Nov 5 2026): the app password Switchboard already has reaches
them, with no Gmail API app to register, and a separate table means a draft
never counts as mail you sent (Gmail's All Mail search now leaves drafts out).
Save appends the new version with the \\Draft flag and moves the old one to
Trash (Gmail keeps the same draft); Send goes through the same SMTP as replies,
then the draft goes to Trash; Discard moves it to Trash, never deletes it. A
read that fails while drafts change is tried once more; until a read works the
list is the last one read, so a draft deleted in Gmail can stay up to a
couple of minutes.

Mac signing signs node-pty's native files itself (Nov 5 2026): Apple's
notarization refused the first signed build because pty.node and spawn-helper,
which ride among the app's resources, were unsigned, and Tauri signs only the
app and its sidecar. desktop/scripts/stage.mjs signs every Mach-O file in the
staged server when APPLE_SIGNING_IDENTITY is set; for that the workflow puts
the certificate in its own keychain before tauri build and stops handing
APPLE_CERTIFICATE to Tauri, since an identity found in two keychains is
refused as ambiguous.

Live talk to type no longer trusts the browser to say it has stopped (Nov 5
2026). In the Mac app the webview has the speech object but refused to run it,
and never sent "ended", so the mic stayed orange and could not be turned off.
The button now turns off on click whatever the browser does; a refusal, or
nothing starting within 4 seconds, ends it with a plain message; it does not
switch to Whisper on its own (Brett's call: that is a 500 MB download). The app's
Info.plist now asks for speech recognition permission, which Apple's speech
service needs inside an app.

The app's updates show on the page, like a checkout's (Nov 5 2026). The app's
own updater asked in a dialog at start and every six hours, which was easy to
miss, and the page's Update ready button never showed in the app. Now the app
reports what GitHub Releases has to the server every 5 seconds over plain HTTP
on 127.0.0.1 (no Tauri IPC is opened to the page, which is a web origin), and a
click on Update ready, or Check for updates, is handed back in the answer. A
local program could fake a report, but the updater only installs a build signed
with the release key, so the worst it could do is show the button. Automatic
updates are off by default and wait until no agent is working (without tmux,
until no session is open), because a restart there would cut it off. Tagged
releases are published by the workflow once every installer is built, instead
of waiting as a draft for someone to press Publish: CI and the build already
gate them, and the wait only held updates back.
