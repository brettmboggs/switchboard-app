// The privacy page's contact: whoever runs this sync service sets
// PRIVACY_CONTACT on it, so no address lives in the code.
fetch('/v1/providers').then((r) => r.json()).then((j) => {
  const a = String(j.contact || '').trim();
  if (!/^[^\s@<>"]+@[^\s@<>"]+$/.test(a)) return;
  const p = document.getElementById('contact'), link = document.createElement('a');
  link.href = 'mailto:' + a; link.textContent = a;
  p.textContent = 'Write to '; p.append(link, '.');
}).catch(() => {});
