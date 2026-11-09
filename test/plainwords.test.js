import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plainPrompt, plainEvent } from '../lib/plainwords.js';

test('messages from Claude Code itself read as sentences, not tags', () => {
  assert.equal(plainPrompt('<task-notification><task-id>b1</task-id><status>completed</status><summary>Background command "npm test" completed (exit code 0)</summary></task-notification>'), 'A background job finished: "npm test"');
  assert.equal(plainPrompt('<task-notification> <task-id>b1</task-id> <output-file>/tmp/x/tasks/b…'), 'A background job finished');
  assert.equal(plainPrompt('<command-name>/compact</command-name><command-args></command-args>'), 'Ran the /compact command');
  assert.equal(plainPrompt('[Image #1] fix this <system-reminder>x</system-reminder>'), '(a picture) fix this');
  assert.equal(plainPrompt('<cross-session-message from="uds:/run/x.sock" from-name="core-bc" from-mode="prompting"> Plan approved'), 'Message from core-bc: Plan approved');
  assert.equal(plainPrompt('<agent-message from="a65"> [Subagent hand-back] The text below'), 'A helper handed back its work');
  assert.equal(plainPrompt('<pasted_content id="4151"> Sam said hi'), 'Sam said hi');
  assert.equal(plainPrompt('just words'), 'just words');
});

test('timeline events are everyday phrases', () => {
  assert.deepEqual(plainEvent('SubagentStop', null), { what: 'A helper finished', more: '' });
  assert.deepEqual(plainEvent('Notification', 'Claude is waiting for your input'), { what: 'Waiting for you', more: '' });
  assert.deepEqual(plainEvent('UserPromptSubmit', 'hello'), { what: 'You sent', more: 'hello' });
  assert.equal(plainEvent('UserPromptSubmit', '<task-notification><summary>x</summary>').what, 'A background job finished: x');
  assert.equal(plainEvent('SomethingNew', null).what, 'Something New');
});
