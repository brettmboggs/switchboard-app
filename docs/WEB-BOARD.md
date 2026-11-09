# The web board (stage 2, Nov 5 2026)

Built (sync-worker/src/board.js, public/js/web/, public/js/shared/). The board
is each person's own full Switchboard, synced to their account through the
app's own encrypted documents; Microsoft 365 (browser PKCE, Graph from the
browser) and GitHub (the service's one exchange, the token back after the #)
are connected there. Shared sessions are live through a relay room per shared
project (sync-worker/src/shares.js "live"). Where the build differs from this
design so far: signing in to the board itself is email and password only
(Google, Microsoft and GitHub sign-in are still to come); Gmail through Google
sign-in is not in the browser yet; scrypt runs on the page's own thread (about a
second) rather than a worker thread; integrity hashes cover the scripts and
stylesheets index.html loads, and the web board's own modules load under the
same-origin script policy; managing the team (inviting, changing what people
can do) stays in the app; repos' builds and pull requests reach the board
from members' Switchboards, in the signed repos box.

## What it is

(Without BOARD_URL set, invite links open a plain `/join` page on the sync
service that hands the invitation to Switchboard on the person's computer, or
tells them how to paste it. With it, `/join` goes to the board.)

The same Switchboard page, served by the sync service at a web address of the
team owner's choosing (for example `board.example.com`), so someone on a
locked-down work laptop can use it in a browser with nothing to install. It
looks and works like the page on your own computer, for everything that can
exist without a computer of your own behind it.

It is invite-only. Only an account that a team owner invited, or the owner
themselves, gets past sign-in. Anyone else sees the sign-in page and nothing more.

Anyone can run it. The sync service (`sync-worker/`) already runs on one's own
Cloudflare account. The web board is the same worker with the page's files
added and a custom domain pointed at it. Nothing is tied to one person's domain:
the domain, the providers people can sign in with, and who may sign up are all
the self-hoster's settings.

## How it holds: the browser does the opening

The worker never sees anything readable, on the web just as from the app:

- **Account key.** On sign-in the browser derives the account key from the
  password with scrypt, the same parameters as `lib/sync.js`. WebCrypto has no
  scrypt, so a small vendored scrypt (about 200 lines, no npm dependency) runs
  in a worker thread.
  - With Google, Microsoft or GitHub sign-in, the key comes the way a new
    computer gets it today: the recovery key, or pairing with one of your
    computers that is signed in.
  - The key stays in the tab's memory. An optional "keep me signed in" keeps it
    in IndexedDB, wrapped by a non-extractable WebCrypto key.
- **Sharing keys.** The browser unwraps your X25519 and Ed25519 keys from the
  service, exactly as `lib/share.js` does. WebCrypto supports both in current
  Chrome, Edge, Firefox and Safari.
- **Shared projects.** Each project's document is fetched, opened and checked
  in the browser. Only the kinds you may see open. Every row's signature is
  checked against the signed policy, and changes from someone who may only see
  are turned away, the same as on a computer.
  - Edits are signed and sealed in the browser, then uploaded with the same
    compare-and-swap.
- **The page's `api()`.** It goes to a small browser adapter instead of
  127.0.0.1. The adapter answers the routes that can exist on the web, and the
  pages that cannot are hidden (see the last section).

## What a member gets in the browser

- **Shared projects:** pages and checklists, to-dos and reminders, the About
  card, Activity, and the repos with Open in Codespaces, Download ZIP and Open
  on GitHub.
- **Builds and pull requests.** These cannot be read with someone else's
  GitHub. Each member's own computer publishes the runs and PRs it sees into
  the project's repos box. A member with no computer connects their own
  GitHub on the web (below).
- **Their own account:** notes and to-dos that are theirs, from their own
  encrypted account data.
- **The rest of the app's pages (Nov 6, the owner: "I want the full product
  there"):** Sessions (the shared projects' sessions, live from the sharer's
  computer as the Chat view, with Send; public/js/websessions.js), Builds (the
  shared runs and their own GitHub's), Browser checks, Calendar and Money, each
  fed by what the projects publish (public/js/web/adapter.js sharedViews).
  Money, Calendar and checks are read-only there: they come from the computer
  that has them. Still only on a computer: starting your own sessions, the
  System monitor, mail by app password, and adding checks.

## Signing in, and connecting services, any way

The Switchboard account belongs to no service:

- **Signing in** works with email and password, and with Google, Microsoft or
  GitHub wherever the self-hoster has turned that provider on (worker secrets,
  as today).
- **Teams is separate.** Signing in with Microsoft is never needed for Teams,
  and connecting Teams never changes how you sign in.

Connections are added any time later, in the app as today, or on the web:

- **Microsoft 365** (Teams, Outlook):
  - The browser does Microsoft's single-page-app sign-in (PKCE), straight from
    the browser to Microsoft, with the app registration's redirect set to the
    board's domain.
  - The tokens are sealed with your account key and kept in your own encrypted
    account data. The worker carries them but cannot read them.
  - Graph calls go from the browser to Microsoft.
- **GitHub:** the worker's GitHub sign-in hands the token to the browser once.
  It is sealed the same way, and calls go from the browser to GitHub.
- **Google Calendar and Gmail:** a Google "Web application" client; the
  service does the code exchange and each hourly renewal (Google needs the
  client's secret for both) and keeps no token (src/googleconnect.js). Gmail
  threads in Inbox with replies in the thread; every calendar on Calendar.
- **IMAP and SMTP mail** (iCloud, Fastmail, an app password) cannot run in a
  browser: browsers cannot open mail-server connections, and passing it
  through the worker would let the worker read the mail.
  - On the web, those accounts show what your own computer published (only if
    you choose), or nothing, with a line saying why.
  - Gmail and Outlook through their own sign-ins do work.
- **Calendar links (ICS):** the browser fetches them only where the calendar
  allows it (CORS). Otherwise your computer publishes them.

What you connect stays yours. Only what you put into a team project is shared,
under the same rules as from a computer.

## Sessions and shared conversations (stages 3 and 4)

These use the relay, to a computer that is online and allows it:

- **Sessions** (stage 3): a member's browser joins the relay for the project.
  The owner's computer offers the sessions it allows, and the browser shows
  them as Chat.
  - Typing goes in only after the computer's owner presses Approve, as with
    every message from elsewhere. Terminal text is sealed computer to browser.
- **Shared conversations** (stage 4): the owner picks a Teams chat or mail
  thread to share into a project. Their computer sends it sealed with that
  kind's key. A reply from a member is sent only after the owner approves it.

## Threat model, in a few lines

- **The worker and Cloudflare** see accounts, who shares with whom, sizes and
  times. They never see contents, keys or tokens, and cannot add anyone to a
  project, promote anyone, or change what is shared: rosters and policies are
  signed.
- **What it does not defend against:**
  - A worker that serves a tampered page could steal keys typed into it. This
    is the price of any web app. The mitigations are a strict CSP, Subresource
    Integrity on every file, and the app as the safer choice for owners.
  - A member's own compromised browser.
  - A member keeping what they were allowed to see.
- **Phishing:** an invite link works once, for 14 days, and only for the
  address it was sent to.

## What self-hosters run

- The worker (`npx wrangler deploy`), its D1 schemas in order, and a custom
  domain route in `wrangler.toml` (`routes = [{ pattern = "board.example.com", custom_domain = true }]`).
  With DNS on Cloudflare this touches only that subdomain, never the apex.
- Optional provider secrets: Google, Microsoft and GitHub, for sign-in and for
  connections.
- In each Switchboard: Settings, Account, Sync service set to their address,
  and the invite base (`inviteBase`) set to the board, so invite links open it.

## What will not work in the browser

- Agent sessions run on a computer; the browser only reaches them through the
  relay (stage 3).
- Terminals, the folder picker, Clone to this computer, local files and
  project files dropped on this computer.
- IMAP and SMTP mail, and Google Voice through mail.
- Desktop notifications when the tab is closed (web push could come later),
  windows, the System monitor, browser checks and Playwright.
- Hooks from Claude Code, the MCP server for agents, and webhooks into a
  computer (they still reach the account).
- Anything that needs another person's sign-in: builds come from the members'
  own computers, or from your own GitHub connection.
