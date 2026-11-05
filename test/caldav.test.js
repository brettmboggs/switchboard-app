// Calendars from an email account (CalDAV), against a stand-in for iCloud:
// the three discovery steps, the events read, and the password never leaving
// the provider's own hosts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { CALDAV, caldavFor, allowedUrl, discover, fetchEvents } = await import('../lib/caldav.js');
const { parseICS } = await import('../lib/calendar.js');

const icloud = CALDAV.find((p) => p.id === 'icloud');
const ms = (xml) => new Response(xml, { status: 207, headers: { 'Content-Type': 'application/xml' } });
const ICS = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:a1\r\nSUMMARY:Dentist & check\r\nDTSTART:20261105T150000Z\r\nDTEND:20261105T160000Z\r\nEND:VEVENT\r\nEND:VCALENDAR';
const seen = [];
function stand(redirectTo) {
  return async (url, opts) => {
    const u = String(url); seen.push({ u, auth: opts.headers.Authorization, method: opts.method });
    if (u === 'https://caldav.icloud.com/') return new Response(null, { status: 301, headers: { Location: redirectTo } });
    if (u === 'https://p42-caldav.icloud.com/') return ms('<d:multistatus xmlns:d="DAV:"><d:response><d:href>/</d:href><d:propstat><d:prop><d:current-user-principal><d:href>/123/principal/</d:href></d:current-user-principal></d:prop></d:propstat></d:response></d:multistatus>');
    if (u === 'https://p42-caldav.icloud.com/123/principal/') return ms('<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><response><href>/123/principal/</href><propstat><prop><C:calendar-home-set><href>https://p42-caldav.icloud.com/123/calendars/</href></C:calendar-home-set></prop></propstat></response></multistatus>');
    if (u === 'https://p42-caldav.icloud.com/123/calendars/') return ms(`<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/">
      <d:response><d:href>/123/calendars/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
      <d:response><d:href>/123/calendars/home/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Home</d:displayname><a:calendar-color>#FF2968FF</a:calendar-color><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set></d:prop></d:propstat></d:response>
      <d:response><d:href>/123/calendars/tasks/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Reminders</d:displayname><c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set></d:prop></d:propstat></d:response>
      <d:response><d:href>https://evil.test/steal/</d:href><d:propstat><d:prop><d:resourcetype><c:calendar/></d:resourcetype><d:displayname>Elsewhere</d:displayname></d:prop></d:propstat></d:response>
    </d:multistatus>`);
    if (u === 'https://p42-caldav.icloud.com/123/calendars/home/') return ms(`<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav"><d:response><d:href>/123/calendars/home/a1.ics</d:href><d:propstat><d:prop><cal:calendar-data>${ICS.replace(/&/g, "&amp;")}</cal:calendar-data></d:prop></d:propstat></d:response></d:multistatus>`);
    return new Response('no', { status: 404 });
  };
}

test('an iCloud account is found by its mail server', () => {
  assert.equal(caldavFor({ imap: { host: 'imap.mail.me.com' } })?.id, 'icloud');
  assert.equal(caldavFor({ imap: { host: 'imap.fastmail.com' } })?.id, 'fastmail');
  assert.equal(caldavFor({ imap: { host: 'imap.mail.yahoo.com' } })?.id, 'yahoo');
  assert.equal(caldavFor({ imap: { host: 'imap.gmail.com' } }), null);
  assert.equal(caldavFor({}), null);
});

test('only https, only the provider', () => {
  assert.ok(allowedUrl('https://p1-caldav.icloud.com/x', undefined, 'icloud.com'));
  assert.equal(allowedUrl('http://caldav.icloud.com/', undefined, 'icloud.com'), null);
  assert.equal(allowedUrl('https://icloud.com.evil.test/', undefined, 'icloud.com'), null);
  assert.equal(allowedUrl('https://evilicloud.com/', undefined, 'icloud.com'), null);
});

test('discover follows iCloud to its calendars, and reads their events', async (t) => {
  const real = globalThis.fetch;
  t.after(() => { globalThis.fetch = real; });
  globalThis.fetch = stand('https://p42-caldav.icloud.com/');
  const list = await discover(icloud, 'me@icloud.com', 'app-pass');
  assert.deepEqual(list, [{ href: 'https://p42-caldav.icloud.com/123/calendars/home/', name: 'Home', color: '#FF2968' }]);
  const text = await fetchEvents(icloud, list[0].href, 'me@icloud.com', 'app-pass', Date.UTC(2026, 10, 4), Date.UTC(2026, 10, 18));
  const ev = parseICS(text);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].summary, 'Dentist & check');
  assert.ok(seen.every((s) => new URL(s.u).hostname.endsWith('icloud.com')));
  assert.ok(seen.every((s) => s.auth === 'Basic ' + Buffer.from('me@icloud.com:app-pass').toString('base64')));
});

test('a redirect off the provider is refused before the password goes there', async (t) => {
  const real = globalThis.fetch;
  t.after(() => { globalThis.fetch = real; });
  seen.length = 0;
  globalThis.fetch = stand('https://evil.test/');
  await assert.rejects(() => discover(icloud, 'me@icloud.com', 'app-pass'), /does not trust/);
  assert.ok(seen.every((s) => !s.u.includes('evil.test')));
});
