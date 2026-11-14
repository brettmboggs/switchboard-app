// Flips (#flips, a tab of Money): things to buy and resell.
//   * Top: the price check. Type what it is (or paste a link, or press the Check
//     in Flips bookmark on any listing) and the price; it says good deal, thin or
//     bad deal, what it sells for on eBay, the profit after fees, and the most
//     to pay or bid (lib/flips.js check, lib/flipmath.js).
//   * Left: deals found for the watched words: new eBay Buy It Now listings,
//     misspelled ones, auctions ending soon, pickup near home, the category
//     sweep and auction sites' alert emails, each with its profit (lib/ebay.js,
//     lib/flipmail.js).
//   * Right: what Flips watches for and its money math, and government surplus
//     auctions within driving distance (GSA).
// One screen: each list scrolls in its own box. Buying is always a click on the
// site itself; Flips only reads. One of the page's scripts in public/js, loaded
// in order by index.html. The flip log is its own tab (fliplog.js).
const fl = { data: null, at: 0, busy: false, saving: false, msg: '', tab: store.get('flTab', 'deals'), chk: { f: {}, r: null, busy: false, err: '' } };
// Easy to sell, ship and test, model names exact enough to price (the welcome's starter list).
const FL_STARTER = ['RTX 3070', 'RTX 3060', 'Steam Deck', 'Nintendo Switch OLED', 'Sony WH-1000XM5', 'Bose QuietComfort 45', 'DeWalt DCF887', 'Milwaukee 2953-20', 'Canon EF 50mm 1.8 STM', 'TI-84 Plus CE'];
const FL_SITES = [['', 'Where: from the link'], ['ebay', 'eBay'], ['shopgoodwill', 'ShopGoodwill'], ['propertyroom', 'PropertyRoom'], ['auction', 'Local auction (HiBid, GovDeals)'], ['store', 'Store or open box'], ['cash', 'Cash, in person']];

async function flLoad(force = false) {
  if (fl.busy || (!force && fl.data && Date.now() - fl.at < 60e3)) return;
  fl.busy = true;
  try { fl.data = await api('/api/flips'); fl.at = Date.now(); } catch {}
  fl.busy = false;
  if (page === 'flips') renderFlips();
}

const flMoney = (n) => (n < 0 ? '−$' : '$') + Math.abs(Math.round(n || 0)).toLocaleString('en-US');
const flMins = (t) => { const m = Math.max(0, Math.round((t - Date.now()) / 60e3)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };

// The bookmark that checks any listing: it reads the page you are on (its
// heading, and the price you highlighted or the one next to "current bid") in
// your own browser and opens Flips with it. Nothing is sent anywhere else.
function flMark() {
  const code = `(()=>{const n=(x)=>x?x.replace(/,/g,''):'';const s=String(getSelection()).trim();const h=document.querySelector('h1');const t=((h&&h.innerText)||document.title).trim();const b=document.body.innerText;let p=n((s.match(/\\$?\\s?([\\d,]+(?:\\.\\d\\d)?)/)||[])[1]);if(!p&&!/ebay\\./.test(location.hostname)){for(const re of [/current\\s*(?:price|bid)\\s*:?\\s*\\$\\s?([\\d,]+(?:\\.\\d\\d)?)/i,/(?:high|winning|top)\\s*bid\\s*:?\\s*\\$\\s?([\\d,]+(?:\\.\\d\\d)?)/i,/(?:^|\\n)\\s*(?:price|bid|current)\\s*:?\\s*\\$\\s?([\\d,]+(?:\\.\\d\\d)?)/i]){const m=b.match(re);if(m){p=n(m[1]);break}}}const sh=(b.match(/shipping\\s*(?:price|cost)?\\s*:\\s*\\$\\s?([\\d,]+(?:\\.\\d\\d)?)/i)||[])[1],hd=(b.match(/handling\\s*(?:price|fee|cost)?\\s*:\\s*\\$\\s?([\\d,]+(?:\\.\\d\\d)?)/i)||[])[1];const ship=sh||hd?String(Math.round((+n(sh)||0)*100+(+n(hd)||0)*100)/100):'';window.open('${location.origin}/'+String.fromCharCode(35)+'flips?'+new URLSearchParams({what:t.slice(0,240),price:p,ship,from:location.href}),'switchboard-flips')})()`;
  return 'javascript:' + code;
}

function flDeal(d) {
  const ship = d.shipping == null ? 'shipping not listed' : d.shipping ? `+${flMoney(d.shipping)} ship` : 'free ship';
  const tag = { misspelled: 'misspelled', pickup: 'pickup near you', alert: d.sourceName }[d.how] || (d.how === 'ending' ? `auction, ends in ${flMins(d.endsAt)}` : '');
  const how = `${d.hot ? '<span class="fl-hot">Hot</span>' : ''}${tag ? `<span class="fl-how">${esc(tag)}</span>` : ''}`;
  const nums = d.auction ? `<b>${d.price ? flMoney(d.price) : 'no bid'}</b><span class="fl-usual">${d.bids != null ? `${d.bids} bid${d.bids === 1 ? '' : 's'} · ` : ''}sells ~${flMoney(d.sells)}</span><span class="fl-gap">bid up to ${flMoney(d.bidTo)}</span>`
    : `<b>${flMoney(d.total)}</b><span class="fl-usual">sells ~${flMoney(d.sells)}</span><span class="fl-gap">+${flMoney(d.v.profit)} profit</span>`;
  return `<a class="fl-deal" href="${safeHref(d.url)}" target="_blank" rel="noopener noreferrer">
    ${d.image ? `<img class="fl-img" src="${safeHref(d.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="fl-img"></span>'}
    <span class="fl-mid"><span class="fl-name" title="${esc(d.name)}">${esc(d.name)}</span>
      <span class="fl-sub">${how}${d.how === 'alert' ? '' : esc(d.word) + ' · '}${esc(d.condition || (d.how === 'alert' ? 'from your saved search' : 'condition not given'))}${d.source === 'ebay' && d.how !== 'pickup' ? ' · ' + esc(ship) : ''}${d.listedAt ? ' · ' + (d.how === 'alert' ? 'emailed ' : 'listed ') + esc(since(d.listedAt)) : ''}</span></span>
    <span class="fl-nums">${nums}</span>
  </a>`;
}

function flLot(l) {
  const bid = l.bid ? `${flMoney(l.bid)} bid` : 'no bids';
  const ends = l.days <= 0 ? 'ends today' : l.days === 1 ? 'ends tomorrow' : `ends in ${l.days} days`;
  return `<a class="fl-lot" href="${safeHref(l.url)}" target="_blank" rel="noopener noreferrer">
    <span class="fl-mid"><span class="fl-name" title="${esc(l.name)}">${esc(l.name)}</span>
      <span class="fl-sub" title="${esc(l.about)}">${esc(l.city)}, ${esc(l.state)} · ${esc(ends)} · ${l.bidders} bidder${l.bidders === 1 ? '' : 's'}${l.repair ? ' · needs repair' : ''}</span></span>
    <span class="fl-nums"><b>${esc(bid)}</b></span>
  </a>`;
}

// One source of the radar: what it watches, whether it is on, its last look.
function flSource(x) {
  const state = x.error && x.on ? `<span class="fl-src-bad" title="${esc(x.error)}">not working</span>` : x.on ? `<span class="fl-ok">on</span>` : `<span class="fl-src-off">${esc(x.state)}</span>`;
  const when = x.at ? `${x.mail ? 'last alert' : 'looked'} ${since(x.at)}` : esc(x.every);
  return `<div class="fl-src"><span class="fl-mid"><span class="fl-name">${x.setup ? `<a href="${safeHref(x.setup)}" target="_blank" rel="noopener noreferrer">${esc(x.name)}</a>` : esc(x.name)}</span><span class="fl-sub" title="${esc(x.how)}">${esc(x.how)}</span></span>
    <span class="fl-nums">${state}<span class="fl-usual">${when}</span></span></div>`;
}

// Items from alert emails that could not be priced yet (no eBay keys): still worth a look.
function flUnpriced(u) {
  return `<a class="fl-lot" href="${safeHref(u.url)}" target="_blank" rel="noopener noreferrer"><span class="fl-mid"><span class="fl-name" title="${esc(u.name)}">${esc(u.name)}</span>
    <span class="fl-sub"><span class="fl-how">${esc(u.sourceName)}</span>not priced yet: add the eBay keys · emailed ${esc(since(u.at))}</span></span><span class="fl-nums"><b>${u.price ? flMoney(u.price) : ''}</b></span></a>`;
}

// ---- the price check
function flVerdict(r) {
  if (!r) return '<p class="fl-hint">Type what it is and its price, or paste the listing\'s link. Or drag Check in Flips (top right) to your bookmarks bar, then press it on any listing to check it here.</p>';
  const v = r.verdict;
  const by = r.source === 'you' ? 'what you typed' : `${r.comps} eBay listings like it${r.asking ? `; asking ${flMoney(r.asking)}` : ''}`;
  const tools = `<a class="btn btn--quiet" href="${safeHref(r.sold)}" target="_blank" rel="noopener noreferrer" title="eBay's sold listings for: ${esc(r.query)}">Sold prices</a>
    <button class="btn btn--quiet" type="button" data-fl-watchthis>Watch for this</button>${v?.cost ? '<button class="btn btn--quiet" type="button" data-fl-bought>I bought it</button>' : ''}`;
  if (!v) return `<div class="fl-res"><span class="fl-light fl-light--none">No price yet</span><p class="fl-why">${esc(r.note || 'Type what it sold for to get the answer.')}</p><span class="grow"></span>${tools}</div>`;
  const auction = ['shopgoodwill', 'propertyroom', 'auction'].includes(r.site) || r.item?.auction;
  const word = !v.cost ? (auction ? `Bid up to ${flMoney(v.max)}` : `Pay up to ${flMoney(v.max)}`) : v.light === 'good' ? 'Good deal' : v.light === 'thin' ? 'Thin' : 'Bad deal';
  const extra = r.site !== 'ebay' && r.site !== 'cash' ? `${r.shipIn ? `${flMoney(r.shipIn)} shipping to you` : ''}${r.premium ? `${r.shipIn ? ', ' : ''}${r.premium}% buyer's premium` : ''}` : '';
  return `<div class="fl-res">
    <span class="fl-light fl-light--${v.cost ? v.light : 'max'}">${esc(word)}</span>
    <dl class="fl-figs">
      <div><dt>Sells for about</dt><dd title="From ${esc(by)}">${flMoney(v.sale)}</dd></div>
      <div><dt>You keep, after fees and label</dt><dd title="eBay fee ${flMoney(v.fee)}, shipping label about ${flMoney(v.shipOut)}">${flMoney(v.keep)}</dd></div>
      ${v.cost ? `<div><dt>Costs you in all</dt><dd title="${esc(extra || 'With sales tax')}">${flMoney(v.cost)}</dd></div><div><dt>Profit</dt><dd class="fl-p fl-p--${v.light}">${flMoney(v.profit)}${v.roi != null ? ` <small>${v.roi}%</small>` : ''}</dd></div>` : ''}
      <div><dt>${auction ? 'Bid no more than' : 'Pay no more than'}</dt><dd>${flMoney(v.max)}</dd></div>
    </dl>
    <span class="grow"></span>${tools}
  </div>
  <p class="fl-why">${esc(r.name)}: priced from ${esc(by)}${r.source === 'ebay' ? ' (what is listed now; check Sold prices to be sure)' : ''}. Worth it means at least ${flMoney(v.minProfit)} and a fifth of what you pay.${r.siteNote ? ' ' + esc(r.siteNote) : ''}</p>`;
}

function flCheckCard() {
  const c = fl.chk, f = c.f, r = c.r;
  const opt = (v, t) => `<option value="${v}"${(f.site || '') === v ? ' selected' : ''}>${esc(t)}</option>`;
  return `<section class="card fl-check" id="flips-check"><h2>Is it a good buy?<span class="aside">anything, from any site · <a class="fl-bm" href="${esc(flMark())}" title="Drag this to your bookmarks bar, then press it on any listing">Check in Flips</a></span></h2>
    <form class="fl-cform" data-fl-price>
      <label class="sr" for="fl-what">What it is, or its link</label><input id="fl-what" name="what" class="field fl-what" type="text" autocomplete="off" spellcheck="false" placeholder="RTX 3070 Founders Edition, or paste the listing's link" value="${esc(f.what || '')}">
      <label class="sr" for="fl-price">Price or current bid</label><input id="fl-price" name="price" class="field fl-num" type="number" min="0" step="0.01" placeholder="Price $" value="${esc(f.price ?? '')}">
      <label class="sr" for="fl-site">Where</label><select id="fl-site" name="site" class="field fl-site">${FL_SITES.map(([v, t]) => opt(v, t)).join('')}</select>
      <button class="btn btn--primary" type="submit"${c.busy ? ' disabled' : ''}>${c.busy ? 'Checking…' : 'Check'}</button>
      <details class="fl-more"${f.more ? ' open' : ''}><summary>More</summary><span class="fl-morebox">
        <label class="fl-lab">Shipping to you<input name="shipIn" class="field fl-num" type="number" min="0" step="0.01" placeholder="${r ? esc(flMoney(r.shipIn)) : 'site usual'}" value="${esc(f.shipIn ?? '')}"></label>
        <label class="fl-lab">Buyer's premium %<input name="premium" class="field fl-num" type="number" min="0" max="40" step="0.5" placeholder="${r ? esc(String(r.premium)) : 'site usual'}" value="${esc(f.premium ?? '')}"></label>
        <label class="fl-lab">It sold for (from Sold prices)<input name="sells" class="field fl-num" type="number" min="0" step="1" placeholder="eBay looks it up" value="${esc(f.sells ?? '')}"></label>
        <label class="fl-lab">Search eBay for<input name="query" class="field" type="text" autocomplete="off" spellcheck="false" placeholder="${r ? esc(r.query) : 'made from the name'}" value="${esc(f.query ?? '')}"></label>
      </span></details>
    </form>
    ${c.err ? `<p class="fl-why fl-err">${esc(c.err)}</p>` : flVerdict(r)}
  </section>`;
}

// Runs a price check from outside the form: the bookmark's link, Jarvis.
function flAsk(o = {}) {
  fl.chk.f = { what: o.what || '', price: o.price || '', site: o.site || '', shipIn: o.shipIn || '', from: o.from || '', more: !!o.shipIn };
  fl.chk.r = null; fl.chk.err = '';
  flRunCheck();
}

async function flRunCheck() {
  const c = fl.chk;
  c.busy = true; c.err = ''; if (page === 'flips') renderFlips();
  try { c.r = await api('/api/flips/price', c.f); if (!c.f.site && c.r.site) c.f.site = c.r.site; }
  catch (e) { c.r = null; c.err = e.message; }
  c.busy = false;
  if (page === 'flips') renderFlips();
}

// ---- the watch settings
function flSetup(d) {
  const w = d?.watch || { words: [], near: [], maxPrice: null }, m = d?.money || { minProfit: 25, shipOut: 15, taxPct: 8 };
  const ebay = d?.ebay ? '<span class="fl-ok">eBay keys saved</span> <button class="btn btn--ghost" type="button" data-fl-keys-clear>Remove</button>'
    : `<label for="fl-app" class="sr">eBay App ID</label><input id="fl-app" name="appId" class="field" type="password" autocomplete="off" spellcheck="false" placeholder="eBay App ID (Client ID)">
       <label for="fl-cert" class="sr">eBay Cert ID</label><input id="fl-cert" name="certId" class="field" type="password" autocomplete="off" spellcheck="false" placeholder="eBay Cert ID (Client Secret)">`;
  const alertSel = `<select name="alerts" class="field">${[['all', 'Every deal'], ['hot', 'Hot deals only'], ['none', 'No alerts']].map(([v, t]) => `<option value="${v}"${(w.alerts || 'all') === v ? ' selected' : ''}>${t}</option>`).join('')}</select>`;
  const gsa = w.key ? '<span class="fl-ok">GSA key saved</span> <button class="btn btn--ghost" type="button" data-fl-gsa-clear>Remove</button>'
    : '<label for="fl-gsa" class="sr">GSA key</label><input id="fl-gsa" name="key" class="field" type="password" autocomplete="off" spellcheck="false" placeholder="GSA key (free, api.data.gov/signup)">';
  const cats = (d?.categories || []).map((c) => `<button class="btn btn--quiet fl-cat" type="button" data-fl-cat="${c.id}" aria-pressed="${c.on}">${esc(c.name)}</button>`).join('');
  return `<section class="card fl-setup" id="flips-setup"><h2>Your buy box<span class="aside">the radar alerts on what fits</span></h2>
    <form class="fl-form" data-fl-watch>
      <span class="fl-lab">Categories it sweeps on its own (press to switch)</span>
      <div class="fl-cats">${cats}</div>
      <div class="fl-row">
        <label class="fl-lab">Lowest price<input name="minPrice" class="field" type="number" min="0" step="1" placeholder="Any" value="${w.minPrice || ''}"></label>
        <label class="fl-lab">Top price<input name="maxPrice" class="field" type="number" min="0" step="1" placeholder="No limit" value="${w.maxPrice || ''}"></label>
        <label class="fl-lab">Least profit<input name="minProfit" class="field" type="number" min="0" step="1" value="${esc(m.minProfit)}"></label>
        <label class="fl-lab">Alert me for${alertSel}</label>
      </div>
      <div class="fl-row">
        <label class="fl-lab">Home ZIP<input name="home" class="field" type="text" inputmode="numeric" autocomplete="off" placeholder="For pickup" value="${esc(w.home || '')}"></label>
        <label class="fl-lab">Drive, miles<input name="miles" class="field" type="number" min="1" max="200" step="1" value="${esc(w.miles || 50)}"></label>
        <label class="fl-lab">Label cost<input name="shipOut" class="field" type="number" min="0" step="1" value="${esc(m.shipOut)}"></label>
        <label class="fl-lab">Sales tax %<input name="taxPct" class="field" type="number" min="0" max="15" step="0.1" value="${esc(m.taxPct)}"></label>
      </div>
      <label class="fl-lab" for="fl-words">Also watch for these exact things (optional; misspellings found too)<button class="btn btn--ghost fl-starter" type="button" data-fl-starter title="${esc(FL_STARTER.join(', '))}">Starter list</button></label>
      <input id="fl-words" name="words" class="field" type="text" autocomplete="off" spellcheck="false" placeholder="Steam Deck, RTX 3070" value="${esc(w.words.join(', '))}">
      <label class="fl-lab">Nearby ZIP areas for GSA (first 3 digits)<input name="near" class="field" type="text" autocomplete="off" placeholder="631, 633" value="${esc(w.near.join(', '))}"></label>
      <div class="fl-keys" title="Free keys: developer.ebay.com, Application Keys, the Production set; api.data.gov/signup for GSA. They only read listings.">${ebay}${gsa}</div>
      <div class="fl-actions"><button class="btn btn--primary" type="submit"${fl.saving ? ' disabled' : ''}>${fl.saving ? 'Looking…' : 'Save and look'}</button><span class="fl-msg" aria-live="polite">${esc(fl.msg)}</span></div>
    </form></section>`;
}

function renderFlips() {
  flLoad();
  const qs = location.hash.split('?')[1];
  if (qs) { const p = new URLSearchParams(qs); history.replaceState(null, '', '#flips'); flAsk({ what: p.get('what'), price: p.get('price'), shipIn: p.get('ship') || '', from: p.get('from') }); return; }
  const d = fl.data;
  const asof = d?.ebayAt ? `eBay checked ${since(d.ebayAt)}, every ${d.every} min` : d?.ebay ? 'eBay: first look soon' : 'eBay not set up';
  const head = `<div class="page-head"><h1>Money</h1>${subTabs()}<span class="grow"></span>
    <span class="fl-asof" title="${d ? esc(`${d.calls} of eBay's ${d.daily} calls today`) : ''}">${esc(asof)}</span>
    <button class="btn" type="button" data-fl-check${fl.busy ? ' disabled' : ''}>Look now</button></div>`;
  let left;
  if (!d) left = '<p class="empty">Loading…</p>';
  else if (!d.ebay) left = '<p class="empty">Add your free eBay developer keys on the right, and what you resell. Listings that leave you a profit after eBay\'s fees show here, with misspelled listings and auctions about to end, and you get an alert for each new one.</p>';
  else if (d.ebayError) left = `<p class="empty">${esc(d.ebayError)}</p>`;
  else if (!d.watch.words.length) left = '<p class="empty">Add what you resell on the right, or use the starter list.</p>';
  else left = d.deals.length ? d.deals.map(flDeal).join('') : `<p class="empty">Nothing worth it right now: a deal leaves at least ${flMoney(d.money.minProfit)} after fees. Flips looks every ${d.every} minutes and alerts you when one turns up.</p>`;
  const notes = (d?.notes || []).map((n) => n.sells ? `<span class="fl-note" title="From ${n.comps} listings like it; asking ${flMoney(n.asking)}">${esc(n.word)}: sells ~${flMoney(n.sells)}</span>` : `<span class="fl-note fl-note--warn" title="${esc(n.note)}">${esc(n.word)}: too few listings</span>`).join('');
  const lots = !d ? '' : !d.watch.near.length ? '<p class="empty">Add the ZIP areas you would drive to (first three digits) and surplus auctions there show here.</p>'
    : d.error ? `<p class="empty">${esc(d.error)}</p>`
    : d.lots.length ? d.lots.map(flLot).join('') : `<p class="empty">Nothing up for auction in those ZIP areas right now (of ${d.total} lots nationwide).</p>`;
  const keep = document.activeElement?.closest?.('.fl-check') ? document.activeElement.name : null;
  const tab = (id, label, n) => `<button class="btn btn--quiet fl-tab" type="button" data-fl-tab="${id}" aria-pressed="${fl.tab === id}">${label}<span class="count">${n}</span></button>`;
  const aside = fl.tab === 'lots' ? 'GSA, within driving distance' : fl.tab === 'radar' ? 'runs on its own while this computer is on' : 'profit after eBay\'s fees and the label';
  const on = (d?.radar || []).filter((x) => x.on).length;
  const radarList = `<div class="fl-list">${(d?.radar || []).map(flSource).join('')}<p class="fl-hint">eBay and GSA run on their own. ShopGoodwill and HiBid allow no robots, so they come in through the alert emails they send for a saved search; every item in each email is priced as it arrives (your mail is read on this computer only).</p></div>`;
  const dealList = `${notes ? `<div class="fl-notes">${notes}</div>` : ''}<div class="fl-list">${left}${(d?.unpriced || []).map(flUnpriced).join('')}</div>`;
  keepEdits($('page'), () => { $('page').innerHTML = head + `<div class="fl-page">${flCheckCard()}<div class="fl-grid">
    <section class="card fl-col"><h2 class="fl-tabs">${tab('deals', 'Deals', d?.deals?.length || 0)}${tab('lots', 'Surplus nearby', d?.nearCount || 0)}${tab('radar', 'Radar', `${on} of ${(d?.radar || []).length} on`)}<span class="aside">${aside}</span></h2>
      ${fl.tab === 'lots' ? `<div class="fl-list">${lots}</div>` : fl.tab === 'radar' ? radarList : dealList}</section>
    <div class="fl-side">${flSetup(d)}</div></div></div>`; }, { forget: fl.forget });
  fl.forget = false;
  if (keep && !document.activeElement?.closest?.('.fl-check')) document.querySelector(`.fl-check [name="${keep}"]`)?.focus();
}

const flForm = (f) => Object.fromEntries([...new FormData(f)].map(([k, v]) => [k, String(v).trim()]));

document.addEventListener('submit', async (e) => {
  const pf = e.target.closest('[data-fl-price]');
  if (pf) {
    e.preventDefault();
    const v = flForm(pf);
    if (!v.what) { fl.chk.err = 'Type what it is, or paste its link.'; renderFlips(); return; }
    fl.chk.f = { ...v, more: pf.querySelector('details')?.open, from: v.what === fl.chk.f.what ? fl.chk.f.from : '' };
    flRunCheck();
    return;
  }
  const f = e.target.closest('[data-fl-watch]');
  if (!f) return;
  e.preventDefault();
  const v = flForm(f);
  const body = { words: v.words || '', minPrice: Number(v.minPrice) || 0, maxPrice: Number(v.maxPrice) || 0, near: v.near || '', minProfit: v.minProfit, shipOut: v.shipOut, taxPct: v.taxPct, home: v.home || '', miles: v.miles, alerts: v.alerts };
  if (v.appId || v.certId) {
    if (!v.appId || !v.certId) { fl.msg = 'Paste both: the App ID and the Cert ID.'; renderFlips(); return; }
    body.appId = v.appId; body.certId = v.certId;
  }
  if (v.key) body.key = v.key;
  fl.saving = true; fl.msg = ''; renderFlips();
  try { fl.data = await api('/api/flips/watch', body); fl.at = Date.now(); fl.msg = 'Saved.'; fl.forget = true; }
  catch (err) { fl.msg = err.message; }
  fl.saving = false;
  if (page === 'flips') renderFlips();
});

document.addEventListener('click', async (e) => {
  if (page !== 'flips') return;
  if (e.target.closest('.fl-bm')) { e.preventDefault(); toast('Drag "Check in Flips" to your bookmarks bar, then press it on any listing.'); return; }
  const cat = e.target.closest('[data-fl-cat]');
  if (cat) {
    const on = (fl.data?.categories || []).filter((c) => c.on).map((c) => c.id);
    const id = Number(cat.dataset.flCat);
    const next = on.includes(id) ? on.filter((x) => x !== id) : [...on, id];
    cat.setAttribute('aria-pressed', String(!on.includes(id)));
    try { fl.data = await api('/api/flips/watch', { cats: next }); } catch (err) { toast(err.message, { kind: 'error' }); }
    renderFlips(); return;
  }
  const t = e.target.closest('[data-fl-tab]');
  if (t) { fl.tab = t.dataset.flTab; store.set('flTab', fl.tab); renderFlips(); return; }
  if (e.target.closest('[data-fl-check]')) {
    fl.busy = true; renderFlips();
    try { fl.data = await api('/api/flips/check', {}); fl.at = Date.now(); } catch (err) { toast(err.message, { kind: 'error' }); }
    fl.busy = false; renderFlips(); return;
  }
  if (e.target.closest('[data-fl-starter]')) {
    const input = $('fl-words');
    const have = input.value.split(',').map((s) => s.trim()).filter(Boolean);
    input.value = [...new Set([...have, ...FL_STARTER])].slice(0, 12).join(', ');
    fl.msg = 'Starter list added. Press Save and look.'; document.querySelector('.fl-msg').textContent = fl.msg; input.focus();
    return;
  }
  const r = fl.chk.r;
  if (e.target.closest('[data-fl-watchthis]') && r) {
    const words = [...new Set([...(fl.data?.watch?.words || []), r.query])].slice(0, 12);
    try { fl.data = await api('/api/flips/watch', { words }); toast(`Watching for ${r.query}.`); } catch (err) { toast(err.message, { kind: 'error' }); }
    renderFlips(); return;
  }
  if (e.target.closest('[data-fl-bought]') && r?.verdict) {
    try { await api('/api/flips/log', { name: r.name, cost: r.verdict.cost, where: r.siteLabel, url: r.link || '', sells: r.sells }); toast('Added to your flip log.', { action: { label: 'Open', run: () => { location.hash = '#fliplog'; } } }); }
    catch (err) { toast(err.message, { kind: 'error' }); }
    return;
  }
  for (const [sel, body, msg] of [['[data-fl-keys-clear]', { appId: '', certId: '' }, 'eBay keys removed.'], ['[data-fl-gsa-clear]', { key: '' }, 'GSA key removed.']]) {
    if (!e.target.closest(sel)) continue;
    try { fl.data = await api('/api/flips/watch', body); fl.msg = msg; } catch (err) { fl.msg = err.message; }
    renderFlips(); return;
  }
});
