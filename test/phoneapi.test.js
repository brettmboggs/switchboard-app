// What the phone may ask of this computer's routes over the relay (lib/relay.js phoneAllowed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-phoneapi-'));
const { phoneAllowed } = await import('../lib/relay.js');

test('the phone can read the board and act on what the pages act on', () => {
  for (const p of ['/api/state', '/api/thread?key=x', '/api/conversation?key=a', '/api/terms/sb-x/chat?from=3', '/api/bring', '/api/system', '/api/calendar?from=1&to=2']) assert.ok(phoneAllowed('GET', p), p);
  for (const p of ['/api/capture', '/api/reply', '/api/items/4/done', '/api/terms/sb-x/queue', '/api/queue/9/release', '/api/pages', '/api/pages/0123456789abcdef01234567/delete', '/api/costs/3', '/api/github/run/1/rerun', '/api/checks', '/api/checks/remove', '/api/paste', '/api/calendar/event', '/api/calendar/event/delete', '/api/tasks/close']) assert.ok(phoneAllowed('POST', p), p);
});

test('never settings, the account, updates, windows, files or anything outside /api', () => {
  for (const [m, p] of [['POST', '/api/settings'], ['GET', '/api/settings'], ['POST', '/api/update'], ['POST', '/api/account/signin'], ['POST', '/api/microsoft/start'],
    ['POST', '/api/focus'], ['GET', '/api/windows'], ['GET', '/api/projects/x/files/secret.txt'], ['POST', '/api/projects/x/profile'],
    ['GET', '/hook/claude'], ['GET', '/'], ['GET', '/api/state/../settings'], ['DELETE', '/api/state'], ['POST', '/api/remote/abcd1234/x/queue'],
    ['POST', '/api/tasks/connect'], ['POST', '/api/tasks/disconnect'], ['POST', '/api/google/start'], ['POST', '/api/google/add'], ['POST', '/api/checks/signin'], ['POST', '/api/checks/signout'], ['POST', '/api/files']]) assert.equal(phoneAllowed(m, p), false, `${m} ${p}`);
});
