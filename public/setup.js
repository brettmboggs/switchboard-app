// The setup registry: every feature and connection Switchboard has, in one list.
//
// The welcome is built from it, and anyone who already finished the welcome sees
// entries added later as "New in Switchboard" on Now. So a new feature is never
// skipped: adding a feature or connection means adding its entry here.
// test/setup.test.js fails if a connection (a poller in lib/, or an agent) has none.
//
//   id      stable, never reused
//   kind    'connect' (something to sign in to or turn on) or 'feature' (something to know)
//   title   short name
//   why     one plain sentence: what it does for you
//   uses    which kinds of use it is for (see USES), or 'all'
//   done    (S) => true once it is set up (connect only)
//   open    where its setup lives: { pane, focus } in Settings, or { go: '#page' }
//   added   date it shipped (YYYY-MM-DD), for ordering "New in Switchboard"

window.USES = [
  { id: 'work', name: 'Work', blurb: 'Email, chats and meetings in one place', projects: [{ name: 'Work', color: '#2F5D8A' }] },
  { id: 'business', name: 'Small business', blurb: 'Customers, invoices and bills', projects: [{ name: 'Business', color: '#FF4F00' }, { name: 'Customers', color: '#8A6D1F', group: 'Clients' }] },
  { id: 'family', name: 'Family and home', blurb: 'Reminders, bills and messages for the household', projects: [{ name: 'Family', color: '#1F7A4D' }, { name: 'Home', color: '#0E7C86' }] },
  { id: 'homestead', name: 'Homestead', blurb: 'Animals, garden, chores and supplies', projects: [{ name: 'Homestead', color: '#8A6D1F' }, { name: 'Animals', color: '#B42318' }, { name: 'Garden', color: '#1F7A4D' }] },
  { id: 'code', name: 'Coding with AI', blurb: 'Claude, Codex and GitHub, without the tab juggling', projects: [{ name: 'Code', color: '#7A3E9D' }] }
];

const agentReady = (S, id) => !!(S.agents || []).find((a) => a.id === id && a.installed && a.signedIn);

window.SETUP = [
  // ---- connections
  { id: 'account', kind: 'connect', title: 'Switchboard account', why: 'Your setup on every computer you use, encrypted so only you can read it.', uses: 'all',
    done: (S) => !!S.account?.signedIn && !S.account.locked, open: { pane: 'accounts', focus: 'acct' }, added: '2026-11-01' },
  { id: 'projects', kind: 'connect', title: 'Your projects', why: 'Split things by business, client or part of life, so each shows in the right place.', uses: 'all',
    done: (S) => S.spaces.length > 1, open: { pane: 'projects' }, added: '2026-11-01' },
  { id: 'gmail', kind: 'connect', title: 'Gmail', why: 'Mail from people (not ads), sorted by project, with reply and archive.', uses: ['work', 'business', 'family', 'homestead'],
    done: (S) => S.status.gmail.length > 0, open: { pane: 'accounts', focus: 'gmail-add' }, added: '2026-11-01' },
  { id: 'email', kind: 'connect', title: 'Any email account', why: 'iCloud, Yahoo, Fastmail, work mail and more, next to Gmail: type the address and Switchboard finds the rest.', uses: ['work', 'business', 'family', 'homestead'],
    done: (S) => S.status.gmail.some((g) => g.kind === 'imap'), open: { pane: 'accounts', focus: 'gmail-add' }, added: '2026-11-03' },
  { id: 'calendars', kind: 'connect', title: 'Calendars', why: 'Today\'s events at the top of Now, and a heads-up ten minutes before each. Google, Outlook, iCloud, school and team calendars.', uses: 'all',
    done: (S) => (S.calendars || []).length > 0, open: { pane: 'accounts', focus: 'cal-card' }, added: '2026-11-03' },
  { id: 'weather', kind: 'connect', title: 'Weather', why: 'One line on Now, plus rain coming, frost tonight, and official warnings where you are.', uses: 'all',
    done: (S) => !!S.weather, open: { pane: 'look', focus: 'weather-field' }, added: '2026-11-03' },
  { id: 'webhooks', kind: 'connect', title: 'Webhooks', why: 'A private link that IFTTT, Zapier, Home Assistant, a phone shortcut or a script can use to put a note, a reminder or a "needs you" on your board.', uses: 'all',
    done: (S) => (S.webhooks || 0) > 0, open: { pane: 'accounts', focus: 'hook-card' }, added: '2026-11-03' },
  { id: 'microsoft', kind: 'connect', title: 'Teams and Outlook', why: 'Work chats and mail; reply without opening Teams.', uses: ['work', 'business'],
    done: (S) => !!S.status.microsoft?.connected, open: { pane: 'accounts', focus: 'ms-card' }, added: '2026-11-01' },
  { id: 'github', kind: 'connect', title: 'GitHub', why: 'Pull requests to review and builds that failed.', uses: ['code'],
    done: (S) => S.status.github.ok === true, open: { pane: 'accounts', focus: 'dev-cards' }, added: '2026-11-01' },
  { id: 'claude', kind: 'connect', title: 'Claude Code', why: 'See which sessions need you, and run them inside Switchboard.', uses: ['code'],
    done: (S) => !!S.status.hooks, open: { pane: 'accounts', focus: 'dev-cards' }, added: '2026-11-01' },
  { id: 'codex', kind: 'connect', title: 'ChatGPT (Codex)', why: 'OpenAI\'s coding agent, signed in with your ChatGPT plan.', uses: ['code'],
    done: (S) => agentReady(S, 'codex'), open: { pane: 'accounts', focus: 'dev-cards' }, added: '2026-11-03' },
  { id: 'browser-checks', kind: 'connect', title: 'Browser checks', why: 'A project\'s Playwright tests, or a page that has to load and show the right text, run in a browser with no window that closes after each run, on a click or every hour or day. A failure is a Needs-you card with the failing tests and screenshots. Run node scripts/setup.mjs browser once to install it and give your agents the same browser.', uses: ['code'],
    done: (S) => (S.checks || []).length > 0, open: { go: '#checks' }, added: '2026-11-03' },
  { id: 'gemini', kind: 'connect', title: 'Gemini', why: 'Google\'s coding agent, signed in with your Google account.', uses: ['code'],
    done: (S) => agentReady(S, 'gemini'), open: { pane: 'accounts', focus: 'dev-cards' }, added: '2026-11-03' },

  // ---- features worth knowing
  { id: 'notebook', kind: 'feature', title: 'Notebook', why: 'Notes, Pages: write with a formatting bar like an email (headings, bold, bullets, checklists). End a line with = for the answer; "shopping eggs" in Ctrl K adds to your Shopping list; "log eggs 14" keeps a running total.', uses: 'all', open: { go: '#notes' }, added: '2026-11-03' },
  { id: 'routines', kind: 'feature', title: 'Chores and routines', why: 'Things that come back on their own: "feed the animals every day at 6am and 6pm", "filter every 90 days". They show on Now when due; Done sets the next one. Notes has ideas to pick from.', uses: 'all', open: { go: '#notes' }, added: '2026-11-03' },
  { id: 'deliveries', kind: 'feature', title: 'Packages', why: 'Shipping emails become one line each on Now: arriving Thursday, out for delivery 10 to 2, delivered, or delayed. Click one to track it.', uses: 'all', open: { go: '#now' }, added: '2026-11-03' },
  { id: 'conversations', kind: 'feature', title: 'Conversations, like Teams', why: 'Pick a conversation in Inbox and it opens large beside the list, live: new Teams messages show within seconds, your reply shows the moment you send it, and nothing jumps while you read.', uses: ['work', 'business', 'family'], open: { go: '#inbox' }, added: '2026-11-03' },
  { id: 'desktop-app', kind: 'feature', title: 'Switchboard as an app', why: 'Download it, double-click, and Switchboard has its own icon and window, sits in the tray when closed, starts at login and updates itself. No terminal, no browser.', uses: 'all', open: { go: '#now' }, added: '2026-11-03' },
  { id: 'capture', kind: 'feature', title: 'Type it once', why: 'Ctrl K, then "remind me to call Sam at 3", "bill rent 1200 on the 1st" or "note gate code 4411".', uses: 'all', open: { go: '#now' }, added: '2026-11-01' },
  { id: 'voice', kind: 'feature', title: 'Talk to type', why: 'Click the mic next to any message box and talk. Enter stops, Enter again sends.', uses: 'all', open: { pane: 'look' }, added: '2026-11-03' },
  { id: 'theme', kind: 'feature', title: 'Dark theme and text size', why: 'Settings, General: light or dark, and bigger text if you like.', uses: 'all', open: { pane: 'look' }, added: '2026-11-03' },
  { id: 'everywhere', kind: 'feature', title: 'Sessions on every computer', why: 'Sign in on each computer and every session shows on all of them.', uses: ['code'], open: { go: '#sessions' }, added: '2026-11-02' },
  { id: 'actions', kind: 'feature', title: 'GitHub Actions, live', why: 'Sessions, Builds shows every run as it goes: yellow while it runs, green passed, red failed. Each session shows its own repo\'s runs too.', uses: ['code'], open: { go: '#builds' }, added: '2026-11-03' },
  { id: 'mcp', kind: 'feature', title: 'Your agents can use Switchboard', why: 'Claude, Codex and Gemini get Switchboard\'s tools: they can see what needs you and your builds, put a needs-you card on the board when they are blocked, and hand work to another session.', uses: ['code'], open: { go: '#sessions' }, added: '2026-11-03' },
  { id: 'session-tree', kind: 'feature', title: 'Sessions by repo, with your own names', why: 'Sessions sit together under the repo they work in. Double-click a tab (or Rename in the panel) to name it.', uses: ['code'], open: { go: '#sessions' }, added: '2026-11-03' },
  { id: 'bring-message', kind: 'feature', title: 'Bring one message into a session', why: 'On Sessions, Add brings in just that message with who sent it and when; the arrow shows earlier ones.', uses: ['code'], open: { go: '#sessions' }, added: '2026-11-03' },
  { id: 'session-chat', kind: 'feature', title: 'Chat view for sessions', why: 'Turn it on in Settings, General: a Claude session reads like a chat app (Chat or Terminal on its bar), with tool calls folded to one line and a card when it needs you. Also there: uncommitted files, ahead and behind, the pull request and its checks on each session, and terminals drawn by the graphics card.', uses: ['code'], open: { pane: 'look' }, added: '2026-11-03' },
  { id: 'images', kind: 'feature', title: 'Paste images to an agent', why: 'Paste or drop a screenshot into the message bar on Sessions.', uses: ['code'], open: { go: '#sessions' }, added: '2026-11-03' }
];
