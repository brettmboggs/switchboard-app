// Deliveries: packages on their way, read from shipping emails already in the
// mail cache (Gmail and any IMAP account). Nothing to sign in to.
//
// Each email says one thing about one package: shipped, out for delivery,
// delivered, delayed, ready for pickup. Emails about the same package (same
// tracking number, or order number, or the same shop within a few days) are
// merged, and the latest news wins. Rebuilt from the mail table after every mail
// check, so there is no table of its own; dismissing one is a synced "cleared" key.
import { db, isCleared } from './db.js';
import { parseWhen } from './capture.js';

// ---- which emails, and what they say
const CARRIERS = [
  ['UPS', /(^|[.@])ups\.com$/i, (t) => `https://www.ups.com/track?tracknum=${t}`],
  ['FedEx', /(^|[.@])fedex\.com$/i, (t) => `https://www.fedex.com/fedextrack/?trknbr=${t}`],
  ['USPS', /(^|[.@])usps\.(com|gov)$/i, (t) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${t}`],
  ['DHL', /(^|[.@])dhl\.(com|de)$/i, (t) => `https://www.dhl.com/us-en/home/tracking.html?tracking-id=${t}`],
  ['Amazon', /(^|[.@])amazon\.(com|ca|co\.uk)$/i, null]
];
const TRACKING = [
  ['UPS', /\b(1Z[0-9A-Z]{16})\b/],
  ['USPS', /\b(9[1-5]\d{18,24})\b/],
  ['Amazon', /\b(TBA\d{12})\b/],
  ['FedEx', /\b(\d{12}|\d{15})\b/]
];
// Package words: without one of these (or a carrier sending it), it is not about a package.
const PACKAGE = /\b(order|package|parcel|shipment|shipped|delivery|delivered|autoship|pick ?up|tracking|item)s?\b/i;
const NOT_PACKAGES = /(github\.com|informeddelivery|linkedin|indeed|applicant|newsletter)/i;

const STATUS = [
  ['delayed', /\b(delay(ed)?|running late|exception|unable to deliver|delivery attempt(ed)?|missed delivery|held at|returned to sender|could ?n[o']t be delivered)\b/i],
  ['delivered', /\b(was|been|is|has been|have been|got)\s+delivered\b|^delivered\b|\bdelivered:|\bdelivery (is )?complete\b/i],
  ['pickup', /\bready for (pick ?up|collection)\b/i],
  ['out', /\bout for delivery\b|\b(arriv(e|es|ing)|delivered|delivery|be there)\s+today\b/i],
  ['shipped', /\b(has |have |was )?shipped\b|\bon (its|the|their) way\b|\bin transit\b|\bscheduled for delivery\b|\bwill (arrive|be delivered)\b|\barriving\b|\bdispatched\b|\bshipment\b.*\b(created|label)\b/i]
];
const ORDER = /\border\s*(?:#|no\.?|number)?\s*:?\s*#?\s*((?=[A-Z-]*\d)[A-Z0-9][A-Z0-9-]{5,24})\b|(?:^|\s)#([0-9][0-9-]{5,24})\b|\s-\s([A-Z]{2,6}\d{6,})\s*$/i;

const shopName = (name, addr) => {
  const n = String(name || '').replace(/["']/g, '').replace(/\.(com|net|co)\b/i, '').replace(/\s*(customer )?(service|support|orders?|team|notifications?|shipping|updates?)\s*$/i, '').trim();
  if (n && !/@/.test(n)) return n.slice(0, 40);
  const d = String(addr || '').split('@')[1] || '';
  const base = d.split('.').slice(-2, -1)[0] || d;
  return base ? base[0].toUpperCase() + base.slice(1) : 'A shop';
};

// One email. Returns null when it is not about a package.
export function readShipment({ subject = '', from_addr = '', from_name = '', snippet = '', date = Date.now() }) {
  const addr = String(from_addr).toLowerCase();
  if (NOT_PACKAGES.test(addr)) return null;
  const carrier = CARRIERS.find(([, re]) => re.test(addr.split('@')[1] || ''));
  const head = String(subject).replace(/\s+/g, ' ').trim();
  const body = String(snippet || '').replace(/\s+/g, ' ').slice(0, 600);
  if (!carrier && !PACKAGE.test(head)) return null;
  // Order confirmations and receipts are not news about a package.
  if (/\b(confirm(ed|ation)?|thank(s| you) for (your )?(order|purchase)|received your order|order received|review your)\b/i.test(head)) return null;
  // The subject decides; the body only when the subject says nothing either way.
  const status = (STATUS.find(([, re]) => re.test(head)) || (PACKAGE.test(head) ? STATUS.find(([, re]) => re.test(body)) : null) || [])[0];
  if (!status) return null;
  const text = head + ' \n ' + body;

  let tracking = null, via = carrier?.[0] || null;
  for (const [name, re] of TRACKING) {
    const m = text.match(re);
    if (m && (name !== 'FedEx' || via === 'FedEx' || /fedex/i.test(text))) { tracking = m[1]; via = via || name; break; }
  }
  const om = head.match(ORDER) || body.match(ORDER);
  const order = om ? (om[1] || om[2] || om[3]) : null;

  // When: today for "out for delivery", else the first date said after arriving / delivery / expected.
  let eta = null;
  const day0 = new Date(date);
  if (status === 'out') eta = new Date(day0).setHours(12, 0, 0, 0);
  else if (status === 'shipped' || status === 'delayed') {
    const m = text.match(/\b(?:arriv(?:e|es|ing)|deliver(?:y|ed)?|expected|estimated(?: delivery)?|scheduled for delivery|by)\b[^.\n]{0,40}/i);
    const w = m && parseWhen(m[0].replace(/^\S+/, ''), day0);
    if (w && w.at > date - 86400e3 && w.at < date + 30 * 86400e3) eta = w.at;
  }
  const win = text.match(/\bbetween\s+(\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?)\s+and\s+(\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?)/i);
  // Amazon says what is in it: 'Shipped: "Item name..."'.
  const item = (head.match(/^(?:shipped|delivered|arriving[^:]*|out for delivery):\s*"?([^"]{3,80})/i) || [])[1] || null;

  return {
    status, eta, window: win ? `${win[1].replace(/\./g, '')}–${win[2].replace(/\./g, '')}` : null,
    tracking, carrier: via, order, item: item ? item.replace(/\.{3}$|…$/, '').trim() : null,
    shop: carrier && carrier[0] !== 'Amazon' ? null : shopName(from_name, addr), domain: addr.split('@')[1] || '', at: date
  };
}

// ---- many emails into packages
// Top first: what needs you, what comes today, what waits for you, what is coming, what came.
const ORDER_SHOWN = { delayed: 0, out: 1, pickup: 2, shipped: 3, delivered: 4 };
export function trackUrl(s) {
  if (!s.tracking) return null;
  const c = CARRIERS.find(([n]) => n === s.carrier);
  return c?.[2] ? c[2](encodeURIComponent(s.tracking)) : null;
}

// rows: mail rows (oldest first is not needed; they are sorted here).
export function buildShipments(rows, now = Date.now()) {
  const list = [];
  for (const r of [...rows].sort((a, b) => a.date - b.date)) {
    const s = readShipment(r);
    if (!s) continue;
    const ref = { account: r.account, thread: r.thread_id, msg: r.msg_id };
    s.space = r.space || 'personal';
    // The same package: same tracking or order number; else the same shop, still open, within ten days.
    const same = list.find((p) => (s.tracking && p.tracking === s.tracking) || (s.order && p.order === s.order))
      || (!s.tracking && !s.order ? list.find((p) => p.domain === s.domain && p.status !== 'delivered' && s.at - p.last < 10 * 86400e3) : null);
    if (!same) { list.push({ ...s, key: s.tracking || s.order || `${s.domain}:${r.msg_id}`, first: s.at, last: s.at, mail: ref }); continue; }
    // Later news wins, except that nothing un-delivers a package.
    if (same.status !== 'delivered' || s.status === 'delivered') {
      if (s.status === 'delivered' || s.at >= same.last) { same.status = s.status; same.mail = ref; same.space = s.space; }
    }
    if (s.status === 'delivered') same.deliveredAt = s.at;
    same.last = Math.max(same.last, s.at);
    for (const k of ['tracking', 'order', 'item', 'shop', 'window']) if (!same[k] && s[k]) same[k] = s[k];
    if (s.carrier && !same.carrier) same.carrier = s.carrier;
    if (s.eta) same.eta = s.eta;
    if (s.status === 'out') same.eta = s.eta;
  }
  // A shop's emails and the courier's about the same box arrive minutes apart
  // (a pet shop and FedEx, say): one package, named for the shop, tracked by the courier.
  for (const c of list.filter((p) => !p.shop && p.tracking)) {
    const shop = list.find((q) => q !== c && q.shop && !q.tracking && !q.merged && q.status === c.status && ['out', 'delivered'].includes(q.status) && Math.abs(q.last - c.last) < 3600e3);
    if (!shop) continue;
    Object.assign(shop, { tracking: c.tracking, carrier: c.carrier, eta: shop.eta || c.eta, deliveredAt: shop.deliveredAt || c.deliveredAt });
    c.merged = true;
  }
  for (let i = list.length - 1; i >= 0; i--) if (list[i].merged) list.splice(i, 1);
  for (const p of list) {
    if (p.status === 'delivered' && !p.deliveredAt) p.deliveredAt = p.last;
    p.url = trackUrl(p);
    p.name = p.item || p.shop || p.carrier || 'A package';
    p.from = p.item ? (p.shop || p.carrier) : (p.shop && p.carrier && p.shop !== p.carrier ? p.carrier : null);
  }
  const startOfDay = new Date(now).setHours(0, 0, 0, 0);
  // What is worth showing: delivered today; ready for pickup in the last three
  // days (nothing says it was picked up); on its way, unless it went quiet
  // (expected two days ago, or ten days without news).
  return list.filter((p) => p.status === 'delivered' ? p.deliveredAt >= startOfDay
    : p.status === 'pickup' ? now - p.last < 3 * 86400e3
    : p.eta ? p.eta >= startOfDay - 2 * 86400e3
    : now - p.last < 10 * 86400e3)
    .sort((a, b) => ORDER_SHOWN[a.status] - ORDER_SHOWN[b.status] || (a.eta || 9e15) - (b.eta || 9e15) || b.last - a.last);
}

// ---- for the board
let current = [], announced = null;
// Cleared ones come back if there is news after clearing (delayed, then delivered).
export const deliveries = () => current.filter((p) => !isCleared('ship:' + p.key, p.last));
// After each mail check. Returns news worth an alert (only things that changed since the last look).
export function refreshDeliveries(now = Date.now()) {
  const rows = db.prepare('SELECT account, msg_id, thread_id, from_name, from_addr, subject, snippet, date, kind, space FROM mail WHERE from_me = 0 AND date > ?').all(now - 15 * 86400e3);
  // Mail read before Deliveries existed: file its shipping news as such (out of Inbox and Money).
  const refile = db.prepare("UPDATE mail SET kind = 'ship', bulk = 1 WHERE account = ? AND msg_id = ?");
  for (const r of rows) if ((r.kind === 'mail' || r.kind === 'receipt') && readShipment(r)) refile.run(r.account, r.msg_id);
  const next = buildShipments(rows, now);
  const news = [];
  if (announced) for (const p of next) {
    const was = announced.get(p.key);
    if (was !== p.status && ['out', 'delivered', 'delayed', 'pickup'].includes(p.status) && now - p.last < 3 * 3600e3) news.push(p);
  }
  announced = new Map(next.map((p) => [p.key, p.status]));
  const changed = JSON.stringify(next) !== JSON.stringify(current);
  current = next;
  return { changed, news };
}
