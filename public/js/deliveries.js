// Deliveries: packages on their way, read from shipping emails (lib/deliveries.js).
// Shown as "Packages" in the Today card on Now; a delayed one is also a Needs-you card.
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
// Everything here came from email: it goes through esc().
const SHIP_STATUS = { out: 'Out for delivery', delivered: 'Delivered', delayed: 'Delayed', pickup: 'Ready for pickup', shipped: 'On its way' };

// What the chip says: the news, or the day it is expected.
function shipWhen(p) {
  if (p.status === 'delivered') return 'Delivered ' + clock(p.deliveredAt).replace(':00', '').replace(' ', '').toLowerCase();
  if (p.status !== 'shipped' || !p.eta) return SHIP_STATUS[p.status];
  const d = new Date(p.eta), today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(d).setHours(0, 0, 0, 0) - today) / 86400e3);
  if (diff <= 0) return 'Arriving today';
  if (diff === 1) return 'Tomorrow';
  return diff < 7 ? d.toLocaleDateString([], { weekday: 'long' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

const shipList = () => (S.deliveries || []).filter((p) => project === 'all' || p.space === project);

// The Packages block in the Today card.
function deliveriesBlock() {
  const list = shipList();
  if (!list.length) return '';
  const coming = list.filter((p) => p.status !== 'delivered').length;
  return `<div class="ship-block"><div class="ship-head"><span class="ship-label">Packages</span><span class="muted small">${coming ? `${coming} on the way` : 'All here'}</span></div>
    <ul class="ship-list">${list.map((p) => `<li><button type="button" class="ship st-${p.status} ${isSel('delivery', p.key) ? 'sel' : ''}" data-type="delivery" data-key="${esc(p.key)}">
      <span class="pill pill--soft ship-chip">${esc(shipWhen(p))}</span>
      <span class="ship-what"><b>${esc(p.name)}</b>${p.from ? `<span class="muted"> · ${esc(p.from)}</span>` : ''}</span>
      <span class="ship-win mono">${p.window && p.status !== 'delivered' ? esc(p.window) : ''}</span></button></li>`).join('')}</ul></div>`;
}

// A delayed package needs you: it is a card with the rest.
function deliveryCards() {
  return (S.deliveries || []).filter((p) => p.status === 'delayed').map((p) => ({ type: 'delivery', key: p.key, space: p.space, st: 'needs', label: 'Delayed', where: ['Package', p.carrier].filter(Boolean).join(' · '), what: p.name === p.carrier ? 'A package is delayed. Track it to see why.' : `${p.name}${p.from ? ' (' + p.from + ')' : ''} is delayed`, at: p.last }));
}

function findDelivery(key) {
  const p = (S.deliveries || []).find((x) => x.key === key);
  return p && { ...p, key: 'ship:' + p.key, space: p.space || 'personal' };   // key: what Clear clears
}

function deliveryDetail(x, kick) {
  const facts = [
    ['Status', shipWhen(x) + (x.status === 'shipped' && x.eta ? ' (expected)' : '')],
    x.window && ['Window', x.window],
    x.from && ['From', x.from],
    x.carrier && ['Carrier', x.carrier],
    x.tracking && ['Tracking', x.tracking],
    x.order && ['Order', x.order],
    ['Last news', since(x.last)]
  ].filter(Boolean);
  return kick('Package') + `<h2>${esc(x.name)}</h2>
    <dl class="facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd${k === 'Tracking' || k === 'Order' ? ' class="mono"' : ''}>${esc(v)}</dd>`).join('')}</dl>
    <div class="actions">${x.url ? `<a class="btn btn--primary" href="${safeHref(x.url)}" target="_blank" rel="noopener">Track it</a>` : ''}${x.link ? `<a class="btn" href="${safeHref(x.link)}" target="_blank" rel="noopener">Open the email</a>` : ''}<button class="btn" data-act="clear" type="button">Clear</button></div>
    ${x.status === 'delayed' ? '<p class="note-line">Clear it once you have dealt with it. It comes back if there is more news.</p>' : ''}`;
}
