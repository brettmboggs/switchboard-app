// A natural voice that runs on this computer: Piper (the open-source neural
// text-to-speech from the Rhasspy project), for reading books aloud and, if
// chosen, for Jarvis. Free, offline once installed, nothing leaves the computer.
//
// Install is a button (Settings, Connections, Read-aloud voice): it downloads
// Piper's own release for this OS from GitHub (about 25 MB) and one voice from
// the project's voice collection on Hugging Face (60 to 120 MB), into
// DATA_DIR/readaloud. Remove deletes that folder. Nothing is installed system-wide,
// and the program is always run by its full path here: on Linux an unrelated
// program called "piper" (a gaming mouse tool) is often on the PATH.
//
// Speaking: one Piper process stays open per voice and takes one line of JSON
// per sentence ({ text, output_file }), so a sentence comes back in a fraction
// of a second instead of reloading the voice each time. The last 80 sentences
// are kept in memory, so going back a sentence is instant.
import { spawn, execFile } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, readdirSync, unlinkSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DATA_DIR, getSetting, setSetting } from './db.js';

export const ROOT = join(DATA_DIR, 'readaloud');   // not 'voice': that folder is talk-to-type's (its speech model)
const RELEASE = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/';
export const VOICES = [   // American English first, the default (asked for Nov 10 2026)
  { id: 'en_US-ryan-high', name: 'Ryan', what: 'American man, the clearest', mb: 121 },
  { id: 'en_US-lessac-medium', name: 'Lessac', what: 'American woman, warm', mb: 63 },
  { id: 'en_US-amy-medium', name: 'Amy', what: 'American woman, bright', mb: 63 },
  { id: 'en_GB-alan-medium', name: 'Alan', what: 'British man, calm', mb: 63 },
  { id: 'en_GB-jenny_dioco-medium', name: 'Jenny', what: 'British woman', mb: 63 },
  { id: 'en_GB-northern_english_male-medium', name: 'Northern', what: 'Northern English man', mb: 63 }
];
const isVoice = (id) => VOICES.some((v) => v.id === id);

// ---------- pure (test/tts.test.js)
export function asset(platform = process.platform, arch = process.arch) {
  if (platform === 'linux') return arch === 'arm64' ? 'piper_linux_aarch64.tar.gz' : arch === 'x64' ? 'piper_linux_x86_64.tar.gz' : null;
  if (platform === 'darwin') return arch === 'arm64' ? 'piper_macos_aarch64.tar.gz' : 'piper_macos_x64.tar.gz';
  if (platform === 'win32') return arch === 'x64' ? 'piper_windows_amd64.zip' : null;
  return null;
}
export function voiceUrl(id) {
  if (!isVoice(id)) throw new Error('That voice is not one Switchboard offers.');
  const [loc, who, q] = id.split('-');
  return `https://huggingface.co/rhasspy/piper-voices/resolve/main/${loc.split('_')[0]}/${loc}/${who}/${q}/${id}.onnx`;
}
// What Piper is given to say: plain words, no control characters, a sane length.
export const speakText = (t) => String(t || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1500);

// ---------- where things are
const bin = () => join(ROOT, 'piper', process.platform === 'win32' ? 'piper.exe' : 'piper');
const model = (id) => join(ROOT, 'voices', `${id}.onnx`);
const conf = () => ({ voice: 'en_US-ryan-high', jarvis: false, ...getSetting('readVoice', {}) });
const installedVoices = () => { try { return readdirSync(join(ROOT, 'voices')).filter((f) => f.endsWith('.onnx')).map((f) => f.slice(0, -5)).filter(isVoice); } catch { return []; } };
let job = null;   // { what, got, total } while installing
let lastError = '';

export function voiceStatus() {
  const c = conf(), have = installedVoices();
  return { supported: !!asset(), installed: existsSync(bin()) && have.length > 0, voices: VOICES.map((v) => ({ ...v, have: have.includes(v.id) })), voice: have.includes(c.voice) ? c.voice : have[0] || c.voice, jarvis: !!c.jarvis && have.length > 0, installing: job, error: lastError };
}

// A name lookup that stalls once, or a reset: two more tries before giving up.
async function download(url, to, what, tries = 2) {
  let r;
  try { r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15 * 60e3) }); }
  catch (e) {
    if (tries && /ENOTFOUND|EAI_AGAIN|CONNECT_TIMEOUT|ECONNRESET|ETIMEDOUT|socket/i.test(String(e?.cause?.code) + String(e?.cause?.message))) return download(url, to, what, tries - 1);
    throw new Error(`Could not download ${what}: ${/ENOTFOUND|EAI_AGAIN/.test(String(e?.cause?.code)) ? 'this computer could not find the download site' : 'the connection failed'}. Check the internet connection and press Install again.`);
  }
  if (!r.ok) throw new Error(`The download of ${what} failed (${r.status}). Try again later.`);
  job = { what, got: 0, total: Number(r.headers.get('content-length')) || 0 };
  const counted = Readable.fromWeb(r.body);
  counted.on('data', (c) => { job.got += c.length; });
  mkdirSync(dirname(to), { recursive: true });
  await pipeline(counted, createWriteStream(to + '.part'));
  renameSync(to + '.part', to);
}
const run = (cmd, args, opts = {}) => new Promise((res, rej) => execFile(cmd, args, { timeout: 120e3, ...opts }, (e, out, err) => (e ? rej(Object.assign(e, { stderr: String(err || '') })) : res(String(out)))));

// Installs Piper (once) and the voice. Runs in the background; voiceStatus() says how far it is.
export function installVoice(id, done = () => {}) {
  if (!asset()) throw new Error('The natural voice is not available for this kind of computer yet. The built-in voice still reads aloud.');
  if (!isVoice(id)) throw new Error('Pick one of the voices listed.');
  if (job) throw new Error('A voice is already being installed. It finishes in a minute or two.');
  job = { what: 'starting', got: 0, total: 0 }; lastError = '';
  (async () => {
    if (!existsSync(bin())) {
      const a = asset(), tmp = join(ROOT, a);
      await download(RELEASE + a, tmp, 'the voice program');
      job = { what: 'unpacking', got: 0, total: 0 };
      await run('tar', [a.endsWith('.zip') ? '-xf' : '-xzf', tmp, '-C', ROOT]);
      rmSync(tmp, { force: true });
      if (!existsSync(bin())) throw new Error('The voice program did not unpack as expected.');
    }
    if (!existsSync(model(id))) {
      await download(voiceUrl(id) + '.json', model(id) + '.json', 'the voice settings');
      await download(voiceUrl(id), model(id), `the ${VOICES.find((v) => v.id === id).name} voice`);
    }
    job = { what: 'testing', got: 0, total: 0 };
    setSetting('readVoice', { ...conf(), voice: id });
    await speak('Ready.', id);
  })().then(() => { job = null; done(); }, (e) => { job = null; lastError = e.message || 'The voice did not install.'; done(); });
}
export function removeVoices() {
  stopProc();
  rmSync(ROOT, { recursive: true, force: true });
  setSetting('readVoice', { ...conf(), jarvis: false });
  lastError = '';
}
export function voiceSettings({ voice, jarvis }) {
  const c = conf();
  if (voice !== undefined) { if (!installedVoices().includes(voice)) throw new Error('Install that voice first.'); c.voice = voice; }
  if (jarvis !== undefined) c.jarvis = !!jarvis;
  setSetting('readVoice', c);
  return voiceStatus();
}

// ---------- speaking
let proc = null;   // { voice, child, waiting: [{ file, res, rej }], out }
let seq = 0;
const cache = new Map();
function stopProc() { if (proc) { try { proc.child.kill(); } catch { /* gone */ } for (const w of proc.waiting) w.rej(new Error('The voice stopped.')); proc = null; } }
function startProc(voice) {
  stopProc();
  const child = spawn(bin(), ['--model', model(voice), '--json-input', '--quiet'], { cwd: dirname(bin()), stdio: ['pipe', 'pipe', 'pipe'] });
  const p = { voice, child, waiting: [], out: '', err: '' };
  child.stdout.on('data', (c) => {
    p.out += c;
    let i;
    while ((i = p.out.indexOf('\n')) >= 0) {
      const line = p.out.slice(0, i).trim(); p.out = p.out.slice(i + 1);
      const w = p.waiting.findIndex((x) => line && line.endsWith(x.name));
      if (w >= 0) { const [x] = p.waiting.splice(w, 1); x.res(); }
    }
  });
  child.stderr.on('data', (c) => { p.err = (p.err + c).slice(-2000); });
  child.on('exit', () => { if (proc === p) proc = null; for (const w of p.waiting) w.rej(new Error('The voice program stopped: ' + (p.err.trim().split('\n').pop() || 'no reason given') + '.')); p.waiting = []; });
  child.stdin.on('error', () => {});
  proc = p;
  return p;
}
export async function speak(text, voice = voiceStatus().voice) {
  const t = speakText(text);
  if (!t) throw new Error('There is nothing to read.');
  if (!existsSync(bin()) || !existsSync(model(voice))) throw new Error('The natural voice is not installed. Settings, Connections, Read-aloud voice.');
  const key = voice + '\n' + t;
  if (cache.has(key)) { const b = cache.get(key); cache.delete(key); cache.set(key, b); return b; }
  const p = proc && proc.voice === voice && !proc.child.killed ? proc : startProc(voice);
  mkdirSync(join(ROOT, 'tmp'), { recursive: true });
  const name = `s${process.pid}-${++seq}.wav`, file = join(ROOT, 'tmp', name);
  await new Promise((res, rej) => {
    const timer = setTimeout(() => { const i = p.waiting.findIndex((x) => x.name === name); if (i >= 0) p.waiting.splice(i, 1); rej(new Error('The voice took too long.')); }, 60e3);
    p.waiting.push({ name, res: () => { clearTimeout(timer); res(); }, rej: (e) => { clearTimeout(timer); rej(e); } });
    p.child.stdin.write(JSON.stringify({ text: t, output_file: file }) + '\n');
  });
  const buf = readFileSync(file);
  try { unlinkSync(file); } catch { /* fine */ }
  cache.set(key, buf);
  if (cache.size > 80) cache.delete(cache.keys().next().value);
  return buf;
}
