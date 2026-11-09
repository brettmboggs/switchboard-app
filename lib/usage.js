// AI plan usage: how much of each plan's limit is used, when it resets, and
// whether the pace lands under the limit by then. Claude Code sends its limits
// with every status update (rate_limits.five_hour / seven_day: used_percentage,
// resets_at; bin/statusline.sh posts them to /hook/claude/status). Codex writes
// its own in its session logs (rate_limits.primary / secondary: used_percent,
// window_minutes, resets_at), read here every few minutes. Each reading is kept
// in SQLite for 35 days, so the card can draw the window so far and say where
// the pace lands. Nothing leaves this computer; read only on Codex's files.
import { readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { db } from './db.js';

db.exec(`CREATE TABLE IF NOT EXISTS usage_samples (
  provider TEXT NOT NULL, win TEXT NOT NULL, at INTEGER NOT NULL,
  pct REAL NOT NULL, resets_at INTEGER NOT NULL, len INTEGER NOT NULL,
  PRIMARY KEY (provider, win, at)
)`);
const KEEP = 35 * 86400e3, EVERY = 15 * 60e3, H = 3600e3, D = 24 * H;
const NAMES = { claude: 'Claude', codex: 'Codex' };

// One reading. Kept when the number or the reset moved, or every 15 minutes
// otherwise (so a quiet stretch still draws flat). Returns true when it changed.
export function noteUsage(provider, win, pct, resetsAt, len, now = Date.now()) {
  if (!Number.isFinite(pct) || !Number.isFinite(resetsAt) || !len) return false;
  pct = Math.max(0, Math.min(100, pct));
  const last = db.prepare('SELECT pct, resets_at, at FROM usage_samples WHERE provider = ? AND win = ? ORDER BY at DESC LIMIT 1').get(provider, win);
  const moved = !last || Math.abs(last.pct - pct) >= 0.5 || Math.abs(last.resets_at - resetsAt) > 60e3;
  if (!moved && now - last.at < EVERY) return false;
  db.prepare('INSERT OR REPLACE INTO usage_samples (provider, win, at, pct, resets_at, len) VALUES (?, ?, ?, ?, ?, ?)').run(provider, win, now, pct, resetsAt, len);
  db.prepare('DELETE FROM usage_samples WHERE at < ?').run(now - KEEP);
  return moved;
}

// How long a window is, from its name: five_hour 5 h, seven_day 7 days.
export function windowLength(key) {
  const k = String(key).toLowerCase();
  if (/five|5h/.test(k)) return 5 * H;
  if (/seven|7d|week/.test(k)) return 7 * D;
  return 0;
}
// Claude Code's status-line rate_limits. resets_at is in seconds.
export function noteClaudeLimits(rl, now = Date.now()) {
  if (!rl || typeof rl !== 'object') return false;
  let changed = false;
  for (const [key, w] of Object.entries(rl)) {
    if (!w || typeof w !== 'object') continue;
    const len = windowLength(key);
    if (noteUsage('claude', key, Number(w.used_percentage), Number(w.resets_at) * 1000, len, now)) changed = true;
  }
  return changed;
}

// ---- Codex: the last rate_limits line in its newest session log.
const CODEX = () => join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions');
function newestLog(dir, depth = 0) {
  let names; try { names = readdirSync(dir).sort().reverse(); } catch { return null; }
  if (depth === 3) { const f = names.find((n) => n.endsWith('.jsonl')); return f ? join(dir, f) : null; }
  for (const n of names) { if (!/^\d+$/.test(n)) continue; const f = newestLog(join(dir, n), depth + 1); if (f) return f; }
  return null;
}
let codexSeen = '';
export function readCodexLimits(now = Date.now()) {
  const file = newestLog(CODEX());
  if (!file) return false;
  let st; try { st = statSync(file); } catch { return false; }
  const stamp = file + ':' + st.size;
  if (stamp === codexSeen) return false;
  codexSeen = stamp;
  const size = Math.min(st.size, 512 * 1024), buf = Buffer.alloc(size);
  try { const fd = openSync(file, 'r'); readSync(fd, buf, 0, size, st.size - size); closeSync(fd); } catch { return false; }
  const lines = buf.toString('utf8').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"rate_limits"')) continue;
    let rl; try { const o = JSON.parse(lines[i]); rl = o.payload?.rate_limits || o.payload?.info?.rate_limits || o.rate_limits; } catch { continue; }
    if (!rl) continue;
    let changed = false;
    for (const key of ['primary', 'secondary']) {
      const w = rl[key];
      if (!w || !w.window_minutes) continue;
      if (noteUsage('codex', key, Number(w.used_percent), Number(w.resets_at) * 1000, w.window_minutes * 60e3, now)) changed = true;
    }
    return changed;
  }
  return false;
}

// ---- The forecast. Pace is % per hour: what the last stretch used (the last
// day of a weekly window, the last hour of a short one), blended with the
// average since the window began, so a burst counts but a night's sleep does
// too. From it: where the window lands at reset, and when it would hit 100%.
export function forecast(samples, now = Date.now()) {
  if (!samples.length) return null;
  const last = samples[samples.length - 1];
  const { resets_at: resetsAt, len } = last;
  const start = resetsAt - len, pct = last.pct;
  const left = Math.max(0, resetsAt - now), gone = Math.max(1, Math.min(len, now - start));
  const inWin = samples.filter((s) => s.resets_at === resetsAt);
  const avg = pct / gone;
  const look = len > D ? D : H;
  const from = inWin.find((s) => s.at >= now - look);
  let rate = avg;
  if (from && last.at - from.at >= look * 0.25) rate = 0.6 * Math.max(0, (pct - from.pct) / (last.at - from.at)) + 0.4 * avg;
  const lands = pct + rate * left;
  const outAt = rate > 0 && lands > 100 ? now + (100 - pct) / rate : null;
  const even = (gone / len) * 100;   // where an even pace would be by now
  const perDay = left > H ? ((100 - pct) / left) * D : null;   // what is left, spread to the reset
  const state = pct >= 100 ? 'out' : outAt ? 'over' : lands > 85 ? 'tight' : 'ok';
  return { pct, resetsAt, len, start, lands: Math.round(lands), outAt, even: Math.round(even), perDay: perDay == null ? null : Math.max(0, perDay), state, rate: rate * H };
}

// The window so far, for the little chart: at most 60 points, start to now.
function points(inWin, start) {
  const step = Math.max(1, Math.ceil(inWin.length / 60));
  const pts = inWin.filter((_, i) => i % step === 0 || i === inWin.length - 1).map((s) => [s.at, Math.round(s.pct * 10) / 10]);
  return pts;
}
// The seven days of a weekly window, from its start: what each used (its last
// reading less the one before it). null for a day still to come, or one with no
// reading before it to measure from (Switchboard was not keeping them yet), so a
// first reading of 51% is never shown as one day's use.
function days(inWin, start, now) {
  const out = [];
  const fromStart = inWin.length && inWin[0].at - start < H;   // readings since the window began
  for (let i = 0; i < 7; i++) {
    const t = start + i * D;
    if (t >= now) { out.push(null); continue; }
    const before = inWin.filter((s) => s.at < t).pop();
    const base = before ? before.pct : i === 0 && fromStart ? 0 : null;
    if (base == null) { out.push(null); continue; }
    const day = inWin.filter((s) => s.at >= t && s.at < t + D);
    out.push(Math.max(0, Math.round((day.length ? day[day.length - 1].pct : base) - base)));
  }
  return out;
}

// For the board: every plan heard from in the last week, each window with its forecast.
export function usageForBoard(now = Date.now()) {
  const rows = db.prepare('SELECT provider, win, at, pct, resets_at, len FROM usage_samples WHERE at > ? ORDER BY at').all(now - 8 * D);
  const by = new Map();
  for (const r of rows) { const k = r.provider + '|' + r.win; if (!by.has(k)) by.set(k, []); by.get(k).push(r); }
  const plans = {};
  for (const [k, list] of by) {
    const [provider, win] = k.split('|');
    const f = forecast(list, now);
    if (!f) continue;
    if (f.resetsAt < now) { f.pct = 0; f.lands = 0; f.outAt = null; f.state = 'ok'; f.reset = true; }   // it has reset since the last reading
    const inWin = list.filter((s) => s.resets_at === f.resetsAt);
    (plans[provider] ||= { id: provider, name: NAMES[provider] || provider, at: 0, windows: [] });
    plans[provider].at = Math.max(plans[provider].at, list[list.length - 1].at);
    plans[provider].windows.push({ id: win, ...f, points: f.reset ? [] : points(inWin, f.start), days: f.len > D && f.len <= 8 * D ? days(inWin, f.start, now) : null });
  }
  for (const p of Object.values(plans)) p.windows.sort((a, b) => a.len - b.len);
  return Object.values(plans).sort((a, b) => b.at - a.at);
}
