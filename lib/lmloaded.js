// What LM Studio has loaded right now, and unloading it on a click (Settings,
// Connections, Local AI models; Jarvis's "unload models").
//
// The rule (Nov 12 2026): a model Jarvis loads carries a time limit (--ttl)
// and the sweeper in lib/jarvis.js unloads it after a few idle minutes. A model
// the person loaded themselves has no time limit and is never unloaded on its
// own: it goes when they press Unload here. After NUDGE_MIN idle minutes the
// card says so, quietly; it still does nothing by itself.
//
// Held models: Bionic (LM Studio's chat app) runs a model in its own model
// process, which `lms ps` does not list. The old automatic "stray process"
// cleanup took those for leftovers and stopped Qwen while it was in use; Bionic's
// reload then failed with "unable to allocate CUDA0 buffer" (Nov 12 2026). They
// are listed here instead, with who holds them, and stop only on Unload. Linux.
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { lmsPath } from './localai.js';
import { lmModelPids } from './sysprobe.js';

export const NUDGE_MIN = 30;

// `lms ps --json` as the card shows it.
export function loadedFrom(list, now = Date.now()) {
  return (Array.isArray(list) ? list : []).filter((m) => m && m.identifier).map((m) => {
    const ttl = Number(m.ttlMs) > 0 ? Number(m.ttlMs) : null;
    const status = String(m.status || '').toLowerCase();
    const last = Number(m.lastUsedTime) > 0 ? Number(m.lastUsedTime) : null;
    const idleMin = status === 'idle' && last ? Math.max(0, Math.floor((now - last) / 60e3)) : null;
    return {
      id: String(m.identifier), name: String(m.displayName || m.modelKey || m.identifier),
      size: Number(m.sizeBytes) || null, status, idleMin, path: String(m.path || ''),
      auto: !!ttl,                                            // loaded by Jarvis: unloads itself
      nudge: !ttl && idleMin != null && idleMin >= NUDGE_MIN  // loaded by hand and sitting unused
    };
  });
}

// ---------- held model processes (Linux /proc)

// When each model process last used the processor: its idle time.
const cpuSeen = new Map();   // pid -> { ticks, since }

function procInfo(pid) {
  try {
    const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
    const i = cmd.indexOf('--model');
    const cg = readFileSync(`/proc/${pid}/cgroup`, 'utf8');
    const st = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const f = st.slice(st.lastIndexOf(')') + 2).split(' ');
    const rss = Number((readFileSync(`/proc/${pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)/) || [])[1]) * 1024 || null;
    return { model: i >= 0 ? cmd[i + 1] || '' : '', cgroup: cg, ticks: Number(f[11]) + Number(f[12]), rss };
  } catch { return null; }   // gone
}
export const ownerOf = (cgroup) => /elementlabs\.bionic/i.test(cgroup) ? 'Bionic' : /lm-?studio/i.test(cgroup) ? 'LM Studio' : 'another app';

// A model process as the card shows it. seen carries its processor time between looks.
export function heldFrom(pid, info, seen, now = Date.now(), vram = null) {
  const prev = seen.get(pid);
  const since = !prev ? now : info.ticks !== prev.ticks ? now : prev.since;
  seen.set(pid, { ticks: info.ticks, since });
  const working = !!prev && info.ticks !== prev.ticks;
  const idleMin = working ? null : Math.max(0, Math.floor((now - since) / 60e3));
  const name = basename(info.model || 'model').replace(/\.gguf$/i, '');
  return {
    id: `pid:${pid}`, pid, name, held: ownerOf(info.cgroup), size: (vram || 0) + (info.rss || 0) || null, vram, ram: info.rss,
    status: working ? 'working' : 'idle', idleMin, auto: false, nudge: idleMin != null && idleMin >= NUDGE_MIN, path: info.model
  };
}

// Graphics memory per process, from nvidia-smi when there is one.
const gpuByPid = () => new Promise((resolve) => execFile('nvidia-smi', ['--query-compute-apps=pid,used_memory', '--format=csv,noheader,nounits'], { timeout: 4000 }, (err, out) => {
  const m = new Map();
  if (!err) for (const line of String(out).split('\n')) { const [p, mb] = line.split(',').map((s) => s.trim()); if (Number(p)) m.set(Number(p), Number(mb) * 1024 * 1024); }
  resolve(m);
}));

// Model processes no LM Studio list shows (listed: what `lms ps` reported).
async function heldModels(listed, now = Date.now()) {
  if (process.platform !== 'linux') return [];
  const pids = lmModelPids();
  for (const p of cpuSeen.keys()) if (!pids.includes(p)) cpuSeen.delete(p);
  if (!pids.length) return [];
  const gpu = await gpuByPid();
  const names = listed.map((m) => basename(m.path || '')).filter(Boolean);
  const out = [];
  for (const pid of pids) {
    const info = procInfo(pid); if (!info) continue;
    const held = heldFrom(pid, info, cpuSeen, now, gpu.get(pid) || null);
    if (listed.length && (!names.length || names.includes(basename(info.model)))) continue;   // LM Studio's own: shown from its list
    out.push(held);
  }
  return out;
}
// Called by the 2-minute sweep (lib/jarvis.js), so idle minutes count even while Settings is closed.
export function trackHeld() { if (process.platform === 'linux') for (const pid of lmModelPids()) { const i = procInfo(pid); if (i) heldFrom(pid, i, cpuSeen); } }

// ---------- the list and Unload

const run = (args, timeout) => new Promise((resolve) => {
  const lms = lmsPath();
  if (!lms) return resolve({ ok: false, out: '' });
  execFile(lms, args, { timeout, windowsHide: true }, (err, out) => resolve({ ok: !err, out: String(out || '') }));
});

// The models loaded now: LM Studio's list and the model processes other apps hold.
// On Linux, when no model process runs, nothing is loaded and LM Studio is not
// asked (asking wakes its background service).
export async function loadedModels() {
  if (process.platform === 'linux' && !lmModelPids().length) { cpuSeen.clear(); return []; }
  let listed = [];
  if (lmsPath()) {
    const r = await run(['ps', '--json'], 15000);
    try { listed = loadedFrom(JSON.parse(r.out.slice(r.out.indexOf('[')))); } catch { listed = []; }
  }
  return [...listed, ...await heldModels(listed)];
}

const gone = (pid) => { try { process.kill(pid, 0); return false; } catch { return true; } };
async function stop(pid) {
  try { process.kill(pid, 'SIGTERM'); } catch { return gone(pid); }
  for (let i = 0; i < 20 && !gone(pid); i++) await new Promise((r) => setTimeout(r, 250));
  return gone(pid);
}

// Unload one model (by the id the list shows) or all of them. Only an id that is
// loaded right now is acted on, so nothing else can be run or stopped this way.
export async function unloadModels({ id, all } = {}) {
  const before = await loadedModels();
  const pick = all ? before : before.filter((m) => m.id === id);
  if (!pick.length) return all ? { ok: true, message: 'Nothing was loaded.', loaded: before } : { ok: false, error: 'That model is not loaded any more.', loaded: before };
  if (pick.some((m) => !m.pid)) await run(all ? ['unload', '--all'] : ['unload', id], 60000);
  for (const m of pick.filter((x) => x.pid)) await stop(m.pid);
  const loaded = await loadedModels();
  const left = pick.filter((m) => loaded.some((x) => x.id === m.id));
  if (left.length) return { ok: false, error: `${left.map((m) => m.name).join(', ')} did not unload. Close it in ${left[0].held || 'LM Studio'}, or try again.`, loaded };
  const name = pick.length === 1 ? pick[0].name : `${pick.length} models`;
  const held = pick.find((m) => m.held);
  return { ok: true, message: `Unloaded ${name}.${held ? ` ${held.held} loads it again when you next use it there.` : ''}`, loaded };
}
