// What a session is about, in the agent's own words. Claude Code sets the
// terminal's title to the work at hand ("Union city picker in Estimating"),
// with a status glyph in front; shells and tmux fall back to the computer's
// name or the program's. This keeps the first and drops the rest.
import { hostname } from 'node:os';

// The title a program sets: ESC ] 0 or 2 ; text, ended by BEL or ESC \\.
export const OSC_TITLE = /\x1b\](?:0|2);([^\x07\x1b]*)(?:\x07|\x1b\\)/g;

const HOST = hostname().split('.')[0].toLowerCase();
const PLAIN = /^(bash|zsh|sh|fish|pwsh|powershell|cmd(\.exe)?|tmux|node|claude|claude code|codex|gemini|aider)$/i;

export function cleanTitle(raw, host = HOST) {
  const t = String(raw || '').replace(/^[^\p{L}\p{N}]+/u, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!t || t.toLowerCase().split('.')[0] === host || PLAIN.test(t)) return '';
  return t;
}
