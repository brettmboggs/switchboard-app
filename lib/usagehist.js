// AI plan history, for the AI plans page (public/js/usagepage.js): every past
// window (where it ended, whether it ran out), when in the week the plan gets
// used, how fast, and which sessions made the big jumps. lib/usage.js keeps the
// raw readings for 35 days; each window's summary is kept here for good, so the
// past windows outlive them. A reading posted by a Claude Code session's status
// line carries that session's id, so a jump in the limit is put down to the
// session that saw it (roughly: two sessions at once share the blame unevenly).
import { basename } from 'node:path';
import { db } from './db.js';

const H = 3600e3, D = 24 * H;
const NAMES = { claude: 'Claude', codex: 'Codex' };

// The raw readings (lib/usage.js writes them; made here as this file loads first).
db.exec(`CREATE TABLE IF NOT EXISTS usage_samples (
  provider TEXT NOT NULL, win TEXT NOT NULL, at INTEGER NOT NULL,
  pct REAL NOT NULL, resets_at INTEGER NOT NULL, len INTEGER NOT NULL,
  PRIMARY KEY (provider, win, at)
)`);
db.exec(`CREATE TABLE IF NOT EXISTS usage_windows (
  provider TEXT NOT NULL, win TEXT NOT NULL, resets_at INTEGER NOT NULL, len INTEGER NOT NULL,
  peak REAL NOT NULL, out_at INTEGER, first_at INTEGER NOT NULL, last_at INTEGER NOT NULL,
  PRIMARY KEY (provider, win, resets_at)
)`);
try { db.exec('ALTER TABLE usage_samples ADD COLUMN sid TEXT'); } catch {}   // already there

// One reading's mark on its window's summary. Called by noteUsage for every reading kept.
export function noteWindow(provider, win, resetsAt, len, pct, at) {
  db.prepare(`INSERT INTO usage_windows (provider, win, resets_at, len, peak, out_at, first_at, last_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (provider, win, resets_at) DO UPDATE SET peak = max(peak, excluded.peak), out_at = coalesce(out_at, excluded.out_at),
    first_at = min(first_at, excluded.first_at), last_at = max(last_at, excluded.last_at)`)
    .run(provider, win, resetsAt, len, pct, pct >= 100 ? at : null, at, at);
}
// The readings from before summaries were kept become summaries once.
if (!db.prepare('SELECT 1 FROM usage_windows LIMIT 1').get()) {
  for (const s of db.prepare('SELECT * FROM usage_samples ORDER BY at').all()) noteWindow(s.provider, s.win, s.resets_at, s.len, s.pct, s.at);
}

// The window the habits are measured on: the longest one (the weekly), as it sees all use.
function mainWindow(provider) {
  return db.prepare('SELECT win, len FROM usage_windows WHERE provider = ? ORDER BY len DESC, last_at DESC LIMIT 1').get(provider);
}

// What was used between readings: each rise inside one window, as [from, to, pct, sid].
function steps(rows) {
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    if (a.resets_at !== b.resets_at) { if (b.at - (b.resets_at - b.len) < 2 * H && b.pct > 0) out.push([Math.max(a.at, b.resets_at - b.len), b.at, b.pct, b.sid]); continue; }
    if (b.pct > a.pct) out.push([a.at, b.at, b.pct - a.pct, b.sid]);
  }
  return out;
}
// A rise spread evenly over the hours it happened in. Readings come while a
// session runs, so after a long quiet gap the rise goes in the hour before the
// reading rather than across the night.
function spread(step, add) {
  const [, to, pct] = step;
  const from = to - step[0] > 2 * H ? to - H : step[0];
  if (to - from <= 0) { add(to, pct); return; }
  for (let t = from; t < to;) {
    const end = Math.min(to, Math.floor(t / H) * H + H);
    add(t, pct * (end - t) / (to - from));
    t = end;
  }
}

// What the page shows for one plan.
export function usageHistory(provider, now = Date.now(), opts = {}) {
  const providers = db.prepare('SELECT provider, max(last_at) at FROM usage_windows GROUP BY provider ORDER BY at DESC').all()
    .map((p) => ({ id: p.provider, name: NAMES[p.provider] || p.provider }));
  if (!provider || !providers.some((p) => p.id === provider)) provider = providers[0]?.id;
  if (!provider) return { providers, provider: null };
  const main = mainWindow(provider);
  const rows = db.prepare('SELECT at, pct, resets_at, len, sid FROM usage_samples WHERE provider = ? AND win = ? ORDER BY at').all(provider, main.win);
  const st = steps(rows);
  const since = rows.length ? rows[0].at : now;

  // When: 7 days by 24 hours, the average used in that hour of that weekday.
  const heat = Array.from({ length: 7 }, () => Array(24).fill(0));
  const byDay = new Map(), byHour = new Map();
  for (const s of st) spread(s, (t, p) => {
    const d = new Date(t);
    heat[d.getDay()][d.getHours()] += p;
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    byDay.set(day, (byDay.get(day) || 0) + p);
    const hr = Math.floor(t / H) * H; byHour.set(hr, (byHour.get(hr) || 0) + p);
  });
  const weeks = Math.max(1, (now - since) / (7 * D));
  for (const r of heat) for (let h = 0; h < 24; h++) r[h] = Math.round((r[h] / Math.ceil(weeks)) * 100) / 100;

  // The last four weeks, day by day (0 for a day with readings and no use; null before readings began).
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const daily = [];
  for (let i = 27; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const t = d.getTime();
    daily.push([t, t + D <= since ? null : Math.round((byDay.get(t) || 0) * 10) / 10]);
  }

  // Habits.
  const active = [...byHour.values()].filter((p) => p >= 0.2);
  const dayTotals = [0, 1, 2, 3, 4, 5, 6].map((w) => heat[w].reduce((a, b) => a + b, 0));
  const hourTotals = Array.from({ length: 24 }, (_, h) => heat.reduce((a, r) => a + r[h], 0));
  const used = daily.filter((d) => d[1] != null);
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  // Past windows of each kind: the last 12 weeks, the last 30 short ones.
  const pastQ = db.prepare('SELECT win, resets_at, len, peak, out_at, first_at FROM usage_windows WHERE provider = ? AND win = ? AND resets_at <= ? ORDER BY resets_at DESC LIMIT ?');
  const kinds = db.prepare('SELECT win, max(len) len FROM usage_windows WHERE provider = ? GROUP BY win').all(provider);
  const past = {};
  for (const k of kinds) past[k.win] = pastQ.all(provider, k.win, now, k.len > D ? 12 : 30).reverse();
  const pastMain = past[main.win] || [];
  const allPast = Object.values(past).flat();
  const habits = {
    since,
    perActiveHour: active.length ? Math.round((sum(active) / active.length) * 10) / 10 : null,   // % of the weekly an hour of real use takes
    activeHours: used.length ? Math.round((active.length / Math.max(1, (now - since) / D)) * 10) / 10 : null,   // such hours a day, on average
    perDay: used.length ? Math.round((sum(used.map((d) => d[1])) / used.length) * 10) / 10 : null,
    busiestDay: sum(dayTotals) ? dayTotals.indexOf(Math.max(...dayTotals)) : null,
    peakHour: sum(hourTotals) ? hourTotals.indexOf(Math.max(...hourTotals)) : null,
    avgEnd: pastMain.length ? Math.round(sum(pastMain.map((w) => w.peak)) / pastMain.length) : null,
    ranOut: allPast.filter((w) => w.out_at).length,
    windows: allPast.length,
  };

  // Last window at this point: where the one before stood at the same elapsed share.
  const cur = rows.length ? rows[rows.length - 1] : null;
  if (cur && cur.resets_at > now) {
    const elapsed = now - (cur.resets_at - cur.len);
    const prev = rows.filter((r) => r.resets_at < cur.resets_at && r.resets_at > cur.resets_at - cur.len - H && r.at <= r.resets_at - r.len + elapsed).pop();
    if (prev) habits.lastAtThisPoint = Math.round(prev.pct);
  }

  // Sessions that moved the needle: in this window, the biggest five.
  const start = cur && cur.resets_at > now ? cur.resets_at - cur.len : now - 7 * D;
  const bySid = new Map();
  for (const s of st) if (s[3] && s[1] > start) bySid.set(s[3], (bySid.get(s[3]) || 0) + s[2]);
  const look = db.prepare('SELECT id, cwd, space, prompt FROM sessions WHERE id = ?');
  const sessions = [...bySid].sort((a, b) => b[1] - a[1]).slice(0, 5).filter(([, p]) => p >= 0.5).map(([sid, p]) => {
    let s = null; try { s = look.get(sid); } catch {}
    return { id: sid, used: Math.round(p * 10) / 10, folder: s?.cwd ? basename(s.cwd) : null, space: s?.space || null, prompt: s?.prompt ? String(s.prompt).slice(0, 120) : null };
  });
  const attributed = Math.round(sum(sessions.map((s) => s.used)));

  // Every reading of each current window, for the big chart (up to 400 points),
  // and the window before it moved onto this one's dates (the faint line).
  const read = db.prepare('SELECT at, pct FROM usage_samples WHERE provider = ? AND win = ? AND resets_at = ? ORDER BY at');
  const thin = (pts, shift = 0) => { const step = Math.max(1, Math.ceil(pts.length / 400)); return pts.filter((_, i) => i % step === 0 || i === pts.length - 1).map((p) => [p.at + shift, Math.round(p.pct * 10) / 10]); };
  const series = {};
  for (const w of db.prepare('SELECT DISTINCT win FROM usage_windows WHERE provider = ?').all(provider)) {
    const last = db.prepare('SELECT resets_at FROM usage_samples WHERE provider = ? AND win = ? ORDER BY at DESC LIMIT 1').get(provider, w.win);
    if (!last) continue;
    const before = db.prepare('SELECT resets_at FROM usage_samples WHERE provider = ? AND win = ? AND resets_at < ? ORDER BY resets_at DESC LIMIT 1').get(provider, w.win, last.resets_at - 60e3);
    series[w.win] = { now: thin(read.all(provider, w.win, last.resets_at)), prev: before ? thin(read.all(provider, w.win, before.resets_at), last.resets_at - before.resets_at) : [] };
  }
  // A past window picked on the page: its readings, while they are still kept (35 days).
  let view = null;
  if (opts.win && opts.at) {
    const w = db.prepare('SELECT resets_at, len FROM usage_windows WHERE provider = ? AND win = ? AND resets_at = ?').get(provider, opts.win, Number(opts.at));
    if (w) view = { win: opts.win, start: w.resets_at - w.len, resetsAt: w.resets_at, len: w.len, points: thin(read.all(provider, opts.win, w.resets_at)) };
  }

  return { providers, provider, main: main.win, heat, daily, habits, past: Object.fromEntries(Object.entries(past).map(([k, list]) => [k, list.map((w) => ({ start: w.resets_at - w.len, resetsAt: w.resets_at, len: w.len, peak: Math.round(w.peak), outAt: w.out_at, partial: w.first_at - (w.resets_at - w.len) > w.len * 0.15 }))])), sessions, attributed, series, view };
}
