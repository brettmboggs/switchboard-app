// Recurring costs: rent, hosting, subscriptions, insurance. Each is a bill
// item (kind 'bill': amount, cadence, next date, project), so Ctrl K's
// "bill Google Workspace 14 monthly on 6" makes one too. This file adds them
// from a form, edits them, totals them per month, and spots charges in the
// email that come back like a subscription, so they can be added in a click.
// No bank connection: the charges are the alert and receipt emails already read.
import { db, getSetting, setSetting, onLocalChange } from './db.js';
import { spaces } from './spaces.js';

export const CADENCES = ['weekly', 'monthly', 'quarterly', 'yearly'];
// What one charge comes to per month.
export const perMonth = (amount, cadence) => (Number(amount) || 0) * ({ weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 }[cadence] ?? 1);

function clean(f, { partial = false } = {}) {
  const out = {};
  if (!partial || f.text !== undefined) {
    const text = String(f.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!text) throw new Error('Give it a name.');
    out.text = text;
  }
  if (!partial || f.amount !== undefined) {
    const amount = Math.round(parseFloat(String(f.amount ?? '').replace(/[$,\s]/g, '')) * 100) / 100;
    if (!Number.isFinite(amount) || amount < 0 || amount > 1e7) throw new Error('Put in the amount, like 14 or 1,200.');
    out.amount = amount;
  }
  if (!partial || f.cadence !== undefined) {
    if (!CADENCES.includes(f.cadence)) throw new Error('Pick how often.');
    out.cadence = f.cadence;
  }
  if (!partial || f.due_at !== undefined) {
    const at = f.due_at == null || f.due_at === '' ? null : Number(f.due_at);
    if (at != null && !Number.isFinite(at)) throw new Error('That date is not right.');
    out.due_at = at;
  }
  if (!partial || f.space !== undefined) {
    out.space = spaces().some((s) => s.id === f.space) ? f.space : 'personal';
  }
  return out;
}

export function addCost(f, now = Date.now()) {
  const c = clean(f);
  const r = db.prepare("INSERT INTO items (kind, text, space, due_at, amount, cadence, created_at) VALUES ('bill', ?, ?, ?, ?, ?, ?)")
    .run(c.text, c.space, c.due_at, c.amount, c.cadence, now);
  onLocalChange();
  return Number(r.lastInsertRowid);
}

export function editCost(id, f) {
  const c = clean(f, { partial: true });
  const cur = db.prepare("SELECT text, amount, cadence, due_at, space FROM items WHERE id = ? AND kind = 'bill'").get(id);
  if (!cur) throw new Error('That cost is gone.');
  const n = { ...cur, ...c };
  db.prepare('UPDATE items SET text = ?, amount = ?, cadence = ?, due_at = ?, space = ? WHERE id = ?').run(n.text, n.amount, n.cadence, n.due_at, n.space, id);
  onLocalChange();
}

// ---- spotting them in the mail
// A merchant whose charges or receipts land in two or more different months at
// about the same amount (within 15%) looks like a subscription; one about a
// year apart looks yearly. Already added (the name matches a cost) or waved
// away ("Not recurring") is left out.
const norm = (s) => String(s || '').toLowerCase().replace(/\b(inc|llc|ltd|co|corp|com|the)\b|[^a-z0-9]+/g, ' ').trim();
export function notRecurring() { return getSetting('notRecurring', []); }
export function markNotRecurring(name) {
  const n = norm(name); if (!n) return;
  setSetting('notRecurring', [...new Set([...notRecurring(), n])].slice(-500));
}

export function recurringGuesses(now = Date.now()) {
  const rows = db.prepare(`SELECT merchant, from_name, from_addr, amount, date, space FROM mail
    WHERE kind IN ('charge', 'receipt') AND from_me = 0 AND amount IS NOT NULL AND amount > 0 AND date > ? ORDER BY date DESC LIMIT 1500`).all(now - 400 * 86400e3);
  const have = db.prepare("SELECT text FROM items WHERE kind = 'bill'").all().map((b) => norm(b.text));
  const no = new Set(notRecurring());
  const by = new Map();
  for (const r of rows) {
    const name = (r.merchant || r.from_name || r.from_addr || '').trim();
    const k = norm(name); if (!k) continue;
    if (!by.has(k)) by.set(k, { name, list: [] });
    by.get(k).list.push(r);
  }
  const out = [];
  for (const [k, { name, list }] of by) {
    if (no.has(k) || have.some((h) => h && (h.includes(k) || k.includes(h)))) continue;
    const last = list[0];
    // The charges near the latest one's amount, one per month.
    const near = list.filter((r) => Math.abs(r.amount - last.amount) <= Math.max(1, last.amount * 0.15));
    const months = [...new Set(near.map((r) => new Date(r.date).toISOString().slice(0, 7)))];
    if (months.length < 2) continue;
    const gaps = near.slice(0, -1).map((r, i) => (r.date - near[i + 1].date) / 86400e3).filter((d) => d > 5);
    const gap = gaps.length ? gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 30;
    const cadence = gap > 300 ? 'yearly' : gap > 75 ? 'quarterly' : gap < 10 ? 'weekly' : 'monthly';
    const spaceCount = {}; for (const r of near) spaceCount[r.space || 'personal'] = (spaceCount[r.space || 'personal'] || 0) + 1;
    const space = Object.entries(spaceCount).sort((a, b) => b[1] - a[1])[0][0];
    out.push({ key: k, name: name.slice(0, 80), amount: last.amount, cadence, times: near.length, last: last.date, space });
  }
  return out.sort((a, b) => b.last - a.last).slice(0, 12);
}
