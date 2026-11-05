// Weather for one place: Open-Meteo for the forecast (free, no key, worldwide)
// and, in the US, the National Weather Service for official warnings. Now shows
// one line, plus only what is worth acting on: rain coming, frost tonight, a
// warning. Read every 30 minutes.
import { getSetting, setSetting } from './db.js';
import { alert } from './notify.js';
import { friendlyError } from './friendly.js';

export const place = () => getSetting('weather', null);   // { name, lat, lon, country, tz, units: 'f' | 'c' }
export const savePlace = (p) => setSetting('weather', p);

// WMO weather codes, as plain words.
const CODES = {
  0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Cloudy', 45: 'Fog', 48: 'Freezing fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Showers', 81: 'Showers', 82: 'Heavy showers',
  85: 'Snow showers', 86: 'Heavy snow showers', 95: 'Thunderstorms', 96: 'Thunderstorms with hail', 99: 'Thunderstorms with hail'
};
export const describe = (code) => CODES[code] || 'Weather';
const wet = (code) => code >= 51;

// ---- finding a place: ZIP or postal code, or a town name typed loosely
const STATES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia' };
const title = (t) => t.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\bO (\w)/, "O'$1");

// Postal codes through Zippopotam.us (free): every US ZIP, and many countries.
async function postal(q) {
  const s = q.trim().toUpperCase();
  let country = null, code = s;
  if (/^\d{5}(-\d{4})?$/.test(s)) { country = 'us'; code = s.slice(0, 5); }
  else if (/^[A-Z]\d[A-Z] ?\d[A-Z]\d$/.test(s)) { country = 'ca'; code = s.slice(0, 3); }
  else if (/^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/.test(s)) { country = 'gb'; code = s.split(' ')[0] || s.slice(0, -3); }
  if (!country) return [];
  const r = await fetch(`https://api.zippopotam.us/${country}/${encodeURIComponent(code)}`, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) return [];
  const j = await r.json();
  return (j.places || []).map((p) => ({
    name: `${title(p['place name'].split(' (')[0])}, ${country === 'us' ? p.state : p.state || j.country}${country === 'us' ? ` ${s.slice(0, 5)}` : ''}`,
    lat: +p.latitude, lon: +p.longitude, country: country.toUpperCase(), tz: ''
  }));
}

// The ways people type a town: St / St. / Saint, O'Neill / ONeill / O Neill.
export function variants(name) {
  const n = name.trim().replace(/\s+/g, ' ');
  const out = new Set([n]);
  const saint = n.replace(/^(st\.?|ste\.?)\s+/i, (m) => /^ste/i.test(m) ? 'Sainte ' : 'Saint ');
  out.add(saint);
  out.add(n.replace(/^saint\s+/i, 'St. '));
  out.add(n.replace(/^saint\s+/i, 'St '));
  if (/^o\s?'?\s?[a-z]/i.test(n)) out.add(n.replace(/^o\s?'?\s?/i, "O'"));
  if (/^(mc|mac)\s/i.test(n)) out.add(n.replace(/^(mc|mac)\s/i, '$1'));
  return [...out].filter(Boolean);
}

async function byName(q, home) {
  // "Springfield, MO" or "Springfield, Missouri": the part after the comma narrows it.
  const [town, where] = q.split(',').map((x) => x.trim());
  const want = where ? (STATES[where.toUpperCase()] || where).toLowerCase() : null;
  const lists = await Promise.all(variants(town).map((v) => fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(v)}&count=10`, { signal: AbortSignal.timeout(8000) })
    .then((r) => r.json()).then((j) => j.results || []).catch(() => [])));
  const seen = new Set(), all = [];
  for (const x of lists.flat()) {
    if (seen.has(x.id)) continue; seen.add(x.id);
    if (x.feature_code && /^(AIRP|BLDG|SCH|CH|HSP)/.test(x.feature_code)) continue;   // airports and buildings are not towns
    if (want && ![x.admin1, x.country, x.country_code].some((v) => String(v || '').toLowerCase().startsWith(want))) continue;
    all.push(x);
  }
  // Your own country first, then bigger places; one entry per name.
  const rank = (x) => (home && x.country_code === home ? 1e9 : 0) + (x.population || 0);
  const names = new Set();
  return all.sort((a, b) => rank(b) - rank(a)).map((x) => ({
    name: [x.name.replace(/^City of /, ''), x.admin1, x.country_code === 'US' ? '' : x.country].filter(Boolean).join(', '),
    lat: x.latitude, lon: x.longitude, country: x.country_code, tz: x.timezone
  })).filter((x) => !names.has(x.name) && names.add(x.name)).slice(0, 8);
}

export async function geocode(q, home) {
  const s = String(q || '').trim();
  if (s.length < 2) return [];
  const zip = await postal(s).catch(() => []);
  if (zip.length) return zip;
  return byName(s, /^[A-Z]{2}$/.test(home || '') ? home : null);
}

// The forecast in a few lines. `f` is Open-Meteo's answer; `now` is a timestamp.
export function summarize(f, units, now = Date.now()) {
  const deg = '°';
  const freezing = units === 'c' ? 0 : 32;
  const hot = units === 'c' ? 35 : 95;
  // Open-Meteo gives local times without a zone; turn them into real moments.
  const at = (t) => Date.parse(t + 'Z') - (f.utc_offset_seconds || 0) * 1000;
  const hours = (f.hourly?.time || []).map((t, i) => ({ t: at(t), temp: f.hourly.temperature_2m[i], rain: f.hourly.precipitation_probability?.[i] ?? 0, code: f.hourly.weather_code?.[i] ?? 0 }));
  const today = { high: f.daily?.temperature_2m_max?.[0], low: f.daily?.temperature_2m_min?.[0], code: f.daily?.weather_code?.[0] };
  const notes = [];
  // Rain or snow in the next 12 hours: when it is likely to start.
  const soon = hours.filter((h) => h.t > now - 3600e3 && h.t < now + 12 * 3600e3);
  const firstWet = soon.find((h) => h.rain >= 50 && wet(h.code));
  if (firstWet) {
    const snow = [71, 73, 75, 77, 85, 86].includes(firstWet.code);
    const when = firstWet.t <= now + 1800e3 ? 'now' : 'from ' + new Date(firstWet.t).toLocaleTimeString([], { hour: 'numeric', timeZone: f.timezone });
    notes.push({ kind: 'rain', text: `${snow ? 'Snow' : 'Rain'} likely ${when}` });
  }
  // Frost or freeze in the next 18 hours.
  const night = hours.filter((h) => h.t > now && h.t < now + 18 * 3600e3);
  const coldest = night.reduce((m, h) => (m && m.temp <= h.temp ? m : h), null);
  if (coldest && coldest.temp <= freezing + (units === 'c' ? 1 : 2)) {
    notes.push({ kind: 'frost', text: `${coldest.temp <= freezing - (units === 'c' ? 2 : 4) ? 'Hard freeze' : 'Frost'} ${new Date(coldest.t).getHours() >= 18 || new Date(coldest.t).getHours() < 9 ? 'tonight' : 'today'}, low ${Math.round(coldest.temp)}${deg}`, at: coldest.t });
  }
  if (today.high >= hot) notes.push({ kind: 'heat', text: `Hot today, up to ${Math.round(today.high)}${deg}` });
  const gust = f.daily?.wind_gusts_10m_max?.[0];
  if (gust >= (units === 'c' ? 65 : 40)) notes.push({ kind: 'wind', text: `Gusts up to ${Math.round(gust)} ${units === 'c' ? 'km/h' : 'mph'}` });
  return {
    temp: Math.round(f.current?.temperature_2m), text: describe(f.current?.weather_code), day: f.current?.is_day !== 0,
    high: Math.round(today.high), low: Math.round(today.low), unit: units === 'c' ? 'C' : 'F', notes
  };
}

let state = { at: null, ok: null, error: null, now: null, alerts: [] };
export const weather = () => (place() ? { place: place().name, ...state } : null);

async function nwsAlerts(p) {
  if (p.country !== 'US') return [];
  const r = await fetch(`https://api.weather.gov/alerts/active?point=${p.lat.toFixed(4)},${p.lon.toFixed(4)}`, { headers: { 'User-Agent': 'Switchboard (local app)', Accept: 'application/geo+json' }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) return [];
  const j = await r.json();
  return (j.features || []).map((x) => x.properties).filter((x) => x && x.status === 'Actual').map((x) => ({
    id: x.id, event: x.event, headline: x.headline, severity: x.severity, ends: x.ends || x.expires,
    text: String(x.description || '').slice(0, 1500), instruction: String(x.instruction || '').slice(0, 800)
  }));
}

export async function pollWeather() {
  const p = place();
  if (!p) { state = { at: null, ok: null, error: null, now: null, alerts: [] }; return false; }
  const before = JSON.stringify(state.now) + JSON.stringify(state.alerts);
  try {
    const u = p.units === 'c' ? '' : '&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch';
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}&timezone=auto&forecast_days=2${u}`
      + '&current=temperature_2m,weather_code,is_day&hourly=temperature_2m,precipitation_probability,weather_code'
      + '&daily=weather_code,temperature_2m_max,temperature_2m_min,wind_gusts_10m_max';
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`The forecast did not answer (${r.status}).`);
    const f = await r.json();
    const alerts = await nwsAlerts(p).catch(() => state.alerts);
    state = { at: Date.now(), ok: true, error: null, now: summarize(f, p.units), alerts };
    tell(p);
  } catch (e) {
    state = { ...state, at: Date.now(), ok: false, error: friendlyError(e, 'the weather service') };
  }
  return JSON.stringify(state.now) + JSON.stringify(state.alerts) !== before;
}

// Warnings once each; frost once a day.
const told = new Set();
function tell() {
  for (const a of state.alerts) if (!told.has(a.id)) { told.add(a.id); alert('weather', a.event, a.headline || ''); }
  const frost = state.now?.notes.find((n) => n.kind === 'frost');
  const key = 'frost:' + new Date().toDateString();
  if (frost && !told.has(key)) { told.add(key); alert('weather', frost.text, state.place || place()?.name || ''); }
}
