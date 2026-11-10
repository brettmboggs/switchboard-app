// AI plans page (public/js/usagepage.js): one plan's history, habits and big
// sessions (lib/usagehist.js). Read only. The current windows and their
// forecasts come with the board itself (state.usage).
import { send } from '../http.js';
import { usageHistory } from '../usagehist.js';

export async function route({ req, res, path, url }) {
  if (req.method !== 'GET' || path !== '/api/usage') return;
  return send(res, 200, usageHistory(url.searchParams.get('provider') || null, Date.now(), { win: url.searchParams.get('win'), at: url.searchParams.get('at') }));
}
