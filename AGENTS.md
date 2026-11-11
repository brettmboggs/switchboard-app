<!-- The rules for every coding agent in this repo (Claude Code, Codex, Gemini, Cursor, Copilot…).
     CLAUDE.md imports this file. Put rules here, not there. -->

# Switchboard

Brett's own Jarvis: one console for everything he runs, that he can talk to
and that does things for him. Since Nov 8 2026 it is his playspace, not a
product for others: lean all the way into a futuristic, fast, voice-first
interface, and try things here that an enterprise app at work can't. Ask Brett
before adding a feature or a big design change; once he says yes, nothing
holds it back. Still keep personal data out of the code (CI checks it; it
lives in settings and docs/HANDOFF.md) and OS-specific calls behind
lib/desktop.js, lib/terminals.js (MODE tmux | direct), lib/sysprobe.js and
scripts/setup.mjs, so the Mac and the work laptop keep working, but a new
feature may be Linux first.
Only Linux can be tested from Brett's main machine; treat Mac and Windows
changes as unverified until someone runs them.

- Local only: Node 22 server on 127.0.0.1:4747, SQLite through node:sqlite,
  plain HTML/CSS/JS page. Eight npm dependencies, each with one job: imapflow
  and mailparser (mail in), nodemailer (mail out), node-pty and ws (terminals),
  the three @xterm packages (the terminal on the page, served from
  node_modules). Nothing new goes in unless a feature truly needs it, and it
  is pinned to an exact version.
- On Brett's machine it runs as a systemd user service; after changing server
  code, `systemctl --user restart switchboard`. Claude sessions in tmux survive
  that; check `tmux ls` before anything that could kill tmux.
- Brett's machine: Linux Mint Cinnamon on X11 (wmctrl/xdotool, notify-send).
  macOS uses osascript, Windows uses PowerShell; see lib/desktop.js.
- Updates: each install is a git checkout; lib/update.js pulls and exits 75,
  and systemd / launchd / bin/run.mjs restarts it. Never break that path.
- Claude Code hooks (installed by `npm run setup`) post to `/hook/claude`.
  `bin/hook.sh` must never block or fail a Claude session.
- Gmail started read only. Brett asked on Nov 3 for the board to do everything (reply, archive, send);
  every send is an explicit click by Brett, never automatic.
- No paid services yet (Brett's rule). Bank data comes from alert emails;
  Teller's free tier is the next step if needed.
- Shared accounts belong to their owners: data from a work or co-owned tenant
  stays in its own project, and nothing new is pulled from it without that
  owner's okay (Brett's own list is in docs/HANDOFF.md, which is private).
- Reasons behind the shape of the code are in docs/DECISIONS.md; a change that
  picks one way over another adds a line there.
- A second copy for development: `SWITCHBOARD_PORT=4801
  SWITCHBOARD_DATA=$(mktemp -d) npm start`; stop it by its port, never by
  process name; never start a real agent session from a test copy.
- Licence: Fair Source (FSL-1.1-MIT). Outside contributions are signed off
  (CONTRIBUTING.md) so the project can relicense later.
- Design: docs/DESIGN.md is the system. The HUD (since Nov 8 2026, dark
  only): deep navy glass on a faint grid, electric cyan (--hud) for the
  interface, signal orange #FF4F00 for "needs you" only, white text kept
  plainly readable; faces shipped in public/fonts (Space Grotesk for display,
  Public Sans for body, JetBrains Mono for readouts and the terminal); the
  HUD layer in public/css/hud.css loads last; tokens in
  public/css/tokens.css, components in public/css/components. No hex, px size
  or radius outside tokens.css; a new component gets its own file and a
  paragraph in DESIGN.md. Orange means "needs you" and nothing else.
- Every POST needs the `X-Switchboard: 1` header and the Host must be
  127.0.0.1 or localhost: that keeps web pages in the browser from driving it.
- Where code lives: server.js (setup, security checks, the board state,
  background work) and lib/routes/*.js (one file per area of the API); lib/*.js
  for each connection and service; public/js/*.js for the page, one file per
  area, plain scripts loaded in order by index.html (no build step). Keep files
  small: a new area gets its own file rather than growing an old one.
- Everything in Switchboard that has to be set up, connected, signed in to,
  installed or repaired is a button on the page, with the result in plain words
  beside it; the page never tells anyone to open a terminal. Scripts and
  commands stay as the fallback in README.md, and a button runs the same thing
  on the server. A new connection or setup step ships with its button, or says
  in docs/DECISIONS.md why it can't have one.
- Sign-ins are one click and easy to finish, never a terminal errand. When a
  sign-in can't be done in a terminal or by a token pasted in Settings, it
  follows browser checks' pattern (lib/checkauth.js): a Sign in button where the
  need arises, and a Needs-you card on Now when it is required; the service's own
  page opens in a real window and the person signs in there, MFA included; one
  Done button that saves only once they are back on the site; Switchboard never
  sees a password or code, keeps only the session in a file private to their
  account, and has Sign out; when it runs out the item pauses and asks again,
  never a retry loop. A new sign-in that doesn't do this says why in
  docs/DECISIONS.md.
- Error messages say what happened and what to do about it, in plain words
  ("Todoist did not accept that token. Copy it again from …"); raw system
  errors go through lib/friendly.js, never straight to the page.
- Jarvis can do anything Switchboard can (Brett, Nov 10: "what good is a
  jarvis that can only do the bare minimum?"). Every new route gets an entry in
  lib/jarvisactions.js in the same change (test/jarvisapi.test.js fails
  without it), and a common spoken ask gets a quick command in
  lib/jarvistools.js. Deletes wait for a yes; sends to people stay Brett's click.
- No scrolling where it can be avoided (Brett, Nov 10): a panel, page or window
  fits one screen at a normal window size; columns, charts that fill the
  leftover height and lists cut to what fits come first. Long lists may scroll
  in their own box; stacking and scrolling below about 1100px is fine.
- Labels never wrap (Brett, Nov 10): a time, date, amount, name, button, chip,
  tab or menu item stays on one line; make room in the layout first, cut with
  "…" and a title only as a last resort; only sentences wrap. Run
  scripts/wrapcheck.js in the browser on what you changed (DESIGN.md, "Text
  never wraps a label") before calling UI work done.
- Every new feature or connection gets an entry in public/setup.js (the setup
  registry). The welcome and What's new are built from it, so nothing
  ships without people being shown it; test/setup.test.js enforces it for
  connections. Plans and their status live in docs/ROADMAP.md.
- The pitch (top of README.md and docs/PITCH.md) is made by `npm run pitch`
  from docs/headlines.json and the setup registry; run it after changing
  either. When a feature changes what makes Switchboard worth trying, update
  its headline (or add one, with a 20-second "show it") and the reviewed date.
- Keep README.md current with every feature or connection you ship: what it
  does, why, what it connects to and how, and its privacy story. It is written
  for people and for their AI assistants to explain Switchboard from, so keep
  its "For AI assistants" facts true (MCP tool names, install steps).
- No local AI model sits on the graphics card unused (Brett, Nov 10 2026):
  anything Switchboard loads (Jarvis's model in LM Studio, Ollama) unloads
  itself after a few idle minutes and loads again on command; a model process
  that lingers after LM Studio has let go of it is stopped (lib/jarvis.js).
- No AI attribution in commits.
- Agents: this file is the one set of rules (AGENTS.md, the shared standard).
  CLAUDE.md only imports it. Where it says Claude, read "any agent" unless it
  is about the Claude Code integration itself. Never run two agents against
  the same files at once without checking `git status` first.
