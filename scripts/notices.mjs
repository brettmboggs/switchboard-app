#!/usr/bin/env node
// npm run notices: writes THIRD-PARTY-NOTICES.txt at the repo root, the licences
// of everything Switchboard ships that is not its own. One block per production
// npm package (name, version, licence, and its LICENSE file when it has one),
// then the pieces outside npm: the Node.js the desktop app bundles, Tauri, and
// the fonts once they ship. desktop/scripts/stage.mjs copies the file into the
// app's resources. Generated, but committed, so the public repo carries it.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'THIRD-PARTY-NOTICES.txt');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// ---- the production tree. `npm ls` knows which packages ship (installs use
// --omit=dev); it exits non-zero for a tree with any complaint but still prints.
function productionPackages() {
  let tree = null;
  try { tree = JSON.parse(execFileSync(npm, ['ls', '--omit=dev', '--all', '--json', '--long'], { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32' })); }
  catch (e) { try { tree = JSON.parse(e.stdout || ''); } catch { tree = null; } }
  const found = new Map();
  const walk = (deps) => {
    for (const [name, d] of Object.entries(deps || {})) {
      if (!d || d.missing || d.extraneous) continue;
      const path = d.path || findPackage(name);
      if (path && !found.has(path)) found.set(path, name);
      walk(d.dependencies);
    }
  };
  if (tree) walk(tree.dependencies);
  // No npm, or a tree it could not read: every package under node_modules instead.
  if (!found.size) for (const path of walkModules(join(ROOT, 'node_modules'))) found.set(path, null);
  return [...found.keys()];
}
function findPackage(name) { const p = join(ROOT, 'node_modules', ...name.split('/')); return existsSync(join(p, 'package.json')) ? p : null; }
function* walkModules(dir) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.name.startsWith('@')) { yield* walkModules(p); continue; }
    if (existsSync(join(p, 'package.json'))) { yield p; yield* walkModules(join(p, 'node_modules')); }
  }
}

const licenseOf = (pkg) => {
  const l = pkg.license || (Array.isArray(pkg.licenses) ? pkg.licenses.map((x) => x.type || x).join(' OR ') : pkg.licenses);
  return typeof l === 'object' && l ? l.type || JSON.stringify(l) : l || 'not stated in package.json';
};
const licenseText = (dir) => {
  const f = readdirSync(dir).find((n) => /^(licen[cs]e|copying)(\.|-|$)/i.test(n));
  return f ? readFileSync(join(dir, f), 'utf8').replace(/\r\n/g, '\n').trim() : null;
};

const blocks = [];
for (const dir of productionPackages()) {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  if (pkg.name === 'switchboard') continue;
  const text = licenseText(dir);
  blocks.push({
    key: `${pkg.name}@${pkg.version}`, name: pkg.name,
    body: [`${pkg.name} ${pkg.version}`, `Licence: ${licenseOf(pkg)}`, pkg.homepage ? `Home: ${pkg.homepage}` : null, `Path: ${relative(ROOT, dir)}`, '', text || `(no licence file in the package; see its package.json "license" field above)`].filter((l) => l !== null).join('\n')
  });
}
blocks.sort((a, b) => a.key.localeCompare(b.key));
const seen = new Set();
const npmBlocks = blocks.filter((b) => !seen.has(b.key) && seen.add(b.key));

const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const rule = '='.repeat(72);
// The typefaces in public/fonts, each OFL-1.1 (public/fonts/LICENSES.md).
const FONTS = `The page's typefaces ship in public/fonts (Latin subsets, variable
weight 400 to 700; see public/fonts/LICENSES.md) and are served by the local
server. Nothing is fetched from Google Fonts or any other font service.

Fraunces (fraunces-normal.woff2, fraunces-italic.woff2)
  Copyright 2018 The Fraunces Project Authors (https://github.com/undercasetype/Fraunces)
  SIL Open Font License 1.1

Public Sans (publicsans-normal.woff2, publicsans-italic.woff2)
  Copyright 2015 The Public Sans Project Authors (https://github.com/uswds/public-sans)
  SIL Open Font License 1.1

Space Grotesk (spacegrotesk-normal.woff2)
  Copyright 2020 The Space Grotesk Project Authors (https://github.com/floriankarsten/space-grotesk)
  SIL Open Font License 1.1

JetBrains Mono (jetbrainsmono-normal.woff2)
  Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono)
  SIL Open Font License 1.1

Each is licensed under the same text, reproduced once:

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
https://openfontlicense.org

-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.`;
const section = (title, body) => `${rule}\n${title}\n${rule}\n\n${body.trim()}\n`;
const out = [
  `Third-party notices for Switchboard ${version}`,
  '',
  'Switchboard itself is Fair Source under the Functional Source License,',
  'FSL-1.1-MIT (see LICENSE). It is built on the work below, each piece under',
  'its own licence, reproduced here as those licences ask. Regenerate this file',
  'with `npm run notices` after changing a dependency.',
  '',
  `${npmBlocks.length} npm packages ship with it (production dependencies and theirs).`,
  '',
  ...npmBlocks.map((b) => section(b.key, b.body)),
  section('Node.js', `The desktop app bundles a Node.js runtime (Node 22; the copy that built the
app, which is the Node version its CI set up. This file was generated with
Node ${process.version}). A git install uses the Node already on the computer.

Node.js is under the MIT licence, and its binary includes components under
their own licences (OpenSSL, ICU, V8, libuv, zlib, c-ares, nghttp2, npm and
others), all listed in the LICENSE file of every Node.js release:
https://github.com/nodejs/node/blob/main/LICENSE

Copyright Node.js contributors. All rights reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to
deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
IN THE SOFTWARE.`),
  section('Tauri', `The desktop app's shell (desktop/src-tauri) is built with Tauri 2 and its
plugins (single-instance, window-state, updater, dialog, opener, autostart), by the
Tauri Programme within The Commons Conservancy, under your choice of the MIT
licence or the Apache License 2.0:
https://github.com/tauri-apps/tauri/blob/dev/LICENSE_MIT
https://github.com/tauri-apps/tauri/blob/dev/LICENSE_APACHE-2.0
The Rust crates it pulls in are listed with their licences in
desktop/src-tauri/Cargo.lock; each is under its own licence (MIT and/or
Apache-2.0 for nearly all of them).

Copyright 2019-2024 Tauri Programme within The Commons Conservancy

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`),
  section('Fonts', FONTS)
].join('\n');
writeFileSync(OUT, out);
console.log(`Wrote ${relative(ROOT, OUT)}: ${npmBlocks.length} npm packages, Node.js, Tauri, fonts.`);
