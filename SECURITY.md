# Security

Switchboard runs on your own computer and can type into your terminals, read
your mail and hold your passwords, so a hole in it matters. If you find one,
please tell us privately first.

## Reporting

Use GitHub's private vulnerability reporting on
[brettmboggs/switchboard-app](https://github.com/brettmboggs/switchboard-app/security/advisories/new)
(Security, Report a vulnerability). You will get an answer within three days,
and a fix or a plan within two weeks for anything that lets another program,
page or person act through Switchboard. Please do not open a public issue for
a security problem until it is fixed.

The latest release is the supported version. Git installs on the `stable`
branch and the desktop app both update to it.

## What Switchboard promises

- It listens on `127.0.0.1` only. Every request must carry the Host
  `127.0.0.1` or `localhost`; every change needs the `X-Switchboard: 1`
  header, and the server never answers a cross-origin preflight, so a web page
  in your browser cannot drive it. Terminals need a same-origin WebSocket.
- The page runs only its own scripts (Content Security Policy). Everything
  from outside (mail, chats, calendars, weather, transcripts) is drawn as
  text, never as HTML; the notebook keeps formatting through an allow-list.
- Passwords, tokens and private links are encrypted in the database with a
  key kept in your operating system's keychain. Synced data is encrypted on
  your computer; the sync service stores only ciphertext.
- Nothing is sent on your behalf without a click. Agents reach the board,
  sessions, builds and checks through MCP, never mail, chats or money.

## What reaches a shell

Two places run a command you typed: a session started with "Other command"
and a browser check of kind "tests" (its command, in its folder). Agents may
only set up a tests check that runs the project's own test runner. Everything
else uses `execFile` with argument lists, never a shell.

## Out of scope

Anything that needs to already run as your user on your computer (such a
program can read your files directly), and the security of the services you
connect to.
