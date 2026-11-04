#!/usr/bin/env node
// npm run publish: stage the private repo's master for the public repo.
//
// Development happens in the private repo (its history holds personal data and
// never goes public). The public repo, brettmboggs/switchboard-app, is the
// product: main, tags, Releases, the updater endpoint. This script is the only
// road between them, and it refuses to carry anything personal.
//
//   node scripts/publish.mjs             dry run: export, gate, test, show what would change
//   node scripts/publish.mjs --stage     also copy the result into the public working tree
//   node scripts/publish.mjs --commit    stage and commit there as the noreply author
//   node scripts/publish.mjs --push      commit and push main
//   --tag                                after the commit: the annotated tag v<version> in the public
//                                        repo, and its stable branch moved to it (both pushed with --push)
//   --version <x.y.z|patch|minor|major>  bump package.json, desktop/package.json and
//                                        desktop/src-tauri/tauri.conf.json together in the private
//                                        tree, then stop: commit the bump, then publish
//   --dry-gate-only                      export and the personal-data gate only: no install, no
//                                        tests, and a dirty tree is allowed (it gates the working tree)
//   --message "..."                      the commit message (default: "Switchboard <version>")
//   --help
//
// A release, start to end:  --version patch, commit, then --push --tag, then publish
// the draft that .github/workflows/desktop.yml builds from the tag.
//
// SWITCHBOARD_PUBLIC points at the public checkout (default ~/dev/switchboard-app).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, mkdtempSync, mkdirSync, cpSync, copyFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir, homedir } from 'node:os';

const PRIVATE = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = process.env.SWITCHBOARD_PUBLIC || join(homedir(), 'dev', 'switchboard-app');
const AUTHOR_NAME = 'Brett Boggs', AUTHOR_EMAIL = '225786072+brettmboggs@users.noreply.github.com';
const BRANCH = 'main', STABLE = 'stable';
// Private notes that never ship.
const EXCLUDE = ['docs/HANDOFF.md', 'docs/REVIEW.md'];
// Files the gate does not read: binary or generated, and the two that hold the
// gate's own patterns (this script and ci.yml would match themselves).
const SKIP = /(package-lock\.json|Cargo\.lock|\.(png|ico|icns|woff2?)$|^scripts\/publish\.mjs$|^\.github\/workflows\/ci\.yml$)/;
// The same patterns as .github/workflows/ci.yml, "Nothing personal in the tree".
const FORBIDDEN = [/\/home\/brett/i, /\bblake\b/i, /\bdatum(ci)?\b/i, /brettmboggs@gmail/i, /\(\d{3}\) (?!555)\d{3}-\d{4}/, /\b63\d{3}\b/];
// "Brett" is fine where he is named as the author; anywhere else it is a leak
// of a one-person tool into a product.
const AUTHOR_OK = new Set(['README.md', 'LICENSE', 'AGENTS.md', 'CONTRIBUTING.md', 'desktop/src-tauri/Cargo.toml', 'desktop/src-tauri/tauri.conf.json', 'lib/product.js', 'docs/DECISIONS.md', 'docs/ROADMAP.md', 'desktop/README.md', '.github/workflows/desktop.yml']);
// The three files that carry the version, bumped together by --version.
const VERSION_FILES = ['package.json', 'desktop/package.json', 'desktop/src-tauri/tauri.conf.json'];

const args = process.argv.slice(2);
const want = (f) => args.includes(f);
const after = (f) => args.includes(f) ? args[args.indexOf(f) + 1] : null;
const push = want('--push'), tag = want('--tag'), commit = push || tag || want('--commit'), stage = commit || want('--stage');
const gateOnly = want('--dry-gate-only');
const message = after('--message');
const sh = (cmd, a, opts = {}) => execFileSync(cmd, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opts });
const say = (s) => console.log(s);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

if (want('--help') || want('-h')) {
  say(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1).filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n').split('\nimport ')[0].trim());
  process.exit(0);
}

// 0. --version: bump the three version files in the private tree and stop.
if (want('--version')) {
  const ask = after('--version');
  const current = JSON.parse(readFileSync(join(PRIVATE, 'package.json'), 'utf8')).version;
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
  if (!m) { console.error(`package.json says version "${current}", which is not x.y.z; fix it by hand first.`); process.exit(1); }
  const [maj, min, pat] = m.slice(1).map(Number);
  const next = ask === 'patch' ? `${maj}.${min}.${pat + 1}` : ask === 'minor' ? `${maj}.${min + 1}.0` : ask === 'major' ? `${maj + 1}.0.0` : ask;
  if (!/^\d+\.\d+\.\d+$/.test(next || '')) { console.error('--version takes x.y.z, patch, minor or major.'); process.exit(1); }
  for (const f of VERSION_FILES) {
    const was = JSON.parse(readFileSync(join(PRIVATE, f), 'utf8')).version;
    if (was !== current) say(`Note: ${f} said ${was}, not ${current}; all three now say ${next}.`);
  }
  // package-lock.json records the root version twice; keep it in step so npm does not rewrite it later.
  for (const f of [...VERSION_FILES, 'package-lock.json', 'desktop/package-lock.json']) {
    const path = join(PRIVATE, f);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf8'), json = JSON.parse(text);
    json.version = next;
    if (json.packages?.['']) json.packages[''].version = next;
    writeFileSync(path, JSON.stringify(json, null, 2) + (text.endsWith('\n') ? '\n' : ''));
  }
  say(`Version ${current} -> ${next} in ${VERSION_FILES.join(', ')} (and the lockfiles).`);
  say(`Now commit it, for example:  git commit -am "Switchboard ${next}"\nthen publish:  node scripts/publish.mjs --push --tag`);
  process.exit(0);
}

const privateDirty = sh('git', ['status', '--porcelain'], { cwd: PRIVATE }).trim();
if (!gateOnly) {
  if (!existsSync(join(PUBLIC, '.git'))) { console.error(`No public checkout at ${PUBLIC} (set SWITCHBOARD_PUBLIC).`); process.exit(1); }
  if (privateDirty) { console.error('The private tree has uncommitted changes. Commit them first: what ships is master.'); process.exit(1); }
  if (sh('git', ['status', '--porcelain'], { cwd: PUBLIC }).trim()) { console.error(`The public tree at ${PUBLIC} has uncommitted changes. Clean it up first.`); process.exit(1); }
}

// 1. Export master into a scratch folder (--dry-gate-only on a dirty tree: the
// working tree as it stands, tracked and new files, since that is the next master).
const out = mkdtempSync(join(tmpdir(), 'switchboard-publish-'));
let files;
if (gateOnly && privateDirty) {
  files = sh('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: PRIVATE }).split('\n').filter((f) => f && existsSync(join(PRIVATE, f)));
  for (const f of files) { mkdirSync(dirname(join(out, f)), { recursive: true }); copyFileSync(join(PRIVATE, f), join(out, f)); }
  say(`Exported the working tree (uncommitted changes included) to ${out}`);
} else {
  execFileSync('sh', ['-c', `git -C "${PRIVATE}" archive master | tar -x -C "${out}"`], { stdio: 'inherit' });
  files = sh('git', ['ls-tree', '-r', '--name-only', 'master'], { cwd: PRIVATE }).split('\n').filter(Boolean);
  say(`Exported master (${sh('git', ['rev-parse', '--short', 'master'], { cwd: PRIVATE }).trim()}) to ${out}`);
}
for (const p of EXCLUDE) rmSync(join(out, p), { force: true });
files = files.filter((f) => !EXCLUDE.includes(f) && !SKIP.test(f));
const version = JSON.parse(readFileSync(join(out, 'package.json'), 'utf8')).version;
say(`Version ${version}`);

// 2. The gate: nothing personal.
const bad = [];
for (const f of files) {
  const text = readFileSync(join(out, f), 'utf8');
  for (const re of FORBIDDEN) if (re.test(text)) bad.push(`${f}: matches ${re}`);
  if (!AUTHOR_OK.has(f) && /\bbrett\b/i.test(text)) bad.push(`${f}: says "Brett" (only the files in AUTHOR_OK may)`);
}
if (bad.length) { console.error('Refusing to publish. Personal data in the export:\n  ' + bad.join('\n  ')); process.exit(1); }
say(`Gate: nothing personal in the export (${files.length} files read).`);
if (gateOnly) { rmSync(out, { recursive: true, force: true }); say('Gate only; nothing installed, tested, staged or pushed.'); process.exit(0); }

// 3. The tests, in the export itself.
say('Installing and testing the export (this takes a minute)...');
execFileSync(npm, ['ci', '--no-audit', '--no-fund'], { cwd: out, stdio: 'inherit' });
execFileSync(npm, ['test'], { cwd: out, stdio: 'inherit' });
rmSync(join(out, 'node_modules'), { recursive: true, force: true });

// 4. What would change in the public tree.
let diff = '';
try { diff = sh('diff', ['-rq', '-x', '.git', '-x', 'node_modules', '-x', '.claude', '-x', '.wrangler', PUBLIC, out]); } catch (e) { diff = e.stdout || ''; }
const lines = diff.trim().split('\n').filter(Boolean);
say(lines.length ? `Changes for the public repo (${lines.length}):\n  ` + lines.map((l) => l.replace(out, '<export>').replace(PUBLIC, '<public>')).join('\n  ') : 'The public repo already matches master.');
if (!stage) { say('\nDry run. Add --stage to copy this into the public tree, --commit to commit it, --push to push, --tag to tag the release.'); process.exit(0); }

// 5. Replace the public working tree (keeping its .git), then commit and push on request.
for (const e of readdirSync(PUBLIC)) if (e !== '.git') rmSync(join(PUBLIC, e), { recursive: true, force: true });
for (const e of readdirSync(out)) cpSync(join(out, e), join(PUBLIC, e), { recursive: true });
sh('git', ['add', '-A'], { cwd: PUBLIC });
say(`Staged in ${PUBLIC}.`);
if (!commit) { say('Review with: git -C ' + PUBLIC + ' diff --cached --stat'); process.exit(0); }
const msg = message || `Switchboard ${version}`;
let staged = true;
try { sh('git', ['diff', '--cached', '--quiet'], { cwd: PUBLIC }); staged = false; } catch {}
if (staged) {
  sh('git', ['-c', `user.name=${AUTHOR_NAME}`, '-c', `user.email=${AUTHOR_EMAIL}`, 'commit', '-q', '--author', `${AUTHOR_NAME} <${AUTHOR_EMAIL}>`, '-m', msg], { cwd: PUBLIC });
  say(`Committed as ${AUTHOR_EMAIL}: ${msg}`);
} else say('Nothing new to commit: the public repo already has this.');
if (push) { execFileSync('git', ['push', 'origin', `HEAD:${BRANCH}`], { cwd: PUBLIC, stdio: 'inherit' }); say(`Pushed ${BRANCH}.`); }

// 6. --tag: v<version> on what was just committed, and stable moved to it. The tag
// is what builds the desktop installers (desktop.yml); stable is what git installs
// on the Stable channel pull.
if (tag) {
  const tagName = `v${version}`, head = sh('git', ['rev-parse', 'HEAD'], { cwd: PUBLIC }).trim();
  let existing = null;
  try { existing = sh('git', ['rev-list', '-n', '1', tagName], { cwd: PUBLIC, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
  if (existing && existing !== head) { console.error(`${tagName} already exists on another commit (${existing.slice(0, 7)}). Bump the version (--version) instead of moving a tag.`); process.exit(1); }
  if (!existing) sh('git', ['-c', `user.name=${AUTHOR_NAME}`, '-c', `user.email=${AUTHOR_EMAIL}`, 'tag', '-a', tagName, '-m', `Switchboard ${version}`, head], { cwd: PUBLIC });
  sh('git', ['branch', '-f', STABLE, tagName], { cwd: PUBLIC });
  say(`${existing ? 'Kept' : 'Tagged'} ${tagName} and moved ${STABLE} to it.`);
  if (push) { execFileSync('git', ['push', 'origin', `refs/tags/${tagName}`, `refs/heads/${STABLE}:refs/heads/${STABLE}`], { cwd: PUBLIC, stdio: 'inherit' }); say(`Pushed ${tagName} and ${STABLE}. The desktop build starts from the tag; publish its draft release when it is done.`); }
  else say(`Not pushed (add --push): git -C ${PUBLIC} push origin ${tagName} ${STABLE}`);
}
