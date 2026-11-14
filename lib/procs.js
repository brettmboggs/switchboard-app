// Ending apps from the System monitor (Settings, System): what each process is
// in plain words, whether it is safe to end, and ending it. Linux first: it
// reads /proc, which says who started a process, where, with what command, and
// which Switchboard session it belongs to (SWITCHBOARD_TERM, lib/terminals.js).
// On a Mac or Windows the monitor shows the numbers only and offers no End
// (CAN_END), until someone can test it there.
//
// Every process gets one of three labels:
//   keep   part of the system or the desktop, Switchboard itself, or tmux (which
//          holds every session): no End button, and the server refuses it too
//   ask    work in progress: a Claude session and what it started, a browser
//          (every window goes), an editor (unsaved work), a model LM Studio
//          loaded, anything busy right now: End asks "sure?" first
//   safe   started by you and idle: End goes straight through
// End asks politely first (SIGTERM to the top processes, then to the rest);
// whatever is still there after 5 seconds is reported back, and Force end
// (SIGKILL) is the person's second click. Nothing here ever ends a process that
// is not the person's own.
import { readFileSync, readdirSync, readlinkSync } from 'node:fs';
import { execFile } from 'node:child_process';
import os from 'node:os';

export const CAN_END = process.platform === 'linux';
const MY_UID = typeof process.getuid === 'function' ? process.getuid() : null;
const HOME = os.homedir();
const GB = 1073741824;
const read = (f, enc = 'utf8') => { try { return readFileSync(f, enc); } catch { return null; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = (p) => String(p || '').split('/').filter(Boolean).pop() || '';

// ---------- pure parts (test/procs.test.js feeds them text)

const SYSTEM = /^(Xorg|Xwayland|systemd.*|\(sd-pam\)|dbus-.*|pipewire.*|wireplumber|pulseaudio|cinnamon.*|csd-.*|gnome-shell.*|gnome-session.*|gnome-keyring.*|gsd-.*|gvfs.*|at-spi.*|xdg-.*|nemo-desktop|polkit.*|ibus.*|mutter.*|muffin|kwin.*|plasmashell|ksmserver|kded\d*|lightdm.*|gdm.*|sddm.*|Xsession|tracker-.*|evolution-.*|goa-.*|dconf-service|ssh-agent|gpg-agent|nm-applet|blueman.*|xapp-.*|mintUpdate|mintreport.*|xfce4-.*|xfwm4|xfdesktop|picom|compton|dunst|notification-daemon|obexd|snapd.*|gnome-terminal-server|xdg-desktop-portal.*)$/i;
const BROWSERS = /^(chrome|chromium.*|brave|firefox|firefox-bin|msedge|vivaldi.*|opera|thorium)$/i;
const EDITORS = /^(code|cursor|windsurf|gimp.*|inkscape|soffice.*|libreoffice.*|blender|krita|kdenlive|obs|audacity|darktable|rawtherapee|gedit|xed|kate|zed|sublime_text|figma.*|photocraft.*)$/i;
const AGENTS = /^(claude|codex|gemini|aider|opencode)$/i;
const AI_APPS = /^(bionic|lm ?studio|lms|ollama|ollama_llama_se.*|llama-server|jan|gpt4all|koboldcpp)$/i;
const INTERP = /^(python[\d.]*|node|nodejs|bun|deno|ruby|perl|java|php|sh|bash|zsh|dash|fish|tsx|ts-node)$/;
const LM_MODEL = /[\\/]\.lmstudio[\\/]extensions[\\/]backends[\\/].*llama-server$/;

// A folder in short: under home it starts at the first folder that is not a
// usual code folder (~/dev/shop/web is "shop/web"); elsewhere its last two parts.
export function shortFolder(cwd, home = HOME) {
  if (!cwd || cwd === '/' || cwd === home) return null;
  let parts;
  if (cwd.startsWith(home + '/')) {
    parts = cwd.slice(home.length + 1).split('/');
    while (parts.length > 1 && /^(dev|code|src|projects|repos|source|work|github|documents)$/i.test(parts[0])) parts.shift();
  } else parts = cwd.split('/').filter(Boolean);
  return parts.slice(-2).join('/') || null;
}

// What a process is, in a few words: the program, or for a script the script
// ("vite in shop/web", "main.py in ComfyUI"); a browser's helper by its role.
export function describe(argv, cwd, name, home = HOME) {
  let a = (argv || []).filter((x) => x !== '');
  if (!a.length) return name;                                   // a kernel thread
  if (a.length === 1 && /\s/.test(a[0])) a = a[0].trim().split(/\s+/);   // a program that rewrote its own title (Chrome, npm)
  let what = base(a[0]) || name;
  if (INTERP.test(what)) {
    let i = 1;
    for (; i < a.length; i++) {
      if (a[i] === '-m' && a[i + 1]) { what = a[i + 1]; i = -1; break; }
      if (a[i] === '-c' || a[i] === '-e') { i = a.length; break; }
      if (!a[i].startsWith('-')) break;
    }
    if (i >= 0 && i < a.length) what = base(a[i]);
  }
  const type = a.find((x) => x.startsWith('--type='));
  if (type) what += ' ' + type.slice(7).replace(/-process$/, '');
  if (what.length > 40) what = what.slice(0, 39) + '…';
  const where = shortFolder(cwd, home);
  return where && !type ? `${what} in ${where}` : what;
}

// The label for one process. f: { name, uid, myUid, self, fromSb, inTmux, term, argv, cpu, ports }.
export function classify(f) {
  const name = String(f.name || '');
  if (f.self) return { level: 'keep', why: 'This is Switchboard itself.' };
  if (/^tmux/.test(name)) return { level: 'keep', why: 'Holds your Claude and terminal sessions; ending it would end them all.' };
  if (f.myUid != null && f.uid !== f.myUid) return { level: 'keep', why: 'Part of the system: it runs as the system, not as you.' };
  if (SYSTEM.test(name)) return { level: 'keep', why: 'Part of your desktop.' };
  if (f.term) return { level: 'ask', why: `Belongs to your ${String(f.term).replace(/^sb-/, '')} session, which may be using it.` };
  if (f.fromSb) return { level: 'ask', why: 'Switchboard started it and may be using it.' };
  if (AGENTS.test(name) || AGENTS.test(base(f.argv?.[0]))) return { level: 'ask', why: 'An AI agent session; ending it stops its work.' };
  if (f.inTmux) return { level: 'ask', why: 'Runs in a terminal session, which may be using it.' };
  if (LM_MODEL.test(f.argv?.[0] || '')) return { level: 'ask', why: 'A model LM Studio loaded; Unload in Settings, Local AI is gentler.' };
  if (AI_APPS.test(name)) return { level: 'ask', why: 'An AI app; it may have a model loaded or a reply on the way.' };
  if (BROWSERS.test(name)) return { level: 'ask', why: 'Closes every window and tab it has open.' };
  if (EDITORS.test(name)) return { level: 'ask', why: 'It may have unsaved work.' };
  if (f.cpu >= 5) return { level: 'ask', why: `Busy right now (${Math.round(f.cpu)}% of the processor).` };
  if (f.ports?.length) return { level: 'safe', why: `Idle; it serves port ${f.ports.slice(0, 3).join(', ')}.` };
  return { level: 'safe', why: 'Idle, and started by you.' };
}
const RANK = { safe: 0, ask: 1, keep: 2 };
export const worst = (labels) => labels.reduce((w, l) => (RANK[l.level] > RANK[w.level] ? l : w), { level: 'safe', why: 'Idle, and started by you.' });

// The process table at the bottom of `nvidia-smi`: video memory by pid.
export function parseNvidiaProcs(text) {
  const out = new Map();
  for (const l of String(text || '').split('\n')) {
    const m = /^\|\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(?:C|G|C\+G)\s+.*?(\d+)MiB\s*\|$/.exec(l);
    if (m) out.set(Number(m[1]), (out.get(Number(m[1])) || 0) + Number(m[2]) * 1048576);
  }
  return out;
}

// Listening TCP sockets in /proc/net/tcp(6): socket inode -> port.
export function parseListen(text) {
  const out = new Map();
  for (const l of String(text || '').split('\n').slice(1)) {
    const f = l.trim().split(/\s+/);
    if (f.length < 10 || f[3] !== '0A') continue;
    out.set(f[9], parseInt(f[1].split(':').pop(), 16));
  }
  return out;
}

// ---------- reading /proc

// What does not change while a process lives, kept per pid and start.
const factsCache = new Map();
function facts(pid, start) {
  const key = `${pid}:${start}`;
  let f = factsCache.get(key);
  if (f) return f;
  const status = read(`/proc/${pid}/status`) || '';
  const uid = Number(/^Uid:\s+(\d+)/m.exec(status)?.[1] ?? -1);
  const argv = (read(`/proc/${pid}/cmdline`) || '').split('\0').filter(Boolean);
  let cwd = null; try { cwd = readlinkSync(`/proc/${pid}/cwd`); } catch {}
  let term = null;
  if (uid === MY_UID) { const env = read(`/proc/${pid}/environ`, 'latin1') || ''; term = /(?:^|\0)SWITCHBOARD_TERM=([^\0]+)/.exec(env)?.[1] || null; }
  f = { uid, argv, cwd, term };
  factsCache.set(key, f);
  return f;
}
// Drop what is cached for processes that are gone.
export function forgetGone(procs) {
  const live = new Set(procs.map((p) => `${p.pid}:${p.start}`));
  for (const k of factsCache.keys()) if (!live.has(k)) factsCache.delete(k);
}

// Is this process Switchboard, or inside tmux? Walk up its parents.
function lineage(pid, byPid) {
  let fromSb = false, inTmux = false, p = byPid.get(pid), n = 0;
  while (p && n++ < 64) {
    if (p.pid !== pid && p.pid === process.pid) fromSb = true;
    if (p.pid !== pid && /^tmux/.test(p.name)) inTmux = true;
    p = byPid.get(p.ppid);
  }
  return { self: pid === process.pid, fromSb, inTmux };
}

let gpuMap = { at: 0, map: new Map(), busy: null };
export async function gpuByPid() {
  if (!CAN_END) return new Map();
  if (Date.now() - gpuMap.at < 5000) return gpuMap.map;
  if (!gpuMap.busy) gpuMap.busy = new Promise((ok) => execFile('nvidia-smi', [], { timeout: 4000 }, (err, out) => ok(err ? '' : String(out))))
    .then((t) => { gpuMap = { at: Date.now(), map: parseNvidiaProcs(t), busy: null }; });
  await gpuMap.busy;
  return gpuMap.map;
}
export const gpuNow = () => gpuMap.map;

function listenMap() {
  const m = parseListen(read('/proc/net/tcp'));
  for (const [k, v] of parseListen(read('/proc/net/tcp6'))) m.set(k, v);
  return m;
}
function portsOf(pid, listen) {
  if (!listen.size) return [];
  const out = new Set();
  let fds = []; try { fds = readdirSync(`/proc/${pid}/fd`); } catch { return []; }
  for (const fd of fds) {
    let l; try { l = readlinkSync(`/proc/${pid}/fd/${fd}`); } catch { continue; }
    const m = /^socket:\[(\d+)\]$/.exec(l);
    if (m && listen.has(m[1])) out.add(listen.get(m[1]));
  }
  return [...out].sort((a, b) => a - b);
}

// One process in full, from the monitor's last reading (procs, with cpu).
function full(p, byPid, { listen, gpu } = {}) {
  const f = facts(p.pid, p.start);
  const { self, fromSb, inTmux } = lineage(p.pid, byPid);
  const ports = listen && f.uid === MY_UID ? portsOf(p.pid, listen) : [];
  const label = classify({ name: p.name, uid: f.uid, myUid: MY_UID, self, fromSb, inTmux, term: f.term, argv: f.argv, cpu: p.cpu, ports });
  const age = p.start != null ? Math.max(0, Math.round(os.uptime() - p.start / 100)) : null;
  return {
    pid: p.pid, start: p.start, ppid: p.ppid, name: p.name, what: describe(f.argv, f.cwd, p.name), cmd: f.argv.join(' ').slice(0, 400),
    folder: f.cwd, session: f.term ? f.term.replace(/^sb-/, '') : null, age, cpu: Math.round(p.cpu * 10) / 10, mem: p.mem,
    gpu: gpu?.get(p.pid) || 0, ports, ...label
  };
}

// The label of each app in the monitor's list and the video memory it holds.
// An app's label is the most careful one among its processes that can be
// ended (a stray keep, like Switchboard among many node processes, does not
// hide the rest); keep only when all of them are. Cheap after the first
// reading: the facts are cached.
export function appLabel(labels) {
  const open = labels.filter((l) => l.level !== 'keep');
  return open.length ? { ...worst(open), some: open.length < labels.length } : labels.length ? { level: 'keep', why: labels[0].why } : { level: null, why: null };
}
export function labelApps(apps, procs) {
  if (!CAN_END) return apps;
  const byPid = new Map(procs.map((p) => [p.pid, p])), gpu = gpuNow();
  return apps.map((a) => {
    const w = appLabel(a.pids.map((pid) => byPid.get(pid)).filter(Boolean).map((p) => full(p, byPid)));
    return { ...a, level: w.level, why: w.why, gpu: a.pids.reduce((s, pid) => s + (gpu.get(pid) || 0), 0) };
  });
}

// Something big and idle worth ending: your own, at least 2 GB (or a tenth of
// memory), no processor use right now, open half an hour or more. The biggest one.
export function hogOf(procs, total) {
  if (!CAN_END) return null;
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const min = Math.max(2 * GB, (total || 0) * 0.1);
  const big = procs.filter((p) => p.mem >= min && p.cpu < 1).sort((a, b) => b.mem - a.mem);
  for (const p of big) {
    const x = full(p, byPid);
    if (x.level === 'keep' || x.age == null || x.age < 1800) continue;
    return { pid: x.pid, start: x.start, name: x.name, what: x.what, mem: x.mem, age: x.age, level: x.level, why: x.why };
  }
  return null;
}

// One app (every process with that name), for its details view.
export async function appDetail(name, procs) {
  if (!CAN_END) return { name, canEnd: false, procs: [] };
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const listen = listenMap(), gpu = await gpuByPid();
  const list = procs.filter((p) => p.name === name).map((p) => full(p, byPid, { listen, gpu })).sort((a, b) => b.mem - a.mem || a.pid - b.pid);
  const w = appLabel(list);
  return {
    name, canEnd: true, count: list.length, level: w.level, why: w.why, some: !!w.some,
    cpu: Math.round(list.reduce((s, p) => s + p.cpu, 0) * 10) / 10, mem: list.reduce((s, p) => s + p.mem, 0), gpu: list.reduce((s, p) => s + p.gpu, 0),
    procs: list.slice(0, 60)
  };
}

// Apps that match a few words ("comfyui", "vite", "chrome"), for Jarvis: by
// name, by what they are, or by folder. Never the ones labelled keep.
export async function findApps(words, procs) {
  const q = String(words || '').toLowerCase().trim();
  if (!CAN_END || !q) return [];
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const all = procs.filter((p) => {
    if (p.name.toLowerCase().includes(q)) return true;
    const f = facts(p.pid, p.start);
    return f.argv.join(' ').toLowerCase().includes(q) || String(f.cwd || '').toLowerCase().includes(q);
  }).map((p) => full(p, byPid)).filter((x) => x.level !== 'keep');
  // By its name or what it is beats a word somewhere in a command line (the
  // shell that started vite mentions vite too).
  const strong = all.filter((x) => x.name.toLowerCase().includes(q) || x.what.toLowerCase().includes(q));
  const hits = strong.length ? strong : all;
  // A match's own children go with it (a browser's helpers, a server's workers).
  const ids = new Set(hits.map((x) => x.pid));
  return hits.filter((x) => !ids.has(x.ppid));
}

// ---------- ending

const alive = (pid, start) => {
  const s = read(`/proc/${pid}/stat`);
  if (!s) return false;
  if (start == null) return true;
  const rest = s.slice(s.lastIndexOf(')') + 2).split(' ');
  return Number(rest[19]) === Number(start);
};

// targets: [{ pid, start }] as the page saw them. force: SIGKILL now. sure: yes
// to the ones labelled ask. Returns { ended, left, refused, needSure } (pids).
export async function endProcs({ targets, force = false, sure = false }, procs, { wait = 5000 } = {}) {
  if (!CAN_END) return { error: 'Ending apps from Switchboard works on Linux so far.' };
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const want = (targets || []).map((t) => ({ pid: Number(t.pid ?? t), start: t.start ?? null })).filter((t) => Number.isInteger(t.pid) && t.pid > 1);
  const refused = [], needSure = [], go = [];
  for (const t of want) {
    if (!alive(t.pid, t.start)) continue;                 // already gone, or the pid now belongs to something else
    const p = byPid.get(t.pid) || { pid: t.pid, start: t.start, ppid: null, name: (read(`/proc/${t.pid}/comm`) || '').trim(), cpu: 0, mem: 0 };
    const x = full(p, byPid);
    if (x.level === 'keep') refused.push({ pid: t.pid, name: x.name, why: x.why });
    else if (x.level === 'ask' && !sure) needSure.push({ pid: t.pid, name: x.name, why: x.why });
    else go.push({ ...t, ppid: p.ppid });
  }
  if (needSure.length || !go.length) return { ended: [], left: [], refused, needSure };
  const ids = new Set(go.map((t) => t.pid));
  const send = (list, sig) => { for (const t of list) { try { process.kill(t.pid, sig); } catch {} } };
  if (force) send(go, 'SIGKILL');
  else send(go.filter((t) => !ids.has(t.ppid)), 'SIGTERM');   // the top ones first: they close their own helpers
  const until = Date.now() + (force ? 1500 : wait);
  let termedRest = force;
  while (Date.now() < until && go.some((t) => alive(t.pid, t.start))) {
    await sleep(200);
    if (!termedRest && Date.now() > until - wait + 1500) { send(go.filter((t) => alive(t.pid, t.start)), 'SIGTERM'); termedRest = true; }
  }
  const left = go.filter((t) => alive(t.pid, t.start));
  return { ended: go.filter((t) => !left.includes(t)).map((t) => t.pid), left: left.map((t) => ({ pid: t.pid, start: t.start })), refused, needSure };
}
