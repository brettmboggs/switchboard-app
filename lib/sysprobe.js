// What this computer is doing, read the way each OS offers it. Only lib/sysmon.js
// calls this. Everything that differs by OS lives here (like desktop.js and
// terminals.js), and the parsing is plain functions so tests can feed them text.
//
// Nothing here asks for admin rights or loads a driver. What an OS keeps behind
// admin (CPU temperature and fans on Windows, temperatures on a Mac) is reported
// as "not shared", never guessed.
import { execFile, spawn } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { cpus } from 'node:os';

const OS = process.platform;
const run = (cmd, args, timeout = 6000) => new Promise((ok) => execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 8 << 20 }, (err, out) => ok(err ? null : String(out))));
const read = (f) => { try { return readFileSync(f, 'utf8'); } catch { return null; } };
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

// ---------- parsers (pure)

export function parseMeminfo(text) {
  const kb = (k) => { const m = new RegExp('^' + k + ':\\s+(\\d+)', 'm').exec(text || ''); return m ? Number(m[1]) * 1024 : null; };
  const total = kb('MemTotal'), avail = kb('MemAvailable'), cached = kb('Cached');
  return { total, avail, cached, swapTotal: kb('SwapTotal'), swapFree: kb('SwapFree') };
}

// One /proc/PID/stat line: the name sits in brackets and may hold spaces or brackets.
export function parseProcStat(line) {
  const a = line.indexOf('('), z = line.lastIndexOf(')');
  if (a < 0 || z < a) return null;
  const rest = line.slice(z + 2).split(' ');
  const ticks = num(rest[11]) + num(rest[12]), pages = num(rest[21]);
  if (!Number.isFinite(ticks) || pages == null) return null;
  return { name: line.slice(a + 1, z), ticks, rssPages: pages, ppid: num(rest[1]), start: num(rest[19]) };
}

// Several processes with one name (a browser has dozens) count as one app;
// pids keeps which ones, for the app's details and End (lib/procs.js).
export function groupProcs(list) {
  const by = new Map();
  for (const p of list) {
    const g = by.get(p.name) || { name: p.name, count: 0, cpu: 0, mem: 0, pids: [] };
    g.count++; g.cpu += p.cpu || 0; g.mem += p.mem || 0; if (p.pid != null) g.pids.push(p.pid); by.set(p.name, g);
  }
  return [...by.values()];
}

export function parseNvidia(csv) {
  return String(csv || '').split('\n').map((l) => l.split(',').map((s) => s.trim())).filter((c) => c.length >= 7 && c[0]).map((c) => ({
    name: c[0], pct: num(c[1]), memUsed: num(c[2]) == null ? null : num(c[2]) * 1048576, memTotal: num(c[3]) == null ? null : num(c[3]) * 1048576,
    temp: num(c[4]), fanPct: num(c[5]), watts: num(c[6])
  }));
}

export function parseVmStat(text) {
  const page = Number(/page size of (\d+) bytes/.exec(text || '')?.[1]) || 16384;
  const get = (k) => Number(new RegExp('^Pages ' + k + ':\\s+(\\d+)', 'm').exec(text || '')?.[1]) || 0;
  return { avail: (get('free') + get('inactive') + get('speculative') + get('purgeable')) * page, cached: get('inactive') * page };
}

export function parseNetDev(text) {
  let rx = 0, tx = 0;
  for (const line of String(text || '').split('\n').slice(2)) {
    const [name, rest] = line.split(':'); if (!rest) continue;
    if (/^\s*(lo|docker\d*|veth\w*|br-\w+|virbr\d*)$/.test(name)) continue;
    const f = rest.trim().split(/\s+/); rx += Number(f[0]) || 0; tx += Number(f[8]) || 0;
  }
  return { rx, tx };
}

// `netstat -ib` on a Mac: the <Link#n> row of each interface carries its byte counts.
export function parseMacNetstat(text) {
  let rx = 0, tx = 0;
  for (const line of String(text || '').split('\n')) {
    const t = line.trim().split(/\s+/); const i = t.findIndex((x) => x.startsWith('<Link#'));
    if (i < 1 || /^lo\d+\*?$/.test(t[0])) continue;
    const n = t.slice(i + 1); if (n[0] && n[0].includes(':')) n.shift();
    rx += Number(n[2]) || 0; tx += Number(n[5]) || 0;
  }
  return { rx, tx };
}

// A temperature sensor's name in plain words: what part of the computer it is.
// Chips and labels come from the kernel (k10temp Tctl, coretemp Package id 0,
// nvme Composite, amdgpu edge) or a Windows monitoring tool (CPU Package, GPU
// Hot Spot). The original stays on the reading as `raw`, for a tooltip.
const CPU_CHIPS = /^(k10temp|k8temp|zenpower|coretemp|cpu[_-]thermal|soc[_-]thermal|x86_pkg_temp|via_cputemp)$/i;
const GPU_CHIPS = /^(amdgpu|radeon|nouveau|i915|xe|nvidia|gpu[_-]thermal)$/i;
export function sensorName(label, chip = '') {
  const l = String(label || '').trim(), c = String(chip || '').trim();
  let m;
  if ((m = /^(?:cpu )?core #?(\d+)$/i.exec(l)) && (CPU_CHIPS.test(c) || /^cpu/i.test(l) || c === 'sensor')) return `Processor core ${Number(m[1]) + (/#/.test(l) ? 0 : 1)}`;
  if ((m = /^Tccd(\d+)$/i.exec(l))) return `Processor chiplet ${m[1]}`;
  if (/^(Tctl|Tdie|Package( id \d+)?|CPU( Package| Die| Temp(erature)?)?|CPU ?TIN|Core \(Tctl\/Tdie\)|Core Max|Core Average)$/i.test(l) || (!l || l === c) && CPU_CHIPS.test(c)) return 'Processor';
  if (/^nvme$/i.test(c) || /^nvme/i.test(l)) return /^Sensor (\d+)$/i.test(l) ? `SSD sensor ${/\d+/.exec(l)[0]}` : 'SSD';
  if (/^drivetemp$/i.test(c)) return 'Disk';
  if (GPU_CHIPS.test(c) || /^GPU/i.test(l)) {
    if (/junction|hot ?spot/i.test(l)) return 'Graphics (hottest spot)';
    if (/^(mem|GPU Memory)/i.test(l)) return 'Graphics memory';
    return 'Graphics';
  }
  if (/^(acpitz|pch_|SYSTIN|Motherboard)/i.test(c) || /^(SYSTIN|Motherboard|System)$/i.test(l)) return 'Motherboard';
  if (/^iwlwifi/i.test(c)) return 'Wi-Fi card';
  if (/^(spd5118|jc42)$/i.test(c)) return 'Memory';
  if (/^(BAT\d*|battery)$/i.test(c) || /^battery$/i.test(l)) return 'Battery';
  return l || c || 'Sensor';
}

// Temperatures and fans the Linux kernel already publishes, no tools needed.
export function readHwmon(root = '/sys/class/hwmon') {
  const temps = [], fans = [];
  let dirs = []; try { dirs = readdirSync(root); } catch { return { temps, fans }; }
  for (const d of dirs) {
    const dir = join(root, d), chip = (read(join(dir, 'name')) || d).trim();
    let files = []; try { files = readdirSync(dir); } catch { continue; }
    for (const f of files) {
      let m;
      if ((m = /^temp(\d+)_input$/.exec(f))) {
        const c = num(read(join(dir, f))); if (c == null || c <= 0) continue;
        const label = (read(join(dir, `temp${m[1]}_label`)) || '').trim();
        temps.push({ label: sensorName(label, chip), raw: label ? `${chip} ${label}` : chip, chip, c: c / 1000 });
      } else if ((m = /^fan(\d+)_input$/.exec(f))) {
        const rpm = num(read(join(dir, f))); if (rpm == null) continue;
        const label = (read(join(dir, `fan${m[1]}_label`)) || '').trim();
        fans.push({ label: label || `${chip} fan ${m[1]}`, rpm });
      }
    }
  }
  return { temps, fans };
}

const macGpu = (ioreg) => num(/"Device Utilization %"\s*=\s*(\d+)/.exec(ioreg || '')?.[1]);
const macBatteryTemp = (ioreg) => { const t = num(/"Temperature"\s*=\s*(\d+)/.exec(ioreg || '')?.[1]); return t == null ? null : t / 100; };
export const _parse = { macGpu, macBatteryTemp };

// ---------- the probes, one per OS. Each returns the same shape:
//   { memAvail, memCached, swapUsed, procs:[{pid,name,cpu,mem}], gpus, temps, fans, net:{rx,tx}, notes:[] }
// cpu on a process is percent of the whole computer; mem is bytes. On Linux a
// process also carries ppid and start (clock ticks after boot, which tells a
// reused pid from the one the page saw).

let procPrev = null;            // { at, ticks: Map(pid -> ticks) } for the delta
const ncpu = () => Math.max(1, cpus().length);

async function linux() {
  const mem = parseMeminfo(read('/proc/meminfo'));
  const now = Date.now(), ticks = new Map(), list = [];
  let pids = []; try { pids = readdirSync('/proc').filter((n) => /^\d+$/.test(n)); } catch { /* none */ }
  const cur = new Map();
  for (const pid of pids) {
    const s = read(`/proc/${pid}/stat`); if (!s) continue;
    const p = parseProcStat(s); if (!p) continue;
    cur.set(pid, p);
  }
  const dt = procPrev ? (now - procPrev.at) / 1000 : 0;
  for (const [pid, p] of cur) {
    const before = procPrev?.ticks.get(pid);
    const cpu = dt > 0 && before != null ? Math.max(0, (p.ticks - before) / 100 / dt * 100 / ncpu()) : 0;
    list.push({ pid: Number(pid), ppid: p.ppid, start: p.start, name: p.name, cpu, mem: p.rssPages * 4096 });
    ticks.set(pid, p.ticks);
  }
  procPrev = { at: now, ticks };
  const hw = readHwmon();
  const gpus = [];
  const nv = await nvidia(); gpus.push(...nv);
  if (!nv.length) gpus.push(...amdGpus());
  const notes = [];
  if (!hw.temps.length) notes.push('This computer does not publish temperatures to normal programs (a virtual machine, say).');
  return {
    memAvail: mem.avail, memCached: mem.cached, swapUsed: mem.swapTotal != null ? mem.swapTotal - (mem.swapFree || 0) : null,
    procs: list, gpus, temps: hw.temps, fans: hw.fans, net: parseNetDev(read('/proc/net/dev')), notes
  };
}

function amdGpus() {
  const out = [];
  try {
    for (const c of readdirSync('/sys/class/drm').filter((n) => /^card\d+$/.test(n))) {
      const d = `/sys/class/drm/${c}/device`;
      const busy = num(read(`${d}/gpu_busy_percent`)); if (busy == null) continue;
      out.push({ name: 'AMD graphics', pct: busy, memUsed: num(read(`${d}/mem_info_vram_used`)), memTotal: num(read(`${d}/mem_info_vram_total`)), temp: null, fanPct: null, watts: null });
    }
  } catch { /* no drm */ }
  return out;
}

let noNvidiaUntil = 0;
async function nvidia() {
  if (Date.now() < noNvidiaUntil) return [];
  const out = await run('nvidia-smi', ['--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,fan.speed,power.draw', '--format=csv,noheader,nounits'], 4000);
  const g = parseNvidia(out);
  if (!g.length) noNvidiaUntil = Date.now() + 300000;   // not installed: do not ask again for five minutes
  return g;
}

async function mac() {
  const [ps, vm, net, accel, batt] = await Promise.all([
    run('ps', ['-Ao', 'pid=,pcpu=,rss=,comm=']), run('vm_stat', []), run('netstat', ['-ib']),
    run('ioreg', ['-r', '-d', '1', '-w0', '-c', 'IOAccelerator']), run('ioreg', ['-rn', 'AppleSmartBattery', '-w0'])
  ]);
  const procs = String(ps || '').split('\n').map((l) => {
    const m = /^\s*(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/.exec(l); if (!m) return null;
    return { pid: Number(m[1]), name: m[4].split('/').pop().replace(/\.app$/, ''), cpu: Number(m[2]) / ncpu(), mem: Number(m[3]) * 1024 };
  }).filter(Boolean);
  const v = parseVmStat(vm);
  const util = macGpu(accel), bt = macBatteryTemp(batt);
  return {
    memAvail: v.avail, memCached: v.cached, swapUsed: null, procs,
    gpus: util == null ? [] : [{ name: 'Graphics', pct: util, memUsed: null, memTotal: null, temp: null, fanPct: null, watts: null }],
    temps: bt == null ? [] : [{ label: 'Battery', chip: 'battery', c: bt }], fans: [], net: parseMacNetstat(net),
    notes: ['macOS keeps processor and fan readings behind admin tools, so Switchboard does not show them. It never asks for admin rights.']
  };
}

// One PowerShell run per refresh. Windows hands out the process list, network
// counters, the graphics engines and thermal zones through it; if a monitoring
// tool (LibreHardwareMonitor or OpenHardwareMonitor) is running, its sensors
// carry the CPU temperature and fans, and are shown too.
const PS = `$ErrorActionPreference='SilentlyContinue'
$o=@{}
$o.procs=@(Get-Process | ForEach-Object { @{ n=$_.ProcessName; c=[double]$_.CPU; m=[double]$_.WorkingSet64; i=$_.Id } })
$o.net=@(Get-NetAdapterStatistics | ForEach-Object { @{ r=[double]$_.ReceivedBytes; s=[double]$_.SentBytes } })
$g=(Get-Counter '\\GPU Engine(*engtype_3D*)\\Utilization Percentage').CounterSamples | Measure-Object CookedValue -Sum
$o.gpu=$g.Sum
$gm=(Get-Counter '\\GPU Adapter Memory(*)\\Dedicated Usage').CounterSamples | Measure-Object CookedValue -Sum
$o.gmem=$gm.Sum
$gn=(Get-CimInstance Win32_VideoController | Select-Object -First 1).Name
$o.gname=$gn
$o.zones=@(Get-CimInstance -Namespace root/wmi MSAcpi_ThermalZoneTemperature | ForEach-Object { @{ l=$_.InstanceName; c=($_.CurrentTemperature/10-273.15) } })
foreach($ns in 'root/LibreHardwareMonitor','root/OpenHardwareMonitor'){ $s=@(Get-CimInstance -Namespace $ns -ClassName Sensor | Where-Object { $_.SensorType -eq 'Temperature' -or $_.SensorType -eq 'Fan' } | ForEach-Object { @{ t=$_.SensorType; n=$_.Name; v=[double]$_.Value } }); if($s.Count){ $o.sensors=$s; break } }
$os=Get-CimInstance Win32_OperatingSystem
$o.avail=[double]$os.FreePhysicalMemory*1024
$o.swap=([double]$os.TotalVirtualMemorySize-[double]$os.FreeVirtualMemory)*1024-([double]$os.TotalVisibleMemorySize-[double]$os.FreePhysicalMemory)*1024
$o | ConvertTo-Json -Depth 4 -Compress`;

export function parseWindows(json, prev, now) {
  let o; try { o = JSON.parse(json); } catch { return null; }
  const arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
  const dt = prev ? (now - prev.at) / 1000 : 0;
  const ticks = new Map(), procs = [];
  for (const p of arr(o.procs)) {
    const before = prev?.ticks.get(p.i);
    const cpu = dt > 0 && before != null ? Math.max(0, (p.c - before) / dt * 100 / ncpu()) : 0;
    procs.push({ pid: p.i, name: p.n, cpu, mem: p.m || 0 }); ticks.set(p.i, p.c || 0);
  }
  const net = arr(o.net).reduce((a, n) => ({ rx: a.rx + (n.r || 0), tx: a.tx + (n.s || 0) }), { rx: 0, tx: 0 });
  const temps = [], fans = [];
  for (const s of arr(o.sensors)) (s.t === 'Fan' ? fans.push({ label: s.n, rpm: s.v }) : temps.push({ label: sensorName(s.n, 'sensor'), raw: s.n, chip: 'sensor', c: s.v }));
  if (!temps.length) for (const z of arr(o.zones)) if (Number.isFinite(z.c) && z.c > 0 && z.c < 120) temps.push({ label: 'Motherboard', raw: 'ACPI thermal zone', chip: 'acpi', c: z.c });
  return { ticks, procs, net, temps, fans, o };
}

let winPrev = null;
async function win() {
  const now = Date.now();
  const [json, nv] = await Promise.all([run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS], 20000), nvidia()]);
  const r = json ? parseWindows(json, winPrev, now) : null;
  if (!r) return { memAvail: null, memCached: null, swapUsed: null, procs: [], gpus: nv, temps: [], fans: [], net: null, notes: ['Windows did not answer the status query this time.'] };
  winPrev = { at: now, ticks: r.ticks };
  const gpus = nv.length ? nv : (r.o.gpu != null ? [{ name: r.o.gname || 'Graphics', pct: Math.min(100, r.o.gpu), memUsed: r.o.gmem || null, memTotal: null, temp: null, fanPct: null, watts: null }] : []);
  const notes = [];
  if (!r.fans.length) notes.push('Windows does not share fan speeds or most processor temperatures with ordinary programs. Run LibreHardwareMonitor or HWiNFO beside Switchboard and the readings it exposes will appear here.');
  return { memAvail: r.o.avail || null, memCached: null, swapUsed: r.o.swap > 0 ? r.o.swap : null, procs: r.procs, gpus, temps: r.temps, fans: r.fans, net: r.net, notes };
}

// LM Studio's model processes (its llama-server, one per loaded model), by process id. Linux reads /proc;
// elsewhere none are listed, so nothing is ever stopped there.
export function lmModelPids() {
  if (OS !== 'linux') return [];
  const out = [];
  for (const d of readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    const cmd = (read(`/proc/${d}/cmdline`) || '').split('\0')[0];
    if (/[\\/]\.lmstudio[\\/]extensions[\\/]backends[\\/].*llama-server$/.test(cmd)) out.push(Number(d));
  }
  return out;
}
export const probe = () => (OS === 'linux' ? linux() : OS === 'darwin' ? mac() : OS === 'win32' ? win() : Promise.resolve({ memAvail: null, procs: [], gpus: [], temps: [], fans: [], net: null, notes: ['This system is not supported yet.'] }));
// How often a fresh probe is worth its cost: a file read is free, a PowerShell start is not.
export const probeEvery = () => (OS === 'win32' ? 5000 : OS === 'darwin' ? 3000 : 2000);

// ---------- the network test (lib/speedtest.js): the way out, the link, pings.
// Linux first; macOS reads the route and pings but not the link (unverified);
// Windows pings only (unverified). Anything unknown is null, never guessed.

// /proc/net/route: the default route's interface and gateway (hex, little-endian).
export function parseProcRoute(text) {
  for (const l of String(text || '').split('\n').slice(1)) {
    const f = l.trim().split(/\s+/);
    if (f.length < 8 || f[1] !== '00000000' || f[2] === '00000000' || (parseInt(f[3], 16) & 2) === 0) continue;
    const g = f[2].match(/../g).reverse().map((h) => parseInt(h, 16)).join('.');
    return { iface: f[0], gateway: g };
  }
  return null;
}
// One line of ping's output: a reply, a packet given up on (Linux -O), or nothing.
export function parsePingLine(line) {
  const s = String(line);
  let m = /icmp_seq=(\d+).*?time[=<]([\d.]+)\s*ms/.exec(s);
  if (m) return { seq: Number(m[1]), ms: Number(m[2]) };
  if ((m = /no answer yet for icmp_seq=(\d+)/.exec(s))) return { seq: Number(m[1]), lost: true };
  if ((m = /time[=<]([\d.]+)\s*ms/i.exec(s))) return { ms: Number(m[1]) };          // Windows: no sequence number
  if (/timed out|unreachable/i.test(s)) return { lost: true };
  return null;
}
// nmcli -t lines escape ':' inside a field as '\:'.
export function parseNmcliWifi(text) {
  for (const l of String(text || '').split('\n')) {
    const f = l.split(/(?<!\\):/).map((x) => x.replace(/\\:/g, ':'));
    if (f[0] !== '*') continue;
    return { name: f[1] || null, signal: num(f[2]), linkMbps: num(String(f[3] || '').split(' ')[0]), channel: num(f[4]) };
  }
  return null;
}

export async function defaultRoute() {
  if (OS === 'linux') return parseProcRoute(read('/proc/net/route'));
  if (OS === 'darwin') {
    const out = await run('route', ['-n', 'get', 'default'], 3000);
    const g = /gateway:\s*(\S+)/.exec(out || ''), i = /interface:\s*(\S+)/.exec(out || '');
    return g ? { iface: i ? i[1] : null, gateway: g[1] } : null;
  }
  return null;
}
// How this computer is connected: { iface, kind: 'wired' | 'wifi' | 'other', linkMbps, name, signal, channel }.
export async function netLink(route) {
  if (OS !== 'linux' || !route?.iface) return null;
  const dir = `/sys/class/net/${route.iface}`;
  if (existsSync(`${dir}/wireless`) || existsSync(`${dir}/phy80211`)) {
    const w = parseNmcliWifi(await run('nmcli', ['-t', '-f', 'IN-USE,SSID,SIGNAL,RATE,CHAN', 'device', 'wifi', 'list', 'ifname', route.iface, '--rescan', 'no'], 4000));
    return { iface: route.iface, kind: 'wifi', ...(w || {}) };
  }
  const speed = num((read(`${dir}/speed`) || '').trim());
  if (existsSync(`${dir}/device`)) return { iface: route.iface, kind: 'wired', linkMbps: speed > 0 ? speed : null };
  return { iface: route.iface, kind: 'other', linkMbps: null };
}
// Ping a host every `every` seconds until stopped; onLine({ seq, ms }) for each
// answer and onLine({ seq, lost: true }) for each one given up on (a late answer
// can still follow it). stop() gives { sent, got }. Null where ping cannot be run.
export function pingStream(host, onLine, every = 0.2) {
  if (!/^[\w.:-]+$/.test(host)) return null;
  const args = OS === 'linux' ? ['-n', '-O', '-i', String(every), '-W', '1', host] : OS === 'darwin' ? ['-n', '-i', String(Math.max(every, 0.2)), host] : OS === 'win32' ? ['-t', '-w', '1000', host] : null;
  if (!args) return null;
  let p; try { p = spawn('ping', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; }
  let buf = '', got = 0, lost = 0, maxSeq = 0;
  p.on('error', () => {});
  p.stdout.on('data', (d) => {
    buf += d; const lines = buf.split('\n'); buf = lines.pop();
    for (const l of lines) {
      const r = parsePingLine(l); if (!r) continue;
      if (r.seq) maxSeq = Math.max(maxSeq, r.seq);
      if (r.lost) lost++; else got++;
      onLine(r);
    }
  });
  return { stop() { try { p.kill(); } catch {} return { sent: Math.max(maxSeq, got + lost), got }; } };
}
