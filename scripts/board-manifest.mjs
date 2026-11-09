// The web board's integrity hashes (sync-worker/src/board.js): the sha384 of
// every script and stylesheet in public/, written to
// sync-worker/src/board-manifest.js. wrangler.toml runs this before every
// deploy, so the hashes always match what is uploaded; the file is not kept
// in git.
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(root, 'public');
const out = {};
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!/\.(js|css)$/.test(name)) continue;
    out['/' + relative(pub, p).split(sep).join('/')] = 'sha384-' + createHash('sha384').update(readFileSync(p)).digest('base64');
  }
})(pub);
const file = join(root, 'sync-worker', 'src', 'board-manifest.js');
writeFileSync(file, `// Made by scripts/board-manifest.mjs: do not edit, not kept in git.\nexport default ${JSON.stringify(out, null, 1)};\n`);
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(`${Object.keys(out).length} files hashed into ${relative(root, file)}.`);
