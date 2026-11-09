// Pictures and reactions in the Inbox's conversation view (convo.js). Teams here;
// email, Google Voice and Outlook pictures and files come from mailfiles.js.
//   Pictures in: shown as pictures (through /api/teams/picture, since only this
//     sign-in can open them); click one to see it full size.
//   Pictures out: attach, paste or drop them on the reply box; they go as
//     Teams' own pictures, so the other person sees the picture, not a file link.
//     Big ones are made smaller first (longest side 1600, JPEG) to fit Teams' limit.
//   Reactions: under a message as Teams shows them, with how many and who;
//     click one to add or take back yours, or pick from the row that shows on hover.
// Teams does not tell anyone else's app whether a message was read, so there
// is no "seen" here (docs/DECISIONS.md).
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
const CV_QUICK = ['👍', '❤️', '😆', '😮', '😢', '🙏'];
let cvPics = [];   // pictures waiting in the reply box: { type, data (base64), url (for the preview) }

// Pictures go out with Teams, email and Outlook replies. Google Voice's email
// relay passes on words only, so texts have no paperclip (docs/DECISIONS.md).
const cvCanAttach = (kind) => kind === 'teams' || kind === 'team' || kind === 'mail' || kind === 'outlook';
const cvExtrasKey = (m) => JSON.stringify([m.pictures || [], (m.reactions || []).map((r) => [r.emoji, r.n, r.mine]), m.edited, m.deleted, m.pinned, m.seen, m.seenBy]);   // the last five: team chat
function cvExtras(m) {
  const found = cvFileList(m.id);   // email and Outlook (mailfiles.js)
  const pics = [...(m.pictures || []), ...found.filter((f) => f.picture).map((f) => f.url)].map((u) => `<button class="cv-pic" type="button" data-cv-pic="${esc(u)}" title="See it full size"><img src="${esc(u)}" alt="Picture" loading="lazy"></button>`).join('');
  const teams = (CV?.kind === 'teams' || (CV?.kind === 'team' && !m.deleted)) && !cvStandIn(m);
  const reacts = (m.reactions || []).map((r) => `<button class="cv-react${r.mine ? ' mine' : ''}" type="button" data-cv-react="${esc(r.emoji)}" aria-pressed="${r.mine}" title="${esc((r.who || []).join(', ') || r.emoji)}${teams ? (r.mine ? ' · click to take yours back' : ' · click to add yours') : ''}">${esc(r.emoji)} <span>${r.n}</span></button>`).join('');
  const quick = teams ? `<span class="cv-quick" role="group" aria-label="React">${CV_QUICK.map((e) => `<button type="button" data-cv-react="${e}" title="React with ${e}">${e}</button>`).join('')}</span>` : '';
  const files = found.filter((f) => !f.picture).map((f) => `<a class="cv-file" href="${esc(f.download)}" download="${esc(f.name)}" title="Save ${esc(f.name)}"><span class="cv-file-name">${esc(f.name)}</span><span class="cv-file-size">${esc(cvSize(f.size))}</span></a>`).join('');
  return (pics ? `<div class="cv-pics">${pics}</div>` : '') + (files ? `<div class="cv-files">${files}</div>` : '') + (reacts || quick ? `<div class="cv-reacts">${reacts}${quick}</div>` : '') + (CV?.kind === 'team' ? tcExtras(m) : '');
}

// ---------- pictures out
const cvAttachButton = () => `<button class="cv-clip" type="button" data-cv="attach" title="Add a picture (or paste or drop one here)" aria-label="Add a picture"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5l-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l7.9-7.9"/></svg></button><input type="file" accept="image/*" multiple hidden id="cv-file">`;
function drawCvPics() {
  const el = $('cv-attach'); if (!el) return;
  el.hidden = !cvPics.length;
  el.innerHTML = cvPics.map((p, i) => `<span class="cv-attach-pic"><img src="${p.url}" alt="Picture to send"><button type="button" data-cv-unpic="${i}" aria-label="Remove this picture">×</button></span>`).join('');
}
// A picture as it will be sent: as it is when small, otherwise 1600 on its longest side, as JPEG.
async function cvShrink(file) {
  // Team chat seals each picture into the message itself, so its pictures are smaller.
  const side = CV?.kind === 'team' ? 1280 : 1600;
  const small = file.size < (CV?.kind === 'team' ? 250e3 : 900e3) && /^image\/(png|jpeg|gif|webp)$/.test(file.type);
  let blob = file;
  if (!small) {
    const bmp = await window.createImageBitmap(file);
    const k = Math.min(1, side / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
  }
  const data = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); });
  return { type: blob.type, data, url: URL.createObjectURL(blob) };
}
async function cvAddPics(files) {
  const imgs = [...files].filter((f) => f.type.startsWith('image/'));
  if (!imgs.length) return false;
  if (cvPics.length + imgs.length > 6) { toast('Six pictures at a time. Send these, then the rest.'); }
  for (const f of imgs.slice(0, 6 - cvPics.length)) {
    try { cvPics.push(await cvShrink(f)); } catch { toast('That picture could not be read. Try saving it as a PNG or JPEG first.', { kind: 'error' }); }
  }
  drawCvPics(); $('r-text')?.focus();
  return true;
}
function cvPicsTake() { const out = cvPics.map(({ type, data }) => ({ type, data })); cvPics.forEach((p) => URL.revokeObjectURL(p.url)); cvPics = []; drawCvPics(); return out; }
function cvPicsPutBack(images) { cvPics = images.map((im) => ({ ...im, url: `data:${im.type};base64,${im.data}` })); drawCvPics(); }

// ---------- reactions
async function cvReact(id, emoji) {
  const m = CV?.byId.get(id);
  if (!m || (CV.kind !== 'teams' && CV.kind !== 'team') || cvStandIn(m)) return;
  const before = m.reactions ? m.reactions.map((r) => ({ ...r })) : null;
  const list = (m.reactions || []).map((r) => ({ ...r }));
  const had = list.find((r) => r.emoji === emoji);
  const on = !(had && had.mine);
  // Shown at once; put back if Teams says no.
  if (had) { had.mine = on; had.n += on ? 1 : -1; } else list.push({ emoji, n: 1, mine: true, who: ['You'] });
  m.reactions = list.filter((r) => r.n > 0); redraw(m);
  try { await (CV.kind === 'team' ? api('/api/chat/act', { key: CV.key, what: 'react', id, emoji, on }) : api('/api/teams/react', { key: CV.key, id, emoji, on })); }
  catch (e) { m.reactions = before; redraw(m); toast(`${CV.kind === 'team' ? 'That reaction did not go' : 'Teams did not take that reaction'}: ` + e.message, { kind: 'error' }); }
}

document.addEventListener('click', (e) => {
  if (!CV) return;
  const r = e.target.closest('[data-cv-react]');
  if (r) { const id = r.closest('.cv-msg')?.dataset.id; if (id) cvReact(id, r.dataset.cvReact); return; }
  const p = e.target.closest('[data-cv-pic]');
  if (p) { window.open(p.dataset.cvPic, '_blank', 'noopener'); return; }
  const u = e.target.closest('[data-cv-unpic]');
  if (u) { const [gone] = cvPics.splice(Number(u.dataset.cvUnpic), 1); if (gone) URL.revokeObjectURL(gone.url); drawCvPics(); return; }
  if (e.target.closest('[data-cv="attach"]')) $('cv-file')?.click();
});
document.addEventListener('change', (e) => { if (e.target.id === 'cv-file') { cvAddPics(e.target.files); e.target.value = ''; } });
document.addEventListener('paste', (e) => {
  if (!CV || !cvCanAttach(CV.kind) || e.target.id !== 'r-text') return;
  const files = [...(e.clipboardData?.files || [])];
  if (files.some((f) => f.type.startsWith('image/'))) { e.preventDefault(); cvAddPics(files); }
});
document.addEventListener('dragover', (e) => { if (cvCanAttach(CV?.kind) && e.target.closest?.('.cv-compose') && [...(e.dataTransfer?.items || [])].some((i) => i.kind === 'file')) e.preventDefault(); });
document.addEventListener('drop', (e) => {
  if (!cvCanAttach(CV?.kind) || !e.target.closest?.('.cv-compose') || !e.dataTransfer?.files?.length) return;
  e.preventDefault(); cvAddPics(e.dataTransfer.files);
});
