// The Now page, the welcome and "New in Switchboard" cards (from the setup registry), and Today (calendar and weather).
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
// ---------- Now
// The rows of things in flight (Now, a project's page): its project's dot,
// what it is, where from, its state as a word, and how long ago.
function nowRows(cards, { showProject = project === 'all' } = {}) {
  return `<div class="now-rows">${cards.map((c) => `
    <button class="job now-row st-${c.st === 'others' ? 'waiting-others' : c.st === 'working' ? 'running' : c.st} ${isSel(c.type, c.key) ? 'sel' : ''}" type="button" data-type="${esc(c.type)}" data-key="${esc(c.key)}">
      <span class="dot" style="background:${safeColor(spaceOf(c.space).color)}" title="${esc(spaceOf(c.space).name)}"></span>
      <span class="now-w"><b class="what">${esc(plainLine(c.what))}</b><span class="where">${esc(c.where)}${showProject ? ` · ${esc(spaceOf(c.space).name)}` : ''}</span></span>
      <span class="now-st ${c.st === 'working' ? 'run-dots' : ''}">${esc(c.label)}</span>
      <span class="now-ago mono">${ago(c.at)}</span>
    </button>`).join('')}</div>`;
}
function renderNow() {
  const all = flight().filter(inProject);
  const counts = { all: all.length, needs: all.filter((c) => c.st === 'needs').length, others: all.filter((c) => c.st === 'others').length };
  const shown = all.filter((c) => nowFilter === 'all' || c.st === nowFilter);
  let html = `<div class="page-head"><h1>Now</h1><div class="chips tabs">
    <button class="chip" type="button" data-now="all" aria-pressed="${nowFilter === 'all'}">Everything in flight <span class="c">${counts.all}</span></button>
    <button class="chip ${counts.needs ? 'hot' : ''}" type="button" data-now="needs" aria-pressed="${nowFilter === 'needs'}">Needs you <span class="c">${counts.needs}</span></button>
    <button class="chip" type="button" data-now="others" aria-pressed="${nowFilter === 'others'}">Waiting on others <span class="c">${counts.others}</span></button>
  </div><span class="grow"></span>${projectPicker()}</div>`;
  html += setupCards();
  html += rundownShows() ? rundownCard() : todayCard();
  // One list per state, most urgent first: a row each, its project as a dot.
  const GROUPS = [['needs', 'Needs you'], ['working', 'Working'], ['others', 'Waiting on others'], ['done', 'Done'], ['idle', 'Open, nothing happening']];
  let any = false;
  for (const [st, title] of GROUPS) {
    const cards = shown.filter((c) => c.st === st).sort((a, b) => b.at - a.at);
    if (!cards.length) continue;
    any = true;
    html += `<section class="now-group ${st === 'needs' ? 'hot' : ''}"><div class="now-gh"><h2>${title}</h2><span class="c">${cards.length}</span></div>
      ${nowRows(cards)}</section>`;
  }
  if (!any) html += `<section class="card">${empty(nowFilter === 'needs' ? 'Nothing needs you right now.' : nowFilter === 'others' ? 'Nobody owes you a reply or a payment that Switchboard knows of. Log an invoice with Ctrl+K: "invoice Acme 1500 due fri".' : 'Nothing in flight. Claude sessions appear when you send them a prompt.')}</section>`;
  $('page').innerHTML = html;
}

// ---------- welcome, "New in Switchboard", and what is left to connect
// All three come from the setup registry (public/setup.js): a feature added
// there shows in the welcome for new people and as new for everyone else.
const welcomeState = () => S?.prefs?.welcome || null;
const saveWelcome = (w) => { S.prefs.welcome = w; return api('/api/settings', { prefs: { welcome: w } }).catch(() => {}); };
const forUse = (e, uses) => e.uses === 'all' || !uses?.length || e.uses.some((u) => uses.includes(u));
let wStep = 0, wUses = null, wMore = false;

// First load of this install: a computer that is already set up skips the
// welcome (its current features count as seen); a fresh one gets it.
function checkWelcome() {
  if (!S || welcomeState()) return;
  const established = S.spaces.length > 1 || (S.account?.signedIn && !S.account.locked) || S.status.gmail.length > 0;
  if (established) { saveWelcome({ done: true, seen: SETUP.map((e) => e.id), uses: [] }); return; }
  openWelcome(0);
}
function openWelcome(step = 0) {
  wStep = step; wUses = wUses || [...(welcomeState()?.uses || [])];
  openDialog('welcome');   // renderWelcome draws only into an open scrim
  renderWelcome();
  focusInto($('welcome'));
}
function closeWelcome(finished) {
  closeDialog('welcome');
  const w = welcomeState() || {};
  if (finished || !w.done) saveWelcome({ ...w, done: true, uses: wUses || w.uses || [], seen: [...new Set([...(w.seen || []), ...SETUP.map((e) => e.id)])] });
  render();
}
// "Show me" / "Set up" on a registry entry. A page destination that is already
// open fired no hashchange before, so the click did nothing; now the page is
// redrawn either way, the named element is flashed, and a `hint` says where
// to look when there is nothing to point at yet.
const flash = (el) => { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600); };
function openSetup(e) {
  const o = e.open || {};
  if (o.cmd) { openCmd(); return; }
  if (o.go) {
    const point = () => { const el = o.focus && $(o.focus); if (el) flash(el); else if (o.hint) toast(o.hint); };
    if (location.hash === o.go) { route(); point(); }
    else { location.hash = o.go; setTimeout(point, 80); }   // the hashchange draws the page first
    return;
  }
  Promise.resolve(connEnsureFor(e.id)).then(() => openSettings(o.pane || 'accounts')).then(() => {
    const el = o.focus && $(o.focus);
    if (el) flash(el); else if (o.hint) toast(o.hint);
  });
}

function renderWelcome() {
  const host = $('welcome');
  if (!host.classList.contains('open') || !S) return;
  const a = S.account || {};
  const steps = ['hello', 'account', 'uses', 'connect', 'done'];
  // Already signed in: nothing to do on that step.
  if (steps[wStep] === 'account' && a.signedIn && !a.locked) wStep++;
  const step = steps[wStep];
  const dots = `<div class="w-dots" aria-hidden="true">${steps.map((_, i) => `<span class="${i === wStep ? 'on' : i < wStep ? 'past' : ''}"></span>`).join('')}</div>`;
  let body = '';
  if (step === 'hello') {
    body = `<h1 class="w-mark">${MARK_SVG}switchboard</h1>
      <p class="w-lead">Everything that needs you, on one screen: messages, work, money, reminders, and anything else you keep track of.</p>
      <div class="w-actions"><button class="btn btn--primary btn--lg" type="button" data-w="next">Get started</button><button class="btn btn--ghost" type="button" data-w="skip">Skip for now</button></div>`;
  } else if (step === 'account') {
    loadProviders();
    body = `<h2>Your account</h2>
      <p class="w-lead">Sign in on each computer you use and your setup follows you. It is encrypted on your computer: nobody else can read it, Switchboard included.</p>
      ${a.locked ? `<p>You are signed in. This computer still needs your key.</p><div class="w-actions"><button class="btn btn--primary btn--lg" type="button" data-w-open="accounts">Finish signing in</button></div>`
        : `<div class="w-signin">${providerButtons(false)}<button class="btn btn--wide" type="button" data-w-open="accounts">Use email and password</button></div>`}
      <div class="w-actions"><button class="btn btn--ghost" type="button" data-w="next">Use without an account (everything stays on this computer)</button></div>`;
  } else if (step === 'uses') {
    body = `<h2>What will you use it for?</h2><p class="w-lead">Pick any that fit. This picks what to suggest next and sets up projects to start from.</p>
      <div class="w-uses">${USES.map((u) => `<button type="button" class="w-use" data-w-use="${u.id}" aria-pressed="${wUses.includes(u.id)}"><b>${esc(u.name)}</b><span>${esc(u.blurb)}</span></button>`).join('')}</div>
      <div class="w-actions"><button class="btn btn--primary btn--lg" type="button" data-w="uses">Next</button></div>`;
  } else if (step === 'connect') {
    const list = SETUP.filter((e) => e.kind === 'connect' && e.id !== 'account');
    const mine = list.filter((e) => forUse(e, wUses)), rest = list.filter((e) => !forUse(e, wUses));
    const item = (e) => { const done = e.done(S); return `<div class="w-conn ${done ? 'done' : ''}"><div><b>${esc(e.title)}</b><span>${esc(e.why)}</span></div>${done ? `<span class="w-ok">${e.id === 'projects' ? 'Done' : 'Connected'}</span>` : `<button class="btn" type="button" data-w-setup="${e.id}">Connect</button>`}</div>`; };
    body = `<h2>Connect what you use</h2><p class="w-lead">Each one takes a minute. You can do the rest any time from Settings.</p>
      <div class="w-conns">${mine.map(item).join('')}</div>
      ${rest.length ? (wMore ? `<div class="w-conns">${rest.map(item).join('')}</div>` : `<button class="btn btn--ghost" type="button" data-w="more">Show ${rest.length} more</button>`) : ''}
      <div class="w-actions"><button class="btn btn--primary btn--lg" type="button" data-w="next">Next</button></div>`;
  } else {
    const tips = SETUP.filter((e) => e.kind === 'feature' && forUse(e, wUses));
    body = `<h2>You are set</h2><p class="w-lead">A few things worth knowing:</p>
      <div class="w-tips">${tips.map((e) => `<div><b>${esc(e.title)}</b><span>${esc(e.why)}</span></div>`).join('')}</div>
      <div class="w-actions"><button class="btn btn--primary btn--lg" type="button" data-w="finish">Go to Switchboard</button><span class="hint">This guide is in Settings, General, any time.</span></div>`;
  }
  host.innerHTML = `<div class="welcome ${step === 'hello' ? 'hello' : ''}">${step !== 'hello' ? `<div class="w-top">${dots}<button class="btn btn--ghost" type="button" data-w="skip">Close</button></div>` : ''}${body}${step !== 'hello' && wStep > 1 ? '<button class="btn btn--ghost w-back" type="button" data-w="back">Back</button>' : ''}</div>`;
}

// Projects from the picked uses, only on a fresh install (just the default project).
async function applyUses() {
  const w = welcomeState() || {};
  await saveWelcome({ ...w, uses: wUses });
  if (S.spaces.length > 1 || !wUses.length) return;
  const add = [];
  for (const u of USES.filter((x) => wUses.includes(x.id))) for (const p of u.projects) if (![...S.spaces, ...add].some((s) => s.name === p.name)) add.push({ name: p.name, color: p.color, group: p.group || 'Mine' });
  if (add.length) { await api('/api/settings', { spaces: [...S.spaces, ...add] }); toast(`Made projects: ${add.map((p) => p.name).join(', ')}. Change them any time in Settings, Projects.`); }
  await load();
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('#welcome, [data-new], [data-left], [data-setup-link]')) return;
  const w = e.target.closest('[data-w]');
  if (w) {
    const k = w.dataset.w;
    if (k === 'next') { wStep++; renderWelcome(); }
    else if (k === 'back') { wStep = Math.max(0, wStep - 1); if (wStep === 1 && S.account?.signedIn && !S.account.locked) wStep = 0; renderWelcome(); }
    else if (k === 'skip') closeWelcome(false);
    else if (k === 'finish') closeWelcome(true);
    else if (k === 'more') { wMore = true; renderWelcome(); }
    else if (k === 'uses') applyUses().then(() => { wStep++; renderWelcome(); });
    return;
  }
  const u = e.target.closest('[data-w-use]');
  if (u) { const id = u.dataset.wUse; wUses = wUses.includes(id) ? wUses.filter((x) => x !== id) : [...wUses, id]; renderWelcome(); return; }
  const o = e.target.closest('[data-w-open]');
  if (o) { openSettings(o.dataset.wOpen); return; }
  const st = e.target.closest('[data-w-setup], [data-new-setup], [data-left-setup], [data-setup-link]');
  if (st) {
    const id = st.dataset.wSetup || st.dataset.newSetup || st.dataset.leftSetup || st.dataset.setupLink;
    if (topDialog() === 'new-scrim') closeDialog('new-scrim');
    openSetup(SETUP.find((x) => x.id === id));
    // "Show me" on a new feature counts as seen: the card should not wait for a second click.
    if (st.dataset.newSetup) { const ws = welcomeState() || {}; saveWelcome({ ...ws, seen: [...new Set([...(ws.seen || []), id])] }); }
    return;
  }
  const seen = e.target.closest('[data-new-seen]');
  if (seen) { const ws = welcomeState() || {}; saveWelcome({ ...ws, seen: [...new Set([...(ws.seen || []), ...seen.dataset.newSeen.split(',')])] }).then(render); return; }
  if (e.target.closest('[data-left-open]')) { openWelcome(3); return; }
  if (e.target.closest('[data-left-hide]')) { saveWelcome({ ...(welcomeState() || {}), hideLeft: true }).then(render); return; }
});

// What's new: features added since this person last looked. A small blue
// "What's new" at the top of the rail while there are any (like Claude's own
// app); it opens a short list with Show me / Set up, and opening it counts as
// checked, so the word goes away.
function freshEntries() {
  const w = welcomeState();
  if (!w?.done) return [];
  const fresh = SETUP.filter((e) => !(w.seen || []).includes(e.id) && forUse(e, w.uses));
  // Something new that is already set up needs no mention.
  const show = fresh.filter((e) => !(e.kind === 'connect' && e.done(S)));
  if (fresh.length && !show.length) saveWelcome({ ...w, seen: [...new Set([...(w.seen || []), ...fresh.map((e) => e.id)])] });
  return show;
}
function updateWhatsNew() { const b = $('whatsnew'); if (b) b.hidden = !freshEntries().length; }
function openWhatsNew() {
  const show = freshEntries();
  $('new-list').innerHTML = show.length ? show.map((e) => `<div class="w-conn"><div><b>${esc(e.title)}</b><span>${esc(e.why)}</span></div><div class="form-row">${e.kind === 'connect' ? `<button class="btn" type="button" data-new-setup="${e.id}">Set up</button>` : e.open?.pane || e.open?.go || e.open?.cmd ? `<button class="btn" type="button" data-new-setup="${e.id}">Show me</button>` : ''}</div></div>`).join('') : '<p class="muted">Nothing new since you last looked.</p>';
  openDialog('new-scrim');
  const w = welcomeState() || {};
  saveWelcome({ ...w, seen: [...new Set([...(w.seen || []), ...show.map((e) => e.id)])] });
  updateWhatsNew();
}
document.addEventListener('click', (e) => { if (e.target.closest('#whatsnew')) openWhatsNew(); });

// On Now: what is left to connect.
function setupCards() {
  const w = welcomeState();
  if (!w?.done) return '';
  let html = '';
  if (!w.hideLeft && w.uses?.length) {
    const left = SETUP.filter((e) => e.kind === 'connect' && forUse(e, w.uses) && !e.done(S) && (w.seen || []).includes(e.id));
    if (left.length) html += `<section class="card left-card" data-left><div class="left-row"><span><b>${left.length} left to connect</b> <span class="muted">${esc(left.map((e) => e.title).join(', '))}</span></span><span class="form-row"><button class="btn" type="button" data-left-open>Continue setup</button><button class="btn btn--quiet" type="button" data-left-hide>Hide</button></span></div></section>`;
  }
  return html;
}

// ---------- Today: the rest of today's events (tomorrow's once the evening is clear)
let todayOpen = store.get('todayOpen', false);
document.addEventListener('click', (e) => { if (!e.target.closest('[data-today-open]')) return; todayOpen = !todayOpen; store.set('todayOpen', todayOpen); renderNow(); });
const clock = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function todayCard() {
  const evs = (S.events || []).filter((e) => project === 'all' || e.space === project);
  const w = S.weather?.now;
  const ships = deliveriesBlock();
  if (!(S.calendars || []).length && !w && !ships) return '';
  const now = Date.now(), endOfDay = new Date().setHours(24, 0, 0, 0);
  let list = evs.filter((e) => e.end > now && e.start < endOfDay);
  let label = 'Today';
  if ((S.calendars || []).length && !list.filter((e) => !e.allDay).length && new Date().getHours() >= 17) { list = evs.filter((e) => e.start >= endOfDay && e.start < endOfDay + 86400e3); label = 'Tomorrow'; }
  const timed = list.filter((e) => !e.allDay), allDay = list.filter((e) => e.allDay);
  const next = timed.find((e) => e.start > now);
  const soon = next && next.start - now < 60 * 60e3 ? `in ${Math.max(1, Math.round((next.start - now) / 60e3))} min` : '';
  const item = (e) => {
    const on = !e.allDay && e.start <= now && e.end > now;
    return `<li class="${on ? 'on' : ''}"><span class="ev-time">${e.allDay ? 'All day' : on ? 'Now' : clock(e.start)}</span><span class="tag" style="background:${safeColor(spaceOf(e.space).color)}"></span><span class="ev-title">${esc(e.title)}${e.location ? `<span class="ev-where">${esc(e.location.split('\n')[0])}</span>` : ''}</span>${e === next && soon ? `<span class="ev-soon">${soon}</span>` : ''}</li>`;
  };
  const hasCal = (S.calendars || []).length > 0;
  const wx = w ? `<span class="wx" title="${esc(S.weather.place)}">${Number(w.temp)}° ${esc(w.text)} <span class="muted">· H ${Number(w.high)}° L ${Number(w.low)}°</span></span>` : '';
  const warn = (S.weather?.alerts || []).map((a, i) => `<details class="wx-warn"><summary>${esc(a.event)}</summary><p>${esc(a.headline || '')}</p>${a.instruction ? `<p>${esc(a.instruction)}</p>` : ''}</details>`).join('');
  const notes = (w?.notes || []).map((n) => `<span class="pill pill--soft wx-note wx-${n.kind}">${esc(n.text)}</span>`).join('');
  // Folded (the usual): one line with the weather, what is next, packages, and
  // Show the day to open it all. Open: the whole list as before.
  if (!todayOpen) {
    const nextEv = next || timed.find((e) => e.start <= now && e.end > now);
    const coming = shipList().filter((p) => p.status !== 'delivered').length;
    const bits = [
      w ? `<span><b>${Number(w.temp)}°</b> ${esc(String(w.text).toLowerCase())}${(w.notes || []).length ? ', ' + esc(w.notes.map((n) => n.text.toLowerCase()).join(', ')) : ''}</span>` : '',
      hasCal ? (nextEv ? `<span>${nextEv.start <= now ? 'Now' : 'Next'}: <b>${esc(nextEv.title)}</b> ${nextEv.start > now ? esc(clock(nextEv.start)) : ''}${soon && nextEv === next ? ` <span class="ev-soon">${soon}</span>` : ''}</span>` : `<span>${list.length ? `${list.length} all-day` : 'Nothing on the calendar'}</span>`) : '',
      coming ? `<span><b>${coming}</b> package${coming === 1 ? '' : 's'} on the way</span>` : ''
    ].filter(Boolean).join('');
    return `<section class="card today today-strip"><h2>${label}</h2>${bits}${warn ? `<span class="bad-text"><b>${(S.weather?.alerts || []).length} weather warning${(S.weather?.alerts || []).length === 1 ? '' : 's'}</b></span>` : ''}
      <span class="today-acts"><button class="btn btn--ghost btn--sm" type="button" data-today-open>Show the day</button><a class="btn btn--ghost btn--sm" href="#calendar">Calendar</a><button class="btn btn--ghost btn--sm rd-open" type="button" data-rundown="open">Rundown</button></span></section>`;
  }
  return `<section class="card today"><div class="group-head"><h2>${label}</h2>${wx}<button class="btn btn--ghost btn--sm" type="button" data-today-open>Fold</button><a class="btn btn--ghost btn--sm" href="#calendar">Calendar</a><button class="btn btn--ghost btn--sm rd-open" type="button" data-rundown="open">Rundown</button></div>
    ${warn || notes ? `<div class="wx-notes">${warn}${notes}</div>` : ''}
    ${list.length ? `<ul class="ev-list">${[...allDay, ...timed].map(item).join('')}</ul>` : hasCal ? '<p class="empty">Nothing on the calendar.</p>' : ''}${ships}</section>`;
}
