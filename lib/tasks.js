// Tasks from the apps people already keep them in: Todoist here, Trello,
// Asana and Notion in lib/taskapps.js, all in the same shape. What is due
// today or overdue shows on Now, and Done there closes it in that app.
//
// Todoist's API v1 with a personal token (Todoist, Settings, Integrations,
// Developer). The token is a secret setting (db.js SECRET_SETTINGS, locked on
// disk) and never goes to the page. Only api.todoist.com is ever asked.
import { getSetting, setSetting } from './db.js';
import { spaces } from './spaces.js';
import { friendlyError } from './friendly.js';
import { TASK_APPS } from './taskapps.js';

const TODOIST = 'https://api.todoist.com/api/v1';
const MAX = 40;   // the most shown from one source; the rest wait in the app

const conf = () => getSetting('tasks', {});
let state = {};   // source -> { ok, error, at, list }

// A due date from Todoist: "2026-11-04" (all day, this computer's day),
// "2026-11-04T15:00:00" (that time here) or "…Z" (that moment).
export function todoistDue(due) {
  const d = String(due?.datetime || due?.date || '');
  let m;
  if ((m = d.match(/^(\d{4})-(\d\d)-(\d\d)$/))) return { at: new Date(+m[1], +m[2] - 1, +m[3]).getTime(), allDay: true };
  if ((m = d.match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d))?$/))) return { at: new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime(), allDay: false };
  const t = Date.parse(d);
  return Number.isFinite(t) ? { at: t, allDay: false } : null;
}

// One page of /tasks/filter into Switchboard's shape.
export function todoistTasks(json) {
  return (Array.isArray(json?.results) ? json.results : Array.isArray(json) ? json : [])
    .map((t) => {
      const due = todoistDue(t.due);
      const id = String(t.id || '');
      return id && /^[\w-]{1,40}$/.test(id) && due ? {
        id, text: String(t.content || '').slice(0, 500), note: String(t.description || '').slice(0, 2000),
        due: due.at, allDay: due.allDay, repeats: !!t.due?.is_recurring, every: t.due?.is_recurring ? String(t.due.string || '') : '',
        priority: Number(t.priority) || 1, url: `https://app.todoist.com/app/task/${encodeURIComponent(id)}`
      } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.due - b.due)
    .slice(0, MAX);
}

async function todoist(path, token, init = {}, fetchImpl = fetch) {
  const r = await fetchImpl(TODOIST + path, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) }, signal: AbortSignal.timeout(15000), redirect: 'error' });
  if (r.status === 401 || r.status === 403) throw new Error('Todoist did not accept that token. Copy it again from Todoist, Settings, Integrations, Developer.');
  if (r.status === 429) throw new Error('Todoist asked Switchboard to slow down; it tries again shortly.');
  if (!r.ok) throw new Error(`Todoist answered ${r.status}.`);
  return r.status === 204 ? null : r.json().catch(() => null);
}

// Every app: Todoist itself, and the adapters in lib/taskapps.js.
const APPS = {
  todoist: {
    name: 'Todoist',
    creds(b) {
      const token = String(b.token || '').trim();
      if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw new Error('That does not look like a Todoist token: 40 letters and numbers, from Todoist, Settings, Integrations, Developer.');
      return { token };
    },
    async connect(c, f) { await todoist('/tasks/filter?query=today&limit=1', c.token, {}, f); return {}; },
    async list(c, f) { return todoistTasks(await todoist('/tasks/filter?query=' + encodeURIComponent('today | overdue') + '&limit=' + MAX, c.token, {}, f)); },
    idOk: (id) => /^[\w-]{1,40}$/.test(id),
    async close(c, id, f) { await todoist(`/tasks/${encodeURIComponent(id)}/close`, c.token, { method: 'POST' }, f); }
  },
  ...TASK_APPS
};
export const TASK_SOURCES = Object.keys(APPS);

export async function pollTasks(fetchImpl = fetch) {
  const c = conf(), before = JSON.stringify(state);
  for (const [source, app] of Object.entries(APPS)) {
    if (!c[source]?.token) { delete state[source]; continue; }
    try { state[source] = { ok: true, error: null, at: Date.now(), list: (await app.list(c[source], fetchImpl)).slice(0, MAX) }; }
    catch (e) { state[source] = { ...(state[source] || { list: [] }), ok: false, error: friendlyError(e, app.name), at: Date.now() }; }
  }
  return JSON.stringify(state) !== before;
}

// What the board shows: each task with its source and project.
export function tasks() {
  const c = conf(), out = [];
  for (const [source, s] of Object.entries(state)) {
    const space = c[source]?.space || 'personal';
    for (const t of s.list || []) out.push({ ...t, source, key: `${source}:${t.id}`, space });
  }
  return out;
}

// For Settings: connected or not, and whether the last look worked. No token.
export function taskStatus() {
  const c = conf();
  return Object.fromEntries(TASK_SOURCES.map((source) => {
    const x = c[source];
    if (!x?.token) return [source, { connected: false }];
    const s = state[source];
    return [source, { connected: true, space: x.space || 'personal', ok: s?.ok ?? null, error: s?.error || null, count: s?.list?.length || 0,
      ...(x.db ? { db: { id: x.db.id, name: x.db.name }, lists: (x.lists || []).map((l) => ({ id: l.id, name: l.name })) } : {}) }];
  }));
}

// creds: the pasted key(s), { token } or { key, token }; a bare string is a token.
export async function connectTasks(source, creds, space, fetchImpl = fetch) {
  const app = APPS[source];
  if (!app) throw new Error('Switchboard does not know that task app.');
  const cr = app.creds(typeof creds === 'string' ? { token: creds } : creds || {});
  const extra = await app.connect(cr, fetchImpl);   // throws if the app says no
  const c = conf();
  setSetting('tasks', { ...c, [source]: { ...cr, ...extra, space: spaces().some((s) => s.id === space) ? space : 'personal' } });
  await pollTasks(fetchImpl);
}

// The project, and for Notion which shared database is the task list.
export function editTasks(source, { space, list }) {
  const c = conf();
  if (!c[source]) return;
  if (space && spaces().some((s) => s.id === space)) c[source].space = space;
  if (list && c[source].lists) { const db = c[source].lists.find((l) => l.id === list); if (db) c[source].db = db; }
  setSetting('tasks', c);
}

export function disconnectTasks(source) {
  const c = conf(); delete c[source]; setSetting('tasks', c); delete state[source];
}

// Done on the board: close it in the app (a repeating task moves to its next date there).
export async function closeTask(source, id, fetchImpl = fetch) {
  const c = conf(), app = APPS[source];
  if (!app || !c[source]?.token) throw new Error('That task app is not connected.');
  if (!app.idOk(String(id))) throw new Error('Not a task id.');
  await app.close(c[source], String(id), fetchImpl);
  if (state[source]) state[source].list = state[source].list.filter((t) => t.id !== String(id));
  pollTasks(fetchImpl).catch(() => {});
}
