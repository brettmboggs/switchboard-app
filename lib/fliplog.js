// The flip log (Money, Flip log): each thing bought to resell, from bought to
// listed to sold, with what it made after eBay's fee and the label
// (lib/flipmath.js), and how long the money sat in it. Kept in settings
// ('fliplog'), on this computer only.
import { getSetting, setSetting } from './db.js';
import { fee } from './flipmath.js';

const MAX = 1000;
const STATUS = ['bought', 'listed', 'sold'];
const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100) / 100);
const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
const local = (t = Date.now()) => new Date(t).toLocaleDateString('en-CA');   // YYYY-MM-DD on this computer's clock
const today = () => local();

export const entries = () => getSetting('fliplog', []);

// One entry with its numbers worked out: the fee (unless typed), the profit, the days held.
export function figured(e, now = Date.now()) {
  const feeNow = e.fees ?? (e.soldFor ? fee(e.soldFor) : null);
  const profit = e.status === 'sold' && e.soldFor != null ? Math.round((e.soldFor - (feeNow || 0) - (e.shipOut || 0) - (e.cost || 0)) * 100) / 100 : null;
  const end = e.status === 'sold' && e.soldAt ? Date.parse(e.soldAt) : now;
  const days = e.boughtAt ? Math.max(0, Math.round((end - Date.parse(e.boughtAt)) / 86400e3)) : null;
  return { ...e, fee: feeNow, profit, days };
}

// Adds an entry (no id) or changes one (its id); sends back the whole log.
export function saveEntry(body = {}) {
  const list = entries();
  const at = body.id ? list.findIndex((e) => e.id === body.id) : -1;
  if (body.id && at < 0) throw Object.assign(new Error('That flip is not in the log any more.'), { status: 404 });
  const e = at >= 0 ? { ...list[at] } : { id: 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), status: 'bought', boughtAt: today() };
  if ('name' in body) e.name = String(body.name || '').trim().slice(0, 200);
  if (!e.name) throw Object.assign(new Error('Give the flip a name: what it is.'), { status: 400 });
  for (const k of ['cost', 'listPrice', 'soldFor', 'shipOut', 'fees', 'sells']) if (k in body) e[k] = num(body[k]);
  for (const k of ['boughtAt', 'soldAt']) if (k in body) e[k] = day(body[k]);
  if ('where' in body) e.where = String(body.where || '').trim().slice(0, 60);
  if ('url' in body) e.url = /^https?:\/\//i.test(String(body.url || '')) ? String(body.url).slice(0, 500) : '';
  if ('status' in body && STATUS.includes(body.status)) e.status = body.status;
  if (e.status === 'sold' && !e.soldAt) e.soldAt = today();
  if (e.status !== 'sold') { e.soldAt = null; }
  if (at >= 0) list[at] = e; else list.unshift(e);
  setSetting('fliplog', list.slice(0, MAX));
  return fliplog();
}

export function removeEntry(id) {
  setSetting('fliplog', entries().filter((e) => e.id !== id));
  return fliplog();
}

// The log as the page shows it, with its totals: money in what is not sold yet,
// profit this month and in all, and the usual days from bought to sold.
export function fliplog(now = Date.now()) {
  const list = entries().map((e) => figured(e, now));
  const sold = list.filter((e) => e.status === 'sold' && e.profit != null);
  const month = local(now).slice(0, 7);
  const sum = (xs) => Math.round(xs.reduce((n, x) => n + x, 0) * 100) / 100;
  const ds = sold.map((e) => e.days).filter((d) => d != null).sort((a, b) => a - b);
  return {
    entries: list,
    totals: { tiedUp: sum(list.filter((e) => e.status !== 'sold').map((e) => e.cost || 0)), open: list.filter((e) => e.status !== 'sold').length,
      profit: sum(sold.map((e) => e.profit)), month: sum(sold.filter((e) => (e.soldAt || '').startsWith(month)).map((e) => e.profit)), sold: sold.length,
      days: ds.length ? ds[ds.length >> 1] : null }
  };
}
