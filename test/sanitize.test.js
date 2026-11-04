// The notebook's sanitiser (public/js/sanitize.js) needs a real DOM, so it
// runs in a headless Chrome through the Playwright that `npm run setup`'s
// browser step (or the Playwright CLI) leaves on the machine. Where neither
// is there (CI, a fresh laptop) the test skips and says so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const CHROME = ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => existsSync(p));
function findPlaywright() {
  const places = [
    'playwright-core', 'playwright',
    join(homedir(), '.nvm/versions/node/v22.23.3/lib/node_modules/@playwright/cli/node_modules/playwright-core'),
    ...(process.env.NVM_DIR ? [join(process.env.NVM_DIR, 'versions/node', process.version, 'lib/node_modules/@playwright/cli/node_modules/playwright-core')] : [])
  ];
  for (const p of places) { try { return require(p); } catch {} }
  return null;
}

const SANITIZE = new URL('../public/js/sanitize.js', import.meta.url);
const CASES = [
  // [name, input, must contain (regexps), must not contain (regexps)]
  ['a script tag is dropped, its text too', '<p>hi</p><script>alert(1)</script><p>there</p>', [/^<p>hi<\/p><p>there<\/p>$/], [/alert/]],
  ['handlers are dropped', '<p onclick="steal()" onmouseover="x()">click</p><b onclick="y()">b</b>', [/^<p>click<\/p><b>b<\/b>$/], [/onclick|onmouseover|steal/]],
  ['a link is unwrapped, javascript: and all', '<p><a href="javascript:alert(1)">go</a> on</p>', [/^<p>go on<\/p>$/], [/href|javascript:/]],
  ['an image with an error handler is dropped', '<p>a<img src=x onerror="alert(1)">b</p>', [/^<p>ab<\/p>$/], [/img|onerror/]],
  ['svg and anything in it is dropped', '<p>x</p><svg><script>alert(1)</script><circle/></svg>', [/^<p>x<\/p>$/], [/svg|script|circle/]],
  ['an iframe with srcdoc is dropped', '<iframe srcdoc="<script>alert(1)</script>"></iframe><p>ok</p>', [/^<p>ok<\/p>$/], [/iframe|srcdoc/]],
  ['nested lists keep their shape', '<ul><li>one<ul><li>two</li></ul></li><li>three</li></ul>', [/^<ul><li>one<ul><li>two<\/li><\/ul><\/li><li>three<\/li><\/ul>$/], []],
  ['unknown tags are unwrapped, text kept', '<article><section><p>kept <mark>words</mark> <code>here</code></p></section></article><table><tr><td>cell</td></tr></table>', [/^<p>kept words here<\/p>cell$/], [/article|section|mark|code|table|td/]],
  ['allowed classes kept, unknown dropped', '<ul class="checklist"><li data-checked="true">a</li></ul><ul class="log"><li data-at="1762300000000">b</li></ul><ul class="fancy"><li class="x">c</li></ul><span class="fs-l">big</span><span class="huge">no</span>', [/<ul class="checklist"><li data-checked="true">a<\/li><\/ul>/, /<ul class="log"><li data-at="1762300000000">b<\/li><\/ul>/, /<ul><li>c<\/li><\/ul>/, /<span class="fs-l">big<\/span>no/], [/fancy|class="x"|huge/]],
  ['data-checked is normalised, a checklist item always has one', '<ul class="checklist"><li>plain</li><li data-checked="yes">odd</li><li data-checked="true">done</li></ul><ul><li data-checked="true">not a checklist</li></ul>', [/^<ul class="checklist"><li data-checked="false">plain<\/li><li data-checked="false">odd<\/li><li data-checked="true">done<\/li><\/ul><ul><li data-checked="true">not a checklist<\/li><\/ul>$/], [/yes/]],
  ['style is never kept; bold and italic are read off it', '<p style="color:red;font-weight:bold">b</p><span style="font-style:italic;background:url(x)">i</span><span style="font-weight:700">bb</span><p style="font-size:30px">p</p>', [/^<p><b>b<\/b><\/p><i>i<\/i><b>bb<\/b><p>p<\/p>$/], [/style|color|url/]],
  ['a paragraph inside a paragraph: the browser splits them, both survive as lines', '<p>outer<p>inner</p></p>', [/<p>outer<\/p><p>inner<\/p>/], []],
  ['a data-dictating marker (voice.js) is unwrapped', '<p>said <span data-dictating="">these words</span></p>', [/^<p>said these words<\/p>$/], [/dictating|span/]]
];

test('sanitizeHtml in a headless browser: scripts, handlers and links gone; lists, classes and marks kept', async (t) => {
  const pw = findPlaywright();
  if (!pw || !CHROME) { t.skip(`needs Playwright and Chrome (${!pw ? 'no playwright-core' : 'no Chrome at /usr/bin'})`); return; }
  const dir = mkdtempSync(join(tmpdir(), 'sb-sanitize-'));
  const html = join(dir, 'index.html');
  writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8"><script src="${SANITIZE.href}"></script></head><body></body></html>`);
  let browser;
  try { browser = await pw.chromium.launch({ executablePath: CHROME, headless: true }); }
  catch (e) { t.skip(`Chrome would not start: ${e.message.split('\n')[0]}`); return; }
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(pathToFileURL(html).href);
    assert.equal(await page.evaluate(() => typeof sanitizeHtml), 'function', 'sanitize.js loaded on its own');
    const out = await page.evaluate((cases) => cases.map(([name, input]) => [name, sanitizeHtml(input)]), CASES.map(([n, i]) => [n, i]));
    for (const [i, [name, result]] of out.entries()) {
      const [, , yes, no] = CASES[i];
      for (const re of yes) assert.match(result, re, `${name}: expected ${re} in ${result}`);
      for (const re of no) assert.doesNotMatch(result, re, `${name}: ${re} must not be in ${result}`);
      // Whatever went in, nothing that runs comes out.
      assert.doesNotMatch(result, /<script|\son\w+=|javascript:|<iframe|<img|style=/i, `${name}: ${result}`);
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
