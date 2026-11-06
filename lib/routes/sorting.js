// Sorting things into projects: Unsorted (what has no project yet), Hide, and
// what belongs to each project (lib/belongs.js). Called by server.js for every
// request after its host and header checks; sends a response when the path is
// one of these, otherwise does nothing.
import { setHidden, hiddenKeys } from '../hidden.js';
import { send, readJson } from '../http.js';
import { spaces, spaceFor } from '../spaces.js';
import { addToList, getPage } from '../pages.js';
import { unsorted, members, addable, fileIn, takeOut, putBack, noteText, notesFor, ruleChoices } from '../sorting.js';

export async function route({ req, res, path, url, changed }) {
  // Hide or bring back: { keys: ["folder:/path", ...], hidden: true|false }.
  if (req.method === 'POST' && path === '/api/hidden') {
    const body = await readJson(req);
    const n = setHidden(body.keys || body.key, body.hidden !== false);
    changed();
    return send(res, 200, { ok: true, hidden: n });
  }
  if (req.method === 'GET' && path === '/api/hidden') return send(res, 200, [...hiddenKeys()]);
  // What Settings, Projects offers as you type: repos, people, chats, domains.
  if (req.method === 'GET' && path === '/api/rule-choices') return send(res, 200, ruleChoices());
  if (req.method === 'GET' && path === '/api/unsorted') return send(res, 200, unsorted({ fresh: true }));
  // Notes beside a session (public/js/sessnotes.js) and for agents (bin/mcp.mjs switchboard_notes):
  // ?space=<project>&repo=<folder name>; one note's text with ?uid=&section=.
  if (req.method === 'GET' && path === '/api/notes-for') {
    // An agent gives its folder (cwd); the page gives the session's project and repo.
    const cwd = url.searchParams.get('cwd') || '';
    const repo = url.searchParams.get('repo') || (cwd ? cwd.split(/[\\/]/).filter(Boolean).pop() : '');
    let space = url.searchParams.get('space') || (cwd ? spaceFor(cwd, repo) || 'personal' : '');
    const named = url.searchParams.get('project');
    if (named) space = spaces().find((x) => x.id === named || x.name.toLowerCase() === named.toLowerCase())?.id || space;
    return send(res, 200, notesFor({ space, repo }));
  }
  // Ctrl K "note …": a checkbox at the bottom of the page picked (public/js/cmdtarget.js).
  if (req.method === 'POST' && path === '/api/note-add') {
    const body = await readJson(req), text = String(body.text || '').trim().slice(0, 2000);
    if (!getPage(String(body.uid || ''))) return send(res, 404, { error: 'That page is gone. Pick another one, or New page.' });
    if (!text) return send(res, 400, { error: 'Write something after "note" first.' });
    addToList(String(body.uid), [text]);
    changed();
    return send(res, 200, { ok: true, title: getPage(String(body.uid)).title || 'Untitled' });
  }
  if (req.method === 'GET' && path === '/api/note-text') {
    const t = noteText(url.searchParams.get('uid') || '', url.searchParams.get('section') || null);
    return t ? send(res, 200, t) : send(res, 404, { error: 'That note is gone, or its section was renamed. Open Notes to find it.' });
  }

  // A project's own list (#project/<id>, In this project) and its Add picker.
  const m = path.match(/^\/api\/projects\/([a-z0-9-]{1,60})\/(members|addable|file|takeout|putback)$/);
  if (!m) return;
  const [, id, what] = m;
  if (req.method === 'GET' && what === 'members') return send(res, 200, members(id));
  if (req.method === 'GET' && what === 'addable') return send(res, 200, addable(id, url.searchParams.get('q') || ''));
  if (req.method === 'POST' && what === 'file') {
    const body = await readJson(req);
    try { const r = fileIn(id, { key: String(body.key || ''), label: body.label, repo: body.repo }); changed(); return send(res, 200, { ok: true, ...r }); }
    catch (e) { return send(res, 400, { error: e.message }); }
  }
  if (req.method === 'POST' && what === 'takeout') {
    const body = await readJson(req);
    const r = takeOut(id, { key: String(body.key || ''), rule: body.rule == null ? null : String(body.rule) });
    changed();
    return send(res, 200, { ok: true, ...r });
  }
  if (req.method === 'POST' && what === 'putback') {
    const body = await readJson(req);
    try { putBack(id, body.restore); changed(); return send(res, 200, { ok: true }); }
    catch (e) { return send(res, 400, { error: e.message }); }
  }
}
