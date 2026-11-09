// The two things every route needs: send a response, read a JSON body. And
// the browser rules the page runs under.
const PORT = Number(process.env.SWITCHBOARD_PORT || 4747);

// The page may run only Switchboard's own scripts (and the talk-to-type worklet),
// load only its own styles and fonts (they ship in public/, nothing from Google),
// talk only to this server, and never be framed by another site. If some text
// ever slipped through unescaped, the browser still would not run it.
const CSP = [
  "default-src 'self'", "script-src 'self' blob:", "style-src 'self' 'unsafe-inline'",
  "font-src 'self'", "img-src 'self' data: blob: https:", `connect-src 'self' ws://127.0.0.1:${PORT} ws://localhost:${PORT}`,
  "media-src 'self' blob:", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"
].join('; ');
export function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(type.startsWith('text/html') ? { 'Content-Security-Policy': CSP, 'Referrer-Policy': 'no-referrer' } : {}) });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

// Read once: a route that looks at the body and passes (lib/routes/chat.js) leaves it here for the next.
export async function readJson(req, limit = 2e6) {
  if (req.sbJson !== undefined) return req.sbJson;
  let data = '';
  for await (const chunk of req) { data += chunk; if (data.length > limit) break; }
  try { req.sbJson = JSON.parse(data || '{}'); } catch { req.sbJson = {}; }
  return req.sbJson;
}

// A file from someone's mail, for the page: a plain picture shows as a picture;
// everything else (SVG and HTML included) only ever downloads, never runs as a page.
// f: { buf, type, name, picture }.
// RFC 8187 (filename*): encodeURIComponent leaves ' ( ) * as they are, which that format does not allow.
const rfc8187 = (s) => encodeURIComponent(s).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
export function sendFile(res, f, download = false) {
  const show = !download && f.picture;
  const name = String(f.name || 'file').replace(/[^\w .()+-]/g, '_').slice(0, 150) || 'file';
  res.writeHead(200, {
    'Content-Type': show ? f.type : 'application/octet-stream', 'Content-Length': f.buf.length,
    'Content-Disposition': `${show ? 'inline' : 'attachment'}; filename="${name}"; filename*=UTF-8''${rfc8187(String(f.name || name))}`,
    'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'"
  });
  res.end(f.buf);
}
