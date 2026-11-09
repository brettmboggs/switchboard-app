// Pictures and files in email, Google Voice texts and Outlook, in the Inbox's
// conversation view (convo.js, drawn by cvExtras in teamspics.js). Switchboard
// keeps only a snippet of each email, so the files are asked for once a
// conversation is open: email through /api/mail/files (lib/mailfiles.js),
// Outlook through /api/outlook/files for the messages Graph marks as having
// any. Pictures show as pictures; other files are a name and size to save.
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
let cvFiles = { key: null, byId: new Map(), asked: new Set(), busy: false };
const cvFileList = (id) => (cvFiles.key === CV?.key && cvFiles.byId.get(id)) || [];
const cvSize = (n) => !n ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MB`;

async function cvLoadFiles() {
  if (!CV || !['mail', 'voice-text', 'voice-mail', 'outlook'].includes(CV.kind)) return;
  if (cvFiles.key !== CV.key) cvFiles = { key: CV.key, byId: new Map(), asked: new Set(), busy: false };
  if (cvFiles.busy) return;
  const real = CV.msgs.filter((m) => !cvStandIn(m));
  // Email: one ask for the conversation whenever a message we have not asked about turns up.
  const fresh = CV.kind === 'outlook' ? real.filter((m) => m.hasFiles && !cvFiles.asked.has(m.id)) : real.filter((m) => !cvFiles.asked.has(m.id));
  if (!fresh.length) return;
  const key = CV.key;
  cvFiles.busy = true;
  try {
    const d = CV.kind === 'outlook'
      ? await api(`/api/outlook/files?ids=${encodeURIComponent(fresh.map((m) => m.id).join(','))}`)
      : await api(`/api/mail/files?key=${encodeURIComponent(key)}`);
    if (!CV || CV.key !== key) return;
    for (const m of fresh) cvFiles.asked.add(m.id);
    for (const [id, list] of Object.entries(d || {})) {
      cvFiles.byId.set(id, list);
      const m = CV.byId.get(id);
      if (m) redraw(m);
    }
  } catch {
    // Mail server busy or offline: the words are there; the next refresh tries again.
  } finally { if (cvFiles.key === key) cvFiles.busy = false; }
}
