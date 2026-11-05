// The parts only a program on this machine can do: list open windows, bring one
// to the front, read which window is in front, pop a desktop notification, and
// open a file in its own app or show it in its folder (open on macOS, explorer on Windows).
//
//   Linux (X11)  wmctrl, xdotool, notify-send, xdg-open (and the file manager over D-Bus)
//   macOS        osascript (System Events needs Accessibility permission for
//                the window list; notifications work without it)
//   Windows      PowerShell with a few user32 calls
//
// Every function fails soft: a missing tool means an empty list or a no-op, never
// a crash, so the rest of the board keeps working.
import { execFile, execFileSync, spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { spaceFor } from './spaces.js';

const OS = process.platform;   // 'linux' | 'darwin' | 'win32'

function run(cmd, args, timeout = 3000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : stdout));
  });
}

const APP_NAMES = [
  [/code/i, 'VS Code'], [/brave/i, 'Brave'], [/chrome/i, 'Chrome'], [/msedge|edge/i, 'Edge'],
  [/teams/i, 'Teams'], [/nemo|finder|explorer/i, 'Files'], [/terminal|iterm|wezterm|alacritty|kitty/i, 'Terminal'],
  [/claude/i, 'Claude'], [/outlook/i, 'Outlook'], [/slack/i, 'Slack']
];
const appName = (cls) => (APP_NAMES.find(([re]) => re.test(cls)) || [null, cls.split('.').pop()])[1];

// VS Code titles end in "<folder> - Visual Studio Code" (" — " on macOS): the folder is the repo.
function vsFolder(title) {
  if (!/Visual Studio Code$/.test(title)) return null;
  const parts = title.split(/ [-—] /);
  return parts.length >= 2 ? parts[parts.length - 2].trim() : null;
}
const isBoard = (title) => /^(\(\d+\) )?Switchboard$/.test(title);

// ---- Linux
async function linuxWindows() {
  const out = await run('wmctrl', ['-lx']);
  const active = parseInt((await run('xdotool', ['getactivewindow'])).trim(), 10) || null;
  const list = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^(0x[0-9a-f]+)\s+(-?\d+)\s+(\S+)\s+\S+\s+(.*)$/i);
    if (!m) continue;
    const [, hex, desk, cls, title] = m;
    if (desk === '-1' || /^(desktop_window|cinnamon|nemo-desktop|plank|xfce4-panel)/i.test(cls) || !title.trim() || title === 'Desktop' || isBoard(title)) continue;
    const id = parseInt(hex, 16);
    list.push({ id, title, app: appName(cls), active: id === active });
  }
  return list;
}

// ---- macOS: windows have no global id, so the id is a hash of app and title,
// and focusing raises the window with that title inside that app.
const macIndex = new Map();   // id -> { app, title }
const hash = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
async function macWindows() {
  const script = `
    const se = Application('System Events');
    const front = se.processes.whose({ frontmost: true })[0];
    const frontName = front ? front.name() : '';
    const out = [];
    for (const p of se.processes.whose({ backgroundOnly: false })()) {
      let wins = [];
      try { wins = p.windows(); } catch (e) { continue; }
      for (let i = 0; i < wins.length; i++) {
        let t = ''; try { t = wins[i].name() || ''; } catch (e) {}
        out.push({ app: p.name(), title: t, front: p.name() === frontName && i === 0 });
      }
    }
    JSON.stringify(out);`;
  let rows = [];
  try { rows = JSON.parse((await run('osascript', ['-l', 'JavaScript', '-e', script], 6000)) || '[]'); } catch {}
  macIndex.clear();
  return rows.filter((r) => r.title && !isBoard(r.title)).map((r) => {
    const id = hash(r.app + '\u0000' + r.title);
    macIndex.set(id, r);
    return { id, title: r.title, app: appName(r.app), active: !!r.front };
  });
}

// ---- Windows
const PS_USER32 = `Add-Type @"
using System; using System.Runtime.InteropServices;
public class W { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); }
"@;`;
const ps = (cmd, timeout) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], timeout || 6000);
async function winWindows() {
  const out = await ps(`${PS_USER32} $f = [W]::GetForegroundWindow().ToInt64(); Get-Process | Where-Object { $_.MainWindowTitle } | ForEach-Object { [pscustomobject]@{ id = $_.MainWindowHandle.ToInt64(); title = $_.MainWindowTitle; app = $_.ProcessName; front = ($_.MainWindowHandle.ToInt64() -eq $f) } } | ConvertTo-Json -Compress`);
  let rows = [];
  try { rows = JSON.parse(out || '[]'); if (!Array.isArray(rows)) rows = [rows]; } catch {}
  return rows.filter((r) => r.title && !isBoard(r.title)).map((r) => ({ id: Number(r.id), title: r.title, app: appName(r.app), active: !!r.front }));
}

// ---- shared
let last = { at: 0, list: [] };
export async function listWindows() {
  if (Date.now() - last.at < (OS === 'linux' ? 1500 : 4000)) return last.list;
  const raw = OS === 'linux' ? await linuxWindows() : OS === 'darwin' ? await macWindows() : OS === 'win32' ? await winWindows() : [];
  const list = raw.map((w) => { const folder = vsFolder(w.title); return { ...w, folder, space: spaceFor(w.title, folder) }; });
  last = { at: Date.now(), list };
  return list;
}

export async function focusWindow(id) {
  if (!id) return false;
  if (OS === 'linux') {
    await run('wmctrl', ['-i', '-a', '0x' + Number(id).toString(16).padStart(8, '0')]);
  } else if (OS === 'darwin') {
    const w = macIndex.get(Number(id));
    if (!w) return false;
    const q = (s) => JSON.stringify(s);
    await run('osascript', ['-l', 'JavaScript', '-e', `
      const se = Application('System Events'); const p = se.processes.byName(${q(w.app)});
      p.frontmost = true;
      const ws = p.windows.whose({ name: ${q(w.title)} });
      if (ws.length) ws[0].actions.byName('AXRaise').perform();`]);
  } else if (OS === 'win32') {
    await ps(`${PS_USER32} $h = [IntPtr]${Number(id)}; if ([W]::IsIconic($h)) { [W]::ShowWindow($h, 9) | Out-Null }; [W]::SetForegroundWindow($h) | Out-Null`);
  }
  last.at = 0;
  return true;
}

// Which window is in front right now. Read when the user submits a prompt, so the
// session is tied to the window he typed it in, on every platform.
export async function activeWindow() {
  const list = await (last.at = 0, listWindows());
  return list.find((w) => w.active)?.id || null;
}

export function notify(title, body) {
  const t = String(title || '').slice(0, 120), b = String(body || '').slice(0, 200);
  // Title and body are outside text (a session's name, a mail subject). On Linux
  // they are positional arguments, so "--" keeps one that starts with "-" from
  // being read as an option. osascript and PowerShell get them inside a quoted
  // string in the script (after -e / -Command), so a first "-" is just text there.
  if (OS === 'linux') execFile('notify-send', ['-a', 'Switchboard', '-i', 'dialog-information', '--', t, b], () => {});
  else if (OS === 'darwin') execFile('osascript', ['-e', `display notification ${JSON.stringify(b)} with title ${JSON.stringify(t)}`], () => {});
  else if (OS === 'win32') {
    const esc = (s) => s.replace(/'/g, "''");
    execFile('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command',
      `Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $n = New-Object System.Windows.Forms.NotifyIcon; $n.Icon = [System.Drawing.SystemIcons]::Information; $n.Visible = $true; $n.ShowBalloonTip(6000, '${esc(t)}', '${esc(b)}', 'Info'); Start-Sleep -Seconds 7; $n.Dispose()`],
      { windowsHide: true }, () => {});
  }
}

// ---- a file in its own app, or its folder with the file picked out.
// The path has been checked by lib/localfile.js. Both launch and let go: the
// app or file manager outlives the call, and a failure is false, never a throw.
// Programs and scripts are never opened, only shown in their folder: opening
// one would run it.
const RUNS = /\.(exe|com|bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|msi|msp|scr|lnk|reg|cpl|hta|jar|sh|bash|zsh|command|desktop|app|appimage|run|bin|pkg|scpt|workflow|py|pl|rb)$/i;
export const opensAsProgram = (path) => RUNS.test(String(path));
function launch(cmd, args) {
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch { return false; }
}
export function openPath(path) {
  if (opensAsProgram(path)) return false;
  if (OS === 'darwin') return launch('open', [path]);
  if (OS === 'win32') return launch('explorer.exe', [path]);
  return launch('xdg-open', [path]);
}
export function revealPath(path, isFolder = false) {
  if (OS === 'darwin') return launch('open', isFolder ? [path] : ['-R', path]);
  if (OS === 'win32') return launch('explorer.exe', isFolder ? [path] : [`/select,${path}`]);
  if (isFolder) return launch('xdg-open', [path]);
  // Nemo, Nautilus, Dolphin and Thunar answer FileManager1 and pick the file out;
  // when none does, the folder opens on its own.
  const uri = 'file://' + path.split('/').map(encodeURIComponent).join('/');
  execFile('dbus-send', ['--session', '--print-reply', '--dest=org.freedesktop.FileManager1', '--type=method_call', '/org/freedesktop/FileManager1',
    'org.freedesktop.FileManager1.ShowItems', `array:string:${uri}`, 'string:'], { timeout: 4000 }, (err) => { if (err) launch('xdg-open', [dirname(path)]); });
  return true;
}

// ---- the OS keychain: one secret by name, for this user only.
//   Linux   the Secret Service (GNOME Keyring, KWallet), through secret-tool if
//           installed, else Python's libsecret bindings (on Mint/Ubuntu by default)
//   macOS   the login Keychain (security)
//   Windows DPAPI: Windows encrypts it to this user; the result is kept in a file
// keychainGet returns the secret, null when there is none, or undefined when the
// keychain did not answer (still locked at login, say): callers must not treat
// "did not answer" as "none".
const LINUX_PY = `
import sys, gi
gi.require_version('Secret', '1')
from gi.repository import Secret
schema = Secret.Schema.new('dev.switchboard.Secret', Secret.SchemaFlags.NONE, {'name': Secret.SchemaAttributeType.STRING})
op, name = sys.argv[1], sys.argv[2]
if op == 'clear':
    Secret.password_clear_sync(schema, {'name': name}, None)
    sys.exit(0)
if op == 'get':
    v = Secret.password_lookup_sync(schema, {'name': name}, None)
    if v is None: sys.exit(3)
    sys.stdout.write(v)
else:
    ok = Secret.password_store_sync(schema, {'name': name}, Secret.COLLECTION_DEFAULT, 'Switchboard ' + name, sys.stdin.read(), None)
    sys.exit(0 if ok else 4)
`;
const kcRun = (cmd, args, input) => execFileSync(cmd, args, { input, timeout: 15000, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true }).toString();
const kcHas = (cmd) => { try { execFileSync('which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; } };

export function keychainGet(name, dataDir) {
  try {
    if (OS === 'linux') {
      if (kcHas('secret-tool')) return kcRun('secret-tool', ['lookup', 'app', 'switchboard', 'name', name]) || null;
      return kcRun('python3', ['-c', LINUX_PY, 'get', name]);
    }
    if (OS === 'darwin') return kcRun('security', ['find-generic-password', '-s', 'switchboard', '-a', name, '-w']).trim();
    if (OS === 'win32') {
      const file = `${dataDir}\\${name}.dpapi`;
      const ps = `Add-Type -AssemblyName System.Security; if (-not (Test-Path '${file}')) { exit 3 }; $b = [Convert]::FromBase64String((Get-Content -Raw '${file}').Trim()); [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($b, $null, 'CurrentUser'))`;
      return kcRun('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps]).trim();
    }
  } catch (e) {
    // "Not found" exits: secret-tool 1 with no output, our Python 3, security 44, PowerShell 3.
    if ((OS === 'linux' && (e.status === 3 || (e.status === 1 && !String(e.stdout || '').length && kcHas('secret-tool')))) || (OS === 'darwin' && e.status === 44) || (OS === 'win32' && e.status === 3)) return null;
    return undefined;
  }
  return undefined;
}

// Takes this computer's entry out of the keychain (Remove Switchboard, lib/uninstall.js).
// On Windows the entry is a file in the data folder, which goes with the folder.
export function keychainDelete(name) {
  try {
    if (OS === 'linux') {
      if (kcHas('secret-tool')) kcRun('secret-tool', ['clear', 'app', 'switchboard', 'name', name]);
      else kcRun('python3', ['-c', LINUX_PY, 'clear', name]);
      return true;
    }
    if (OS === 'darwin') { kcRun('security', ['delete-generic-password', '-s', 'switchboard', '-a', name]); return true; }
  } catch { return false; }
  return OS === 'win32';
}

export function keychainSet(name, value, dataDir) {
  try {
    if (OS === 'linux') {
      if (kcHas('secret-tool')) kcRun('secret-tool', ['store', '--label', `Switchboard ${name}`, 'app', 'switchboard', 'name', name], value);
      else kcRun('python3', ['-c', LINUX_PY, 'set', name], value);
      return keychainGet(name, dataDir) === value;
    }
    if (OS === 'darwin') { kcRun('security', ['add-generic-password', '-U', '-s', 'switchboard', '-a', name, '-w', value]); return keychainGet(name, dataDir) === value; }
    if (OS === 'win32') {
      const file = `${dataDir}\\${name}.dpapi`;
      const ps = `Add-Type -AssemblyName System.Security; $v = [Console]::In.ReadToEnd(); $b = [Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($v), $null, 'CurrentUser'); Set-Content -NoNewline -Path '${file}' -Value ([Convert]::ToBase64String($b))`;
      kcRun('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], value);
      return keychainGet(name, dataDir) === value;
    }
  } catch { return false; }
  return false;
}
