// What an agent session did, in plain words. Claude Code's hooks speak in
// event names (UserPromptSubmit, SubagentStop) and some "prompts" are really
// messages from Claude Code itself, wrapped in tags (<task-notification>,
// <command-name>, <system-reminder>). The page shows none of that: this turns
// both into sentences. Used when a prompt is saved and again when it is shown,
// so rows saved before this existed read the same way.

const tagText = (s, tag) => (s.match(new RegExp(`<${tag}>([\\s\\S]*?)(?:</${tag}>|$)`)) || [])[1]?.trim() || '';

// A message the session received, as a person would say it.
export function plainPrompt(text) {
  let s = String(text || '');
  if (!s.includes('<') && !s.includes('[')) return s.trim();
  if (/<task-notification>/.test(s)) {
    const sum = tagText(s, 'summary').replace(/^Background command /, '').replace(/\s*(completed\s*)?\(exit code 0\)$/, '').replace(/\s+completed$/, '');
    const failed = /<status>\s*(failed|error|killed)/i.test(s) || /exit code [1-9]/.test(sum);
    return failed ? `A background job stopped${sum ? ': ' + sum : ''}` : `A background job finished${sum ? ': ' + sum : ''}`;
  }
  const cmd = tagText(s, 'command-name');
  if (cmd) { const args = tagText(s, 'command-args'); return `Ran the ${cmd.replace(/^\/?/, '/')} command${args ? ': ' + args : ''}`; }
  // Another session writing to this one, or a helper handing its work back.
  const from = s.match(/^\s*<cross-session-message[^>]*from-name="([^"]*)"/);
  if (from) return `Message from ${from[1] || 'another session'}: ${plainPrompt(s.replace(/^\s*<cross-session-message[^>]*>/, ''))}`;
  if (/^\s*<agent-message\b/.test(s)) return 'A helper handed back its work';
  const bash = tagText(s, 'bash-input');
  if (bash) return `Ran a command in the terminal: ${bash}`;
  s = s.replace(/<(system-reminder|local-command-stdout|local-command-stderr|local-command-caveat|bash-stdout|bash-stderr)>[\s\S]*?(<\/\1>|$)/g, ' ')
    .replace(/<\/?[a-z][a-z0-9_-]*(\s+[a-z][a-z0-9_-]*="[^"]*")*\s*\/?>/gi, ' ')
    .replace(/\[Image #\d+\]/g, '(a picture)')
    .replace(/\[Pasted text #\d+[^\]]*\]/g, '(pasted text)')
    .replace(/\s+/g, ' ').trim();
  return s || 'A message from Claude Code';
}

// One line of a session's timeline: what happened, then any detail.
const WORDS = {
  SessionStart: 'Session opened',
  SessionEnd: 'Session closed',
  UserPromptSubmit: 'You sent',
  PreToolUse: 'Asked you something',
  PostToolUse: 'Back at work',
  Stop: 'Finished its turn',
  SubagentStart: 'Started a helper',
  SubagentStop: 'A helper finished',
  HelpersDone: 'All helpers finished',
  PreCompact: 'Tidied its memory to keep going',
  PostModelSwitch: 'Changed model',
  Notification: 'Note from the session'
};
export function plainEvent(event, info) {
  let what = WORDS[event] || String(event || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
  let more = info ? plainPrompt(info) : '';
  if (event === 'Notification') {
    // The note itself says it best; "waiting for your input" is the session's turn ending.
    if (/waiting for your input/i.test(more)) { what = 'Waiting for you'; more = ''; }
    else if (more) { what = more.replace(/^Claude /, 'It '); more = ''; }
  }
  // A message from Claude Code itself (a background job ending, a command) is not from you.
  if (event === 'UserPromptSubmit' && /^\s*</.test(info || '')) { what = more; more = ''; }
  if (event === 'SubagentStart') more = more.replace(/^Helper: /, '');
  if (event === 'PostModelSwitch') more = more.replace(/^Model: /, '');
  if (event === 'PreToolUse') more = more.replace(/^Question: /, '');
  return { what, more };
}
