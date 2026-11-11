// A headless Chromium for one job, driven over the DevTools protocol with Node's
// own WebSocket (no package): measuring a site's speed (lib/sitespeed.js) and
// printing a dashboard's report to PDF (lib/dashboard.js). It starts in a
// throwaway profile and is closed after the job. Sandboxed when the system
// allows it, else without (as Playwright runs it); it only opens the address
// it was given. The binary is lib/desktop.js's chromiumPath().
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { chromiumPath } from './desktop.js';

class Cdp {
  constructor(ws) { this.ws = ws; this.n = 0; this.waiting = new Map(); this.handlers = []; ws.onmessage = (ev) => this.got(JSON.parse(ev.data)); }
  got(m) {
    if (m.id && this.waiting.has(m.id)) { const w = this.waiting.get(m.id); this.waiting.delete(m.id); m.error ? w.no(new Error(m.error.message)) : w.yes(m.result); return; }
    for (const h of this.handlers) h(m);
  }
  send(method, params = {}, sessionId) {
    const id = ++this.n;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((yes, no) => { this.waiting.set(id, { yes, no }); setTimeout(() => { if (this.waiting.delete(id)) no(new Error(`The browser did not answer ${method}.`)); }, 30e3); });
  }
  on(fn) { this.handlers.push(fn); return () => { this.handlers = this.handlers.filter((h) => h !== fn); }; }
}

function launch(bin, sandbox) {
  const dir = mkdtempSync(join(tmpdir(), 'sb-speed-'));
  const args = ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-background-networking', '--disable-sync', '--disable-default-apps', '--mute-audio', '--hide-scrollbars', ...(sandbox ? [] : ['--no-sandbox']), 'about:blank'];
  const p = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  const done = () => { try { p.kill('SIGKILL'); } catch {} setTimeout(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} }, 500); };
  const ready = new Promise((yes, no) => {
    let err = '';
    const t = setTimeout(() => no(new Error('The browser did not start in time.')), 20e3);
    p.stderr.on('data', (d) => { err += d; const m = err.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(t); yes(m[1]); } });
    p.on('exit', () => { clearTimeout(t); no(new Error('The browser closed as it started' + (/sandbox/i.test(err) ? ' (sandbox)' : '') + '.')); });
    p.on('error', (e) => { clearTimeout(t); no(e); });
  });
  return { ready, done };
}

export async function openBrowser() {
  const bin = chromiumPath();
  if (!bin) throw Object.assign(new Error('No browser to measure with. Install the one browser checks use (Settings, Connections, Browser checks), or Chrome.'), { status: 400 });
  for (const sandbox of [true, false]) {
    const b = launch(bin, sandbox);
    try {
      const url = await b.ready;
      const ws = new WebSocket(url);
      await new Promise((yes, no) => { ws.onopen = yes; ws.onerror = () => no(new Error('Could not reach the browser.')); });
      return { cdp: new Cdp(ws), close: () => { try { ws.close(); } catch {} b.done(); } };
    } catch (e) { b.done(); if (!sandbox) throw e; }
  }
}


// A page printed to PDF, as Chrome's own Save as PDF would (Letter, the page's print styles).
export async function printPdf(url) {
  const b = await openBrowser();
  try {
    const { targetId } = await b.cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId: s } = await b.cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await b.cdp.send('Page.enable', {}, s);
    let loaded = false;
    const off = b.cdp.on((m) => { if (m.sessionId === s && m.method === 'Page.loadEventFired') loaded = true; });
    const nav = await b.cdp.send('Page.navigate', { url }, s);
    if (nav.errorText) throw new Error(`The report did not open (${nav.errorText}).`);
    for (let i = 0; i < 120 && !loaded; i++) await wait(250);
    off();
    await b.cdp.send('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => 1)', awaitPromise: true }, s).catch(() => {});
    const r = await b.cdp.send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true, paperWidth: 8.5, paperHeight: 11, marginTop: 0.5, marginBottom: 0.5, marginLeft: 0.5, marginRight: 0.5 }, s);
    return Buffer.from(r.data, 'base64');
  } finally { b.close(); }
}
