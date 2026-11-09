// Files Switchboard keeps (a project's Files, a file added to a note): what
// the reader shows, and putting one somewhere else: another project (copy or
// move, never over a file already there) or a note (a picture shows in it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.SWITCHBOARD_DATA = mkdtempSync(join(tmpdir(), 'sb-kept-'));
const { setSetting } = await import('../lib/db.js');
const { putKept } = await import('../lib/routes/files.js');
const { describeKept } = await import('../lib/localfile.js');
const { listFiles, filePath, addFileCopy } = await import('../lib/projects.js');
const { newPage, getPage } = await import('../lib/pages.js');

setSetting('spaces', [{ id: 'personal', name: 'Personal' }, { id: 'ked', name: 'KED Detailing' }, { id: 'acme', name: 'Acme' }]);
const src = join(process.env.SWITCHBOARD_DATA, 'src');
writeFileSync(src + '.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]));
writeFileSync(src + '.md', '# Hi\nthere');
writeFileSync(src + '.pdf', '%PDF-1.4\n\0');

test('the reader: a picture, a PDF, text', () => {
  addFileCopy('ked', src + '.jpg', 'car.jpg');
  addFileCopy('ked', src + '.md', 'brief.md');
  addFileCopy('ked', src + '.pdf', 'quote.pdf');
  assert.equal(describeKept(filePath('ked', 'car.jpg'), 'car.jpg').kind, 'image');
  assert.equal(describeKept(filePath('ked', 'quote.pdf'), 'quote.pdf').kind, 'pdf');
  const md = describeKept(filePath('ked', 'brief.md'), 'brief.md');
  assert.equal(md.kind, 'markdown');
  assert.equal(md.text, '# Hi\nthere');
});

test('copy, move, and into a note', () => {
  const from = '/api/projects/ked/files/car.jpg';
  assert.deepEqual(putKept({ from, to: { project: 'acme' } }), { project: 'acme', name: 'car.jpg' });
  assert.deepEqual(putKept({ from, to: { project: 'acme' } }), { project: 'acme', name: 'car (2).jpg' });   // never over one already there
  assert.ok(existsSync(filePath('ked', 'car.jpg')), 'a copy leaves it where it was');
  assert.throws(() => putKept({ from, to: { project: 'ked' }, move: true }), /already in that project/);

  const p = newPage({ title: 'Job notes', body: '<p>Before</p>', space: 'ked' });
  const r = putKept({ from, to: { page: p.uid } });
  assert.equal(r.title, 'Job notes');
  assert.match(getPage(p.uid).body, /^<p>Before<\/p><p><img src="\/api\/files\/[a-f0-9]{12}--car\.jpg" alt="car\.jpg"><\/p>$/);

  // A note's picture into a project, then a move between projects.
  const inNote = getPage(p.uid).body.match(/src="([^"]+)"/)[1];
  assert.equal(putKept({ from: inNote, to: { project: 'personal' } }).name, 'car.jpg');
  putKept({ from: '/api/projects/ked/files/brief.md', to: { project: 'acme' }, move: true });
  assert.ok(!listFiles('ked').some((f) => f.name === 'brief.md'), 'moved out');
  assert.ok(listFiles('acme').some((f) => f.name === 'brief.md'), 'moved in');

  assert.throws(() => putKept({ from: '/api/projects/ked/files/..%2F..%2Fswitchboard.db', to: { project: 'acme' } }), /No such file/);
  assert.throws(() => putKept({ from, to: { page: 'nope' } }), /That note is gone/);
  assert.throws(() => putKept({ from: '/etc/passwd', to: { project: 'acme' } }), /no longer here/);
});

// An agent reads a note's pictures: the note as text (switchboard_notes, and
// what Send to session sends) names where each one is on this computer.
test('a picture in a note reaches an agent as its file on this computer', async () => {
  const { keptPaths } = await import('../lib/keptpaths.js');
  const { noteText } = await import('../lib/sorting.js');
  const { copyToAttachment, attachmentPath } = await import('../lib/attachments.js');
  const a = copyToAttachment(src + '.jpg', 'shot.jpg'), md = addFileCopy('ked', src + '.md', 'plan.md');
  const p = newPage({ title: 'Build', body: `<ul class="checklist"><li data-checked="false"><p><img src="/api/files/${a.id}" alt="shot.jpg">make pictures small</p></li></ul><p><a class="file-link" href="/api/projects/ked/files/${md}">${md}</a></p>`, space: 'ked' });
  const t = noteText(p.uid).text;
  assert.equal(t.split('\n')[0], `- [ ] [picture shot.jpg: '${attachmentPath(a.id)}'] make pictures small`);
  assert.match(t, new RegExp(`${md} \\[file: '${filePath('ked', md).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'\\]`));
  assert.equal(keptPaths('see [picture x: /api/files/000000000000--gone.png]'), 'see [picture x: /api/files/000000000000--gone.png]', 'a file not here is left as it was');
});
