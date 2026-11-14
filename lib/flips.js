// Flips: government surplus auctions worth buying to resell (Money, Flips).
//
// Three sources, each read through its own public API (nothing is scraped):
//   * eBay (lib/ebay.js), the main one: new Buy It Now listings that ship and
//     leave a profit after eBay's fees (lib/flipmath.js), and every third look
//     the misspelled listings (lib/misspell.js) and auctions ending within three
//     hours that are still under the most worth bidding. Needs the person's free
//     eBay developer keys; looked at every five minutes or a little less often
//     with many words, to stay under eBay's daily limit (ebayEvery).
//   * The category sweep (lib/ebay.js sweep): the newest listings in each
//     category of the buy box, no search words needed, each priced by its
//     eBay catalog product.
//   * ShopGoodwill and HiBid, which have no public API (lib/flipmail.js): the
//     saved-search alert emails they send, read from the person's own mail as
//     they arrive (pollAuctions), each item priced.
//   * eBay listings for pickup only near the home ZIP, every third look.
// Together that is the radar: it runs on its own, and a deal inside the buy box
// (the words, top price, least profit) is an alert on this computer and the
// phone; a hot one (twice the least profit, 40% or more) says so.
//   * GSA Auctions, the federal government's surplus sales (gsa.github.io/
//     auctions_api; a free api.data.gov key, DEMO_KEY until one is saved): only
//     lots within driving distance, set as the ZIP areas (first three digits)
//     the person will drive to. The feed is every active lot in one file; every
//     half hour.
// What to watch for (words, a top price, the nearby ZIP areas, the least profit
// worth it) is in settings, never in the code. The price check (check below)
// answers "is this a good buy?" for anything, from any site. Buying is always
// the person's own click on the site.
import { getSetting, setSetting } from './db.js';
import { retry } from './steady.js';
import { friendlyError } from './friendly.js';
import { ebayDeals, forgetEbay, roundCalls, priceFor, itemByLink, searchWords, soldLink, callsToday, isHot, sweep, sweepCalls, CATEGORIES } from './ebay.js';
import { SOURCES, sourceOf, itemsFrom } from './flipmail.js';
import { mailFrom, accounts as mailAccounts } from './gmail.js';
import { verdict, MONEY, SITES, siteOf, shipGuess } from './flipmath.js';

const FEED = 'https://api.gsa.gov/assets/gsaauctions/v2/auctions';
export const DEFAULTS = { words: [], near: [], maxPrice: null, key: '', ebay: { appId: '', certId: '' }, money: { ...MONEY }, home: '', miles: 50, alerts: 'all', minPrice: 40, cats: CATEGORIES.filter((c) => c.on).map((c) => c.id) };
export const DAILY = 4000;   // eBay calls a day Flips allows itself (the free tier is 5,000; the rest is for price checks)

let lots = [], fetchedAt = 0, lastError = null;
let deals = [], notes = [], ebayAt = 0, ebayError = null, rounds = 0;
let mailAt = 0, mailError = null, gsaNews = [];
export const takeGsaNews = () => { const n = gsaNews; gsaNews = []; return n; };   // the alert emails: their deals are kept in settings ('flipmail')
const gsaSeen = new Set();
const seen = new Set();   // eBay listings already shown: a new one is what alerts

const text = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const clean = (s) => String(s || '').trim();

// One GSA lot as the page shows it.
export function lotFrom(r) {
  const info = text(r.lotInfo);
  const overview = text((String(r.lotInfo || '').match(/Overview\s*<\/h4>\s*([\s\S]*?)(?=<h4|$)/i) || [])[1]) || info;
  return {
    id: `${clean(r.saleNo)}-${clean(r.lotNo)}`,
    name: clean(r.itemName),
    bid: Number(r.highBidAmount) > 0 ? Number(r.highBidAmount) : 0,
    bidders: Number(r.biddersCount) || 0,
    step: Number(r.aucIncrement) || null,
    reserve: !!r.reserve,
    ends: clean(r.aucEndDt),                       // a date; GSA closes lots during that day
    city: clean(r.propertyCity), state: clean(r.propertyState).toUpperCase(), zip: clean(r.propertyZip).slice(0, 5),
    agency: clean(r.agencyName),
    about: overview.slice(0, 400),
    repair: /repairable|parts may be missing|not (been )?verified|does not (power|work)|inoperable|salvage/i.test(info),
    url: clean(r.itemDescURL), image: clean(r.imageURL)
  };
}

// The GSA lots a watch picks out: within the nearby ZIP areas, under the top
// price, matching a word when there are words; soonest end, fewest bidders first.
export function pick(all, watch = DEFAULTS, now = Date.now()) {
  const words = (watch.words || []).map((w) => String(w).trim()).filter(Boolean);
  const near = (watch.near || []).map((z) => String(z).trim()).filter(Boolean);
  const today = new Date(now).toISOString().slice(0, 10);
  return all
    .filter((l) => l.ends >= today)
    .filter((l) => near.length && near.some((z) => l.zip.startsWith(z)))
    .filter((l) => !(Number(watch.maxPrice) > 0) || l.bid <= Number(watch.maxPrice))
    .map((l) => {
      const hay = `${l.name} ${l.about}`;
      const hits = words.filter((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(hay));
      const days = Math.round((Date.parse(l.ends) - Date.parse(today)) / 86400e3);
      return { ...l, hits, days };
    })
    .sort((a, b) => b.hits.length - a.hits.length || a.days - b.days || a.bidders - b.bidders);
}

export const watch = () => { const w = { ...DEFAULTS, ...getSetting('flips', {}) }; w.ebay = { ...DEFAULTS.ebay, ...(w.ebay || {}) }; w.money = { ...MONEY, ...(w.money || {}) }; return w; };
export function saveWatch(next = {}) {
  const w = watch();
  const list = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((s) => String(s).trim()).filter(Boolean).slice(0, 30);
  if ('words' in next) w.words = list(next.words).slice(0, 12).map((s) => s.slice(0, 80));
  if ('near' in next) w.near = list(next.near).filter((z) => /^\d{3,5}$/.test(z));
  if ('maxPrice' in next) w.maxPrice = Number(next.maxPrice) > 0 ? Math.round(Number(next.maxPrice)) : null;
  if ('key' in next) { w.key = String(next.key || '').trim().slice(0, 80); gsaTried = 0; }
  if ('cats' in next) w.cats = (Array.isArray(next.cats) ? next.cats : String(next.cats || '').split(',')).map(Number).filter((id) => CATEGORIES.some((c) => c.id === id));
  if ('minPrice' in next) w.minPrice = Number(next.minPrice) > 0 ? Math.round(Number(next.minPrice)) : 0;
  const money = (k, lo, hi) => { if (k in next && Number.isFinite(Number(next[k])) && String(next[k]).trim() !== '') w.money[k] = Math.min(hi, Math.max(lo, Math.round(Number(next[k]) * 10) / 10)); };
  money('minProfit', 0, 1000); money('shipOut', 0, 200); money('taxPct', 0, 15);
  if ('home' in next) w.home = /^\d{5}$/.test(String(next.home || '').trim()) ? String(next.home).trim() : '';
  if ('miles' in next && Number(next.miles) > 0) w.miles = Math.min(200, Math.round(Number(next.miles)));
  if ('alerts' in next && ['all', 'hot', 'none'].includes(next.alerts)) w.alerts = next.alerts;
  if ('appId' in next || 'certId' in next) {
    if ('appId' in next) w.ebay.appId = String(next.appId || '').trim().slice(0, 120);
    if ('certId' in next) w.ebay.certId = String(next.certId || '').trim().slice(0, 120);
    forgetEbay(); deals = []; notes = []; ebayError = null; seen.clear(); ebayAt = 0;
  }
  if ('words' in next || 'maxPrice' in next || 'minProfit' in next || 'shipOut' in next || 'taxPct' in next || 'home' in next || 'miles' in next || 'cats' in next || 'minPrice' in next) { forgetEbay(); deals = []; seen.clear(); ebayAt = 0; rounds = 0; }
  setSetting('flips', w);
  return w;
}
const hasEbay = (w) => !!(w.ebay.appId && w.ebay.certId);

// GSA: the whole active list (a few MB). Returns true when it changed.
// The shared DEMO_KEY allows about 50 looks a day, so with it a look is at
// most hourly; with the person's own free key, every half hour.
let gsaTried = 0;
export async function pollGsa() {
  if (!watch().near.length) { lots = []; return false; }
  const key = watch().key || 'DEMO_KEY';
  if (Date.now() - gsaTried < (key === 'DEMO_KEY' ? 55 : 25) * 60e3) return false;
  gsaTried = Date.now();
  try {
    const rows = await retry(async () => {
      const r = await fetch(`${FEED}?api_key=${encodeURIComponent(key)}&format=JSON`, { signal: AbortSignal.timeout(60000), headers: { 'User-Agent': 'Switchboard flips' } });
      if (!r.ok) { const e = new Error(`GSA Auctions answered ${r.status}`); e.status = r.status; throw e; }
      const j = await r.json();
      return Array.isArray(j?.Results) ? j.Results : [];
    });
    const next = rows.filter((r) => /active/i.test(r.auctionStatus || 'active')).map(lotFrom);
    const changed = next.length !== lots.length || next.some((l, i) => l.id !== lots[i]?.id || l.bid !== lots[i]?.bid);
    const first = !fetchedAt;
    lots = next; fetchedAt = Date.now(); lastError = null;
    // A new lot nearby that matches a watched word is news (GSA names lots loosely, so it is not priced).
    const hits = pick(lots, watch()).filter((l) => l.hits.length && !gsaSeen.has(l.id));
    for (const l of pick(lots, watch())) gsaSeen.add(l.id);
    gsaNews = first ? [] : hits;
    return changed;
  } catch (e) {
    lastError = e.status === 429 ? 'GSA Auctions is limiting the shared demo key. Get your own free key at api.data.gov/signup and paste it in your buy box.' : friendlyError(e, 'GSA Auctions');
    return false;
  }
}

// How often eBay is looked at, in minutes: every five, or less often when the
// words (and their misspellings, every third look) would pass DAILY calls.
export function ebayEvery(words = watch().words, pickup = !!watch().home, cs = cats(watch())) {
  const perRound = (2 * (roundCalls(words, false) + sweepCalls(cs, false)) + roundCalls(words, true, pickup) + sweepCalls(cs, true, pickup)) / 3 + words.length * 4 / 288;   // + the six-hourly prices
  return Math.max(5, Math.ceil((1440 * perRound) / DAILY));
}
export const ebayDue = () => Date.now() - ebayAt >= ebayEvery() * 60e3 - 15e3;
function cats(w) { return CATEGORIES.filter((c) => (w.cats || []).includes(c.id)); }

// eBay: one look for every word. Returns the deals not seen before (to alert on).
export async function pollEbay() {
  const w = watch();
  if (!hasEbay(w) || (!w.words.length && !cats(w).length)) { deals = []; notes = []; return []; }
  try {
    const extra = rounds % 3 === 0;
    const pickup = w.home ? { zip: w.home, miles: w.miles } : null;
    const r = w.words.length ? await ebayDeals(w.ebay, w.words, { maxPrice: w.maxPrice, money: w.money, extra, pickup }) : { deals: [], notes: [] };
    // The sweep stops looking up new products when the day's calls run low (the price check needs some).
    r.deals.push(...await sweep(w.ebay, cats(w), { minPrice: w.minPrice, maxPrice: w.maxPrice, money: w.money, extra, pickup, budget: callsToday() < DAILY - 300 ? 10 : 0 }));
    rounds++;
    // Deals from the last full look stay until the next full look (misspellings, auctions).
    const kept = extra ? [] : deals.filter((d) => d.how !== 'new' && (!d.endsAt || d.endsAt > Date.now()));
    const all = [...r.deals, ...kept.filter((d) => !r.deals.some((x) => x.id === d.id))].sort((a, b) => (b.v.profit ?? 0) - (a.v.profit ?? 0));
    const first = !seen.size && !ebayAt;   // after a restart: what is already there is not news
    const fresh = first ? [] : all.filter((d) => !seen.has(d.id));
    for (const d of all) seen.add(d.id);
    deals = all; notes = r.notes; ebayAt = Date.now(); ebayError = null;
    return fresh;
  } catch (e) {
    ebayAt = Date.now();
    ebayError = /eBay did not accept|daily limit/.test(e.message) ? e.message : friendlyError(e, 'eBay');
    return [];
  }
}

// The alert emails from auction sites (lib/flipmail.js): each new one read
// once, its items priced on eBay; the ones with room to bid are deals, kept a
// week in settings ('flipmail'). Returns the new deals (to alert on).
const MAIL_KEEP = 7 * 86400e3;
const mailState = () => ({ read: [], deals: [], unpriced: [], last: {}, ...getSetting('flipmail', {}) });
export async function pollAuctions() {
  const w = watch();
  if (!mailAccounts().length) return [];
  const st = mailState();
  const read = new Set(st.read);
  try {
    const mails = await mailFrom(SOURCES.flatMap((x) => x.from), { skip: read, max: 10 });
    const fresh = [];
    for (const m of mails) {
      read.add(m.id);
      const src = sourceOf(m.from);
      if (!src) continue;
      st.last[src.id] = Math.max(st.last[src.id] || 0, m.date);
      for (const it of itemsFrom(m, src).slice(0, 25)) {
        if (w.maxPrice > 0 && it.price > w.maxPrice) continue;
        const id = 'mail-' + it.url.replace(/[?#].*$/, '');
        if (st.deals.some((d) => d.id === id) || st.unpriced.some((d) => d.id === id)) continue;
        const base = { id, name: it.name, url: it.url, price: it.price || 0, total: it.price || 0, shipping: null, condition: '', image: '', listedAt: m.date, auction: true,
          bids: null, endsAt: null, seller: null, word: it.sourceName, how: 'alert', source: it.source, sourceName: it.sourceName, site: it.site, at: Date.now() };
        if (!hasEbay(w)) { st.unpriced.push(base); continue; }
        const p = await priceFor(w.ebay, searchWords(it.name)).catch(() => null);
        if (!p?.sells) continue;
        const v = verdict({ sale: p.sells, price: it.price || 0, ...w.money, site: it.site, shipOut: shipGuess(it.name, w.money.shipOut) });
        if (v && v.max > (it.price || 0)) { const d = { ...base, sells: p.sells, v, bidTo: v.max, hot: isHot(v, w.money) }; st.deals.push(d); fresh.push(d); }
      }
    }
    const now = Date.now();
    st.deals = st.deals.filter((d) => now - d.at < MAIL_KEEP).slice(-200);
    st.unpriced = st.unpriced.filter((d) => now - d.at < MAIL_KEEP).slice(-200);
    st.read = [...read].slice(-500);
    setSetting('flipmail', st);
    mailAt = now; mailError = null;
    return fresh;
  } catch (e) {
    mailAt = Date.now(); mailError = friendlyError(e, 'your mail');
    return [];
  }
}

// The radar's sources and how each is doing, for the page's Radar tab.
export function radar() {
  const w = watch(), st = mailState();
  const on = (b, ok, need) => ({ on: !!b, state: b ? ok : need });
  return [
    { id: 'sweep', name: 'eBay, whole categories', how: `${cats(w).map((c) => c.name).join(', ') || 'no categories on'}: every new listing priced by its product`, every: `every ${ebayEvery()} min`, at: ebayAt, error: ebayError, ...on(hasEbay(w) && cats(w).length, 'on', !hasEbay(w) ? 'Needs your eBay keys' : 'Turn on a category') },
    { id: 'ebay', name: 'eBay, your searches', how: 'Exact things you name, and their misspellings', every: `every ${ebayEvery()} min`, at: ebayAt, error: ebayError, ...on(hasEbay(w) && w.words.length, 'on', !hasEbay(w) ? 'Needs your eBay keys' : 'Optional: name exact things') },
    { id: 'ending', name: 'eBay auctions ending', how: 'Auctions ending within three hours still under the most worth bidding', every: 'every third look', at: ebayAt, ...on(hasEbay(w), 'on', 'Needs your eBay keys') },
    { id: 'pickup', name: 'eBay pickup near you', how: `Pickup-only listings within ${w.miles} miles: few buyers drive, so they go cheap`, every: 'every third look', at: ebayAt, ...on(hasEbay(w) && w.home, 'on', !w.home ? 'Add your home ZIP' : 'Needs your eBay keys') },
    { id: 'gsa', name: 'GSA surplus', how: 'Federal surplus lots in your ZIP areas', every: w.key ? 'every 30 min' : 'hourly', at: fetchedAt, error: lastError, ...on(w.near.length, 'on', 'Add nearby ZIP areas') },
    ...SOURCES.map((x) => ({ id: x.id, name: x.name, how: x.how, setup: x.setup, every: 'as alert emails arrive', at: st.last[x.id] || 0, mail: true, error: mailError,
      ...on(st.last[x.id], 'on', mailAccounts().length ? 'Needs a saved search' : 'Needs Gmail connected') }))
  ];
}

// The price check: is this a good buy? `what` is a name or a link (an eBay
// link is read for its title and price); `sells` is what the person found it
// sells for (eBay's sold search), else Flips reads it from eBay's listings.
export async function check({ what = '', price, site, shipIn, premium, sells, query, condition = 'used', from = '' } = {}) {
  const w = watch();
  let name = String(what || '').trim().slice(0, 300), link = /^https?:\/\//i.test(name) ? name : String(from || '').trim();
  if (link === name) name = '';
  site = SITES[site] ? site : siteOf(link) || 'ebay';
  let item = null, note = null;
  if (siteOf(link) === 'ebay' && hasEbay(w)) {
    try { item = await itemByLink(w.ebay, link); } catch (e) { note = friendlyError(e, 'eBay'); }
    if (item) { name = name || item.name; if (!(Number(price) > 0)) price = item.price; if (shipIn == null || shipIn === '') shipIn = item.shipping ?? 0; }
  }
  if (!name) return { error: link ? 'Flips cannot read that site\'s page. Type what it is (brand and model), or use the Check in Flips bookmark on the page itself.' : 'Type what it is: brand and model work best, like "RTX 3070 Founders Edition".' };
  const q = String(query || '').trim() || searchWords(name);
  const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? undefined : Number(v));
  const o = { ...w.money, site, shipIn: num(shipIn), premium: num(premium), shipOut: shipGuess(name, w.money.shipOut) };
  let p = null;
  if (num(sells) > 0) p = { sells: num(sells), source: 'you' };
  else if (hasEbay(w)) {
    try {
      p = await priceFor(w.ebay, q, { condition });
      // A long title can find too little: try again with its first words and model numbers.
      if (!p.sells) { const short = q.split(' ').filter((x, i) => i < 2 || /\d/.test(x)).slice(0, 4).join(' '); if (short !== q) { const p2 = await priceFor(w.ebay, short, { condition }); if (p2.sells) p = p2; } }
      p = { ...p, source: 'ebay' };
    } catch (e) { note = friendlyError(e, 'eBay'); }
  }
  const v = p?.sells ? verdict({ sale: p.sells, price: num(price), ...o }) : null;
  return {
    name, query: p?.query || q, link, site, siteLabel: SITES[site].label, siteNote: SITES[site].note || null, price: num(price) ?? null,
    shipIn: o.shipIn ?? SITES[site].shipIn ?? 0, premium: o.premium ?? SITES[site].premium, shipOut: o.shipOut,
    sells: p?.sells || null, asking: p?.asking || null, comps: p?.n ?? null, sample: p?.sample || [], source: p?.source || null,
    verdict: v, sold: soldLink(p?.query || q), ebay: hasEbay(w), item: item ? { name: item.name, price: item.price, shipping: item.shipping, url: item.url } : null,
    note: note || (!p?.sells && hasEbay(w) ? `eBay has too few listings of exactly "${p?.query || q}" to know its price. Change the search words, or open Sold prices and type what it sold for.` : !hasEbay(w) && !p ? 'Until the eBay keys are in, open Sold prices and type what it usually sold for.' : null)
  };
}

// What the Flips page and Jarvis see. Keys are never sent back, only whether they are saved.
export function flips({ limit = 40 } = {}) {
  const w = watch();
  const near = pick(lots, w);
  const st = mailState();
  const all = [...deals, ...st.deals.filter((d) => Date.now() - d.at < MAIL_KEEP)].sort((a, b) => (b.hot - a.hot) || (b.v?.profit ?? 0) - (a.v?.profit ?? 0));
  return {
    deals: all.slice(0, limit), notes, ebayAt, ebayError, ebay: hasEbay(w), every: ebayEvery(w.words), calls: callsToday(), daily: DAILY,
    money: w.money, categories: CATEGORIES.map((c) => ({ id: c.id, name: c.name, on: w.cats.includes(c.id) })), unpriced: st.unpriced.slice(-40).reverse(), radar: radar(), mailAt,
    lots: near.slice(0, limit), nearCount: near.length, total: lots.length, fetchedAt, error: lastError,
    watch: { words: w.words, near: w.near, maxPrice: w.maxPrice, minPrice: w.minPrice, key: !!w.key, gsaError: lastError, home: w.home, miles: w.miles, alerts: w.alerts }
  };
}

// For the board (S.flips): enough for the setup list and the Money tab's count.
export function flipsBrief() { const w = watch(); return { ebay: hasEbay(w), cats: w.cats.length, words: w.words.length, near: w.near.length, mail: Object.keys(mailState().last).length, deals: deals.length + mailState().deals.length }; }
// Whether a new deal is an alert: every deal in the buy box, only hot ones, or none.
export const alertable = (d) => { const a = watch().alerts; return a === 'all' || (a === 'hot' && d.hot); };
