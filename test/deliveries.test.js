// Deliveries: shipping emails (cases taken from real ones) become packages with
// a status, a day and a tracking link; emails about one package are merged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-ship-'));
const { readShipment, buildShipments } = await import('../lib/deliveries.js');

const MON = new Date(2026, 10, 2, 8, 0).getTime();   // Mon Nov 2 2026, 8am
const h = 3600e3;
let n = 0;
const mail = (from_addr, from_name, subject, snippet = '', date = MON) => ({ account: 'me@x.com', msg_id: 'm' + ++n, thread_id: 't' + n, from_addr, from_name, subject, snippet, date });
const fedex = (subject, date) => mail('trackingupdates@fedex.com', 'FedEx', subject, 'FedEx body .showonmobile { display: none; }', date);
const pets = (subject, snippet, date) => mail('service@pawpantry.com', 'PawPantry.com', subject, snippet, date);

test('FedEx: status and tracking number from the subject', () => {
  const s = readShipment(fedex('Your shipment is scheduled for delivery tomorrow 612345678901'));
  assert.equal(s.status, 'shipped'); assert.equal(s.tracking, '612345678901'); assert.equal(s.carrier, 'FedEx');
  assert.equal(s.eta, new Date(2026, 10, 3, 9, 0).getTime());
  assert.equal(readShipment(fedex('Your shipment is out for delivery today 612345678901')).status, 'out');
  assert.equal(readShipment(fedex('Your shipment was delivered 612345678901')).status, 'delivered');
  assert.equal(readShipment(fedex('Your shipment is on the way 612345678901')).status, 'shipped');
});

test('A pet shop: shipped with an order number, out today with a window, delivered', () => {
  const a = readShipment(pets('Your order is on the way!', 'We shipped your order #7310000017.'));
  assert.deepEqual([a.status, a.order, a.shop], ['shipped', '7310000017', 'PawPantry']);
  const b = readShipment(pets('Your Autoship package will arrive today between 11 am and 3 pm', "It's almost here! Your package is out for delivery."));
  assert.deepEqual([b.status, b.window], ['out', '11 am–3 pm']);
  assert.equal(readShipment(pets('Your Autoship order was delivered', 'Delivery day means they’re all set.')).status, 'delivered');
  assert.equal(readShipment(pets("We're getting your Autoship order ready", '')), null);
  assert.equal(readShipment(pets('Time to review your Autoship order', '')), null);
});

test('ready for pickup, with the order number at the end of the subject', () => {
  const s = readShipment(mail('order@orders.hardwarebarn.com', 'Hardware Barn', 'Your Order is Ready for Pick Up - HBRN40917726'));
  assert.deepEqual([s.status, s.order, s.shop], ['pickup', 'HBRN40917726', 'Hardware Barn']);
  assert.equal(readShipment(mail('no-reply@pickupnow.com', 'Green Leaf', 'Your Green Leaf - Fairhaven Springs order is ready for pickup!', 'Order #: 613920457 $41.18')).order, '613920457');
});

test('Amazon and UPS', () => {
  const a = readShipment(mail('shipment-tracking@amazon.com', 'Amazon.com', 'Shipped: "Hoof trimmers, stainless..."', 'Arriving Thursday. Track package TBA123456789012'));
  assert.deepEqual([a.status, a.item, a.tracking, a.shop], ['shipped', 'Hoof trimmers, stainless', 'TBA123456789012', 'Amazon']);
  assert.equal(a.eta, new Date(2026, 10, 5, 9, 0).getTime());
  const u = readShipment(mail('mcinfo@ups.com', 'UPS', 'UPS Update: Package Scheduled for Delivery Wednesday, 11/04/2026', 'Tracking Number: 1Z999AA10123456784'));
  assert.deepEqual([u.status, u.tracking, u.carrier], ['shipped', '1Z999AA10123456784', 'UPS']);
  assert.equal(readShipment(mail('auto-reply@usps.com', 'USPS', 'USPS® Delivery Exception for 9400100000000000000017')).status, 'delayed');
});

test('not packages: GitHub, new arrivals, Informed Delivery digests, prescriptions, receipts', () => {
  assert.equal(readShipment(mail('notifications@github.com', 'GitHub', '[acme/mobile-app] Run failed: ship OTA')), null);
  assert.equal(readShipment(mail('notifications@github.com', 'GitHub', 'PR run failed: What arrived opens the delivery screen')), null);
  assert.equal(readShipment(mail('lenovo@ecomm.lenovo.com', 'Lenovo', 'Introducing our must-have new arrivals! 🔥')), null);
  assert.equal(readShipment(mail('uspsinformeddelivery@email.informeddelivery.usps.com', 'USPS', 'Your Daily Digest for Tue, 11/3 is ready to view')), null);
  assert.equal(readShipment(mail('noreply@petrx.example.com', 'PetRx', "Biscuit's prescription is ready for you to order.")), null);
  assert.equal(readShipment(mail('orders@starbucks.com', 'Starbucks', 'Success! Your Starbucks Card has been reloaded')), null);
  assert.equal(readShipment(mail('debbie@example.com', 'Debbie', 'Re: did the order arrive?', 'Not delivered yet, I think')), null);
});

test('one package across its emails; the latest news wins; delivered stays delivered', () => {
  const rows = [
    fedex('Your shipment is on the way 612345678901', MON),
    fedex('Your shipment is scheduled for delivery tomorrow 612345678901', MON + 2 * h),
    fedex('Your shipment is out for delivery today 612345678901', MON + 24 * h),
    fedex('Your shipment was delivered 612345678901', MON + 30 * h),
    fedex('Your shipment is on the way 612345678901', MON + 31 * h)   // a late, stale email
  ];
  const [p, ...rest] = buildShipments(rows, MON + 32 * h);
  assert.equal(rest.length, 0);
  assert.deepEqual([p.status, p.deliveredAt, p.name], ['delivered', MON + 30 * h, 'FedEx']);
  assert.match(p.url, /^https:\/\/www\.fedex\.com\/fedextrack\/\?trknbr=612345678901$/);
  // Delivered yesterday: gone today.
  assert.equal(buildShipments(rows, MON + 48 * h).length, 0);
});

test('a shop without numbers: emails a day apart are one package; a new order later is another', () => {
  const rows = [
    pets('Your order is on the way!', 'We shipped your order #7310000017.', MON),
    pets('Your Autoship package will arrive today between 10 am and 2 pm', 'out for delivery', MON + 26 * h),
    pets('Your Autoship order was delivered', '', MON + 30 * h)
  ];
  const all = buildShipments(rows, MON + 30.5 * h);
  assert.equal(all.length, 1);
  assert.deepEqual([all[0].status, all[0].window], ['delivered', '10 am–2 pm']);
  const later = [...rows, pets('Your order is on the way!', 'We shipped your order #7310000099.', MON + 50 * h)];
  const next = buildShipments(later, MON + 51 * h);
  assert.deepEqual(next.map((p) => [p.status, p.order]), [['shipped', '7310000099']]);
});

test('confirmations are not news; pickups fade after three days', () => {
  assert.equal(readShipment(mail('no-reply@pickupnow.com', 'Green Leaf', 'Your Green Leaf - Fairhaven Springs order has been confirmed', 'We will text you when it is ready for pickup')), null);
  const rows = [mail('order@orders.hardwarebarn.com', 'Hardware Barn', 'Your Order is Ready for Pick Up - HBRN40917726', '', MON)];
  assert.equal(buildShipments(rows, MON + 2 * 86400e3).length, 1);
  assert.equal(buildShipments(rows, MON + 4 * 86400e3).length, 0);
});

test('the shop and the courier about the same box: one package, tracked', () => {
  const rows = [
    pets('Your order is on the way!', 'We shipped your order #7310000042.', MON),
    fedex('Your shipment is on the way 612345678901', MON + 8 * h),
    fedex('Your shipment is out for delivery today 612345678901', MON + 24 * h),
    pets('Your Autoship package will arrive today between 10 am and 2 pm', 'out for delivery', MON + 24 * h + 15e3)
  ];
  // Before the day, two different shipped emails are not guessed into one (they may be two boxes).
  assert.equal(buildShipments(rows.slice(0, 2), MON + 12 * h).length, 2);
  const all = buildShipments(rows, MON + 25 * h);
  assert.equal(all.length, 1);
  assert.deepEqual([all[0].status, all[0].name, all[0].from, all[0].window, all[0].tracking], ['out', 'PawPantry', 'FedEx', '10 am–2 pm', '612345678901']);
  assert.ok(all[0].url.includes('612345678901'));
});

test('order: delayed, out for delivery, then arriving soonest, delivered last', () => {
  const rows = [
    mail('shipment-tracking@amazon.com', 'Amazon.com', 'Shipped: "Fence charger"', 'Arriving Friday', MON),
    mail('mcinfo@ups.com', 'UPS', 'UPS Update: Package Scheduled for Delivery Tomorrow', '1Z999AA10123456784', MON),
    pets('Your Autoship order was delivered', '', MON + h),
    fedex('Your shipment is out for delivery today 609876543210', MON + 2 * h)
  ];
  assert.deepEqual(buildShipments(rows, MON + 3 * h).map((p) => p.status), ['out', 'shipped', 'shipped', 'delivered']);
  assert.deepEqual(buildShipments(rows, MON + 3 * h).map((p) => p.name).slice(1, 3), ['UPS', 'Fence charger']);
  const late = [...rows, mail('auto-reply@usps.com', 'USPS', 'USPS Delivery Exception for 9400100000000000000017', '', MON + h)];
  assert.deepEqual(buildShipments(late, MON + 3 * h).map((p) => p.status), ['delayed', 'out', 'shipped', 'shipped', 'delivered']);
});
