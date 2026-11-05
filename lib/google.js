// Google Calendar, read and write, signed in the way every Switchboard sign-in is:
// one button, Google's own page in a real browser tab, the person signs in there.
// Switchboard never sees a Google password. It gets a refresh token (kept locked
// on disk, like the other tokens) and asks Google's Calendar API for events with
// plain fetch: nothing else is installed.
//
// Sign-in is Google's loopback flow for desktop apps with PKCE: the page opens
// Google's address, Google sends the browser back to http://127.0.0.1:<port>/oauth/google
// with a one-time code, and this file trades it for the token. The state value
// ties the return to the click that started it (one use, ten minutes).
//
// The app's client (its id, and the secret Google issues to desktop apps, which
// Google does not treat as confidential) is not personal data and is not kept in
// the repository: the id is in lib/product.js, and the secret is read from
// ~/.config/switchboard/google-client.json or SWITCHBOARD_GOOGLE_CLIENT_SECRET.
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getSetting, setSetting } from './db.js';
import { PRODUCT } from './product.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = process.env.SWITCHBOARD_GOOGLE_TOKEN || 'https://oauth2.googleapis.com/token';
const API = process.env.SWITCHBOARD_GOOGLE_API || 'https://www.googleapis.com/calendar/v3';
const SCOPE = 'openid email https://www.googleapis.com/auth/calendar';
const CLIENT_FILE = process.env.SWITCHBOARD_GOOGLE_CLIENT || join(homedir(), '.config', 'switchboard', 'google-client.json');

export const googleAccount = () => getSetting('google', null);   // { email, refreshToken, at } or null
const saveAccount = (a) => setSetting('google', a);

// The client this copy of Switchboard signs in with, or null when it has none.
export function clientConfig() {
  let file = {};
  try { file = JSON.parse(readFileSync(CLIENT_FILE, 'utf8')); } catch {}
  const clientId = process.env.SWITCHBOARD_GOOGLE_CLIENT_ID || file.clientId || PRODUCT.googleClientId;
  const clientSecret = process.env.SWITCHBOARD_GOOGLE_CLIENT_SECRET || file.clientSecret || '';
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

const b64u = (buf) => buf.toString('base64url');
const pending = new Map();   // state -> { verifier, redirect, at }

// The address to open in a browser tab, or an error saying what is missing.
export function startGoogleSignIn(port) {
  const cfg = clientConfig();
  if (!cfg) return { error: 'This copy of Switchboard has no Google sign-in set up yet. See the README, "Google Calendar".' };
  for (const [k, v] of pending) if (Date.now() - v.at > 10 * 60e3) pending.delete(k);
  const state = b64u(randomBytes(24)), verifier = b64u(randomBytes(48));
  const redirect = `http://127.0.0.1:${port}/oauth/google`;
  pending.set(state, { verifier, redirect, at: Date.now() });
  const q = new URLSearchParams({
    client_id: cfg.clientId, redirect_uri: redirect, response_type: 'code', scope: SCOPE, state,
    code_challenge: b64u(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
    access_type: 'offline', prompt: 'consent'   // consent every time, so Google always hands back a refresh token
  });
  return { url: `${AUTH_URL}?${q}` };
}

async function tokenCall(params) {
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params), signal: AbortSignal.timeout(20000) });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(json.error_description || json.error || `Google answered ${r.status}.`), { code: json.error });
  return json;
}

// Google's page sent the browser back with ?code=&state=. Returns { ok } or { error }.
export async function finishGoogleSignIn(query) {
  if (query.error) return { error: query.error === 'access_denied' ? 'You did not allow access, so nothing was connected.' : `Google said: ${query.error}.` };
  const p = pending.get(query.state);
  pending.delete(query.state);
  if (!p || Date.now() - p.at > 10 * 60e3) return { error: 'That sign-in link is too old or was not started here. Press Sign in with Google again.' };
  const cfg = clientConfig();
  if (!cfg || !query.code) return { error: 'Google did not send back what Switchboard needs. Press Sign in with Google again.' };
  try {
    const t = await tokenCall({ grant_type: 'authorization_code', code: query.code, redirect_uri: p.redirect, code_verifier: p.verifier, client_id: cfg.clientId, client_secret: cfg.clientSecret });
    if (!t.refresh_token) return { error: 'Google did not give Switchboard lasting access. Remove Switchboard at myaccount.google.com/permissions, then sign in again.' };
    let email = '';
    try { email = JSON.parse(Buffer.from(String(t.id_token).split('.')[1], 'base64url').toString()).email || ''; } catch {}
    saveAccount({ email, refreshToken: t.refresh_token, at: Date.now() });
    access = { value: t.access_token, exp: Date.now() + (t.expires_in - 60) * 1000 };
    return { ok: true, email };
  } catch (e) { return { error: `Google did not accept the sign-in: ${e.message}` }; }
}

export function googleDisconnect() {
  const a = googleAccount();
  access = { value: null, exp: 0 };
  saveAccount(null);
  // Tell Google to forget it too, best effort: the token is no use after this anyway.
  if (a?.refreshToken) fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: a.refreshToken }), signal: AbortSignal.timeout(10000) }).catch(() => {});
}

let access = { value: null, exp: 0 };
async function accessToken() {
  const a = googleAccount(), cfg = clientConfig();
  if (!a?.refreshToken || !cfg) throw Object.assign(new Error('Google is not connected. Press Sign in with Google in Settings, Connections.'), { signin: true });
  if (access.value && Date.now() < access.exp) return access.value;
  try {
    const t = await tokenCall({ grant_type: 'refresh_token', refresh_token: a.refreshToken, client_id: cfg.clientId, client_secret: cfg.clientSecret });
    access = { value: t.access_token, exp: Date.now() + (t.expires_in - 60) * 1000 };
    return access.value;
  } catch (e) {
    if (e.code === 'invalid_grant') throw Object.assign(new Error('Google signed Switchboard out (that happens after a week while the app is still in testing, or if you removed its access). Press Sign in with Google again.'), { signin: true });
    throw e;
  }
}

async function call(method, path, { query, body } = {}) {
  const url = `${API}${path}${query ? '?' + new URLSearchParams(query) : ''}`;
  const r = await fetch(url, { method, headers: { Authorization: 'Bearer ' + await accessToken(), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  if (r.status === 204) return {};
  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = json.error?.message || `Google answered ${r.status}.`;
    if (r.status === 401) { access = { value: null, exp: 0 }; throw Object.assign(new Error('Google did not accept Switchboard\'s sign-in. Press Sign in with Google again.'), { signin: true }); }
    if (r.status === 403) throw new Error(`Google would not allow that: ${msg}`);
    if (r.status === 404 || r.status === 410) throw new Error('That event or calendar is gone from Google.');
    throw new Error(`Google could not do that: ${msg}`);
  }
  return json;
}

// ---------- calendars
export async function googleCalendars() {
  const out = [];
  let pageToken;
  for (let i = 0; i < 5; i++) {
    const r = await call('GET', '/users/me/calendarList', { query: { maxResults: '250', ...(pageToken ? { pageToken } : {}) } });
    for (const c of r.items || []) out.push({ calendarId: c.id, name: c.summaryOverride || c.summary || c.id, color: /^#[0-9a-f]{6}$/i.test(c.backgroundColor || '') ? c.backgroundColor : null, canWrite: c.accessRole === 'owner' || c.accessRole === 'writer', primary: !!c.primary });
    if (!(pageToken = r.nextPageToken)) break;
  }
  return out;
}

// ---------- events (our shape: start and end in ms, allDay when it has no times)
const localMidnight = (d) => { const [y, m, day] = d.split('-').map(Number); return new Date(y, m - 1, day).getTime(); };
export function fromGoogle(e) {
  const allDay = !!e.start?.date;
  const start = allDay ? localMidnight(e.start.date) : Date.parse(e.start?.dateTime);
  const end = allDay ? localMidnight(e.end?.date || e.start.date) : Date.parse(e.end?.dateTime || e.start?.dateTime);
  return { uid: e.id, title: e.summary || '(no title)', location: e.location || '', description: e.description || '', start, end, allDay, recurring: !!e.recurringEventId, link: e.htmlLink || '' };
}
const ymd = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export function toGoogle(ev) {
  const body = { summary: String(ev.title || '').trim() || '(no title)', location: String(ev.location || ''), description: String(ev.description || '') };
  if (ev.allDay) { body.start = { date: ymd(ev.start) }; body.end = { date: ymd(Math.max(ev.end, ev.start + 86400e3)) }; }
  else { body.start = { dateTime: new Date(ev.start).toISOString() }; body.end = { dateTime: new Date(Math.max(ev.end, ev.start + 60e3)).toISOString() }; }
  return body;
}

const cal = (c) => `/calendars/${encodeURIComponent(c.calendarId)}/events`;

// Every event between from and to (repeats already worked out by Google), not cancelled.
export async function googleEvents(c, from, to) {
  const out = [];
  let pageToken;
  for (let i = 0; i < 8; i++) {
    const r = await call('GET', cal(c), { query: { singleEvents: 'true', orderBy: 'startTime', maxResults: '250', timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), ...(pageToken ? { pageToken } : {}) } });
    for (const e of r.items || []) if (e.status !== 'cancelled' && (e.start?.date || e.start?.dateTime)) out.push(fromGoogle(e));
    if (!(pageToken = r.nextPageToken)) break;
  }
  return out;
}
export const createGoogleEvent = async (c, ev) => fromGoogle(await call('POST', cal(c), { body: toGoogle(ev) }));
export const updateGoogleEvent = async (c, id, ev) => fromGoogle(await call('PATCH', `${cal(c)}/${encodeURIComponent(id)}`, { body: toGoogle(ev) }));
export const deleteGoogleEvent = async (c, id) => { await call('DELETE', `${cal(c)}/${encodeURIComponent(id)}`); return { ok: true }; };
