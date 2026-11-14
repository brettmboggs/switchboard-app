// eBay for Flips (lib/flips.js): what a thing sells for, and listings that
// leave a profit after eBay's fees (lib/flipmath.js).
//
// eBay's Browse API with the person's own free developer keys (App ID and Cert
// ID from developer.ebay.com, saved in Settings, kept encrypted). It reads
// listings only: it cannot buy, bid or touch anyone's eBay account. The free
// tier allows 5,000 calls a day; lib/flips.js spaces its looks to stay under
// 4,000 (ebayEvery).
//
// Sold prices are not on the free tier (that is eBay's Marketplace Insights,
// for approved partners only). So the price a thing "sells for" is read from
// what is listed now: the listings for the same item (every word of the search
// in the title, no other model like "Ti" or "Pro", not parts or a box), with
// the cheapest and dearest cut, and the price a third of the way up. The cheap
// end of what is listed is what sells first, so this sits near real sold
// prices; the page says so and links eBay's own sold search to make sure.
import { retry } from './steady.js';
import { verdict, shipGuess, MONEY } from './flipmath.js';
import { misspellings } from './misspell.js';

const API = 'https://api.ebay.com';
const SCOPE = 'https://api.ebay.com/oauth/api_scope';
export const COMPS_MS = 6 * 3600e3;
const MIN_COMPS = 6;                 // fewer matching listings than this: no price
export const SELLS_AT = 0.3;          // where in the listed prices "sells for" sits
// Titles that are not the thing itself, or not working: never a comparison, never a deal.
export const NOT_IT = /\b(for parts|parts only|not working|non[- ]?working|broken|as[- ]is|read desc|box only|empty box|case only|manual only|no (lens|battery|charger|power)|cracked|water damage|locked|icloud|blacklist|bad esn|untested|replica|shell only|housing only|faceplate|lot of|bundle of|\d+ ?x |wholesale)\b/i;
// Other models of the same name: "RTX 3070" is not an "RTX 3070 Ti".
const VARIANTS = new Set(['ti', 'super', 'pro', 'mini', 'lite', 'oled', 'xl', 'ultra', 'slim', 'se', 'air', 'laptop', 'mobile']);
// Words that say nothing about which item it is (left out of a search made from a long title).
const NOISE = new Set(['tested', 'working', 'works', 'work', 'great', 'good', 'excellent', 'mint', 'nice', 'clean', 'condition', 'used', 'new', 'brand', 'sealed', 'free', 'shipping', 'ship', 'fast', 'with', 'and', 'the', 'for', 'in', 'of', 'a', 'an', 'w', 'w/', 'read', 'description', 'see', 'photos', 'pics', 'only', 'original', 'oem', 'genuine', 'authentic', 'rare', 'look', 'nr', 'no', 'reserve', 'l@@k', 'wow', 'fully', 'functional', 'pre-owned', 'preowned', 'item', 'unit', 'shopgoodwill', 'goodwill', 'auction', 'lot']);
// Conditions fine for a flip (new, open box, refurbished, used); 7000 is for parts.
const CONDITIONS = '1000|1500|1750|2000|2010|2020|2030|2500|2750|3000|4000|5000|6000';
const USED = '2000|2010|2020|2030|2500|2750|3000|4000|5000|6000';

// The categories the radar sweeps without any search words: things that ship in
// a small box, are easy to test and sell steadily (ids checked on ebay.com, Nov
// 12 2026). The buy box turns each on or off; `on` is the starting set.
export const CATEGORIES = [
  { id: 27386, name: 'Graphics cards', on: true }, { id: 139971, name: 'Game consoles', on: true }, { id: 112529, name: 'Headphones', on: true },
  { id: 3323, name: 'Camera lenses', on: true }, { id: 31388, name: 'Digital cameras', on: true }, { id: 3247, name: 'Power tools', on: true },
  { id: 171485, name: 'Tablets and eReaders', on: true }, { id: 179697, name: 'Camera drones', on: true }, { id: 183067, name: 'VR headsets', on: true },
  { id: 19006, name: 'LEGO sets', on: true }, { id: 117042, name: 'Game controllers', on: false }, { id: 175672, name: 'Laptops', on: false },
  { id: 178893, name: 'Smart watches', on: false }, { id: 14981, name: 'Audio receivers', on: false }, { id: 48647, name: 'Turntables', on: false }, { id: 33034, name: 'Electric guitars', on: false }
];
export const EPID_MS = 24 * 3600e3;   // a product's price, kept a day

let token = null, tokenUntil = 0, calls = { day: '', n: 0 };
const comps = new Map();             // query|condition -> { sells, asking, n, sample, at }
export const callsToday = () => (calls.day === new Date().toISOString().slice(0, 10) ? calls.n : 0);
const count = () => { const d = new Date().toISOString().slice(0, 10); if (calls.day !== d) calls = { day: d, n: 0 }; calls.n++; };

// Why eBay turned the keys away, in words that say what to do (Nov 13 2026: "they don't work"
// told the owner nothing). An App ID looks like "Name-App-PRD-1a2b3c4d5-6e7f8a9b", a Cert ID like
// "PRD-1a2b3c4d5e6f-...": SBX instead of PRD means the Sandbox set, which never works here.
export function keysProblem(keys, said = '') {
  const app = String(keys.appId || ''), cert = String(keys.certId || '');
  const how = 'On developer.ebay.com, Hi (your name), Application Keys';
  if (/(^|-)SBX-/i.test(app) || /^SBX-/i.test(cert)) return `Those are eBay's Sandbox keys, which only work on eBay's test site. ${how}: copy the App ID and Cert ID from the Production column instead.`;
  if (/^PRD-/i.test(app) && /-PRD-/i.test(cert)) return 'The App ID and Cert ID are in each other\'s boxes. Remove them and paste the App ID (Client ID) first, then the Cert ID (Client Secret).';
  if (/invalid_client|authentication failed/i.test(said)) return `eBay did not accept those keys. A new eBay developer account's Production keys stay switched off until one step is done: ${how}, next to the Production keys, click the Marketplace Account Deletion notice. On that page leave the endpoint and token empty, turn on "Exempted from Marketplace Account Deletion", pick "I do not persist eBay data" (Switchboard only reads public listings and keeps no eBay user data), and Save. If that is already done, copy the Production App ID and Cert ID again and paste them here.`;
  return 'eBay did not accept those keys. Copy the Production App ID and Cert ID again from developer.ebay.com, Application Keys.';
}

async function getToken(keys, fetcher = fetch) {
  if (token && Date.now() < tokenUntil) return token;
  const r = await fetcher(`${API}/identity/v1/oauth2/token`, {
    method: 'POST', signal: AbortSignal.timeout(20000),
    headers: { Authorization: 'Basic ' + Buffer.from(`${keys.appId}:${keys.certId}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=client_credentials&scope=${encodeURIComponent(SCOPE)}`
  });
  if (!r.ok) {
    const said = await r.text().catch(() => '');
    const e = new Error(r.status === 401 || r.status === 400 ? keysProblem(keys, said) : `eBay answered ${r.status}`);
    e.status = r.status; e.transient = r.status >= 500; throw e;
  }
  const j = await r.json();
  token = j.access_token; tokenUntil = Date.now() + (Number(j.expires_in) || 7200) * 1000 - 120e3;
  return token;
}

async function get(keys, path, fetcher = fetch) {
  const t = await getToken(keys, fetcher);
  count();
  const r = await fetcher(`${API}${path}`, { signal: AbortSignal.timeout(20000), headers: { Authorization: `Bearer ${t}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' } });
  if (r.status === 401) { token = null; const e = new Error('eBay sign-in ran out'); e.status = 401; e.transient = true; throw e; }
  if (r.status === 404) return null;
  if (!r.ok) { const e = new Error(r.status === 429 ? 'eBay\'s daily limit for these keys is used up; Flips tries again tomorrow.' : `eBay answered ${r.status}`); e.status = r.status; e.transient = r.status >= 500; throw e; }
  return r.json();
}
const search = async (keys, params, fetcher) => ((await get(keys, `/buy/browse/v1/item_summary/search?${new URLSearchParams({ limit: '50', ...params })}`, fetcher)) || {}).itemSummaries || [];

// One listing as Flips shows it. Auctions carry the current bid as the price.
export function listingFrom(s) {
  const auction = (s.buyingOptions || []).includes('AUCTION') && !(s.buyingOptions || []).includes('FIXED_PRICE');
  const price = Number((auction ? s.currentBidPrice : s.price)?.value ?? s.price?.value) || 0;
  const ship = (s.shippingOptions || []).map((o) => Number(o.shippingCost?.value)).filter((n) => Number.isFinite(n));
  const shipping = ship.length ? Math.min(...ship) : null;
  return {
    id: String(s.itemId || ''), name: String(s.title || ''), price, shipping, total: price + (shipping || 0),
    condition: String(s.condition || ''), url: String(s.itemWebUrl || ''), image: String(s.image?.imageUrl || s.thumbnailImages?.[0]?.imageUrl || ''),
    listedAt: Date.parse(s.itemCreationDate || '') || null, auction, bids: Number(s.bidCount) || 0, endsAt: Date.parse(s.itemEndDate || '') || null,
    seller: s.seller ? { score: Number(s.seller.feedbackScore) || 0, pct: Number(s.seller.feedbackPercentage) || null } : null
  };
}

export const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return !s.length ? null : s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const at = (xs, p) => { const s = [...xs].sort((a, b) => a - b); if (!s.length) return null; const i = (s.length - 1) * p, lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); };

const words = (t) => String(t || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).flatMap((w) => { const m = w.match(/^(\d+)([a-z]+)$/); return m ? [w, m[1], m[2]] : [w]; });
const squash = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]/g, '');
// Is this title the item searched for? Every word of the search is in it (spaces
// and dashes aside, or one of its misspellings), and no other model's word is.
export function sameItem(title, query, alts = {}) {
  const tw = new Set(words(title)), flat = squash(title), qw = words(query);
  const need = String(query || '').toLowerCase().replace(/[()",]/g, ' ').split(/\s+/).map(squash).filter(Boolean);
  if (!need.every((w) => flat.includes(w) || (alts[w] || []).some((a) => flat.includes(squash(a))))) return false;
  return ![...tw].some((w) => VARIANTS.has(w) && !qw.includes(w));
}

// A search made from a long listing title: the words that name the item.
export function searchWords(title, max = 6) {
  const ws = String(title || '').replace(/[|/\\,;:!*()[\]{}"]+/g, ' ').replace(/\s-\s/g, ' ').split(/\s+/).map((w) => w.replace(/^[^a-z0-9]+|[^a-z0-9+]+$/gi, '')).filter(Boolean)
    .filter((w) => !/^\d+(gb|tb|mb)$/i.test(w) && (!NOISE.has(w.toLowerCase()) || /\d/.test(w)));
  return ws.slice(0, max).join(' ');
}

// What `query` sells for, read from the listings of the same item (see the top).
export async function priceFor(keys, query, { condition = 'used', fetcher = fetch } = {}) {
  const key = `${query.toLowerCase()}|${condition}`;
  const c = comps.get(key);
  if (c && Date.now() - c.at < COMPS_MS) return c;
  const cond = condition === 'used' ? USED : CONDITIONS;
  const rows = (await retry(() => search(keys, { q: query, filter: `buyingOptions:{FIXED_PRICE},conditionIds:{${cond}},deliveryOptions:{SHIP_TO_HOME}` }, fetcher)))
    .map(listingFrom).filter((l) => l.total > 0 && !NOT_IT.test(l.name) && sameItem(l.name, query));
  const mid = median(rows.map((l) => l.total));
  const near = rows.filter((l) => l.total >= mid * 0.45 && l.total <= mid * 2.5).sort((a, b) => a.total - b.total);
  const cut = Math.floor(near.length / 10);
  const kept = near.slice(cut, near.length - cut);
  const ok = kept.length >= MIN_COMPS;
  const next = { query, condition, sells: ok ? Math.round(at(kept.map((l) => l.total), SELLS_AT)) : null, asking: ok ? Math.round(median(kept.map((l) => l.total))) : null, n: kept.length,
    sample: kept.slice(0, 5).map((l) => ({ name: l.name, total: l.total, url: l.url })), at: Date.now() };
  comps.set(key, next);
  return next;
}

// One listing judged against what it sells for: a deal leaves the least profit
// worth it (lib/flipmath.js), is the real item, from a seller with some history.
export function judge(l, sells, money = MONEY, { now = Date.now(), within = 24 * 3600e3 } = {}) {
  if (!sells || !(l.total > 0) || NOT_IT.test(l.name)) return null;
  if (!l.auction && l.listedAt && now - l.listedAt > within) return null;
  if (l.seller && l.seller.score < 5) return null;
  const o = { ...money, site: 'ebay', shipIn: l.shipping || 0, shipOut: shipGuess(l.name, money.shipOut) };
  const v = verdict({ sale: sells, price: l.price, ...o });
  if (!v) return null;
  if (l.auction) return v.max > l.price ? { ...l, sells, v, bidTo: v.max } : null;   // still room to bid
  return v.light === 'good' ? { ...l, sells, v } : null;
}

// Every look for the watched words: the newest Buy It Now listings that ship,
// and (when `extra`) the misspelled listings and auctions ending in three hours.
// A great buy: twice the least profit worth it, and at least 40% on what it costs.
export const isHot = (v, money = MONEY) => !!v && v.profit != null && v.profit >= 2 * (money.minProfit ?? MONEY.minProfit) && (v.roi ?? 0) >= 40;

// `pickup` ({ zip, miles }): also, every extra look, listings for pickup only near
// that ZIP. Few buyers will drive, so they go cheap (lib/flips.js reads the ZIP
// from settings).
export async function ebayDeals(keys, list, { maxPrice = null, money = MONEY, extra = false, pickup = null, fetcher = fetch, now = Date.now() } = {}) {
  const out = [], notes = [];
  const price = Number(maxPrice) > 0 ? `,price:[..${Number(maxPrice)}],priceCurrency:USD` : '';
  const base = `conditionIds:{${CONDITIONS}},deliveryOptions:{SHIP_TO_HOME}${price}`;
  for (const word of list) {
    const p = await priceFor(keys, word, { fetcher });
    if (!p.sells) { notes.push({ word, n: p.n, note: `Too few listings of exactly this to know its price (${p.n}). Try a model name, like the ones in the starter list.` }); continue; }
    notes.push({ word, sells: p.sells, asking: p.asking, comps: p.n });
    const add = (rows, how, alts = {}) => {
      for (const l of rows.map(listingFrom)) {
        if (!sameItem(l.name, word, alts) || (how === 'misspelled' && sameItem(l.name, word))) continue;   // spelled right: the plain look has it
        if (how === 'pickup') { l.shipping = 0; l.total = l.price; if (l.auction && !(l.endsAt && l.endsAt - now < 3 * 3600e3)) continue; }
        const d = judge(l, p.sells, money, { now, within: how === 'pickup' ? 3 * 86400e3 : 24 * 3600e3 });
        if (d) out.push({ ...d, word, how, source: 'ebay', hot: isHot(d.v, money) });
      }
    };
    add(await retry(() => search(keys, { q: word, sort: 'newlyListed', filter: `buyingOptions:{FIXED_PRICE},${base}` }, fetcher)), 'new');
    if (!extra) continue;
    for (const m of misspellings(word)) add(await retry(() => search(keys, { q: m.q, sort: 'newlyListed', filter: `buyingOptions:{FIXED_PRICE|AUCTION},${base}` }, fetcher)), 'misspelled', { [m.word]: m.alts });
    const soon = (await retry(() => search(keys, { q: word, sort: 'endingSoonest', filter: `buyingOptions:{AUCTION},${base}` }, fetcher)))
      .filter((s) => { const e = Date.parse(s.itemEndDate || ''); return e && e - now < 3 * 3600e3 && e > now; });
    add(soon, 'ending');
    if (pickup?.zip) {
      const near = `pickupCountry:US,pickupPostalCode:${pickup.zip},pickupRadius:${pickup.miles || 50},pickupRadiusUnit:mi,deliveryOptions:{SELLER_ARRANGED_LOCAL_PICKUP},buyingOptions:{FIXED_PRICE|AUCTION},conditionIds:{${CONDITIONS}}${price}`;
      add(await retry(() => search(keys, { q: word, sort: 'newlyListed', filter: near }, fetcher)), 'pickup');
    }
  }
  const seen = new Set();
  return { deals: out.filter((d) => !seen.has(d.id) && seen.add(d.id)).sort((a, b) => (b.v.profit ?? 0) - (a.v.profit ?? 0)), notes };
}

// What one catalog product sells for: its listings (eBay's product id, so no
// words to match), priced as priceFor does.
export async function priceForEpid(keys, epid, { fetcher = fetch } = {}) {
  const key = `epid:${epid}`;
  const c = comps.get(key);
  if (c && Date.now() - c.at < EPID_MS) return c;
  const rows = (await retry(() => search(keys, { epid: String(epid), filter: `buyingOptions:{FIXED_PRICE},conditionIds:{${USED}},deliveryOptions:{SHIP_TO_HOME}` }, fetcher)))
    .map(listingFrom).filter((l) => l.total > 0 && !NOT_IT.test(l.name));
  const mid = median(rows.map((l) => l.total));
  const near = rows.filter((l) => l.total >= mid * 0.45 && l.total <= mid * 2.5).sort((a, b) => a.total - b.total);
  const cut = Math.floor(near.length / 10);
  const kept = near.slice(cut, near.length - cut);
  const ok = kept.length >= MIN_COMPS;
  const next = { query: kept[0]?.name || '', epid, sells: ok ? Math.round(at(kept.map((l) => l.total), SELLS_AT)) : null, asking: ok ? Math.round(median(kept.map((l) => l.total))) : null, n: kept.length, at: Date.now() };
  comps.set(key, next);
  return next;
}

// The sweep: the newest listings in each category of the buy box, no words
// needed. A listing tied to an eBay catalog product (its epid) is priced by
// that product's other listings; the rest are skipped (no sure way to know
// what they are). Every extra look also the auctions ending within three hours
// and, with a home ZIP, pickup-only listings near it. `budget` caps the product
// prices looked up this round (each is a call; they are kept a day).
export async function sweep(keys, cats, { minPrice = 0, maxPrice = null, money = MONEY, extra = false, pickup = null, budget = 15, fetcher = fetch, now = Date.now() } = {}) {
  const out = [];
  const range = `,price:[${Number(minPrice) > 0 ? Number(minPrice) : 1}..${Number(maxPrice) > 0 ? Number(maxPrice) : ''}],priceCurrency:USD`;
  const cond = `conditionIds:{${CONDITIONS}}`;
  let left = budget;
  const judgeAll = async (rows, how, cat) => {
    for (const l of rows) {
      const s = l.raw;
      if (!s.epid || NOT_IT.test(l.name)) continue;
      const known = comps.get(`epid:${s.epid}`);
      if (!(known && Date.now() - known.at < EPID_MS)) { if (left <= 0) continue; left--; }
      const p = await priceForEpid(keys, s.epid, { fetcher }).catch(() => null);
      if (!p?.sells) continue;
      if (how === 'pickup') { l.shipping = 0; l.total = l.price; if (l.auction && !(l.endsAt && l.endsAt - now < 3 * 3600e3)) continue; }
      const d = judge(l, p.sells, money, { now, within: how === 'pickup' ? 3 * 86400e3 : 24 * 3600e3 });
      if (d) out.push({ ...d, word: cat.name, how, source: 'ebay', hot: isHot(d.v, money) });
    }
  };
  const rowsOf = (list) => list.map((s) => ({ ...listingFrom(s), raw: { epid: s.epid } }));
  for (const cat of cats) {
    const ids = String(cat.id);
    await judgeAll(rowsOf(await retry(() => search(keys, { category_ids: ids, sort: 'newlyListed', limit: '100', filter: `buyingOptions:{FIXED_PRICE},${cond},deliveryOptions:{SHIP_TO_HOME}${range}` }, fetcher))), 'new', cat);
    if (!extra) continue;
    const soon = new Date(now + 3 * 3600e3).toISOString().replace(/\.\d+Z$/, 'Z');
    await judgeAll(rowsOf(await retry(() => search(keys, { category_ids: ids, sort: 'endingSoonest', limit: '100', filter: `buyingOptions:{AUCTION},${cond},deliveryOptions:{SHIP_TO_HOME},itemEndDate:[..${soon}]${range}` }, fetcher))), 'ending', cat);
    if (pickup?.zip) await judgeAll(rowsOf(await retry(() => search(keys, { category_ids: ids, sort: 'newlyListed', limit: '100', filter: `pickupCountry:US,pickupPostalCode:${pickup.zip},pickupRadius:${pickup.miles || 50},pickupRadiusUnit:mi,deliveryOptions:{SELLER_ARRANGED_LOCAL_PICKUP},buyingOptions:{FIXED_PRICE|AUCTION},${cond}${range}` }, fetcher))), 'pickup', cat);
  }
  const seen = new Set();
  return out.filter((d) => !seen.has(d.id) && seen.add(d.id));
}
export const sweepCalls = (cats, extra, pickup = false, budget = 10) => cats.length * (1 + (extra ? 1 + (pickup ? 1 : 0) : 0)) + budget;

// Calls one round of ebayDeals makes (for spacing the looks): one per word, and
// with `extra` its misspellings and the auctions ending soon.
export const roundCalls = (list, extra, pickup = false) => list.reduce((n, w) => n + 1 + (extra ? misspellings(w).length + 1 + (pickup ? 1 : 0) : 0), 0);

// One eBay listing by the number in its link (ebay.com/itm/123…), for the price check.
export async function itemByLink(keys, url, fetcher = fetch) {
  const id = (String(url).match(/\/itm\/(?:[^/]+\/)?(\d{9,15})/) || [])[1];
  if (!id) return null;
  const j = await retry(() => get(keys, `/buy/browse/v1/item/get_item_by_legacy_id?legacy_item_id=${id}`, fetcher));
  return j ? listingFrom({ ...j, itemWebUrl: j.itemWebUrl || url }) : null;
}

// eBay's own sold search for the person to check with (their browser, their eyes).
export const soldLink = (q) => `https://www.ebay.com/sch/i.html?${new URLSearchParams({ _nkw: q, LH_Sold: '1', LH_Complete: '1' })}`;

export const forgetEbay = () => { token = null; tokenUntil = 0; comps.clear(); };
