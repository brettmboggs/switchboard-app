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
