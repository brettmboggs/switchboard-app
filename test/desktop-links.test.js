// The desktop app's link rules (desktop/src-tauri/src/links.rs): only this
// computer's Switchboard on its own port is the app's page, and only web,
// mail and phone links are handed to the system (review L3, L4). The file
// has no dependencies, so rustc tests it alone; without rustc this is skipped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

const rustc = [join(homedir(), '.cargo/bin/rustc'), '/usr/bin/rustc', '/usr/local/bin/rustc'].find(existsSync);

test('the desktop app opens only its own page inside, and only web, mail and phone links outside (review L3, L4)', { skip: !rustc && 'no rustc on this computer', timeout: 120000 }, () => {
  const out = join(mkdtempSync(join(tmpdir(), 'sb-links-')), 'links-test');
  execFileSync(rustc, ['--edition', '2021', '--test', new URL('../desktop/src-tauri/src/links.rs', import.meta.url).pathname, '-o', out], { stdio: 'pipe' });
  let report = '';
  try { report = execFileSync(out, { encoding: 'utf8', stdio: 'pipe' }); } catch (e) { report = String(e.stdout || '') + String(e.stderr || ''); }
  assert.match(report, /test result: ok/, report);
});
