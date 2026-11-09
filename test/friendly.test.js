// Errors in plain words (lib/friendly.js): system and network errors become a
// sentence with what to do; Switchboard's own messages pass through.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { friendlyError } from '../lib/friendly.js';

test('network and system errors say what happened and what to do', () => {
  assert.match(friendlyError(Object.assign(new Error('getaddrinfo ENOTFOUND api.example.com'), { code: 'ENOTFOUND' }), 'Todoist'), /Could not find todoist on the internet\. Check that this computer is online/);
  assert.match(friendlyError(new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }), 'the calendar'), /^The calendar turned the connection away/);
  assert.match(friendlyError(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }), 'the site'), /took too long to answer/);
  assert.match(friendlyError(new Error('certificate has expired'), 'the site'), /certificate was not accepted/);
  assert.match(friendlyError(Object.assign(new Error('x'), { code: 'ENOSPC' })), /disk is full/);
  assert.match(friendlyError('503', 'Microsoft'), /Microsoft is having trouble right now \(it answered 503\)/);
  assert.match(friendlyError(new SyntaxError('Unexpected end of JSON input'), 'the weather service'), /not what Switchboard expected/);
});

test('messages Switchboard wrote itself pass through', () => {
  const own = 'That link is a web page, not a calendar. Use the iCal or ICS address.';
  assert.equal(friendlyError(new Error(own), 'the calendar'), own);
  assert.equal(friendlyError(null), 'Something went wrong, with no more detail than that.');
});

test('fetch failed, programs that failed and missing files say so without code', () => {
  assert.equal(friendlyError(new TypeError('fetch failed'), 'the feed'), 'Could not reach the feed. Check that this computer is online, then try again.');
  const git = Object.assign(new Error('Command failed: git init -b main\nfatal: something odd'), { code: 128 });
  assert.equal(friendlyError(git), 'Git could not finish what Switchboard asked of it. Try again; if it keeps happening, ask for help.');
  assert.match(friendlyError(new Error('Command failed: /usr/bin/gh repo create x\nHTTP 401: Bad credentials')), /^The GitHub tool is not signed in/);
  assert.match(friendlyError(new Error('Command failed: git fetch\nfatal: unable to access: Could not resolve host: github.com')), /^Git could not reach the internet/);
  assert.doesNotMatch(friendlyError(git), /init|-b|fatal/);
  assert.match(friendlyError(Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' })), /^The GitHub tool is not installed on this computer/);
  assert.match(friendlyError(Object.assign(new Error("ENOENT: no such file or directory, open '/home/sam/x.json'"), { code: 'ENOENT', path: '/home/sam/x.json' })), /^A file or program Switchboard needs is missing/);
  const denied = friendlyError(Object.assign(new Error("EACCES: permission denied, open '/home/sam/.local/share/switchboard/x'"), { code: 'EACCES', path: '/home/sam/.local/share/switchboard/x' }));
  assert.match(denied, /not allowed to read or write a file it needs/);
  assert.doesNotMatch(denied, /\/home/);
});
