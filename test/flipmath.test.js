// Flips' money math (lib/flipmath.js) and misspellings (lib/misspell.js).
import test from 'node:test';
import assert from 'node:assert/strict';
const { fee, keep, cost, maxPrice, verdict, siteOf, shipGuess } = await import('../lib/flipmath.js');
const { misspellings, slips } = await import('../lib/misspell.js');

test('eBay keeps 13.6% of the price with tax, plus $0.40 an order; the label comes off too', () => {
  assert.equal(fee(300), 44.06);
  assert.equal(fee(8), 1.46);
  assert.equal(keep(300, 15), 240.94);
});

test('what a buy costs: premium, tax and shipping in, by site', () => {
  assert.equal(cost(100, { site: 'ebay', shipIn: 10, taxPct: 8 }), 118);
  assert.equal(cost(100, { site: 'shopgoodwill', taxPct: 0 }), 120);
  assert.equal(cost(100, { site: 'auction', taxPct: 0 }), 115);
  assert.equal(cost(100, { site: 'cash', taxPct: 8 }), 100);
});

test('the light: good leaves the least profit and a fifth of the cost; thin some; bad a loss; the most to pay', () => {
  const o = { minProfit: 25, shipOut: 15, taxPct: 0 };
  const sg = verdict({ sale: 250, price: 156, site: 'shopgoodwill', ...o });   // keep 250 − 36.78 − 15 = 198.22; cost 176
  assert.deepEqual([sg.keep, sg.cost, sg.profit, sg.light], [198.22, 176, 22.22, 'thin']);
  assert.equal(sg.max, 145);   // min(198.22 − 25, 198.22 / 1.2) − 20 shipping = 145.18
  assert.equal(verdict({ sale: 250, price: 120, site: 'shopgoodwill', ...o }).light, 'good');
  assert.equal(verdict({ sale: 250, price: 190, site: 'shopgoodwill', ...o }).light, 'bad');
  assert.equal(verdict({ sale: 250, site: 'ebay', ...o }).light, null);   // no price: only the most to pay
  assert.equal(verdict({ sale: 0, price: 10 }), null);
  assert.equal(maxPrice(20, o), 0);
});

test('the site from a link, and about what the label costs', () => {
  assert.deepEqual(['https://www.ebay.com/itm/1', 'https://shopgoodwill.com/item/2', 'https://hibid.com/lot/3', 'https://www.govdeals.com/x', 'https://www.bestbuy.com/site/x', 'https://example.com', 'nope'].map(siteOf), ['ebay', 'shopgoodwill', 'auction', 'auction', 'store', null, null]);
  assert.equal(shipGuess('RTX 3070 Founders Edition'), 15);
  assert.equal(shipGuess('TI-84 Plus CE calculator'), 8);
  assert.equal(shipGuess('a thing', 13), 13);
});

test('misspellings: brands\' usual wrong spellings first, then typing slips, as eBay OR lists', () => {
  const m = misspellings('Milwaukee M18 impact driver');
  assert.equal(m[0].word, 'milwaukee');
  assert.match(m[0].q, /^\(milwalkee, milwaukie, milwakee, .*\) m18 impact driver$/);
  assert.ok(m[0].q.length <= 100);
  assert.ok(m.length <= 2);
  assert.ok(slips('nintendo').includes('nitnendo'));   // two letters swapped
  assert.ok(slips('steeler').includes('steler'));      // a doubled letter dropped
  assert.deepEqual(slips('rtx'), []); assert.deepEqual(slips('3070'), []);
  assert.deepEqual(misspellings('RTX 3070'), []);   // nothing to misspell
  assert.match(misspellings('Nintendo Switch OLED')[0].q, /^\(nintedo, nitendo, .*\) switch oled$/);
});
