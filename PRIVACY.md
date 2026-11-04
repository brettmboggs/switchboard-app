# Privacy

Switchboard is a program on your computer, not a service. There is no
account with us unless you make one for sync, no analytics, no crash
reporting, and nothing is read from your computer except what you connect.

## What stays on your computer

Everything: your mail cache, chats, notes, money lines, session transcripts,
settings and passwords, in one SQLite file under your user folder
(`~/.local/share/switchboard` on Linux, the equivalent on macOS and Windows).
Passwords, tokens and private calendar links are encrypted in that file with
a key in your operating system's keychain.

## What leaves your computer, and to whom

Only because you connected it, and only to that service:

| You connect | Switchboard talks to | Sends |
|---|---|---|
| An email account | Your mail provider over IMAP and SMTP | Your sign-in; replies and mail you click Send on |
| Microsoft 365 | Microsoft Graph | Your sign-in; replies you click Send on |
| GitHub | GitHub, through the `gh` command | What `gh` sends: your token, the repo names |
| A calendar link | The address of that link | Nothing but the request |
| Weather | Open-Meteo and the US National Weather Service, no account | The town or ZIP you typed |
| Updates (git install) | GitHub | A fetch of the repository |
| The desktop app | GitHub Releases | A check for a newer version every six hours |
| A Switchboard account (optional) | The sync service (a Cloudflare Worker run by the author) | Encrypted data only. The service, and whoever runs it, cannot read it. Cloudflare's logs see your IP address and times, as with any web request |
| Webhooks (optional, through the account) | The sync service | Messages sealed to your computer's key |

Fonts: the page's typefaces (Fraunces, Public Sans, JetBrains Mono) ship
with Switchboard in `public/fonts` and are served by the local server, so a
page load makes no request to Google Fonts or any other font service. The
page's Content Security Policy allows fonts and styles from the local server
only.

Talk to type: "Live" uses your browser's own speech service (Google's in
Chrome); "Private" runs Whisper on your computer and sends nothing.

## Agents

Coding agents get Switchboard tools over MCP: the board, your sessions, their
builds and browser checks. Mail, chats and money are not offered. Nothing
Switchboard does sends your data to an AI service by itself; a session only
sees what you send it.

## Your data, your file

Delete the data folder and Switchboard forgets everything. Removing the
sync account deletes your ciphertext from the service.
