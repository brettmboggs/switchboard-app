# Switchboard, in short

<!-- Made by npm run pitch from docs/headlines.json and public/setup.js. Edit those, not this file. -->

**One screen for everything that wants your attention: your AI coding agents, builds, email, Teams, calendar, bills and packages.**

Anything that needs you turns orange, and you can answer it right there without opening the other app. It runs on your own computer: your passwords and mail never pass through anyone else's server, and nothing is ever sent without your click.

## What makes it different

### 1. Orange means it needs you

An agent waiting for an answer, a build that failed, a reply you owe, a bill due, a late package, the chickens to feed: one board, one colour for "you". Everything else stays quiet, so a glance tells you whether you can keep working.

Show it (about 20 seconds):

1. Open Now with a few cards on it: one agent waiting, one red build, one email to answer.
2. Click the waiting agent and answer it; the card leaves and the lamp in the wordmark goes from orange to green.
3. Before noon: the morning rundown reads the day aloud in one sentence.

In the app: Morning rundown, Packages, Chores and routines, GitHub Actions, live.

### 2. Your AI agents live inside it

Claude Code, Codex, Gemini and local models run inside Switchboard, and a Claude session reads like a clean chat: its permission prompts and multiple-choice questions are buttons, messages queue while they work, any file they mention opens with a click, and the bar shows the model, how much context is used and what it has cost so far.

Show it (about 20 seconds):

1. Start a Claude session from New session, picking the model and effort.
2. Claude asks permission: click Yes in the chat. Claude asks a question with choices: tick two and Submit.
3. Type a second message while it works; it waits and goes in when the agent is free.

In the app: Sessions read like a chat, Claude's questions in the chat, Pick the model and effort, type / for commands, Local AI models, Your turn means done, Click a file to read it.

### 3. Your agents can talk back

Switchboard is an MCP server, so the agents themselves can read your board: what needs you, how the builds are doing. A stuck agent puts a card on your board instead of sitting silently in a terminal, and one session can hand work to another.

Show it (about 20 seconds):

1. Ask an agent "what needs me on Switchboard?" and it answers from the board.
2. An agent that is blocked adds a Needs-you card; it shows on Now at once.

In the app: Your agents can use Switchboard.

### 4. Work finds the session it is about

A Teams message or email about a project shows up beside the coding session for that project. One click puts it into what you send the agent, with who sent it and when. A notes page goes in the same way.

Show it (about 20 seconds):

1. A teammate's Teams message arrives; it appears under the session list with an orange dot.
2. Add to message, then Send: the agent gets the message and starts on it.

In the app: Messages beside your sessions, Bring one message into a session, Send a page to a session.

### 5. Reply without opening the other app

Gmail, any other mail account, Teams, Outlook and Google Voice texts in one Inbox that reads like a chat app. Reply, archive or snooze from there, and close the dozen tabs: you still see everything.

Show it (about 20 seconds):

1. Pick a Teams chat in Inbox; it opens large beside the list.
2. Write a reply and send it; it shows at once and is confirmed when it has gone.

In the app: Conversations, like Teams, Gmail, Any email account, Teams and Outlook.

### 6. Every computer, one board

Sign in on each computer and every session shows on all of them. Open a session running on your desktop from your laptop and it is a chat there too, questions and all. Settings and notes follow you, end-to-end encrypted.

Show it (about 20 seconds):

1. On the laptop, open a session that runs on the desktop.
2. Answer its question from the laptop; the desktop session carries on.

In the app: Sessions on every computer, A session from your other computer, as if it were here, Switchboard account.

### 7. Private, light and yours

One small local server, one SQLite file and a plain web page, using far less memory than the browser tabs and apps it replaces. No middleman server, no subscription, and nothing sent on your behalf: every email and message goes when you click.

Show it (about 20 seconds):

1. Close the browser tabs for mail, Teams, GitHub and the calendar; Switchboard still shows all of it.
2. Open the System monitor to show how little it uses.

In the app: System monitor.

Everything else Switchboard does is below, straight from the list the welcome screen is built from, so it is never out of date.

## What it connects to

- **Switchboard account**: Your setup on every computer you use, encrypted so only you can read it.
- **Your projects**: Split things by business, client or part of life, so each shows in the right place.
- **Gmail**: Mail from people (not ads), sorted by project, with reply and archive.
- **Any email account**: iCloud, Yahoo, Fastmail, work mail and more, next to Gmail: type the address and Switchboard finds the rest.
- **Calendars**: Today's events at the top of Now, and a heads-up ten minutes before each. Google, Outlook, iCloud, school and team calendars.
- **Weather**: One line on Now, plus rain coming, frost tonight, and official warnings where you are.
- **Webhooks**: A private link that IFTTT, Zapier, Home Assistant, a phone shortcut or a script can use to put a note, a reminder or a "needs you" on your board.
- **Teams and Outlook**: Work chats and mail; reply without opening Teams.
- **GitHub**: Pull requests to review and builds that failed.
- **Claude Code**: See which sessions need you, and run them inside Switchboard.
- **ChatGPT (Codex)**: OpenAI's coding agent, signed in with your ChatGPT plan. Its sessions read like a chat too: messages, the commands it runs and the files it edits.
- **Browser checks**: A project's Playwright tests, or a page that has to load and show the right text, run in a browser with no window that closes after each run, on a click or every hour or day. A failure is a Needs-you card with the failing tests and screenshots. Run node scripts/setup.mjs browser once to install it and give your agents the same browser. A project's tests can run signed in to a site that needs it: you sign in yourself in a window on your computer, and Switchboard never sees your password.
- **Gemini**: Google's coding agent, signed in with your Google account.
- **News and blogs**: Follow sites and blogs (type the site, Switchboard finds its feed) and their newest posts show on Inbox, Reading: quietly, never as something that needs you.
- **Local AI models**: Run AI models on this computer with Ollama: private, free, and they work offline. Install it and get a model from Settings, Connections, then start one from New session (Agent: Local model). It reads like a chat, the same as a Claude session. LM Studio and other local servers show there too.
- **Todoist**: Your Todoist tasks due today or overdue show on Now, in the project you pick; Done there ticks them off in Todoist (a repeating one moves to its next date). Paste your API token from Todoist, Settings, Integrations, Developer.
- **Trello**: Cards with a due date, on boards you are on, show on Now when due; Done there marks them complete in Trello. Paste an API key and a token made for it (the card links to both).
- **Asana**: Tasks assigned to you, due today or overdue, show on Now; Done completes them in Asana. Paste a personal access token from app.asana.com/0/my-apps.
- **Notion**: Pages in your Notion task database with a date of today or earlier show on Now; Done ticks them off in Notion. Paste an integration secret, and share the database with it in Notion.
- **LM Studio models as sessions**: If you use LM Studio, the models you downloaded there start from New session (Agent: Local model (LM Studio)) and chat in a terminal: on this computer, private and offline. Settings, Connections, Local AI models lists them.
- **iCloud, Fastmail and Yahoo calendars**: Add the email account and its calendars are offered under Calendars: tick the ones you want, no link to copy. Uses the same app password as the mail.

## Everything it does

- **Calendar**: A month of everything on your calendars, with the day you pick opened underneath. Sign in with Google (Settings, Connections, Calendars) and you can add, change and delete events here too.
- **Notebook**: Notes, Pages: write with a formatting bar like an email (headings, bold, bullets, checklists). End a line with = for the answer; "shopping eggs" in Ctrl K adds to your Shopping list; "log eggs 14" keeps a running total.
- **Chores and routines**: Things that come back on their own: "feed the animals every day at 6am and 6pm", "filter every 90 days". They show on Now when due; Done sets the next one. Notes has ideas to pick from.
- **Packages**: Shipping emails become one line each on Now: arriving Thursday, out for delivery 10 to 2, delivered, or delayed. Click one to track it.
- **Conversations, like Teams**: Pick a conversation in Inbox and it opens large beside the list, live: new Teams messages show within seconds, your reply shows the moment you send it, and nothing jumps while you read.
- **Switchboard as an app**: Download it, double-click, and Switchboard has its own icon and window, sits in the tray when closed, starts at login and updates itself. No terminal, no browser.
- **Updates in the app, one click**: In the Switchboard app, Update ready shows at the bottom of the page when there is a new version, like it does everywhere else: click it and the app downloads it and restarts. Settings, About has Check for updates, and a switch to install updates on their own when no agent is working.
- **Only the connections you use**: Settings, Connections now shows just yours. Everything else is under Add a connection, by kind (Messages, Calendars, Money, Coding, Automation), with Add; Remove from list takes back one you are not using.
- **Email drafts, editable in Inbox**: Drafts in your mail, including ones an assistant wrote for you, show in Inbox: in the conversation they answer, or at the top of Inbox. Edit, then Send, Save draft (back to your Drafts, so Gmail shows the same) or Discard.
- **Click a file to read it**: When an agent names a file (a document, a screenshot, a line of code), in Chat or Terminal view, click it: Switchboard shows it right there, a document as a page and code with that line lit, with Open in its own app and Show in folder. Pictures it sends show in the chat.
- **Search everything**: Ctrl K, then type a few letters: sessions (on every computer), people on your projects, emails and Teams chats, calendar events, bills and charges, pages and notes, projects, and Switchboard's own features. Arrow down and Enter opens one; Enter on its own still adds what you typed as a note.
- **Type it once**: Ctrl K, then "remind me to call Sam at 3", "bill rent 1200 on the 1st" or "note gate code 4411".
- **Talk to type**: Click the mic next to any message box and talk. Enter stops, Enter again sends.
- **Dark theme and text size**: Settings, General: light or dark, and bigger text if you like.
- **Sessions on every computer**: Sign in on each computer and every session shows on all of them.
- **GitHub Actions, live**: Sessions, Builds shows every run as it goes: yellow while it runs, green passed, red failed. Each session shows its own repo's runs too.
- **Your agents can use Switchboard**: Claude, Codex and Gemini get Switchboard's tools: they can see what needs you and your builds, put a needs-you card on the board when they are blocked, and hand work to another session.
- **Sessions as lines, with your own names**: Every session is one line on the right, under the repo it works in, named by what it is working on and saying what it is doing. Double-click a line (or More, Rename) to give it your own name; clear the name to go back.
- **Bring one message into a session**: Messages, beside the paperclip on Sessions, lists the recent emails, texts and Teams chats in the session's project, with a search. Click one to add just that message, with who sent it and when. Link to a project on a conversation from elsewhere, and that person's messages go to that project from then on.
- **Sessions read like a chat**: A Claude session opens as a conversation with one message bar, like the Claude and ChatGPT apps. When Claude asks permission or offers choices, they show as buttons in the chat; write a message instead and it answers No and sends yours. While it works you see what it is doing. Prefer Claude's own terminal? Settings, Look, Sessions open in: Chat or Terminal; Chat | Terminal on a session switches just that one.
- **Paste images to an agent**: Paste or drop a screenshot into the message bar on Sessions.
- **Talk to type in Notes**: A mic on a page's formatting bar puts your words in where the caret is (one undo takes them out), and one on the Quick notes box. In Ctrl K, "today fed the goats" puts a timed line on today's page in the project you are in.
- **Send a page to a session**: Send to session on a page (or a quick note) sends the whole page, the text you selected, or the line you are on. You see what goes and can change it, and you can add a line like "Turn this into a plan". Send puts it in now, or queues it while the agent is busy. Edit in the message bar opens it there instead.
- **A session from your other computer, as if it were here**: Open a session that runs on your other computer and it shows as a chat too, with its questions as buttons. What you copy in its terminal lands on the computer you are using, not the one it runs on.
- **Pick the model and effort, type / for commands**: New session asks which Claude model (Sonnet, Opus, Haiku, 1M context) and how hard it should think, remembered per folder. In the message bar, type / to list Claude's commands and the project's own skills with what each does; /model opens Claude's picker as buttons in the chat. The session's bar shows its model, effort, context used and cost as it runs (after npm run setup, from Claude Code's status line).
- **A new face and logo**: Switchboard has a new logo (three streams meeting at one lamp) and its own typefaces now (a warm serif for titles, a plain sans for text, one mono for readouts and the terminal), shipped with it so nothing loads from Google, and the lamp in the wordmark lights up when something needs you. Light and dark are set in Settings, General.
- **System monitor**: See how busy this computer is: processor, memory, graphics, network, storage, temperatures, fans and the apps using the most, with a line in words about what is slowing it down. Settings, System, Open the monitor.
- **Every project has its own page**: Click a client or project on the left and it opens its own page: what is in flight, its conversations, sessions, notes and files (drop them on the page), and on the side who it is for, how to reach them (everyone you have written to in that project is offered from your mail, Add or Hide) and links to their site, its admin and anything else you open for them. To narrow a list to one project, use the picker at the top of that page.
- **Messages beside your sessions**: Under the session list on Sessions: the newest email and Teams conversations for the session's project (a new one has an orange dot). Add to message puts one into what you are sending the agent; Earlier shows the conversation; Hide or Clear all keeps the list short until someone writes again.
- **Claude's questions in the chat**: When Claude asks you to choose (one answer, several, or your own words), the choices show in the chat with their descriptions: tick boxes for several, Type something to write your own, and a review before it goes. No switching to the terminal.
- **Files and pictures anywhere**: Drop, paste or pick any file: into a session (the agent gets it), onto its terminal, into a note (pictures show in the page), or onto a project. Up to 1 GB each; they stay on this computer.
- **Problems say so**: If something on the page breaks, a line at the bottom says so with Copy details: the version, the page and the error, ready to paste into a bug report. Nothing is sent anywhere.
- **Keyboard shortcuts**: Press ? for every shortcut. G then a letter goes to a page: G N Now, G S Sessions, G I Inbox, G M Money, G O Notes. In a Claude session's terminal, Shift+Enter is a new line and Ctrl+Enter sends now.
- **Undo**: Done, Delete and archiving a conversation can be taken back for a few seconds: Undo on the line at the bottom, or Ctrl+Z.
- **Morning rundown**: Until noon, the top of Now says how the day looks in one sentence: meetings, what needs you, bills this week, packages and routines, with the weather and the schedule. Read aloud uses a voice on your computer. Done for today puts it away; Rundown on the Today card brings it back.
- **Recurring costs, by project**: Money, Recurring costs: everything you pay again and again (rent, hosting, software, insurance) with what it comes to a month and a year, split by project; each project's page shows its own. Charges in your email that come back each month are offered to add in one click.
- **Your turn means done**: A session that sent helpers (sub-agents) off to work no longer says Your turn while they are still going: it stays Working with "2 helpers still working" until the last one is back. End on a session's bar asks once, in place, and waits for your answer.
