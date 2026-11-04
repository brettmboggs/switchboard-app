// Opens Switchboard in its own app window: Chrome, Brave or Edge with --app,
// whichever is installed, or the default browser as a last resort. If a
// Switchboard window is already open on Linux, brings it to the front instead.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const URL = 'http://127.0.0.1:4747';
const go = (cmd, args) => { spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref(); };
const has = (cmd) => { try { execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; } };

if (process.platform === 'linux') {
  try {
    const id = execFileSync('wmctrl', ['-l']).toString().split('\n').find((l) => / (\(\d+\) )?Switchboard$/.test(l))?.split(' ')[0];
    if (id) { execFileSync('wmctrl', ['-i', '-a', id]); process.exit(0); }
  } catch {}
  // Chrome first: it has talk-to-type built in, Brave switches that off.
  const b = ['google-chrome', 'google-chrome-stable', 'microsoft-edge', 'chromium', 'chromium-browser', 'brave-browser'].find(has);
  b ? go(b, [`--app=${URL}`]) : go('xdg-open', [URL]);
} else if (process.platform === 'darwin') {
  // Once installed from the browser ("Install app"), Switchboard is a real app with its own Dock icon.
  const home = process.env.HOME;
  const pwa = ['Chrome Apps.localized', 'Brave Browser Apps.localized', 'Edge Apps.localized', 'Chromium Apps.localized']
    .map((d) => join(home, 'Applications', d, 'Switchboard.app')).find(existsSync);
  if (pwa) { go('open', [pwa]); process.exit(0); }
  const app = ['Google Chrome', 'Brave Browser', 'Microsoft Edge', 'Chromium'].find((a) => existsSync(`/Applications/${a}.app`));
  app ? go('open', ['-na', app, '--args', `--app=${URL}`]) : go('open', [URL]);
} else if (process.platform === 'win32') {
  const roots = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
  const exe = roots.flatMap((r) => [join(r, 'Microsoft/Edge/Application/msedge.exe'), join(r, 'Google/Chrome/Application/chrome.exe'), join(r, 'BraveSoftware/Brave-Browser/Application/brave.exe')]).find(existsSync);
  exe ? go(exe, [`--app=${URL}`]) : go('cmd.exe', ['/c', 'start', '', URL]);
}
