// Ping the phone through the sync service. Only the kind of event is sent
// ("waiting", "builds"), never what it was: the service holds fixed text for each
// kind, so nothing private reaches the service, Expo, Apple or Google. Alerts
// reach here already filtered by Settings and quiet hours (see notify.js).
import { getSetting } from './db.js';

// chat: a teammate wrote to you or @mentioned you (lib/chat.js); the phone shows "A teammate wrote to you."
// flips: a new deal in Flips (lib/flips.js); the phone shows "A new flip turned up."
export const PUSH_KINDS = new Set(['waiting', 'builds', 'chat', 'flips']);

export function pushPhone(kind) {
  if (!PUSH_KINDS.has(kind)) return;
  const s = getSetting('sync', null);
  if (!s?.token || !s.server) return;
  fetch(s.server.replace(/\/$/, '') + '/v1/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.token}` },
    body: JSON.stringify({ kind }),
    signal: AbortSignal.timeout(15000)
  }).catch(() => {});
}
