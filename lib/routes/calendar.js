// The Calendar page: events for a stretch of time, GET /api/calendar?from=&to=
// (milliseconds). Called by server.js for every request after its host and header
// checks; sends a response when the path is this one, otherwise does nothing.
import { eventsBetween } from '../calendarview.js';
import { send } from '../http.js';

export async function route({ req, res, path, url }) {
  if (req.method !== 'GET' || path !== '/api/calendar') return;
  const r = await eventsBetween(url.searchParams.get('from'), url.searchParams.get('to'));
  return r.error ? send(res, 400, r) : send(res, 200, r);
}
