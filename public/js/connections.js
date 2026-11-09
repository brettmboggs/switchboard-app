// Settings, Connections: your connections, grouped (Messages, Calendars,
// Money, Coding and sessions, Automation), with a search box; which cards are
// yours and the tiles to add one are connlist.js. The cards themselves are
// drawn by settings.js and webhooks.js; this file finds them and lists what is next.
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.

// What comes next, and what each needs. "free account" means someone has to
// make one (a developer app or key); nothing here costs money.
const CONN_NEXT = [
  { cat: 'messages', name: 'Slack', what: 'Messages and mentions in Inbox, reply from Switchboard.', needs: 'A free Slack app for your workspace (made in a few clicks on Slack\'s site).' },
  { cat: 'messages', name: 'Discord', what: 'Mentions and messages in servers you run, in Inbox.', needs: 'A free Discord helper (a bot) that you add to your servers. Discord gives no way in to your private messages.' },
  { cat: 'messages', name: 'Telegram', what: 'Messages sent to your own Telegram bot, in Inbox.', needs: 'Your own Telegram helper (a bot): Telegram makes one for you in a minute, free.' },
  { cat: 'messages', name: 'Outlook.com and Hotmail', what: 'Personal Microsoft mail next to Gmail.', needs: 'Nothing: you sign in with Microsoft.' },
  { cat: 'money', name: 'Bank accounts', what: 'Balances, bills due and big charges, from your bank itself.', needs: 'A free Teller account, the service that links to your bank (up to 100 bank links free).' },
  { cat: 'money', name: 'Stripe, Square or PayPal', what: 'Payments from your customers and invoices paid.', needs: 'A key from your Stripe, Square or PayPal account (each hands one out free).' },
  { cat: 'coding', name: 'Vercel, Netlify, Cloudflare', what: 'Site updates (deploys) next to GitHub builds: building, live or failed.', needs: 'A key from your Vercel, Netlify or Cloudflare account.' },
  { cat: 'automation', name: 'Home Assistant', what: 'Sensors and alerts (freezer, gate, water) on Now.', needs: 'A key from your Home Assistant (your Profile, Long-lived access tokens).' }
];

function renderConnections() {
  renderLocalAI(); renderFeedsCard(); renderTasksCard(); renderGranolaCard();
  // Bank and card alerts come from email, so they are on as soon as an email account is.
  const line = $('money-mail-line');
  if (line) line.textContent = S.status.gmail.length ? `On: read from ${S.status.gmail.length === 1 ? 'your email' : S.status.gmail.length + ' email accounts'}. Turn on alert emails in your bank's app or website and the charges show on Money.` : 'Read from your email once one is connected above: charges, receipts, payments in.';
  renderConnList();   // which cards are yours, and the tiles to add (connlist.js)
}

// The search box: a card or tile shows when its text has every word typed.
// Cards not in your list (.conn-off) stay down among the tiles; the tiles
// also follow the category chips.
function filterConnections() {
  const words = ($('conn-q')?.value || '').toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (el, extra = '') => words.every((w) => (el.textContent + ' ' + extra).toLowerCase().includes(w));
  let any = false;
  for (const g of document.querySelectorAll('#pane-connections .conn-group')) {
    let shown = 0;
    for (const c of g.querySelectorAll('[data-conn]')) {
      const show = !c.classList.contains('conn-off') && hit(c, g.querySelector('h4').textContent);
      c.hidden = !show;
      if (show) shown++;
    }
    g.hidden = !shown;
    any ||= shown > 0;
  }
  let tiles = 0;
  for (const t of document.querySelectorAll('#conn-shop .conn-tile')) {
    const show = (connCat === 'all' || t.dataset.catOf === connCat) && hit(t, t.dataset.catOf);
    t.hidden = !show;
    if (show) tiles++;
  }
  $('conn-none').hidden = any || tiles > 0;
}
document.addEventListener('input', (e) => { if (e.target.id === 'conn-q') filterConnections(); });

// Calendars from an email account that serves them (iCloud, Fastmail, Yahoo):
// one line per such account with Find calendars; then a tick per calendar, a
// project and Add. While a list is open it is left alone, so ticks stay put.
let calPick = null;   // { account, provider, calendars, error }
function renderCalAccounts() {
  const host = $('cal-accounts'); if (!host || !SET) return;
  if (calPick && host.querySelector('[data-cal-pick]')) return;
  const accts = (SET.gmail || []).filter((g) => g.calendars);
  host.innerHTML = accts.map((g) => {
    if (calPick?.account === g.email && calPick.calendars) {
      const list = calPick.calendars;
      return `<div class="cal-acct" data-cal-pick="${esc(g.email)}"><b>${esc(calPick.provider)} calendars for ${esc(g.email)}</b>
        ${list.length ? list.map((c, i) => `<label class="cal-tick"><input type="checkbox" data-cal-i="${i}" ${c.added ? 'disabled checked' : 'checked'}> ${c.color ? `<span class="tag" style="background:${safeColor(c.color)}"></span>` : ''}${esc(c.name)}${c.added ? ' <span class="muted small">already added</span>' : ''}</label>`).join('') : '<p class="muted small">No calendars on this account.</p>'}
        <div class="form-row"><select id="cal-acct-space" class="field field--sm" aria-label="Project">${SET.spaces.map((x) => `<option value="${esc(x.id)}" ${x.id === g.space ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
        <button class="btn btn--primary" type="button" data-cal-add="${esc(g.email)}" ${list.some((c) => !c.added) ? '' : 'disabled'}>Add</button><button class="btn" type="button" data-cal-cancel>Cancel</button><span id="cal-acct-msg" class="small"></span></div></div>`;
    }
    const n = (SET.calendars || []).filter((c) => c.account === g.email).length;
    return `<div class="cal-acct"><span>${esc(g.calendars)} calendars from <b>${esc(g.email)}</b>${n ? ` <span class="muted small">${n} added</span>` : ''}${calPick?.account === g.email && calPick.error ? ` <span class="bad-text small">${esc(calPick.error)}</span>` : ''}</span>
      <button class="btn" type="button" data-cal-find="${esc(g.email)}">${calPick?.account === g.email && calPick.busy ? 'Looking…' : n ? 'Add more' : 'Find calendars'}</button></div>`;
  }).join('');
}
document.addEventListener('click', async (e) => {
  const find = e.target.closest('[data-cal-find]');
  if (find) {
    calPick = { account: find.dataset.calFind, busy: true }; renderCalAccounts();
    try { const r = await api('/api/calendars/account/find', { account: calPick.account }); calPick = { account: calPick.account, provider: r.provider, calendars: r.calendars }; }
    catch (err) { calPick = { account: calPick.account, error: err.message }; }
    renderCalAccounts(); return;
  }
  if (e.target.closest('[data-cal-cancel]')) { calPick = null; $('cal-accounts').innerHTML = ''; renderCalAccounts(); return; }
  const add = e.target.closest('[data-cal-add]');
  if (add && calPick?.calendars) {
    const picked = [...document.querySelectorAll('[data-cal-i]')].filter((x) => x.checked && !x.disabled).map((x) => calPick.calendars[Number(x.dataset.calI)]);
    add.disabled = true;
    try {
      const r = await api('/api/calendars/account/add', { account: calPick.account, space: $('cal-acct-space').value, calendars: picked });
      calPick = null; $('cal-accounts').innerHTML = '';
      SET = await api('/api/settings'); renderCalendars();
      toast(r.added === 1 ? 'Calendar added.' : `${r.added} calendars added.`);
    } catch (err) { add.disabled = false; $('cal-acct-msg').textContent = err.message; $('cal-acct-msg').className = 'small bad-text'; }
  }
});

// Local AI models (lib/localai.js): Ollama's state in one card. Not installed:
// how to get it. Installed but not answering: how to start it. Running: its
// models (each starts a session from New session) and a few to download.
// LM Studio's downloaded models are listed and start sessions too; other local
// servers (llama.cpp, Jan) are listed when they answer.
// A model's id (llama3.2:3b, qwen2.5-coder:7b) as a name and a size word: "Llama 3.2 · small".
// The id stays in the tooltip, for anyone who wants to run it by name.
const MODEL_FAMILY = { llama: 'Llama', codellama: 'Code Llama', qwen: 'Qwen', gemma: 'Gemma', mistral: 'Mistral', mixtral: 'Mixtral', phi: 'Phi', deepseek: 'DeepSeek', 'gpt-oss': 'GPT-OSS', granite: 'Granite', smollm: 'SmolLM' };
function modelName(id, hint = '') {
  const [base, tag = ''] = String(id).split(':');
  const short = base.split('/').pop();
  const name = MODEL_FAMILY[short.toLowerCase()] || short.split('-').map((w) => {
    const m = w.match(/^([a-z]+?)([\d.]*)$/i);
    if (!m) return w.toUpperCase() === w ? w : w[0].toUpperCase() + w.slice(1);
    const fam = MODEL_FAMILY[m[1].toLowerCase()] || (m[1].length <= 2 ? m[1].toUpperCase() : m[1][0].toUpperCase() + m[1].slice(1));
    return fam + (m[2] ? (m[1].length > 1 ? ' ' : '') + m[2] : '');
  }).join(' ');
  const b = Number((tag.match(/^(\d+(?:\.\d+)?)b/i) || String(hint).match(/\b(\d+(?:\.\d+)?)B\b/) || [])[1]);
  const size = !b ? '' : b <= 4 ? 'small' : b <= 9 ? 'medium' : b <= 20 ? 'large' : 'very large';
  return size ? `${name} · ${size}` : name;
}
const OLLAMA_INSTALL = { linux: 'curl -fsSL https://ollama.com/install.sh | sh', darwin: 'brew install ollama && brew services start ollama', win32: 'winget install Ollama.Ollama' };
function renderLocalAI() {
  const el = $('local-ai-card'), L = SET?.localAI; if (!el || !L) return;
  const ollama = L.servers.find((s) => s.id === 'ollama'), others = L.servers.filter((s) => s.id !== 'ollama');
  const size = (n) => n ? ` <span class="muted small">${(n / 1e9).toFixed(1)} GB</span>` : '';
  let line, actions = '', wide = '';
  if (ollama) {
    line = ollama.models.length ? `Running, ${ollama.models.length} model${ollama.models.length === 1 ? '' : 's'}. Start one from New session: Agent, Local model (Ollama).` : 'Running, no models yet. Get one below.';
    const have = new Set(ollama.models.map((m) => m.id.replace(/:latest$/, '')));
    wide = (ollama.models.length ? `<div class="lai-list">${ollama.models.map((m) => `<span title="${esc(m.id)}">${esc(modelName(m.id))}${size(m.size)}</span>`).join('')}</div>` : '')
      + `<div class="lai-get"><span class="muted small">Get a model (downloads once, then runs offline):</span>${L.starters.filter((s) => !have.has(s.model)).map((s) => `<div class="lai-row"><span><b title="${esc(s.model)}">${esc(modelName(s.model, s.what))}</b> <span class="muted small">${esc(String(s.what).split(': ').slice(1).join(': ') || s.what)}</span></span><button class="btn" type="button" data-term-cmd="${esc('ollama pull ' + s.model)}">Get</button></div>`).join('')}</div>`;
  } else if (L.ollamaInstalled) {
    line = 'Installed, but not running.';
    actions = `<button class="btn" type="button" data-term-cmd="ollama serve">Start it</button>`;
  } else {
    line = 'Run AI models on this computer: private, free, and they work offline. Ollama is the easy way in.';
    const cmd = OLLAMA_INSTALL[S.platform];
    actions = cmd ? `<button class="btn" type="button" data-term-cmd="${esc(cmd)}">Install Ollama</button>` : '';
  }
  // LM Studio: its downloaded models start sessions too (New session: Agent, Local model (LM Studio)).
  const lm = L.lmstudio;
  if (lm) {
    const n = lm.models.length;
    if (!ollama) { line = n ? `LM Studio has ${n} model${n === 1 ? '' : 's'}. Start one from New session: Agent, Local model (LM Studio).` : 'LM Studio is installed, with no models yet: download one in LM Studio.'; actions = ''; }
    else line += ` LM Studio: ${n} model${n === 1 ? '' : 's'}, from New session: Agent, Local model (LM Studio).`;
    if (n) wide += `<div class="lai-list">${lm.models.map((m) => `<span title="${esc(m.id)}"><b>${esc(m.name)}</b>${size(m.size)}</span>`).join('')}</div>`;
  }
  const rest = others.filter((s) => !(lm && s.id === 'lmstudio'));
  if (rest.length) wide += `<div class="lai-list">${rest.map((s) => `<span>${esc(s.name)}: ${s.models.length} model${s.models.length === 1 ? '' : 's'} running</span>`).join('')}</div>`;
  el.innerHTML = `<div class="acct-main"><b>Local AI models</b><span class="acct-line">${line}</span></div>
    <div class="form-row">${actions}<button class="btn btn--quiet" type="button" data-lai-refresh>Check again</button></div>${wide ? `<div class="acct-wide">${wide}</div>` : ''}`;
}
document.addEventListener('click', async (e) => {
  if (!e.target.closest('[data-lai-refresh]')) return;
  try { SET.localAI = await api('/api/localai/refresh', {}); renderLocalAI(); toast('Checked.'); } catch (err) { toast(err.message, { kind: 'error' }); }
});
