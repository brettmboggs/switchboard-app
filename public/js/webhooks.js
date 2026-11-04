// Settings, Accounts, Webhooks: make a link, pick its project and what it shows as, copy it, test it, replace it, remove it.
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
// Everything a webhook brings in is text from outside: it goes through esc() like mail.
const HOOK_KINDS = [['needs', 'Needs you'], ['todo', 'To-do'], ['reminder', 'Reminder'], ['note', 'Note']];
let hookShown = null;          // { id, links } while its links are open
const hookTests = {};          // id -> last test result, for the line under its name

const kindOptions = (sel) => HOOK_KINDS.map(([v, n]) => `<option value="${v}" ${v === sel ? 'selected' : ''}>${n}</option>`).join('');
const spaceOptions = (sel) => SET.spaces.map((x) => `<option value="${esc(x.id)}" ${x.id === sel ? 'selected' : ''}>${esc(x.name)}</option>`).join('');

function hookLine(h) {
  const t = hookTests[h.id];
  if (t?.busy) return { text: 'Testing…' };
  if (t) {
    const bad = [t.local, t.public].find((x) => x && !x.ok);
    if (bad) return { text: 'Test failed: ' + bad.error, bad: true };
    return { text: 'Test worked' + (t.public ? `: from anywhere in ${(t.public.ms / 1000).toFixed(1)} s, and from this computer` : ' from this computer') };
  }
  if (h.pending) return { text: 'Setting up the link that works from anywhere…' };
  return { text: h.public ? 'Works from anywhere, and from this computer' : 'This computer only. Sign in to your Switchboard account for a link that works from anywhere.' };
}

function renderWebhooks() {
  if (!SET || !$('hook-list')) return;
  const list = SET.webhooks || [];
  $('hook-space').innerHTML = spaceOptions($('hook-space').value || 'personal');
  if (!$('hook-kind').options.length) $('hook-kind').innerHTML = kindOptions('needs');
  $('hook-list').innerHTML = list.map((h) => {
    const l = hookLine(h);
    return `<div class="hook-row"><div class="hook-name"><b>${esc(h.name)}</b><span class="small ${l.bad ? 'bad-text' : 'muted'}">${esc(l.text)}</span></div>
      <div class="form-row hook-ctl">
        <select data-hook-field="space" data-hook="${esc(h.id)}" aria-label="Project for ${esc(h.name)}">${spaceOptions(h.space)}</select>
        <select data-hook-field="kind" data-hook="${esc(h.id)}" aria-label="What ${esc(h.name)} puts on the board">${kindOptions(h.kind)}</select>
        <button class="btn" type="button" data-hook-links="${esc(h.id)}">Link</button>
        <button class="icon-btn" type="button" data-hook-test="${esc(h.id)}" ${hookTests[h.id]?.busy ? 'disabled' : ''}>Test</button>
        <button class="icon-btn" type="button" data-hook-remove="${esc(h.id)}">Remove</button>
      </div></div>`;
  }).join('');
  $('hook-open').textContent = list.length ? 'Add another' : 'Add';
  renderHookShow();
}

// The links for one webhook, with how to use them.
function renderHookShow() {
  const box = $('hook-show');
  const h = hookShown && (SET.webhooks || []).find((x) => x.id === hookShown.id);
  box.hidden = !h;
  if (!h) { box.innerHTML = ''; return; }
  const l = hookShown.links;
  const line = (url, label) => `<span class="field-label">${label}</span><div class="copy-line"><code class="mono">${esc(url)}</code><button class="btn" type="button" data-copy="${esc(url)}">Copy</button></div>`;
  const example = l.public || l.local;
  box.innerHTML = `<div class="hook-links"><b>Links for ${esc(h.name)}</b>
    ${l.public ? line(l.public, 'From anywhere: IFTTT, Zapier, your phone') : '<p class="hint">Sign in to your Switchboard account (top of this page) for a link that works from anywhere: IFTTT, Zapier, your phone.</p>'}
    ${line(l.local, 'From this computer: scripts, Home Assistant running here')}
    <details class="small cal-help"><summary class="muted">How to use it</summary>
      <p>Send a POST with some text. Plain text works, or JSON like <code class="mono">{"text": "Gate left open", "kind": "needs", "project": "Home", "due": "tomorrow 9am"}</code>. <b>kind</b> is needs, todo, reminder or note; <b>project</b> and <b>due</b> are optional. Leave them out and it goes to ${esc(spaceOf(h.space).name)} as ${esc((HOOK_KINDS.find(([v]) => v === h.kind) || HOOK_KINDS[0])[1])}.</p>
      <p><b>IFTTT:</b> add the Webhooks action "Make a web request". URL: the link above. Method: POST. Content type: application/json. Body: <code class="mono">{"text": "…"}</code> with the ingredient you want.</p>
      <p><b>Zapier:</b> add "Webhooks by Zapier", POST. URL: the link above. Data: a field named <code class="mono">text</code>.</p>
      <p><b>iPhone Shortcuts:</b> "Get Contents of URL" with the link, Method POST, Request Body JSON, and a <code class="mono">text</code> field.</p>
      <p><b>Home Assistant:</b> a <code class="mono">rest_command</code> with the link, method post, and <code class="mono">payload: '{"text": "Gate left open"}'</code>.</p>
      <p><b>A script:</b> <code class="mono">curl -d 'Gate left open' ${esc(example)}</code></p>
    </details>
    <p class="hint">Anyone who has this link can put things on your board, so keep it private. A new link replaces it; the old one stops working at once.</p>
    <div class="form-row"><button class="icon-btn" type="button" data-hook-new="${esc(h.id)}">New link</button><span class="grow"></span><button class="btn" type="button" data-hook-close>Close</button></div></div>`;
}

async function showHookLinks(id, links) {
  hookShown = { id, links: links || await api('/api/webhooks', { links: true, id }) };
  renderHookShow();
  $('hook-show').scrollIntoView({ block: 'nearest' });
}

document.addEventListener('click', async (e) => {
  if (!e.target.closest('#hook-card')) return;
  if (e.target.closest('#hook-open')) { $('hook-form').hidden = false; $('hook-name').focus(); return; }
  const cp = e.target.closest('[data-copy]');
  if (cp) { navigator.clipboard.writeText(cp.dataset.copy).then(() => toast('Copied. Keep it private.')).catch(() => toast('Could not copy: select it and copy instead.')); return; }
  if (e.target.closest('[data-hook-close]')) { hookShown = null; renderHookShow(); return; }
  try {
    const lk = e.target.closest('[data-hook-links]');
    if (lk) { await showHookLinks(lk.dataset.hookLinks); return; }
    const nw = e.target.closest('[data-hook-new]');
    if (nw) {
      if (!nw.dataset.sure) { nw.dataset.sure = '1'; nw.textContent = 'Replace the link? The old one stops working'; nw.classList.add('danger'); return; }
      const r = await api('/api/webhooks', { newLink: true, id: nw.dataset.hookNew });
      SET = await api('/api/settings'); await showHookLinks(nw.dataset.hookNew, r.links); renderWebhooks();
      toast('New link made. Put it wherever the old one was.'); return;
    }
    const rm = e.target.closest('[data-hook-remove]');
    if (rm) {
      if (!rm.dataset.sure) { rm.dataset.sure = '1'; rm.textContent = 'Remove it?'; rm.classList.add('danger'); return; }
      await api('/api/webhooks', { remove: true, id: rm.dataset.hookRemove });
      if (hookShown?.id === rm.dataset.hookRemove) hookShown = null;
      SET = await api('/api/settings'); renderWebhooks(); return;
    }
    const ts = e.target.closest('[data-hook-test]');
    if (ts) {
      const id = ts.dataset.hookTest;
      hookTests[id] = { busy: true }; renderWebhooks();
      try { hookTests[id] = await api('/api/webhooks', { test: true, id }); }
      catch (err) { hookTests[id] = { local: { ok: false, error: err.message } }; }
      SET = await api('/api/settings'); renderWebhooks(); return;
    }
  } catch (err) { toast(err.message); }
});

document.addEventListener('change', (e) => {
  const f = e.target.closest?.('[data-hook-field]');
  if (!f) return;
  const h = (SET.webhooks || []).find((x) => x.id === f.dataset.hook);
  if (h) h[f.dataset.hookField] = f.value;
  api('/api/webhooks', { id: f.dataset.hook, [f.dataset.hookField]: f.value }).then(() => { $('saved').textContent = 'Saved'; $('saved').className = 'saved show'; setTimeout(() => { $('saved').className = 'saved'; }, 1400); renderHookShow(); }).catch((err) => toast(err.message));
});

$('hook-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('hook-msg').textContent = 'Making the link…'; $('hook-msg').className = 'small muted';
  try {
    const r = await api('/api/webhooks', { add: true, name: $('hook-name').value, space: $('hook-space').value, kind: $('hook-kind').value });
    $('hook-name').value = ''; $('hook-msg').textContent = ''; $('hook-form').hidden = true;
    SET = await api('/api/settings'); renderWebhooks();
    await showHookLinks(r.id, r.links);
  } catch (err) { $('hook-msg').textContent = err.message; $('hook-msg').className = 'small bad-text'; }
});
