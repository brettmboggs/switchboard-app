# Changelog

What changed for the person using Switchboard, newest first. The dates are
the `added` dates in `public/setup.js`, which is also what "New in
Switchboard" on the Now page is built from.

## Unreleased

- Calendar: a page with a month of everything on your connected calendars (any
  calendar link, and iCloud, Fastmail or Yahoo from your email account), a day
  opened underneath with its times, places and which calendar it is on. Adding
  and editing events from here comes next, starting with Google.
- Google Calendar, read and write: Settings, Connections, Calendars has Sign in
  with Google (Google's own page, in a new tab; Switchboard never sees a
  password), then tick the calendars to show. On the Calendar page, Add event,
  and click an event to change or delete it. Calendars added by link stay
  read only.
- Browser checks can run signed in: Sign in opens a real browser window, you
  sign in yourself, Done saves it privately on this computer, and a project's
  tests get it as SB_AUTH_STATE for that check only. It pauses and asks again
  when it runs out.

- The phone app shows the same pages as here: it asks a computer that shares
  its sessions for its board (Now, Inbox, Money, Builds, projects) and acts
  through that computer's own routes, end-to-end encrypted over the relay.
  Only what the pages do is allowed: never settings, the account, keys,
  updates, connecting accounts, or this computer's windows and files.
  It can also bring a conversation into a session, attach a photo to a
  message, add and remove browser checks, and show the system monitor.
- The phone app can start a session on one of your computers (in one of that
  computer's project folders, with an agent installed there) and rename one.
  Like the rest of the phone's access, this works only on computers that share
  their sessions (Settings, Accounts), and every request is end-to-end
  encrypted.
- A new logo: three streams converge on one jack and leave as one, with the
  lamp inside it as the state light. The wordmark is set in lowercase Public
  Sans Bold, the dock and app icons are redrawn, and the browser tab's icon is
  a small cut that stays clear at 16 px. A brand pack of SVGs (app icon, marks
  for light and dark, monochrome, wordmarks with the letters turned to
  outlines) is in docs/brand.
- System monitor (Settings, System, Open the monitor): live charts for the
  processor (and each thread), memory, graphics, network and storage,
  temperatures and fans where the computer shares them, the apps using the
  most, and a line in words about what is straining. Linux, macOS and Windows.
  It reads numbers only while it is open, keeps no history and sends nothing.
- A new face: Fraunces for titles, Public Sans for text, JetBrains Mono for
  readouts and the terminal, all shipped with Switchboard. The page no longer
  loads anything from Google Fonts.
- One design system under the page: tokens (colours for light and dark, type,
  spacing, radii, shadows, layers), shared buttons, cards, rows and fields,
  one stylesheet per page, documented in docs/DESIGN.md.
- Dialogs keep the keyboard inside, make the page behind them inert, and give
  focus back when they close; Escape closes only the dialog on top.
- Error toasts look like errors (a red edge) and stay long enough to read.
- Readable text where it was not: the console's hints and placeholder, the
  package chip, the page-title placeholder.
- The terminal takes its colours from the same tokens as the chat.
- Fair Source licence (FSL-1.1-MIT), SECURITY.md, PRIVACY.md and
  CONTRIBUTING.md.
- "Show me" on New in Switchboard now does something on every entry.
- A crafted email can no longer stall the server (mail snippet cleaning is
  bounded).
- Agents may only set up browser checks that run a project's own test runner.
- Light theme: cards, tiles and the console have their border back.
- Other computers on your account can use this computer's sessions only
  after you turn it on (Settings, Accounts).
- Agent tools and comments say "the user", not the author's name.
- CI on every push: tests, audit, syntax, a personal-data gate, a boot test.
- Settings, General, About: which Switchboard you have (version, build,
  computer) and Check for updates.
- Update channels: Stable (releases, `git clone -b stable`, what `npm run
  setup` picks when the repo has it) or Latest (every change), switched in
  About.
- THIRD-PARTY-NOTICES.txt: the licences of everything bundled, in the repo
  and in the desktop app.
- `npm run lint` (ESLint, no plugins) in CI; Dependabot weekly; the audit
  runs weekly even without a push.

## 0.1.0 (2026-11-01 to 2026-11-03)

The first version, built in three days of daily use.

Connections: a Switchboard account (end-to-end encrypted sync between your
computers), projects with rules, Gmail and any IMAP email, calendars by
private link, weather with warnings, webhooks in, Teams and Outlook, GitHub,
Claude Code, Codex, Gemini, browser checks.

On the page: Now (everything in flight as cards), Sessions as a chat with one
message bar and Claude's questions as buttons, Builds (GitHub Actions live),
Browser checks, Inbox conversations like Teams, Money, Notes with a notebook
(formatting bar, checklists, calculator, lists and logs from Ctrl K), chores
and routines, packages from shipping mail, Ctrl K for anything, talk to type
(live or private), dark theme and text sizes, paste images to an agent, bring
one message into a session, sessions on every computer, MCP tools for your
agents, and the desktop app (Windows, macOS, Linux).
