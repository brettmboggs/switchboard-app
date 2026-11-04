// For coding agents, through Switchboard's MCP server (bin/mcp.mjs): put a note,
// to-do, reminder or needs-you on the board. Reading uses /api/state.
// Called by server.js for every request after its host and header checks;
// sends a response when the path is one of these, otherwise does nothing.
import { randomBytes } from 'node:crypto';
import { db, onLocalChange } from '../db.js';
import { toItem } from '../webhooks.js';
import { alert } from '../notify.js';
import { send, readJson } from '../http.js';

export async function route({ req, res, path, changed }) {
  if (req.method === 'POST' && path === '/api/agent/item') {
    const b = await readJson(req);
    const item = toItem({ text: b.text, kind: b.kind, project: b.project, due: b.due }, { kind: 'needs', space: 'personal' });
    if (item.error) return send(res, 400, { error: item.error });
    db.prepare('INSERT INTO items (uid, kind, text, space, due_at, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(randomBytes(16).toString('hex'), item.kind, item.text, item.space, item.due_at, Date.now());
    onLocalChange();
    const who = String(b.from || 'An agent').slice(0, 60);
    if ((b.kind || 'needs') === 'needs') alert('waiting', `${who} needs you`, item.text.slice(0, 140));
    changed();
    return send(res, 200, { ok: true, kind: item.kind, space: item.space, due_at: item.due_at });
  }
}
