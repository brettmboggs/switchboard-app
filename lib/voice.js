// Talk to type: the page records 16 kHz audio and sends it here; whisper.cpp
// turns it into text on this computer. Installed by `node scripts/setup.mjs voice`,
// which Settings can start; its progress is read from that script's output.
import { execFile, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, rmSync, realpathSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, dirname } from 'node:path';
import { tmpdir, cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DATA_DIR } from './db.js';

const CONF = join(DATA_DIR, 'voice', 'voice.json');
const SETUP = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'setup.mjs');
let setup = { running: false, step: '', progress: 0, error: null };

function conf() {
  try { const c = JSON.parse(readFileSync(CONF, 'utf8')); return existsSync(c.exe) && existsSync(c.model) ? c : null; } catch { return null; }
}

export function voiceState() {
  return { ready: !!conf(), ...setup };
}

export function setupVoice(onChange) {
  if (setup.running || conf()) return;
  setup = { running: true, step: 'Starting', progress: 0, error: null };
  onChange();
  const p = spawn(process.execPath, [SETUP, 'voice'], { windowsHide: true });
  let last = 0;
  const read = (buf) => {
    for (const line of String(buf).split('\n')) {
      if (line.startsWith('step ')) { setup.step = line.slice(5); setup.progress = 0; }
      else if (line.startsWith('progress ')) setup.progress = Number(line.slice(9)) || 0;
      else if (line.startsWith('error ')) setup.error = line.slice(6);
    }
    if (Date.now() - last > 1000) { last = Date.now(); onChange(); }
  };
  p.stdout.on('data', read);
  p.stderr.on('data', read);
  p.on('close', (code) => {
    setup = { running: false, step: '', progress: 0, error: code === 0 ? null : (setup.error || 'Setup stopped.') };
    onChange();
  });
}

// Whisper makes things up in silence; these never come from real speech.
const NOISE = /\[[^\]]*\]|\((?:music|silence|blank[^)]*|inaudible|applause)\)/gi;

// whisper.cpp's own server keeps the model loaded, so each piece of speech costs
// only the listening, not a fresh start (most of the wait before). Started on the
// first use and kept running; whisper-cli is the fallback if it is missing.
let srv = null;   // { port, ready: Promise, proc }
function serverExe(c) {
  const name = process.platform === 'win32' ? 'whisper-server.exe' : 'whisper-server';
  for (const dir of [dirname(c.exe), (() => { try { return dirname(realpathSync(c.exe)); } catch { return ''; } })()]) {
    if (dir && existsSync(join(dir, name))) return join(dir, name);
  }
  return null;
}
const freePort = () => new Promise((ok, no) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); }); s.on('error', no); });
async function server(c) {
  if (srv) return srv;
  const exe = serverExe(c);
  if (!exe) return null;
  const port = await freePort();
  const threads = String(Math.max(2, Math.min(8, cpus().length - 1)));
  const proc = spawn(exe, ['-m', c.model, '--host', '127.0.0.1', '--port', String(port), '-l', 'en', '-t', threads, '-nt'], { windowsHide: true, stdio: 'ignore' });
  const me = { port, proc };
  proc.on('exit', () => { if (srv === me) srv = null; });
  // Take Whisper down with Switchboard (a stop, a restart, an update).
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) if (!process.listenerCount(sig)) process.once(sig, () => { stopVoice(); process.exit(0); });
  me.ready = (async () => {
    for (let i = 0; i < 120; i++) {
      if (proc.exitCode !== null) throw new Error('Whisper stopped.');
      try { await fetch(`http://127.0.0.1:${port}/`); return; } catch {}
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('Whisper took too long to start.');
  })();
  srv = me;
  return me;
}
export function stopVoice() { try { srv?.proc.kill(); } catch {} srv = null; }
process.on('exit', stopVoice);

// What Whisper writes for silence or breath: on its own it means nothing was said.
const GHOST = /^(you|thank you|thank you( so much)? for watching|thanks for watching|please subscribe|subtitles by .*|bye|uh|um|hmm|\.+)[.!?]*$/i;
const clean = (t) => { const s = t.replace(NOISE, ' ').replace(/\s+/g, ' ').trim(); return GHOST.test(s) ? '' : s; };

export async function transcribe(wavBase64) {
  const c = conf();
  if (!c) throw new Error('Talk to type is not set up yet.');
  const wav = Buffer.from(wavBase64, 'base64');
  const s = await server(c).catch(() => null);
  if (s) {
    try {
      await s.ready;
      const form = new FormData();
      form.append('file', new Blob([wav], { type: 'audio/wav' }), 'speech.wav');
      form.append('response_format', 'json');
      const r = await fetch(`http://127.0.0.1:${s.port}/inference`, { method: 'POST', body: form });
      if (r.ok) return clean((await r.json()).text || '');
    } catch {}
  }
  return transcribeOnce(c, wav);
}

function transcribeOnce(c, wav) {
  const file = join(tmpdir(), `switchboard-voice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.wav`);
  writeFileSync(file, wav);
  const threads = String(Math.max(2, Math.min(8, cpus().length - 1)));
  return new Promise((resolve, reject) => {
    execFile(c.exe, ['-m', c.model, '-f', file, '-l', 'en', '-nt', '-np', '-t', threads], { timeout: 60000, windowsHide: true, maxBuffer: 4e6 }, (err, out) => {
      rmSync(file, { force: true });
      if (err) return reject(new Error('Could not turn that into text.'));
      resolve(clean(out));
    });
  });
}
