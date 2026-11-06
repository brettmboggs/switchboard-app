// Settings: accounts (Switchboard, email, calendars, Microsoft, developer tools), projects, notifications, mail, general; the account prompts.
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
// ---------- settings
// Sections down the left; every change saves as it is made.
let SET = null, pane = 'accounts';
const PANES = { accounts: 'Account', connections: 'Connections', projects: 'Projects', alerts: 'Notifications', mail: 'Mail', look: 'General', system: 'System' };
const SWATCHES = ['#FF4F00', '#2F5D8A', '#1F7A4D', '#8A6D1F', '#7A3E9D', '#B42318', '#0E7C86', '#8A8F98'];

async function openSettings(to) {
  SET = await api('/api/settings');
  openDialog('settings-scrim');
  showPane(typeof to === 'string' ? to : pane);
  renderSettings();
}
function showPane(id) {
  pane = id;
  document.querySelectorAll('.prefs-nav [data-pane]').forEach((b) => b.toggleAttribute('aria-current', b.dataset.pane === id));
  document.querySelectorAll('.pane').forEach((p) => { p.hidden = p.id !== 'pane-' + id; });
  $('pane-title').textContent = PANES[id];
}
function renderSettings() {
  if (!SET) return;
  renderAccount(); renderGmail(); renderCalendars(); renderWebhooks(); renderMsStatus(); renderDev(); renderConnections(); renderProjects(); renderAlerts(); renderSigs(); renderLook();
}

let savedTimer = null;
async function saveSet(body) {
  try {
    await api('/api/settings', body);
    $('saved').textContent = 'Saved'; $('saved').className = 'saved show';
    clearTimeout(savedTimer); savedTimer = setTimeout(() => { $('saved').className = 'saved'; }, 1400);
    load();
  } catch (err) { $('saved').textContent = err.message; $('saved').className = 'saved show bad-text'; }
}

// -- accounts
function card({ name, line = '', bad = false, actions = '', conn = '' }) {
  return `<div class="acct-card"${conn ? ` data-conn="${conn}"` : ''}><div class="acct-main"><b>${name}</b>${line ? `<span class="acct-line ${bad ? 'bad-text' : ''}">${line}</span>` : ''}</div><div class="form-row">${actions}</div></div>`;
}

const PROVIDER_NAMES = { google: 'Google', github: 'GitHub', microsoft: 'Microsoft', dev: 'Test sign-in' };
let providerList = null;
function loadProviders() {
  if (providerList) return;
  providerList = [];
  api('/api/account/providers').then((r) => { providerList = r.providers || []; renderAccount(); renderWelcome(); }).catch(() => {});
}
function providerButtons(link) {
  return (providerList || []).filter((p) => !link || !(S.account.info?.identities || []).some((i) => i.provider === p))
    .map((p) => `<button class="btn ${link ? '' : 'btn--wide'}" type="button" data-oauth="${p}" ${link ? 'data-link="1"' : ''}>${link ? 'Add ' : 'Continue with '}${PROVIDER_NAMES[p] || p}</button>`).join('');
}

function renderAccount() {
  const a = S?.account;
  if (!a || !$('acct')) return;
  loadProviders();
  if (a.signedIn && a.locked) {
    // Signed in on this computer, but it does not have the account key yet.
    const p = a.pairing, i = a.info || {};
    $('acct').innerHTML = `<div class="acct-main"><b>Finish signing in</b><span class="acct-line">${esc(a.email || '')}: this computer needs your key to open your data. Pick one.</span></div>
      <div class="form-row"><button class="btn btn--quiet" type="button" data-account="signout">Sign out</button></div>
      <div class="unlock acct-wide">
        <div class="unlock-way"><b>Approve from another computer</b>
          ${p?.status === 'waiting' ? `<p>On a computer where you use Switchboard, approve the request. It shows a code: it should be <span class="pair-code">${esc(p.code)}</span></p><button class="btn btn--quiet" type="button" data-account="pair-cancel">Cancel</button>`
            : `${p?.status === 'denied' ? '<p class="bad-text">The other computer said no.</p>' : p?.status === 'expired' ? '<p class="bad-text">The request expired.</p>' : p?.status === 'failed' ? '<p class="bad-text">That did not unlock the account. Try again.</p>' : '<p>Your other computer asks you to approve, and checks a code with you.</p>'}<button class="btn btn--primary" type="button" data-account="pair">Ask my other computer</button>`}
        </div>
        ${i.hasRecovery !== false ? `<form class="unlock-way" id="recover-form"><b>Use your recovery key</b><input id="recover-key" class="mono" placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX" autocomplete="off" spellcheck="false"><div class="form-row"><button class="btn" type="submit">Unlock</button><span id="recover-msg" class="small"></span></div></form>` : ''}
        ${i.hasPassword ? `<form class="unlock-way" id="unlock-form"><b>Use your Switchboard password</b><input id="unlock-pass" type="password" autocomplete="current-password"><div class="form-row"><button class="btn" type="submit">Unlock</button><span id="unlock-msg" class="small"></span></div></form>` : ''}
      </div>`;
    return;
  }
  if (a.signedIn && S.relay?.removed) {
    $('acct').innerHTML = `<div class="acct-main"><b>Switchboard account</b><span class="acct-line bad-text">This computer was removed from your account on another computer.</span></div>
      <div class="form-row"><button class="btn btn--primary" type="button" data-account="signout">Sign in again</button></div>`;
    return;
  }
  if (a.signedIn) {
    const ids = a.info?.identities || [];
    const via = ids.map((x) => PROVIDER_NAMES[x.provider] || x.provider);
    if (a.info?.hasPassword) via.push('password');
    $('acct').innerHTML = `<div class="acct-main"><b>Switchboard account</b><span class="acct-line ${a.ok === false ? 'bad-text' : ''}">${a.ok === false ? esc(a.error) : esc(a.email) + (via.length ? ' · signs in with ' + esc(via.join(', ')) : '')}</span></div>
      <div class="form-row"><button class="btn btn--quiet" type="button" data-account="sync">Sync now</button><button class="btn btn--quiet" type="button" data-account="signout">Sign out</button></div>
      <div class="acct-wide acct-extra">
        ${a.info && !a.info.hasRecovery ? `<div class="nudge"><span>Make a recovery key: it opens your data if you ever lose access to your computers.</span><button class="btn btn--primary" type="button" data-account="recovery-key">Make one</button></div>` : ''}
        <div class="form-row">${providerButtons(true)}${a.info?.hasRecovery ? '<button class="btn btn--quiet" type="button" data-account="recovery-key">New recovery key</button>' : ''}</div>
        <div class="devices"><span class="field-label">Your computers</span><div id="device-list" class="device-list">${deviceRows()}</div></div>
        <label class="toggle compact"><span>Other computers can see and use sessions on this computer</span><input type="checkbox" id="allow-remote" ${S.relay?.allowRemote !== false ? 'checked' : ''}></label>
      </div>`;
    loadDevices();
    return;
  }
  if ($('acct-email')) return;   // keep what is being typed
  const anyProvider = (providerList || []).length > 0;
  $('acct').innerHTML = `<div class="acct-main"><b>Switchboard account</b><span class="acct-line">Your projects, accounts and notes on every computer you use. Encrypted on your computer: nobody else can read them.</span></div>
    <div class="signin acct-wide">
      ${providerButtons(false)}
      ${anyProvider ? '<button class="btn btn--ghost" type="button" id="acct-email-toggle">Use email and password instead</button>' : ''}
    </div>
    <form id="acct-form" class="acct-form" ${anyProvider ? 'hidden' : ''}>
      <label for="acct-email">Email</label><input id="acct-email" type="email" autocomplete="username" required>
      <label for="acct-pass">Password</label><input id="acct-pass" type="password" autocomplete="current-password" minlength="10" required>
      <span></span><p class="hint">Your password also locks your data, so nobody can reset it. Keep it somewhere safe.</p>
      <span></span><div class="form-row"><button class="btn btn--primary" type="submit" data-mode="signin">Sign in</button><button class="btn" type="submit" data-mode="signup">Create account</button><span id="acct-msg" class="small"></span></div>
    </form>`;
}

// Computers on the account: names, when each was last active, online now, remove.
let deviceList = null, deviceAt = 0;
function loadDevices(force) {
  if (!force && Date.now() - deviceAt < 30e3) return;
  deviceAt = Date.now();
  api('/api/account/devices', {}).then((r) => { deviceList = r.devices; const el = $('device-list'); if (el) el.innerHTML = deviceRows(); })
    .catch(() => { deviceAt = 0; const el = $('device-list'); if (el) el.innerHTML = '<span class="muted small">Could not load your computers right now.</span>'; });
}
function deviceRows() {
  if (!deviceList) return '<span class="muted small">Loading…</span>';
  const online = new Set((S.relay?.devices || []).map((d) => d.name));
  return deviceList.map((d) => {
    const live = d.me || online.has(d.name);
    return `<div class="device"><span><span><b>${esc(d.name.replace(/\.local$/, ''))}</b>${d.me ? ' <span class="muted">(this computer)</span>' : ''}</span><span class="acct-line">${live ? 'Online now' : 'Last active ' + since(d.lastUsed || d.since)}</span></span>
      ${d.me ? '' : `<button class="btn btn--quiet" type="button" data-device-remove="${esc(d.id)}">Remove</button>`}</div>`;
  }).join('');
}

// ---- shown on any page: another computer asking in, and a new recovery key
function renderAccountPrompts() {
  const a = S?.account || {};
  const host = $('acct-prompts');
  if (!host) return;
  let html = '';
  for (const q of a.asks || []) {
    html += `<div class="prompt-card" role="alertdialog" aria-label="Sign-in request"><b>Let ${esc(q.name)} into your account?</b>
      <p>Only approve if that computer shows this code:</p><div class="pair-code big">${esc(q.code)}</div>
      <div class="form-row"><button class="btn btn--primary" type="button" data-pair-answer="${esc(q.id)}" data-approve="1">Approve</button><button class="btn" type="button" data-pair-answer="${esc(q.id)}">Not me</button></div></div>`;
  }
  if (a.recoveryKey) {
    html += `<div class="prompt-scrim"><div class="prompt-card wide" role="dialog" aria-label="Your recovery key"><b>Your recovery key</b>
      <p>If you lose access to all your computers, this opens your data. Nobody can reset it, Switchboard included. Save it somewhere safe: a password manager, or print it.</p>
      <div class="recovery">${esc(a.recoveryKey)}</div>
      <div class="form-row"><button class="btn" type="button" id="rk-copy">Copy</button><button class="btn" type="button" id="rk-save">Download</button><span class="grow"></span><button class="btn btn--primary" type="button" data-account="recovery-seen">I saved it</button></div></div></div>`;
  }
  host.innerHTML = html;
}

function renderGmail() {
  const st = S?.status.gmail || [];
  $('gmail-cards').innerHTML = SET.gmail.map((g) => {
    const live = st.find((x) => x.email === g.email) || {};
    return card({ name: esc(g.name || 'Gmail'), line: live.ok === false ? esc(live.error) : esc(g.email), bad: live.ok === false, actions: `<button class="btn btn--quiet" type="button" data-remove-gmail="${esc(g.email)}">Remove</button>` });
  }).join('');
  $('gmail-add').querySelector('b').textContent = SET.gmail.length ? 'Add another email account' : 'Email';
}

function renderCalendars() {
  if (!SET) return;
  const live = S?.calendars || [];
  $('cal-space').innerHTML = SET.spaces.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');
  $('cal-list').innerHTML = (SET.calendars || []).map((c) => {
    const st = live.find((x) => x.id === c.id) || {};
    return `<div class="cal-row"><span><b>${esc(c.name)}</b>${st.ok === false ? `<span class="bad-text small"> ${esc(st.error)}</span>` : ''}</span>
      <select data-cal-space="${esc(c.id)}" aria-label="Project for ${esc(c.name)}">${SET.spaces.map((x) => `<option value="${esc(x.id)}" ${x.id === c.space ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
      <button class="btn btn--quiet" type="button" data-cal-remove="${esc(c.id)}">Remove</button></div>`;
  }).join('');
  $('cal-open').textContent = (SET.calendars || []).length ? 'Add another' : 'Add';
  renderCalAccounts();
  renderGoogleCal();
}

function renderMsStatus() {
  const ms = S?.status.microsoft;
  if (!SET) return;
  $('ms-space').innerHTML = SET.spaces.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');
  if (SET.microsoft) { $('ms-tenant').value = SET.microsoft.tenant || ''; $('ms-client').value = SET.microsoft.clientId || ''; $('ms-space').value = SET.microsoft.space || 'personal'; }
  let line = 'Teams and Outlook', bad = false, actions = '', status = '';
  if (ms?.signIn) status = `<p class="signin">Go to <a href="${safeHref(ms.signIn.url)}" target="_blank" rel="noopener">${esc(ms.signIn.url)}</a> and enter <b class="mono code">${esc(ms.signIn.code)}</b></p>`;
  else if (ms?.connected) {
    line = ms.ok === false ? esc(ms.error) : ms.canWrite === false ? 'Read only: connect again to reply and archive' : esc(ms.email || 'Connected');
    bad = ms.ok === false || ms.canWrite === false;
    actions = `${ms.canWrite === false ? '<button class="btn" type="button" data-ms-open>Connect again</button>' : ''}<button class="btn btn--quiet" type="button" id="ms-disconnect">Disconnect</button>`;
  } else {
    if (ms?.error) { line = esc(ms.error); bad = true; }
    actions = '<button class="btn" type="button" data-ms-open>Connect</button>';
  }
  $('ms-line').textContent = ''; $('ms-line').innerHTML = line; $('ms-line').className = 'acct-line' + (bad ? ' bad-text' : '');
  $('ms-actions').innerHTML = actions;
  $('ms-status').innerHTML = status;
  if (ms?.connected && !ms?.signIn && ms.canWrite !== false) $('ms-connect').hidden = true;
}

// Developer accounts: GitHub through the gh tool, and each coding agent signed in its own way.
function renderDev() {
  const st = S.status;
  const gh = st.github.ok === true ? card({ name: 'GitHub', line: 'Connected', conn: 'github' })
    : card({ name: 'GitHub', conn: 'github', line: st.github.ok === false ? 'Run <span class="mono">gh auth login</span> in a terminal' : 'Checking…', bad: st.github.ok === false });
  const how = {
    claude: { install: 'npm i -g @anthropic-ai/claude-code', login: 'claude' },
    codex: { install: 'npm i -g @openai/codex', login: 'codex login', note: 'Signs in with your ChatGPT account' },
    gemini: { install: 'npm i -g @google/gemini-cli', login: 'gemini', note: 'Signs in with your Google account' }
  };
  const agents = SET.agents.filter((a) => how[a.id]).map((a) => {
    const h = how[a.id];
    const name = a.id === 'codex' ? 'ChatGPT (Codex)' : a.name;
    if (!a.installed) return card({ name, conn: a.id, line: h.note || 'Not installed', actions: `<button class="btn" type="button" data-term-cmd="${esc(h.install + ' && ' + h.login)}">Install</button>` });
    if (a.id === 'claude') return card({ name, conn: a.id, line: st.hooks ? 'Connected' : 'Run <span class="mono">npm run setup</span> in the Switchboard folder' , bad: !st.hooks });
    if (!a.signedIn) return card({ name, conn: a.id, line: 'Installed, not signed in', actions: `<button class="btn" type="button" data-term-cmd="${esc(h.login)}">Sign in</button>` });
    return card({ name, conn: a.id, line: 'Ready for new sessions' });
  });
  $('dev-cards').innerHTML = gh + agents.join('');
}

// -- projects: a real editor, each project with its own matching rules
function renderProjects() {
  const groups = [...new Set(SET.spaces.map((s) => s.group || 'Mine'))];
  $('proj-list').innerHTML = SET.spaces.map((p, i) => {
    const mine = SET.rules.map((r, j) => [r, j]).filter(([r]) => r[1] === p.id);
    return `<div class="proj" data-i="${i}">
      <div class="proj-top">
        <details class="swatch"><summary style="background:${safeColor(p.color)}" aria-label="Color"></summary><div class="swatches">${SWATCHES.map((c) => `<button type="button" style="background:${c}" data-color="${c}" aria-label="${c}"></button>`).join('')}<input type="color" value="${esc(p.color)}" data-color-pick aria-label="Any color"></div></details>
        <input class="proj-name" value="${esc(p.name)}" data-field="name" aria-label="Project name">
        <button class="btn btn--quiet" type="button" data-proj-del ${SET.spaces.length < 2 ? 'disabled' : ''}>Remove</button>
      </div>
      <div class="proj-fields">
        <label>Group<input list="proj-groups" value="${esc(p.group || 'Mine')}" data-field="group"></label>
        <label>Send email from<select data-field="from"><option value="">Default address</option>${SET.sendAs.map((a) => `<option ${a.address.toLowerCase() === (p.from || '') ? 'selected' : ''}>${esc(a.address.toLowerCase())}</option>`).join('')}</select></label>
      </div>
      <div class="proj-rules">
        <span class="field-label">Belongs here when it mentions</span>
        <div class="rule-chips">${mine.map(([r, j]) => `<span class="rule">${esc(r[0])}<button type="button" data-rule-del="${j}" aria-label="Remove ${esc(r[0])}">×</button></span>`).join('')}
          <input class="rule-add" list="rule-choices" placeholder="${mine.length ? 'Add a repo, person or chat' : 'Pick a repo, person or chat, or type a name, address or domain'}" data-rule-add></div>
        ${p.id ? `<a class="proj-open" href="#project/${esc(p.id)}" data-close="settings-scrim">Open ${esc(p.name)} to add notes and see everything in it</a>` : ''}
      </div>
    </div>`;
  }).join('') + `<datalist id="proj-groups">${groups.map((g) => `<option value="${esc(g)}">`).join('')}</datalist>`
    + `<datalist id="rule-choices">${(ruleChoiceList || []).map((c) => `<option value="${esc(c.rule)}" label="${esc(c.line)}"></option>`).join('')}</datalist>`;
  if (!ruleChoiceList) api('/api/rule-choices').then((l) => { ruleChoiceList = l; if ($('rule-choices')) renderProjects(); }).catch(() => { ruleChoiceList = []; });
}
// Every repo, person, chat and domain Switchboard knows (lib/sorting.js ruleChoices), offered as you type a rule.
let ruleChoiceList = null;
async function addRule(input) {
  const v = input.value.trim(), p = SET.spaces[Number(input.closest('.proj').dataset.i)];
  if (!v) return;
  // A project just added has no id until it is saved: save it first, then add.
  if (!p.id) {
    await saveProjects();
    SET.spaces = (await api('/api/settings')).spaces;
    const fresh = SET.spaces.find((s) => s.name === p.name);
    if (!fresh?.id) { toast('Give the project a name first, then add what belongs in it.', { kind: 'error' }); return; }
    Object.assign(p, fresh);
    SET.spaces = SET.spaces.map((s) => s.id === fresh.id ? p : s);
  }
  SET.rules = [...SET.rules.filter((r) => !(r[0].toLowerCase() === v.toLowerCase() && r[1] === p.id)), [v, p.id]];
  renderProjects(); saveRules();
  document.querySelector(`.proj[data-i="${SET.spaces.indexOf(p)}"] [data-rule-add]`)?.focus();
}
const saveProjects = () => saveSet({ spaces: SET.spaces });
const saveRules = () => saveSet({ rules: SET.rules });

// -- notifications
function renderAlerts() {
  const n = SET.notify;
  document.querySelectorAll('[data-notify]').forEach((c) => { c.checked = n[c.dataset.notify] !== false; });
  $('quiet-on').checked = !!n.quiet.on;
  $('quiet-from').value = n.quiet.from; $('quiet-to').value = n.quiet.to;
  $('quiet-times').hidden = !n.quiet.on;
}
function saveAlerts() {
  document.querySelectorAll('[data-notify]').forEach((c) => { SET.notify[c.dataset.notify] = c.checked; });
  SET.notify.quiet = { on: $('quiet-on').checked, from: $('quiet-from').value || '22:00', to: $('quiet-to').value || '07:00' };
  $('quiet-times').hidden = !SET.notify.quiet.on;
  saveSet({ notify: SET.notify });
}

// -- mail
function renderSigs() {
  $('sig-list').innerHTML = SET.sendAs.map((a, i) => {
    const html = SET.signatures[a.address.toLowerCase()] || '';
    return `<div class="sig"><label for="sig-${i}">${esc(a.address)}</label><textarea id="sig-${i}" data-sig="${esc(a.address)}" spellcheck="false" placeholder="Paste the HTML signature">${esc(html)}</textarea>${html ? `<iframe class="sig-preview" sandbox="" referrerpolicy="no-referrer" title="Signature preview" srcdoc="${esc(html)}"></iframe>` : ''}</div>`;
  }).join('') || '<p class="pane-lead">Connect an email account first.</p>';
}

// -- appearance
let wxResults = [];
function renderWeatherSet() {
  const host = $('weather-set'); if (!host) return;
  const w = S?.weather;
  if (w && !host.querySelector('#wx-q')) {
    host.innerHTML = `<div class="form-row"><span class="acct-line">${esc(w.place)}${w.ok === false ? ` <span class="bad-text">${esc(w.error)}</span>` : w.now ? ` · ${w.now.temp}° ${esc(w.now.text)}` : ''}</span></div>
      <div class="form-row"><div class="seg" id="wx-units"><button type="button" value="f" aria-pressed="${w.now?.unit !== 'C'}">°F</button><button type="button" value="c" aria-pressed="${w.now?.unit === 'C'}">°C</button></div>
      <button class="btn btn--quiet" type="button" id="wx-change">Change place</button><button class="btn btn--quiet" type="button" id="wx-clear">Remove</button></div>`;
    return;
  }
  if (!host.querySelector('#wx-q')) host.innerHTML = `<div class="wx-combo"><input id="wx-q" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="wx-results" placeholder="ZIP code or town" autocomplete="off" spellcheck="false"><div id="wx-results" class="wx-results" role="listbox"></div></div>`;
  renderWxResults();
}
let wxActive = 0, wxTimer = null, wxAsked = '';
function renderWxResults() {
  const list = $('wx-results'); if (!list) return;
  list.innerHTML = wxResults.map((r, i) => `<div role="option" id="wx-opt-${i}" class="wx-pick" data-wx-pick="${i}" aria-selected="${i === wxActive}">${esc(r.name)}</div>`).join('')
    || (wxAsked && $('wx-q')?.value.trim() === wxAsked ? '<div class="wx-none">No match yet: try a ZIP code, or "Town, State".</div>' : '');
  $('wx-q').setAttribute('aria-expanded', String(wxResults.length > 0));
  $('wx-q').setAttribute('aria-activedescendant', wxResults.length ? `wx-opt-${wxActive}` : '');
}
function pickWeather(r) {
  api('/api/weather', { place: r }).then(load).then(() => { wxResults = []; $('weather-set').innerHTML = ''; renderWeatherSet(); toast(`Weather for ${r.name}.`); }).catch((err) => toast(err.message, { kind: 'error' }));
}
document.addEventListener('input', (e) => {
  if (e.target.id !== 'wx-q') return;
  clearTimeout(wxTimer);
  const q = e.target.value.trim();
  if (q.length < 2) { wxResults = []; wxAsked = ''; renderWxResults(); return; }
  wxTimer = setTimeout(async () => {
    const home = (navigator.language.split('-')[1] || '').toUpperCase();
    let places = [];
    try { places = (await api('/api/weather/find', { q, home })).places; } catch {}
    if ($('wx-q')?.value.trim() !== q) return;   // typed on since
    wxResults = places; wxActive = 0; wxAsked = q; renderWxResults();
  }, 250);
});
document.addEventListener('keydown', (e) => {
  if (e.target.id !== 'wx-q') return;
  if (e.key === 'ArrowDown' && wxResults.length) { e.preventDefault(); wxActive = (wxActive + 1) % wxResults.length; renderWxResults(); }
  else if (e.key === 'ArrowUp' && wxResults.length) { e.preventDefault(); wxActive = (wxActive - 1 + wxResults.length) % wxResults.length; renderWxResults(); }
  else if (e.key === 'Enter') { e.preventDefault(); if (wxResults[wxActive]) pickWeather(wxResults[wxActive]); }
  else if (e.key === 'Escape' && wxResults.length) { e.stopPropagation(); wxResults = []; renderWxResults(); }
});
function renderVoice() {
  const v = S?.voice || {}, row = $('voice-row');
  if (!row) return;
  const live = (S?.prefs?.voice || 'live') === 'live';
  const how = live ? (browserSpeech ? 'Words show as you say them. Uses this browser\'s speech service (Google in Chrome, Apple in Safari).' : 'This browser has no live speech, so it uses Whisper on this computer.')
    : 'Whisper on this computer: nothing leaves it, and words catch up at pauses.';
  if (live && browserSpeech) { row.innerHTML = `<span class="acct-line">${how}</span>`; return; }
  row.innerHTML = v.ready ? `<span class="acct-line">${how}</span>`
    : v.running ? `<span class="acct-line">${esc(v.step || 'Starting')}${v.progress ? ' · ' + Number(v.progress) + '%' : ''}</span>`
    : `<button class="btn" type="button" id="voice-setup">Set up</button><span class="acct-line ${v.error ? 'bad-text' : ''}">${v.error ? esc(v.error) : 'One-time download, about 500 MB. Speech stays on this computer.'}</span>`;
}
function renderLook() {
  renderVoice(); renderWeatherSet(); renderAbout(); if (!$('remove-row')?.childElementCount) renderRemove();
  document.querySelectorAll('.seg[data-pref]').forEach((g) => {
    const v = String(SET.prefs[g.dataset.pref]);
    g.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.value === v));
  });
  // On/off switches (the Sessions extras). The graphics card one needs WebGL2.
  document.querySelectorAll('[data-pref-bool]').forEach((i) => {
    const k = i.dataset.prefBool, noGpu = k === 'termGpu' && !gpuAvailable();
    i.checked = !noGpu && !!SET.prefs[k]; i.disabled = noGpu;
    if (noGpu) i.closest('label').title = 'This browser has no WebGL2, so terminals use the normal renderer.';
  });
}
// -- About: which Switchboard this is, and where its updates come from.
// version comes from server.js (package.json's version, the git SHA, the update
// channel from lib/update.js); a copy that is not a git checkout has no channel.
// In the app (v.app) the app's own updater does the checking and installing.
let aboutNote = '';
function renderAbout() {
  const el = $('about'), v = S?.version || {};
  if (!el) return;
  const os = { linux: 'Linux', darwin: 'macOS', win32: 'Windows' }[S?.platform] || S?.platform || '';
  const line = ['Switchboard ' + (v.pkg || ''), v.sha, os].filter((x) => x && x !== 'Switchboard ').join(' · ');
  const note = aboutNote || (v.error ? v.error : v.behind ? `${v.behind} update${v.behind > 1 ? 's' : ''} ready: ${(v.subjects || [])[0] || ''}` : '');
  const canUpdate = !!(v.sha || v.app);
  el.innerHTML = `<div class="form-row"><span class="mono">${esc(line)}</span>${canUpdate ? `<button class="btn" type="button" id="about-check" ${v.busy ? 'disabled' : ''}>Check for updates</button>` : ''}<span class="acct-line ${v.error ? 'bad-text' : ''}">${esc(note)}</span></div>`
    + (v.channel ? `<div class="form-row"><span class="acct-line">Updates</span><div class="seg" id="about-channel"><button type="button" value="stable" aria-pressed="${v.channel === 'stable'}">Stable</button><button type="button" value="latest" aria-pressed="${v.channel === 'latest'}">Latest</button></div><span class="acct-line">${v.channel === 'stable' ? 'Releases only.' : 'Every change as it lands.'}</span></div>` : '')
    // Off by default: the Update ready button always shows; this only saves the click.
    + (canUpdate ? `<label class="toggle"><span>Install updates on their own when no agent is working</span><input type="checkbox" data-pref-bool="autoUpdate" ${S?.prefs?.autoUpdate ? 'checked' : ''}></label>` : '');
}
document.addEventListener('click', async (e) => {
  if (e.target.closest('#about-check')) {
    aboutNote = 'Checking…'; renderAbout();
    try { const r = await api('/api/update/check', {}); aboutNote = r.error ? '' : r.behind ? '' : 'Up to date.'; await load(); }
    catch (err) { aboutNote = err.message; }
    renderAbout(); aboutNote = '';
    return;
  }
  const ch = e.target.closest('#about-channel button');
  if (ch && ch.getAttribute('aria-pressed') !== 'true') {
    aboutNote = 'Switching…'; renderAbout();
    try { const r = await api('/api/update/channel', { channel: ch.value }); aboutNote = r.note || (r.channel === 'stable' ? 'Updates now come from releases.' : 'Updates now come from every change.'); await load(); }
    catch (err) { aboutNote = err.message; }
    renderAbout(); aboutNote = '';
  }
});
document.addEventListener('change', (e) => {
  const k = e.target.dataset?.prefBool;
  if (!k || !SET) return;
  const v = e.target.checked;
  SET.prefs[k] = v; if (S) S.prefs = { ...S.prefs, [k]: v };
  if (k === 'termGpu') closeXterm();   // reopens with or without the GPU
  saveSet({ prefs: { [k]: v } });
  if (S) render();
});
const SIZES = { s: 0.92, m: 1, l: 1.1, xl: 1.22 };
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
function applyPrefs(p) {
  if (!p) return;
  const dark = p.theme === 'dark' || (p.theme === 'system' && darkQuery.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.setProperty('--zoom', SIZES[p.textSize] || 1);
  const fs = Number(p.termSize) || 13.5;
  if (tv.term && tv.term.options.fontSize !== fs) { tv.term.options.fontSize = fs; tv.ro?.claim?.(); }
  store.set('prefs', p);   // so the next load paints in the right theme at once
}
darkQuery.addEventListener('change', () => applyPrefs(S?.prefs));
applyPrefs(store.get('prefs', null));

document.addEventListener('click', (e) => {
  if (!e.target.closest('#settings-scrim')) return;
  const nav = e.target.closest('[data-pane]');
  if (nav) { showPane(nav.dataset.pane); return; }
  const seg = e.target.closest('.seg[data-pref] button');
  if (seg) {
    const k = seg.parentElement.dataset.pref, v = k === 'termSize' ? Number(seg.value) : seg.value;
    SET.prefs[k] = v; if (S) S.prefs = { ...S.prefs, [k]: v }; renderLook(); applyPrefs(SET.prefs); saveSet({ prefs: { [k]: v } });
    if (k === 'sessionView') { useSessionView(v); if (page === 'sessions') render(); }   // every session follows the new choice
    return;
  }
  if (e.target.closest('#wx-change')) { $('weather-set').innerHTML = ''; wxResults = []; wxAsked = ''; const keep = S.weather; S.weather = null; renderWeatherSet(); S.weather = keep; $('wx-q').focus(); return; }
  if (e.target.closest('#wx-clear')) { api('/api/weather', { clear: true }).then(load).then(() => { $('weather-set').innerHTML = ''; renderWeatherSet(); }); return; }
  const wu = e.target.closest('#wx-units button');
  if (wu) { api('/api/weather', { units: wu.value }).then(load).then(() => { $('weather-set').innerHTML = ''; renderWeatherSet(); }); return; }
  const wp = e.target.closest('[data-wx-pick]');
  if (wp) { pickWeather(wxResults[+wp.dataset.wxPick]); return; }
  if (e.target.closest('#open-welcome')) { closeDialog('settings-scrim'); openWelcome(0); return; }
  if (e.target.closest('#voice-setup')) { api('/api/voice/setup', {}).then(load).catch((err) => toast(err.message, { kind: 'error' })); return; }
  if (e.target.closest('#cal-open')) { $('cal-form').hidden = false; $('cal-url').focus(); return; }
  const cr = e.target.closest('[data-cal-remove]');
  if (cr) { api('/api/calendars', { remove: cr.dataset.calRemove }).then(() => openSettings()).catch((err) => toast(err.message, { kind: 'error' })); return; }
  if (e.target.closest('#gmail-open')) { $('gmail-form').hidden = false; $('gmail-open').hidden = true; $('g-email').focus(); return; }
  if (e.target.closest('[data-ms-open]')) { $('ms-connect').hidden = false; return; }
  const tc = e.target.closest('[data-term-cmd]');
  if (tc) { runInTerminal(tc.dataset.termCmd); return; }
  const proj = e.target.closest('.proj');
  if (proj) {
    const i = Number(proj.dataset.i), p = SET.spaces[i];
    const col = e.target.closest('[data-color]');
    if (col) { p.color = col.dataset.color; proj.querySelector('.swatch').open = false; renderProjects(); saveProjects(); return; }
    if (e.target.closest('[data-proj-del]')) {
      const b = e.target.closest('[data-proj-del]');
      if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Remove ' + p.name + '?'; b.classList.add('btn--danger'); return; }
      SET.rules = SET.rules.filter((r) => r[1] !== p.id); SET.spaces.splice(i, 1);
      renderProjects(); saveSet({ spaces: SET.spaces, rules: SET.rules }); return;
    }
    const rd = e.target.closest('[data-rule-del]');
    if (rd) { SET.rules.splice(Number(rd.dataset.ruleDel), 1); renderProjects(); saveRules(); return; }
  }
  if (e.target.closest('#proj-add')) {
    let name = 'New project', n = 2;
    while (SET.spaces.some((s) => s.name === name)) name = 'New project ' + n++;
    SET.spaces.push({ name, color: SWATCHES[SET.spaces.length % SWATCHES.length], group: SET.spaces.at(-1)?.group || 'Mine' });
    renderProjects();
    const inp = [...document.querySelectorAll('.proj-name')].at(-1); inp.focus(); inp.select();
  }
});

document.addEventListener('change', (e) => {
  if (!e.target.closest('#settings-scrim')) return;
  if (e.target.id === 'allow-remote') { api('/api/account/remote', { allow: e.target.checked }).then(() => { toast(e.target.checked ? 'Your other computers can use sessions here.' : 'Sessions here are private to this computer now.'); return load(); }).catch((err) => toast(err.message, { kind: 'error' })); return; }
  if (e.target.matches('[data-cal-space]')) { api('/api/calendars', { id: e.target.dataset.calSpace, space: e.target.value }).then(load).catch((err) => toast(err.message, { kind: 'error' })); return; }
  if (e.target.matches('[data-notify], #quiet-on, #quiet-from, #quiet-to')) { saveAlerts(); return; }
  if (e.target.matches('[data-sig]')) {
    SET.signatures[e.target.dataset.sig.toLowerCase()] = e.target.value;
    saveSet({ signatures: { [e.target.dataset.sig]: e.target.value } }).then(renderSigs); return;
  }
  const proj = e.target.closest('.proj');
  if (proj && e.target.matches('[data-field]')) {
    const p = SET.spaces[Number(proj.dataset.i)], v = e.target.value.trim();
    if (e.target.dataset.field === 'name' && !v) { e.target.value = p.name; return; }
    p[e.target.dataset.field] = v;
    saveProjects().then(() => api('/api/settings')).then((s) => { SET.spaces = s.spaces; });   // new projects get their id
    return;
  }
  if (proj && e.target.matches('[data-color-pick]')) { SET.spaces[Number(proj.dataset.i)].color = e.target.value; renderProjects(); saveProjects(); }
});

document.addEventListener('keydown', (e) => {
  if (!e.target.matches?.('[data-rule-add]') || e.key !== 'Enter') return;
  e.preventDefault();
  addRule(e.target);
});
// Picking from the list adds it at once; typing waits for Enter.
document.addEventListener('input', (e) => {
  if (!e.target.matches?.('[data-rule-add]') || (e.inputType && e.inputType !== 'insertReplacementText')) return;
  if ((ruleChoiceList || []).some((c) => c.rule === e.target.value)) addRule(e.target);
});

// Opens a terminal session running a setup command (install or sign in to an agent).
async function runInTerminal(cmd) {
  try {
    const r = await api('/api/terms', { agent: 'custom', command: cmd, setup: true });
    closeDialog('settings-scrim');
    openTerm(r.id); await load();
  } catch (err) { toast(err.message, { kind: 'error' }); }
}

document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'acct-form') return;
  e.preventDefault();
  const mode = e.submitter?.dataset.mode || 'signin';
  $('acct-msg').textContent = mode === 'signup' ? 'Creating your account…' : 'Signing in…';
  $('acct-msg').className = 'small muted';
  try {
    await api('/api/account/' + mode, { email: $('acct-email').value, password: $('acct-pass').value });
    $('acct').innerHTML = '';
    await load();
    toast(mode === 'signup' ? 'Account created. This computer is synced.' : 'Signed in. Your setup is here.');
    openSettings();
  } catch (err) { $('acct-msg').textContent = err.message; $('acct-msg').className = 'small bad-text'; }
});

document.addEventListener('click', (e) => {
  const o = e.target.closest('[data-oauth]');
  if (o) {
    // Open the sign-in page right away (a page opened later counts as a pop-up).
    const win = window.open('about:blank', '_blank');
    // Only a web address is opened: the sign-in link comes from the sync service.
    api('/api/account/oauth', { provider: o.dataset.oauth, link: !!o.dataset.link }).then((r) => { if (!/^https?:/i.test(String(r.url || ''))) throw new Error('The sign-in link was not a web address.'); if (win) win.location = r.url; else location.href = r.url; })
      .catch((err) => { win?.close(); toast(err.message, { kind: 'error' }); });
    return;
  }
  if (e.target.closest('#acct-email-toggle')) { $('acct-form').hidden = false; e.target.closest('#acct-email-toggle').hidden = true; $('acct-email').focus(); return; }
  const dr = e.target.closest('[data-device-remove]');
  if (dr) {
    if (!dr.dataset.sure) { dr.dataset.sure = '1'; dr.textContent = 'Remove it?'; dr.classList.add('btn--danger'); return; }
    dr.disabled = true;
    api('/api/account/device-remove', { id: dr.dataset.deviceRemove }).then(() => { toast('Removed. That computer is signed out.'); loadDevices(true); }).catch((err) => { dr.disabled = false; toast(err.message, { kind: 'error' }); });
    return;
  }
  const pa = e.target.closest('[data-pair-answer]');
  if (pa) { pa.disabled = true; api('/api/account/pair-answer', { id: pa.dataset.pairAnswer, approve: !!pa.dataset.approve }).then(() => { toast(pa.dataset.approve ? 'Approved. That computer is signing in.' : 'Turned down.'); return load(); }).catch((err) => toast(err.message, { kind: 'error' })); return; }
  if (e.target.closest('#rk-copy')) { navigator.clipboard.writeText(S.account.recoveryKey).then(() => toast('Copied.')); return; }
  if (e.target.closest('#rk-save')) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([`Switchboard recovery key for ${S.account.email}\n\n${S.account.recoveryKey}\n\nIt opens your Switchboard data if you lose access to all your computers. Keep it safe.\n`], { type: 'text/plain' }));
    a.download = 'switchboard-recovery-key.txt'; a.click(); return;
  }
});

document.addEventListener('submit', async (e) => {
  const f = e.target;
  if (f.id !== 'recover-form' && f.id !== 'unlock-form') return;
  e.preventDefault();
  const rec = f.id === 'recover-form', msg = $(rec ? 'recover-msg' : 'unlock-msg');
  msg.textContent = 'Unlocking…'; msg.className = 'small muted';
  try {
    await api('/api/account/' + (rec ? 'recover' : 'unlock'), rec ? { key: $('recover-key').value } : { password: $('unlock-pass').value });
    $('acct').innerHTML = ''; await load(); toast('Unlocked. Your data is here.');
  } catch (err) { msg.textContent = err.message; msg.className = 'small bad-text'; }
});

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-account]');
  if (!b) return;
  const act = b.dataset.account;
  const said = { signout: 'Signed out. This computer keeps its current setup.', sync: 'Synced.' }[act];
  api('/api/account/' + act, {}).then(() => { $('acct').innerHTML = ''; return load(); }).then(() => { renderAccount(); if (said) toast(said); }).catch((err) => toast(err.message, { kind: 'error' }));
});

$('ms-quick').addEventListener('click', async () => {
  $('ms-msg').textContent = 'Asking Microsoft for a sign-in code…'; $('ms-msg').className = 'small muted';
  try { await api('/api/microsoft/start', { space: $('ms-space').value }); $('ms-msg').textContent = ''; await load(); renderMsStatus(); }
  catch (err) { $('ms-msg').textContent = err.message; $('ms-msg').className = 'small bad-text'; }
});

$('ms-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('ms-msg').textContent = 'Asking Microsoft for a sign-in code…'; $('ms-msg').className = 'small muted';
  try { await api('/api/microsoft/start', { tenant: $('ms-tenant').value, clientId: $('ms-client').value, space: $('ms-space').value }); $('ms-msg').textContent = ''; await load(); renderMsStatus(); }
  catch (err) { $('ms-msg').textContent = err.message; $('ms-msg').className = 'small bad-text'; }
});

// As the address is typed: which provider, where its app password is made, and
// server fields only when Switchboard cannot find them.
let found = null, findTimer = null;
$('g-email').addEventListener('input', () => {
  clearTimeout(findTimer);
  const email = $('g-email').value.trim();
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) { found = null; $('g-found').textContent = 'Type your address and Switchboard finds your provider.'; $('g-servers').hidden = true; return; }
  findTimer = setTimeout(async () => {
    $('g-found').textContent = 'Looking up your provider…';
    try { found = await api('/api/mail/detect', { email }); } catch { found = null; }
    if ($('g-email').value.trim() !== email || !found) return;
    const f = found;
    $('g-found').innerHTML = f.error ? esc(f.error) : f.unsupported ? `<span class="bad-text">${esc(f.unsupported)}</span>`
      : `<b>${esc(f.name)}.</b> ${esc(f.helpText || '')}${f.help ? ` <a href="${safeHref(f.help)}" target="_blank" rel="noopener">Open</a>` : ''}`;
    $('g-connect').disabled = !!(f.unsupported || f.error);
    $('g-servers').hidden = !(f.kind === 'imap');
    $('g-servers').open = !!f.custom;
    if (f.imap) { $('g-imap').value = f.imap.host; $('g-imap-port').value = f.imap.port; $('g-smtp').value = f.smtp.host; $('g-smtp-port').value = f.smtp.port; }
    $('g-pass').placeholder = f.custom || f.provider === 'imap' ? 'password or app password' : 'app password';
  }, 500);
});

$('cal-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('cal-msg').textContent = 'Opening the calendar…'; $('cal-msg').className = 'small muted';
  try {
    const r = await api('/api/calendars', { url: $('cal-url').value, space: $('cal-space').value });
    $('cal-url').value = ''; $('cal-msg').textContent = ''; $('cal-form').hidden = true;
    toast(`Added ${r.name}.`); openSettings();
  } catch (err) { $('cal-msg').textContent = err.message; $('cal-msg').className = 'small bad-text'; }
});

$('gmail-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('gmail-msg').textContent = 'Testing the sign-in…'; $('gmail-msg').className = 'small muted';
  try {
    // Server fields count only when they were shown (another provider than a known one, or edited).
    const typed = !$('g-servers').hidden && $('g-imap').value.trim();
    const servers = typed && (found?.custom || found?.provider === 'imap' || $('g-servers').open)
      ? { imap: { host: $('g-imap').value.trim(), port: $('g-imap-port').value }, smtp: { host: $('g-smtp').value.trim(), port: $('g-smtp-port').value, secure: Number($('g-smtp-port').value) === 465 }, name: found?.name, web: found?.web } : {};
    await api('/api/gmail', { email: $('g-email').value, password: $('g-pass').value, aliases: $('g-aliases').value, ...servers });
    $('gmail-msg').textContent = ''; $('g-pass').value = ''; $('g-email').value = ''; $('g-aliases').value = '';
    $('gmail-form').hidden = true; $('gmail-open').hidden = false;
    openSettings();
  } catch (err) { $('gmail-msg').textContent = err.message; $('gmail-msg').className = 'small bad-text'; }
});
