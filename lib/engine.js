// Switchboard's own model engine (Nov 13 2026). Switchboard runs one AI model
// on this computer itself, with llama.cpp's llama-server, and owns the graphics
// card while it does: Jarvis and Sessions' Local AI sessions (bin/localchat.mjs) both
// talk to it, so two models never fight over the card's memory.
//
// Why: Jarvis loaded Gemma (9 GB) through LM Studio while Bionic, LM Studio's
// chat app, tried to load the owner's Qwen beside it; a 12 GB card cannot hold both
// and the load failed with "unable to allocate CUDA0 buffer" (Nov 12 and 13).
// Now there is one model, one engine and one referee (docs/DECISIONS.md).
//
// - The engine: llama-server from LM Studio's own engines folder (the newest
//   one for this computer, with the libraries it ships with), or one on the
//   PATH, or a path set in Settings. Nothing new is installed.
// - The settings are measured, not guessed (Nov 13, RTX 4070 12 GB, Qwen3.6
//   35B-A3B Q4_K_M): --fit sizes the load to the card's free memory (the parts
//   that do not fit run from system memory), big batches read a long prompt
//   about 3.5 times faster (428 to 1536 tokens a second), and a 32k context
//   keeps it at about 57 words a second; 64k and 128k cost a third to a half of
//   that, so they are a choice in the page, said plainly.
// - Before it starts, models LM Studio or Bionic hold are unloaded: Switchboard
//   owns the card. Other programs on the card (a game, ComfyUI) are not touched;
//   the page says what they hold and that the model runs slower beside them.
// - It stops by itself after a few idle minutes (AGENTS.md: no model sits on
//   the card unused), never while it is answering, and starts again on the next
//   question (6 to 15 seconds).
// - It listens on 127.0.0.1 with a key made fresh at each start, so only
//   Switchboard can talk to it. The model never reaches the internet.
import { spawn, execFile, execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync, readFileSync, writeFileSync, rmSync, openSync, closeSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, cpus } from 'node:os';
import { join, basename, dirname, delimiter } from 'node:path';
import { randomBytes } from 'node:crypto';
import { getSetting, setSetting, DATA_DIR } from './db.js';
import { loadedModels, unloadModels } from './lmloaded.js';

export const CONTEXTS = [16384, 32768, 65536, 131072];
export const DEFAULTS = { ctx: 32768, idleMin: 10 };
const STATE_FILE = join(DATA_DIR, 'engine.json');
const LOG_FILE = join(DATA_DIR, 'engine.log');
const OS = process.platform;
const EXE = OS === 'win32' ? 'llama-server.exe' : 'llama-server';

// ---------- finding the engine

// Version numbers in a folder name ("…-avx2-2.73.0"), for picking the newest.
const ver = (name) => (String(name).match(/(\d+)\.(\d+)\.(\d+)$/) || [0, 0, 0, 0]).slice(1).map(Number);
const newer = (a, b) => { const x = ver(a), y = ver(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return y[i] - x[i]; return 0; };
// The best of LM Studio's engines for this computer: the graphics card's own
// (CUDA), then Vulkan, then the processor; on a Mac, Metal. Newest first.
const PREFER = {
  linux: [/^llama\.cpp-linux-x86_64-nvidia-cuda12-/, /^llama\.cpp-linux-x86_64-nvidia-cuda-/, /^llama\.cpp-linux-x86_64-vulkan-/, /^llama\.cpp-linux-x86_64-avx2-/, /^llama\.cpp-linux-arm64-/],
  darwin: [/^llama\.cpp-mac-arm64-/, /^llama\.cpp-mac-/],   // unverified
  win32: [/^llama\.cpp-win-x86_64-nvidia-cuda12-/, /^llama\.cpp-win-x86_64-nvidia-cuda-/, /^llama\.cpp-win-x86_64-vulkan-/, /^llama\.cpp-win-x86_64-avx2-/]   // unverified
};
export function pickBackend(names, os = OS) {
  for (const re of PREFER[os] || []) {
    const hits = names.filter((n) => re.test(n)).sort(newer);
    if (hits.length) return hits[0];
  }
  return null;
}
const onPath = (cmd) => { try { return String(execFileSync(OS === 'win32' ? 'where' : 'which', [cmd], { stdio: ['ignore', 'pipe', 'ignore'] })).split('\n')[0].trim() || null; } catch { return null; } };

// { bin, libs: [folders the engine loads its libraries from], name } or null.
export function findEngine(home = homedir()) {
  const set = String(getSetting('engine', {})?.bin || '');
  if (set && existsSync(set)) return { bin: set, libs: [dirname(set)], name: basename(dirname(set)) };
  const root = join(home, '.lmstudio', 'extensions', 'backends');
  let names = []; try { names = readdirSync(root); } catch {}
  const pick = pickBackend(names.filter((n) => existsSync(join(root, n, EXE))));
  if (pick) {
    const dir = join(root, pick);
    let vendor = [];
    try { vendor = JSON.parse(readFileSync(join(dir, 'backend-manifest.json'), 'utf8')).vendor_lib_package_names || []; } catch {}
    return { bin: join(dir, EXE), libs: [dir, ...vendor.map((v) => join(root, 'vendor', v)).filter(existsSync)], name: pick };
  }
  const p = onPath('llama-server');
  return p ? { bin: p, libs: [], name: 'llama-server' } : null;
}

// ---------- the models on this computer

// GGUF model files in LM Studio's models folder (where Bionic and LM Studio
// download them): the first part of a split file only, never the picture
// reader (mmproj) or an embedding model, which cannot chat.
export function modelsIn(root = join(homedir(), '.lmstudio', 'models')) {
  const out = [];
  const walk = (dir, depth) => {
    let ents = []; try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    const files = ents.filter((e) => e.isFile() && /\.gguf$/i.test(e.name)).map((e) => e.name);
    const mmproj = files.filter((f) => /^mmproj/i.test(f)).sort((a, b) => (/f16|bf16/i.test(b) ? 1 : 0) - (/f16|bf16/i.test(a) ? 1 : 0))[0] || null;
    for (const f of files) {
      if (/^mmproj/i.test(f) || /embed|rerank|whisper/i.test(f) || /-0000[2-9]-of-|-000[1-9]\d-of-/i.test(f)) continue;
      let size = 0; try { size = statSync(join(dir, f)).size; } catch {}
      out.push({ path: join(dir, f), name: modelLabel(f), file: f, size, vision: mmproj ? join(dir, mmproj) : null });
    }
    if (depth < 3) for (const e of ents) if (e.isDirectory()) walk(join(dir, e.name), depth + 1);
  };
  walk(root, 0);
  return out.sort((a, b) => b.size - a.size);
}
// "Qwen3.6-35B-A3B-uncensored-heretic-Q4_K_M.gguf" -> "Qwen3.6 35B A3B uncensored heretic"
export function modelLabel(file) {
  return String(file).replace(/\.gguf$/i, '').replace(/-0+1-of-\d+$/i, '').replace(/[-_.](i?q\d[\w]*|f16|bf16|f32|qat)$/i, '').replace(/[-_.](i?q\d[\w]*|f16|bf16|qat)$/i, '').replace(/[-_]+/g, ' ').trim();
}

// What Switchboard runs: the model chosen in the page, else the biggest one here
// (the best this computer has; --fit makes it fit), and its settings.
export function config() {
  const s = getSetting('engine', {}) || {};
  const models = modelsIn();
  const model = models.find((m) => m.path === s.model) || models[0] || null;
  return {
    model, models,
    ctx: CONTEXTS.includes(Number(s.ctx)) ? Number(s.ctx) : DEFAULTS.ctx,
    idleMin: Math.min(60, Math.max(2, Number(s.idleMin) || DEFAULTS.idleMin)),
    system: String(s.system || '').slice(0, 4000),
    vision: s.vision !== false
  };
}
export function saveConfig(b = {}) {
  const s = { ...(getSetting('engine', {}) || {}) };
  if (b.model !== undefined) { if (!modelsIn().some((m) => m.path === b.model)) throw Object.assign(new Error('That model file is not in the models folder any more. Pick another.'), { status: 400 }); s.model = b.model; }
  if (b.ctx !== undefined) { if (!CONTEXTS.includes(Number(b.ctx))) throw Object.assign(new Error('Pick one of the memory sizes shown.'), { status: 400 }); s.ctx = Number(b.ctx); }
  if (b.idleMin !== undefined) s.idleMin = Math.min(60, Math.max(2, Number(b.idleMin) || DEFAULTS.idleMin));
  if (b.system !== undefined) s.system = String(b.system).slice(0, 4000);
  if (b.vision !== undefined) s.vision = !!b.vision;
  setSetting('engine', s);
  return config();
}

// The command line, from what was measured (top of this file).
export function engineArgs({ model, mmproj, ctx, port, key, threads }) {
  return [
    '--model', model, ...(mmproj ? ['--mmproj', mmproj] : []),
    '--host', '127.0.0.1', '--port', String(port), '--api-key', key, '--no-webui', '--jinja',
    '--fit', 'on', '--fit-target', '1024', '--ctx-size', String(ctx), '--parallel', '1',
    '--batch-size', '4096', '--ubatch-size', '4096', '--flash-attn', 'on', '--threads', String(threads)
  ];
}
export const threadsFor = (n = cpus().length) => Math.max(4, Math.min(12, Math.floor(n / 2)));

// ---------- the graphics card

// The card's memory and who else holds it (nvidia-smi; null where there is none).
export const cardInfo = () => new Promise((resolve) => execFile('nvidia-smi', ['--query-gpu=name,memory.used,memory.total', '--format=csv,noheader,nounits'], { timeout: 4000, windowsHide: true }, (err, out) => {
  if (err) return resolve(null);
  const [name, used, total] = String(out).split('\n')[0].split(',').map((s) => s.trim());
  execFile('nvidia-smi', ['--query-compute-apps=pid,process_name,used_memory', '--format=csv,noheader,nounits'], { timeout: 4000, windowsHide: true }, (e2, apps) => {
    const others = e2 ? [] : String(apps).split('\n').map((l) => l.split(',').map((s) => s.trim())).filter((f) => Number(f[0]) && Number(f[0]) !== state.pid)
      .map(([pid, p, mb]) => ({ pid: Number(pid), name: appName(p), mb: Number(mb) || 0 }));
    resolve({ name, usedMb: Number(used) || 0, totalMb: Number(total) || 0, others });
  });
}));
const appName = (p) => { const b = basename(String(p || '')); return /llama-server/i.test(b) ? 'another model (LM Studio or Bionic)' : /comfy|python/i.test(b) ? 'a Python program (ComfyUI or similar)' : b || 'another program'; };

// ---------- running it

let state = { status: 'off', pid: null, port: null, key: null, model: null, ctx: null, startedAt: 0, error: '' };
let starting = null, inflight = 0, lastUse = 0;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const save = () => { try { writeFileSync(STATE_FILE, JSON.stringify({ pid: state.pid, port: state.port, key: state.key, model: state.model, ctx: state.ctx, startedAt: state.startedAt }), { mode: 0o600 }); } catch {} };
export const enginePid = () => (state.status === 'ready' || state.status === 'loading' ? state.pid : null);
export const touch = () => { lastUse = Date.now(); };
export function begin() { inflight++; touch(); }
export function end() { inflight = Math.max(0, inflight - 1); touch(); }

// One left running before Switchboard restarted (an update): taken over if it answers.
export async function adopt() {
  let s; try { s = JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { return; }
  if (s?.pid && alive(s.pid) && await healthy(s.port, s.key)) { state = { ...s, status: 'ready', error: '' }; touch(); console.log('[engine] took over the running model'); }
  else rmSync(STATE_FILE, { force: true });
}
async function healthy(port, key) {
  try { return (await fetch(`http://127.0.0.1:${port}/health`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(1500) })).ok; } catch { return false; }
}
const freePort = () => new Promise((resolve, reject) => { const s = createServer(); s.unref(); s.on('error', reject); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

// What a failed start says, in plain words, from the end of the engine's log.
export function whyFailed(log, { model = 'the model', others = [] } = {}) {
  const t = String(log || '');
  const held = others.length ? ` Also on the card: ${others.map((o) => `${o.name} (${(o.mb / 1024).toFixed(1)} GB)`).join(', ')}.` : '';
  if (/cudaMalloc failed|unable to allocate CUDA|out of memory|failed to allocate .*buffer/i.test(t)) return `The graphics card ran out of room loading ${model}.${held} Close what else is using the card, or pick a smaller memory size, then press Start.`;
  if (/failed to (open|read)|no such file|invalid magic|failed to load model/i.test(t)) return `${model} could not be read. The file may be damaged or still downloading: download it again, or pick another model.`;
  if (/unknown (model )?architecture|unsupported/i.test(t)) return `This engine does not know how to run ${model}. Update LM Studio's engine (or Bionic) once so it brings a newer one, then press Start.`;
  if (/error while loading shared libraries|cannot open shared object/i.test(t)) return 'The engine is missing a library it needs. Open LM Studio or Bionic once so it finishes installing its engine, then press Start.';
  if (/address already in use/i.test(t)) return 'The engine could not open its port. Press Start again.';
  return `${model} did not start. Press Start to try again; if it keeps failing, the engine's own words are in its log (Switchboard's data folder, engine.log).`;
}

// Free the card for Switchboard's model: models LM Studio or Bionic hold go
// (Switchboard owns the card; Nov 13 2026). Returns what was unloaded.
async function clearCard() {
  const held = (await loadedModels().catch(() => [])).filter((m) => m.pid !== state.pid);
  const gone = [];
  for (const m of held) { const r = await unloadModels({ id: m.id }).catch(() => ({ ok: false })); if (r.ok) gone.push(m.name); }
  if (gone.length) console.log(`[engine] made room on the card: unloaded ${gone.join(', ')}`);
  return gone;
}

// Running and answering, starting it if need be. Resolves to the state, or throws in plain words.
export function ensure() {
  if (state.status === 'ready' && state.pid && alive(state.pid)) { touch(); return Promise.resolve(state); }
  if (starting) return starting;
  starting = start().finally(() => { starting = null; });
  return starting;
}
async function start() {
  const eng = findEngine(), cfg = config();
  if (!eng) throw new Error('There is no model engine on this computer. Install LM Studio (or Bionic) once: Switchboard uses the engine it brings and runs the model itself.');
  if (!cfg.model) throw new Error('There is no model downloaded yet. Download one in LM Studio or Bionic (a GGUF file), then press Start here.');
  state = { status: 'loading', pid: null, port: null, key: null, model: cfg.model.path, ctx: cfg.ctx, startedAt: Date.now(), error: '' };
  await clearCard();
  const port = await freePort(), key = randomBytes(24).toString('base64url');
  const args = engineArgs({ model: cfg.model.path, mmproj: cfg.vision ? cfg.model.vision : null, ctx: cfg.ctx, port, key, threads: threadsFor() });
  const libVar = OS === 'win32' ? 'PATH' : OS === 'darwin' ? 'DYLD_LIBRARY_PATH' : 'LD_LIBRARY_PATH';
  const env = { ...process.env, [libVar]: [...eng.libs, process.env[libVar] || ''].filter(Boolean).join(delimiter) };
  const fd = openSync(LOG_FILE, 'w', 0o600);
  const child = spawn(eng.bin, args, { env, stdio: ['ignore', fd, fd], detached: true, windowsHide: true, cwd: dirname(eng.bin) });
  closeSync(fd);
  child.unref();
  let exited = false;
  child.on('exit', () => { exited = true; if (state.pid === child.pid && state.status === 'ready') { state = { ...state, status: 'off', pid: null }; rmSync(STATE_FILE, { force: true }); console.warn('[engine] the model stopped on its own'); } });
  child.on('error', () => { exited = true; });
  state = { ...state, pid: child.pid, port, key };
  for (let i = 0; i < 360; i++) {   // up to 3 minutes: a big model read from a slow disk
    if (exited || !alive(child.pid)) break;
    if (await healthy(port, key)) { state = { ...state, status: 'ready' }; save(); touch(); console.log(`[engine] ${cfg.model.name} ready in ${((Date.now() - state.startedAt) / 1000).toFixed(1)} s`); return state; }
    await new Promise((r) => setTimeout(r, 500));
  }
  try { process.kill(child.pid, 'SIGKILL'); } catch {}
  let log = ''; try { log = readFileSync(LOG_FILE, 'utf8').slice(-6000); } catch {}
  const error = whyFailed(log, { model: cfg.model.name, others: (await cardInfo())?.others || [] });
  state = { status: 'error', pid: null, port: null, key: null, model: cfg.model.path, ctx: cfg.ctx, startedAt: 0, error };
  throw new Error(error);
}

export async function stop(why = 'asked') {
  const pid = state.pid;
  state = { status: 'off', pid: null, port: null, key: null, model: state.model, ctx: state.ctx, startedAt: 0, error: '' };
  rmSync(STATE_FILE, { force: true });
  if (!pid || !alive(pid)) return;
  try { process.kill(pid, 'SIGTERM'); } catch {}
  for (let i = 0; i < 20 && alive(pid); i++) await new Promise((r) => setTimeout(r, 250));
  if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch {}
  console.log(`[engine] stopped (${why})`);
}

// Is it answering anything right now? Our own count, and the engine's slots.
async function busy() {
  if (inflight > 0) return true;
  try {
    const r = await fetch(`http://127.0.0.1:${state.port}/slots`, { headers: { Authorization: `Bearer ${state.key}` }, signal: AbortSignal.timeout(2000) });
    return r.ok && (await r.json()).some((s) => s.is_processing);
  } catch { return false; }
}
// Every minute (server.js): stopped once unused for the idle minutes, never while busy.
export async function sweep(now = Date.now()) {
  if (state.status !== 'ready') return false;
  if (state.pid && !alive(state.pid)) { state = { ...state, status: 'off', pid: null }; rmSync(STATE_FILE, { force: true }); return true; }
  if (now - lastUse < config().idleMin * 60e3 || await busy()) return false;
  await stop(`unused for ${config().idleMin} minutes`);
  return true;
}

// A chat request to the running engine (starting it first). Gives the fetch
// Response; the caller reads it and calls end() when done (begin() is called here).
export async function chat(body, { signal } = {}) {
  await ensure();
  begin();
  try {
    const r = await fetch(`http://127.0.0.1:${state.port}/v1/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.key}` },
      body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15 * 60e3)]) : AbortSignal.timeout(15 * 60e3)
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      end();
      if (/exceed|context|too long/i.test(t)) throw new Error('This conversation is longer than the model\'s memory. Start a new chat, or pick a bigger memory size.');
      throw new Error(`The model could not answer (it said ${r.status}). Try again; if it keeps happening, press Stop, then Start.`);
    }
    return r;
  } catch (e) { if (inflight) end(); throw e; }
}

// What the page shows.
export async function status() {
  const cfg = config(), eng = findEngine();
  const running = cfg.models.find((m) => m.path === state.model);
  return {
    engine: eng ? eng.name : null,
    status: state.status, error: state.error,
    model: cfg.model ? { path: cfg.model.path, name: cfg.model.name, size: cfg.model.size, vision: !!cfg.model.vision && cfg.vision } : null,
    running: state.status === 'ready' && running ? { name: running.name, ctx: state.ctx, since: state.startedAt, vision: !!running.vision && cfg.vision } : null,
    models: cfg.models.map((m) => ({ path: m.path, name: m.name, size: m.size, vision: !!m.vision })),
    ctx: cfg.ctx, contexts: CONTEXTS, idleMin: cfg.idleMin, system: cfg.system,
    idleFor: state.status === 'ready' && !inflight ? Math.floor((Date.now() - lastUse) / 60e3) : null,
    card: await cardInfo()
  };
}
// For the board (server.js): whether it is loaded, for the session bar's light and Unload.
export const brief = () => ({ status: state.status, name: state.model && (state.status === 'ready' || state.status === 'loading') ? modelLabel(basename(state.model)) : null });
export const usable = () => !!findEngine() && !!config().model;
