// Settings reach the board as the app stores them (JSON text): the board must
// keep real values, or the project list is a string and the page cannot draw.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { makeData } = await import('../public/js/web/data.js');

test('settings synced as JSON text become real values on the board', () => {
  const data = makeData();
  data.docs.settings.merge({ spaces: { v: JSON.stringify([{ id: 'a', name: 'Acme' }]), at: 5 }, note: { v: 'plain words', at: 5 } });
  assert.ok(Array.isArray(data.spaces()));
  assert.equal(data.spaces()[0].name, 'Acme');
  assert.equal(data.getSetting('note'), 'plain words');
});
