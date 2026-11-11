// A project's dashboard (lib/dashboard.js): its numbers, its setup, the website
// check, numbers of your own, and the report as a page, a PDF (kept in the
// project's Files) and a CSV.
// Called by server.js for every request after its host and header checks;
// sends a response when the path is one of these, otherwise does nothing.
import { dashboard, setConfig, runCheck, addNumber, addReading, forgetNumber, forgetReading, csv, validSpace } from '../dashboard.js';
import { reportHtml } from '../dashreport.js';
import { printPdf } from '../headless.js';
import { addFileBytes, listFiles } from '../projects.js';
import { getSetting, setSetting } from '../db.js';
import { spaces } from '../spaces.js';
import { friendlyError } from '../friendly.js';
import { send, readJson } from '../http.js';

const fail = (res, e) => send(res, e.status || 400, { error: e.status ? e.message : friendlyError(e, 'the dashboard') });
const lastError = new Map();   // project -> why its last website check failed, until the next one starts
const stamp = () => new Date().toISOString().slice(0, 10);

export async function route({ req, res, path, url, changed, PORT }) {
  // The free Google PageSpeed key, for every dashboard: { key } (empty to remove).
  if (path === '/api/dashboard/pagespeed-key') {
    if (req.method === 'GET') return send(res, 200, { saved: !!getSetting('pagespeed', {})?.key });
    if (req.method !== 'POST') return;
    const b = await readJson(req);
    const key = String(b.key || '').trim();
    if (key && !/^[A-Za-z0-9_-]{30,60}$/.test(key)) return send(res, 400, { error: 'That does not look like a Google API key (it starts with AIza and is about 39 characters). Copy it again from Google Cloud, APIs and services, Credentials.' });
    setSetting('pagespeed', key ? { key } : {});
    return send(res, 200, { saved: !!key });
  }
  const m = path.match(/^\/api\/projects\/([a-z0-9-]{1,60})\/dashboard(?:\/(config|check|number|reading|number-forget|reading-forget|report|pdf|csv))?$/);
  if (!m) return;
  const [, id, part] = m;
  if (!validSpace(id)) return send(res, 404, { error: 'That project is gone. Reload the page.' });
  try {
    if (req.method === 'GET') {
      if (!part) return send(res, 200, { ...dashboard(id), error: lastError.get(id) || null, pagespeedKey: !!getSetting('pagespeed', {})?.key });
      if (part === 'report') return send(res, 200, reportHtml(id), 'text/html; charset=utf-8');
      if (part === 'csv') {
        const name = `${spaces().find((s) => s.id === id)?.id || 'project'}-numbers-${stamp()}.csv`;
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        return res.end(csv(id));
      }
      return;
    }
    if (req.method !== 'POST') return;
    const b = await readJson(req);
    if (part === 'config') { const c = setConfig(id, b); changed(); return send(res, 200, { config: c }); }
    if (part === 'check') {
      // Runs in the background (a minute or two); the board's live updates carry its progress.
      runCheck(id, { onChange: changed }).then(changed).catch((e) => { console.warn('[dashboard] check', e.message); lastError.set(id, e.status ? e.message : friendlyError(e, 'the website')); changed(); });
      lastError.delete(id);
      return send(res, 200, { started: true });
    }
    if (part === 'number') { const r = addNumber(id, b); changed(); return send(res, 200, r); }
    if (part === 'reading') { const r = addReading(id, b); changed(); return send(res, 200, r); }
    if (part === 'number-forget') { const r = forgetNumber(id, b.metric); changed(); return send(res, 200, r); }
    if (part === 'reading-forget') { const r = forgetReading(id, b.metric, b.at); changed(); return send(res, 200, r); }
    if (part === 'pdf') {
      // The report page printed by a headless browser, kept in the project's Files.
      const pdf = await printPdf(`http://127.0.0.1:${PORT}/api/projects/${encodeURIComponent(id)}/dashboard/report`);
      const name = addFileBytes(id, pdf, `Report ${stamp()}.pdf`);
      changed();
      return send(res, 200, { name, files: listFiles(id) });
    }
  } catch (e) { return fail(res, e); }
}
