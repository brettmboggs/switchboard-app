import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.SWITCHBOARD_DATA = process.env.SWITCHBOARD_DATA || '/tmp/switchboard-test';
const { classify } = await import('../lib/gmail.js');

test('Google Voice text', () => {
  const c = classify({ subject: 'New text message from (312) 555-0142' }, '13125550142.12345@txt.voice.google.com', '(312) 555-0142', false, 'Are those prices yours?');
  assert.equal(c.kind, 'voice-text'); assert.equal(c.who, '(312) 555-0142');
});
test('Google Voice missed call and voicemail', () => {
  assert.equal(classify({ subject: 'New missed call from Jacob' }, 'voice-noreply@google.com', 'Google Voice', true, '').kind, 'voice-call');
  assert.equal(classify({ subject: 'New voicemail from (312) 555-0100' }, 'voice-noreply@google.com', 'Google Voice', true, '').kind, 'voice-mail');
});
test('card alert with amount and merchant', () => {
  const c = classify({ subject: 'Your $41.07 transaction with CLOUDFLARE' }, 'no.reply.alerts@chase.com', 'Chase', true, 'You made a $41.07 transaction with CLOUDFLARE on Nov 2, 2026.');
  assert.equal(c.kind, 'charge'); assert.equal(c.amount, 41.07); assert.equal(c.merchant, 'CLOUDFLARE');
});
test('receipt', () => {
  const c = classify({ subject: 'Your receipt from Anthropic #2231' }, 'invoice+statements@mail.anthropic.com', 'Anthropic, PBC', true, 'Amount paid $100.00');
  assert.equal(c.kind, 'receipt'); assert.equal(c.amount, 100);
});
test('newsletter is bulk, a person is not', () => {
  assert.equal(classify({ subject: 'This week in pottery' }, 'news@shop.com', 'Shop', true, '').bulk, true);
  assert.equal(classify({ subject: 'Re: testimonials' }, 'debbie@example.com', 'Debbie', false, 'Sounds good').bulk, false);
});
