// The Chat view across computers (lib/chatview.js): a reply sent over the relay
// is cut to fit its 1 MB limit by shortening long texts, never by leaving a
// message out, so the byte offsets for "new" and "earlier" stay right.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SWITCHBOARD_DATA ||= mkdtempSync(join(tmpdir(), 'sb-chatview-'));
const { fit } = await import('../lib/chatview.js');

test('a large chat reply is cut to fit, keeping every message and its offsets', () => {
  const messages = Array.from({ length: 60 }, (_, i) => ({ k: 'text', id: 'm' + i, t: 'x'.repeat(20000), input: i % 2 ? 'y'.repeat(3000) : undefined }));
  const out = fit({ file: 'f', start: 10, end: 999, messages }, 300 * 1024);
  assert.ok(JSON.stringify(out).length <= 300 * 1024);
  assert.equal(out.messages.length, 60);
  assert.equal(out.start, 10); assert.equal(out.end, 999);
  assert.ok(out.messages[0].t.endsWith(' …'));
});

test('a small chat reply is left alone', () => {
  const out = fit({ file: 'f', messages: [{ k: 'text', id: 'a', t: 'hello' }] }, 1024);
  assert.equal(out.messages[0].t, 'hello');
});
