// Flips (lib/flips.js, lib/ebay.js, lib/fliplog.js; the pages are public/js/flips.js
// and public/js/fliplog.js, Money, Flips and Flip log).
import { send, readJson } from '../http.js';
import { flips, saveWatch, pollGsa, pollEbay, pollAuctions, check } from '../flips.js';
import { fliplog, saveEntry, removeEntry } from '../fliplog.js';

export async function route({ req, res, path, changed }) {
  if (!path.startsWith('/api/flips')) return;
  if (req.method === 'GET' && path === '/api/flips') return send(res, 200, flips());
  if (req.method === 'GET' && path === '/api/flips/log') return send(res, 200, fliplog());
  if (req.method !== 'POST') return;
  if (path === '/api/flips/watch') {
    const body = await readJson(req);
    saveWatch(body);
    await Promise.all([pollGsa(), pollEbay()]);
    changed?.();
    return send(res, 200, flips());
  }
  if (path === '/api/flips/check') {
    await Promise.all([pollGsa(), pollEbay(), pollAuctions()]);
    changed?.();
    return send(res, 200, flips());
  }
  if (path === '/api/flips/price') {
    const r = await check(await readJson(req));
    return send(res, r.error ? 400 : 200, r);
  }
  if (path === '/api/flips/log') {
    try { const r = saveEntry(await readJson(req)); changed?.(); return send(res, 200, r); }
    catch (e) { return send(res, e.status || 400, { error: e.message }); }
  }
  if (path === '/api/flips/log/remove') {
    const { id } = await readJson(req);
    const r = removeEntry(String(id || '')); changed?.();
    return send(res, 200, r);
  }
}
