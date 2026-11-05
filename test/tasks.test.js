// Task apps: Todoist's due dates, its task list, connecting (a token it refuses
// is not saved), Done closing the task, and the token never reaching the page.
// A stand-in for api.todoist.com: nothing real is called.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-tasks-'));
const { todoistDue, todoistTasks, connectTasks, pollTasks, tasks, taskStatus, closeTask, disconnectTasks } = await import('../lib/tasks.js');
const { getSetting } = await import('../lib/db.js');

const TOKEN = 'a'.repeat(40);
const sample = { results: [
  { id: '901', content: 'Order fence staples', due: { date: '2026-11-03', is_recurring: false }, priority: 4 },
  { id: '902', content: 'Feed check', due: { date: '2026-11-04T18:00:00', is_recurring: true, string: 'every day at 6pm' }, priority: 1, description: 'Both pens' },
  { id: 'bad id; rm', content: 'x', due: { date: '2026-11-04' } },
  { id: '903', content: 'No date' }
], next_cursor: null };
function stand(calls, { refuse = false } = {}) {
  return async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', auth: init.headers?.Authorization });
    if (refuse) return new Response('no', { status: 401 });
    if (String(url).includes('/close')) return new Response(null, { status: 204 });
    return Response.json(sample);
  };
}

test('due dates: all day is this computer\'s day, a bare time is local, Z is a moment', () => {
  assert.deepEqual(todoistDue({ date: '2026-11-04' }), { at: new Date(2026, 10, 4).getTime(), allDay: true });
  assert.deepEqual(todoistDue({ date: '2026-11-04T18:00:00' }), { at: new Date(2026, 10, 4, 18).getTime(), allDay: false });
  assert.equal(todoistDue({ datetime: '2026-11-04T18:00:00Z' }).at, Date.UTC(2026, 10, 4, 18));
  assert.equal(todoistDue(null), null);
});

test('the list: oldest first, odd ids and undated tasks left out', () => {
  const l = todoistTasks(sample);
  assert.deepEqual(l.map((t) => t.id), ['901', '902']);
  assert.equal(l[1].repeats, true); assert.equal(l[1].every, 'every day at 6pm'); assert.equal(l[1].note, 'Both pens');
  assert.equal(l[0].url, 'https://app.todoist.com/app/task/901');
});

test('a token Todoist refuses is not saved', async () => {
  const calls = [];
  await assert.rejects(connectTasks('todoist', TOKEN, 'personal', stand(calls, { refuse: true })), /did not accept/);
  assert.equal(getSetting('tasks', {}).todoist, undefined);
  await assert.rejects(connectTasks('todoist', 'short', 'personal', stand(calls)), /does not look like/);
});

test('connected: tasks on the board with their project, Done closes it, only Todoist asked, the token stays out of the page', async () => {
  const calls = [];
  await connectTasks('todoist', TOKEN, 'personal', stand(calls));
  assert.equal(tasks().length, 2);
  assert.equal(tasks()[0].key, 'todoist:901');
  assert.ok(!JSON.stringify([tasks(), taskStatus()]).includes(TOKEN));
  assert.deepEqual(taskStatus().todoist, { connected: true, space: 'personal', ok: true, error: null, count: 2 });
  await closeTask('todoist', '901', stand(calls));
  const close = calls.find((c) => c.url.endsWith('/tasks/901/close'));
  assert.equal(close.method, 'POST'); assert.equal(close.auth, `Bearer ${TOKEN}`);
  assert.ok(calls.every((c) => c.url.startsWith('https://api.todoist.com/api/v1/')));
  await assert.rejects(closeTask('todoist', '../x', stand(calls)), /Not a task id/);
  // A refused token later: the board says so, keeps what it had.
  await pollTasks(stand(calls, { refuse: true }));
  assert.equal(taskStatus().todoist.ok, false);
  disconnectTasks('todoist');
  assert.equal(tasks().length, 0); assert.equal(taskStatus().todoist.connected, false);
});
