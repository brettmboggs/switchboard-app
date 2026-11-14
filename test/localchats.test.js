// Past Local AI chats (lib/localchats.js): the history is the chat files, so a
// chat stays listed until deleted or 30 days old, whatever happens to its
// session; named by the first thing said; Delete all takes only past ones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, utimesSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-localchats-'));
process.env.HOME = process.env.USERPROFILE = mkdtempSync(join(tmpdir(), 'sb-localchats-home-'));
const { db } = await import('../lib/db.js');
const { LOCAL_CHATS } = await import('../lib/terminals.js');
const { titleFrom, listChats, sweepChats, deleteChats } = await import('../lib/localchats.js');

mkdirSync(LOCAL_CHATS, { recursive: true });
const line = (type, text) => JSON.stringify({ type, message: type === 'user' ? { role: 'user', content: text } : { role: 'assistant', content: [{ type: 'text', text }] } });
// A chat file, and optionally a session open on it.
function chat(name, text, { daysOld = 0, open = null } = {}) {
  const file = join(LOCAL_CHATS, name + '.jsonl');
  writeFileSync(file, [line('user', text), line('assistant', 'Hi')].join('\n') + '\n');
  const t = (Date.now() - daysOld * 86400e3) / 1000; utimesSync(file, t, t);
  if (open) db.prepare("INSERT OR REPLACE INTO terms (id, name, cwd, space, created_at, agent, chat) VALUES (?, 'Local AI chat', ?, 'personal', ?, 'engine', ?)").run(open, LOCAL_CHATS, Date.now(), file);
  return file;
}
const titles = () => listChats().map((c) => c.title);

test('a chat is named by its first message, without picture paths', () => {
  assert.equal(titleFrom(line('user', 'What is this?\n/home/me/pic.png') + '\n'), 'What is this?');
  assert.equal(titleFrom(line('assistant', 'x')), null);
});

test('an ended chat stays listed even when a new chat takes its session name (the Nov 13 bug)', () => {
  chat('first', 'Whats one good book', { open: 'sb-ai-chat' });
  db.prepare("UPDATE terms SET ended_at = 1 WHERE id = 'sb-ai-chat'").run();
  chat('second', 'Another question', { open: 'sb-ai-chat' });   // the record is replaced
  assert.ok(titles().includes('Whats one good book'));
  assert.equal(listChats().find((c) => c.title === 'Another question').open, true);
  assert.equal(listChats().find((c) => c.title === 'Whats one good book').open, false);
});

test('past chats clear after 30 days, never one that is open', () => {
  const old = chat('old', 'Old one', { daysOld: 31 });
  const oldOpen = chat('old-open', 'Old but open', { daysOld: 31, open: 'sb-ai-chat-9' });
  sweepChats();
  assert.ok(!existsSync(old));
  assert.ok(existsSync(oldOpen));
});

test('Delete takes one; Delete all takes past ones only', async () => {
  chat('past-a', 'Past A'); chat('past-b', 'Past B');
  assert.equal(await deleteChats({ id: 'past-a.jsonl' }), 1);
  assert.ok(!titles().includes('Past A'));
  await deleteChats({ all: true });
  assert.ok(!titles().includes('Past B'));
  assert.ok(titles().includes('Another question') && titles().includes('Old but open'));
});

test('Chat view finds a Local AI chat by its kept log', async () => {
  const { termRow, transcriptOf } = await import('../lib/chatview.js');
  const f = chat('kept', 'Chat view', { open: 'sb-ai-chat-7' });
  assert.equal(transcriptOf(termRow('sb-ai-chat-7')).file, f);
});
