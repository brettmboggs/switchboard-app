// Email drafts (lib/drafts.js): save a new version, send, or discard, each a
// click on the page. Called by server.js for every request after its host and
// header checks; sends a response when the path is one of these.
import { saveDraft, sendDraft, discardDraft } from '../drafts.js';
import { friendlyError } from '../friendly.js';
import { send, readJson } from '../http.js';

export async function route({ req, res, path, changed }) {
  const m = path.match(/^\/api\/drafts\/(save|send|discard)$/);
  if (!m || req.method !== 'POST') return;
  try {
    const b = await readJson(req, 512 * 1024);
    const account = String(b.account || ''), id = String(b.id || '');
    const fields = { to: b.to, cc: b.cc, subject: b.subject, text: b.text };
    let out = { ok: true };
    if (m[1] === 'save') await saveDraft(account, id, fields);
    if (m[1] === 'send') out = { ok: true, ...(await sendDraft(account, id, fields)) };
    if (m[1] === 'discard') await discardDraft(account, id);
    changed();
    return send(res, 200, out);
  } catch (e) { return send(res, 400, { error: friendlyError(e, 'your mail server') }); }
}
