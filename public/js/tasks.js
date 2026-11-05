// Task apps (lib/tasks.js): tasks due today or overdue in Todoist, Trello,
// Asana or Notion are cards on Now (they need you, like a due to-do); the
// panel has Done (closes it in the app, with Undo) and Open in the app. Their
// cards in Settings, Connections are taskcards.js.
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
// Task text came from outside: esc() on all of it.
const TASK_APP = { todoist: 'Todoist', trello: 'Trello', asana: 'Asana', notion: 'Notion' };
const findTask = (key) => (S.tasks || []).find((t) => t.key === key);
const taskLate = (t) => t.due < new Date().setHours(0, 0, 0, 0);
const taskWhen = (t) => t.allDay ? (new Date(t.due).toDateString() === new Date().toDateString() ? 'Today' : dayOnly(t.due)) : when(t.due);

function taskCards() {
  return (S.tasks || []).map((t) => ({ type: 'task', key: t.key, space: t.space, st: 'needs', label: TASK_APP[t.source] || 'Task', where: (taskLate(t) ? 'Overdue · ' : 'Due ') + taskWhen(t), what: t.text, at: t.due }));
}

function taskDetail(x, kick) {
  return kick(TASK_APP[x.source] || 'Task') + `<h2>${esc(x.text)}</h2>
    <dl class="facts"><dt>Due</dt><dd>${esc(taskWhen(x))}${taskLate(x) ? ' · overdue' : ''}${x.repeats && x.every ? ` · ${esc(x.every)}` : ''}</dd>${x.priority > 1 ? `<dt>Priority</dt><dd>P${5 - Number(x.priority)}</dd>` : ''}</dl>
    ${x.note ? `<div class="quote">${esc(x.note)}</div>` : ''}
    <div class="actions"><button class="btn btn--primary" type="button" data-task-done>Done</button><a class="btn" href="${safeHref(x.url)}" target="_blank" rel="noopener noreferrer">Open in ${esc(TASK_APP[x.source] || 'the app')}</a></div>`;
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-task-done]') || selected?.type !== 'task') return;
  const x = findTask(selected.key); if (!x) return;
  selected = null; extra = { key: null, html: '' };
  doLater('task:' + x.key, x.repeats ? 'Done. It comes back on its next date.' : 'Done.', '/api/tasks/close', { source: x.source, id: x.id });
});
