// The app's updates (lib/update.js): the app reports what GitHub has, the page's
// click and Check for updates are handed back to it in the answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actAsAppForTests, appReport, applyUpdate, checkForUpdate, updateState } from '../lib/update.js';

actAsAppForTests();

test('an update the app found shows as Update ready, and a click goes back to the app', async () => {
  const r = appReport({ available: '9.9.9' });
  assert.equal(r.install, false);
  assert.equal(updateState().behind, 1);
  assert.deepEqual(updateState().subjects, ['Switchboard 9.9.9']);
  await applyUpdate();
  assert.equal(appReport({ available: '9.9.9' }).install, true);
  // Asked once: the next report does not install again.
  assert.equal(appReport({ available: '9.9.9' }).install, false);
});

test('automatic updates install only when the server says it is safe', () => {
  assert.equal(appReport({ available: '9.9.9' }, { autoOk: () => false }).install, false);
  assert.equal(appReport({ available: '9.9.9' }, { autoOk: () => true }).install, true);
  assert.equal(appReport({ available: null }, { autoOk: () => true }).install, false);
  assert.equal(updateState().behind, 0);
});

test('Check for updates waits for the app to ask GitHub again', async () => {
  appReport({ available: null });
  const pending = checkForUpdate();
  assert.equal(appReport({ available: null }).check, true);
  appReport({ available: '9.9.10' });
  const s = await pending;
  assert.equal(s.behind, 1);
});

test('a refusal says what happened in plain words, and nothing is installed', async () => {
  appReport({ available: null, error: 'network unreachable' });
  assert.match(updateState().error, /^Could not check GitHub for updates/);
  await assert.rejects(applyUpdate(), /already the newest/);
});
