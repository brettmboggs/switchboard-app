// Connections: weather, calendars, email accounts (with provider detection) and Microsoft 365.
// Called by server.js for every request after its host and header checks;
// sends a response when the path is one of these, otherwise does nothing.
import { db, clear } from '../db.js';
import { accounts, saveAccounts, pollGmail, testAccount } from '../gmail.js';
import { detect as detectMail } from '../mailservers.js';
import { place as weatherPlace, savePlace as saveWeatherPlace, geocode, weather, pollWeather } from '../weather.js';
import { calendars, saveCalendars, pollCalendars, fetchCalendar, feedUrl } from '../calendar.js';
import { caldavFor, discover, allowedUrl } from '../caldav.js';
import { pollLocalAI, localAI, STARTERS } from '../localai.js';
import { loadedModels, unloadModels } from '../lmloaded.js';
import { PRODUCT } from '../product.js';
import { link } from '../terminals.js';
import { microsoft, startSignIn, disconnect } from '../microsoft.js';
import { send, readJson } from '../http.js';
import { friendlyError } from '../friendly.js';

export async function route({ req, res, path, url, changed }) {
    // Weather: find a place, set it (with units), or clear it.
    if (req.method === 'POST' && path === '/api/weather/find') {
      const b = await readJson(req);
      try { return send(res, 200, { places: await geocode(b.q, b.home) }); } catch { return send(res, 400, { error: 'Could not look that up. Check the internet connection.' }); }
    }
    if (req.method === 'POST' && path === '/api/weather') {
      const b = await readJson(req);
      if (b.clear) saveWeatherPlace(null);
      else if (b.place) {
        const p = b.place;
        if (!(Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180)) return send(res, 400, { error: 'Pick a place from the list.' });
        saveWeatherPlace({ name: String(p.name || '').slice(0, 120), lat: +p.lat, lon: +p.lon, country: String(p.country || ''), tz: String(p.tz || ''), units: p.units || (['US', 'LR', 'MM'].includes(p.country) ? 'f' : 'c') });
      } else if (b.units && weatherPlace()) saveWeatherPlace({ ...weatherPlace(), units: b.units === 'c' ? 'c' : 'f' });
      await pollWeather(); changed();
      return send(res, 200, { ok: true });
    }

    // Calendars: add by private link (checked before saving), rename, project, remove.
    // Local AI models: look again now (after installing Ollama or pulling a model).
    if (req.method === 'POST' && path === '/api/localai/refresh') {
      if (await pollLocalAI()) changed();
      return send(res, 200, { ...localAI(), starters: STARTERS, loaded: await loadedModels() });
    }
    // What LM Studio has loaded now, and Unload on a click (lib/lmloaded.js): one model, or all.
    if (req.method === 'POST' && path === '/api/localai/loaded') return send(res, 200, { loaded: await loadedModels() });
    if (req.method === 'POST' && path === '/api/localai/unload') {
      const b = await readJson(req);
      const r = await unloadModels(b.all ? { all: true } : { id: String(b.id || '') });
      return send(res, r.ok ? 200 : 400, r);
    }

    // Calendars from an email account (iCloud, Fastmail, Yahoo): find them, then add the ones picked.
    if (req.method === 'POST' && (path === '/api/calendars/account/find' || path === '/api/calendars/account/add')) {
      const b = await readJson(req, 64 * 1024);
      const acct = accounts().find((a) => a.email === b.account);
      const p = acct && caldavFor(acct);
      if (!p) return send(res, 400, { error: 'That email account does not serve calendars.' });
      const have = calendars();
      if (path.endsWith('/find')) {
        try {
          const found = await discover(p, acct.user || acct.email, String(acct.password || '').trim());
          return send(res, 200, { provider: p.name, calendars: found.map((c) => ({ ...c, added: have.some((h) => h.href === c.href) })) });
        } catch (err) { return send(res, 400, { error: friendlyError(err, 'the calendar') }); }
      }
      const picked = (Array.isArray(b.calendars) ? b.calendars : []).slice(0, 30)
        .map((c) => ({ href: allowedUrl(String(c.href || ''), p.url, p.domain)?.href, name: String(c.name || 'Calendar').slice(0, 80), color: /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : null }))
        .filter((c) => c.href && !have.some((h) => h.href === c.href));
      if (!picked.length) return send(res, 400, { error: 'Pick a calendar to add.' });
      const space = String(b.space || 'personal');
      saveCalendars([...have, ...picked.map((c) => ({ id: Math.random().toString(36).slice(2, 10), name: c.name, kind: 'caldav', account: acct.email, href: c.href, space, ...(c.color ? { color: c.color } : {}) }))]);
      await pollCalendars(); changed();
      return send(res, 200, { ok: true, added: picked.length });
    }

    if (req.method === 'POST' && path === '/api/calendars') {
      const b = await readJson(req);
      const list = calendars();
      if (b.remove) { saveCalendars(list.filter((c) => c.id !== b.remove)); await pollCalendars(); changed(); return send(res, 200, { ok: true }); }
      if (b.id && list.some((c) => c.id === b.id)) {
        saveCalendars(list.map((c) => c.id === b.id ? { ...c, ...(b.name ? { name: String(b.name).slice(0, 80) } : {}), ...(b.space ? { space: String(b.space) } : {}) } : c));
        await pollCalendars(); changed(); return send(res, 200, { ok: true });
      }
      const url = feedUrl(b.url);
      if (!/^https:\/\//i.test(url)) return send(res, 400, { error: 'Paste the calendar\'s private link (it starts with https:// or webcal://).' });
      if (list.some((c) => feedUrl(c.url) === url)) return send(res, 400, { error: 'That calendar is already here.' });
      let found;
      try { found = await fetchCalendar(url); } catch (err) { return send(res, 400, { error: friendlyError(err, 'the calendar') }); }
      const entry = { id: Math.random().toString(36).slice(2, 10), name: String(b.name || found.name || 'Calendar').slice(0, 80), url, space: String(b.space || 'personal') };
      saveCalendars([...list, entry]);
      await pollCalendars(); changed();
      return send(res, 200, { ok: true, name: entry.name });
    }

    // Which provider an address is with, so the form asks only for what it needs.
    if (req.method === 'POST' && path === '/api/mail/detect') {
      const b = await readJson(req);
      return send(res, 200, await detectMail(String(b.email || '')));
    }

    if (req.method === 'POST' && path === '/api/gmail') {
      const b = await readJson(req);
      const list = accounts();
      if (b.remove) {
        saveAccounts(list.filter((a) => a.email !== b.remove));
        db.prepare('DELETE FROM mail WHERE account = ?').run(b.remove);
        changed();
        return send(res, 200, { ok: true });
      }
      const email = (b.email || '').trim().toLowerCase();
      if (!email) return send(res, 400, { error: 'Enter the email address.' });
      const existing = list.find((a) => a.email === email);
      const password = String(b.password || '').trim() || existing?.password;
      if (!password) return send(res, 400, { error: 'Paste the app password.' });
      // Servers: what the person typed (custom), else what detection finds.
      const found = b.imap?.host ? { kind: 'imap', name: b.name || email.split('@')[1], imap: b.imap, smtp: b.smtp, web: b.web } : await detectMail(email);
      if (found.error || found.unsupported) return send(res, 400, { error: found.error || found.unsupported });
      if (found.custom) return send(res, 400, { error: 'Fill in the server settings for this provider.' });
      const port = (n, d) => Math.min(65535, Math.max(1, Number(n) || d));
      const servers = found.kind === 'gmail' ? { kind: 'gmail' } : {
        kind: 'imap', name: found.name, web: found.web || null,
        imap: { host: String(found.imap.host).trim(), port: port(found.imap.port, 993) },
        smtp: { host: String(found.smtp.host).trim(), port: port(found.smtp.port, 465), secure: found.smtp.secure ?? Number(found.smtp.port) === 465 }
      };
      const entry = { ...(existing || {}), email, password, space: existing?.space || 'personal', ...servers, aliases: (b.aliases || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) };
      const t = await testAccount(entry);
      if (!t.ok) return send(res, 400, { error: t.error });
      saveAccounts([...list.filter((a) => a.email !== email), entry]);
      pollGmail().then(changed);
      return send(res, 200, { ok: true });
    }

    if (req.method === 'POST' && path === '/api/microsoft/start') {
      const b = await readJson(req);
      // No IDs given means the built-in Switchboard app: "Sign in with Microsoft" for any work account.
      const r = await startSignIn({ tenant: b.tenant || PRODUCT.microsoftTenant, clientId: b.clientId || PRODUCT.microsoftClientId, space: b.space }, changed);
      if (r.error) return send(res, 400, r);
      changed();
      return send(res, 200, r);
    }

    if (req.method === 'POST' && path === '/api/microsoft/disconnect') {
      disconnect();
      changed();
      return send(res, 200, { ok: true });
    }
}
