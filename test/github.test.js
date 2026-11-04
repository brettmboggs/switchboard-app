import { test } from 'node:test';
import assert from 'node:assert/strict';
import { githubRepo, runState } from '../lib/github.js';

test('a folder\'s remote gives its GitHub repo', () => {
  assert.equal(githubRepo('git@github.com:brett/switchboard.git'), 'brett/switchboard');
  assert.equal(githubRepo('https://github.com/datum-ci/web.app'), 'datum-ci/web.app');
  assert.equal(githubRepo('ssh://git@github.com/x/y.git\n'), 'x/y');
  assert.equal(githubRepo('https://gitlab.com/a/b'), null);
  assert.equal(githubRepo(null), null);
});

test('runs get GitHub\'s colours', () => {
  assert.equal(runState({ status: 'in_progress' }), 'running');
  assert.equal(runState({ status: 'queued' }), 'queued');
  assert.equal(runState({ status: 'waiting' }), 'queued');
  assert.equal(runState({ status: 'completed', conclusion: 'success' }), 'success');
  assert.equal(runState({ status: 'completed', conclusion: 'timed_out' }), 'failure');
  assert.equal(runState({ status: 'completed', conclusion: 'cancelled' }), 'cancelled');
  assert.equal(runState({ status: 'completed', conclusion: 'skipped' }), 'skipped');
});
