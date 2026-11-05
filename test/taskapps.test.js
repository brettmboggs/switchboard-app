// Trello, Asana and Notion (lib/taskapps.js) against stand-ins: what counts as
// due, the keys each accepts, Done, and that a key never reaches the board.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-taskapps-'));
const { trelloTasks, asanaTasks, notionLists, notionTasks, dueOf } = await import('../lib/taskapps.js');
const { connectTasks, tasks, taskStatus, closeTask, editTasks } = await import('../lib/tasks.js');

const now = Date.now(), yesterday = new Date(now - 86400e3).toISOString(), nextWeek = new Date(now + 7 * 86400e3).toISOString();
const ymd = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const ID24 = 'a'.repeat(24), UUID1 = '11111111-2222-3333-4444-555555555555', UUID2 = '66666666-7777-8888-9999-000000000000';

test('a date alone is that whole day; a time is that moment', () => {
  assert.equal(dueOf('2026-11-05').allDay, true);
  assert.equal(dueOf('2026-11-05T15:00:00Z').allDay, false);
  assert.equal(dueOf(''), null);
});

test('Trello: due by today and not complete', () => {
  const list = trelloTasks([
    { id: ID24, name: 'Send quote', due: yesterday, dueComplete: false, shortUrl: 'https://trello.com/c/x' },
    { id: 'b'.repeat(24), name: 'Done one', due: yesterday, dueComplete: true },
    { id: 'c'.repeat(24), name: 'Later', due: nextWeek },
    { id: 'd'.repeat(24), name: 'No date' },
    { id: '../x', name: 'Bad id', due: yesterday }
  ]);
  assert.deepEqual(list.map((t) => t.text), ['Send quote']);
  assert.equal(list[0].url, 'https://trello.com/c/x');
});

test('Asana: open tasks due by today, with a safe link', () => {
  const list = asanaTasks({ data: [
    { gid: '1201', name: 'Call back', due_on: ymd(now), permalink_url: 'https://app.asana.com/0/1/1201' },
    { gid: '1202', name: 'Later', due_on: ymd(now + 7 * 86400e3) },
    { gid: '1203', name: 'Finished', due_on: ymd(now), completed: true },
    { gid: '1204', name: 'Odd link', due_at: yesterday, permalink_url: 'javascript:alert(1)' }
  ] });
  assert.deepEqual(list.map((t) => t.text), ['Call back', 'Odd link']);
  assert.equal(list[1].url, 'https://app.asana.com');
});

test('Notion: a database is a task list with a date and a Done checkbox or Complete status', () => {
  const lists = notionLists({ results: [
    { id: UUID1, title: [{ plain_text: 'Tasks' }], properties: { Name: { type: 'title' }, Due: { type: 'date' }, Status: { type: 'status', status: { options: [{ id: 'o1', name: 'Not started' }, { id: 'o2', name: 'Done' }], groups: [{ name: 'To-do', option_ids: ['o1'] }, { name: 'Complete', option_ids: ['o2'] }] } } } },
    { id: UUID2, title: [{ plain_text: 'Reading list' }], properties: { Name: { type: 'title' } } }
  ] });
  assert.equal(lists.length, 1);
  assert.deepEqual(lists[0].done, { prop: 'Status', kind: 'status', value: 'Done', open: ['Done'] });
  const pages = notionTasks({ results: [{ id: UUID2, url: 'https://www.notion.so/x', properties: { Name: { type: 'title', title: [{ plain_text: 'Renew' }] }, Due: { date: { start: ymd(now) } } } }] }, lists[0]);
  assert.equal(pages[0].text, 'Renew');
});

// One stand-in for all three apps: records what was asked, answers like each would.
function stand(calls, { refuse = false } = {}) {
  return async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    const json = (j) => ({ ok: !refuse, status: refuse ? 401 : 200, json: async () => j });
    const u = String(url);
    if (u.includes('trello.com/1/members/me/cards')) return json([{ id: ID24, name: 'Trello card', due: yesterday, shortUrl: 'https://trello.com/c/x' }]);
    if (u.includes('trello.com')) return json({ id: 'me' });
    if (u.includes('asana.com/api/1.0/users/me')) return json({ data: { gid: '1', workspaces: [{ gid: '77' }] } });
    if (u.includes('asana.com/api/1.0/tasks?')) return json({ data: [{ gid: '1201', name: 'Asana task', due_on: ymd(now) }] });
    if (u.includes('asana.com')) return json({ data: {} });
    if (u.endsWith('/v1/search')) return json({ results: [{ id: UUID1, title: [{ plain_text: 'Tasks' }], properties: { Name: { type: 'title' }, Due: { type: 'date' }, Done: { type: 'checkbox' } } }] });
    if (u.includes('/query')) return json({ results: [{ id: UUID2, url: 'https://www.notion.so/p', properties: { Name: { type: 'title', title: [{ plain_text: 'Notion page' }] }, Due: { date: { start: ymd(now) } } } }] });
    return json({});
  };
}
const TRELLO = { key: 'f'.repeat(32), token: 'ATTA' + 'x'.repeat(60) }, ASANA = '2/1234567890/1234567890:abcdef0123456789', NOTION = 'ntn_' + 'a'.repeat(46);

test('connect, list, Done and keys kept off the board, for each', async () => {
  const calls = [];
  await assert.rejects(connectTasks('trello', { key: 'nope', token: TRELLO.token }, 'personal', stand(calls)), /Trello API key/);
  await assert.rejects(connectTasks('asana', ASANA, 'personal', stand(calls, { refuse: true })), /Asana did not accept/);
  await assert.rejects(connectTasks('notion', 'secret', 'personal', stand(calls)), /starts with ntn_/);
  await connectTasks('trello', TRELLO, 'personal', stand(calls));
  await connectTasks('asana', ASANA, 'personal', stand(calls));
  await connectTasks('notion', NOTION, 'personal', stand(calls));
  assert.deepEqual(tasks().map((t) => t.text).sort(), ['Asana task', 'Notion page', 'Trello card']);
  const board = JSON.stringify([tasks(), taskStatus()]);
  for (const secret of [TRELLO.key, TRELLO.token, ASANA, NOTION]) assert.ok(!board.includes(secret), 'a key reached the board');
  assert.equal(taskStatus().notion.db.name, 'Tasks');
  assert.ok(calls.some((c) => c.url.includes('/query') && JSON.stringify(c.body).includes('"checkbox":{"equals":false}')));

  calls.length = 0;
  await closeTask('trello', ID24, stand(calls));
  assert.ok(calls.some((c) => c.method === 'PUT' && c.url.includes(`/cards/${ID24}?dueComplete=true`)));
  await closeTask('asana', '1201', stand(calls));
  assert.ok(calls.some((c) => c.method === 'PUT' && c.body?.data?.completed === true));
  await closeTask('notion', UUID2, stand(calls));
  assert.ok(calls.some((c) => c.method === 'PATCH' && c.body?.properties?.Done?.checkbox === true));
  await assert.rejects(closeTask('asana', '../1', stand(calls)), /Not a task id/);
  editTasks('notion', { list: 'not-there' });
  assert.equal(taskStatus().notion.db.id, UUID1);
});
