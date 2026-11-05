// Gets everything the app ships ready for `tauri build` (run by it as beforeBuildCommand):
//
//   src-tauri/binaries/switchboard-node-<target>[.exe]
//       the Node that runs the server. The same Node that runs this script when
//       the target is this machine (so its version is the one CI set up), or the
//       same version downloaded from nodejs.org for another arch (a Mac x64 build
//       on an arm64 runner). Named switchboard-node so the .deb never collides
//       with /usr/bin/node.
//   build/switchboard/
//       the app's own files (server.js, lib, public, bin, scripts) with their
//       production npm packages installed for this OS, sidecar/start.mjs as
//       bin/desktop.mjs, and LICENSE with THIRD-PARTY-NOTICES.txt. node-pty is
//       trimmed to the one platform being built.
//
// TAURI_ENV_TARGET_TRIPLE (set by the Tauri CLI) picks the target; without it, this machine.
import { execFileSync } from 'node:child_process';
import { cpSync, rmSync, mkdirSync, copyFileSync, chmodSync, existsSync, readdirSync, writeFileSync, openSync, readSync, closeSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DESKTOP = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(DESKTOP, '..');
const OUT = join(DESKTOP, 'build', 'switchboard');
const BINARIES = join(DESKTOP, 'src-tauri', 'binaries');

const hostTriple = () => execFileSync('rustc', ['-vV'], { encoding: 'utf8' }).match(/host: (\S+)/)[1];
const target = process.env.TAURI_ENV_TARGET_TRIPLE || hostTriple();
const os = target.includes('windows') ? 'win32' : target.includes('apple') ? 'darwin' : 'linux';
const arch = target.startsWith('aarch64') ? 'arm64' : 'x64';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
console.log(`Staging Switchboard for ${target} (Node ${process.version})`);

// ---- 1. Node
mkdirSync(BINARIES, { recursive: true });
const nodeOut = join(BINARIES, `switchboard-node-${target}${os === 'win32' ? '.exe' : ''}`);
if (os === process.platform && arch === process.arch) {
  copyFileSync(process.execPath, nodeOut);
} else {
  if (os !== 'darwin') throw new Error(`Cross-building Node for ${target} is only set up for macOS.`);
  const name = `node-${process.version}-darwin-${arch}`;
  const tmp = join(DESKTOP, 'build', 'node-download');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const tgz = join(tmp, `${name}.tar.gz`);
  execFileSync('curl', ['-fsSL', '-o', tgz, `https://nodejs.org/dist/${process.version}/${name}.tar.gz`], { stdio: 'inherit' });
  execFileSync('tar', ['xzf', tgz, '-C', tmp, `${name}/bin/node`], { stdio: 'inherit' });
  copyFileSync(join(tmp, name, 'bin', 'node'), nodeOut);
  rmSync(tmp, { recursive: true, force: true });
}
if (os !== 'win32') chmodSync(nodeOut, 0o755);

// ---- 2. the app's files
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const f of ['server.js', 'package.json', 'package-lock.json', 'lib', 'public', 'bin', 'scripts']) cpSync(join(REPO, f), join(OUT, f), { recursive: true });
// The licences of everything bundled (npm run notices writes it; LICENSE is Switchboard's own).
for (const f of ['THIRD-PARTY-NOTICES.txt', 'LICENSE']) if (existsSync(join(REPO, f))) copyFileSync(join(REPO, f), join(OUT, f));
copyFileSync(join(DESKTOP, 'sidecar', 'start.mjs'), join(OUT, 'bin', 'desktop.mjs'));
execFileSync(npm, ['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: OUT, stdio: 'inherit', shell: process.platform === 'win32' });

// node-pty ships every platform's prebuilt addon and its C++ sources: keep only this one.
const pty = join(OUT, 'node_modules', 'node-pty');
for (const d of ['src', 'deps', 'third_party', 'scripts', 'node-addon-api']) rmSync(join(pty, d), { recursive: true, force: true });
const prebuilds = join(pty, 'prebuilds');
if (existsSync(prebuilds)) for (const d of readdirSync(prebuilds)) {
  if (d !== `${os}-${arch}`) rmSync(join(prebuilds, d), { recursive: true, force: true });
  else for (const f of readdirSync(join(prebuilds, d))) if (f.endsWith('.pdb')) rmSync(join(prebuilds, d, f));
}
const build = join(pty, 'build');
if (existsSync(build)) for (const d of readdirSync(build)) if (d !== 'Release') rmSync(join(build, d), { recursive: true, force: true });
const release = join(build, 'Release');
if (existsSync(release)) for (const f of readdirSync(release)) if (!/\.node$|^spawn-helper$/.test(f)) rmSync(join(release, f), { recursive: true, force: true });

// ---- 3. Mac: sign the native files inside the server (node-pty's addon and its
// spawn-helper). Tauri signs the app and Node, but not files among the resources,
// and Apple's notarization refuses an app with any unsigned Mach-O file in it.
// Runs only on a Mac build with APPLE_SIGNING_IDENTITY set (CI, with the
// certificate already in a keychain: see .github/workflows/desktop.yml).
const identity = process.env.APPLE_SIGNING_IDENTITY;
if (os === 'darwin' && process.platform === 'darwin' && identity && identity !== '-') {
  const MACHO = new Set(['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'bebafeca']);
  const isMachO = (f) => {
    const b = Buffer.alloc(4), fd = openSync(f, 'r');
    try { return readSync(fd, b, 0, 4, 0) === 4 && MACHO.has(b.toString('hex')); } finally { closeSync(fd); }
  };
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = join(d, e.name);
    return e.isDirectory() ? walk(p) : e.isFile() && isMachO(p) ? [p] : [];
  });
  const files = walk(OUT);
  for (const f of files) execFileSync('codesign', ['--force', '--options', 'runtime', '--timestamp', '--sign', identity, f], { stdio: 'inherit' });
  console.log(`Signed ${files.length} native file(s) in the server for notarization.`);
}

writeFileSync(join(OUT, 'STAGED'), `${target}\n`);
console.log(`Staged in ${OUT}`);
