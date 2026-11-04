// Desktop alerts, filtered by Settings: each kind can be switched off, and quiet
// hours hold every alert back. The OS call itself lives in desktop.js.
import { getSetting } from './db.js';
import { notify as show } from './desktop.js';

export const NOTIFY_DEFAULTS = { waiting: true, finished: true, reminders: true, events: true, weather: true, email: true, teams: true, deliveries: true, quiet: { on: false, from: '22:00', to: '07:00' } };

export function notifySettings() {
  const n = getSetting('notify', {});
  return { ...NOTIFY_DEFAULTS, ...n, quiet: { ...NOTIFY_DEFAULTS.quiet, ...(n.quiet || {}) } };
}

const mins = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return (h || 0) * 60 + (m || 0); };
function quietNow(q) {
  if (!q.on) return false;
  const d = new Date(), now = d.getHours() * 60 + d.getMinutes(), a = mins(q.from), b = mins(q.to);
  return a <= b ? now >= a && now < b : now >= a || now < b;
}

// kind: waiting | finished | reminders | events | weather | email | teams | deliveries
export function alert(kind, title, body) {
  const n = notifySettings();
  if (n[kind] === false || quietNow(n.quiet)) return;
  show(title, body);
}
