// What LM Studio has loaded right now, and unloading it on a click (Settings,
// Connections, Local AI models; Jarvis's "unload models").
//
// The rule (Nov 12 2026): a model Jarvis loads carries a time limit (--ttl)
// and the sweeper in lib/jarvis.js unloads it after a few idle minutes. A model
// the person loaded themselves in LM Studio has no time limit and is never
// unloaded on its own: it goes when they press Unload here. After NUDGE_MIN idle
// minutes the card says so, quietly; it still does nothing by itself.
import { execFile } from 'node:child_process';
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
      size: Number(m.sizeBytes) || null, status, idleMin,
      auto: !!ttl,                                            // loaded by Jarvis: unloads itself
      nudge: !ttl && idleMin != null && idleMin >= NUDGE_MIN  // loaded by hand and sitting unused
    };
  });
}

const run = (args, timeout) => new Promise((resolve) => {
  const lms = lmsPath();
  if (!lms) return resolve({ ok: false, out: '' });
  execFile(lms, args, { timeout, windowsHide: true }, (err, out) => resolve({ ok: !err, out: String(out || '') }));
});

// The models loaded now. On Linux, when no model process runs, nothing is
// loaded and LM Studio is not asked (asking wakes its background service).
export async function loadedModels() {
  if (!lmsPath()) return [];
  if (process.platform === 'linux' && !lmModelPids().length) return [];
  const r = await run(['ps', '--json'], 15000);
  try { return loadedFrom(JSON.parse(r.out.slice(r.out.indexOf('[')))); } catch { return []; }
}

// Unload one model (by the id LM Studio reports) or all of them. Only an id that
// is loaded right now is passed to lms, so nothing else can be run this way.
export async function unloadModels({ id, all } = {}) {
  if (!lmsPath()) return { ok: false, error: 'LM Studio is not installed on this computer.', loaded: [] };
  const before = await loadedModels();
  if (!all) {
    if (!before.some((m) => m.id === id)) return { ok: false, error: 'That model is not loaded any more.', loaded: before };
  } else if (!before.length) return { ok: true, message: 'Nothing was loaded.', loaded: [] };
  const r = await run(all ? ['unload', '--all'] : ['unload', id], 60000);
  const loaded = await loadedModels();
  const gone = all ? !loaded.length : !loaded.some((m) => m.id === id);
  if (!r.ok && !gone) return { ok: false, error: 'LM Studio did not unload it. Open LM Studio and unload it there, or try again.', loaded };
  const name = all ? `${before.length} model${before.length === 1 ? '' : 's'}` : before.find((m) => m.id === id).name;
  return { ok: true, message: `Unloaded ${name}.`, loaded };
}
