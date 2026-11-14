// Flips' radar for auction sites' alert emails (lib/flipmail.js).
import test from 'node:test';
import assert from 'node:assert/strict';
const { itemsFrom, sourceOf, SOURCES } = await import('../lib/flipmail.js');

test('the sender says which site it is', () => {
  assert.equal(sourceOf('alerts@shopgoodwill.com').id, 'shopgoodwill');
  assert.equal(sourceOf('noreply@email.hibid.com').id, 'hibid');
  assert.equal(sourceOf('someone@example.com'), null);
  for (const s of SOURCES) assert.ok(s.setup.startsWith('https://') && s.how, s.id);
});

test('an alert email reads as its items: link, the longest name, the price after it; menus and buttons are not items', () => {
  const html = `<table><tr><td><a href="https://shopgoodwill.com/item/111"><img src="x.jpg" alt="NVIDIA RTX 3070 Founders Edition 8GB"></a></td>
    <td><a href="https://shopgoodwill.com/item/111">NVIDIA RTX 3070 Founders Edition 8GB</a><br>Current Price: &#36;156.00</td><td><a href="https://shopgoodwill.com/item/111">Bid Now</a></td></tr>
    <tr><td><a href="https://shopgoodwill.com/item/222?utm=1">Steam Deck 256GB with case</a> <span>$210.50</span></td></tr>
    <tr><td><a href="https://shopgoodwill.com/saved-searches">Manage saved searches</a> <a href="https://shopgoodwill.com/unsubscribe">Unsubscribe</a></td></tr></table>`;
  const got = itemsFrom({ from: 'alerts@shopgoodwill.com', html });
  assert.deepEqual(got.map((x) => [x.url, x.name, x.price, x.site]), [
    ['https://shopgoodwill.com/item/111', 'NVIDIA RTX 3070 Founders Edition 8GB', 156, 'shopgoodwill'],
    ['https://shopgoodwill.com/item/222?utm=1', 'Steam Deck 256GB with case', 210.5, 'shopgoodwill']]);
});

test('links through a mail tracker: the item address inside them, or the named links with a price after them', () => {
  const wrapped = `<a href="https://click.example.net/t?u=${encodeURIComponent('https://hibid.com/lot/555/dewalt-drill')}&amp;x=1">DeWalt DCF887 impact driver</a> High bid $40`;
  assert.deepEqual(itemsFrom({ from: 'news@hibid.com', html: wrapped }).map((x) => [x.url, x.name, x.price]), [['https://hibid.com/lot/555/dewalt-drill', 'DeWalt DCF887 impact driver', 40]]);
  const opaque = `<a href="https://u1.ct.sendgrid.net/ls/click?upn=abc">Canon EF 50mm 1.8 STM lens</a> $35.00 <a href="https://u1.ct.sendgrid.net/ls/click?upn=def">View all results</a>`;
  assert.deepEqual(itemsFrom({ from: 'alerts@hibid.com', html: opaque }).map((x) => [x.name, x.price]), [['Canon EF 50mm 1.8 STM lens', 35]]);
  assert.deepEqual(itemsFrom({ from: 'x@example.com', html: opaque }), []);
});
