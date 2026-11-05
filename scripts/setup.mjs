// npm run setup     makes Switchboard part of this computer
// npm run uninstall takes it all out again (Settings, General, Remove Switchboard
// runs the same: `parts` then `service`, see lib/uninstall.js)
//
//   1. Claude Code hooks in ~/.claude/settings.json (the first run keeps a backup)
//   2. start at login, and restart if it stops:
//        Linux   a systemd user service
//        macOS   a launchd agent
//        Windows a hidden starter in the Startup folder, running bin/run.mjs
//   3. a launcher: the Linux menu, ~/Applications on macOS, the Start menu on Windows
//   4. (setup.mjs voice, or Settings, General) talk to type: whisper.cpp and a speech model
//   5. Switchboard's MCP server (bin/mcp.mjs) registered with each coding agent installed:
//        Claude Code, Codex and Gemini CLI, through each one's own `mcp add`
//   6. (setup.mjs browser, opt in: a 170 MB download; `browser remove` takes it out) a headless Chromium, and the
//      Playwright MCP server registered with the same agents so they can drive it
//      with no window open. Switchboard's Browser checks (Actions page) use it too.
//
// Safe to run again after an update: it replaces its own entries, never doubles them.
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, rmSync, existsSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOME = homedir();
const OS = process.platform;
const mode = process.argv[2];
const sh = (cmd, args) => { try { execFileSync(cmd, args, { stdio: 'inherit', windowsHide: true }); return true; } catch { return false; } };

// ---- 1. Claude Code hooks
// The installed app (desktop/) keeps hook.sh and mcp.mjs beside its data and says so with SWITCHBOARD_BIN.
const BIN = process.env.SWITCHBOARD_BIN || join(HERE, 'bin');
const SETTINGS = join(HOME, '.claude', 'settings.json');
const HOOK = OS === 'win32' ? `"${join(BIN, 'hook.cmd')}"` : join(BIN, 'hook.sh');
const EVENTS = [['SessionStart'], ['UserPromptSubmit'], ['Notification'], ['Stop'], ['SubagentStart'], ['SubagentStop'], ['SessionEnd'], ['PostToolUse'], ['PreToolUse', 'AskUserQuestion'], ['PreModelSwitch'], ['PostModelSwitch']];
const OURS = /switchboard[\\/]+bin[\\/]+hook\.(sh|cmd)/i;
// The status line: Claude Code runs this command with the session's model,
// effort, context used and cost as JSON on stdin; bin/statusline.sh posts it to
// the board for the session's bar. Set only for someone with no status line of
// their own, and removed only when it is ours. To keep your own status line
// and still feed the board, chain the two in settings.json (sh, Linux and macOS):
//   "statusLine": { "type": "command", "command": "j=$(cat); printf %s \"$j\" | /path/to/switchboard/bin/statusline.sh; printf %s \"$j\" | your-own-command" }
const STATUS = OS === 'win32' ? `"${join(BIN, 'statusline.cmd')}"` : join(BIN, 'statusline.sh');
// Ours only when the whole command is ours: a person's own status line that chains ours in front of it is theirs and is left alone.
const OURS_STATUS = /^\s*"?[^|;&"]*switchboard[\\/]+bin[\\/]+statusline\.(sh|cmd)"?\s*$/i;

function hooks(install) {
  mkdirSync(dirname(SETTINGS), { recursive: true });
  const raw = existsSync(SETTINGS) ? readFileSync(SETTINGS, 'utf8') : '{}';
  if (existsSync(SETTINGS) && !existsSync(SETTINGS + '.before-switchboard')) copyFileSync(SETTINGS, SETTINGS + '.before-switchboard');
  const s = JSON.parse(raw || '{}');
  s.hooks ||= {};
  for (const ev of Object.keys(s.hooks)) {
    s.hooks[ev] = s.hooks[ev].map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !OURS.test(String(h.command || ''))) })).filter((g) => g.hooks.length);
    if (!s.hooks[ev].length) delete s.hooks[ev];
  }
  // The status line (see STATUS above): ours comes out first, so a reinstall
  // puts the current path back and an uninstall leaves nothing; someone else's
  // is never touched.
  if (s.statusLine && OURS_STATUS.test(String(s.statusLine.command || ''))) delete s.statusLine;
  let statusNote = '';
  if (install) {
    if (OS !== 'win32') try { chmodSync(join(BIN, 'hook.sh'), 0o755); chmodSync(join(BIN, 'statusline.sh'), 0o755); } catch {}
    for (const [ev, matcher] of EVENTS) {
      s.hooks[ev] ||= [];
      s.hooks[ev].push({ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command: `${HOOK} ${ev}`, timeout: 3 }] });
    }
    if (!s.statusLine) { s.statusLine = { type: 'command', command: STATUS }; statusNote = ' Status line set: sessions show their model, effort, context and cost.'; }
    else statusNote = ` Your own status line is kept; to show model, effort, context and cost on Sessions too, chain ${STATUS} into it (see scripts/setup.mjs).`;
  }
  writeFileSync(SETTINGS, JSON.stringify(s, null, 2) + '\n');
  console.log(install ? `Claude hooks added to ${SETTINGS}.${statusNote}` : 'Claude hooks removed.');
}

// ---- 1b. updates from the stable branch
// A git install updates from whatever branch it tracks (lib/update.js). The
// public repo's `stable` branch moves at each release; main moves at every push.
// A fresh clone tracks main (or master): move it to stable when the remote has
// one. A branch with any other name is somebody's own work and is left alone.
// Settings, General, About switches between Stable and Latest afterwards.
function upstream() {
  if (!existsSync(join(HERE, '.git'))) return;
  const git = (args) => { try { return execFileSync('git', args, { cwd: HERE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, timeout: 60000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).trim(); } catch { return null; } };
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!['main', 'master', 'stable'].includes(branch)) return;
  if (git(['rev-parse', '--abbrev-ref', '@{u}']) === 'origin/stable') { console.log('Updates come from the stable branch (releases).'); return; }
  git(['fetch', '--quiet', 'origin']);
  if (git(['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/stable']) === null) return;   // no stable branch yet: every push it is
  if (git(['branch', '--set-upstream-to=origin/stable']) === null) return;
  console.log(`Updates come from the stable branch (releases), not every push to ${branch}. Settings, General, About switches to Latest.`);
}

// ---- 2. start at login
const NODE_ARGS = ['--disable-warning=ExperimentalWarning', join(HERE, 'server.js')];

function linuxService(install) {
  const unit = join(HOME, '.config/systemd/user/switchboard.service');
  const sc = (...a) => sh('systemctl', ['--user', ...a]);
  if (!install) { sc('disable', '--now', 'switchboard.service'); rmSync(unit, { force: true }); sc('daemon-reload'); console.log('Service removed.'); return; }
  mkdirSync(dirname(unit), { recursive: true });
  writeFileSync(unit, `[Unit]
Description=Switchboard
After=graphical-session.target

[Service]
WorkingDirectory=${HERE}
ExecStart=${process.execPath} ${NODE_ARGS.join(' ')}
Restart=always
RestartSec=2
Environment=DISPLAY=${process.env.DISPLAY || ':0'}
Environment=PATH=${process.env.PATH}

[Install]
WantedBy=default.target
`);
  sc('daemon-reload'); sc('enable', 'switchboard.service'); sc('restart', 'switchboard.service');
  console.log('Running, and starts at login (systemctl --user status switchboard).');
}

function macService(install) {
  const label = 'dev.switchboard';
  const plist = join(HOME, 'Library/LaunchAgents', `${label}.plist`);
  const uid = process.getuid();
  sh('launchctl', ['bootout', `gui/${uid}/${label}`]);
  if (!install) { rmSync(plist, { force: true }); console.log('Login item removed.'); return; }
  mkdirSync(dirname(plist), { recursive: true });
  const x = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array><string>${x(process.execPath)}</string>${NODE_ARGS.map((a) => `<string>${x(a)}</string>`).join('')}</array>
  <key>WorkingDirectory</key><string>${x(HERE)}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${x(process.env.PATH)}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${x(join(HOME, 'Library/Logs/switchboard.log'))}</string>
  <key>StandardErrorPath</key><string>${x(join(HOME, 'Library/Logs/switchboard.log'))}</string>
</dict></plist>
`);
  sh('launchctl', ['bootstrap', `gui/${uid}`, plist]);
  console.log('Running, and starts at login (log: ~/Library/Logs/switchboard.log).');
}

function winService(install) {
  const startup = join(process.env.APPDATA, 'Microsoft/Windows/Start Menu/Programs/Startup');
  const vbs = join(startup, 'Switchboard.vbs');
  if (!install) { rmSync(vbs, { force: true }); console.log('Startup item removed. Close the running copy from Task Manager (node.exe) or restart.'); return; }
  mkdirSync(startup, { recursive: true });
  // A .vbs starts node with no console window.
  writeFileSync(vbs, `CreateObject("WScript.Shell").Run """${process.execPath}"" ""${join(HERE, 'bin', 'run.mjs')}""", 0, False\r\n`);
  sh('wscript.exe', [vbs]);
  console.log('Running, and starts when you sign in to Windows.');
}

// ---- 3. launcher
function linuxLauncher(install) {
  const f = join(HOME, '.local/share/applications/switchboard.desktop');
  if (!install) { rmSync(f, { force: true }); return; }
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, `[Desktop Entry]
Type=Application
Name=Switchboard
Comment=Everything that needs you, on one screen
Exec=${process.execPath} ${join(HERE, 'bin/open.mjs')}
Icon=${join(HERE, 'public/icon.svg')}
Categories=Office;Utility;
StartupWMClass=127.0.0.1
`);
  console.log('Switchboard is in the app menu.');
}

function macLauncher(install) {
  const app = join(HOME, 'Applications/Switchboard.app');
  rmSync(app, { recursive: true, force: true });
  if (!install) return;
  mkdirSync(join(app, 'Contents/MacOS'), { recursive: true });
  writeFileSync(join(app, 'Contents/Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Switchboard</string>
  <key>CFBundleIdentifier</key><string>dev.switchboard.launcher</string>
  <key>CFBundleExecutable</key><string>switchboard</string>
  <key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>
`);
  const exe = join(app, 'Contents/MacOS/switchboard');
  writeFileSync(exe, `#!/bin/sh\nexec "${process.execPath}" "${join(HERE, 'bin/open.mjs')}"\n`);
  chmodSync(exe, 0o755);
  console.log('Switchboard is in ~/Applications (drag it to the Dock if you like).');
}

function winLauncher(install) {
  const lnk = join(process.env.APPDATA, 'Microsoft/Windows/Start Menu/Programs/Switchboard.lnk');
  rmSync(lnk, { force: true });
  if (!install) return;
  const q = (s) => s.replace(/'/g, "''");
  sh('powershell.exe', ['-NoProfile', '-Command',
    `$s = (New-Object -ComObject WScript.Shell).CreateShortcut('${q(lnk)}'); $s.TargetPath = '${q(process.execPath)}'; $s.Arguments = '"${q(join(HERE, 'bin', 'open.mjs'))}"'; $s.WindowStyle = 7; $s.Save()`]);
  console.log('Switchboard is in the Start menu.');
}

// ---- 4. talk to type: whisper.cpp and a speech model, so dictation works in any
// browser and stays on this computer. Linux and Windows use the project's own
// builds; macOS uses Homebrew's. The model is picked to suit the machine.
const VOICE = join(process.env.SWITCHBOARD_DATA || join(HOME, '.local/share/switchboard'), 'voice');
async function download(url, file) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const { createWriteStream } = await import('node:fs');
  const out = createWriteStream(file);
  let got = 0, shown = -1;
  for await (const chunk of res.body) {
    out.write(chunk); got += chunk.length;
    const pct = total ? Math.floor(got / total * 100) : 0;
    if (pct !== shown && pct % 5 === 0) { shown = pct; console.log(`progress ${pct}`); }
  }
  await new Promise((ok) => out.end(ok));
}
async function voice() {
  const { cpus, totalmem } = await import('node:os');
  const bin = join(VOICE, 'bin');
  mkdirSync(bin, { recursive: true });
  const exe = join(bin, OS === 'win32' ? 'whisper-cli.exe' : 'whisper-cli');
  if (!existsSync(exe)) {
    if (OS === 'darwin') {
      console.log('step Installing whisper.cpp with Homebrew');
      if (!sh('brew', ['install', 'whisper-cpp'])) throw new Error('Needs Homebrew (brew.sh), then try again.');
      const found = ['/opt/homebrew/bin/whisper-cli', '/usr/local/bin/whisper-cli'].find(existsSync);
      if (!found) throw new Error('Homebrew installed whisper-cpp, but whisper-cli was not found.');
      const { symlinkSync } = await import('node:fs');
      symlinkSync(found, exe);
    } else {
      const asset = OS === 'win32' ? 'whisper-bin-x64.zip' : process.arch === 'arm64' ? 'whisper-bin-ubuntu-arm64.tar.gz' : 'whisper-bin-ubuntu-x64.tar.gz';
      console.log('step Downloading whisper.cpp');
      const releases = await (await fetch('https://api.github.com/repos/ggml-org/whisper.cpp/releases?per_page=10', { headers: { 'User-Agent': 'switchboard-setup' } })).json();
      const url = releases.flatMap((r) => r.assets || []).find((a) => a.name === asset)?.browser_download_url;
      if (!url) throw new Error('Could not find a whisper.cpp build for this computer.');
      const archive = join(VOICE, asset);
      await download(url, archive);
      if (OS === 'win32') sh('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -Force -LiteralPath '${archive.replace(/'/g, "''")}' -DestinationPath '${bin.replace(/'/g, "''")}'`]);
      else sh('tar', ['xzf', archive, '-C', bin, '--strip-components=1']);
      rmSync(archive, { force: true });
      // The Windows zip keeps its files in a Release folder.
      if (!existsSync(exe)) {
        const { readdirSync, renameSync } = await import('node:fs');
        for (const sub of readdirSync(bin)) { const inner = join(bin, sub); if (existsSync(join(inner, 'whisper-cli.exe'))) for (const f of readdirSync(inner)) renameSync(join(inner, f), join(bin, f)); }
      }
      if (!existsSync(exe)) throw new Error('whisper.cpp downloaded, but whisper-cli is missing from it.');
    }
  }
  const big = totalmem() >= 15e9 && cpus().length >= 8;
  const name = big ? 'small.en' : 'base.en';
  const model = join(VOICE, `ggml-${name}.bin`);
  if (!existsSync(model)) {
    console.log(`step Downloading the speech model (${big ? '490' : '150'} MB)`);
    await download(`https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${name}.bin`, model + '.part');
    const { renameSync } = await import('node:fs');
    renameSync(model + '.part', model);
  }
  writeFileSync(join(VOICE, 'voice.json'), JSON.stringify({ exe, model }));
  console.log('Talk to type is ready.');
}

// ---- 5. the MCP server, for every coding agent here
// Each agent's own command does the writing, so its config format is its own
// business. Removing first makes a second run replace, never double.
const quiet = (cmd, args, timeout = 30000) => { try { execFileSync(cmd, args, { stdio: 'ignore', windowsHide: true, shell: OS === 'win32', timeout }); return true; } catch { return false; } };
function register(name, command, install) {
  const agents = [
    ['Claude Code', 'claude', ['mcp', 'remove', '-s', 'user', name], ['mcp', 'add', '-s', 'user', name, '--', ...command]],
    ['Codex', 'codex', ['mcp', 'remove', name], ['mcp', 'add', name, '--', ...command]],
    ['Gemini CLI', 'gemini', ['mcp', 'remove', '-s', 'user', name], ['mcp', 'add', '-s', 'user', name, ...command]]
  ];
  const done = [];
  for (const [label, cmd, rm, add] of agents) {
    if (!quiet(cmd, ['--version'])) continue;
    quiet(cmd, rm);
    if (!install || quiet(cmd, add)) done.push(label);
  }
  return done;
}
function mcp(install) {
  const done = register('switchboard', [process.execPath, join(BIN, 'mcp.mjs')], install);
  if (done.length) console.log(install ? `Switchboard's tools added to ${done.join(', ')}.` : `Switchboard's tools removed from ${done.join(', ')}.`);
}

// ---- 6. a headless browser for agents and Browser checks (opt in)
// One pinned Playwright MCP release, so the Chromium installed here is the one it
// runs. Keep in step with lib/browserchecks.js (test/browserchecks.test.js checks).
const PLAYWRIGHT_MCP = '@playwright/mcp@0.0.84';
const npx = (args, opts = {}) => { try { execFileSync(OS === 'win32' ? 'npx.cmd' : 'npx', args, { stdio: 'inherit', windowsHide: true, shell: OS === 'win32', ...opts }); return true; } catch { return false; } };
function browser(install) {
  // npx through cmd on Windows: an agent cannot start a .cmd file by itself.
  const run = [...(OS === 'win32' ? ['cmd', '/c'] : []), 'npx', '-y', PLAYWRIGHT_MCP, '--headless', '--browser', 'chromium'];
  if (install) {
    // Only the full Chromium: the agents' browser and the checks both run it in its
    // new headless mode, so the separate headless shell would be 280 MB for nothing.
    console.log('step Installing headless Chromium (a 170 MB download, about 400 MB on disk)');
    if (!npx(['-y', '-p', PLAYWRIGHT_MCP, 'playwright', 'install', '--no-shell', 'chromium'])) throw new Error('Chromium did not install. Check the connection and try again.');
    if (OS === 'linux') console.log(`If Chromium later says libraries are missing: sudo npx -y -p ${PLAYWRIGHT_MCP} playwright install-deps chromium`);
  }
  const done = register('playwright', run, install);
  if (install) console.log(done.length ? `Headless browser added to ${done.join(', ')} (MCP server "playwright"). Restart open agent sessions to pick it up.` : 'Chromium is installed. No coding agent found to add the browser to.');
  else {
    if (done.length) console.log(`Headless browser removed from ${done.join(', ')}.`);
    // Takes away the Chromium this added, unless another Playwright still uses it.
    // --no: if it was never installed, nothing is downloaded just to remove it.
    if (npx(['--no', '-p', PLAYWRIGHT_MCP, 'playwright', 'uninstall'], { stdio: 'ignore', timeout: 120000 })) console.log('Its Chromium is removed.');
  }
}

if (mode === 'mcp') { mcp(true); process.exit(0); }
// Puts the hooks back in step after an update adds an event (keeps the person's own hooks).
if (mode === 'hooks') { hooks(true); process.exit(0); }
if (mode === 'browser') { try { browser(process.argv[3] !== 'remove'); process.exit(0); } catch (err) { console.error('error ' + err.message); process.exit(1); } }
// The installed app (desktop/sidecar/start.mjs): hooks and MCP only; the app is its own launcher and login item.
if (mode === 'app') { hooks(true); mcp(true); process.exit(0); }
// Remove Switchboard (lib/uninstall.js): everything but the login service first,
// while the server is still there to say how it went; the service, which stops
// the server, goes last.
if (mode === 'remove-parts') { hooks(false); mcp(false); browser(false); if (process.argv[3] !== 'app') ({ linux: linuxLauncher, darwin: macLauncher, win32: winLauncher }[OS])?.(false); process.exit(0); }
if (mode === 'remove-service') { ({ linux: linuxService, darwin: macService, win32: winService }[OS])?.(false); process.exit(0); }
if (mode === 'voice') {
  voice().then(() => process.exit(0), (err) => { console.error('error ' + err.message); process.exit(1); });
} else {
const service = { linux: linuxService, darwin: macService, win32: winService }[OS];
const launcher = { linux: linuxLauncher, darwin: macLauncher, win32: winLauncher }[OS];
if (!service) { console.log(`Switchboard has no installer for ${OS} yet. Run it with: npm start`); process.exit(1); }

if (mode === 'install') { hooks(true); upstream(); service(true); launcher(true); mcp(true); console.log('\nOpen Switchboard from your apps, or go to http://127.0.0.1:4747'); }
else if (mode === 'remove') { hooks(false); launcher(false); mcp(false); browser(false); service(false); }
else console.log('Usage: node scripts/setup.mjs install|remove|hooks|voice|mcp|browser [remove]');
}
