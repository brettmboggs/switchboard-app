# The Switchboard app

A download-and-double-click Switchboard: its own icon, its own window (no
browser), a tray icon, and updates from GitHub Releases. Built with Tauri v2,
which uses the webview the OS already has (WebView2 on Windows, WKWebView on
macOS, WebKitGTK on Linux) instead of shipping Chromium, so the shell itself
costs a few tens of MB of RAM, not hundreds. Electron is out for that reason.

The app is a thin shell. Everything Switchboard does still lives in the Node
server (`server.js`); the window loads `http://127.0.0.1:4747` exactly as the
browser did.

## How it runs

| | |
|---|---|
| Starting | If something already answers on 4747 (a git checkout's systemd or launchd service), the app just shows it and starts nothing. Otherwise it starts the bundled Node on the app's own copy of the server, and keeps it running like `bin/run.mjs` does: exit 75 restarts at once, a crash waits a little longer each time. If someone else's server was answering and goes quiet, it gets 15 seconds to come back (a service restarting after its own update) before the app starts one. |
| Closing the window | Hides it. The server keeps running, so reminders, notifications and agent hooks keep working. The tray icon (menu bar on a Mac) has Open, Start at login, Quit. |
| Quit | Stops the server the app started (never one it found running) and exits. Claude sessions in tmux (Linux, macOS with tmux) keep running and come back when Switchboard does; on Windows sessions end, as they do on any Switchboard restart there. |
| Login | Starts at login, hidden in the tray, on by default; untick it in the tray menu. |
| One copy | Opening it again brings the existing window to the front. |
| Links | Anything outside 127.0.0.1 opens in the default browser. |
| Logs | The server's output goes to `server.log` in the app's log folder (Linux `~/.local/share/dev.switchboard.desktop/logs`, macOS `~/Library/Logs/dev.switchboard.desktop`, Windows `%LOCALAPPDATA%\dev.switchboard.desktop\logs`). |
| Data | The same place as a git install (`~/.local/share/switchboard`, or `SWITCHBOARD_DATA`), so moving from one to the other keeps everything. |

On first start (and after each app update) the server runs `scripts/setup.mjs
app`: the Claude Code hooks and the MCP server, as `npm run setup` does, but no
login service or launcher (the app is both). The hook and MCP scripts are copied
to `~/.local/share/switchboard/bin/` and registered from there, because the app's
own folder can move (an AppImage mounts somewhere new on every run). Apps started
from the Dock or a desktop menu get a short PATH, so the server first asks the
login shell for the real one (tmux, git, gh, claude). That is
`desktop/sidecar/start.mjs`.

## How Node and the app's files ship

The bundle carries a Node binary as a Tauri sidecar (`switchboard-node`, so the
.deb never collides with `/usr/bin/node`) and the app's files as resources
(`server.js`, `lib/`, `public/`, `bin/`, `scripts/` and production
`node_modules`), with `LICENSE` and `THIRD-PARTY-NOTICES.txt` (the licences of
everything bundled, written by `npm run notices`) beside them.
`desktop/scripts/stage.mjs` prepares all of it before each build.

Why not Node's single-executable apps (SEA): a SEA is one script blob. node-pty
is a native addon (a `.node` file, plus `spawn-helper` on macOS and
`conpty.dll`/`winpty-agent.exe` on Windows) and cannot be loaded from inside the
blob; it would have to be written out to disk at start and loaded from there,
and the server also reads `public/` from disk and launches `scripts/setup.mjs`
and `bin/mcp.mjs` with Node as separate processes. A plain Node plus real files
needs none of that, and the server runs exactly as it does from a checkout.

node-pty uses Node-API, so its addon does not depend on the exact Node version.
macOS and Windows use the prebuilt addons node-pty ships (stage.mjs keeps only
the one for the target); Linux compiles it on the CI runner (Ubuntu 22.04, for
an older glibc). The Node copied in is the one CI set up (`setup-node`, Node
22), or the same version from nodejs.org for the Intel Mac build made on an
arm64 runner.

Size: Node is most of the download (about 40 MB compressed). RAM is the shell
plus the same Node server as before.

## Updates

- **A git checkout** updates as it always has: `lib/update.js` pulls and exits
  75, and systemd, launchd or `bin/run.mjs` starts it again. Nothing changed.
- **The app** is not a git checkout, so `lib/update.js` stays quiet in it. The
  app checks `releases/latest/download/latest.json` on GitHub 30 seconds after
  starting and every six hours. When there is a newer signed version it asks
  ("Restart now" / "Later"), installs it and restarts. Updates must be signed
  with the updater key; the public half is in `tauri.conf.json`.

The updater key was made with `tauri signer generate`. The private key and its
password live only on Brett's machine in `~/.config/switchboard-release/`
(`updater.key`, `updater.key.password`). They must become the repository secrets
`TAURI_SIGNING_PRIVATE_KEY` (contents of updater.key) and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Lose the key and installed apps can never
update again (they would need a reinstall), so back it up somewhere safe.

## Releasing

`.github/workflows/desktop.yml` builds on a `vX.Y.Z` tag (the version comes
from the tag) or by hand from the Actions tab (GitHub only offers that once the
workflow is on master). It makes a **draft** release and attaches:

| | |
|---|---|
| Windows | `Switchboard_windows_x64-setup.exe` (installs per user, no admin), `Switchboard_windows_x64.msi` |
| macOS | `Switchboard_darwin_aarch64.dmg` (Apple silicon), `Switchboard_darwin_x64.dmg` (Intel) |
| Linux | `Switchboard_linux_amd64.deb`, `Switchboard_linux_amd64.AppImage` |

plus the updater files (`.sig`, `.app.tar.gz`, `latest.json`). Publishing the
draft is what ships it: installed apps only see published releases. A download
page can link to `https://github.com/<owner>/<repo>/releases/latest/download/<name>`
with the names above, which never change between versions.

**Where releases live.** Releases are published from the public repository
`brettmboggs/switchboard-app`, which is what the updater endpoint in
`tauri.conf.json` and the download links point at. Development may happen
elsewhere; only that repository's Releases page is read by installed apps.

**Signing.** Windows builds are unsigned: SmartScreen says "Windows protected
your PC" until people click More info, Run anyway. Mac builds are ad-hoc signed
only: macOS refuses to open them from a download until the person goes to
System Settings, Privacy & Security, Open Anyway. Real Mac signing and
notarization needs an Apple Developer account; the workflow has the step ready
(set the repository variable `MAC_SIGNING` to `true` and add the secrets
`APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`,
`APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`).

## Building it yourself

```sh
cd desktop
npm install
npm run tauri build      # runs scripts/stage.mjs first
```

Needs Node 22.13+, Rust (rustup.rs) and, on Linux:

```sh
sudo apt install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf libssl-dev build-essential
```

`npm run dev` runs it without bundling (it still needs a staged build).

## What is verified

All six installers build in CI (Linux on Ubuntu 22.04, Windows, macOS arm64
and x64 on an arm64 runner). On Linux the server from the CI-built .deb (its
bundled Node, node-pty, start.mjs, the hooks) was run in a sandbox and served
the board, and the app binary's libraries all resolve on Mint. The window, tray, autostart
and updater have not been clicked through on any OS yet; Mac and Windows are
unverified until someone runs them. Talk to type inside the app's webview is
unverified everywhere (WebKitGTK in particular may refuse the microphone).
