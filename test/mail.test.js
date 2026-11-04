import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.SWITCHBOARD_DATA = process.env.SWITCHBOARD_DATA || '/tmp/switchboard-test';
const { byDomain, byMx, parseAutoconfig, domainOf } = await import('../lib/mailservers.js');
const { threadKey } = await import('../lib/gmail.js');

test('known providers by domain', () => {
  assert.equal(byDomain('icloud.com'), 'icloud');
  assert.equal(byDomain('me.com'), 'icloud');
  assert.equal(byDomain('yahoo.co.uk'), 'yahoo');
  assert.equal(byDomain('hotmail.com'), 'outlook');
  assert.equal(byDomain('gmail.com'), 'gmail');
  assert.equal(byDomain('example.com'), null);
  assert.equal(domainOf(' Sam@Example.COM '), 'example.com');
});

test('custom domains by their mail servers', () => {
  assert.equal(byMx(['aspmx.l.google.com.']), 'gmail');
  assert.equal(byMx(['mx01.mail.icloud.com']), 'icloud');
  assert.equal(byMx(['in1-smtp.messagingengine.com']), 'fastmail');
  assert.equal(byMx(['acme-com.mail.protection.outlook.com']), 'm365');
  assert.equal(byMx(['mail.acme.com']), null);
});

test('Thunderbird directory answer', () => {
  const xml = `<clientConfig><emailProvider id="gmx.com">
    <incomingServer type="pop3"><hostname>pop.gmx.com</hostname><port>995</port><socketType>SSL</socketType></incomingServer>
    <incomingServer type="imap"><hostname>imap.gmx.com</hostname><port>993</port><socketType>SSL</socketType></incomingServer>
    <outgoingServer type="smtp"><hostname>mail.gmx.com</hostname><port>587</port><socketType>STARTTLS</socketType></outgoingServer>
  </emailProvider></clientConfig>`;
  assert.deepEqual(parseAutoconfig(xml), { imap: { host: 'imap.gmx.com', port: 993 }, smtp: { host: 'mail.gmx.com', port: 587, secure: false } });
  assert.equal(parseAutoconfig('<clientConfig></clientConfig>'), null);
});

test('conversations group by the first message', () => {
  assert.equal(threadKey('<c@x>', '<b@x>', '<a@x> <b@x>'), 'a@x');
  assert.equal(threadKey('<b@x>', '<a@x>', ''), 'a@x');
  assert.equal(threadKey('<a@x>', '', ''), 'a@x');
});

test('forwarding services and Proton', () => {
  assert.equal(byMx(['route1.mx.cloudflare.net']), 'forward');
  assert.equal(byMx(['eforward1.registrar-servers.com']), 'forward');
  assert.equal(byMx(['mail.protonmail.ch']), 'proton');
  assert.equal(byDomain('proton.me'), 'proton');
});

// A stranger's email must never stall the server: the snippet cleaner once
// backtracked for hours on a body made of "{" and "a:" repeated.
test('snippet cleaning stays quick on hostile bodies', async () => {
  const { snippetOf } = await import('../lib/gmail.js');
  for (const body of ['{' + 'a:'.repeat(20000), 'x{'.repeat(20000), 'a{b:c;'.repeat(8000), '{'.repeat(40000) + ':']) {
    const t = Date.now();
    snippetOf({ text: body });
    assert.ok(Date.now() - t < 200, 'took ' + (Date.now() - t) + ' ms');
  }
  assert.equal(snippetOf({ text: 'Hi,\n.foo { color: red; margin: 0 } Your order shipped.\nbody{font:12px} {name} ok' }), 'Hi, Your order shipped. {name} ok');
});
