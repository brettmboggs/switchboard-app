// Granola (lib/granola.js): sign in, or connect with an API key; read now; disconnect.
// Called by server.js for every request after its host and header checks;
// sends a response when the path is one of these, otherwise does nothing.
import { connectGranola, disconnectGranola, pollGranola } from '../granola.js';
import { startGranolaSignIn, finishGranolaSignIn } from '../granolamcp.js';
import { friendlyError } from '../friendly.js';
import { send, readJson } from '../http.js';

const page = (title, body) => `<!doctype html><meta charset="utf-8"><title>${title}</title><meta name="viewport" content="width=device-width"><body style="font:16px system-ui;margin:12vh auto;max-width:30rem;padding:0 1rem"><h1 style="font-size:1.4rem">${title}</h1><p>${body}</p>`;
const safe = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export async function route({ req, res, path, url, changed, PORT }) {
  // Sign in with Granola (lib/granolamcp.js): Granola sends the browser back here.
  if (req.method === 'GET' && path === '/oauth/granola') {
    const r = await finishGranolaSignIn(Object.fromEntries(url.searchParams));
    if (r.ok) { changed(); pollGranola().then((c) => c && changed()).catch(() => {}); }
    return send(res, r.ok ? 200 : 400, r.ok
      ? page('Signed in to Granola', `Switchboard can now read the meeting notes of ${safe(r.email || 'your Granola account')}. You can close this tab and go back to Switchboard.`)
      : page('Granola sign-in did not finish', safe(r.error)), 'text/html; charset=utf-8');
  }
  if (req.method === 'POST' && path === '/api/granola/signin') {
    try { return send(res, 200, await startGranolaSignIn(PORT)); }
    catch (e) { return send(res, 400, { error: friendlyError(e, 'Granola') }); }
  }
  const m = path.match(/^\/api\/granola\/(connect|disconnect|sync)$/);
  if (!m || req.method !== 'POST') return;
  try {
    const b = await readJson(req, 8 * 1024);
    if (m[1] === 'connect') await connectGranola(b.key);
    if (m[1] === 'disconnect') disconnectGranola();
    changed();
    // Connect and Read now: the first read runs on, and the card follows it.
    if (m[1] === 'connect' || m[1] === 'sync') pollGranola().then((c) => c && changed()).catch(() => {});
    return send(res, 200, { ok: true });
  } catch (e) { return send(res, 400, { error: friendlyError(e, 'Granola') }); }
}
