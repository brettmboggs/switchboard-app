// Jarvis: the voice of Switchboard. You say something; quick commands run at
// once with no model (lib/jarvistools.js); anything else goes to a model on
// this computer (LM Studio, Ollama or llama.cpp, through their OpenAI-style
// chat API on 127.0.0.1), which answers and uses Switchboard's tools. Real
// work (code, research) it hands to a Claude Code session, which you see. Free
// and private: only 127.0.0.1 is ever asked, and nothing is sent anywhere else.
import { execFile, spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readdirSync, statSync } from 'node:fs';
import { SERVERS, lmsPath, lmstudioModels } from './localai.js';
import { lmModelPids } from './sysprobe.js';
import { listWindows, closeWindow } from './desktop.js';
import { TOOLS, runTool, quick, makeApi } from './jarvistools.js';
import { getSetting } from './db.js';
import { card, logTurn, tidy } from './jarvismemory.js';

// How he talks, in the person's own words (Settings, General, Jarvis's manner). One line, at most 1200 characters.
const persona = () => String(getSetting('prefs', {})?.jvPersona || '').replace(/\s+/g, ' ').trim().slice(0, 1200);

const CHAT_SERVERS = SERVERS.filter((s) => ['lmstudio', 'ollama', 'llamacpp'].includes(s.id));

// Keeping it quick. Jarvis is for short things, so the model never holds a long
// conversation: every question is a new request with only the last few
// exchanges (HISTORY messages, each cut to CUT characters), tool answers are
// cut too, and the page starts afresh after a few quiet minutes. In LM Studio
// the model is loaded with a small window (CONTEXT tokens: fast, and it fits on
// the graphics card) and unloads itself after IDLE seconds unused. Holding down
// Ctrl+Space loads it again while you talk (warm, below), about 4 seconds.
export const HISTORY = 6, CUT = 1200, TOOL_CUT = 1500, CONTEXT = 8192, IDLE = 300;   // 5 minutes: no model sits on the graphics card unused (AGENTS.md)
const loaded = new Set();
function lmsLoad(model) {
  const lms = lmsPath();
  if (!lms || loaded.has(model)) return Promise.resolve();
  return new Promise((resolve) => execFile(lms, ['ps', '--json'], { timeout: 15000, windowsHide: true }, (err, out) => {
    if (!err && String(out).includes(model)) { loaded.add(model); return resolve(); }
    execFile(lms, ['load', model, '--context-length', String(CONTEXT), '--ttl', String(IDLE), '--gpu', 'max', '-y'], { timeout: 180000, windowsHide: true }, (e2) => {
      if (!e2) loaded.add(model);
      setTimeout(() => loaded.delete(model), IDLE * 1000);   // it unloads itself after IDLE; check again then
      resolve();   // if lms could not load it, LM Studio loads it on the first question instead
    });
  }));
}

// No model sits on the graphics card unused (AGENTS.md). Every 2 minutes:
// - a model LM Studio lists as loaded but unused for IDLE seconds is unloaded, whoever loaded it (a model
//   LM Studio loads on its own for a question keeps it for an hour otherwise);
// - a model process LM Studio has let go of but that never ended (seen Nov 10 2026: Gemma holding 9 GB for
//   hours with nothing listed as loaded) is stopped once it has been seen on two sweeps with nothing loaded.
// A model that is answering, or was used in the last IDLE seconds, is never touched.
export function idleModels(list, now = Date.now(), idleMs = IDLE * 1000) {
  return list.filter((m) => m.identifier && m.status !== 'generating' && !m.queued && Number(m.lastUsedTime) > 0 && now - Number(m.lastUsedTime) > idleMs).map((m) => m.identifier);
}
export function strays(suspects, pids, loadedCount) {
  if (loadedCount) return { kill: [], suspects: new Set() };
  return { kill: pids.filter((p) => suspects.has(p)), suspects: new Set(pids) };
}
let suspects = new Set();
export async function sweepModels() {
  const pids = lmModelPids();
  if (!pids.length) { suspects = new Set(); return []; }
  const out = await lmsRun(['ps', '--json'], 15000);
  let list;
  try { list = JSON.parse(out.slice(out.indexOf('['))); if (!Array.isArray(list)) return []; } catch { return []; }   // no clear answer from LM Studio: leave everything be
  const idle = idleModels(list);
  for (const id of idle) { await lmsRun(['unload', id], 30000); loaded.delete(id); console.log(`[jarvis] unloaded ${id}: unused for ${IDLE / 60} minutes`); }
  const r = strays(suspects, pids, list.length - idle.length);
  suspects = r.suspects;
  for (const p of r.kill) { try { process.kill(p, 'SIGTERM'); suspects.delete(p); console.log(`[jarvis] stopped a model process LM Studio had let go of (pid ${p})`); } catch { /* already gone */ } }
  return r.kill;
}

// A model's size from its name ("gemma-4-12b", "llama3.2:3b"), in billions; big when unknown.
export function sizeOf(id, bytes) {
  if (bytes) return bytes / 1e9 / 0.6;
  const m = String(id).toLowerCase().match(/(\d+(?:\.\d+)?)b(?![a-z])/);
  return m ? Number(m[1]) : 99;
}
// Which model talks: the one asked for, else the smallest chat model that is
// not an embedding or vision-only one (small is quick, and quick is what a voice needs).
export function pickModel(models, want) {
  const ids = models.map((m) => (typeof m === 'string' ? { id: m } : m)).filter((m) => m.id && !/embed|whisper|tts|rerank/i.test(m.id));
  if (want && ids.some((m) => m.id === want)) return want;
  return ids.sort((a, b) => sizeOf(a.id, a.size) - sizeOf(b.id, b.size))[0]?.id || null;
}

async function listAt(s) {
  try {
    const r = await fetch(s.url + '/v1/models', { signal: AbortSignal.timeout(1200) });
    if (!r.ok) return null;
    return ((await r.json()).data || []).map((m) => ({ id: String(m.id || '') }));
  } catch { return null; }
}

// LM Studio's server: the port it says it is on (1234 by default, but its newer
// app, Bionic, often takes 1235), asked through its own lms tool.
const lmsRun = (args, timeout = 20000) => new Promise((resolve) => {
  const lms = lmsPath(); if (!lms) return resolve('');
  execFile(lms, args, { timeout, windowsHide: true }, (err, out) => resolve(String(out || '')));
});
let lmKnown = { url: null, at: 0 };   // asked at most once a minute while it answers
async function lmStudioUrl() {
  if (lmKnown.url && Date.now() - lmKnown.at < 60e3) return lmKnown.url;
  const out = await lmsRun(['server', 'status', '--json'], 15000);
  let url = null;
  try { const j = JSON.parse(out.slice(out.indexOf('{'))); if (j.running && j.port) url = `http://127.0.0.1:${Number(j.port)}`; } catch {}
  lmKnown = { url, at: url ? Date.now() : 0 };   // a "not running" is never kept: waking it asks again every 2 seconds
  return url;
}
// The LM Studio app itself, when it is not running: lms needs it. Looked for
// where people keep a downloaded app (LM Studio or Bionic, its newer name).
export function lmStudioApp(home = homedir()) {
  if (process.platform !== 'linux') return null;
  const hits = [];
  for (const dir of ['Applications', 'Apps', 'apps', 'Downloads', 'Desktop', '.local/bin', 'bin']) {
    let names = []; try { names = readdirSync(join(home, dir)); } catch {}
    for (const n of names) if (/^(lm[-_ .]?studio|bionic)[^/]*\.appimage$/i.test(n)) { try { hits.push({ f: join(home, dir, n), t: statSync(join(home, dir, n)).mtimeMs }); } catch {} }
  }
  return hits.sort((x, y) => y.t - x.t)[0]?.f || null;
}
// Wakes LM Studio: its server if the app runs, else the app (in the background,
// no window) and then its server. One wake at a time.
let waking = null;
const lmWindow = (w) => /^(LM Studio|Bionic)$/i.test(String(w.title || '').trim());
// Waking LM Studio can open its window even when asked not to: a window Switchboard caused is closed again
// (LM Studio keeps serving in the background); one that was open before is left alone.
async function closeNewLmWindows(before) {
  for (let i = 0; i < 10; i++) {
    const fresh = (await listWindows().catch(() => [])).filter((w) => lmWindow(w) && !before.has(w.id));
    if (fresh.length) { for (const w of fresh) await closeWindow(w.id).catch(() => {}); return; }
    await new Promise((r) => setTimeout(r, 1500));
  }
}
function wakeLmStudio() {
  if (waking) return waking;
  waking = (async () => {
    if (!lmsPath()) return null;
    let url = await lmStudioUrl();
    if (url) return url;
    const before = new Set((await listWindows().catch(() => [])).filter(lmWindow).map((w) => w.id));
    url = await wakeNow();
    if (url) closeNewLmWindows(before).catch(() => {});
    return url;
  })().finally(() => { waking = null; });
  return waking;
}
async function wakeNow() {
  let url;
  await lmsRun(['server', 'start'], 30000);
  url = await lmStudioUrl();
  if (url) return url;
  const app = lmStudioApp();
  if (!app) return null;
  spawn(app, ['--run-as-service'], { detached: true, stdio: 'ignore', cwd: homedir() }).unref();
  for (let i = 0; i < 20 && !url; i++) { await new Promise((r) => setTimeout(r, 2000)); url = await lmStudioUrl(); }
  if (!url) { await lmsRun(['server', 'start'], 30000); url = await lmStudioUrl(); }
  return url;
}

// The first local server that answers, with its models: LM Studio (on the port
// it reports), then Ollama and llama.cpp on theirs. LM Studio is woken when it
// is installed but not serving; it loads the model on the first question and
// unloads it when idle, so it costs nothing between uses.
// Every one that answers, best first: if the first fails mid-question, the
// next one takes it (LM Studio, then Ollama, then llama.cpp).
export async function findBrains(want, { wake = true } = {}) {
  const lm = await lmStudioUrl() || (wake ? await wakeLmStudio() : null);
  const tries = [...(lm ? [{ id: 'lmstudio', name: 'LM Studio', url: lm }] : []), ...CHAT_SERVERS];
  const out = [], seen = new Set();
  for (const s of tries) {
    if (seen.has(s.url)) continue; seen.add(s.url);
    const models = await listAt(s);
    if (!models?.length) continue;
    const sized = s.id === 'lmstudio' ? models.map((m) => ({ ...m, size: lmstudioModels().find((x) => x.id === m.id)?.size })) : models;
    const model = pickModel(sized, want);
    if (model) out.push({ id: s.id, url: s.url, name: s.name, model, models: models.filter((m) => !/embed/i.test(m.id)).map((m) => m.id) });
  }
  return out;
}
export async function findBrain(want) { return (await findBrains(want))[0] || null; }

// Load the model while you are still talking (Ctrl+Space down), so it is warm
// by the time you let go. LM Studio through lms; Ollama with an empty request
// that keeps the model in memory for half an hour.
export async function warm(want) {
  const b = await findBrain(want);
  if (!b) return null;
  if (b.id === 'lmstudio') await lmsLoad(b.model);
  else if (b.id === 'ollama') await fetch(b.url + '/api/generate', { method: 'POST', body: JSON.stringify({ model: b.model, keep_alive: '30m' }), signal: AbortSignal.timeout(60000) }).catch(() => {});
  return b.model;
}

// One round with the model, streamed: each piece of what it says goes to onText
// as it comes (its private thinking, in <think> or reasoning_content, never
// does), and the tool calls are put together from their pieces. Thinking is
// asked to be off: on Gemma 4 that took the first word from 6.6 s to 0.14 s.
const noThinking = new Map();   // server url -> false when it refused reasoning_effort
async function chatRound(brain, messages, tools, { onText, signal }) {
  const body = { model: brain.model, messages, tools, temperature: 0.4, max_tokens: 400, stream: true, ...(brain.id === 'lmstudio' ? { ttl: IDLE } : {}) };   // ttl: if LM Studio loads it for this question, it unloads after IDLE
  if (noThinking.get(brain.url) !== false) body.reasoning_effort = 'none';
  const go = (b) => fetch(brain.url + '/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(90000)]) : AbortSignal.timeout(90000) });
  let r = await go(body);
  if (r.status === 400 && body.reasoning_effort) { noThinking.set(brain.url, false); delete body.reasoning_effort; r = await go(body); }
  if (!r.ok) throw new Error(`${brain.name} could not answer (it said ${r.status}). Check that a model is downloaded in ${brain.name}.`);
  let content = '', shown = '', inThink = false, buf = '';
  const calls = [];
  const dec = new TextDecoder();
  const say = () => {   // what is new outside <think>…</think>, sent on
    let out = '', rest = content.slice(shown.length);
    while (rest) {
      if (inThink) { const e = rest.indexOf('</think>'); if (e < 0) { shown += rest; rest = ''; break; } shown += rest.slice(0, e + 8); rest = rest.slice(e + 8); inThink = false; continue; }
      const b = rest.indexOf('<think>');
      if (b < 0) { const hold = /<t?h?i?n?k?$/.test(rest) ? rest.match(/<t?h?i?n?k?$/)[0].length : 0; out += rest.slice(0, rest.length - hold); shown += rest.slice(0, rest.length - hold); break; }
      out += rest.slice(0, b); shown += rest.slice(0, b + 7); rest = rest.slice(b + 7); inThink = true;
    }
    if (out && onText) onText(out);
  };
  for await (const chunk of r.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      let d; try { d = JSON.parse(data).choices?.[0]?.delta; } catch { continue; }
      if (!d) continue;
      if (d.content) { content += d.content; say(); }
      for (const t of d.tool_calls || []) {
        const c = (calls[t.index ?? calls.length] ||= { id: '', type: 'function', function: { name: '', arguments: '' } });
        if (t.id) c.id = t.id;
        if (t.function?.name) c.function.name += t.function.name;
        if (t.function?.arguments) c.function.arguments += t.function.arguments;
      }
    }
  }
  return { content, tool_calls: calls.filter(Boolean) };
}

const SYSTEM = (ctx) => `You are Jarvis, the voice of Switchboard, the user's console for their work: agent coding sessions, GitHub builds, mail, money, notes and reminders.
You speak your answers aloud, so keep them short: one or two plain sentences, no lists, no markdown, no emoji. Never read out file paths, web addresses or code: say what they are instead.
Your manner: ${persona() || 'warm, quick and a little witty.'}
Use the tools to look things up and to act. You can do anything Switchboard can: when no other tool fits, use find_action with a few words for what is wanted, then do_action with the id and inputs it gives (ids and keys come from other actions, often board.state). Never invent sessions, builds, ids or numbers: check with a tool. Something marked delete waits for the user's yes: ask in one short question, then run it with confirmed true. Never send anything to another person: say it is ready for them to send, or offer a draft. If something truly cannot be done, say so plainly rather than pretending. For real work (writing or fixing code, research, drafting), start a Claude Code session or send the job to an open one rather than doing it yourself.
${card() ? `What you know about them, from your notes (use it when it helps; "remember" adds, "forget" removes, "recall" searches what was said before):\n${card()}\n` : 'You can keep notes about them: "remember" adds a lasting fact, "recall" searches what was said before.\n'}Right now the screen shows the ${ctx.page || 'Deck'} page (the Deck is home: you at its centre, every system around you)${ctx.session ? `, with the session "${ctx.session}" open` : ''}. It is ${new Date().toLocaleString('en-US', { weekday: 'long', hour: 'numeric', minute: '2-digit' })}.`;

// One question, answered. history: earlier turns [{ role, content }].
// onSay(piece): the answer as it comes, to be spoken a sentence at a time;
// onAct(action): something for the page to do, as soon as it is known.
// signal: the person spoke over Jarvis, so stop.
// Every exchange goes in Jarvis's log (lib/jarvismemory.js), searched only when he needs it.
export async function ask(q) {
  noteAsked();
  const r = await answer(q);
  try { logTurn('user', q.text); logTurn('assistant', r.say); } catch { /* the log never stops an answer */ }
  return r;
}
async function answer({ text, history = [], ctx = {}, model, port, onSay, onAct, signal }) {
  const api = makeApi(port);
  const actions = [];
  const q = quick(text);
  if (q) {
    try {
      const r = await runTool(api, q[0], q[1]);
      if (r.action) { actions.push(r.action); onAct?.(r.action); }
      onSay?.(r.say);
      return { say: r.say, actions, by: 'quick' };
    } catch (e) { onSay?.(e.message); return { say: e.message, actions, by: 'quick' }; }
  }
  const brains = await findBrains(model);
  if (!brains.length) {
    const none = { say: lmsPath() ? 'I could not start LM Studio, so only the quick commands work right now: go to a page, what needs me, open a session, remind me, add a to-do, test my internet. Open LM Studio once from your apps, and I will use it from then on.' : 'There is no model on this computer for me to think with, so only the quick commands work: go to a page, what needs me, open a session, remind me, add a to-do, test my internet. Install LM Studio and download a model in it.', actions, by: 'none', noBrain: true };
    onSay?.(none.say);
    return none;
  }
  const messages = [{ role: 'system', content: SYSTEM(ctx) }, ...history.slice(-HISTORY).map((m) => ({ role: m.role, content: String(m.content).slice(0, CUT) })), { role: 'user', content: String(text).slice(0, CUT) }];
  const tools = TOOLS.map((t) => ({ type: 'function', function: t }));
  let lastErr = null;
  for (const brain of brains) {
    if (brain.id === 'lmstudio') await lmsLoad(brain.model);
    try { return await rounds(brain, messages.slice(), tools, { api, actions, onSay, onAct, signal }); }
    catch (e) { if (signal?.aborted) throw e; lastErr = e; console.warn(`[jarvis] ${brain.name} failed, trying the next:`, e.message); }
  }
  throw lastErr;
}

// The model's turns: it answers, or calls tools and answers after. A call that
// fails the same way a third time is not run again (the model is told to stop
// and say so), so a confused model cannot go round in circles.
async function rounds(brain, messages, tools, { api, actions, onSay, onAct, signal }) {
  const fails = new Map();
  let said = '';
  const speak = (piece) => { said += piece; onSay?.(piece); };
  for (let round = 0; round < 4; round++) {
    const msg = await chatRound(brain, messages, tools, { onText: speak, signal });
    const calls = msg.tool_calls || [];
    if (!calls.length) {
      const say = clean(msg.content) || 'Done.';
      if (!clean(said)) onSay?.(say);
      return { say, actions, by: brain.name, model: brain.model, models: brain.models };
    }
    messages.push({ role: 'assistant', content: msg.content || '', tool_calls: calls });
    for (const c of calls) {
      let args = {};
      try { args = JSON.parse(c.function?.arguments || '{}'); } catch {}
      const key = c.function?.name + ' ' + JSON.stringify(args);
      let out;
      if ((fails.get(key) || 0) >= 2) out = 'This has failed three times the same way. Do not try it again: tell the user plainly what did not work.';
      else {
        try { const res = await runTool(api, c.function?.name, args); out = res.say; if (res.action) { actions.push(res.action); onAct?.(res.action); } }
        catch (e) { out = 'That did not work: ' + e.message; fails.set(key, (fails.get(key) || 0) + 1); }
      }
      messages.push({ role: 'tool', tool_call_id: c.id, content: String(out).slice(0, TOOL_CUT) });
    }
  }
  const say = 'I went round in circles on that one. Try saying it another way.';
  onSay?.(say);
  return { say, actions, by: brain.name, model: brain.model };
}

// Spoken words only: no thinking blocks, markdown or emoji.
export function clean(s) {
  return String(s || '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/[*_`#>]+/g, '').replace(/\p{Extended_Pictographic}/gu, '').replace(/\s+/g, ' ').trim();
}

// The nightly tidy (lib/jarvismemory.js): once a day after 2 am, when Jarvis
// has been quiet half an hour, and only if a model server is already running
// (it never starts LM Studio for this). Also run from Settings, Tidy now.
export async function tidyNow({ wake = true } = {}) {
  const b = (await findBrains(null, { wake }))[0];
  if (!b) return { changed: false, error: 'No model is running on this computer to tidy with. Open LM Studio and try again.' };
  if (b.id === 'lmstudio') await lmsLoad(b.model);
  return tidy(async (messages) => {
    const body = { model: b.model, messages, temperature: 0.2, max_tokens: 700, stream: false };
    if (noThinking.get(b.url) !== false) body.reasoning_effort = 'none';
    const r = await fetch(b.url + '/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
    if (!r.ok) throw new Error(`${b.name} could not tidy (it said ${r.status}).`);
    return (await r.json()).choices?.[0]?.message?.content || '';
  });
}
let lastAsk = 0;
export function noteAsked() { lastAsk = Date.now(); }
export function tidyDue(now = new Date()) {
  const t = Number(getSetting('jvTidiedAt', 0)) || 0;
  return now.getHours() >= 2 && new Date(t).toDateString() !== now.toDateString() && now - lastAsk > 30 * 60e3;
}
