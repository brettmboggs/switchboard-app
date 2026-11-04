// The slash commands a folder offers (lib/slash.js): skills and commands read
// from a temporary project and a temporary home, with made-up names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { slashCommands, frontMatter, forgetSlash } from '../lib/slash.js';

const root = mkdtempSync(join(tmpdir(), 'sb-slash-'));
const project = join(root, 'garden-planner'), home = join(root, 'home'), outside = join(root, 'elsewhere');
const skill = (base, name, text) => { mkdirSync(join(base, '.claude', 'skills', name), { recursive: true }); writeFileSync(join(base, '.claude', 'skills', name, 'SKILL.md'), text); };

skill(project, 'plant-check', '---\nname: plant-check\ndescription: Check the planting calendar for the week\n---\n# Plant check\n');
skill(project, 'quoted', `---\nname: "water-plan"\ndescription: 'Plan the watering, with "quotes" kept'\n---\n`);
skill(project, 'wrapped', '---\nname: harvest\ndescription: >\n  Pick what is ripe\n  and note it\nversion: 2\n---\nbody\n');
skill(project, 'bare', 'No front matter here.\n\nJust a first line.\n');
mkdirSync(join(project, '.claude', 'skills', 'nofile'));                 // a folder without SKILL.md is not a skill
mkdirSync(join(project, '.claude', 'commands'), { recursive: true });
writeFileSync(join(project, '.claude', 'commands', 'deploy.md'), '---\ndescription: Deploy to the greenhouse\n---\nRun the deploy.\n');
writeFileSync(join(project, '.claude', 'commands', 'notes.txt'), 'not a command');
writeFileSync(join(project, '.claude', 'commands', 'release.md'), 'Cut a release\nmore\n');
skill(home, 'tidy', '---\nname: tidy\ndescription: Tidy the desk\n---\n');
// A skill that is a symlink to somewhere outside the skills folder: never read.
mkdirSync(join(outside, 'secret'), { recursive: true });
writeFileSync(join(outside, 'secret', 'SKILL.md'), '---\nname: leaked\ndescription: should not show\n---\n');
symlinkSync(join(outside, 'secret'), join(project, '.claude', 'skills', 'linked'));
// A big file: only its first 4 KB are read, and the description still comes out.
skill(project, 'big', '---\nname: big\ndescription: Big one\n---\n' + 'x'.repeat(200000));

test.after(() => rmSync(root, { recursive: true, force: true }));

test('skills and commands from the project, then the person\'s skills', () => {
  const list = slashCommands(project, { home });
  const names = list.map((c) => c.name);
  assert.deepEqual(names, ['bare', 'big', 'plant-check', 'water-plan', 'harvest', 'deploy', 'release', 'tidy']);
  assert.deepEqual(list.find((c) => c.name === 'plant-check'), { name: 'plant-check', description: 'Check the planting calendar for the week', where: 'project' });
  assert.equal(list.find((c) => c.name === 'water-plan').description, 'Plan the watering, with "quotes" kept');
  assert.equal(list.find((c) => c.name === 'harvest').description, 'Pick what is ripe and note it');
  assert.equal(list.find((c) => c.name === 'bare').description, 'No front matter here.');
  assert.equal(list.find((c) => c.name === 'deploy').description, 'Deploy to the greenhouse');
  assert.equal(list.find((c) => c.name === 'release').description, 'Cut a release');
  assert.equal(list.find((c) => c.name === 'tidy').where, 'personal');
  assert.ok(!names.includes('leaked') && !names.includes('linked') && !names.includes('nofile') && !names.includes('notes'));
});

test('cached for 30 seconds per folder, then read again', () => {
  forgetSlash();
  const t0 = 1_000_000;
  const a = slashCommands(project, { home, now: t0 });
  skill(project, 'late', '---\nname: late\ndescription: Added after the first read\n---\n');
  assert.equal(slashCommands(project, { home, now: t0 + 10_000 }), a);
  assert.ok(slashCommands(project, { home, now: t0 + 31_000 }).some((c) => c.name === 'late'));
});

test('a folder with nothing gives an empty list, and at most 200 entries come back', () => {
  forgetSlash();
  const empty = join(root, 'empty'); mkdirSync(empty);
  assert.deepEqual(slashCommands(empty, { home: join(root, 'nohome') }), []);
  const many = join(root, 'many');
  for (let i = 0; i < 230; i++) skill(many, `s${String(i).padStart(3, '0')}`, `---\nname: s${i}\ndescription: number ${i}\n---\n`);
  assert.equal(slashCommands(many, { home: join(root, 'nohome') }).length, 200);
});

test('front matter: missing, Windows line ends, and a block description', () => {
  assert.deepEqual(frontMatter('# Title\n\nFirst real line\n'), { name: '', description: 'First real line' });
  assert.deepEqual(frontMatter('---\r\nname: x\r\ndescription: y\r\n---\r\nbody'), { name: 'x', description: 'y' });
  assert.equal(frontMatter('---\ndescription: |\n  one\n  two\n---\n').description, 'one two');
});
