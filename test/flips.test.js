// Flips (lib/flips.js): GSA surplus lots, and the ones a watch picks out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-flips-'));
const { lotFrom, pick, saveWatch, watch } = await import('../lib/flips.js');

const row = (o) => ({ saleNo: '2-1-QSC', lotNo: '001', itemName: 'Oscilloscopes', highBidAmount: 560, biddersCount: 3, aucIncrement: 10, reserve: true, aucEndDt: '2026-11-14', propertyCity: 'Harrisburg ', propertyState: 'pa', propertyZip: '17105null', auctionStatus: 'Active', itemDescURL: 'https://www.gsaauctions.gov/auctions/preview/1', imageURL: 'https://x/1.jpg',
  lotInfo: '<h4>Overview</h4><p>This lot contains 2 Tektronix oscilloscopes in repairable condition.</p><h4>Specifications</h4><ul><li>Make: Tektronix.</li></ul>', ...o });

test('a GSA lot reads as name, bid, place, end date, a short description and whether it needs repair', () => {
  const l = lotFrom(row());
  assert.deepEqual([l.id, l.name, l.bid, l.bidders, l.state, l.zip, l.city, l.ends, l.repair], ['2-1-QSC-001', 'Oscilloscopes', 560, 3, 'PA', '17105', 'Harrisburg', '2026-11-14', true]);
  assert.equal(l.about, 'This lot contains 2 Tektronix oscilloscopes in repairable condition.');
  assert.equal(lotFrom(row({ highBidAmount: null })).bid, 0);
});

test('nearby GSA lots: only the ZIP areas set, under the top price, word matches first (whole words), then soonest end; ended lots drop', () => {
  const now = Date.parse('2026-11-12T12:00:00Z');
  const lots = [
    lotFrom(row({ lotNo: '1', itemName: 'IT Servers', highBidAmount: 100, aucEndDt: '2026-11-15', propertyZip: '17110' })),
    lotFrom(row({ lotNo: '2', itemName: 'Observer chairs', aucEndDt: '2026-11-13', lotInfo: '', propertyZip: '17301' })),   // "server" inside a word: no match
    lotFrom(row({ lotNo: '3', itemName: 'Server rack and laptop carts', highBidAmount: 50, aucEndDt: '2026-11-14', propertyZip: '17025' })),
    lotFrom(row({ lotNo: '4', itemName: 'Servers', propertyZip: '75001' })),
    lotFrom(row({ lotNo: '5', itemName: 'Servers', highBidAmount: 9000, propertyZip: '17110' })),
    lotFrom(row({ lotNo: '6', itemName: 'Servers', aucEndDt: '2026-11-11', propertyZip: '17110' }))
  ];
  const got = pick(lots, { words: ['server', 'laptop'], near: ['171', '173', '170'], maxPrice: 1000 }, now);
  assert.deepEqual(got.map((l) => [l.id.slice(-1), l.hits.length, l.days]), [['3', 2, 2], ['1', 1, 3], ['2', 0, 1]]);
  assert.equal(pick(lots, { words: [] }, now).length, 0);   // no ZIP areas: nothing (it never shows the whole country)
});

test('the watch is saved cleaned up: ZIP areas as digits, a whole-dollar top price, at most 12 words; keys are never sent back', async () => {
  const { flips } = await import('../lib/flips.js');
  saveWatch({ words: 'gpu, server ,, generator', near: '171, abc, 17', maxPrice: '499.6', appId: 'app', certId: 'cert' });
  assert.deepEqual([watch().words, watch().near, watch().maxPrice, watch().ebay], [['gpu', 'server', 'generator'], ['171'], 500, { appId: 'app', certId: 'cert' }]);
  const out = JSON.stringify(flips());
  assert.ok(!out.includes('cert') && !out.includes('"app"'));
  saveWatch({ maxPrice: 0, words: Array.from({ length: 20 }, (_, i) => 'w' + i) });
  assert.equal(watch().maxPrice, null);
  assert.equal(watch().words.length, 12);
});

test('the money math is saved within sensible bounds, and changing it starts the deals over', () => {
  saveWatch({ minProfit: '40', shipOut: '-3', taxPct: '99', words: 'rtx 3070' });
  assert.deepEqual(watch().money, { minProfit: 40, shipOut: 0, taxPct: 15 });
  saveWatch({ minProfit: '', shipOut: 15, taxPct: 8 });
  assert.equal(watch().money.minProfit, 40);   // left empty: kept
});

test('the price check: without eBay keys it needs what it sold for; with it, the light and the most to pay; a site from the link', async () => {
  const { check } = await import('../lib/flips.js');
  saveWatch({ appId: '', certId: '', minProfit: 25, shipOut: 15, taxPct: 0 });
  const none = await check({ what: 'NVIDIA RTX 3070 Founders Edition 8GB - Tested', price: 156, from: 'https://shopgoodwill.com/item/123' });
  assert.equal(none.verdict, null);
  assert.equal(none.site, 'shopgoodwill');
  assert.match(none.note, /Sold prices/);
  assert.match(none.sold, /LH_Sold=1/);
  const typed = await check({ what: 'RTX 3070 Founders Edition', price: 156, site: 'shopgoodwill', sells: 250 });
  assert.deepEqual([typed.source, typed.verdict.light, typed.verdict.profit, typed.verdict.max], ['you', 'thin', 22.22, 145]);
  assert.match((await check({ what: '' })).error, /Type what it is/);
  assert.match((await check({ what: 'https://shopgoodwill.com/item/9' })).error, /cannot read that site/);

  saveWatch({ appId: 'app', certId: 'cert' });
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => String(url).includes('/oauth2/token') ? { ok: true, json: async () => ({ access_token: 't', expires_in: 7200 }) }
    : { ok: true, status: 200, json: async () => ({ itemSummaries: Array.from({ length: 12 }, (_, i) => ({ itemId: 'c' + i, title: 'NVIDIA RTX 3070 Founders Edition', price: { value: String(220 + i * 5) }, shippingOptions: [{ shippingCost: { value: '0' } }] })) }) };
  try {
    const r = await check({ what: 'NVIDIA RTX 3070 Founders Edition 8GB - Tested', price: 156, site: 'shopgoodwill' });
    assert.equal(r.query, 'NVIDIA RTX 3070 Founders Edition');
    assert.equal(r.source, 'ebay');
    assert.ok(r.sells >= 220 && r.sells <= 260, String(r.sells));
    assert.ok(['good', 'thin', 'bad'].includes(r.verdict.light));
  } finally { globalThis.fetch = real; saveWatch({ appId: '', certId: '' }); }
});

test('the flip log: bought, listed, sold; the profit after the fee and label, and the totals', async () => {
  const { saveEntry, removeEntry, fliplog } = await import('../lib/fliplog.js');
  assert.throws(() => saveEntry({ name: ' ' }), /Give the flip a name/);
  let log = saveEntry({ name: 'RTX 3070 FE', cost: '176', where: 'ShopGoodwill', boughtAt: '2026-11-01' });
  const id = log.entries[0].id;
  assert.equal(log.totals.tiedUp, 176);
  log = saveEntry({ id, status: 'sold', soldFor: 250, shipOut: 15, soldAt: '2026-11-08' });
  const e = log.entries[0];
  assert.deepEqual([e.fee, e.profit, e.days], [36.78, 22.22, 7]);
  assert.deepEqual([log.totals.profit, log.totals.sold, log.totals.tiedUp, log.totals.days], [22.22, 1, 0, 7]);
  saveEntry({ id, status: 'listed' });
  assert.equal(fliplog().entries[0].soldAt, null);
  assert.equal(removeEntry(id).entries.length, 0);
  assert.throws(() => saveEntry({ id: 'gone', name: 'x' }), /not in the log/);
});

test('the buy box: home ZIP (five digits) and drive miles for pickup, and which deals alert', async () => {
  const { alertable } = await import('../lib/flips.js');
  saveWatch({ home: '1234', miles: 500, alerts: 'loud' });
  assert.deepEqual([watch().home, watch().miles, watch().alerts], ['', 200, 'all']);
  saveWatch({ home: ' 12345 ', miles: 35, alerts: 'hot' });
  assert.deepEqual([watch().home, watch().miles, watch().alerts], ['12345', 35, 'hot']);
  assert.deepEqual([alertable({ hot: true }), alertable({ hot: false })], [true, false]);
  saveWatch({ alerts: 'none' });
  assert.equal(alertable({ hot: true }), false);
  saveWatch({ home: '', alerts: 'all' });
});
