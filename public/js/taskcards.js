// Settings, Connections: one card per task app (Todoist, Trello, Asana,
// Notion). Each connects with what that app hands out on its own settings page,
// pasted here; the link to that page is on the card. Connected, the card says
// how many are due, has the project they go to, Disconnect, and for Notion the
// database to read when more than one is shared.
// One of the page's scripts in public/js, loaded in order by index.html.
const taskLink = (href, text) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
const TASK_CARDS = {
  todoist: { card: 'tasks-card', help: `Tasks due today or overdue on Now; Done there ticks them off in Todoist. Your Todoist key (Todoist calls it an API token) is in Todoist: Settings, Integrations, Developer. Copy it and paste it here.`,
    fields: [{ n: 'token', ph: 'Todoist key (API token)' }] },
  trello: { card: 'trello-card', help: `Cards with a due date, on boards you are on, show on Now when due; Done marks the due date complete. Trello needs two codes, made on its site: 1. Open ${taskLink('https://trello.com/power-ups/admin', 'Trello\'s Power-Ups page')}, press New, fill in the short form, then press Generate a new API key. 2. Paste that key in the first box. 3. Press Get a token, then Allow on Trello. 4. Paste the code Trello shows in the second box, and Connect.`,
    fields: [{ n: 'key', ph: 'Trello key (API key)', plain: true }, { n: 'token', ph: 'Trello code (token)' }], tokenFor: (key) => `https://trello.com/1/authorize?expiration=never&name=Switchboard&scope=read,write&response_type=token&key=${encodeURIComponent(key)}` },
  asana: { card: 'asana-card', help: `Tasks assigned to you, due today or overdue, on Now; Done completes them in Asana. Make an Asana key (Asana calls it a personal access token) on ${taskLink('https://app.asana.com/0/my-apps', 'Asana\'s developer page')}: Create new token, give it a name, copy it, and paste it here.`,
    fields: [{ n: 'token', ph: 'Asana key (personal access token)' }] },
  notion: { card: 'notion-card', help: `Pages in your task database with a date of today or earlier, on Now; Done ticks its Done box or sets its status to done. Make a Notion connection on ${taskLink('https://www.notion.so/my-integrations', 'Notion\'s connections page')} (Notion calls it an integration), copy its key (the integration secret) and paste it here. Then in Notion open your task database, ··· (top right), Connections, and add it.`,
    fields: [{ n: 'token', ph: 'Notion key (integration secret)' }] }
};

function renderTasksCard() {
  if (!SET) return;
  for (const [source, ui] of Object.entries(TASK_CARDS)) {
    const el = $(ui.card); if (!el) continue;
    // In use (focus inside, something typed, or a message showing): leave it as it is.
    if (el.contains(document.activeElement) || [...el.querySelectorAll('input')].some((i) => i.value) || el.querySelector('[data-task-msg]')?.textContent) continue;
    const name = TASK_APP[source];
    const st = S.taskStatus?.[source] || { connected: false };
    const pick = (v) => `<select class="field field--sm" data-task-space="${source}" aria-label="Project for ${name} tasks">${SET.spaces.map((x) => `<option value="${esc(x.id)}" ${x.id === v ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`;
    if (st.connected) {
      const line = st.ok === false ? `<span class="bad-text">${esc(st.error)}</span>` : st.ok ? `Connected${st.db ? ` to ${esc(st.db.name)}` : ''}. ${st.count ? `${st.count} due today or overdue, on Now.` : 'Nothing due today.'}` : 'Connected, looking…';
      const lists = (st.lists || []).length > 1 ? `<select class="field field--sm" data-task-list="${source}" aria-label="Which ${name} database">${st.lists.map((l) => `<option value="${esc(l.id)}" ${l.id === st.db?.id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>` : '';
      el.innerHTML = `<div class="acct-main"><b>${name}</b><span class="acct-line">${line}</span></div>
        <div class="form-row">${lists}${pick(st.space)}<button class="btn btn--quiet" type="button" data-task-disconnect="${source}">Disconnect</button></div>`;
      continue;
    }
    const inputs = ui.fields.map((f) => `<label for="${source}-${f.n}" class="sr">${f.ph}</label><input id="${source}-${f.n}" name="${f.n}" class="field" type="${f.plain ? 'text' : 'password'}" autocomplete="off" spellcheck="false" placeholder="${f.ph}">`).join('');
    el.innerHTML = `<div class="acct-main"><b>${name}</b><span class="acct-line">${ui.help}</span></div>
      <form class="acct-wide form-row" data-task-connect="${source}">${inputs}${ui.tokenFor ? '<button class="btn btn--quiet" type="button" data-task-token>Get a token</button>' : ''}${pick(captureSpace() === 'all' ? 'personal' : captureSpace())}
        <button class="btn" type="submit">Connect</button><span class="small" data-task-msg></span></form>`;
  }
}

document.addEventListener('submit', async (e) => {
  const f = e.target.closest('[data-task-connect]'); if (!f) return;
  e.preventDefault();
  const source = f.dataset.taskConnect, btn = f.querySelector('button[type=submit]'), msg = f.querySelector('[data-task-msg]');
  const val = (n) => f.querySelector(`input[name="${n}"]`)?.value || '';
  btn.disabled = true; btn.textContent = 'Checking…'; msg.textContent = '';
  try {
    await api('/api/tasks/connect', { source, token: val('token'), key: val('key'), space: f.querySelector('select').value });
    f.querySelectorAll('input').forEach((i) => { i.value = ''; });
    toast(`${TASK_APP[source]} connected.`); document.activeElement?.blur(); await load(); renderTasksCard();
  } catch (err) { msg.textContent = err.message; msg.className = 'small bad-text'; btn.disabled = false; btn.textContent = 'Connect'; }
});
// Trello: the token is made on Trello's own page, for the key typed here.
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-task-token]'); if (!b) return;
  const f = b.closest('[data-task-connect]'), ui = TASK_CARDS[f.dataset.taskConnect];
  const key = f.querySelector('input[name="key"]').value.trim(), msg = f.querySelector('[data-task-msg]');
  if (!/^[0-9a-f]{32}$/i.test(key)) { msg.textContent = 'Paste the Trello key in the first box first (32 letters and numbers), then Get a token.'; msg.className = 'small bad-text'; return; }
  window.open(ui.tokenFor(key), '_blank', 'noopener');
  msg.textContent = 'Press Allow on Trello, then paste the code it shows in the second box.'; msg.className = 'small';
  f.querySelector('input[name="token"]').focus();
});
document.addEventListener('change', async (e) => {
  const s = e.target.closest('[data-task-space], [data-task-list]'); if (!s || s.closest('form')) return;
  const source = s.dataset.taskSpace || s.dataset.taskList;
  try { await api('/api/tasks/edit', s.dataset.taskList ? { source, list: s.value } : { source, space: s.value }); toast(s.dataset.taskList ? 'Reading that database now.' : 'Moved.'); await load(); renderTasksCard(); } catch (err) { toast(err.message, { kind: 'error' }); }
});
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-task-disconnect]'); if (!b) return;
  const source = b.dataset.taskDisconnect;
  try { await api('/api/tasks/disconnect', { source }); toast(`${TASK_APP[source]} disconnected. Its key is removed from this computer.`); await load(); renderTasksCard(); } catch (err) { toast(err.message, { kind: 'error' }); }
});
