// Flips' radar for the two auction sites with no public API (lib/flips.js):
// ShopGoodwill and HiBid. Their terms forbid robots on their sites, but each
// emails the matches for a saved search. So the person saves
// their searches there with email alerts on, and Flips reads those emails as
// they arrive (lib/gmail.js mailFrom), pulls out each item (its link, title and
// price), prices it on eBay and keeps the ones that leave a profit. Nothing is
// fetched from the auction sites themselves.
//
// The emails' layouts differ and change, so the reading is general: every link
// to the site whose text names an item, and the first dollar amount after it.
// Not yet tried on a real alert from either site (docs/DECISIONS.md).
import { SITES } from './flipmath.js';

// Each source: who sends the alerts, which links are items, where to save a search.
export const SOURCES = [
  { id: 'shopgoodwill', name: 'ShopGoodwill', site: 'shopgoodwill', from: ['shopgoodwill.com'], item: /shopgoodwill\.com\/item\/\d+/i, setup: 'https://shopgoodwill.com/', how: 'A saved search with email alerts on (My ShopGoodwill, Saved Searches)' },
  { id: 'hibid', name: 'HiBid', site: 'auction', from: ['hibid.com'], item: /hibid\.com\/(lot|catalog)\//i, setup: 'https://hibid.com/', how: 'A saved search near you with email alerts on' }
];
const NAV = /^(unsubscribe|view (all|more|in (your )?browser|online|item|lot|details)|see (all|more)|manage|privacy|terms|help|sign ?in|log ?in|preferences|contact|facebook|twitter|instagram|youtube|download|app store|google play|shop now|bid now|bid|buy now|place bid|click here|here|learn more|my account|saved searches?|edit (this )?search|update|settings|home)\b/i;
const strip = (h) => String(h || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#36;/g, '$').replace(/\s+/g, ' ').trim();

export const sourceOf = (from) => SOURCES.find((s) => s.from.some((d) => String(from || '').toLowerCase().endsWith(d))) || null;

// The items in one alert email: [{ url, name, price }], one per link, first 40.
export function itemsFrom(mail, src = sourceOf(mail.from)) {
  if (!src) return [];
  const html = String(mail.html || '');
  const byUrl = new Map();
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const url = m[1].replace(/&amp;/g, '&');
    // Alert links often go through the site's own click tracker: the item address is inside it, or only its text names the item.
    const real = (() => { try { const u = new URL(url); for (const v of u.searchParams.values()) if (/^https?:/i.test(v) && src.item.test(v)) return v; } catch {} return url; })();
    const isItem = src.item.test(real) || src.item.test((() => { try { return decodeURIComponent(real); } catch { return real; } })());
    const alt = (m[2].match(/\balt\s*=\s*["']([^"']{6,})["']/i) || [])[1];
    const name = strip(m[2]) || strip(alt);
    const after = strip(html.slice(re.lastIndex, re.lastIndex + 1200));
    const price = (after.match(/\$\s?([\d,]+(?:\.\d{2})?)/) || [])[1];
    const key = isItem ? real.replace(/[?#].*$/, '') : real;
    const prev = byUrl.get(key);
    const good = name && name.length >= 6 && name.length <= 200 && !NAV.test(name) && !/^\$?[\d,.]+$/.test(name);
    if (!good && !prev) { if (isItem) byUrl.set(key, { url: real, name: '', price: price ? Number(price.replace(/,/g, '')) : null, item: true }); continue; }
    if (!good) continue;
    if (!prev || !prev.name || name.length > prev.name.length) byUrl.set(key, { url: real, name, price: price ? Number(price.replace(/,/g, '')) : prev?.price ?? null, item: isItem });
  }
  // Item links when there are any; else (every link through a mail tracker) the named links with a price after them.
  const named = [...byUrl.values()].filter((x) => x.name);
  const items = named.some((x) => x.item) ? named.filter((x) => x.item) : named.filter((x) => x.price != null);
  return items.slice(0, 40)
    .map((x) => ({ url: x.url, name: x.name, price: x.price, source: src.id, sourceName: src.name, site: src.site, siteLabel: SITES[src.site]?.label }));
}
