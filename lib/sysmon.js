// The System monitor's numbers (Settings, System). Asked for by the page about
// every two seconds while the monitor is open, and by nothing else: no timer
// here, no history kept, so a closed monitor costs no CPU and no memory. The
// page keeps its own two minutes of history for the charts.
//
// The processor is read from Node itself (cheap, every call). Everything an OS
// has to be asked for (processes, graphics, temperatures, fans, network) comes
// from lib/sysprobe.js at most every few seconds and is reused in between.
import os from 'node:os';
import { statfsSync, existsSync, readFileSync } from 'node:fs';
import { probe, probeEvery, groupProcs } from './sysprobe.js';
import { CAN_END, labelApps, hogOf, forgetGone, gpuByPid } from './procs.js';

const GB = 1073741824;
let prevCpu = null, prevAt = 0;
let slow = null, slowAt = 0, slowBusy = null, prevNet = null;
let disks = { at: 0, list: [] };
let last = null, lastAt = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const times = () => os.cpus().map((c) => c.times);

export function corePercents(a, b) {
  return b.map((t, i) => {
    const p = a[i] || t;
    const idle = t.idle - p.idle, total = (t.user - p.user) + (t.nice - p.nice) + (t.sys - p.sys) + (t.irq - p.irq) + idle;
    return total > 0 ? Math.min(100, Math.max(0, (1 - idle / total) * 100)) : 0;
  });
}

// A disk's name in plain words, not its mount path: the main disk, the startup
// disk, a Windows drive by its letter, anything else by its folder's own name
// (a USB stick mounted at /media/sam/PHOTOS is "PHOTOS"). The page keeps `mount` for a tooltip.
export function diskName(mount, platform = process.platform) {
  const m = String(mount || '');
  const drive = /^([A-Za-z]):[\\/]?$/.exec(m);
  if (drive) return `Drive ${drive[1].toUpperCase()}:`;
  if (m === '/' || (platform === 'darwin' && m === '/System/Volumes/Data')) return 'The main disk';
  if (/^\/boot(\/efi)?\/?$/.test(m)) return 'The startup disk';
  const n = m.split(/[\\/]/).filter(Boolean).pop() || m;
  return n.charAt(0).toUpperCase() + n.slice(1);
}

function diskList() {
  if (Date.now() - disks.at < 60000) return disks.list;
  const roots = process.platform === 'win32' ? 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => l + ':\\').filter((r) => existsSync(r))
    : process.platform === 'linux' ? mountRoots() : ['/'];
  const list = [];
  for (const root of roots) {
    try { const s = statfsSync(root); const total = s.blocks * s.bsize; if (total > 0) list.push({ mount: root, name: diskName(root), total, free: s.bavail * s.bsize }); } catch { /* unreadable */ }
  }
  disks = { at: Date.now(), list };
  return list;
}
// Real disks only, one line per device: /, /home and USB drives, not snaps or tmpfs.
function mountRoots() {
  const seen = new Set(), out = [];
  try {
    for (const l of readFileSync('/proc/mounts', 'utf8').split('\n')) {
      const [dev, mp, type] = l.split(' ');
      if (!/^(ext[234]|btrfs|xfs|vfat|exfat|ntfs3?|f2fs|zfs)$/.test(type || '') || !dev.startsWith('/') || seen.has(dev) || /^\/(boot|snap|var\/snap)/.test(mp)) continue;
      seen.add(dev); out.push(mp.replace(/\\040/g, ' '));
    }
  } catch { /* no /proc */ }
  return out.length ? out.slice(0, 6) : ['/'];
}

async function refreshSlow() {
  if (slowBusy) return slowBusy;
  slowBusy = probe().then((r) => {
    const now = Date.now();
    if (r.net) {
      const dt = prevNet ? (now - prevNet.at) / 1000 : 0;
      r.netRate = dt > 0 ? { down: Math.max(0, (r.net.rx - prevNet.rx) / dt), up: Math.max(0, (r.net.tx - prevNet.tx) / dt) } : null;
      prevNet = { at: now, ...r.net };
    }
    slow = r; slowAt = now;
    if (CAN_END) { forgetGone(r.procs || []); gpuByPid().catch(() => {}); }   // video memory by process, at most every 5 s
  }).catch(() => { slowAt = Date.now(); }).finally(() => { slowBusy = null; });
  return slowBusy;
}

export function bottleneck(s) {
  const say = [];
  const top = (by) => [...s.apps].sort((a, b) => b[by] - a[by])[0];
  if (s.cpu.pct >= 90) { const t = top('cpu'); say.push({ what: 'cpu', text: `The processor is flat out (${Math.round(s.cpu.pct)}%)${t && t.cpu >= 10 ? `, mostly ${t.name}` : ''}.` }); }
  if (s.mem.pct >= 90) { const t = top('mem'); say.push({ what: 'mem', text: `Memory is ${Math.round(s.mem.pct)}% full${t ? `; ${t.name} holds ${(t.mem / GB).toFixed(1)} GB` : ''}.` }); }
  else if (s.mem.swapUsed > 2 * GB && s.mem.pct >= 80) say.push({ what: 'mem', text: `Memory is nearly full and ${(s.mem.swapUsed / GB).toFixed(1)} GB has spilled to disk, which slows everything.` });
  for (const g of s.gpus) if (g.pct >= 95) say.push({ what: 'gpu', text: `The graphics card is flat out (${Math.round(g.pct)}%).` });
  const hot = s.temps.filter((t) => t.c >= 90).sort((a, b) => b.c - a.c)[0];
  if (hot) say.push({ what: 'temp', text: `${hot.label} is running hot (${Math.round(hot.c)}°C).` });
  for (const d of s.disks) if (d.total && d.free / d.total < 0.08) say.push({ what: 'disk', text: `${d.name || diskName(d.mount)} has only ${(d.free / GB).toFixed(0)} GB left.` });
  return say;
}

// The processes of the last reading (pid, name, cpu, memory), for an app's
// details and for End (lib/procs.js); fresh after a systemSnapshot().
export const procsNow = () => slow?.procs || [];

export async function systemSnapshot() {
  const now = Date.now();
  if (last && now - lastAt < 800) return last;
  if (!prevCpu || now - prevAt > 10000) { prevCpu = times(); prevAt = now; await sleep(350); }   // a first reading needs two points
  const cur = times();
  const cores = corePercents(prevCpu, cur);
  prevCpu = cur; prevAt = Date.now();
  if (!slow) { await refreshSlow(); if (process.platform !== 'win32') { await sleep(450); await refreshSlow(); } }   // changes need two points; a PowerShell start is too slow to repeat
  else if (now - slowAt >= probeEvery()) refreshSlow();           // reused until it arrives
  const s = slow || { procs: [], gpus: [], temps: [], fans: [], notes: [] };
  const total = os.totalmem();
  const avail = s.memAvail != null ? s.memAvail : os.freemem();
  const used = Math.max(0, total - avail);
  const all = groupProcs(s.procs).map((a) => ({ ...a, cpu: Math.round(a.cpu * 10) / 10 }));
  // The busiest by processor and the biggest by memory: the page sorts and searches inside these.
  const byCpu = [...all].sort((a, b) => b.cpu - a.cpu || b.mem - a.mem).slice(0, 40), byMem = [...all].sort((a, b) => b.mem - a.mem).slice(0, 40);
  // Each with its label (safe to end, ask first, keep) and video memory; the pids stay here.
  const apps = labelApps([...new Map([...byCpu, ...byMem].map((a) => [a.name, a])).values()], s.procs).map(({ pids, ...a }) => a);
  const snap = {
    at: now, host: os.hostname(), platform: process.platform, release: os.release(), uptime: os.uptime(),
    cpu: { pct: cores.reduce((a, b) => a + b, 0) / (cores.length || 1), cores, count: cores.length, model: (os.cpus()[0]?.model || '').replace(/\s+/g, ' ').trim(), mhz: os.cpus()[0]?.speed || null, load: process.platform === 'win32' ? null : os.loadavg()[0] },
    mem: { total, used, avail, pct: total ? used / total * 100 : 0, cached: s.memCached ?? null, swapUsed: s.swapUsed ?? null },
    disks: diskList(), gpus: s.gpus || [], temps: s.temps || [], fans: s.fans || [],
    net: s.netRate ? { down: s.netRate.down, up: s.netRate.up } : null,
    apps, notes: s.notes || [], probedAt: slowAt,
    canEnd: CAN_END, hog: hogOf(s.procs, total)
  };
  snap.say = bottleneck(snap);
  last = snap; lastAt = Date.now();
  return snap;
}
