// The notebook's calculator (public/js/calc.js): sums people write in notes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const ctx = { module: { exports: {} } };
vm.runInNewContext(readFileSync(new URL('../public/js/calc.js', import.meta.url), 'utf8'), ctx);
const C = ctx.module.exports;
const ev = (s, vars) => { const r = C.evaluate(s, vars); return r ? C.format(r) : null; };

test('everyday sums', () => {
  assert.equal(ev('3 bags × $12.50'), '$37.50');
  assert.equal(ev('3 x 4'), '12');
  assert.equal(ev('2 + 3 * 4'), '14');
  assert.equal(ev('(2 + 3) * 4'), '20');
  assert.equal(ev('10 / 4'), '2.5');
  assert.equal(ev('2^10'), '1,024');
  assert.equal(ev('1,200 + 34.5'), '1,234.5');
  assert.equal(ev('15% of 80'), '12');
  assert.equal(ev('80 + 15%'), '92');
  assert.equal(ev('$100 - 20%'), '$80.00');
  assert.equal(ev('-5 + 2'), '-3');
  assert.equal(ev('1/3'), '0.333333');
  assert.equal(ev('0.1 + 0.2'), '0.3');
  assert.equal(ev('14 eggs times 3 days'), '42');
});

test('not maths', () => {
  for (const s of ['hello', 'call the bank', '', '3 +', '(2', '2 / 0', 'a = b']) assert.equal(ev(s), null, s);
});

test('a page: named numbers, = at the end, totals by section', () => {
  const lines = [
    { text: 'Fence', kind: 'heading' },
    { text: 't-posts 40 × $4.25 =', kind: 'text' },
    { text: 'wire = 2 × $89', kind: 'text' },
    { text: 'clips $12', kind: 'text' },
    { text: 'total =', kind: 'text' },
    { text: 'wire + total =', kind: 'text' },
    { text: '', kind: 'text' },
    { text: 'Posts every 8 ft along the north line', kind: 'text' },
    { text: 'gate = 250', kind: 'text' },
    { text: 'sum =', kind: 'text' }
  ];
  assert.deepEqual([...C.sheet(lines)], ['', '$170.00', '$178.00', '', '$360.00', '$538.00', '', '', '', '258']);
});
