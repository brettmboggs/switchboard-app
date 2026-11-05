// Reading an agent's question off its screen (lib/agentmenu.js), so the Chat
// view can show it as buttons. The screens are shaped like Claude Code's
// (checked against a real one, Nov 3 2026); the paths and commands are made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMenu, keysFor, menuSig } from '../lib/agentmenu.js';

const RULE = '─'.repeat(90), DASH = '╌'.repeat(90);
const screen = (...lines) => [...lines, '', '', '', ''].join('\n');   // tmux pads with empty rows

const PERMISSION = screen(
  ' ▐▛███▜▌   Claude Code',
  '❯ Save the date in a file',
  '● Writing the date to when.txt',
  '  ⎿  $ date > when.txt',
  RULE,
  ' Bash command',
  ' Tip: auto mode handles these prompts for you — choose "switch to auto mode" below',
  ' Write the date to when.txt',
  DASH,
  ' date > when.txt',
  DASH,
  ' Do you want to proceed?',
  ' ❯ 1. Yes',
  '   2. Yes, and always allow access to /home/sam/projects/garden-planner from',
  '      this project',
  '   3. Yes, and switch to auto mode · auto mode handles these prompts for you',
  '   4. No',
  ' Esc to cancel · Tab to amend');

test('a permission prompt: title, command, question and every choice', () => {
  const m = parseMenu(PERMISSION);
  assert.equal(m.title, 'Bash command');
  assert.deepEqual(m.lines, [{ t: 'Write the date to when.txt', code: false }, { t: 'date > when.txt', code: true }]);
  assert.equal(m.question, 'Do you want to proceed?');
  assert.deepEqual(m.options.map((o) => o.n), [1, 2, 3, 4]);
  assert.equal(m.options[1].label, 'Yes, and always allow access to /home/sam/projects/garden-planner from this project');
  assert.equal(m.options[3].label, 'No');
  assert.equal(m.at, 0);
  assert.match(m.sig, /^[0-9a-f]{16}$/);
});

test('choices without numbers, the cursor not on the first one', () => {
  const m = parseMenu(screen(
    RULE,
    ' Accessing workspace:',
    ' /home/sam/projects/garden-planner',
    ' Quick safety check: Is this a project you created or one you trust?',
    ' ❯ No, exit',
    '   Yes, I trust this folder',
    ' Enter to confirm · Esc to cancel'));
  assert.deepEqual(m.options, [{ label: 'No, exit', n: null }, { label: 'Yes, I trust this folder', n: null }]);
  assert.equal(m.title, 'Accessing workspace:');
  assert.equal(m.question, 'Quick safety check: Is this a project you created or one you trust?');
  assert.deepEqual(keysFor(m, 1), ['Down', 'Enter']);
});

test('the older boxed style', () => {
  const m = parseMenu(screen(
    '╭' + '─'.repeat(60) + '╮',
    '│ Edit file                                                  │',
    '│ Do you want to make this edit to notes.md?                 │',
    '│ ❯ 1. Yes                                                   │',
    '│   2. No, and tell Claude what to do differently (esc)      │',
    '╰' + '─'.repeat(60) + '╯',
    '   Esc to cancel'));
  assert.ok(m, 'read the boxed prompt');
  assert.deepEqual(m.options.map((o) => o.label), ['Yes', 'No, and tell Claude what to do differently (esc)']);
  assert.equal(m.question, 'Do you want to make this edit to notes.md?');
});

test('the ordinary prompt, idle or working, is not a question', () => {
  assert.equal(parseMenu(screen(RULE, '❯ ', RULE, '  ⏵⏵ auto mode on (shift+tab to cycle)')), null);
  assert.equal(parseMenu(screen('✶ Thinking… (12s · esc to interrupt)', RULE, '❯ ', RULE)), null);
  assert.equal(parseMenu(''), null);
  assert.equal(parseMenu(null), null);
});

test('a list in the agent\'s reply is not a question without a cursor and a footer', () => {
  assert.equal(parseMenu(screen('● Two ways to do it:', '   1. Rename the file', '   2. Copy it', RULE, '❯ ', RULE)), null);
  // A footer but no ❯ on any choice: not read as a question.
  assert.equal(parseMenu(screen('   1. Rename the file', '   2. Copy it', ' Esc to cancel')), null);
});

test('keys move up or down to the choice, then Enter', () => {
  const m = { ...parseMenu(PERMISSION), at: 2 };
  assert.deepEqual(keysFor(m, 0), ['Up', 'Up', 'Enter']);
  assert.deepEqual(keysFor(m, 2), ['Enter']);
  assert.deepEqual(keysFor(m, 3), ['Down', 'Enter']);
});

test('the sig changes with the question, not with where the cursor is', () => {
  const a = parseMenu(PERMISSION);
  const moved = parseMenu(PERMISSION.replace(' ❯ 1. Yes', '   1. Yes').replace('   2. Yes, and always', ' ❯ 2. Yes, and always'));
  assert.equal(moved.at, 1);
  assert.equal(moved.sig, a.sig);
  assert.notEqual(menuSig({ ...a, question: 'Do you want to delete it?' }), a.sig);
});

// The model picker (/model), as Claude Code v2.1 drew it in a 160-column tmux
// session on Nov 4 2026 (costs and the folder changed): two columns further in
// than a permission prompt, under a ▔ rule, each choice with a description after
// a run of spaces, ↓ on the last choice shown, "… +4 models" under it, and the
// effort line between the choices and the footer.
const MODEL_PICKER = screen(
  ' ▐▛███▜▌   Claude Code v2.1.318',
  '▝▜█████▀  Opus 5.5 with medium effort · Claude Ultra',
  ' ▝▝   ▝▝   /home/sam/projects/garden-planner · /rc',
  '',
  '',
  '▔'.repeat(60) + " tmux detected · scroll with PgUp/PgDn · or add 'set -g mouse on' to ~/.tmux.conf for wheel scroll ▔",
  '   Select model',
  '   Switch between Claude models. Your pick becomes the default for new sessions. For other/previous model names, specify with --model.',
  '     1.  Default (recommended)  Opus 5.5 · Best for everyday, complex tasks',
  '   ❯ 2.  Opus 5.5 ✔             For complex work and everyday tasks',
  '     3.  Fable 5.1              For your toughest challenges',
  '     4.  Sonnet 5.5             Most efficient for simpler tasks',
  '     5.  Haiku 5.5              Fastest for quick answers',
  '     6.  Haiku 4.5              Fastest for quick answers',
  '     7.  Sonnet 5               Efficient for routine tasks',
  '     8.  Opus 5                 Best for everyday, complex tasks',
  '   ↓ 9.  Fable 5                Most capable for your hardest and longest-running tasks',
  '      … +4 models',
  '   ◐ Medium effort (default) ←/→ to adjust',
  '   Enter to set as default · s to use this session only · Esc to cancel');

test('the model picker: nine choices with their descriptions, the effort line as a note', () => {
  const m = parseMenu(MODEL_PICKER);
  assert.ok(m, 'read as a question');
  assert.equal(m.title, 'Select model');
  assert.equal(m.question, 'Switch between Claude models. Your pick becomes the default for new sessions. For other/previous model names, specify with --model.');
  assert.deepEqual(m.lines, []);
  assert.deepEqual(m.options.map((o) => o.n), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(m.options[0], { label: 'Default (recommended)', hint: 'Opus 5.5 · Best for everyday, complex tasks', n: 1 });
  assert.deepEqual(m.options[1], { label: 'Opus 5.5 ✔', hint: 'For complex work and everyday tasks', n: 2 });
  assert.deepEqual(m.options[8], { label: 'Fable 5', hint: 'Most capable for your hardest and longest-running tasks', n: 9 });
  assert.equal(m.at, 1);
  assert.deepEqual(m.notes, ['… +4 models', '◐ Medium effort (default) ←/→ to adjust']);
  assert.deepEqual(keysFor(m, 3), ['Down', 'Down', 'Enter']);
  // The effort line moves with ←/→; the question stays the same question.
  assert.equal(parseMenu(MODEL_PICKER.replace('◐ Medium effort (default)', '● High effort')).sig, m.sig);
});

// AskUserQuestion, from a real Claude Code 2.1 screen (Nov 4 2026): tabs, a
// description under each choice, "Chat about this" under a rule, tick boxes
// and a Submit row for several answers, and a review tab with no footer.
const ASK = {
 "askq1": "❯ Ask me two questions.\n  Keep it short.\n───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────\n←  ☐ Color  ☐ Toppings  ✔ Submit  →\n\nWhich color?\n\n❯ 1. Red\n     Warm\n  2. Blue\n     Cool\n  3. Type something.\n───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────\n  4. Chat about this\n\nEnter to select · Tab/Arrow keys to navigate · Esc to cancel",
 "askq2": "❯ Ask me two questions.\n  Keep it short.\n───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────\n←  ☒ Color  ☐ Toppings  ✔ Submit  →\n\nWhich toppings?\n\n❯ 1. [ ] Cheese\n         Cheese topping\n  2. [ ] Olives\n         Olives topping\n  3. [ ] Basil\n         Basil topping\n  4. [ ] Type something\n     Submit\n───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────\n  5. Chat about this\n\nEnter to select · Tab/Arrow keys to navigate · Esc to cancel",
 "askq3": "❯ Ask me two questions.\n  Keep it short.\n───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────\n←  ☒ Color  ☒ Toppings  ✔ Submit  →\n\nWhich toppings?\n\n  1. [✔] Cheese\n         Cheese topping\n  2. [ ] Olives\n         Olives topping\n  3. [ ] Basil\n         Basil topping\n  4. [ ] Type something\n❯    Submit\n───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────\n  5. Chat about this\n\nEnter to select · Tab/Arrow keys to navigate · ctrl+g to edit in VS Code · Esc to cancel",
 "askq4": "❯ Ask me two questions.\n  Keep it short.\n───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────\n←  ☒ Color  ☒ Toppings  ✔ Submit  →\n\nReview your answers\n\n ● Which color?\n   → Red\n ● Which toppings?\n   → Cheese\n\nReady to submit your answers?\n\n❯ 1. Submit answers\n  2. Cancel"
};
test('AskUserQuestion: one answer, with descriptions and the tabs', () => {
  const m = parseMenu(ASK.askq1);
  assert.equal(m.question, 'Which color?');
  assert.deepEqual(m.tabs.map((t) => [t.label, t.done, t.submit]), [['Color', false, false], ['Toppings', false, false], ['Submit', false, true]]);
  assert.deepEqual(m.options.map((o) => [o.label, o.hint || '']), [['Red', 'Warm'], ['Blue', 'Cool'], ['Type something.', ''], ['Chat about this', '']]);
  assert.equal(m.multi, false); assert.equal(m.at, 0);
});
test('AskUserQuestion: several answers, tick boxes and the Submit row', () => {
  const m = parseMenu(ASK.askq2);
  assert.equal(m.multi, true); assert.equal(m.tabs[0].done, true);
  assert.deepEqual(m.options.map((o) => o.label), ['Cheese', 'Olives', 'Basil', 'Type something', 'Submit', 'Chat about this']);
  assert.equal(m.options[4].submit, true); assert.equal(m.options[0].checked, false);
  const ticked = parseMenu(ASK.askq3);
  assert.equal(ticked.options[0].checked, true); assert.equal(ticked.at, 4);
  assert.deepEqual(keysFor(ticked, 0), ['Up', 'Up', 'Up', 'Up', 'Enter']);
});
test('AskUserQuestion: the review tab reads without a footer', () => {
  const m = parseMenu(ASK.askq4);
  assert.equal(m.question, 'Ready to submit your answers?');
  assert.deepEqual(m.options.map((o) => o.label), ['Submit answers', 'Cancel']);
  assert.ok(m.lines.some((l) => l.t === '→ Cheese'));
});
