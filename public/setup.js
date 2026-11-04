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
//   open    where "Show me" goes: { pane, focus } in Settings, or { go: '#page', focus, hint },
//           or { cmd: true } for the command bar. focus is an element id to flash;
//           hint is a toast for when there is nothing on the page to point at yet
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
  { id: 'notebook', kind: 'feature', title: 'Notebook', why: 'Notes, Pages: write with a formatting bar like an email (headings, bold, bullets, checklists). End a line with = for the answer; "shopping eggs" in Ctrl K adds to your Shopping list; "log eggs 14" keeps a running total.', uses: 'all', open: { go: '#notes', hint: 'Pages is the first tab on Notes. New page starts one, or pick a template.' }, added: '2026-11-03' },
  { id: 'routines', kind: 'feature', title: 'Chores and routines', why: 'Things that come back on their own: "feed the animals every day at 6am and 6pm", "filter every 90 days". They show on Now when due; Done sets the next one. Notes has ideas to pick from.', uses: 'all', open: { go: '#notes', hint: 'The Routines tab on Notes has the ideas to pick from, or type one into Ctrl K.' }, added: '2026-11-03' },
  { id: 'deliveries', kind: 'feature', title: 'Packages', why: 'Shipping emails become one line each on Now: arriving Thursday, out for delivery 10 to 2, delivered, or delayed. Click one to track it.', uses: 'all', open: { go: '#now', hint: 'Packages show in the Today card at the top of Now as soon as a shipping email arrives.' }, added: '2026-11-03' },
  { id: 'conversations', kind: 'feature', title: 'Conversations, like Teams', why: 'Pick a conversation in Inbox and it opens large beside the list, live: new Teams messages show within seconds, your reply shows the moment you send it, and nothing jumps while you read.', uses: ['work', 'business', 'family'], open: { go: '#inbox', hint: 'Pick any conversation in the list and it opens here, large.' }, added: '2026-11-03' },
  { id: 'desktop-app', kind: 'feature', title: 'Switchboard as an app', why: 'Download it, double-click, and Switchboard has its own icon and window, sits in the tray when closed, starts at login and updates itself. No terminal, no browser.', uses: 'all', open: { go: '#now', hint: 'The app is on the Releases page of the Switchboard repository. This page keeps working as it is.' }, added: '2026-11-03' },
  { id: 'capture', kind: 'feature', title: 'Type it once', why: 'Ctrl K, then "remind me to call Sam at 3", "bill rent 1200 on the 1st" or "note gate code 4411".', uses: 'all', open: { cmd: true }, added: '2026-11-01' },
  { id: 'voice', kind: 'feature', title: 'Talk to type', why: 'Click the mic next to any message box and talk. Enter stops, Enter again sends.', uses: 'all', open: { pane: 'look' }, added: '2026-11-03' },
  { id: 'theme', kind: 'feature', title: 'Dark theme and text size', why: 'Settings, General: light or dark, and bigger text if you like.', uses: 'all', open: { pane: 'look' }, added: '2026-11-03' },
  { id: 'everywhere', kind: 'feature', title: 'Sessions on every computer', why: 'Sign in on each computer and every session shows on all of them.', uses: ['code'], open: { go: '#sessions', hint: 'Sign in on another computer (Settings, Accounts) and its sessions join the list on the right.' }, added: '2026-11-02' },
  { id: 'actions', kind: 'feature', title: 'GitHub Actions, live', why: 'Sessions, Builds shows every run as it goes: yellow while it runs, green passed, red failed. Each session shows its own repo\'s runs too.', uses: ['code'], open: { go: '#builds' }, added: '2026-11-03' },
  { id: 'mcp', kind: 'feature', title: 'Your agents can use Switchboard', why: 'Claude, Codex and Gemini get Switchboard\'s tools: they can see what needs you and your builds, put a needs-you card on the board when they are blocked, and hand work to another session.', uses: ['code'], open: { go: '#sessions', hint: 'Ask an agent "what needs me on Switchboard?". It has the tools after npm run setup.' }, added: '2026-11-03' },
  { id: 'session-tree', kind: 'feature', title: 'Sessions as lines, with your own names', why: 'Every session is one line on the right, under the repo it works in, named by what it is working on and saying what it is doing. Double-click a line (or More, Rename) to give it your own name; clear the name to go back.', uses: ['code'], open: { go: '#sessions', hint: 'Your sessions are the lines on the right, under the repo each works in.' }, added: '2026-11-03' },
  { id: 'bring-message', kind: 'feature', title: 'Bring one message into a session', why: 'The speech-bubble button beside the paperclip on Sessions lists recent messages: click one to add just that message with who sent it and when, or open Earlier for the rest of the conversation.', uses: ['code'], open: { go: '#sessions', focus: 'q-bring', hint: 'Open a session first: the speech-bubble button sits beside the paperclip under the message bar.' }, added: '2026-11-03' },
  { id: 'session-chat', kind: 'feature', title: 'Sessions read like a chat', why: 'A Claude session opens as a conversation with one message bar, like the Claude and ChatGPT apps. When Claude asks permission or offers choices, they show as buttons in the chat; write a message instead and it answers No and sends yours. While it works you see what it is doing. Prefer Claude\'s own terminal? Settings, Look, Sessions open in: Chat or Terminal; Chat | Terminal on a session switches just that one.', uses: ['code'], open: { pane: 'look' }, added: '2026-11-03' },
  { id: 'images', kind: 'feature', title: 'Paste images to an agent', why: 'Paste or drop a screenshot into the message bar on Sessions.', uses: ['code'], open: { go: '#sessions', focus: 'q-attach', hint: 'Open a session first: the paperclip under the message bar adds an image, or paste one straight in.' }, added: '2026-11-03' },
  { id: 'notes-voice', kind: 'feature', title: 'Talk to type in Notes', why: 'A mic on a page\'s formatting bar puts your words in where the caret is (one undo takes them out), and one on the Quick notes box. In Ctrl K, "today fed the goats" puts a timed line on today\'s page in the project you are in.', uses: 'all', open: { go: '#notes', hint: 'Open a page: the mic is the last button on the formatting bar. Quick notes has one beside Add.' }, added: '2026-11-04' },
  { id: 'notes-send', kind: 'feature', title: 'Send a page to a session', why: 'Send to session on a page (or a quick note) puts its text in a session\'s message bar under a line like "Summarise these notes into to-dos" or "Turn this into a plan". You read it there and press Enter: nothing is sent on its own.', uses: ['code'], open: { go: '#notes', hint: 'Open a page: Send to session sits beside Pin. On Quick notes each note has one.' }, added: '2026-11-04' },
  { id: 'model-effort', kind: 'feature', title: 'Pick the model and effort, type / for commands', why: 'New session asks which Claude model (Sonnet, Opus, Haiku, 1M context) and how hard it should think, remembered per folder. In the message bar, type / to list Claude\'s commands and the project\'s own skills with what each does; /model opens Claude\'s picker as buttons in the chat. The session\'s bar shows its model, effort, context used and cost as it runs (after npm run setup, from Claude Code\'s status line).', uses: ['code'], open: { go: '#sessions', hint: 'New session has Model and Effort under Folder. In a Claude session, type / in the message bar to see the commands; the readout sits on the session\'s bar.' }, added: '2026-11-04' },
  { id: 'new-face', kind: 'feature', title: 'A new face and logo', why: 'Switchboard has a new logo (three streams meeting at one lamp) and its own typefaces now (a warm serif for titles, a plain sans for text, one mono for readouts and the terminal), shipped with it so nothing loads from Google, and the lamp in the wordmark lights up when something needs you. Light and dark are set in Settings, General.', uses: 'all', open: { pane: 'look', hint: 'Theme and text size are at the top of Settings, General. The lamp beside the name is orange when something needs you and green when all is clear.' }, added: '2026-11-04' },
  { id: 'system-monitor', kind: 'feature', title: 'System monitor', why: 'See how busy this computer is: processor, memory, graphics, network, storage, temperatures, fans and the apps using the most, with a line in words about what is slowing it down. Settings, System, Open the monitor.', uses: 'all',
    open: { pane: 'system', focus: 'sys-open' }, added: '2026-11-04' },
];
