<!-- The rules for every coding agent in this repo (Claude Code, Codex, Gemini, Cursor, Copilot…).
     CLAUDE.md imports this file. Put rules here, not there. -->

# Switchboard

Brett's console for everything he runs, built for his own daily use first
(Nov 3 2026). It now also has to install and run for others (a Windows work
laptop, a Mac): keep personal data out of the code (it lives in each person's
settings), and keep every OS-specific call behind
lib/desktop.js, lib/terminals.js (MODE tmux | direct), lib/sysprobe.js (the
System monitor's readings) and scripts/setup.mjs.
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
- Design: docs/DESIGN.md is the system. The counter (grey #E4E7EB, paper
  #FCFCFA, ink #15171C, signal #FF4F00, orange text #B33300, muted #5C626C),
  three faces shipped in public/fonts (Fraunces for display, Public Sans for
  body, JetBrains Mono for readouts and the terminal), tokens in
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
- Every new feature or connection gets an entry in public/setup.js (the setup
  registry). The welcome and "New in Switchboard" are built from it, so nothing
  ships without people being shown it; test/setup.test.js enforces it for
  connections. Plans and their status live in docs/ROADMAP.md.
- Keep README.md current with every feature or connection you ship: what it
  does, why, what it connects to and how, and its privacy story. It is written
  for people and for their AI assistants to explain Switchboard from, so keep
  its "For AI assistants" facts true (MCP tool names, install steps).
- No AI attribution in commits.
- Agents: this file is the one set of rules (AGENTS.md, the shared standard).
  CLAUDE.md only imports it. Where it says Claude, read "any agent" unless it
  is about the Claude Code integration itself. Never run two agents against
  the same files at once without checking `git status` first.
