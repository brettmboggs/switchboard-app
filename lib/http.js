// The two things every route needs: send a response, read a JSON body. And
// the browser rules the page runs under.
const PORT = Number(process.env.SWITCHBOARD_PORT || 4747);

// The page may run only Switchboard's own scripts (and the talk-to-type worklet),
// talk only to this server, and never be framed by another site. If some text
// ever slipped through unescaped, the browser still would not run it.
const CSP = [
  "default-src 'self'", "script-src 'self' blob:", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data: blob: https:", `connect-src 'self' ws://127.0.0.1:${PORT} ws://localhost:${PORT}`,
  "media-src 'self' blob:", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"
].join('; ');
export function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(type.startsWith('text/html') ? { 'Content-Security-Policy': CSP, 'Referrer-Policy': 'no-referrer' } : {}) });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

export async function readJson(req, limit = 2e6) {
  let data = '';
  for await (const chunk of req) { data += chunk; if (data.length > limit) break; }
  try { return JSON.parse(data || '{}'); } catch { return {}; }
}
