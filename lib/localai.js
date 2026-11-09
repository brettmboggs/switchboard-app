// AI models running on this computer: Ollama, LM Studio (and anything else that
// serves the OpenAI-style /v1/models on localhost, such as llama.cpp's server).
// Free and private by nature: nothing leaves the computer. Ollama's and LM
// Studio's downloaded models become kinds of session ("ollama run <model>",
// "lms chat <model>" in a terminal); the others are listed so a person can see
// what is running. Only 127.0.0.1 is ever asked, on the ports these tools use
// by default.
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const SERVERS = [
  { id: 'ollama', name: 'Ollama', url: 'http://127.0.0.1:11434', list: '/api/tags' },
  { id: 'lmstudio', name: 'LM Studio', url: 'http://127.0.0.1:1234', list: '/v1/models' },
  { id: 'lmstudio', name: 'LM Studio', url: 'http://127.0.0.1:1235', list: '/v1/models' },   // its newer app (Bionic) often takes 1235
  { id: 'llamacpp', name: 'llama.cpp server', url: 'http://127.0.0.1:8080', list: '/v1/models' },
  { id: 'jan', name: 'Jan', url: 'http://127.0.0.1:1337', list: '/v1/models' }
];
// Models people start with: small enough for an ordinary laptop.
export const STARTERS = [
  { model: 'llama3.2', what: 'Meta Llama 3.2, 3B: quick, everyday questions (2 GB)' },
  { model: 'qwen2.5-coder:7b', what: 'Qwen 2.5 Coder, 7B: code (4.7 GB)' },
  { model: 'gemma3:4b', what: 'Google Gemma 3, 4B: writing and summaries (3.3 GB)' }
];
// An Ollama model name: letters, digits and . _ - : / (as in "qwen2.5-coder:7b" or "hf.co/org/model:Q4").
export const MODEL_NAME = /^[a-z0-9][a-z0-9._:/-]{0,79}$/i;

const onPath = (cmd) => { try { execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; } };

// The models one server has, or null when nothing answers there.
export function modelsFrom(server, json) {
  if (server.id === 'ollama') return (json?.models || []).map((m) => ({ id: String(m.name || m.model || ''), size: Number(m.size) || null })).filter((m) => MODEL_NAME.test(m.id));
  return (json?.data || []).map((m) => ({ id: String(m.id || ''), size: null })).filter((m) => m.id);
}

// LM Studio's command-line tool, lms: on the PATH, or where LM Studio puts it
// (~/.lmstudio/bin on every system). Null when LM Studio is not installed.
export function lmsPath() {
  if (onPath('lms')) return 'lms';
  const f = join(homedir(), '.lmstudio', 'bin', process.platform === 'win32' ? 'lms.exe' : 'lms');
  return existsSync(f) ? f : null;
}
// The chat models in `lms ls --json` (embedding models cannot chat).
export function lmsModelsFrom(json) {
  return (Array.isArray(json) ? json : []).filter((m) => m && m.type === 'llm')
    .map((m) => ({ id: String(m.modelKey || ''), name: String(m.displayName || m.modelKey || ''), size: Number(m.sizeBytes) || null }))
    .filter((m) => MODEL_NAME.test(m.id));
}
// What is in LM Studio's models folder, cheaply: asking lms wakes LM Studio's
// background service, so it is asked only when this changes.
function lmsFingerprint() {
  const dir = join(homedir(), '.lmstudio', 'models');
  try { return readdirSync(dir).map((p) => { try { return p + ':' + readdirSync(join(dir, p)).join(',') + ':' + statSync(join(dir, p)).mtimeMs; } catch { return p; } }).join('|'); } catch { return ''; }
}
let lms = { print: null, models: [] };
function refreshLms(bin) {
  const print = lmsFingerprint();
  if (print === lms.print) return Promise.resolve();
  return new Promise((resolve) => execFile(bin, ['ls', '--json'], { timeout: 30000, windowsHide: true }, (err, out) => {
    if (!err) { try { lms = { print, models: lmsModelsFrom(JSON.parse(String(out).slice(String(out).indexOf('[')))) }; } catch {} }
    resolve();
  }));
}

let state = { at: 0, ollamaInstalled: false, lmstudio: null, servers: [] };
export const localAI = () => state;
export const ollamaModels = () => state.servers.find((s) => s.id === 'ollama')?.models || [];
export const lmstudioModels = () => state.lmstudio?.models || [];

// Ask each server what it has, briefly (each tries for at most a second).
export async function pollLocalAI() {
  const servers = [];
  for (const s of SERVERS) {
    try {
      const r = await fetch(s.url + s.list, { signal: AbortSignal.timeout(1000) });
      if (!r.ok) continue;
      servers.push({ id: s.id, name: s.name, models: modelsFrom(s, await r.json()) });
    } catch {}
  }
  const bin = lmsPath();
  if (bin) await refreshLms(bin);
  const lmstudio = bin ? { bin, models: lms.models } : null;
  const before = JSON.stringify([state.servers, state.lmstudio]);
  state = { at: Date.now(), ollamaInstalled: onPath('ollama'), lmstudio, servers };
  return JSON.stringify([servers, lmstudio]) !== before;
}
