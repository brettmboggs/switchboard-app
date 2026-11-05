// Opens a VISIBLE Chromium window at a sign-in address so a person can sign in
// themselves, then saves the browser's sign-in state (Playwright storageState) to
// one file. Started by lib/checkauth.js with the project's own folder as the
// working directory, so it uses that project's Playwright.
//
//   node scripts/signin.mjs <address> <file to write>
//
// "done" saves only while a window is back on the address's own site (the app you
// are testing, after the sign-in page has sent you back to it): signing in often
// happens on another site, and the app's tokens exist only once you are back.
// Until then it prints NOTYET and the window stays open.
//
// It never types into the page, never reads what is on it, and never prints
// anything but one of these words on its own line: READY, NOTYET, SAVED, CLOSED, CANCELLED,
// or ERROR followed by a short plain message. It reads one word from stdin: "done"
// (save and finish) or "cancel". If its parent goes away (stdin closes) it stops.
import { createRequire } from 'node:module';
import { writeFileSync, renameSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

process.umask(0o077);   // anything this creates is for its owner only
const [url, out] = process.argv.slice(2);
const say = (s) => process.stdout.write(s + '\n');
const fail = (m) => { say('ERROR ' + String(m).split('\n')[0].slice(0, 200)); process.exit(1); };
if (!url || !out) fail('Missing address or file.');

let chromium;
try {
  const req = createRequire(join(process.cwd(), 'package.json'));
  for (const name of ['@playwright/test', 'playwright', 'playwright-core']) { try { ({ chromium } = req(name)); if (chromium) break; } catch {} }
} catch {}
if (!chromium) fail('Playwright isn\'t installed in that folder. Run npm install there first.');

let browser;
try { browser = await chromium.launch({ headless: false }); }
catch (e) { fail(/Executable doesn't exist|install/i.test(e.message) ? 'This project\'s Chromium isn\'t installed. In the folder run: npx playwright install chromium' : e.message); }

// A fresh, empty browser profile: none of the person's own browser data is touched.
const context = await browser.newContext();
const page = await context.newPage();
let finishing = false;   // closing the window ourselves is not "the person closed it"
browser.on('disconnected', () => { if (!finishing) { say('CLOSED'); process.exit(3); } });
try { await page.goto(url, { timeout: 60000, waitUntil: 'domcontentloaded' }); } catch (e) { await browser.close().catch(() => {}); fail(e.message); }
say('READY');

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', async (d) => {
  buf += d;
  if (!buf.includes('\n')) return;
  const word = buf.trim();
  buf = '';
  if (word === 'done') {
    const sites = context.pages().map((p) => { try { return new URL(p.url()).origin; } catch { return ''; } });
    if (!sites.includes(new URL(url).origin)) { say('NOTYET'); return; }
    finishing = true;
    try {
      const state = await context.storageState();
      const tmp = out + '.tmp';
      writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
      chmodSync(tmp, 0o600);
      renameSync(tmp, out);
      chmodSync(out, 0o600);
      await browser.close().catch(() => {});
      say('SAVED');
      process.exit(0);
    } catch (e) { await browser.close().catch(() => {}); fail(e.message); }
  } else {
    finishing = true;
    await browser.close().catch(() => {});
    say('CANCELLED');
    process.exit(0);
  }
});
process.stdin.on('end', async () => {
  finishing = true; await browser.close().catch(() => {}); process.exit(0); });
