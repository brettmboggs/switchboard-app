// The Inbox's conversation view: the newest messages of one open conversation.
// Called by server.js for every request after its host and header checks;
// sends a response when the path is one of these, otherwise does nothing.
import { conversation } from '../conversation.js';
import { send } from '../http.js';

export async function route({ req, res, path, url }) {
  if (req.method !== 'GET' || path !== '/api/conversation') return;
  try {
    return send(res, 200, await conversation(url.searchParams.get('key') || '', url.searchParams.get('limit')));
  } catch (e) {
    return send(res, e.status || 502, { error: String(e?.message || e).slice(0, 200) });
  }
}
