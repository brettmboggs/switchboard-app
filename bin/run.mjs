// Keeps Switchboard running where no service manager does (Windows, or running
// by hand): starts server.js, and starts it again whenever it exits. Exit code
// 75 means "updated, restart me" and comes back at once; a crash waits a few
// seconds so a broken start does not spin. 76 means "removed" (Settings, Remove
// Switchboard): stay stopped.
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
function start() {
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', join(ROOT, 'server.js')], { cwd: ROOT, stdio: 'inherit', windowsHide: true });
  const began = Date.now();
  child.on('exit', (code) => {
    if (code === 75) { fails = 0; return start(); }
    if (code === 76) process.exit(0);
    fails = Date.now() - began > 60000 ? 0 : fails + 1;
    setTimeout(start, Math.min(30000, 2000 * fails));
  });
}
start();
