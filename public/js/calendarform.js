// Calendar: Add event, and open an event to change or delete it (Google
// calendars you can write to). Every change is your click on Save or Delete;
// nothing is sent on its own. One of the page's scripts in public/js, loaded in
// order by index.html; they share one scope, so names defined earlier are usable.
let calEditing = null;      // the event open in the form, or null for a new one
let calSure = false;        // Delete was clicked once

const calDate = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const calHM = (t) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

function calSheet() {
  if ($('cal-scrim')) return;
  document.body.insertAdjacentHTML('beforeend', `<div class="scrim" id="cal-scrim" role="dialog" aria-modal="true" aria-labelledby="cal-title">
  <form class="sheet" id="cal-form-ev" autocomplete="off">
    <div class="sheet-head"><h2 id="cal-title">Add event</h2><button class="btn btn--quiet" type="button" data-close="cal-scrim">Close</button></div>
    <div class="form-grid">
      <label for="ev-title">Title</label><input id="ev-title" type="text" maxlength="300" required>
      <label for="ev-cal">Calendar</label><select id="ev-cal"></select>
      <label for="ev-allday">All day</label><input id="ev-allday" type="checkbox">
      <label for="ev-sd">Starts</label><span class="cal-dt"><input id="ev-sd" type="date" required><input id="ev-st" type="time"></span>
      <label for="ev-ed">Ends</label><span class="cal-dt"><input id="ev-ed" type="date" required><input id="ev-et" type="time"></span>
      <label for="ev-loc">Where</label><input id="ev-loc" type="text" maxlength="500" placeholder="optional">
      <label for="ev-desc">Notes</label><textarea id="ev-desc" rows="3" maxlength="8000" placeholder="optional"></textarea>
    </div>
    <p class="muted small" id="ev-note"></p>
    <div class="form-row"><button class="btn btn--primary" type="submit" id="ev-save">Save</button><button class="btn" type="button" id="ev-del" hidden>Delete</button><span id="ev-msg" class="small"></span></div>
  </form></div>`);
}

function calOpen(ev, startDay) {
  calSheet();
  calEditing = ev || null; calSure = false;
  const writable = (S.calendars || []).filter((c) => c.canWrite);
  $('cal-title').textContent = ev ? 'Change event' : 'Add event';
  $('ev-cal').innerHTML = writable.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  $('ev-cal').value = ev ? ev.calendar : writable[0]?.id;
  $('ev-cal').disabled = !!ev;   // an event stays on its calendar
  const all = ev ? ev.allDay : false;
  const s = ev ? ev.start : startDay + 9 * 3600e3, e = ev ? (ev.allDay ? ev.end - 86400e3 : ev.end) : startDay + 10 * 3600e3;
  $('ev-title').value = ev && ev.title !== '(no title)' ? ev.title : '';
  $('ev-allday').checked = all;
  $('ev-sd').value = calDate(s); $('ev-st').value = calHM(s);
  $('ev-ed').value = calDate(Math.max(e, s)); $('ev-et').value = calHM(e);
  $('ev-loc').value = ev?.location || ''; $('ev-desc').value = ev?.description || '';
  $('ev-note').textContent = ev?.recurring ? 'This event repeats. Changing or deleting it here affects only this one.' : '';
  $('ev-del').hidden = !ev; $('ev-del').textContent = 'Delete'; $('ev-del').className = 'btn';
  $('ev-msg').textContent = '';
  calAllDay();
  openDialog('cal-scrim');
  $('ev-title').focus();
}
function calAllDay() {
  const all = $('ev-allday').checked;
  $('ev-st').hidden = $('ev-et').hidden = all;
  $('ev-st').required = $('ev-et').required = !all;
}

// The form's dates and times as the start and end the server wants (all day: whole days, the end day included).
function calRange() {
  const all = $('ev-allday').checked;
  const at = (d, t) => new Date(`${d}T${all ? '00:00' : t}`).getTime();
  const start = at($('ev-sd').value, $('ev-st').value);
  let end = at($('ev-ed').value, $('ev-et').value);
  if (all) end = calAddDays(end, 1);
  return { start, end, allDay: all };
}

document.addEventListener('change', (e) => { if (e.target.id === 'ev-allday') calAllDay(); });

document.addEventListener('click', async (e) => {
  if (e.target.closest('[data-cal-new]')) {
    // No calendar here takes new events yet (a private link is read only): say how, and go there.
    if (!(S.calendars || []).some((c) => c.canWrite)) { toast('Events go on a Google calendar. Sign in with Google in Connections and add your calendars, then Add event works here, in Ctrl K and with Jarvis.', { ms: 9000 }); openSettings('connections'); return; }
    return calOpen(null, cal.day || calDay(Date.now()));
  }
  const edit = e.target.closest('[data-cal-edit]');
  if (edit) {
    const [calendar, uid, start] = edit.dataset.calEdit.split(':');
    const ev = cal.events.find((x) => x.calendar === calendar && x.uid === uid && String(x.start) === start);
    return ev && calOpen(ev);
  }
  if (e.target.id !== 'ev-del') return;
  if (!calSure) { calSure = true; e.target.textContent = 'Click again to delete'; e.target.className = 'btn btn--danger'; setTimeout(() => { if (calSure && $('ev-del')) { calSure = false; $('ev-del').textContent = 'Delete'; $('ev-del').className = 'btn'; } }, 4000); return; }
  e.target.disabled = true;
  try {
    await api('/api/calendar/event/delete', { calendar: calEditing.calendar, id: calEditing.uid });
    closeDialog('cal-scrim'); toast('Event deleted from Google Calendar.');
    await calRefresh();
  } catch (err) { e.target.disabled = false; $('ev-msg').textContent = err.message; $('ev-msg').className = 'small bad-text'; }
});

document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'cal-form-ev') return;
  e.preventDefault();
  const r = calRange();
  if (!(r.end >= r.start)) { $('ev-msg').textContent = 'The event ends before it starts.'; $('ev-msg').className = 'small bad-text'; return; }
  $('ev-save').disabled = true;
  try {
    await api('/api/calendar/event', { id: calEditing?.uid, calendar: $('ev-cal').value, title: $('ev-title').value, location: $('ev-loc').value, description: $('ev-desc').value, ...r });
    closeDialog('cal-scrim'); toast(calEditing ? 'Saved to Google Calendar.' : 'Added to Google Calendar.');
    await calRefresh();
  } catch (err) { $('ev-msg').textContent = err.message; $('ev-msg').className = 'small bad-text'; }
  finally { $('ev-save').disabled = false; }
});

// Ask the server again for the month on screen, so the change shows.
async function calRefresh() { cal.key = ''; if (page === 'calendar') renderCalendar(); }
