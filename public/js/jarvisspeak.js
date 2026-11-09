// Jarvis speaks without being asked (both switched in Settings, General, Jarvis):
//  - Speaking up: when a session on this computer needs you he says so at once;
//    sessions that finish are gathered for a moment and said in one line ("Two
//    done: notes page and inbox fix."). Never over you talking or over an answer.
//  - The morning brief: on your first click or key of the day, a few plain
//    sentences from what is already on the board (weather, calendar, what needs
//    you, sessions, builds that failed, mail, bills and reminders due). Built
//    here, with no model, so it is instant and never makes anything up. "Brief
//    me" or "good morning" asks for it any time.
// Only one window speaks: open windows agree in localStorage on which has the voice.
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
const JV_TAB = Math.random().toString(36).slice(2);
function jvHasVoice() {
  try {
    const o = JSON.parse(localStorage.getItem('sb.jvVoiceTab') || 'null'), now = Date.now();
    const mine = !o || o.id === JV_TAB || now - o.at > 8000 || (document.visibilityState === 'visible' && o.hidden);
    if (mine) localStorage.setItem('sb.jvVoiceTab', JSON.stringify({ id: JV_TAB, at: now, hidden: document.visibilityState !== 'visible' }));
    return mine;
  } catch { return true; }
}
setInterval(jvHasVoice, 4000);
document.addEventListener('visibilitychange', jvHasVoice);

const jvList = (names) => (names.length <= 1 ? names[0] || '' : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]);
const jvCap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const jvNum = (n) => ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][n] || String(n);

// Say something unasked: into the log, and out loud once nobody is talking.
function jvAnnounce(text, note = 'Speaking up', tries = 0) {
  if (!text || !jvHasVoice()) return;
  if ((jv.holding || jv.busy || rec || jvSay.pending) && tries < 20) { setTimeout(() => jvAnnounce(text, note, tries + 1), 2500); return; }
  jv.log.push({ who: 'me', text, note }); jv.log = jv.log.slice(-30); jvRender(); jvSpeak(text);
}

// ---- speaking up about sessions
const jvUp = { prev: null, done: [], timer: 0 };
function jvWatchSessions() {
  if (!S?.terms || window.WEB) return;
  const terms = (S.terms || []).map((t) => ({ ...t, key: t.id }));   // this computer's sessions only
  const now = new Map(terms.map((t) => [t.key, t.state]));
  if (jvUp.prev && S.prefs?.jvSpeakUp) {
    const needs = [], done = [];
    for (const t of terms) {
      const was = jvUp.prev.get(t.key);
      if (!was || was === t.state) continue;
      if (t.state === 'waiting') needs.push(termLabel(t));
      else if (t.state === 'finished' && ['running', 'starting'].includes(was)) done.push(termLabel(t));
    }
    if (needs.length) jvAnnounce(jvCap(`${jvList(needs)} ${needs.length === 1 ? 'needs' : 'need'} you.`));
    // Finished ones wait 2.5 s for others finishing with them, then go in one line.
    if (done.length) { jvUp.done.push(...done); clearTimeout(jvUp.timer); jvUp.timer = setTimeout(jvSayDone, 2500); }
  }
  jvUp.prev = now;
}
function jvSayDone() {
  const d = [...new Set(jvUp.done.splice(0))];
  if (d.length) jvAnnounce(d.length === 1 ? `${jvCap(d[0])} is done. Your turn.` : `${jvCap(jvNum(d.length))} done: ${jvList(d)}.`);
}
setInterval(jvWatchSessions, 1500);

// ---- the morning brief
function jvBriefText() {
  const now = Date.now(), end = new Date(); end.setHours(23, 59, 59, 999);
  const out = [deckGreeting()];
  const w = S.weather?.ok && S.weather.now;
  if (w) out.push(`It is ${Math.round(w.temp)} degrees and ${String(w.text || '').toLowerCase()}.`);
  const evs = (S.events || []).filter((e) => e.end > now && e.start <= end.getTime()).sort((a, b) => a.start - b.start);
  const timed = evs.filter((e) => !e.allDay);
  if (timed.length) out.push(`${timed.length === 1 ? 'One thing' : jvCap(jvNum(timed.length)) + ' things'} on the calendar today; first up, ${timed[0].title} at ${new Date(timed[0].start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`);
  else if (S.calendars?.length || S.events) out.push('Nothing on the calendar today.');
  const needs = flight().filter((c) => c.st === 'needs').length;
  out.push(needs ? `${jvCap(jvNum(needs))} ${needs === 1 ? 'thing needs' : 'things need'} you.` : 'Nothing needs you.');
  const terms = S.terms || [], working = terms.filter((t) => t.state === 'running').length, yours = terms.filter((t) => ['finished', 'waiting'].includes(t.state)).length;
  if (working || yours) out.push(jvCap([working && `${jvNum(working)} ${working === 1 ? 'session is' : 'sessions are'} working`, yours && `${jvNum(yours)} ${working ? (yours === 1 ? 'is' : 'are') : (yours === 1 ? 'session is' : 'sessions are')} waiting on you`].filter(Boolean).join(', ')) + '.');
  const failed = (S.actions || []).filter((a) => a.runs[0]?.state === 'failure' && now - a.runs[0].updatedAt < 86400e3).map((a) => a.name);
  if (failed.length) out.push(`${failed.length === 1 ? 'A build failed' : jvCap(jvNum(failed.length)) + ' builds failed'} overnight: ${jvList(failed.slice(0, 3))}.`);
  const mail = inboxCount('all');
  if (mail) out.push(`${jvCap(jvNum(mail))} ${mail === 1 ? 'message is' : 'messages are'} waiting on a reply.`);
  const due = [...(S.money?.bills || []).filter((b) => b.next && b.next <= end.getTime()).map((b) => `${b.text} is due`), ...(S.items || []).filter((i) => i.kind === 'reminder' && i.due_at && i.due_at <= end.getTime()).map((i) => `a reminder: ${i.text}`)];
  if (due.length) out.push(`Today, ${jvList(due.slice(0, 3))}.`);
  return out.join(' ');
}
function jvBrief(note = 'Morning brief') { jvAnnounce(jvBriefText(), note); }
// The first click or key of the day (from 4 am), once a day on this computer.
function jvBriefOnce(e) {
  if (!S?.prefs?.jvBrief || window.WEB || new Date().getHours() < 4) return;
  if (e?.code === 'Space' && e.ctrlKey) return;   // you are about to talk: brief later
  const day = new Date().toDateString();
  try { if (localStorage.getItem('sb.jvBriefDay') === day) return; localStorage.setItem('sb.jvBriefDay', day); } catch { return; }
  setTimeout(() => jvBrief(), 400);
}
document.addEventListener('pointerdown', jvBriefOnce, true);
document.addEventListener('keydown', jvBriefOnce, true);
