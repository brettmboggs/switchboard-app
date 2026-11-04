# Contributing

Thanks for looking. [AGENTS.md](AGENTS.md) is the one set of rules for people
and for coding agents; read it first. This page is the short version for a
person with a pull request.

## The licence, and what it means for a contribution

Switchboard is Fair Source under the Functional Source License (FSL-1.1-MIT,
see [LICENSE](LICENSE)): you may use it for anything except offering it as a
competing product or service, and each release becomes MIT two years after
it ships. So that the project can keep offering it that way (and relicense
later), every contribution is made under the same licence and you agree that
the maintainer may relicense your contribution together with the rest of the
code. Opening a pull request is your agreement to that; add
`Signed-off-by: Your Name <you@example.com>` to your commits
(`git commit -s`) to say so.

## Run it

Node 22.13 or newer and git. On Linux, `build-essential` and `python3` so
`node-pty` can compile.

```sh
git clone https://github.com/brettmboggs/switchboard-app.git
cd switchboard-app
npm install
npm start            # http://127.0.0.1:4747
npm test
```

A second copy for development, so your real board is untouched:

```sh
SWITCHBOARD_PORT=4801 SWITCHBOARD_DATA=$(mktemp -d) npm start
```

Stop it by its port (`ss -ltnp | grep 4801`, then `kill <pid>`), never by
process name: that would take your real Switchboard and your agent sessions
down with it. Never start a real agent session from a test copy: it resizes
the terminals of the real one.

## Rules that every change keeps

- Local only. Every POST needs the `X-Switchboard: 1` header and a local
  Host. Nothing listens beyond `127.0.0.1`.
- Everything from outside (mail, chats, calendars, transcripts) is drawn
  through `esc()` or DOM nodes, never as HTML.
- No new dependency without a real need, pinned to an exact version, with a
  line in `docs/DECISIONS.md` saying why.
- OS-specific calls live only in `lib/desktop.js`, `lib/terminals.js` and
  `scripts/setup.mjs`.
- A new feature or connection gets an entry in `public/setup.js` (the setup
  registry) and a paragraph in `README.md`. A test fails otherwise.
- Nothing is ever sent on the user's behalf without a click.
- No personal data in code or fixtures: settings hold people's data, fixtures
  are made up. CI checks.
- Plain language in the page and the docs, written for someone who is not a
  developer.
- Commit messages say what changed for the person using it. No AI
  attribution.

## Before you open the pull request

`npm test` passes; `node --check` on anything you touched; you ran it in a
browser, light and dark; and if it touches Mac or Windows paths, say whether
you ran it there (most of us cannot).
