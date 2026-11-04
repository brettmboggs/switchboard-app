// Settings as a whole: read them, and save projects, rules, notifications, signatures and preferences.
// Called by server.js for every request after its host and header checks;
// sends a response when the path is one of these, otherwise does nothing.
import { getSetting, setSetting } from '../db.js';
import { spaces, rules, parseSpaces, parseRules, saveSpaces, saveRules, cleanSpaces } from '../spaces.js';
import { accounts, sendAddresses } from '../gmail.js';
import { weather } from '../weather.js';
import { calendars } from '../calendar.js';
import { notifySettings } from '../notify.js';
import { installedAgents } from '../terminals.js';
import { microsoft, msConfig } from '../microsoft.js';
import { hooksForPage } from '../webhooks.js';
import { send, readJson } from '../http.js';

export async function route({ req, res, path, url, changed, PREFS }) {
    if (req.method === 'GET' && path === '/api/settings') {
      return send(res, 200, {
        spaces: spaces(), rules: rules(),
        gmail: accounts().map((a) => ({ email: a.email, space: a.space, aliases: a.aliases || [], hasPassword: !!a.password, kind: a.kind || 'gmail', name: a.name || (a.kind === 'imap' ? 'Email' : 'Gmail') })),
        notify: notifySettings(),
        prefs: { ...PREFS, ...getSetting('prefs', {}) },
        agents: installedAgents(),
        signatures: getSetting('signatures', {}),
        calendars: calendars().map((c) => ({ id: c.id, name: c.name, space: c.space })),
        webhooks: hooksForPage(),
        sendAs: sendAddresses(),
        microsoft: (() => { const c = msConfig(); return c ? { tenant: c.tenant, clientId: c.clientId, space: c.space, connected: !!c.refreshToken, email: c.account?.email || null } : null; })()
      });
    }

    if (req.method === 'POST' && path === '/api/settings') {
      const b = await readJson(req);
      if (typeof b.spacesText === 'string') { const list = parseSpaces(b.spacesText); if (list.length) saveSpaces(list); }
      if (typeof b.rulesText === 'string') saveRules(parseRules(b.rulesText));
      if (Array.isArray(b.spaces)) { const list = cleanSpaces(b.spaces); if (list.length) saveSpaces(list); }
      if (Array.isArray(b.rules)) saveRules(b.rules.filter((r) => Array.isArray(r) && r[0] && r[1]).map(([a, s]) => [String(a).trim(), String(s)]));
      if (b.prefs && typeof b.prefs === 'object') setSetting('prefs', Object.fromEntries(Object.entries({ ...PREFS, ...getSetting('prefs', {}), ...b.prefs }).filter(([k]) => k in PREFS)));
      if (b.signatures && typeof b.signatures === 'object') setSetting('signatures', Object.fromEntries(Object.entries(b.signatures).map(([k, v]) => [k.toLowerCase(), String(v || '')])));
      if (b.notify) {
        const n = { ...notifySettings(), ...b.notify };
        const time = (t, d) => /^\d{2}:\d{2}$/.test(t) ? t : d;
        setSetting('notify', { waiting: !!n.waiting, finished: !!n.finished, reminders: !!n.reminders, events: !!n.events, weather: !!n.weather, email: !!n.email, teams: !!n.teams, deliveries: n.deliveries !== false,
          quiet: { on: !!n.quiet?.on, from: time(n.quiet?.from, '22:00'), to: time(n.quiet?.to, '07:00') } });
      }
      changed();
      return send(res, 200, { ok: true });
    }
}
