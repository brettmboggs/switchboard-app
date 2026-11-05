#!/usr/bin/env node
// npm run pitch: write docs/PITCH.md and the pitch at the top of README.md
// from docs/headlines.json (what makes Switchboard worth trying) and the setup
// registry, public/setup.js (every feature and connection it has).
//
//   node scripts/pitch.mjs           write both
//   node scripts/pitch.mjs --check   change nothing; exit 1 if either is out of date
//
// Edit docs/headlines.json, never PITCH.md or the README block by hand: the
// test (test/pitch.test.js) fails when they drift apart. Features added to the
// registry after headlines.json's "reviewed" date are listed in PITCH.md under
// "New since the headlines were reviewed" until someone looks and moves the date.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = new URL('..', import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), 'utf8');
export const START = '<!-- pitch:start (made by npm run pitch from docs/headlines.json; edit that) -->';
export const END = '<!-- pitch:end -->';

export function load() {
  const win = {};
  vm.runInNewContext(read('public/setup.js'), { window: win });
  return { H: JSON.parse(read('docs/headlines.json')), SETUP: win.SETUP };
}

const byId = (SETUP) => new Map(SETUP.map((e) => [e.id, e]));

export function pitchPage({ H, SETUP }) {
  const ids = byId(SETUP);
  const out = ['# Switchboard, in short', '',
    '<!-- Made by npm run pitch from docs/headlines.json and public/setup.js. Edit those, not this file. -->', '',
    `**${H.oneLine}**`, '', H.pitch, '', '## What makes it different', ''];
  H.headlines.forEach((h, i) => {
    out.push(`### ${i + 1}. ${h.title}`, '', h.cool, '');
    if (h.show?.length) out.push('Show it (about 20 seconds):', '', ...h.show.map((s, n) => `${n + 1}. ${s}`), '');
    const names = (h.ids || []).map((id) => ids.get(id)?.title).filter(Boolean);
    if (names.length) out.push(`In the app: ${names.join(', ')}.`, '');
  });
  const fresh = SETUP.filter((e) => e.added > H.reviewed);
  if (fresh.length) {
    out.push('## New since the headlines were reviewed', '',
      `Added after ${H.reviewed}. Does one belong above? Then move "reviewed" in docs/headlines.json to today.`, '',
      ...fresh.map((e) => `- **${e.title}** (${e.added}): ${e.why}`), '');
  }
  const section = (kind, title) => {
    out.push(`## ${title}`, '');
    for (const e of SETUP.filter((x) => x.kind === kind)) out.push(`- **${e.title}**: ${e.why}`);
    out.push('');
  };
  out.push('Everything else Switchboard does is below, straight from the list the welcome screen is built from, so it is never out of date.', '');
  section('connect', 'What it connects to');
  section('feature', 'Everything it does');
  return out.join('\n');
}

export function readmeBlock({ H }) {
  return [START, '', `**${H.oneLine}**`, '', H.pitch, '', '**What makes it different**', '',
    ...H.headlines.map((h) => `- **${h.title}.** ${h.cool}`), '',
    'The short version, with every feature listed and a 20-second demo for each of these: [docs/PITCH.md](docs/PITCH.md).', '', END].join('\n');
}

export function readmeWith(readme, block) {
  const a = readme.indexOf(START.split(' (')[0]), b = readme.indexOf(END);
  if (a < 0 || b < a) throw new Error('README.md has no pitch block; put <!-- pitch:start --> and <!-- pitch:end --> lines where it goes.');
  return readme.slice(0, a) + block + readme.slice(b + END.length);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const data = load();
  const page = pitchPage(data);
  const readme = readmeWith(read('README.md'), readmeBlock(data));
  const stale = [['docs/PITCH.md', page], ['README.md', readme]].filter(([f, want]) => { try { return read(f) !== want; } catch { return true; } });
  if (process.argv.includes('--check')) {
    if (stale.length) { console.error(`Out of date: ${stale.map(([f]) => f).join(', ')}. Run npm run pitch.`); process.exit(1); }
    console.log('The pitch is up to date.');
  } else {
    for (const [f, want] of stale) writeFileSync(new URL(f, ROOT), want);
    console.log(stale.length ? `Wrote ${stale.map(([f]) => f).join(' and ')}.` : 'Nothing to change.');
  }
}
