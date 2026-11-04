// Started by the Switchboard app (desktop/ in the repo), from inside the app's
// own files, where it is staged as bin/desktop.mjs. It does what `npm run setup`
// does for a git checkout, minus the login service and launcher (the app is
// both), then runs the server in this same process, so exit codes (75 and the
// rest) reach the app's supervisor unchanged.
import { execFileSync, execFile } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.SWITCHBOARD_DATA || join(homedir(), '.local/share/switchboard');

// 1. PATH. An app opened from the Dock, Finder or a desktop menu gets a short
// PATH (no Homebrew, nvm or ~/.local/bin), so tmux, git, gh and claude would
// not be found. Ask the login shell for the real one, once.
if (process.platform !== 'win32') {
  const parts = [];
  try {
    const out = execFileSync(process.env.SHELL || '/bin/sh', ['-ilc', 'printf "\\n__SB_PATH__%s" "$PATH"'],
      { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
    parts.push(...(out.split('__SB_PATH__').pop() || '').trim().split(':'));
  } catch {}
  parts.push(...(process.env.PATH || '').split(':'), '/opt/homebrew/bin', '/usr/local/bin', join(homedir(), '.local/bin'));
  process.env.PATH = [...new Set(parts.filter(Boolean))].join(':');
}

// 2. Claude Code hooks and the MCP server. The app's own folder can move (an
// AppImage mounts somewhere new each run), so the two small scripts that agents
// call are copied next to Switchboard's data, which never moves, and the hooks
// point there. scripts/setup.mjs does the writing, as it does for a checkout;
// it runs again only when this copy of the app is new.
try {
  const bin = join(DATA, 'bin');
  mkdirSync(bin, { recursive: true });
  for (const f of ['hook.sh', 'hook.cmd', 'mcp.mjs']) copyFileSync(join(ROOT, 'bin', f), join(bin, f));
  if (process.platform !== 'win32') chmodSync(join(bin, 'hook.sh'), 0o755);
  const marker = join(DATA, 'desktop-app.json');
  const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  const me = JSON.stringify({ node: process.execPath, root: ROOT, version });
  if (!existsSync(marker) || readFileSync(marker, 'utf8') !== me) {
    execFile(process.execPath, [join(ROOT, 'scripts', 'setup.mjs'), 'app'], { env: { ...process.env, SWITCHBOARD_BIN: bin }, windowsHide: true, timeout: 120000 },
      (err, out) => { console.log(out || ''); if (!err) writeFileSync(marker, me); else console.error('Setup for the app did not finish: ' + err.message); });
  }
} catch (e) { console.error('Could not set up the Claude hooks: ' + e.message); }

// 3. The server.
await import('../server.js');
