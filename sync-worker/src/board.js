// The web board (docs/WEB-BOARD.md): this service serves the Switchboard page
// itself, the same public/ files as the app (Workers static assets, binding
// ASSETS in wrangler.toml), when BOARD_URL is set. Every answer gets a strict
// content policy (only this origin's scripts, no inline script, no framing);
// index.html gets an integrity hash on each of its scripts and stylesheets
// (board-manifest.js, made by scripts/board-manifest.mjs before a deploy), and
// loses the terminal's files, which are not on the web.
import manifest from './board-manifest.js';

export const boardOn = (env) => !!(env.ASSETS && env.BOARD_URL);

const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self'",
  // Microsoft 365 and GitHub are called from the browser, with the person's own tokens (public/js/web/connect.js).
  "connect-src 'self' https://login.microsoftonline.com https://graph.microsoft.com https://api.github.com", "frame-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'", "worker-src 'self'"
].join('; ');
const SAFE = { 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cross-Origin-Opener-Policy': 'same-origin', 'Permissions-Policy': 'camera=(), geolocation=(), microphone=(self)' };

// index.html as the board serves it: integrity on what it loads, no terminal files.
export function boardHtml(html, files = manifest) {
  return html
    .replace(/<head>/, '<head>\n<meta name="switchboard-board" content="1">')
    .replace(/\s*<link rel="stylesheet" href="\/vendor\/[^"]+">/g, '')
    .replace(/\s*<script src="\/vendor\/[^"]+"><\/script>/g, '')
    .replace(/<(script|link)([^>]*?)\s(src|href)="(\/[^"]+)"([^>]*)>/g, (m, tag, a, attr, path, b) => {
      const h = files[path];
      return h && !/integrity=/.test(m) ? `<${tag}${a} ${attr}="${path}" integrity="${h}"${b}>` : m;
    });
}

export async function serveBoard(req, env, url) {
  const path = url.pathname === '/' ? '/index.html' : url.pathname;
  // The app's own server routes are not here: the page's web adapter answers them in the browser.
  if (path.startsWith('/api/') || path.startsWith('/vendor/') || path === '/sw.js') return new Response('Not on the web board.', { status: 404, headers: SAFE });
  const res = await env.ASSETS.fetch(new Request(new URL(path, url), { method: req.method }));
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(SAFE)) headers.set(k, v);
  if (path === '/index.html' && res.ok) {
    headers.set('Cache-Control', 'no-cache');
    headers.set('Content-Type', 'text/html; charset=utf-8');
    return new Response(boardHtml(await res.text()), { status: 200, headers });
  }
  if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'no-cache');
  return new Response(res.body, { status: res.status, headers });
}
