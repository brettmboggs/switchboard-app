// Network test (lib/speedtest.js; the page is public/js/speedtest.js). The page
// starts a test, then asks for its progress a few times a second until it ends.
import { send, readJson } from '../http.js';
import { startTest, stopTest, testState, testHistory, forgetTest } from '../speedtest.js';

export async function route({ req, res, path, url }) {
  if (!path.startsWith('/api/speedtest')) return;
  if (req.method === 'GET' && path === '/api/speedtest') {
    return send(res, 200, { test: testState(), ...(url.searchParams.has('history') ? { history: testHistory() } : {}) });
  }
  if (req.method !== 'POST') return;
  if (path === '/api/speedtest') {
    const r = startTest();
    return send(res, r.error ? 409 : 200, r);
  }
  if (path === '/api/speedtest/stop') return send(res, 200, stopTest());
  if (path === '/api/speedtest/forget') {
    const body = await readJson(req);
    if (!Number.isFinite(Number(body.at))) return send(res, 400, { error: 'Switchboard did not get which test to remove. Reload and try again.' });
    return send(res, 200, forgetTest(body.at));
  }
}
