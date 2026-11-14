// eBay for Flips (lib/ebay.js): what a thing sells for, and listings that leave a profit.
import test from 'node:test';
import assert from 'node:assert/strict';
const { listingFrom, judge, median, at, NOT_IT, sameItem, searchWords, priceFor, ebayDeals, roundCalls, itemByLink, soldLink, forgetEbay } = await import('../lib/ebay.js');

const item = (id, title, price, ship = 0, o = {}) => ({ itemId: id, title, price: { value: String(price) }, shippingOptions: [{ shippingCost: { value: String(ship) } }], condition: 'Used', itemWebUrl: `https://www.ebay.com/itm/${id}`, itemCreationDate: '2026-11-12T11:00:00Z', seller: { feedbackScore: 120, feedbackPercentage: '99.5' }, buyingOptions: ['FIXED_PRICE'], ...o });

test('a listing reads as its price with the cheapest shipping; an auction as its current bid', () => {
  const l = listingFrom(item('1', 'Canon EF 70-200 f/4 L', 300, 12.5));
  assert.deepEqual([l.price, l.shipping, l.total, l.seller.score, l.auction], [300, 12.5, 312.5, 120, false]);
  assert.equal(listingFrom(item('2', 'x', 10, 0, { shippingOptions: [] })).shipping, null);
  const a = listingFrom(item('3', 'x', 0, 5, { buyingOptions: ['AUCTION'], currentBidPrice: { value: '41' }, bidCount: 3, itemEndDate: '2026-11-12T13:00:00Z' }));
  assert.deepEqual([a.auction, a.price, a.total, a.bids, a.endsAt], [true, 41, 46, 3, Date.parse('2026-11-12T13:00:00Z')]);
  for (const t of ['Lens FOR PARTS', 'box only', 'sold as-is', 'Untested', 'iPhone iCloud locked', 'Lot of 5 controllers']) assert.ok(NOT_IT.test(t), t);
  assert.ok(!NOT_IT.test('Canon EF 70-200 f/4 L USM, clean glass'));
  assert.equal(median([5, 1, 3]), 3); assert.equal(median([4, 1, 3, 2]), 2.5); assert.equal(median([]), null);
  assert.equal(at([10, 20, 30, 40, 50], 0.25), 20); assert.equal(at([], 0.3), null);
});

test('the same item: every word of the search (spaces and dashes aside), and not another model of it', () => {
  assert.ok(sameItem('NVIDIA GeForce RTX 3070 Founders Edition 8GB', 'RTX 3070 Founders Edition'));
  assert.ok(!sameItem('NVIDIA GeForce RTX 3070 Ti Founders Edition', 'RTX 3070 Founders Edition'));
  assert.ok(!sameItem('RTX 3070Ti 8GB', 'RTX 3070'));
  assert.ok(!sameItem('Nintendo Switch OLED White', 'Nintendo Switch'));
  assert.ok(sameItem('Sony WH1000XM5 Wireless Headphones', 'Sony WH-1000XM5'));
  assert.ok(sameItem('DEWALT 20V MAX XR Impact Driver DCF887B', 'DeWalt DCF887'));
  assert.ok(!sameItem('RTX 3060 12GB', 'RTX 3070'));
  assert.ok(sameItem('Milwalkee M18 impact driver', 'Milwaukee M18 impact driver', { milwaukee: ['milwalkee'] }));
});

test('a search made from a long title keeps the words that name the item', () => {
  assert.equal(searchWords('NVIDIA GeForce RTX 3070 Founders Edition 8GB GDDR6 Graphics Card - Tested Working!'), 'NVIDIA GeForce RTX 3070 Founders Edition');
  assert.equal(searchWords('Used Sony WH-1000XM5 headphones, great condition'), 'Sony WH-1000XM5 headphones');
});

test('what it sells for: listings of the same item, outliers and other models out, a third of the way up', async () => {
  forgetEbay();
  const rows = [...Array.from({ length: 12 }, (_, i) => item('c' + i, 'RTX 3070 Founders Edition', 200 + i * 10)), item('ti', 'RTX 3070 Ti Founders Edition', 380), item('box', 'RTX 3070 Founders Edition box only', 15), item('fan', 'RTX 3070 Founders Edition fan', 20)];
  const fetcher = async (url) => String(url).includes('/oauth2/token') ? { ok: true, json: async () => ({ access_token: 't', expires_in: 7200 }) } : { ok: true, status: 200, json: async () => ({ itemSummaries: rows }) };
  const p = await priceFor({ appId: 'a', certId: 'b' }, 'RTX 3070 Founders Edition', { fetcher });
  // 12 kept (200…310); the fan is far under half the middle; a tenth cut from each end leaves 210…300.
  assert.equal(p.n, 10);
  assert.equal(p.sells, 237);
  assert.equal(p.asking, 255);
});

test('a deal leaves the least profit worth it after fees; an auction is one while its bid is under the most worth bidding', () => {
  const now = Date.parse('2026-11-12T12:00:00Z');
  const money = { minProfit: 25, shipOut: 15, taxPct: 0 };
  // Sells for 300: keeps 300 − 44.06 fee − 15 label (a graphics card) = 240.94.
  assert.ok(judge(listingFrom(item('a', 'RTX 3070', 180, 0)), 300, money, { now }));            // profit 60.94
  assert.equal(judge(listingFrom(item('b', 'RTX 3070', 230, 0)), 300, money, { now }), null);   // profit 10.94: thin
  assert.equal(judge(listingFrom(item('c', 'RTX 3070 box only', 20)), 300, money, { now }), null);
  assert.equal(judge(listingFrom(item('d', 'RTX 3070', 100, 0, { itemCreationDate: '2026-11-10T00:00:00Z' })), 300, money, { now }), null);
  assert.equal(judge(listingFrom(item('e', 'RTX 3070', 100, 0, { seller: { feedbackScore: 0 } })), 300, money, { now }), null);
  const auc = judge(listingFrom(item('f', 'RTX 3070', 0, 0, { buyingOptions: ['AUCTION'], currentBidPrice: { value: '120' } })), 300, money, { now });
  assert.equal(auc.bidTo, 200);   // min(240.94 − 25, 240.94 / 1.2) = 200.78
});

test('one round per word; every third (extra) also the misspellings and the auctions ending in three hours', async () => {
  forgetEbay();
  const calls = [];
  const now = Date.now();
  const comps = Array.from({ length: 20 }, (_, i) => item('c' + i, 'Canon lens', 500 + i * 10));
  const fresh = [item('n1', 'Canon lens', 250, 0, { itemCreationDate: new Date(now).toISOString() }), item('n2', 'Canon lens', 560, 0, { itemCreationDate: new Date(now).toISOString() })];
  const wrong = [item('m1', 'Cannon lens', 240, 0, { itemCreationDate: new Date(now).toISOString() }), item('m2', 'Canon lens', 200, 0)];
  const ending = [item('e1', 'Canon lens', 0, 0, { buyingOptions: ['AUCTION'], currentBidPrice: { value: '150' }, itemEndDate: new Date(now + 3600e3).toISOString() }), item('e2', 'Canon lens', 0, 0, { buyingOptions: ['AUCTION'], currentBidPrice: { value: '150' }, itemEndDate: new Date(now + 9 * 3600e3).toISOString() })];
  const fetcher = async (url, opts) => {
    const u = decodeURIComponent(String(url)); calls.push(u);
    if (u.includes('/oauth2/token')) { assert.match(opts.headers.Authorization, /^Basic /); return { ok: true, json: async () => ({ access_token: 't', expires_in: 7200 }) }; }
    const rows = u.includes('q=(cannon') ? wrong : u.includes('sort=endingSoonest') ? ending : u.includes('sort=newlyListed') ? fresh : comps;
    return { ok: true, status: 200, json: async () => ({ itemSummaries: rows }) };
  };
  const keys = { appId: 'a', certId: 'b' };
  const r = await ebayDeals(keys, ['canon lens'], { maxPrice: 400, fetcher, now });
  assert.deepEqual(r.deals.map((d) => [d.id, d.how]), [['n1', 'new']]);
  assert.ok(r.notes[0].sells > 500);
  assert.ok(calls.some((u) => u.includes('sort=newlyListed') && u.includes('price:[..400]')));
  assert.ok(calls.every((u) => !u.includes('/search') || u.includes('deliveryOptions:{SHIP_TO_HOME}')));
  const n = calls.length;
  const x = await ebayDeals(keys, ['canon lens'], { fetcher, extra: true, now });
  assert.deepEqual(x.deals.map((d) => [d.id, d.how]).sort(), [['e1', 'ending'], ['m1', 'misspelled'], ['n1', 'new']]);   // m2 is spelled right; e2 ends too late
  assert.equal(calls.length - n, roundCalls(['canon lens'], true));   // price and sign-in kept
  assert.equal(roundCalls(['canon lens'], false), 1);
});

test('an eBay link is read by its number; the sold search is eBay\'s own', async () => {
  const fetcher = async (url) => String(url).includes('/oauth2/token') ? { ok: true, json: async () => ({ access_token: 't', expires_in: 7200 }) }
    : (assert.match(String(url), /legacy_item_id=306349477155/), { ok: true, status: 200, json: async () => item('v1|306349477155|0', 'RTX 3070 FE', 280, 9) });
  const l = await itemByLink({ appId: 'a', certId: 'b' }, 'https://www.ebay.com/itm/306349477155?hash=x', fetcher);
  assert.deepEqual([l.name, l.price, l.shipping], ['RTX 3070 FE', 280, 9]);
  assert.equal(await itemByLink({}, 'https://shopgoodwill.com/item/1'), null);
  assert.match(soldLink('RTX 3070'), /_nkw=RTX\+3070&LH_Sold=1&LH_Complete=1/);
});

test('pickup near home, every extra look: pickup-only listings near the ZIP, no shipping counted; a hot deal is twice the least profit and 40%', async () => {
  const { isHot } = await import('../lib/ebay.js');
  forgetEbay();
  const now = Date.now(), calls = [];
  const comps = Array.from({ length: 20 }, (_, i) => item('c' + i, 'Canon lens', 500 + i * 10));
  const near = [item('p1', 'Canon lens', 200, 0, { shippingOptions: [], itemCreationDate: new Date(now - 2 * 86400e3).toISOString() })];
  const fetcher = async (url) => { const u = decodeURIComponent(String(url)); calls.push(u);
    if (u.includes('/oauth2/token')) return { ok: true, json: async () => ({ access_token: 't', expires_in: 7200 }) };
    return { ok: true, status: 200, json: async () => ({ itemSummaries: u.includes('pickupPostalCode') ? near : u.includes('sort=') ? [] : comps }) }; };
  const r = await ebayDeals({ appId: 'a', certId: 'b' }, ['canon lens'], { fetcher, extra: true, pickup: { zip: '12345', miles: 50 }, now });
  assert.deepEqual(r.deals.map((d) => [d.id, d.how, d.total, d.hot]), [['p1', 'pickup', 200, true]]);
  assert.ok(calls.some((u) => u.includes('pickupPostalCode:12345,pickupRadius:50,pickupRadiusUnit:mi') && u.includes('SELLER_ARRANGED_LOCAL_PICKUP')));
  assert.equal(roundCalls(['canon lens'], true, true), roundCalls(['canon lens'], true) + 1);
  assert.equal(isHot({ profit: 60, roi: 45 }, { minProfit: 25 }), true);
  assert.equal(isHot({ profit: 60, roi: 30 }, { minProfit: 25 }), false);
  assert.equal(isHot({ profit: 40, roi: 80 }, { minProfit: 25 }), false);
});

test('the category sweep: new listings in a category, each priced by its catalog product (kept a day); no product, no guess', async () => {
  const { sweep, sweepCalls, CATEGORIES } = await import('../lib/ebay.js');
  forgetEbay();
  const now = Date.now(), calls = [];
  const fresh = [item('s1', 'NVIDIA RTX 3070 FE', 150, 0, { epid: '999', itemCreationDate: new Date(now).toISOString() }), item('s2', 'Some GPU', 20, 0, { itemCreationDate: new Date(now).toISOString() }),
    item('s3', 'RTX 3070 for parts', 30, 0, { epid: '999', itemCreationDate: new Date(now).toISOString() })];
  const comps = Array.from({ length: 12 }, (_, i) => item('c' + i, 'RTX 3070', 260 + i * 5));
  const fetcher = async (url) => { const u = decodeURIComponent(String(url)); calls.push(u);
    if (u.includes('/oauth2/token')) return { ok: true, json: async () => ({ access_token: 't', expires_in: 7200 }) };
    return { ok: true, status: 200, json: async () => ({ itemSummaries: u.includes('epid=999') ? comps : u.includes('category_ids=27386') && u.includes('newlyListed') ? fresh : [] }) }; };
  const keys = { appId: 'a', certId: 'b' }, gpu = [CATEGORIES.find((c) => c.id === 27386)];
  const r = await sweep(keys, gpu, { minPrice: 40, maxPrice: 400, money: { minProfit: 25, shipOut: 15, taxPct: 0 }, fetcher, now });
  assert.deepEqual(r.map((d) => [d.id, d.how, d.word, d.hot]), [['s1', 'new', 'Graphics cards', true]]);
  assert.ok(calls.some((u) => u.includes('category_ids=27386') && u.includes('price:[40..400],priceCurrency:USD')));
  const n = calls.length;
  await sweep(keys, gpu, { fetcher, now });
  assert.equal(calls.filter((u, i) => i >= n && u.includes('epid=')).length, 0);   // the product's price is kept
  const none = await sweep(keys, gpu, { fetcher, now, budget: 0 });
  assert.equal(none.length, 1);   // already known: no budget needed
  assert.equal(sweepCalls(gpu, true, true, 15), 18);
  assert.equal(sweepCalls(gpu, false), 11);
});

test('a refused key says why: Sandbox keys, swapped boxes, or Production keys not switched on', async () => {
  const { keysProblem } = await import('../lib/ebay.js');
  assert.match(keysProblem({ appId: 'Sam-Shop-SBX-1a2b3c4d5-6e7f8a9b', certId: 'SBX-1a2b3c4d5e6f-aaaa' }), /Sandbox keys/);
  assert.match(keysProblem({ appId: 'PRD-1a2b3c4d5e6f-aaaa', certId: 'Sam-Shop-PRD-1a2b3c4d5-6e7f8a9b' }), /each other's boxes/);
  assert.match(keysProblem({ appId: 'Sam-Shop-PRD-1a2b3c4d5-6e7f8a9b', certId: 'PRD-1a2b3c4d5e6f-aaaa' }, '{"error":"invalid_client"}'), /I do not persist eBay data/);
});
