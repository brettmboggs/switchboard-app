// Shared sessions, on the owner's computer (lib/share.js live, public/js/shared/share-core.js):
// what someone a project is shared with may ask for. Only sessions in that
// project; only the Chat view (lib/chatview.js readChat: the transcript as the
// app shows it, tool calls folded, cut to fit the relay); never the terminal
// itself, never keystrokes, never a file path. A message to send waits in the
// session's queue as "Jordan asks", held until you release it, unless you let
// that person straight into that session (Settings: sessionAuto).
//   makeSessionHandler({ listTerms, termRow, readChat, enqueue, getSetting, changed })
const STATE = { running: 'working', starting: 'working', waiting: 'waiting', finished: 'done', idle: 'idle' };

export function makeSessionHandler({ listTerms, termRow, readChat, enqueue, getSetting, setSetting = () => {}, changed = () => {} }) {
  return async function handle({ space, email, name, req }) {
    const terms = listTerms().filter((t) => t.space === space);
    if (req.t === 'list') return terms.map((t) => ({ id: t.id, name: t.name, agent: t.agentName, state: STATE[t.state] || 'idle', at: t.updatedAt || t.created_at }));
    const t = terms.find((x) => x.id === req.term);
    if (!t) throw new Error('That session is not in this project any more.');
    if (req.t === 'chat') {
      const q = req.q && typeof req.q === 'object' ? { file: req.q.file, from: req.q.from, before: req.q.before } : {};
      const out = readChat(termRow(t.id), q, { small: true });
      // Only what the Chat view shows: the messages, and where they are in the transcript.
      return { file: out.file || null, why: out.why || null, start: out.start ?? null, end: out.end ?? null, reset: !!out.reset, earlier: !!out.earlier, messages: (out.messages || []).map((m) => ({ k: m.k, id: m.id, t: m.t, name: m.name, sum: m.sum, res: m.res ? true : undefined, at: m.at })) };
    }
    if (req.t === 'send') {
      const text = String(req.text || '').trim();
      if (!text) throw new Error('Type a message first.');
      const auto = !!getSetting('sessionAuto', {})[String(email).toLowerCase()]?.[t.id];
      const id = enqueue(t.id, text, { source: `${name} asks`, held: !auto });
      // Who asked, for "Always let them in" on the held line (the queue keeps only the name).
      const from = Object.entries(getSetting('askFrom', {})).slice(-200);
      setSetting('askFrom', Object.fromEntries([...from, [String(id), { email: String(email).toLowerCase(), term: t.id }]]));
      changed();
      return { queued: id, held: !auto };
    }
    throw new Error('Not something a shared session does.');
  };
}
