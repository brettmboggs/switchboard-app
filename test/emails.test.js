// Emails Switchboard writes (lib/emails/): the invite. Branded, with a plain
// text part, the mark sent inside it, names escaped, and no address in the
// HTML that would be fetched or followed except the invite link itself (and
// the download page, for someone who has not installed Switchboard yet).
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.SWITCHBOARD_DATA = process.env.SWITCHBOARD_DATA || '/tmp/switchboard-test';
const { inviteEmail } = await import('../lib/emails/invite.js');
const { PRODUCT } = await import('../lib/product.js');

const link = 'https://sync.example.com/join#join?email=jordan%40example.com&t=' + 'a'.repeat(64) + '&p=Acme';

test('the invite: who, what, one orange button, the expiry, and a text part', () => {
  const m = inviteEmail({ inviterName: 'Sam', project: 'Acme', link, kinds: { pages: 'edit', tasks: 'see', repos: 'none' } });
  assert.equal(m.subject, 'Sam invited you to Acme on Switchboard');
  assert.match(m.html, /Sam invited you to Acme on Switchboard/);
  assert.match(m.html, /Join Acme on Switchboard/);
  assert.match(m.html, /background:#FF4F00/);
  assert.match(m.html, /14 days/);
  assert.match(m.html, /Pages and their checklists \(see and edit\)/);
  assert.match(m.html, /To-dos and reminders \(see\)/);
  assert.ok(!/code repos/.test(m.html), 'a kind they do not get is not listed');
  assert.match(m.text, /Join Acme on Switchboard: https:\/\/sync\.example\.com\/join#join/);
  assert.ok(!/<[a-z]/i.test(m.text), 'the text part is text');
  assert.equal(m.attachments[0].cid, 'switchboard-mark');
  assert.match(m.html, /src="cid:switchboard-mark"/);
});

test('no remote images or other links in the HTML', () => {
  const m = inviteEmail({ inviterName: 'Sam', project: 'Acme', link, kinds: { pages: 'edit' } });
  const urls = [...m.html.matchAll(/(?:https?:)?\/\/[^\s"'<>)]+/g)].map((x) => x[0].replace(/&amp;/g, '&'));
  for (const u of urls) assert.ok(u === link || u === PRODUCT.downloadUrl, u);
  assert.ok(!/<img[^>]+src="(?!cid:)/.test(m.html), 'every picture is inside the email');
  assert.ok(!/<link|@import|url\(/i.test(m.html), 'no stylesheets or fonts from anywhere');
});

test('names and projects are escaped', () => {
  const m = inviteEmail({ inviterName: '<b>Sam</b>', project: 'Acme "&" <Co>', link, kinds: {} });
  assert.ok(!m.html.includes('<b>Sam</b>'));
  assert.match(m.html, /&lt;b&gt;Sam&lt;\/b&gt;/);
  assert.match(m.html, /Acme &quot;&amp;&quot; &lt;Co&gt;/);
});
