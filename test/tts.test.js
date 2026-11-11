// The read-aloud voice (lib/tts.js): which Piper build each computer gets, where
// a voice is downloaded from, and what is handed to it to say. Nothing is
// downloaded or run here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-tts-'));
const { asset, voiceUrl, speakText, voiceStatus, VOICES, ROOT } = await import('../lib/tts.js');

test('the Piper build for each computer', () => {
  assert.equal(asset('linux', 'x64'), 'piper_linux_x86_64.tar.gz');
  assert.equal(asset('linux', 'arm64'), 'piper_linux_aarch64.tar.gz');
  assert.equal(asset('darwin', 'arm64'), 'piper_macos_aarch64.tar.gz');
  assert.equal(asset('darwin', 'x64'), 'piper_macos_x64.tar.gz');
  assert.equal(asset('win32', 'x64'), 'piper_windows_amd64.zip');
  assert.equal(asset('freebsd', 'x64'), null);
});

test('voices come from the Piper voice collection, and only the ones offered', () => {
  assert.equal(voiceUrl('en_GB-jenny_dioco-medium'), 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/jenny_dioco/medium/en_GB-jenny_dioco-medium.onnx');
  assert.throws(() => voiceUrl('../../evil'), /not one Switchboard offers/);
  assert.ok(VOICES.every((v) => voiceUrl(v.id).endsWith(v.id + '.onnx')));
});

test('what Piper is given to say, and nothing installed at first', () => {
  assert.equal(speakText('  Hello,\n\u0007 world  '), 'Hello, world');
  assert.equal(speakText('x'.repeat(5000)).length, 1500);
  const s = voiceStatus();
  assert.equal(s.installed, false);
  assert.equal(s.jarvis, false);
});

test('its own folder: Remove can never take talk-to-type\'s speech model (DATA_DIR/voice) with it', () => {
  assert.equal(ROOT, join(process.env.SWITCHBOARD_DATA, 'readaloud'));
});
