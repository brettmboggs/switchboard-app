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

**Mail tracking: Switchboard is one more client of the person's own tracker.**
(Nov 10 2026, Brett: the mail tracker's tracking goes through Switchboard.) The
pixel and the tracked links have to be answered on a public address, which a
local Switchboard is not, so the mail-tracker Worker on the person's own
Cloudflare stays the tracker, and Switchboard talks to its API with an access
token pasted in Settings, like the extension and the add-on (a token pasted in
Settings is one of the allowed sign-ins). Its rules carry over: register before
send with a 2.5 s cap, untracked rather than a broken link; every verdict comes
with its reasons. Incoming mail from people is reported to its detector as the
inbox scan does (source "scan", so the Worker needed no change; mail from
servers other than Gmail goes under a hashed key, as the Worker takes Gmail-style
ids only). Switchboard shows mail as text, so it never loads a sender's pixel:
nothing to block. Alerts are desktop only; the Worker's ntfy already reaches the
phone. Would change if: the tracker's code moves into this repo (as sync-worker
did), or Outlook replies get tracked too (Graph takes HTML the same way).

**Books are read on archive.org's own scans, with its OCR as a word layer.**
(Nov 10 2026, Brett: read archive.org books "naturally like a book", with
bookmarks, highlights, notes, tags, a library, and read aloud.) A scan is how
the book looks, so it is the page; archive.org's hOCR gives every word with its
box, so a transparent box over each word makes the scan selectable, and a
highlight is a run of word numbers on a page (it survives any view: scan, two
pages, text). One page's hOCR is a Range request on the whole-book file using
archive.org's page index, so nothing big is downloaded; pages and words are
kept once read. Only books free to download are taken: lending-library books
are copy-protected, and getting around that is not something Switchboard
does. Read aloud is Piper on this computer (free, offline, a person's
sound), installed by a button into DATA_DIR/readaloud, never the PATH
(a mouse tool there is also called piper) and never DATA_DIR/voice (talk to
type's model lives there); one Piper process takes a sentence a line, so
each comes back in about 0.3 s, and the browser's own voice stands in until
it is installed. LibriVox audio streams from archive.org, so the page's
media-src allows archive.org. Library, places and notes are local for now.
Would change if: the library should follow across computers (the sync
service), or a book arrives as a PDF or EPUB from disk (needs a renderer).

**Turning a page keeps the old page until the new one is in.** (Nov 10 2026,
after Brett: "serious issues between the pages … loading … not sustainable".)
Pages came from archive.org on every turn, at full size (2 to 6 s) because a
display wider than 700 pixels asked for the big picture, and nothing showed
meanwhile. Now the half-size picture (about 950 pixels wide) is used unless the
page is shown wider than that; the server fetches the 4 pages ahead and 2
behind, two at a time, dropping that queue when another page is asked for; the
browser preloads the next two turns. A turn puts the new pages behind the old
ones and swaps when their pictures are in, at most a third of a second, then
shows "Loading page…" on the paper (and Try again if archive.org fails), never
blank paper. One page or two side by side is decided on the book's usual page
shape, so turning never flips between them. Older scans (before about 2020)
have their words in one _djvu.xml instead of hOCR: it is fetched once (5 to 30
MB), kept a page a file, and the page numbers printed at the head or foot of
the pages fill in printed numbers where archive.org has none. Uploads with the
web address as the title or a biography as the author are tidied, and both
can be edited under Notes.

**Inbox is a mail app: folders, a list, the conversation.** (Nov 10 2026,
Brett: "features are good, bad design is not"; he picked this of three
layouts.) The page had grown three rows of filters (Business, Personal,
Reading, Tracking; then All, Email, Teams; then the team chats), fifteen drafts
above the mail, a separate Replied card and boxed EMAIL labels on two-line
snippets, and it squeezed into a scrolling column when a conversation opened.
Every one of those became a folder on the left, so the page has one way to
choose what you see; the source filter is a small select that shows only when
a folder mixes sources; a row is two lines that never wrap with a line icon for
its source. The three columns are the same with or without a conversation open
(the right one says "Pick a conversation" when empty), so nothing jumps. The
right column is the conversation's own box (#convo) showing a pane when nothing
is open, rather than a second element, so the conversation keeps mounting as it
always did. The side detail panel never opens on Inbox. Would change if: a
folder needs more than the middle column's width (Reading takes the right
column's room already), or a person wants one unified list of every source.

**Calendar events from one line go through the command bar's own route.**
(Nov 10 2026, Brett: add to my calendar within Switchboard, with Jarvis.)
/api/capture tries lib/eventline.js first, so Ctrl K and Jarvis share one
reader and one save, with no model: a line is an event when it starts with
event, meeting, appointment, schedule or cal, or says "to/on my (or the X)
calendar"; a question or a line starting with the bar's own words (note,
remind, todo…) never is. Times come from capture.js's parseWhen; a range or
"for 90 min" sets the end, else an hour; no time means all day. It goes on the
named calendar, else the Google account's own, since only Google calendars can
be written to (links and CalDAV stay read only). Changes the same way
(lib/eventedit.js): move, rename, cancel, the event found by its words, a day or
a time among the next three months; a cancel waits for a yes (a Delete button in
Ctrl K, "yes" to Jarvis). Sync with Google (Brett: everything should always
sync): Google calendars are read every minute, not every 10 (two small requests
a minute, far inside Google's free quota), the Calendar page's cache for them is
30 s, and a change made here is read back before the answer, so the board never
shows the old event. Google's push notifications would be instant but need a
public web address to call; a minute is the price of staying local. The same
event from an old private link and from Google shows once, the editable copy.
Would change if: CalDAV calendars learn to take events, or the sync service
relays Google's push notifications.

**Jarvis reaches everything through one catalogue, not a tool per feature.**
(Nov 10 2026, Brett: Jarvis must be able to do anything in Switchboard.) A
local model cannot hold 240 tool definitions, so it gets two general tools:
find_action (plain words in, the best matching actions with their inputs out)
and do_action (an id and its inputs, run through the same local API the page
uses, with its checks). lib/jarvisactions.js has one entry per route with a
kind: read and change run; delete waits for a yes (the model asks, then runs it
with confirmed); send (reaches another person) is never run, as every send is
Brett's click; internal (hooks, streams, password forms) is left out.
test/jarvisapi.test.js fails when a route in lib/routes has no entry, so a new
feature cannot ship out of Jarvis's reach. Hand-written tools stay for the
common things (pages, sessions, add, builds, memory, the network test) and
quick commands still answer those with no model. Would change if: models fast
enough to hold the whole catalogue run locally, or Brett decides voice
approval may send.

**The network test runs on the server, against Cloudflare's free speed test.**
(Nov 10 2026) The page's Content Security Policy lets it talk only to
Switchboard, and a browser's own limits (one tab's share of the processor, its
connection pool) show up in a browser speed test's numbers; Node on the server
does neither, so the page only starts the test and draws its progress.
speed.cloudflare.com is free, needs no account and answers from the nearest of
Cloudflare's cities; Ookla's servers need a licence and M-Lab's NDT7 is one
connection at a time. Latency is a TCP handshake (one round trip, no server
work in it), not an HTTP request, which carries Cloudflare's own processing
time. Upload counts only bytes Cloudflare confirmed, spread over each request's
time, because what Node has written may still sit in the kernel's buffers.
The 10 seconds count from when data starts moving (Cloudflare sometimes takes
seconds to accept connections), and an upload connection that stalls is left
out of the confirmed count rather than cutting its window short. Request sizes adapt: Cloudflare turns big requests away (403/429) from an
address that has tested a lot lately, so a refused size halves and the result
says when the test was held back rather than quietly reading low. Packet loss
uses the system's ping (no raw sockets without admin), counted apart for the
quiet part and the busy part, since a full line drops some packets by design.
Router, link and Wi-Fi readings live in lib/sysprobe.js and are Linux first.
Would change if: Cloudflare closes the endpoints to other clients, or someone
wants a choice of servers (M-Lab would be the free second).

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

**Granola comes in as pages in Notes, by API key, polled (Nov 6).** A meeting
note is notes, so it becomes a page in the project of the people in the
meeting (the same address rules as mail), where Brett and his sessions
(switchboard_notes) already read. Granola's public API takes a personal key
pasted in Settings, like Todoist, so no browser sign-in is needed; its
webhooks need an address on the internet, so Switchboard asks every 10
minutes. A page's id comes from the note's id, so two computers make the same
page and sync keeps one; a page edited or deleted in Switchboard is left
alone. The transcript is not brought in (long, and the summary is what gets
read). Would change if: Granola's keys stay Business-only and Brett's plan has
none: then Granola's MCP server, signed in through a real window.

**Note lines are marked from what sessions were sent, not from what was clicked (Nov 6).**
Brett sends notes by Send to session and by pasting them into a session, so
the mark comes from Claude Code's UserPromptSubmit hook, which sees every
prompt however it got there: a note line (14 characters and three words at
least, compared without case or punctuation) that the prompt holds is marked
sent, and the session's next Stop marks it finished. "Finished" is all
Switchboard can know (Brett: Claude made mistakes earlier), so it never ticks
the line itself; Mark done is his click. Codex and other agents have no such
hook, so only Claude Code sessions mark. The marks are drawn over the page,
never written into it, so a synced note on another computer is unchanged.

**Kept files open in the reader; PDFs unsandboxed there (Nov 6).** A
project's files and a note's files downloaded on every click; Brett adds them
from his own computer and wants a quick look. They now open in the same reader
as files a session names (fileview.js), served by their own address (?view,
?download, …/view, …/open), since locate() rightly refuses Switchboard's data
folder for names an agent writes. A PDF is served inline only when the reader
asks (?view) and without the sandbox CSP, because Chrome's PDF viewer will not
run in a sandbox; HTML and SVG still never show as a page. Moving is a copy
then, for a project's own files, a removal: a file in a note stays in the note,
since taking it out is editing the note, done there. Sending to a session
types the file's place, like dropping it on the session.

**Granola by signing in, for every plan (Nov 6).** Brett is on the free plan,
so the API key route above can't reach his notes. Sign in with Granola opens
Granola's own page (OAuth with PKCE; Switchboard registers itself the first
time, so there is no secret in the code) and Switchboard reads through
Granola's MCP server, the way Claude and ChatGPT connect to it: list_meetings
for what changed, get_meetings ten at a time. Its answers are tagged text, not
JSON, so lib/granolamcp.js parses them into the API's note shape and one page
maker serves both routes. The key route stays for Business plans. Pages from
the two routes get different ids (meeting UUID against not_… id), so switching
route can bring a meeting in twice. There is no one project for all of
Granola (Brett: "it should work for whatever project i want"): a Granola
folder named like a project picks it, then the address rules, then the title,
else Personal, and any page moves like any other. The sign-in follows the
OAuth pattern (button, real window, Sign out, paused and asked again when
Granola signs it out) rather than browser checks' Done button: Granola sends
the browser back to Switchboard itself, so no Done is needed.

**One session can run others, and ends only its own (Nov 6).** Brett works by
talking to one session that opens, briefs and closes others. The MCP server
(bin/mcp.mjs) now has switchboard_start_session, switchboard_read_session
(with a wait) and switchboard_end_session, through the same routes the page
uses, so a session an agent starts is an ordinary one on Sessions. Each
session knows itself by SWITCHBOARD_TERM; a session started by an agent keeps
opened_by, and the server ends one for an agent only when it is that agent's
own, so an orchestrator cannot end work the person started. Starting is
local only (a shell on another computer stays that computer's call), and the
tools say to use them only when the user asked. Would change if: Brett wants
an orchestrator to end any session in its repo.

**Needs you lets go of a session you have seen (Nov 5).** A session stayed on
Needs you until it was answered, so one Brett had read and chose to leave held
the list for hours. Now a finished session counts as seen after a few seconds
open on Sessions (or a jump to its window), and Clear on Now takes off either
a finished one or one waiting on a question or permission. Being looked at
does not clear a question or permission, because the session is still stopped
there; only Clear or an answer does. The Sessions page itself keeps showing the
real state, and queued messages still wait for a real finish, never a
cleared prompt. Would change if: clearing by looking proves too eager.

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

Removing Switchboard is a button (Settings, General, Nov 5 2026), not an
uninstaller package. A Mac app is removed by dragging it to the Trash, and Windows
already lists the app in Add or remove programs; what neither of those undoes is
what Switchboard added outside itself (Claude hooks, agents' MCP entries, start at
login, the data folder). The button undoes those through the same
scripts/setup.mjs that put them in, the login service last because it stops the
server. Exit code 76 means "removed, stay stopped" to every supervisor. A copy on
another port refuses, so a test copy can never strip the real setup.

What belongs to a project is two layers (Nov 5 2026). Each thing keeps one
main project from the rules (lib/spaces.js), because every server-side list,
the stored mail rows and sync already sort by it. On top, lib/belongs.js holds
"also belongs" rows (repo, person, domain, chat, page, section of a page), and
the page counts a thing in a project when either says so (core.js inSpace).
Filing something from Unsorted or Add that has no project yet writes a rule, so
it is sorted everywhere at once; anything else becomes an also-belongs row.
Hide is a list of keys (lib/hidden.js): nothing is deleted from the computer or
the mail. Ctrl K's note and sesh list their targets in the search results
instead of opening a second dialog, so arrows, Enter and clicks work as before.

**A session's project follows the rules as they are now (Nov 5 2026).** It was
stamped when the session started, so a project made later never took in the
sessions already open in its repo, and they stayed in Personal. Personal
sessions also showed every project's messages beside them; now Personal is a
project like any other, with the rest folded under Other projects. People
Switchboard has not seen yet are typed into a project's Add (a name, an
address or a domain) and saved as a rule, and Settings, Projects offers every
known repo, person and chat as you type a rule, so nothing needs its exact name.

**People on a project's About card sort its messages (Nov 5 2026).** The card
held a name, email and phone that sorted nothing, so people added there seemed
unknown to Add. Now their email brings their mail, their full name their Teams
chats, and their phone their texts, after the rules (a rule still wins). A
first name alone, someone on two projects' cards, and your own addresses sort
nothing, since there is no telling which project a message is for.

**A person on an About card holds any number of emails and phones (Nov 5 2026).**
People use a work address and a Gmail, and two rows for one person split their
mail. Each person now has `emails[]` and `phones[]`; the first of each is also
written as the old single `email` and `phone`, and a card with only those still
reads, so an older copy (or a shared About card read by one) sees the main
address rather than nothing. The lists travel inside the About card as they are;
the share bundle did not change. The ambiguity rule is per address: an address
on two cards sorts nothing, while the same person's other addresses still sort.
Merge with… is done in the form and saved with Save, like every other edit
there, rather than as its own server call, so Cancel undoes it.

**On Linux the app's window comes from Chrome when one is installed (Nov 5 2026).**
WebKitGTK, the web engine Linux apps get, lagged badly on Brett's NVIDIA card:
typing trailed a letter, scrolling stuttered, and the whole desktop hitched.
Turning off its DMA-BUF renderer did not help and turning off compositing made
it worse; the same page in a Chrome app window was smooth. So the app keeps
the server, tray, start at login and updates, and opens its window as a
Chrome, Edge, Chromium or Brave app window; without one it uses its own as
before, and SWITCHBOARD_WEBVIEW=1 forces its own. Mac and Windows use their
system engines (WebKit, WebView2), which do not have this fault.

**Teams pictures go through Switchboard, and there is no "seen" (Nov 5 2026).**
Pictures in a Teams message live at Graph addresses only the signed-in account
can open, so the page asks /api/teams/picture, which fetches them with that
sign-in (only Graph chat-picture addresses, kept in memory a while). Pictures
sent go as Teams' own inline pictures (hostedContents), so they arrive as
pictures, not links; big ones are shrunk on the page first to fit Graph's
request limit. Reactions use Graph's setReaction and unsetReaction. Read
receipts: Graph gives an app only your own read time, never the other
person's, so Switchboard cannot show Teams' eye.

**Pictures and files in email and Outlook are read when a conversation is opened (Nov 5 2026).**
Switchboard keeps only a snippet of each email, so the files are listed from
the mail server's outline of each message (IMAP BODYSTRUCTURE) and a file is
downloaded, that part only, when it is shown or saved; both are kept in memory
a while, never on disk. A part must be one the outline lists, of a message in
Switchboard's own list, so nothing can be fetched by guessing numbers. One
connection at a time per account, since Gmail turns away too many. Inline
pictures under 3 KB (signature logos, tracking pixels) are left out. Only PNG,
JPEG, GIF, WebP, BMP and AVIF show as pictures; SVG, HTML and everything else
only download. Outlook uses Graph's attachments. Pictures out go as email
attachments (up to about 18 MB), Outlook reply attachments and Teams inline
pictures (about 3 MB each). Google Voice texts get no paperclip: its email
relay passes on words only and would drop a picture without a word.
**Shared projects share one sealed document per project (Nov 5 2026).** A
member's copy of a project is their own local project (made when they join)
filled from one encrypted document holding the project's pages and to-dos,
not a second view of the owner's account: that keeps sharing apart from the
account sync, so nothing outside the project can travel by mistake, and it
reuses the account sync's newest-wins merge. The project key is locked to each
member's X25519 public key with the box pairing already uses (lib/sync.js),
and each account's private half is kept on the service locked with the account
key, so every one of a person's computers can open it and the service cannot.
Removing or losing a member rotates the key on the owner's computer rather
than trusting the service to keep them out. v1 invites only existing accounts,
by email, and only the owner invites; edits to the same page are newest-wins,
not merged.

**Who runs a shared project is signed, not stored (Nov 5 2026).** Brett asked
for admins and for choosing what each project shares. The service keeps a role
per member only to decide who may invite and remove; every Switchboard believes
the roster, the list of admins signed with the owner's Ed25519 key (pinned the
first time it is seen, and never older than the last one), and follows a
choice of what is shared only when the owner or an admin of that roster signed
it. A switched-off kind simply stops being sent, and nothing is sent as gone
for it, so nobody loses a copy because someone changed a switch; Only me does
send a page as gone, but only the person who first shared it can do that.
Repos travel as names only, so each person reads builds and pull requests with
their own GitHub sign-in. Activity is built from fixed fields (a session's
name, a state word, a time; a repo and branch for pushes and pull requests)
and anything else a source gives is dropped before sealing, so no terminal
text or prompt can ride along.

**A team is people first; each kind in a project has its own key (Nov 5
2026).** The owner asked to invite someone once and then give them any
project, and any kind in it, to see or to edit. One key per project could not
keep a kind from someone who has the key, so each kind is sealed with its own
key and a person's lock holds only the keys of the kinds they may see. Edit
cannot be a key (the whole document is rewritten by whoever saves), so every
row, deletion, About card, repo list and activity line is signed by its writer,
and every Switchboard checks the signature against the signed policy and drops
what came from someone who may only see; legitimate writers then leave it out
too. Changing who sees a kind rotates every key through the existing rekey
route, so stage 1 needed no service change for the team itself. 0.2.6's shares
are migrated by the owner's computer; members wait for that rather than keep
two formats alive.

**Invites by email are joining (Nov 5 2026).** The owner said an invite should
not be two parts. The link carries a secret, so the service keeps only hashes
(of the address and of the secret) and a list of what the person may do signed
by whoever invited them; signing up or in with that address and following the
link is accepting, and the inviter's computer hands over the keys when it next
looks (nudged at once over the relay). The email goes from the inviter's own
mail on their click, after showing it, as every send in Switchboard does.

**Emails Switchboard writes use hex colours (Nov 5 2026).** Email apps cannot
read CSS variables, so `lib/emails/layout.js` copies the counter's values from
tokens.css; it is the one place outside tokens.css with hex. The mark is sent
inside the email, so nothing is fetched when it is opened; the only addresses
in it are the invite link and the download page for someone without Switchboard.

**The sync service is a setting (Nov 5 2026).** Switchboard has to work for
anyone, so the service's address is chosen in Settings, Account (before
signing in) and the invite link's base and the download address are product
settings; nothing in the code needs one person's domain.

**Invite links open a page on the sync service for now (Nov 5 2026).** A link
cannot point at 127.0.0.1:4747: the invitee may run Switchboard on another port,
or not have it yet, and the web board is not built. So the link opens
`/join` on whichever sync service the inviter uses (nothing hard-wired), a
plain page the same for everyone that reads the invitation from after the # in
the browser and hands it to Switchboard on that computer, or says how to paste
it. When the web board exists, the inviteBase setting points links at it.

**The web board is the same page with an adapter, not a second app (Nov 5
2026).** The owner asked for it to be "exactly the same as on my computer". So
the worker serves public/ as it is (Workers static assets, free plan), marks
the page, and the page's api() goes to public/js/web/adapter.js, which answers
from a web client that does in the browser what lib/share.js does in the app:
the same formats, keys, signatures and rules, checked by test/web.test.js
against the app's own code. Rather than keep two copies of the share logic in
step by hand forever, the next change should make lib/share.js's core run in
both. The browser's WebSocket cannot send an Authorization header, so the
relay also takes the token as a subprotocol (`tok.<token>`, answered with
`switchboard`, never echoed). Builds and pull requests reach the board as part
of each member's signed repos box (names, states and links only), because the
board has nobody's GitHub token; an older Switchboard does not believe a repos
box that carries them, so everyone in a project should update. Integrity hashes
are made before every deploy (scripts/board-manifest.mjs, run by wrangler.toml)
and not kept in git.

**The board is everyone's own Switchboard, and the share logic is one module
(Nov 5 2026).** The owner found the invitee's board could not set up anything of
its own. So the browser now keeps the account's own settings, pages, to-dos and
the rest, synced through the very documents the app uses (lib/sync.js formats),
and the share logic moved into public/js/shared/share-core.js, which both the
app (over SQLite and node:crypto) and the browser (over its own store and
WebCrypto) run, rather than a third copy. Projects shared with you appear as
projects beside your own; nothing of yours goes into a shared bundle unless you
share that project.

**Everything a project has can be shared, kind by kind; sessions only live
(Nov 5 2026).** For a co-founder the owner wants "everything possible, even the
sessions". What a computer has of a project (checks, conversations, calendar,
money, files) goes in the project's sealed document as its own box, signed by
that computer, each off until turned on. Sessions never go in the document: a
member asks the owner's computer through a relay room for that project, signed
with their key and sealed to the owner's, and gets the Chat view (never the
terminal or keystrokes) sealed back to them; Send uses the session queue's held
items, the same Approve as a linked Teams chat. A section of a page travels as a
read-only page that only the owner's signature makes real.

**Connections on the board are the person's own, in their account (Nov 5
2026).** Microsoft 365 signs in from the browser straight to Microsoft (a
single-page app registration, PKCE) and Graph is called from the browser; the
tokens go in the account's settings, sealed, so they follow the person and the
service cannot read them. GitHub needs a secret for its exchange, so the
service does that one step and hands the token back in the address's fragment
without storing it. Mail by IMAP stays app-only: a browser cannot open a mail
connection, and routing it through the service would let the service read it.

**Team chat is Switchboard's own, end to end, in the Inbox (Nov 5 2026).** The
team needed to talk where they already work, and Teams gives other apps no
"seen", no typing and no editing of someone else's view. So each shared project
has a channel and every pair of teammates a one-to-one chat, shown in the
Inbox's conversation view rather than a new page. The service keeps an
append-only log of sealed lines (`sync-worker/schema-v8.sql`, `src/chat.js`):
a channel's key is made from the project key, one per epoch, so a removed
person reads nothing written after and someone who joins later cannot open
lines from before (shown as such in Details); a one-to-one key is made by the
two computers from their sharing keys (X25519). Edits, deletions, reactions
and pins are sealed lines like messages, so the service cannot tell them
apart; each is signed, and only the writer's own edit or delete is believed.
The other person's sharing key for a one-to-one chat is fetched once and kept,
and refused unless its signing half matches what the project's signed roster
or policy says for them. "Seen" (how far each person read) and typing are the
only things the service sees beyond who wrote when; typing is passed on and
never stored. Alerts and phone pushes come only for a one-to-one message or an
@mention, never every channel line, and the push says only "A teammate wrote
to you." Pictures are sealed into the message (made smaller first, about half
a megabyte at most per message) instead of a separate file store; a file store
can come later. Team chat is not the shared "conversations" kind: that kind
publishes a project owner's own mail and Teams threads into the project's
sealed document, while team chat is its own Inbox kind ("team:" keys), its own
log and keys, and never goes into a project's document. Not on the web board
yet.

## Shared projects: fixes from the Nov 5 review (Nov 5, 2026)

- A project counts as shared before the team only by this computer's own
  lock (a bare key) and only until it has been seen in the team's shape;
  never by what a document says. Every member holds the project key, so a
  document's shape is anyone's word. The old switches are believed only
  with the owner's signature (docs/REVIEW-2026-11-05.md H1).
- An invitation answered on Now without its link only asks to join; the
  owner lets them in with one click. The sync service does not check that an
  account owns its address, so the address alone is not proof; the link's
  secret, or the owner looking at the address, is (H2). A code sent by email
  at sign-up would close the rest, and is left for Brett to decide.
- A shared edit reaches only a row that is in that project here (or a page
  added to it from another one); something moved out of the project stays
  out, as you left it, even if a member edited their copy later (H3).
- × on a shared page that someone else shared takes it off your own card and
  leaves it in the project; only whoever shared a page can take it out of
  the project for everyone (H4).
- A shared change dated more than ten minutes ahead of this computer's clock
  waits, and Team names whose clock is ahead. Wall time still orders
  changes (a counter would change what is signed, for everyone at once);
  the bound keeps one wrong clock from winning every conflict (M1).
- The people on a shared project's About card sort messages into it, never
  notes, sessions or repos: the card can be written on another computer,
  and what lands in a shared project is sent to everyone (M2).
- People's sharing keys are kept on first sight and never silently replaced:
  a changed key is refused and shown with check codes, and only you can
  accept it. A face-to-face check is optional (Check codes), not required,
  since the set-once key on the service makes a real change rare (M3).
- Undo after × uses a record the server kept for a quarter of an hour, not
  what the page sends back, and never undoes a later move (M5). A restart
  forgets it; Add puts things back then.
- Settings' project and rule lists and the About form save only what the
  page changed, merged with what is there now, rather than the page's whole
  copy: other windows, ×, the Add picker and shared syncs change them too
  (M7). An older page without what it started from still saves whole.
- An /api read is refused when the browser says another site (even another
  port here) started it, by Sec-Fetch-Site; requests without that header,
  from scripts and the MCP tools, are unchanged (L1).
- The desktop app's link rules live in links.rs with no dependencies, so
  they are tested by rustc alone on any computer; only web, mail and phone
  links leave the app, and only port 4747 is its own page (L3, L4).
- Moving a page someone else shared to another project (the notebook's
  project menu) makes a copy of your own there and takes theirs off your
  card; it never moves or deletes theirs, the same rule as × (H4).
- A signed deletion from the share removes only a page or to-do that lives in
  that project here, of a kind the share carries. A page filed into the
  project from another one (In this project) takes shared edits but is never
  deleted by one: deleting reaches no further than the project (re-review H3).
- "The codes match" takes the exact code Team showed and replaces the kept
  keys only with that whole pair; keys that changed again since are refused,
  so what is approved is what was compared (re-review M3).
- Settings sends a rule change as just that change (added, taken away),
  never its whole list, so a rule deleted elsewhere stays deleted; a new
  project carries a temporary id that the save maps to its real one, never
  matched by name (re-review M7, L2).

## Forgot password (Nov 6, 2026)

- Brett asked for a reset (Nov 6) when the test account's password was lost,
  with nothing for him to set up. The code comes from a teammate: the owner
  or an admin of a shared project the person is in makes it in Settings,
  Team, and hands it over by text or in person. Email needs either a Resend
  account (only Brett can make one) or Cloudflare's Email Sending, which is
  paid-plan only; sending from Brett's Gmail would break his "every send is
  my click" rule. The admin could use the code themselves, but the reset wipes
  the account and its memberships, so they gain nothing and the person sees
  they were signed out. Email stays built and switches on with RESEND_API_KEY
  and MAIL_FROM (one `fetch`, no npm package).
- A code, not only a link (when email is on): the app runs on 127.0.0.1, which a link in an
  email opened on a phone cannot reach. The link is for the web board and fills
  the code in. 12 characters (60 bits), one waiting per account, 30 minutes,
  five wrong tries, five sends an hour per email; the start answer is the same
  for every email, so it does not tell who has an account.
- The password is the data key, so a reset cannot keep the synced copy. It
  clears the documents, the recovery key and the sharing key and signs out
  every computer and browser. Each keeps its local copy and uploads it, locked
  with the new password, when it signs in again: so the data lives on
  wherever it was.
- The person stays in their projects (Brett, Nov 6: "the team is the one
  resetting him"). The first build took them out, which emptied the test
  account; wrong. Now the computer that made the code remembers it, and when
  the new sharing key appears (the service tells owners and admins at once)
  it takes the new keys without check codes, since that person started the
  reset, and makes each project it runs a new key locked to them with the
  same access. Projects run by someone else keep the check-code step: their
  owner did not start this reset.
- The button lives in the sign-in form only: the setup rule's "a button, with
  the result in plain words" holds; the service's mail settings are a deploy
  step for whoever runs it, like the provider sign-in secrets.

## The web board shows every page that has data (Nov 6, 2026)

- Brett: "I want the full product there." The board had been cut to Now,
  Inbox and Notes, while shared projects already carried sessions, money,
  calendar, checks and builds to it, shown only as cards on a project's page.
  Now Sessions, Builds, Browser checks, Calendar and Money are on its rail,
  drawn by the app's own pages from the shared data
  (public/js/web/adapter.js sharedViews; public/js/websessions.js for the two
  that have no computer behind them). Published money now carries its cadence,
  so Recurring costs and next dates work there.
- Read-only for money, calendar and checks, as their sharing levels already
  said: a bill lives in its owner's database. Editing them from the board is
  the next step (ROADMAP), and needs its own signed rows like pages and to-dos.

## Microsoft 365, Google and GitHub on the board, for anyone (Nov 6, 2026)

- Brett: anyone with Microsoft 365 connects their own; nobody locked out. The
  Switchboard Entra app (in Brett's own Microsoft tenant) now takes any work,
  school or personal Microsoft account, with the board as a single-page-app
  redirect; the board asks a personal account for mail only (no Teams there)
  when Microsoft turns the Teams permissions away.
- Google needs a "Web application" client for a browser (the app's is a
  desktop client), and its secret for every exchange and renewal, so the sync
  service does both and passes the tokens through, keeping none
  (src/googleconnect.js), as GitHub's connect does. Gmail is gmail.modify and
  gmail.send; until Google reviews the app (a paid security assessment for
  Gmail's restricted scopes) people see Google's "unverified app" page and the
  app is capped at 100 users. Published (In production), not Testing, so
  nobody needs adding and sign-ins do not expire weekly.
- GitHub's OAuth app takes the board's connect address as a second redirect.
- A privacy page (public/privacy.html), which Google requires to publish.


## Sessions: clicks reach the agent, End leaves nothing, the queue gives back (Nov 6, 2026)

- **A click in the terminal goes to the program; a drag is a selection here.**
  Every plain left press in a tmux session was turned into the browser's own
  selection (so a drag would not draw tmux's selection on every computer), which
  meant no click ever reached Claude Code: its forks and helpers could not be
  opened with a click. Now the press waits: moved 4 px or more it becomes the
  local selection, otherwise it is sent to the program as a click. A double
  click still selects a word.
- **End stops every process the session started, by its tag.** tmux's
  kill-session hangs up the agent, but a child that detached itself (its own
  process group, a daemon, a browser) can outlive it. Each session already
  starts with SWITCHBOARD_TERM=<id> in its environment, which every descendant
  inherits, so ending it (or finding it gone) reads that tag (/proc on Linux,
  `ps -E` on a Mac) and stops each match: SIGTERM, then SIGKILL after 3 s. Never
  the tmux server, never Switchboard itself. Windows (direct mode) uses
  `taskkill /T`. If `tmux ls` cannot answer (a timeout), nothing is marked
  ended or stopped on a guess. Would change if: an agent starts clearing its
  environment for children.
- **The queue: Send now and Edit, and it holds still.** Removing a queued
  message threw it away; now Edit puts it back in the message bar, and Send now
  sends it at once (as Ctrl+Enter does). The queue was redrawn on every update
  while the agent worked, so a click on its buttons could land on a line that
  had just been replaced; it is now drawn only when it changes.
- **What's new: Show me works.** Its buttons were ignored: the click handler
  only listened inside an element marked `data-new` that does not exist.

## Notes: Send to session starts from the line you are on (Nov 6, 2026)

- Brett: "almost never would I be sending the full page of notes, typically
  just the bullet or couple that I am working on." The dialog already offered
  the selection or the line, but with nothing selected it opened on Whole page,
  and the choice lived inside the dialog. Now it opens on the selection, else
  the line (a bullet with the ones under it); an arrow sits at the end of the
  line the caret is on, and the bar's button names what it sends. Bullets
  selected inside one list keep their marks. Whole page stays in the dialog.
- **The Unsorted count follows hiding at once.** The rail's number came from a
  list the server keeps for a minute, and hiding did not clear it, so it could
  read 2 with nothing left. Hiding refreshes it, and opening Unsorted sets the
  rail's number from the list it just fetched.

## The page never scrolls sideways (Nov 6, 2026)

- Brett: "the page itself should never [scroll sideways]; this should always
  fit whatever screen is running the program." html and body are
  `overflow-x: clip` (clip, not hidden, so sticky headers and the rail keep
  working); a part that has to be wide (the terminal, the tabs, a table)
  scrolls inside its own box. Form fields and pictures are capped at their
  box's width.
- Found by measuring every page, Settings pane and project page with very long
  unbroken names and links: an open note's header was a one-column grid whose
  column grew to its widest child (the project picker with a long name), and
  a long project name gave the rail its own sideways scrollbar. The header's
  column is `minmax(0, 1fr)`; a name on the rail ends in "…" with the full name
  on hover.
- A new project's id is its name's first 40 characters: a longer one made an
  address (#project/<id>, up to 60) its page could never open at. Ids already
  saved are kept.

## Ctrl K talks to type; New session makes a new folder (Nov 6, 2026)

- **A mic in Ctrl K.** Brett writes notes and sends to sessions from Ctrl K
  most of all. The same mic as everywhere (Whisper, or the browser's speech
  when Live), and spoken words update the box's suggestions as typed ones do.
  Enter while it listens stops it rather than sending, so a misheard word can
  be fixed first; closing the box stops it too.
- **New folder… in New session.** A new client has no repo, and making one
  meant leaving Switchboard. The folder goes in your code folder (the first
  of them, or the one picked; ~/dev is made if there is none), named as typed
  with spaces made dashes, and checked before it becomes a path or an argument.
  It is a git repo unless unticked. A GitHub repo is only made when ticked
  (private, with your own gh sign-in), because it is something made outside
  this computer; if GitHub says no, the folder and the session still go ahead
  and the reason is shown. The new folder lands on Unsorted to put in a
  project, like any new repo.
- A new session now opens as soon as it starts: the page used to switch to it
  before its list had it, and fell back to the first session.

## Pictures in notes reach the agent as files (Nov 6, 2026)

- A note's pictures and files used to vanish on the way to an agent: Send to
  session and `switchboard_notes` sent the text only. Now each goes as
  `[picture name: '/path']`, the file where Switchboard keeps it on this
  computer, so Claude Code (or any agent) opens it like any other file. The
  page sends the file's address; the server turns it into the path
  (lib/keptpaths.js), so the page never needs to know where files live. A
  session on another computer gets the address unchanged: the file is not there.
- `switchboard_notes` cut a page at 8,000 characters, so long build notes lost
  their last items (the newest ones). It now sends up to 40,000 and says where
  it cut.
- Nothing on the page reads as code outside the terminal. Agent sessions' hook
  names (Stop, SubagentStop) and Claude Code's own tagged messages
  (`<task-notification>`, `<command-name>`) become sentences in lib/plainwords.js,
  on the server, both when a prompt is saved and when it is shown, so old rows,
  the page, Sessions and the MCP tools all read the same. A folder shows by its
  name; the full path is on hover.
- Setup buttons for Switchboard's own steps (Finish setup for Claude Code, Set
  up the checking browser) open a setup session in Switchboard's own folder
  (`setup: 'app'` on /api/terms) rather than sending that folder's path to the
  page. Sign in to GitHub (Builds, Settings) runs `gh auth login` in a session
  the same way agent sign-ins do: gh opens GitHub's own page in the browser for
  the sign-in itself, and keeps the session in its own store.
- Jarvis (lib/jarvis.js, lib/jarvistools.js, public/js/jarvis.js) answers the
  common things with fixed phrases and no model at all (instant, free, works
  when no model runs); anything else goes to a model on this computer through
  the OpenAI-style chat API that LM Studio, Ollama and llama.cpp all serve, with
  Switchboard's own API as its tools. Real work is handed to a Claude Code
  session rather than done by the small model. It speaks with the browser's
  own voice for now (free, no download); a better local voice (Piper) can
  replace it. Hold Ctrl+Space, not Cmd+Space, because that is Spotlight.
- The HUD (Nov 8 2026, Brett: holographic HUD, dark only, tech display face,
  orange stays the alarm): done as one palette in tokens.css plus a layer
  (public/css/hud.css) loaded last, not by rewriting every component, so each
  page gets the look at once and the old rules keep working. The primary
  action turned cyan: orange is left to mean "needs you" only. Space Grotesk
  ships in public/fonts like the other faces. Effects stay off words.
- The Command Deck (Nov 8 2026, Brett: "changing the theme is not what I call
  futuristic"): a new home page and a top ring instead of the side rail, but
  each module opens into the page it always was. That keeps every feature where
  its page is and lets the Deck be built in one go; the panels can change shape
  one by one later. The ring is fixed above the old grid with the rail column
  set to 0, so the pages' own layouts (Sessions, an open conversation) needed no
  rewrite. Nothing is hidden on small windows: the ring scrolls sideways.
- Jarvis hears through Whisper on this computer whenever it is set up, whatever
  talk to type is set to: the browser's own live speech starts and then hears
  nothing on some Linux setups. While the key is held everything is recorded
  (no loudness test a quiet microphone could stay under), and when nothing
  comes through it says so. Tested end to end with a recorded voice as the
  microphone (headless Chrome's fake audio device) on the Deck, Inbox and
  Sessions. The Deck redraws only its modules on a board refresh, so the
  command line keeps what was said.
- Talk to type and Jarvis can listen to a chosen microphone (Settings, General,
  Microphone; kept in that browser, since a browser's device ids mean nothing
  elsewhere). A chosen one means Whisper on this computer: the browser's live
  speech can only hear the computer's default mic. Found when Brett's voice went
  into an M-Track interface while the default input was the webcam's mic, so
  Whisper heard near-silence and wrote "you". Quiet pieces are raised before
  Whisper hears them, and Whisper's words for silence ("you", "thank you") on
  their own count as nothing said.
  Nov 8, later: that rule made plain talk to type slow (Whisper writes in
  chunks), so only Jarvis follows the chosen mic. Talk to type stays on the
  browser's live speech, which hears the computer's default input; on Brett's
  machine that is now his microphone (through the M-Track), set as the default.
- Jarvis finds LM Studio on the port lms reports (its newer app, Bionic, takes
  1235, not 1234) and, when the app is not running, starts it in the background
  (--run-as-service) from where a downloaded AppImage sits (Applications,
  Downloads…), then its server; the model loads with an 8k window and a 15
  minute idle unload.
- AI plan usage reads what is already there instead of asking anyone to
  connect anything (Nov 8): Claude Code's status line carries rate_limits
  (five_hour, seven_day: used_percentage, resets_at) and already posts to
  /hook/claude/status; Codex writes rate_limits in its session logs. Readings
  are kept in SQLite (usage_samples, 35 days) only when they move or every 15
  minutes. The forecast blends the last stretch's pace (the last day of a
  weekly window, the last hour of a 5-hour one) 60/40 with the average since
  the window began, so a burst counts but nights do too. A plan that used
  nothing all week stays off the card until it is used.
- The AI plans page keeps a summary of every window for good (usage_windows:
  peak, when it ran out) while raw readings still go after 35 days (Nov 9), so
  past weeks can be compared without the table growing. A jump in the limit is
  put down to the Claude session whose status line posted it (usage_samples.sid):
  rough when two run at once, but it costs nothing and needs no estimate of
  tokens. Habits are measured on the longest window, as it sees all use; a
  rise after more than two quiet hours goes in the hour before the reading,
  not across the night. Everything fits one screen, as Brett asked (no
  scrolling); other plans are tabs.
- Jarvis asks local models for no "thinking" (reasoning_effort: none, Nov 8):
  on Gemma 4 12B in LM Studio the first spoken word went from 6.6 s to 0.14 s
  and the whole short answer from 6.7 s to 0.9 s; a server that refuses the
  field is asked again without it. Answers stream (POST /api/jarvis/stream,
  lines of JSON) and the page speaks each sentence as it completes; closing
  the request (talking over him) stops the model. LM Studio, then Ollama, then
  llama.cpp: if one fails mid-question the next takes it. A tool call failing
  the same way a third time is not run again.
- Jarvis's memory is a capped card plus a searched log, not the whole history
  in every prompt (Nov 8): the model gets 8k tokens, and a long history made
  it slow and forgetful. The card (1600 characters, about 400 tokens) goes in
  every question; the log is SQLite FTS5 (no new dependency), and only the few
  matching lines go in, when the recall tool asks. The nightly tidy runs once a
  day after 2 am when Jarvis has been quiet 30 minutes, and never starts LM
  Studio for it; every card version is kept (30) for Undo. Ideas from nanobot
  and OpenClaw (MIT), written fresh.
- Jarvis speaking up is built on the page, not the server (Nov 8): only the
  browser can speak, and only one open window should, so windows agree in
  localStorage on which has the voice. Off by default, as "needs you" is not
  yet right for every session. The morning brief is plain sentences from the
  board, with no model, so it is instant and cannot make anything up; browsers
  only let a page speak after a click or key, so it waits for the first one of
  the day.

**Jarvis's model unloads after 5 idle minutes, and a lingering model process is stopped.**
(Nov 10 2026, Brett, on finding Gemma holding 9 of 12 GB of video memory for
hours: unloading models not in use is the standard.) LM Studio's own idle
timer (lms load --ttl) works, but once its llama-server process outlived the
model LM Studio listed as unloaded. Switchboard now loads with a 5-minute
timer (was 15; Ctrl+Space reloads it while you talk, about 4 seconds), and asks
for the same timer on every question (a model LM Studio loads for a question on
its own keeps it for an hour). Every 2 minutes Switchboard unloads a model
that carries such a timer and has been unused for 5 minutes, and, when nothing
is listed as loaded, stops an LM Studio model process seen on two sweeps in a
row. A model answering, reading a prompt or used in the last 5 minutes is never
touched. Linux only for now (/proc); elsewhere nothing is stopped.
Changed Nov 12 2026 (Brett: "for offloading models on switchboard we can add a
button"): automatic for Jarvis's own models, a button for everything else. A
model loaded by hand in LM Studio has no timer and is no longer unloaded by the
sweep (it had cut a long prompt off in a big model); Settings, Connections,
Local AI models lists what is loaded (size, status, idle minutes, who unloads
it) with Unload and Unload all, each confirmed on the button itself, and Jarvis
can list and unload them ("unload models"). A model loaded by hand that has sat
idle 30 minutes gets a quiet note in that card; it is never unloaded on its own.

## Project dashboards (Nov 11 2026)
Website numbers are measured here, from outside, with no paid service: pages
read with plain requests (regex, not a parser package: titles, meta tags and
links are all a check needs), and speed in a headless Chromium driven over the
DevTools protocol with Node's own WebSocket (lib/headless.js), scored with
Lighthouse's published curves. Google's PageSpeed API refuses calls without a
key (429), so its scores are an extra with a free key pasted on the dashboard,
not the base. The test browser identifies as itself; a site whose firewall
turns it away gets that said in words, never a disguise. The PDF is the
report page printed by the same headless browser, so page and PDF never
drift, and no PDF package is needed. Readings live in this computer's tables
(dash_*), like browser checks: one computer checks a site, not every one that
shares the settings. The analysis is sentences built from the numbers, not a
model, so it is there on every machine and never wrong about a number.
Inbox's Teams folder lists every recent chat whoever spoke last: the waiting
list alone made an answered chat vanish (Brett, Nov 11).
AI search (Nov 11): the dashboard scores readiness, what can be checked from
outside (crawler access in robots.txt, structured data, question-and-answer
pages, llms.txt), and keeps it apart from visibility, whether ChatGPT or
Google's AI actually names the business. Visibility has no free, honest
source (asking the AIs through their APIs costs money and differs from what a
person sees), so it is a fixed list of questions asked by hand each month and
tracked as numbers. Sites behind a firewall rate-limit a burst of reads: the
check reads two pages at a time with pauses, waits when told 429, never counts
a 429 as a broken link, and times the home page before reading the rest.

## Connections ride out blips (Nov 12 2026)

Brett: Microsoft, Gmail and GitHub kept showing "not connecting". Each poller
marked itself broken on its first failed check, and on his machine checks fail
now and then for reasons that pass on their own: DNS goes through Tailscale's
resolver, which drops a query now and then (a 3-second stall on about one
lookup in fifty, sometimes a failure), and Microsoft answers 502 for a moment.
lib/steady.js is the one place that decides: a check that fails for a passing
reason (lookups, timeouts, resets, 429 and 5xx) is tried twice more, after 2
and 6 seconds; if it still fails, the last good status stays on the page until
the trouble has lasted 10 minutes. Anything that needs the person (a refused
password, a sign-in that ran out) shows at once. Only reads are retried, never
a send or a change, so nothing happens twice. A Microsoft 5xx while renewing
the sign-in no longer reads as "sign-in expired". Rejected: hiding every
error for a while (a wrong password would sit unseen), and fixing it only in
the machine's DNS (the board should not depend on one resolver behaving).
Microsoft's mail read can fail inside Microsoft while Teams works (that day,
every form of it answered 502 UnknownError for a while), so lib/microsoft.js
reads a mail folder in the lightest form Microsoft will answer (no sort, then
no date filter, with the dates checked here) and remembers the form that
worked; and when mail still fails, Teams stays fresh and the last mail read
stays on the board, with a message that says it is only mail.

## Google sign-outs ask for a sign-in (Nov 12 2026)

When Google signs Switchboard out (a week after sign-in while the app is in
testing, or access removed), the refresh token is refused but the account was
still saved, so Settings said "connected" and offered only Sign out while each
calendar said "Press Sign in with Google again" with no such button. Now the
refusal is remembered on the account (lib/google.js, `expired`): the Google row
shows Sign in with Google, Now shows a Needs-you card that opens it, and signing
in again keeps the calendars already chosen and reads them at once.
