// Flips' money math (lib/flips.js, the page's price check): what an item would
// leave you after selling it on eBay, and the most to pay for it.
//
// Selling: eBay's final value fee for most categories is 13.6% of what the buyer
// pays, sales tax included (about 7% on average, so the fee works out near 14.6%
// of the price), plus $0.40 an order ($0.30 at $10 or less). Flips assumes free
// shipping to the buyer, so the label (shipping out) comes off the price too.
// Buying: the price, plus the site's buyer's premium, sales tax and shipping in.
// A buy is good when it leaves at least the least profit worth it AND at least a
// fifth of what was paid (a $30 profit on $900 ties up money for too little).
// Nothing here is a promise: the sale price is an estimate (see lib/ebay.js).
export const FEE = { rate: 0.136, taxOn: 0.07, perOrder: 0.40, small: 0.30 };
export const MIN_ROI = 0.2;
export const MONEY = { minProfit: 25, shipOut: 15, taxPct: 8 };

// Where it is bought: what that adds to the price. Premiums and shipping vary by
// listing; these are the usual, and the page lets each be changed.
export const SITES = {
  ebay: { label: 'eBay', shipIn: null, premium: 0, tax: true },
  shopgoodwill: { label: 'ShopGoodwill', shipIn: 20, premium: 0, tax: true, note: 'ShopGoodwill sets shipping at checkout; about $20 for a small box.' },
  propertyroom: { label: 'PropertyRoom', shipIn: 20, premium: 0, tax: true, note: 'Shipping shows at checkout; about $20 for a small box.' },
  auction: { label: 'Local auction', shipIn: 0, premium: 15, tax: true, note: 'HiBid, GovDeals and other auction houses add a buyer\'s premium, often 10 to 18%: check the auction\'s terms.' },
  store: { label: 'Store or open box', shipIn: 0, premium: 0, tax: true },
  cash: { label: 'Cash, in person', shipIn: 0, premium: 0, tax: false }
};
const HOSTS = [[/(^|\.)ebay\.[a-z.]+$/, 'ebay'], [/shopgoodwill\.com$/, 'shopgoodwill'], [/propertyroom\.com$/, 'propertyroom'], [/(hibid|govdeals|publicsurplus|municibid|proxibid|bidspotter|allsurplus|gsaauctions)\.(com|gov)$/, 'auction'], [/(bestbuy|amazon|walmart|target|homedepot|lowes|woot|newegg)\.com$/, 'store'], [/(facebook|craigslist|offerup|mercari)\.(com|org)$/, 'cash']];
export function siteOf(url) {
  let host = '';
  try { host = new URL(String(url)).hostname.toLowerCase(); } catch { return null; }
  return (HOSTS.find(([re]) => re.test(host)) || [])[1] || null;
}

// About what a label costs, by what the thing is (a padded box, ground service).
const SHIP_GUESS = [[/\b(laptop|notebook|monitor|console|ps5|ps4|xbox|printer|receiver|amplifier|turntable)\b/i, 22], [/\b(gpu|graphics card|rtx|gtx|radeon|drill|driver|saw|grinder|sander|tool|blender|mixer)\b/i, 15],
  [/\b(lens|camera|headphones?|speaker|switch|steam deck|controller|router|tablet|ipad|kindle|watch|garmin)\b/i, 12], [/\b(calculator|game|cartridge|card|cable|phone|airpods|earbuds|ram|ssd|cpu)\b/i, 8]];
export const shipGuess = (name, fallback = MONEY.shipOut) => (SHIP_GUESS.find(([re]) => re.test(String(name || ''))) || [])[1] ?? fallback;

const round2 = (n) => Math.round(n * 100) / 100;
export const fee = (sale) => sale > 0 ? round2(sale * (1 + FEE.taxOn) * FEE.rate + (sale <= 10 ? FEE.small : FEE.perOrder)) : 0;
// What selling at `sale` (free shipping) leaves, after eBay's fee and the label.
export const keep = (sale, shipOut = MONEY.shipOut) => round2(sale - fee(sale) - shipOut);

// What buying at `price` costs in all on a given site.
export function cost(price, { site = 'ebay', shipIn, premium, taxPct = MONEY.taxPct } = {}) {
  const s = SITES[site] || SITES.ebay;
  const prem = premium ?? s.premium, ship = shipIn ?? s.shipIn ?? 0, tax = s.tax ? taxPct : 0;
  return round2(price * (1 + prem / 100) * (1 + tax / 100) + ship);
}
// The most to pay (the bid or price itself) on that site and still make it worth it.
export function maxPrice(sale, o = {}) {
  const k = keep(sale, o.shipOut ?? MONEY.shipOut);
  const allIn = Math.min(k - (o.minProfit ?? MONEY.minProfit), k / (1 + MIN_ROI));   // the most it may cost in all
  const s = SITES[o.site] || SITES.ebay;
  const prem = o.premium ?? s.premium, ship = o.shipIn ?? s.shipIn ?? 0, tax = s.tax ? (o.taxPct ?? MONEY.taxPct) : 0;
  return Math.max(0, Math.floor((allIn - ship) / ((1 + prem / 100) * (1 + tax / 100))));
}

// The green light: good (worth it), thin (some profit, not enough) or bad (a loss).
export function verdict({ sale, price, ...o }) {
  if (!(sale > 0)) return null;
  const minProfit = o.minProfit ?? MONEY.minProfit, shipOut = o.shipOut ?? MONEY.shipOut;
  const paid = price > 0 ? cost(price, o) : null;
  const left = keep(sale, shipOut);
  const profit = paid == null ? null : round2(left - paid);
  const light = profit == null ? null : profit >= minProfit && profit >= paid * MIN_ROI ? 'good' : profit > 0 ? 'thin' : 'bad';
  return { sale: round2(sale), fee: fee(sale), shipOut, keep: left, cost: paid, profit, roi: paid ? Math.round((profit / paid) * 100) : null, max: maxPrice(sale, { ...o, minProfit, shipOut }), light, minProfit };
}
