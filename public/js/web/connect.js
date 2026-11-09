// The web board's own connections (docs/WEB-BOARD.md), each the person's own:
//   Microsoft 365  Teams chats and Outlook mail. Microsoft's single-page-app
//                  sign-in (PKCE), straight from this browser to Microsoft; Graph
//                  is called from here. Needs the app registration to have this
//                  board's address as a "Single-page application" redirect URI
//                  (the sync service's MS_SPA_CLIENT_ID says which registration).
//   GitHub         your repos' builds and the pull requests waiting on you. The
//                  sync service does the one exchange GitHub needs a secret for
//                  (sync-worker/src/connect.js) and hands the token back after
//                  the #; GitHub's API is called from here.
// The tokens are kept in your own account's settings (key "webConnections"),
// sealed with your account key like everything else there: the sync service
// never has them readable, and your other computers have them too. Mail through
// IMAP (iCloud, Fastmail, an app password) cannot run in a browser: browsers
// cannot open mail-server connections, and the service would have to read it.
// makeConnect({ data, call, base, fetchFn, loc, session })
import { randomHex, sha256hex } from './crypto.js';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const MS_SCOPES = 'openid profile offline_access User.Read Chat.ReadWrite ChatMessage.Send Mail.ReadWrite Mail.Send';
// A personal Microsoft account (Outlook.com, Hotmail, Microsoft 365 Family) has mail but no Teams chats: it asks for these.
const MS_MAIL_SCOPES = 'openid profile offline_access User.Read Mail.ReadWrite Mail.Send';
const b64url = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const strip = (html) => String(html || '').replace(/<(br|\/p|\/div)\b[^>]*>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n').trim();

export function makeConnect({ data, call, base = '', fetchFn = globalThis.fetch, loc = globalThis.location, session = globalThis.sessionStorage }) {
  const conns = () => data.getSetting('webConnections', {});
  const save = (name, v) => { const all = { ...conns() }; if (v) all[name] = v; else delete all[name]; data.setSetting('webConnections', all); };
  let config = null, cache = { threads: [], runs: [], reviews: [], events: [], at: 0 }, errors = {};
  async function cfg() { if (!config) { const r = await call(base, '/v1/providers').catch(() => null); config = r?.json?.connect || {}; } return config; }

  // ---- Microsoft 365
  async function startMicrosoft({ mailOnly = false } = {}) {
    const c = (await cfg()).microsoft;
    if (!c) throw new Error('Microsoft 365 is not set up on this sync service yet. Whoever runs it adds a single-page app registration (see the README).');
    const verifier = randomHex(48), state = randomHex(16), scope = mailOnly ? MS_MAIL_SCOPES : MS_SCOPES;
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    session?.setItem('sb-ms', JSON.stringify({ verifier, state, scope, at: Date.now() }));
    const q = new URLSearchParams({ client_id: c.clientId, response_type: 'code', redirect_uri: loc.origin + '/', response_mode: 'query', scope, state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account' });
    loc.assign(`https://login.microsoftonline.com/${encodeURIComponent(c.tenant)}/oauth2/v2.0/authorize?${q}`);
  }
  async function msToken(body, scope = conns().microsoft?.scope || MS_SCOPES) {
    const c = (await cfg()).microsoft;
    const res = await fetchFn(`https://login.microsoftonline.com/${encodeURIComponent(c.tenant)}/oauth2/v2.0/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: c.clientId, scope, ...body }) });
    const j = await res.json().catch(() => ({}));
    if (!j.access_token) throw new Error(j.error === 'invalid_grant' ? 'Microsoft asks you to sign in again (a browser keeps a Microsoft sign-in for a day). Press Connect Microsoft 365.' : (j.error_description || 'Microsoft did not sign you in.').split('\n')[0]);
    return j;
  }
  async function msAccess() {
    const m = conns().microsoft;
    if (!m) throw new Error('Connect Microsoft 365 first.');
    if (m.access && m.exp > Date.now() + 60e3) return m.access;
    const j = await msToken({ grant_type: 'refresh_token', refresh_token: m.refresh });
    save('microsoft', { ...m, access: j.access_token, refresh: j.refresh_token || m.refresh, exp: Date.now() + (j.expires_in || 3600) * 1000 });
    return j.access_token;
  }
  const graph = async (path, opts = {}) => {
    const res = await fetchFn(GRAPH + path, { ...opts, headers: { Authorization: `Bearer ${await msAccess()}`, ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) } });
    if (res.status === 204 || res.status === 202) return {};
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error?.message || `Microsoft answered ${res.status}.`);
    return j;
  };

  // ---- GitHub
  async function startGithub() {
    if (!(await cfg()).github) throw new Error('GitHub is not set up on this sync service yet.');
    const r = await call(base, '/v1/connect/github/ticket', { method: 'POST', body: {}, token: data.getSetting('sync', null)?.token });
    if (r.status !== 200) throw new Error(r.json.error || 'Could not start connecting GitHub.');
    loc.assign(`${base}/v1/connect/github/start?ticket=${r.json.ticket}`);
  }
  const gh = async (path) => {
    const res = await fetchFn('https://api.github.com' + path, { headers: { Authorization: `Bearer ${conns().github?.token}`, Accept: 'application/vnd.github+json' } });
    if (res.status === 401) { save('github', null); throw new Error('GitHub signed you out. Connect it again.'); }
    if (!res.ok) throw new Error(`GitHub answered ${res.status}.`);
    return res.json();
  };

  // ---- Google (Gmail, Google Calendar): the sync service does the exchange and each renewal (sync-worker/src/googleconnect.js)
  async function startGoogle() {
    if (!(await cfg()).google) throw new Error('Google is not set up on this sync service yet.');
    const r = await call(base, '/v1/connect/google/ticket', { method: 'POST', body: {}, token: data.getSetting('sync', null)?.token });
    if (r.status !== 200) throw new Error(r.json.error || 'Could not start connecting Google.');
    loc.assign(`${base}/v1/connect/google/start?ticket=${r.json.ticket}`);
  }
  async function gAccess() {
    const g = conns().google;
    if (!g) throw new Error('Connect Google first.');
    if (g.access && g.exp > Date.now() + 60e3) return g.access;
    const r = await call(base, '/v1/connect/google/refresh', { method: 'POST', body: { refresh: g.refresh }, token: data.getSetting('sync', null)?.token });
    if (r.status === 401) { save('google', null); throw new Error(r.json.error || 'Google signed you out. Connect Google again.'); }
    if (r.status !== 200) throw new Error(r.json.error || 'Google did not answer.');
    save('google', { ...g, access: r.json.access, exp: Date.now() + r.json.expiresIn * 1000 });
    return r.json.access;
  }
  const gapi = async (url, opts = {}) => {
    const res = await fetchFn(url, { ...opts, headers: { Authorization: `Bearer ${await gAccess()}`, ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) } });
    if (res.status === 204) return {};
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error?.message || `Google answered ${res.status}.`);
    return j;
  };
  const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me', GCAL = 'https://www.googleapis.com/calendar/v3';
  const header = (msg, name) => (msg.payload?.headers || []).find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
  const b64d = (s) => { try { return new TextDecoder().decode(Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))); } catch { return ''; } };
  function bodyOf(part) {
    if (!part) return '';
    if (part.mimeType === 'text/plain' && part.body?.data) return b64d(part.body.data);
    for (const p of part.parts || []) { const t = bodyOf(p); if (t) return t; }
    if (part.mimeType === 'text/html' && part.body?.data) return strip(b64d(part.body.data));
    return '';
  }
  const addrOf = (from) => (String(from).match(/<([^>]+)>/)?.[1] || String(from)).trim().toLowerCase();
  const nameOf = (from) => String(from).replace(/<[^>]+>/, '').replace(/"/g, '').trim() || addrOf(from);

  // Back from Microsoft (?code=…), GitHub (#ghconnect=…) or Google (#gconnect=…): finish, and clean the address.
  async function finish() {
    const q = new URLSearchParams(loc.search || '');
    if (q.get('code') && q.get('state')) {
      const want = JSON.parse(session?.getItem('sb-ms') || 'null');
      session?.removeItem('sb-ms');
      history.replaceState(null, '', loc.pathname + (loc.hash || ''));
      if (!want || want.state !== q.get('state')) return { error: 'That Microsoft sign-in did not start here. Press Connect Microsoft 365 again.' };
      const scope = want.scope || MS_SCOPES;
      const j = await msToken({ grant_type: 'authorization_code', code: q.get('code'), redirect_uri: loc.origin + '/', code_verifier: want.verifier }, scope);
      const me = await fetchFn(GRAPH + '/me', { headers: { Authorization: `Bearer ${j.access_token}` } }).then((r) => r.json()).catch(() => ({}));
      save('microsoft', { access: j.access_token, refresh: j.refresh_token, exp: Date.now() + (j.expires_in || 3600) * 1000, id: me.id || null, email: (me.mail || me.userPrincipalName || '').toLowerCase(), name: me.displayName || '', scope });
      return { connected: 'Microsoft 365' };
    }
    if (q.get('error') && q.get('state')) {
      const want = JSON.parse(session?.getItem('sb-ms') || 'null'), why = q.get('error_description') || '';
      history.replaceState(null, '', loc.pathname);
      // A personal account turned away for the Teams permissions: ask again for mail only.
      if (want && want.scope !== MS_MAIL_SCOPES && /scope|AADSTS70000|AADSTS65005|not supported|unsupported/i.test(why)) { await startMicrosoft({ mailOnly: true }); return { pending: true }; }
      return { error: why || 'Microsoft sign-in was cancelled.' };
    }
    const h = new URLSearchParams(String(loc.hash || '').replace(/^#/, ''));
    if (h.get('ghconnect')) {
      history.replaceState(null, '', loc.pathname);
      const token = h.get('ghconnect');
      const u = await fetchFn('https://api.github.com/user', { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } }).then((r) => r.json()).catch(() => ({}));
      save('github', { token, login: u.login || '' });
      return { connected: 'GitHub' };
    }
    if (h.get('ghconnect-error')) { history.replaceState(null, '', loc.pathname); return { error: h.get('ghconnect-error') }; }
    if (h.get('gconnect')) {
      history.replaceState(null, '', loc.pathname);
      const access = h.get('gaccess');
      const me = await fetchFn('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${access}` } }).then((r) => r.json()).catch(() => ({}));
      save('google', { refresh: h.get('gconnect'), access, exp: Date.now() + (Number(h.get('gexp')) || 3600) * 1000, email: String(me.email || '').toLowerCase(), scope: h.get('gscope') || '' });
      return { connected: 'Google' };
    }
    if (h.get('gconnect-error')) { history.replaceState(null, '', loc.pathname); return { error: h.get('gconnect-error') }; }
    return null;
  }

  // Your project rules sort what comes in, as in the app (a word, an address or a domain in who, from or subject).
  const spaceFor = (...texts) => { const hay = texts.join(' ').toLowerCase(); for (const [t, s] of data.getSetting('rules', [])) if (t && hay.includes(String(t).toLowerCase())) return s; return 'personal'; };

  // What the board shows from them, looked at every two minutes.
  async function refresh() {
    const threads = [], runs = [], reviews = [];
    const m = conns().microsoft;
    if (m) {
      try {
        // A personal account has no Teams chats: its mail still comes in.
        const chats = m.scope === MS_MAIL_SCOPES ? { value: [] } : await graph('/me/chats?$expand=lastMessagePreview&$top=30').catch(() => ({ value: [] }));
        for (const c of chats.value || []) {
          const p = c.lastMessagePreview;
          if (!p) continue;
          const who = c.topic || (p.from?.user?.id !== m.id ? p.from?.user?.displayName : null) || 'Teams chat';
          threads.push({ key: 'teams:' + c.id, kind: 'teams', who, from: who, subject: 'Teams chat', snippet: (p.from?.user?.id === m.id ? 'You: ' : '') + strip(p.body?.content).slice(0, 300), date: Date.parse(p.createdDateTime), unread: false, count: 1, link: c.webUrl || null, space: spaceFor(who) });
        }
        const mail = await graph('/me/mailFolders/inbox/messages?$top=25&$select=id,subject,from,receivedDateTime,bodyPreview,isRead,webLink');
        for (const x of mail.value || []) {
          const who = x.from?.emailAddress?.name || x.from?.emailAddress?.address || 'Someone', addr = (x.from?.emailAddress?.address || '').toLowerCase();
          threads.push({ key: 'outlook:' + x.id, kind: 'outlook', who, from: addr, subject: x.subject || '', snippet: x.bodyPreview || '', date: Date.parse(x.receivedDateTime), unread: !x.isRead, count: 1, link: x.webLink || null, space: spaceFor(who, addr, x.subject) });
        }
        errors.microsoft = null;
      } catch (e) { errors.microsoft = e.message; }
    }
    if (conns().github) {
      try {
        const repos = await gh('/user/repos?sort=pushed&per_page=12');
        for (const r of repos.filter((x) => Date.now() - Date.parse(x.pushed_at) < 7 * 86400e3).slice(0, 6)) {
          const w = await gh(`/repos/${r.full_name}/actions/runs?per_page=5`).catch(() => ({ workflow_runs: [] }));
          const seen = new Set();
          for (const run of w.workflow_runs || []) {
            const k = run.name + ':' + run.head_branch;
            if (seen.has(k)) continue;
            seen.add(k);
            const state = run.status !== 'completed' ? 'running' : run.conclusion === 'failure' ? 'failed' : run.conclusion === 'success' ? 'done' : null;
            if (!state || (state === 'done' && Date.now() - Date.parse(run.updated_at) > 3 * 3600e3)) continue;
            runs.push({ id: run.id, repo: r.name, fullName: r.full_name, workflow: run.name, title: run.display_title, branch: run.head_branch, state, url: run.html_url, updatedAt: Date.parse(run.updated_at), space: spaceFor(r.full_name, r.name) });
          }
        }
        const s = await gh('/search/issues?q=' + encodeURIComponent('is:open is:pr review-requested:@me archived:false') + '&per_page=20');
        for (const p of s.items || []) { const repo = p.repository_url.split('/').slice(-2).join('/'); reviews.push({ id: p.id, number: p.number, title: p.title, repo, url: p.html_url, author: p.user?.login, updatedAt: Date.parse(p.updated_at), space: spaceFor(repo, p.title) }); }
        errors.github = null;
      } catch (e) { errors.github = e.message; }
    }
    const events = [];
    const g = conns().google;
    if (g) {
      try {
        const list = await gapi(`${GMAIL}/threads?labelIds=INBOX&maxResults=20`);
        const got = await Promise.all((list.threads || []).map((t) => gapi(`${GMAIL}/threads/${t.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`).catch(() => null)));
        for (const t of got.filter(Boolean)) {
          const msgs = t.messages || [], last = msgs[msgs.length - 1] || {}, from = header(last, 'From'), who = nameOf(from), addr = addrOf(from);
          threads.push({ key: 'gmail:' + t.id, kind: 'mail', who, from: addr, subject: header(msgs[0] || last, 'Subject'), snippet: last.snippet || '', date: Number(last.internalDate) || 0, unread: msgs.some((x) => (x.labelIds || []).includes('UNREAD')), count: msgs.length, link: `https://mail.google.com/mail/u/${encodeURIComponent(g.email || '0')}/#all/${t.id}`, space: spaceFor(who, addr, header(msgs[0] || last, 'Subject')) });
        }
        // Calendar: every calendar you have, a week back and two months ahead.
        const cals = await gapi(`${GCAL}/users/me/calendarList?maxResults=20`).catch(() => ({ items: [] }));
        const from = new Date(Date.now() - 7 * 86400e3).toISOString(), to = new Date(Date.now() + 62 * 86400e3).toISOString();
        for (const c of (cals.items || []).filter((x) => x.selected !== false).slice(0, 10)) {
          const ev = await gapi(`${GCAL}/calendars/${encodeURIComponent(c.id)}/events?singleEvents=true&orderBy=startTime&maxResults=250&timeMin=${encodeURIComponent(from)}&timeMax=${encodeURIComponent(to)}`).catch(() => ({ items: [] }));
          for (const e of ev.items || []) {
            if (e.status === 'cancelled') continue;
            const allDay = !!e.start?.date, start = Date.parse(e.start?.dateTime || e.start?.date + 'T00:00:00'), end = Date.parse(e.end?.dateTime || e.end?.date + 'T00:00:00');
            events.push({ uid: e.id, title: e.summary || '(no title)', start, end: end || start, location: e.location || '', allDay, space: spaceFor(e.summary || '', e.location || ''), calendar: 'google:' + c.id, calendarName: c.summaryOverride || c.summary || 'Google Calendar', canWrite: false, link: e.htmlLink || null });
          }
        }
        errors.google = null;
      } catch (e) { errors.google = e.message; }
    }
    cache = { threads: threads.sort((a, b) => b.date - a.date), runs, reviews, events, at: Date.now() };
    return cache;
  }

  // A conversation, oldest first, in the app's shape; and a reply, on your click.
  async function conversation(key) {
    const [kind, ...rest] = String(key).split(':'), id = rest.join(':'), m = conns().microsoft;
    if (kind === 'teams') {
      const j = await graph(`/chats/${encodeURIComponent(id)}/messages?$top=40`);
      return { messages: (j.value || []).filter((x) => x.messageType === 'message' && !x.deletedDateTime).map((x) => ({ id: x.id, from_name: x.from?.user?.displayName || 'Someone', from_me: x.from?.user?.id === m?.id ? 1 : 0, text: x.body?.contentType === 'html' ? strip(x.body.content) : String(x.body?.content || ''), date: Date.parse(x.createdDateTime) })).reverse(), more: false };
    }
    if (kind === 'gmail') {
      const t = await gapi(`${GMAIL}/threads/${encodeURIComponent(id)}?format=full`), me = conns().google?.email;
      return { messages: (t.messages || []).map((x) => { const from = header(x, 'From'); return { id: x.id, from_name: nameOf(from), from_addr: addrOf(from), from_me: addrOf(from) === me ? 1 : 0, subject: header(x, 'Subject'), text: bodyOf(x.payload) || x.snippet || '', date: Number(x.internalDate) || 0 }; }), more: false };
    }
    if (kind === 'outlook') {
      const x = await graph(`/me/messages/${encodeURIComponent(id)}?$select=id,subject,from,receivedDateTime,body,conversationId`);
      const addr = (x.from?.emailAddress?.address || '').toLowerCase();
      return { messages: [{ id: x.id, from_name: x.from?.emailAddress?.name || addr, from_addr: addr, from_me: addr === m?.email ? 1 : 0, subject: x.subject || '', text: x.body?.contentType === 'html' ? strip(x.body.content) : String(x.body?.content || ''), date: Date.parse(x.receivedDateTime) }], more: false };
    }
    return null;
  }
  async function reply(key, text) {
    const [kind, ...rest] = String(key).split(':'), id = rest.join(':');
    if (kind === 'teams') { await graph(`/chats/${encodeURIComponent(id)}/messages`, { method: 'POST', body: JSON.stringify({ body: { contentType: 'text', content: text } }) }); return true; }
    if (kind === 'outlook') { await graph(`/me/messages/${encodeURIComponent(id)}/reply`, { method: 'POST', body: JSON.stringify({ comment: text }) }); return true; }
    if (kind === 'gmail') {
      // A reply in the same thread, to whoever wrote last (not you), quoting nothing.
      const t = await gapi(`${GMAIL}/threads/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Message-ID&metadataHeaders=References`);
      const me = conns().google?.email, msgs = t.messages || [];
      const last = [...msgs].reverse().find((x) => addrOf(header(x, 'From')) !== me) || msgs[msgs.length - 1];
      if (!last) return false;
      const to = addrOf(header(last, 'From')) === me ? header(last, 'To') : header(last, 'From');
      const subj = header(msgs[0] || last, 'Subject'), mid = header(last, 'Message-ID');
      const enc = (s) => /[^\x20-\x7e]/.test(s) ? '=?UTF-8?B?' + btoa(unescape(encodeURIComponent(s))) + '?=' : s;
      const raw = [`To: ${to}`, `Subject: ${enc(/^re:/i.test(subj) ? subj : 'Re: ' + subj)}`, ...(mid ? [`In-Reply-To: ${mid}`, `References: ${[header(last, 'References'), mid].filter(Boolean).join(' ')}`] : []), 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', btoa(unescape(encodeURIComponent(text)))].join('\r\n');
      await gapi(`${GMAIL}/messages/send`, { method: 'POST', body: JSON.stringify({ raw: btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), threadId: id }) });
      return true;
    }
    return false;
  }
  // The invite email from your Outlook, on the Send click (the Team pane's mail step).
  async function sendMail(to, subject, text) {
    await graph('/me/sendMail', { method: 'POST', body: JSON.stringify({ message: { subject, body: { contentType: 'Text', content: text }, toRecipients: [{ emailAddress: { address: to } }] }, saveToSentItems: true }) });
    return conns().microsoft?.email || null;
  }

  return {
    cfg, startMicrosoft, startGithub, startGoogle, finish, refresh, conversation, reply, sendMail,
    get cache() { return cache; },
    status: () => ({ microsoft: conns().microsoft ? { connected: true, email: conns().microsoft.email, error: errors.microsoft || null } : { connected: false, available: !!config?.microsoft }, github: conns().github ? { connected: true, login: conns().github.login, error: errors.github || null } : { connected: false, available: !!config?.github }, google: conns().google ? { connected: true, email: conns().google.email, error: errors.google || null } : { connected: false, available: !!config?.google } }),
    disconnect: (name) => save(name, null)
  };
}
export { sha256hex };
