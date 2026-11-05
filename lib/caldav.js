// Calendars straight from an email account (CalDAV): iCloud, Fastmail and
// Yahoo serve the account's calendars at a known address, and take the same
// app password the mail already uses. Three steps find them (who am I, where
// are my calendars, which calendars are there) and one reads the next two
// weeks of one. Plain fetch and a little XML reading: no new dependency.
//
// Safety: the password only ever goes over https, and only to the provider's
// own hosts (iCloud sends you on to pNN-caldav.icloud.com, which is still
// icloud.com); an address the server hands back that points anywhere else is
// refused, so a server cannot steer the password to another site.
import { readCapped } from './calendar.js';

export const CALDAV = [
  { id: 'icloud', name: 'iCloud', imap: /(^|\.)mail\.me\.com$|(^|\.)icloud\.com$/i, url: 'https://caldav.icloud.com/', domain: 'icloud.com' },
  { id: 'fastmail', name: 'Fastmail', imap: /(^|\.)fastmail\.(com|fm)$|messagingengine\.com$/i, url: 'https://caldav.fastmail.com/dav/', domain: 'fastmail.com' },
  { id: 'yahoo', name: 'Yahoo', imap: /(^|\.)yahoo\.com$/i, url: 'https://caldav.calendar.yahoo.com/', domain: 'yahoo.com' }
];
// The provider for an email account (from its IMAP server), or null.
export function caldavFor(acct) {
  const host = acct?.imap?.host || '';
  return CALDAV.find((p) => p.imap.test(host)) || null;
}

const MAX_XML = 4 * 1024 * 1024;
// Only https, and only the provider's own domain.
export function allowedUrl(href, base, domain) {
  let u; try { u = new URL(href, base); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const h = u.hostname.toLowerCase();
  return h === domain || h.endsWith('.' + domain) ? u : null;
}

// XML with its namespace prefixes dropped (d:href, D:href and href all read the same).
const bare = (xml) => String(xml).replace(/<(\/?)[A-Za-z][\w.-]*:/g, '<$1').replace(/\s+xmlns(:\w+)?="[^"]*"/g, '');
const unxml = (s) => String(s || '').replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#13;/g, '\r').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`)); return m ? m[1] : null; };
const responses = (xml) => [...bare(xml).matchAll(/<response(?:\s[^>]*)?>([\s\S]*?)<\/response>/g)].map((m) => m[1]);

async function dav(method, url, { user, pass, depth = 0, body, domain }) {
  let at = url;
  // Redirects are followed by hand, so each hop is checked against the provider's domain.
  for (let hop = 0; hop < 5; hop++) {
    const r = await fetch(at, {
      method, redirect: 'manual', signal: AbortSignal.timeout(20000),
      headers: { Authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'), Depth: String(depth), 'Content-Type': 'application/xml; charset=utf-8', 'User-Agent': 'Switchboard calendar' },
      body
    });
    if ([301, 302, 303, 307, 308].includes(r.status)) {
      const next = allowedUrl(r.headers.get('location'), at, domain);
      await r.body?.cancel().catch(() => {});
      if (!next) throw new Error('The calendar server sent Switchboard somewhere it does not trust.');
      at = next.href; continue;
    }
    if (r.status === 401 || r.status === 403) { await r.body?.cancel().catch(() => {}); throw new Error('The calendar server did not take the password. Use an app password (the same one as the mail), and for Fastmail one that includes calendars.'); }
    if (r.status !== 207 && !r.ok) { await r.body?.cancel().catch(() => {}); throw new Error(`The calendar server did not answer (${r.status}).`); }
    return { url: at, xml: await readCapped(r, MAX_XML) };
  }
  throw new Error('The calendar server kept sending Switchboard elsewhere.');
}

const PROP = (inner) => `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/"><d:prop>${inner}</d:prop></d:propfind>`;
// The href inside a property of the first response, resolved and checked.
function hrefIn(xml, prop, base, domain) {
  for (const r of responses(xml)) {
    const p = tag(r, prop); if (p == null) continue;
    const h = tag(p, 'href'); if (!h) continue;
    const u = allowedUrl(unxml(h).trim(), base, domain);
    if (u) return u.href;
  }
  return null;
}

// Every calendar on the account that holds events: [{ href, name, color }].
export async function discover(provider, user, pass) {
  const o = { user, pass, domain: provider.domain };
  const me = await dav('PROPFIND', provider.url, { ...o, body: PROP('<d:current-user-principal/>') });
  const principal = hrefIn(me.xml, 'current-user-principal', me.url, provider.domain);
  if (!principal) throw new Error('The calendar server did not say whose calendars these are.');
  const home = await dav('PROPFIND', principal, { ...o, body: PROP('<c:calendar-home-set/>') });
  const homeUrl = hrefIn(home.xml, 'calendar-home-set', home.url, provider.domain);
  if (!homeUrl) throw new Error('The calendar server did not say where the calendars are.');
  const list = await dav('PROPFIND', homeUrl, { ...o, depth: 1, body: PROP('<d:resourcetype/><d:displayname/><a:calendar-color/><c:supported-calendar-component-set/>') });
  const out = [];
  for (const r of responses(list.xml)) {
    const type = tag(r, 'resourcetype') || '';
    if (!/<calendar\b/.test(type)) continue;
    const comps = tag(r, 'supported-calendar-component-set');
    if (comps && !/name="VEVENT"/i.test(comps)) continue;   // a reminders or tasks list
    const u = allowedUrl(unxml(tag(r, 'href') || '').trim(), list.url, provider.domain);
    if (!u) continue;
    const color = (unxml(tag(r, 'calendar-color') || '').match(/#[0-9a-f]{6}/i) || [])[0] || null;
    out.push({ href: u.href, name: unxml(tag(r, 'displayname') || '').trim().slice(0, 80) || 'Calendar', color });
  }
  return out;
}

// One calendar's events between from and to, as one ICS text for parseICS.
const stamp = (t) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
export async function fetchEvents(provider, href, user, pass, from, to) {
  if (!allowedUrl(href, href, provider.domain)) throw new Error('That calendar is not on ' + provider.name + '.');
  const body = `<?xml version="1.0" encoding="utf-8"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-data/></d:prop>
    <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${stamp(from)}" end="${stamp(to)}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
  const r = await dav('REPORT', href, { user, pass, depth: 1, body, domain: provider.domain });
  const parts = responses(r.xml).map((x) => unxml(tag(x, 'calendar-data') || '')).filter((t) => /BEGIN:VCALENDAR/.test(t));
  // Each object is its own VCALENDAR; parseICS reads the VEVENTs (and VTIMEZONEs) out of all of them.
  return parts.join('\r\n');
}
