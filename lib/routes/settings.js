// Settings as a whole: read them, and save projects, rules, notifications, signatures and preferences.
// Called by server.js for every request after its host and header checks;
// sends a response when the path is one of these, otherwise does nothing.
import { caldavFor } from '../caldav.js';
import { localAI, STARTERS } from '../localai.js';
import { getSetting, setSetting } from '../db.js';
import { spaces, rules, parseSpaces, parseRules, saveSpaces, saveRules, cleanSpaces } from '../spaces.js';
import { accounts, sendAddresses } from '../gmail.js';
import { weather } from '../weather.js';
import { calendars } from '../calendar.js';
import { googleStatus } from './google.js';
import { notifySettings } from '../notify.js';
import { installedAgents } from '../terminals.js';
import { microsoft, msConfig } from '../microsoft.js';
import { hooksForPage } from '../webhooks.js';
import { send, readJson } from '../http.js';

// A save from a page that loaded `was`: only its own changes are applied to the list as it is now, so
// anything added elsewhere meanwhile (the Add picker, ×, joining a shared project, another window) stays.
// Without `was` (an older page), the list is taken whole, as before.
const ruleKey = ([t, s]) => String(t).toLowerCase() + '\n' + s;
function mergeRules(next, was) {
  if (!Array.isArray(was)) return next;
  // The page's list, in its order (the first rule that matches wins), with the rules added elsewhere
  // meanwhile put back at the places they have now.
  const before = new Set(was.filter(Array.isArray).map(ruleKey)), after = new Set(next.map(ruleKey));
  const out = [...next];
  rules().forEach((r, i) => { if (!before.has(ruleKey(r)) && !after.has(ruleKey(r))) out.splice(Math.min(i, out.length), 0, r); });
  return out;
}
// A change to the rules as made on the page (review M7, re-review): these taken away, these added at the
// end (in place of the same rule anywhere else), and every other rule as it is now, wherever it came from.
const cleanRules = (l) => (Array.isArray(l) ? l : []).filter((r) => Array.isArray(r) && r[0] && r[1]).map(([a, s]) => [String(a).trim(), String(s)]).filter(([a]) => a);
function changeRules(add, remove) {
  const plus = cleanRules(add), gone = new Set([...cleanRules(remove), ...plus].map(ruleKey));
  return [...rules().filter((r) => !gone.has(ruleKey(r))), ...plus];
}
function mergeSpaces(next, was) {
  if (!Array.isArray(was)) return next;
  const before = new Set(was.map(String)), ids = new Set(next.map((s) => s?.id).filter(Boolean));
  return [...next, ...spaces().filter((s) => !before.has(s.id) && !ids.has(s.id))];
}

export async function route({ req, res, path, url, changed, PREFS }) {
    if (req.method === 'GET' && path === '/api/settings') {
      return send(res, 200, {
        // What the page started from, so a save changes only what it changed (review M7).
        spaces: spaces(), rules: rules(), spacesWas: spaces().map((s) => s.id), rulesWas: rules(),
        gmail: accounts().map((a) => ({ email: a.email, space: a.space, aliases: a.aliases || [], hasPassword: !!a.password, kind: a.kind || 'gmail', name: a.name || (a.kind === 'imap' ? 'Email' : 'Gmail'), calendars: caldavFor(a)?.name || null })),
        notify: notifySettings(),
        prefs: { ...PREFS, ...getSetting('prefs', {}) },
        agents: installedAgents(),
        signatures: getSetting('signatures', {}),
        calendars: calendars().map((c) => ({ id: c.id, name: c.name, space: c.space, ...(c.kind ? { kind: c.kind } : {}), ...(c.account ? { account: c.account } : {}) })),
        google: googleStatus(),
        localAI: { ...localAI(), starters: STARTERS },
        webhooks: hooksForPage(),
        sendAs: sendAddresses(),
        microsoft: (() => { const c = msConfig(); return c ? { tenant: c.tenant, clientId: c.clientId, space: c.space, connected: !!c.refreshToken, email: c.account?.email || null } : null; })()
      });
    }

    if (req.method === 'POST' && path === '/api/settings') {
      const b = await readJson(req);
      if (typeof b.spacesText === 'string') { const list = parseSpaces(b.spacesText); if (list.length) saveSpaces(list); }
      if (typeof b.rulesText === 'string') saveRules(parseRules(b.rulesText));
      const made = {};   // a new project's temporary id on the page -> the id it got (re-review L2)
      if (Array.isArray(b.spaces)) { const list = cleanSpaces(mergeSpaces(b.spaces, b.spacesWas), made); if (list.length) saveSpaces(list); }
      if (Array.isArray(b.rulesAdd) || Array.isArray(b.rulesRemove)) saveRules(changeRules(b.rulesAdd, b.rulesRemove));
      if (Array.isArray(b.rules)) saveRules(mergeRules(b.rules.filter((r) => Array.isArray(r) && r[0] && r[1]).map(([a, s]) => [String(a).trim(), String(s)]), b.rulesWas));
      if (b.prefs && typeof b.prefs === 'object') setSetting('prefs', Object.fromEntries(Object.entries({ ...PREFS, ...getSetting('prefs', {}), ...b.prefs }).filter(([k]) => k in PREFS)));
      if (b.signatures && typeof b.signatures === 'object') setSetting('signatures', Object.fromEntries(Object.entries(b.signatures).map(([k, v]) => [k.toLowerCase(), String(v || '')])));
      if (b.notify) {
        const n = { ...notifySettings(), ...b.notify };
        const time = (t, d) => /^\d{2}:\d{2}$/.test(t) ? t : d;
        setSetting('notify', { waiting: !!n.waiting, builds: !!n.builds, finished: !!n.finished, reminders: !!n.reminders, events: !!n.events, weather: !!n.weather, email: !!n.email, teams: !!n.teams, deliveries: n.deliveries !== false,
          quiet: { on: !!n.quiet?.on, from: time(n.quiet?.from, '22:00'), to: time(n.quiet?.to, '07:00') } });
      }
      changed();
      return send(res, 200, { ok: true, spaces: spaces(), rules: rules(), spacesWas: spaces().map((s) => s.id), rulesWas: rules(), made });
    }
}
