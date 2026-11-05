// The task apps besides Todoist, one adapter each, used by lib/tasks.js:
// what is due today or overdue and still open, and Done closing it in the app.
// Every one connects with a key the person pastes in Settings (no sign-in
// window: each app hands out personal keys on its own settings page), kept
// in the locked 'tasks' setting and never sent to the page. Each only ever
// asks its own address.
//
//   Trello  an API key (trello.com/power-ups/admin) and a token made for it.
//           Cards on boards you are a member of, with a due date not yet marked
//           complete. Done marks the due date complete.
//   Asana   a personal access token (app.asana.com/0/my-apps). Tasks assigned
//           to you, in each workspace. Done completes the task.
//   Notion  an internal integration's secret (notion.so/my-integrations), and
//           a database shared with it (the database's ··· menu, Connections).
//           Its pages with a date on or before today and not done; done is
//           a checkbox, or a status in the Complete group. Done sets it.

const TIMEOUT = 15000;
export const DAY_END = () => new Date().setHours(23, 59, 59, 999);

// "2026-11-04" is that whole day here; anything with a time is that moment.
export function dueOf(s) {
  const d = String(s || '');
  const m = d.match(/^(\d{4})-(\d\d)-(\d\d)$/);
  if (m) return { at: new Date(+m[1], +m[2] - 1, +m[3]).getTime(), allDay: true };
  const t = Date.parse(d);
  return Number.isFinite(t) ? { at: t, allDay: false } : null;
}
const clip = (s, n) => String(s || '').slice(0, n);

async function ask(fetchImpl, app, url, init, refuse) {
  const r = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT), redirect: 'error' });
  if (r.status === 401 || r.status === 403) throw new Error(refuse);
  if (r.status === 429) throw new Error(`${app} asked Switchboard to slow down; it tries again shortly.`);
  if (r.status === 404) throw new Error(`${app} could not find that. It may have been deleted, or the key cannot see it.`);
  if (!r.ok) throw new Error(`${app} answered ${r.status}.`);
  return r.status === 204 ? null : r.json().catch(() => null);
}

// ---- Trello
const TRELLO = 'https://api.trello.com/1';
const trelloAuth = (c) => `key=${encodeURIComponent(c.key)}&token=${encodeURIComponent(c.token)}`;
const trelloAsk = (c, path, init = {}, f = fetch) => ask(f, 'Trello', `${TRELLO}${path}${path.includes('?') ? '&' : '?'}${trelloAuth(c)}`, init,
  'Trello did not accept that key and token. Make the token again from the Get a token link, with this key.');
export function trelloTasks(json, end = DAY_END()) {
  return (Array.isArray(json) ? json : []).map((c) => {
    const due = dueOf(c.due);
    if (!due || c.dueComplete || c.closed || due.at > end || !/^[0-9a-f]{24}$/.test(String(c.id))) return null;
    return { id: String(c.id), text: clip(c.name, 500), note: clip(c.desc, 2000), due: due.at, allDay: false, repeats: false, every: '', priority: 1, url: /^https:\/\/trello\.com\//.test(c.shortUrl || '') ? c.shortUrl : 'https://trello.com' };
  }).filter(Boolean).sort((a, b) => a.due - b.due);
}
const trello = {
  name: 'Trello',
  creds(b) {
    const key = String(b.key || '').trim(), token = String(b.token || '').trim();
    if (!/^[0-9a-f]{32}$/i.test(key)) throw new Error('That does not look like a Trello API key: 32 letters and numbers, from trello.com/power-ups/admin, your Power-Up, API key.');
    if (!/^[A-Za-z0-9]{60,80}$/.test(token)) throw new Error('That does not look like a Trello token. Press Get a token, allow it, and copy the long code Trello shows.');
    return { key, token };
  },
  async connect(c, f) { await trelloAsk(c, '/members/me?fields=id', {}, f); return {}; },
  async list(c, f) { return trelloTasks(await trelloAsk(c, '/members/me/cards?filter=visible&fields=name,desc,due,dueComplete,shortUrl,closed', {}, f)); },
  idOk: (id) => /^[0-9a-f]{24}$/.test(id),
  async close(c, id, f) { await trelloAsk(c, `/cards/${id}?dueComplete=true`, { method: 'PUT' }, f); }
};

// ---- Asana
const ASANA = 'https://app.asana.com/api/1.0';
const asanaAsk = (c, path, init = {}, f = fetch) => ask(f, 'Asana', ASANA + path, { ...init, headers: { Authorization: `Bearer ${c.token}`, Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) } },
  'Asana did not accept that token. Make a new personal access token at app.asana.com/0/my-apps and paste it again.');
export function asanaTasks(json, end = DAY_END()) {
  return (Array.isArray(json?.data) ? json.data : []).map((t) => {
    const due = dueOf(t.due_at || t.due_on);
    if (!due || t.completed || due.at > end || !/^\d{1,30}$/.test(String(t.gid))) return null;
    return { id: String(t.gid), text: clip(t.name, 500), note: clip(t.notes, 2000), due: due.at, allDay: due.allDay, repeats: false, every: '', priority: 1, url: /^https:\/\/app\.asana\.com\//.test(t.permalink_url || '') ? t.permalink_url : 'https://app.asana.com' };
  }).filter(Boolean);
}
const asana = {
  name: 'Asana',
  creds(b) {
    const token = String(b.token || '').trim();
    if (!/^[0-9]\/[\w:/-]{20,200}$/.test(token)) throw new Error('That does not look like an Asana personal access token (it starts with 1/ or 2/). Make one at app.asana.com/0/my-apps.');
    return { token };
  },
  async connect(c, f) { await asanaAsk(c, '/users/me?opt_fields=gid', {}, f); return {}; },
  async list(c, f) {
    const me = await asanaAsk(c, '/users/me?opt_fields=workspaces.gid', {}, f);
    const out = [];
    for (const w of (me?.data?.workspaces || []).slice(0, 5)) {
      if (!/^\d{1,30}$/.test(String(w.gid))) continue;
      out.push(...asanaTasks(await asanaAsk(c, `/tasks?assignee=me&workspace=${w.gid}&completed_since=now&limit=100&opt_fields=name,notes,due_on,due_at,completed,permalink_url`, {}, f)));
    }
    return out.sort((a, b) => a.due - b.due);
  },
  idOk: (id) => /^\d{1,30}$/.test(id),
  async close(c, id, f) { await asanaAsk(c, `/tasks/${id}`, { method: 'PUT', body: JSON.stringify({ data: { completed: true } }) }, f); }
};

// ---- Notion
const NOTION = 'https://api.notion.com/v1';
const notionAsk = (c, path, init = {}, f = fetch) => ask(f, 'Notion', NOTION + path, { ...init, headers: { Authorization: `Bearer ${c.token}`, 'Notion-Version': '2022-06-28', ...(init.body ? { 'Content-Type': 'application/json' } : {}) } },
  'Notion did not accept that secret. Copy it again from notion.so/my-integrations, your integration, Internal integration secret.');
const plain = (rich) => (Array.isArray(rich) ? rich : []).map((r) => r?.plain_text || '').join('');
const UUID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
// A database can be a task list when it has a date and a way to say done.
export function notionLists(json) {
  return (Array.isArray(json?.results) ? json.results : []).map((d) => {
    const props = Object.entries(d.properties || {});
    const date = props.find(([, p]) => p.type === 'date');
    const box = props.find(([, p]) => p.type === 'checkbox');
    const status = props.find(([, p]) => p.type === 'status');
    let done = null;
    if (status) {
      const group = (status[1].status?.groups || []).find((g) => /complete|done/i.test(g.name));
      const opt = group && (status[1].status?.options || []).find((o) => (group.option_ids || []).includes(o.id));
      if (opt) done = { prop: status[0], kind: 'status', value: opt.name, open: (status[1].status.options || []).filter((o) => (group.option_ids || []).includes(o.id)).map((o) => o.name) };
    }
    if (!done && box) done = { prop: box[0], kind: 'checkbox' };
    if (!date || !done || !UUID.test(String(d.id))) return null;
    return { id: String(d.id), name: clip(plain(d.title) || 'Untitled', 120), date: date[0], done };
  }).filter(Boolean);
}
export function notionTasks(json, db) {
  return (Array.isArray(json?.results) ? json.results : []).map((p) => {
    const props = p.properties || {};
    const due = dueOf(props[db.date]?.date?.start);
    const title = Object.values(props).find((x) => x.type === 'title');
    if (!due || !UUID.test(String(p.id))) return null;
    return { id: String(p.id), text: clip(plain(title?.title) || 'Untitled', 500), note: '', due: due.at, allDay: due.allDay, repeats: false, every: '', priority: 1, url: /^https:\/\/(www\.)?notion\.so\//.test(p.url || '') ? p.url : 'https://www.notion.so' };
  }).filter(Boolean).sort((a, b) => a.due - b.due);
}
const notDone = (db) => db.done.kind === 'checkbox' ? { property: db.done.prop, checkbox: { equals: false } }
  : { and: db.done.open.map((name) => ({ property: db.done.prop, status: { does_not_equal: name } })) };
const notion = {
  name: 'Notion',
  creds(b) {
    const token = String(b.token || '').trim();
    if (!/^(secret_|ntn_)[A-Za-z0-9]{30,80}$/.test(token)) throw new Error('That does not look like a Notion integration secret (it starts with ntn_ or secret_). Copy it from notion.so/my-integrations.');
    return { token };
  },
  // Finds the databases shared with the integration that work as task lists; the first is used.
  async connect(c, f) {
    const lists = notionLists(await notionAsk(c, '/search', { method: 'POST', body: JSON.stringify({ filter: { property: 'object', value: 'database' }, page_size: 50 }) }, f));
    if (!lists.length) throw new Error('Notion accepted the secret, but no task database is shared with it. In Notion, open your task database, ··· (top right), Connections, and add your integration; it needs a date and a Done checkbox or status. Then press Connect again.');
    return { lists, db: lists[0] };
  },
  async list(c, f) {
    if (!c.db) return [];
    const today = new Date(); const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const filter = { and: [{ property: c.db.date, date: { on_or_before: iso } }, notDone(c.db)] };
    return notionTasks(await notionAsk(c, `/databases/${c.db.id}/query`, { method: 'POST', body: JSON.stringify({ filter, page_size: 50 }) }, f), c.db);
  },
  idOk: (id) => UUID.test(id),
  async close(c, id, f) {
    const v = c.db.done.kind === 'checkbox' ? { checkbox: true } : { status: { name: c.db.done.value } };
    await notionAsk(c, `/pages/${id}`, { method: 'PATCH', body: JSON.stringify({ properties: { [c.db.done.prop]: v } }) }, f);
  }
};

export const TASK_APPS = { trello, asana, notion };
