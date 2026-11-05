// Google Calendar against a stand-in Google: the sign-in (state checked, PKCE, the
// token kept), listing calendars, events in our shape (timed and all day), adding,
// changing and deleting an event, and what happens when Google signs Switchboard out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const seen = [];
let unauthorized = false;
const fake = createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c;
  seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
  const json = (o, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (req.url === '/token') {
    const p = new URLSearchParams(body);
    const id_token = 'x.' + Buffer.from(JSON.stringify({ email: 'me@example.com' })).toString('base64url') + '.y';
    return json({ access_token: 'access-1', expires_in: 3600, refresh_token: p.get('grant_type') === 'authorization_code' ? 'refresh-1' : undefined, id_token });
  }
  if (unauthorized && req.url.startsWith('/users')) return json({ error: { message: 'bad' } }, 401);
  if (req.url.startsWith('/users/me/calendarList')) return json({ items: [{ id: 'me@example.com', summary: 'Me', accessRole: 'owner', primary: true, backgroundColor: '#123456' }, { id: 'holidays', summary: 'Holidays', accessRole: 'reader' }] });
  if (req.method === 'GET' && req.url.startsWith('/calendars/me%40example.com/events')) return json({ items: [
    { id: 'e1', summary: 'Dentist', location: 'Main St', start: { dateTime: '2030-10-05T15:00:00Z' }, end: { dateTime: '2030-10-05T16:00:00Z' } },
    { id: 'e2', summary: 'Trip', start: { date: '2030-10-07' }, end: { date: '2030-10-09' }, recurringEventId: 'r' },
    { id: 'e3', status: 'cancelled', start: { date: '2030-10-07' }, end: { date: '2030-10-08' } }] });
  if (req.method === 'POST') return json({ id: 'new1', summary: JSON.parse(body).summary, start: JSON.parse(body).start, end: JSON.parse(body).end });
  if (req.method === 'PATCH') return json({ id: 'e1', summary: JSON.parse(body).summary, start: JSON.parse(body).start, end: JSON.parse(body).end });
  if (req.method === 'DELETE') { res.writeHead(204); return res.end(); }
  json({}, 404);
}).listen(0, '127.0.0.1');
await new Promise((r) => fake.once('listening', r));
const base = `http://127.0.0.1:${fake.address().port}`;
process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-google-'));
process.env.SWITCHBOARD_GOOGLE_API = base;
process.env.SWITCHBOARD_GOOGLE_TOKEN = base + '/token';
process.env.SWITCHBOARD_GOOGLE_CLIENT_ID = 'client-id';
process.env.SWITCHBOARD_GOOGLE_CLIENT_SECRET = 'client-secret';
const g = await import('../lib/google.js');
const cal = { calendarId: 'me@example.com' };

test('sign-in: only the click that started it can finish it, and only once', async () => {
  const s = g.startGoogleSignIn(4747);
  const u = new URL(s.url);
  assert.equal(u.searchParams.get('redirect_uri'), 'http://127.0.0.1:4747/oauth/google');
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.match(u.searchParams.get('scope'), /auth\/calendar/);
  assert.ok((await g.finishGoogleSignIn({ state: 'made-up', code: 'c' })).error);
  assert.match((await g.finishGoogleSignIn({ error: 'access_denied' })).error, /did not allow/);
  const r = await g.finishGoogleSignIn({ state: u.searchParams.get('state'), code: 'the-code' });
  assert.deepEqual(r, { ok: true, email: 'me@example.com' });
  const exchange = new URLSearchParams(seen.find((x) => x.url === '/token').body);
  assert.equal(exchange.get('code'), 'the-code');
  assert.ok(exchange.get('code_verifier').length >= 43, 'PKCE verifier sent');
  assert.equal(g.googleAccount().email, 'me@example.com');
  assert.ok((await g.finishGoogleSignIn({ state: u.searchParams.get('state'), code: 'again' })).error, 'a state works once');
});

test('calendars and events come back in our shape; cancelled ones are dropped', async () => {
  const cals = await g.googleCalendars();
  assert.deepEqual(cals.map((c) => [c.name, c.canWrite, c.primary]), [['Me', true, true], ['Holidays', false, false]]);
  const ev = await g.googleEvents(cal, Date.UTC(2030, 9, 1), Date.UTC(2030, 10, 1));
  assert.deepEqual(ev.map((e) => e.title), ['Dentist', 'Trip']);
  assert.equal(ev[0].start, Date.UTC(2030, 9, 5, 15));
  assert.equal(ev[0].allDay, false);
  assert.equal(ev[1].allDay, true);
  assert.equal(new Date(ev[1].end).getDate() - new Date(ev[1].start).getDate(), 2, 'two whole days');
  assert.equal(ev[1].recurring, true);
  assert.equal(seen.filter((x) => x.url.includes('/events')).at(-1).auth, 'Bearer access-1');
});

test('add, change and delete send what the person typed, nothing else', async () => {
  const timed = await g.createGoogleEvent(cal, { title: ' Lunch ', location: 'Cafe', description: 'bring notes', allDay: false, start: Date.UTC(2030, 9, 5, 12), end: Date.UTC(2030, 9, 5, 13) });
  const post = JSON.parse(seen.findLast((x) => x.method === 'POST' && x.url.includes('/events')).body);
  assert.deepEqual(post, { summary: 'Lunch', location: 'Cafe', description: 'bring notes', start: { dateTime: '2030-10-05T12:00:00.000Z' }, end: { dateTime: '2030-10-05T13:00:00.000Z' } });
  assert.equal(timed.uid, 'new1');
  await g.updateGoogleEvent(cal, 'e1', { title: 'Dentist moved', allDay: true, start: new Date(2030, 9, 6).getTime(), end: new Date(2030, 9, 6).getTime() });
  const patch = seen.findLast((x) => x.method === 'PATCH');
  assert.match(patch.url, /\/events\/e1$/);
  assert.deepEqual(JSON.parse(patch.body).start, { date: '2030-10-06' });
  assert.deepEqual(JSON.parse(patch.body).end, { date: '2030-10-07' }, 'an all-day event ends the next day at the earliest');
  assert.deepEqual(await g.deleteGoogleEvent(cal, 'e1'), { ok: true });
  assert.equal(seen.findLast((x) => x.method === 'DELETE').url.endsWith('/events/e1'), true);
});

test('when Google stops accepting the sign-in it says to sign in again; Sign out forgets the token', async () => {
  unauthorized = true;
  await assert.rejects(g.googleCalendars(), (e) => e.signin === true && /Sign in with Google/.test(e.message));
  unauthorized = false;
  g.googleDisconnect();
  assert.equal(g.googleAccount(), null);
  await assert.rejects(g.googleCalendars(), (e) => e.signin === true && /not connected/.test(e.message));
});

test.after(() => fake.close());
