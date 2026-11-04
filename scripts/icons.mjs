#!/usr/bin/env node
// The Switchboard mark and every icon and logo file cut from it.
//
//   node scripts/icons.mjs            writes public/icon.svg, the brand pack in
//                                     docs/brand, the PNG icons the manifest lists,
//                                     and a 1024 px PNG for Tauri
//   node scripts/icons.mjs --svg      writes only the SVGs (no browser needed)
//
// The PNGs are rendered by a headless Chrome through Playwright. The script
// looks for playwright-core in this order: $PLAYWRIGHT_CORE (a path to the
// package), a local `playwright-core`, then the copy inside the global
// @playwright/cli next to the running Node (the development machine). Chrome is
// $CHROME, else /usr/bin/google-chrome-stable, else Playwright's own.
//
// After it runs, make the desktop app's icons from the 1024 px PNG:
//   cd desktop && npx tauri icon ../<the printed path>   (see docs/DESIGN.md)
//
// The mark: three streams converge on one jack and leave as one. Three lines
// (the inputs, each ending in a dot) bend into a ring, the jack's socket, with
// the lamp inside it; one line leaves on the right. The lamp is the state light.
//
// Geometry (viewBox 0 0 48 48), kept the same in public/js/favicon.js and in
// the inline marks in public/index.html and public/js/now.js: rows at y 10, 24
// and 38, the ring at (28, 24) r 7.6, a 4 unit stroke, 3 unit input dots, the
// lamp r 3.3. A second, small cut (heavier lines, no input dots, a bigger lamp)
// is used from 16 to 32 px, where the full cut goes to mush.
//
// The wordmark is the word in Public Sans Bold (shipped, converted to outlines in
// scripts/wordmark.json so it needs no font), lowercase, with the mark's lamp on
// the word's x-height midline.

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const BRAND = join(ROOT, 'docs', 'brand');

export const COLOURS = { ink: '#15171C', paper: '#FCFCFA', counter: '#E4E7EB', needs: '#FF4F00', clear: '#1F7A4D', cobalt: '#4967E8', soft: '#8EA0FF' };

/**
 * The mark's shapes, no <svg> wrapper. `ink` draws the streams and the ring;
 * `dots` the three inputs; `lamp` the light (null = same as dots, the calm lamp).
 * `small` is the cut for 16 to 32 px.
 */
export function markShapes({ ink = COLOURS.ink, dots = COLOURS.cobalt, lamp = null, small = false, heavy = false } = {}) {
  // Three cuts of one drawing: full (the icon and the page), heavy (beside bold type), small (16 to 32 px).
  const cut = small ? { sw: 5, R: 8, bend: 11, ring: 4, lamp: 3.9, x0: 5.5, x1: 43.5, dot: 0 }
    : heavy ? { sw: 4.8, R: 8, bend: 11.5, ring: 4.2, lamp: 3.6, x0: 6, x1: 44, dot: 3.4 }
      : { sw: 4, R: 7.6, bend: 12, ring: 3.6, lamp: 3.3, x0: 6, x1: 44, dot: 3 };
  const { sw, R, bend, ring, x0, x1 } = cut, N = 28, end = N - R, c = (end - bend) / 2;
  const streams = `<path d="M${x0} 10H${bend}C${bend + c} 10 ${end - c} 24 ${end} 24"/><path d="M${x0} 38H${bend}C${bend + c} 38 ${end - c} 24 ${end} 24"/><path d="M${x0} 24H${end}"/><path d="M${N + R} 24H${x1}"/>`;
  return `<g fill="none" stroke="${ink}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${streams}</g>`
    + `<circle cx="${N}" cy="24" r="${R}" fill="none" stroke="${ink}" stroke-width="${ring}"/>`
    + (cut.dot ? [10, 24, 38].map((y) => `<circle cx="${x0}" cy="${y}" r="${cut.dot}" fill="${dots}"/>`).join('') : '')
    + `<circle cx="${N}" cy="24" r="${cut.lamp}" fill="${lamp || dots}"/>`;
}

/** The mark on its own, transparent background. */
export function markSvg(opts = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">${markShapes(opts)}</svg>\n`;
}

/**
 * The app icon: the calm mark in paper and soft cobalt on an ink tile. `rounded`
 * gives the dock tile its corners (rx 12 of 48); the maskable icon is full bleed
 * and lets the launcher cut the shape, with the mark inside the central 80%.
 */
export function iconSvg({ rounded = true, maskable = false } = {}) {
  const scale = maskable ? 0.6 : 0.74;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">`
    + `<title>Switchboard</title><rect width="48" height="48" rx="${rounded ? 12 : 0}" fill="${COLOURS.ink}"/>`
    + `<g transform="translate(24 24) scale(${scale}) translate(-24.5 -24)">${markShapes({ ink: COLOURS.paper, dots: COLOURS.soft })}</g>`
    + `</svg>\n`;
}

/** Symbol and word, one line. `onDark` swaps to paper and soft cobalt. */
export function wordmarkSvg({ onDark = false, mono = false } = {}) {
  const w = JSON.parse(readFileSync(join(ROOT, 'scripts', 'wordmark.json'), 'utf8'));
  const ink = onDark ? COLOURS.paper : COLOURS.ink, dots = mono ? ink : onDark ? COLOURS.soft : COLOURS.cobalt;
  const fs = 100, s = fs / w.upm, ascender = 1480 * s, xMid = (w.xHeight * s) / 2;
  const k = (ascender * 1.3) / 34;                       // the mark (34 units tall) stands 30% above the tallest letter
  const cy = 56, baseline = cy + xMid, left = 2;
  const symW = 43 * k, wordX = left + symW + 14;
  const width = Math.ceil(wordX + w.width * s + 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 112">`
    + `<title>Switchboard</title>`
    + `<g transform="translate(${(left - 3 * k).toFixed(2)} ${(cy - 24 * k).toFixed(2)}) scale(${k.toFixed(4)})">${markShapes({ ink, dots, heavy: true })}</g>`
    + `<path transform="translate(${wordX.toFixed(2)} ${baseline.toFixed(2)}) scale(${s})" fill="${ink}" d="${w.d}"/>`
    + `</svg>\n`;
}

/** The brand pack written to docs/brand: every file a person or a designer needs. */
export function brandFiles() {
  return {
    'switchboard-app-icon.svg': iconSvg(),
    'switchboard-mark.svg': markSvg(),
    'switchboard-mark-light.svg': markSvg({ ink: COLOURS.paper, dots: COLOURS.soft }),
    'switchboard-mark-monochrome.svg': markSvg({ dots: COLOURS.ink }),
    'switchboard-mark-small.svg': markSvg({ small: true }),
    'switchboard-wordmark.svg': wordmarkSvg(),
    'switchboard-wordmark-light.svg': wordmarkSvg({ onDark: true }),
    'switchboard-wordmark-monochrome.svg': wordmarkSvg({ mono: true })
  };
}

async function loadPlaywright() {
  const candidates = [];
  if (process.env.PLAYWRIGHT_CORE) candidates.push(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  candidates.push('playwright-core');
  candidates.push(pathToFileURL(join(dirname(process.execPath), '..', 'lib', 'node_modules', '@playwright', 'cli', 'node_modules', 'playwright-core', 'index.mjs')).href);
  for (const c of candidates) {
    try { return await import(c); } catch { /* next */ }
  }
  throw new Error('playwright-core not found: set PLAYWRIGHT_CORE to the package directory, or npm i -g @playwright/cli');
}

async function renderPngs() {
  const { chromium } = await loadPlaywright();
  const executablePath = process.env.CHROME || (existsSync('/usr/bin/google-chrome-stable') ? '/usr/bin/google-chrome-stable' : undefined);
  const browser = await chromium.launch(executablePath ? { executablePath } : { channel: 'chrome' }).catch(() => chromium.launch());
  const out = join(tmpdir(), 'switchboard-icons');
  mkdirSync(out, { recursive: true });
  const jobs = [
    [join(PUBLIC, 'icon-192.png'), 192, iconSvg()],
    [join(PUBLIC, 'icon-512.png'), 512, iconSvg()],
    [join(PUBLIC, 'icon-maskable.png'), 512, iconSvg({ rounded: false, maskable: true })],
    [join(out, 'icon-1024.png'), 1024, iconSvg()]
  ];
  for (const [path, size, svg] of jobs) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<!DOCTYPE html><html><head><style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style></head><body>${svg}</body></html>`);
    await page.screenshot({ path, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    await page.close();
    console.log('wrote', path);
  }
  await browser.close();
  console.log(`\nDesktop icons: cd desktop && npx tauri icon ${join(out, 'icon-1024.png')}`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  writeFileSync(join(PUBLIC, 'icon.svg'), iconSvg());
  console.log('wrote', join(PUBLIC, 'icon.svg'));
  mkdirSync(BRAND, { recursive: true });
  for (const [name, svg] of Object.entries(brandFiles())) { writeFileSync(join(BRAND, name), svg); console.log('wrote', join(BRAND, name)); }
  if (!process.argv.includes('--svg')) await renderPngs();
}
