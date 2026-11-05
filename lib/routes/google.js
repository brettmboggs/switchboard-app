// Google Calendar: the sign-in (GET /oauth/google is where Google sends the
// browser back), picking which of the account's calendars to show, and adding,
// changing and deleting events on them. Called by server.js for every request
// after its host and header checks; sends a response when the path is one of
// these, otherwise does nothing. Every change is a click on the page, never automatic.
import { startGoogleSignIn, finishGoogleSignIn, googleDisconnect, googleAccount, googleCalendars, createGoogleEvent, updateGoogleEvent, deleteGoogleEvent, clientConfig } from '../google.js';
import { calendars, saveCalendars, pollCalendars } from '../calendar.js';
import { forget } from '../calendarview.js';
import { friendlyError } from '../friendly.js';
import { send, readJson } from '../http.js';

const page = (title, body) => `<!doctype html><meta charset="utf-8"><title>${title}</title><meta name="viewport" content="width=device-width"><body style="font:16px system-ui;margin:12vh auto;max-width:30rem;padding:0 1rem"><h1 style="font-size:1.4rem">${title}</h1><p>${body}</p>`;
const safe = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export const googleStatus = () => ({ configured: !!clientConfig(), email: googleAccount()?.email || null, connected: !!googleAccount()?.refreshToken });

export async function route({ req, res, path, url, changed, PORT }) {
  if (req.method === 'GET' && path === '/oauth/google') {
    const r = await finishGoogleSignIn(Object.fromEntries(url.searchParams));
    if (r.ok) changed();
    return send(res, r.ok ? 200 : 400, r.ok
      ? page('Signed in to Google', `Switchboard can now read and change the calendars on ${safe(r.email || 'your Google account')}. You can close this tab and go back to Switchboard.`)
      : page('Google sign-in did not finish', safe(r.error)), 'text/html; charset=utf-8');
  }
  if (req.method !== 'POST' || !path.startsWith('/api/google')) {
    if (req.method === 'POST' && path.startsWith('/api/calendar/event')) return eventRoute({ req, res, path, changed });
    return;
  }
  const b = await readJson(req, 64 * 1024);
  if (path === '/api/google/start') { const r = startGoogleSignIn(PORT); return send(res, r.error ? 400 : 200, r); }
  if (path === '/api/google/disconnect') {
    googleDisconnect();
    saveCalendars(calendars().filter((c) => c.kind !== 'google'));
    forget(); await pollCalendars(); changed();
    return send(res, 200, { ok: true });
  }
  if (path === '/api/google/calendars') {
    try {
      const have = calendars();
      return send(res, 200, { email: googleAccount()?.email || '', calendars: (await googleCalendars()).map((c) => ({ ...c, added: have.some((h) => h.kind === 'google' && h.calendarId === c.calendarId) })) });
    } catch (e) { return send(res, 400, { error: friendlyError(e, 'Google'), signin: !!e.signin }); }
  }
  if (path === '/api/google/add') {
    let all;
    try { all = await googleCalendars(); } catch (e) { return send(res, 400, { error: friendlyError(e, 'Google'), signin: !!e.signin }); }
    const have = calendars(), ids = new Set((Array.isArray(b.calendarIds) ? b.calendarIds : []).map(String));
    const picked = all.filter((c) => ids.has(c.calendarId) && !have.some((h) => h.kind === 'google' && h.calendarId === c.calendarId));
    if (!picked.length) return send(res, 400, { error: 'Pick a calendar to add.' });
    const space = String(b.space || 'personal');
    saveCalendars([...have, ...picked.map((c) => ({ id: Math.random().toString(36).slice(2, 10), name: c.name, kind: 'google', calendarId: c.calendarId, canWrite: c.canWrite, space, ...(c.color ? { color: c.color } : {}) }))]);
    forget(); await pollCalendars(); changed();
    return send(res, 200, { ok: true, added: picked.length });
  }
}

// Add, change or delete one event. Only on a Google calendar the account may write to.
async function eventRoute({ req, res, path, changed }) {
  const b = await readJson(req, 64 * 1024);
  const c = calendars().find((x) => x.id === b.calendar);
  if (!c) return send(res, 400, { error: 'Pick a calendar.' });
  if (c.kind !== 'google' || c.canWrite === false) return send(res, 400, { error: 'This calendar can only be read here. Add the calendar through Sign in with Google to change its events.' });
  try {
    if (path === '/api/calendar/event/delete') { await deleteGoogleEvent(c, String(b.id || '')); }
    else {
      const start = Number(b.start), end = Number(b.end);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return send(res, 400, { error: 'Give the event a start and an end.' });
      if (end < start) return send(res, 400, { error: 'The event ends before it starts.' });
      const ev = { title: String(b.title || '').slice(0, 300), location: String(b.location || '').slice(0, 500), description: String(b.description || '').slice(0, 8000), allDay: !!b.allDay, start, end };
      if (b.id) await updateGoogleEvent(c, String(b.id), ev); else await createGoogleEvent(c, ev);
    }
  } catch (e) { return send(res, 400, { error: friendlyError(e, 'Google'), signin: !!e.signin }); }
  forget(); await pollCalendars(); changed();
  return send(res, 200, { ok: true });
}
