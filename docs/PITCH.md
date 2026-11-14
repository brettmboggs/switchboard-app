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

Gmail, any other mail account, Teams, Outlook, Google Voice texts and your team's own end-to-end encrypted chat in one Inbox that reads like a chat app. Reply, archive or snooze from there, and close the dozen tabs: you still see everything.

Show it (about 20 seconds):

1. Pick a Teams chat in Inbox; it opens large beside the list.
2. Write a reply and send it; it shows at once and is confirmed when it has gone.

In the app: Conversations, like Teams, Gmail, Any email account, Teams and Outlook, Team chat.

### 6. Every computer, one board

Sign in on each computer and every session shows on all of them. Open a session running on your desktop from your laptop and it is a chat there too, questions and all. Settings and notes follow you, end-to-end encrypted.

Show it (about 20 seconds):

1. On the laptop, open a session that runs on the desktop.
2. Answer its question from the laptop; the desktop session carries on.

In the app: Sessions on every computer, A session from your other computer, as if it were here, Switchboard account.

### 7. An AI that lives on your computer

Hold Ctrl+Space and talk: Jarvis answers out loud and does it, from opening a session to setting a reminder. Or start a Local AI session in Sessions and chat with the same model in writing, pictures too. It runs on your own graphics card, so it is free and nothing you say leaves the computer, and Switchboard loads and unloads it so it never sits on the card unused.

Show it (about 20 seconds):

1. Hold Ctrl+Space and say "what needs me"; he answers out loud.
2. New session, Agent: Local AI (Switchboard); add a photo with the paperclip and ask what it is.

In the app: Jarvis: talk to Switchboard, Chat with the AI on your own computer.

### 8. Private, light and yours

One small local server, one SQLite file and a plain web page, using far less memory than the browser tabs and apps it replaces. No middleman server, no subscription, and nothing sent on your behalf: every email and message goes when you click.

Show it (about 20 seconds):

1. Close the browser tabs for mail, Teams, GitHub and the calendar; Switchboard still shows all of it.
2. Open the System monitor to show how little it uses.

In the app: System monitor.

Everything else Switchboard does is below, straight from the list the welcome screen is built from, so it is never out of date.

## What it connects to

- **Flips: eBay deals**: It sweeps whole eBay categories for you (graphics cards, consoles, headphones, lenses, power tools and more; no search words needed), pricing every new listing by its product, and watches anything you name too: new Buy It Now listings, misspelled ones ("Milwalkee", "Nintedo") that few buyers find, and auctions about to end. Each shows what it sells for and your profit after eBay's fees and shipping, and a new one is an alert. It reads listings with your own free eBay developer keys; buying is always your click on eBay.
- **Flips: ShopGoodwill and HiBid on the radar**: Save a search on ShopGoodwill and HiBid for what you resell, with email alerts on, and Flips reads those emails as they arrive, prices every item on eBay and alerts you to the ones worth bidding on. Under Money, Flips, Radar. Your mail is read on this computer only.
- **Switchboard account**: Your setup on every computer you use, encrypted so only you can read it.
- **Your projects**: Split things by business, client or part of life, so each shows in the right place.
- **Gmail**: Mail from people (not ads), sorted by project, with reply and archive.
- **Any email account**: iCloud, Yahoo, Fastmail, work mail and more, next to Gmail: type the address and Switchboard finds the rest.
- **Calendars**: Today's events at the top of Now, and a heads-up ten minutes before each. Google, Outlook, iCloud, school and team calendars.
- **Weather**: One line on Now, plus rain coming, frost tonight, and official warnings where you are.
- **Links for other apps (webhooks)**: A private link that IFTTT, Zapier, Home Assistant, a phone shortcut or a script can use to put a note, a reminder or a "needs you" on your board.
- **Teams and Outlook**: Work chats and mail; reply without opening Teams.
- **GitHub**: Pull requests to review and builds that failed.
- **Claude Code**: See which sessions need you, and run them inside Switchboard.
- **ChatGPT (Codex)**: OpenAI's coding agent, signed in with your ChatGPT plan. Its sessions read like a chat too: messages, the commands it runs and the files it edits.
- **Browser checks**: Your project's own browser tests, or a page that has to load and show the right text, run in a browser with no window that closes after each run, on a click or every hour or day. A failure is a Needs-you card with the failing tests and screenshots. Set up the checking browser from Browser checks, once; your agents get the same browser. A project's tests can run signed in to a site that needs it: you sign in yourself in a window on your computer, and Switchboard never sees your password.
- **Gemini**: Google's coding agent, signed in with your Google account.
- **Read-aloud voice**: A natural voice that runs on this computer (Piper: free, open source, works offline) reads your books aloud, and Jarvis can speak with it too. Pick a voice, Install, and it downloads once (60 to 145 MB). Without it, books are read with the computer's built-in voice.
- **Mail tracking**: See when email you send from Switchboard is opened and clicked, and whether it was really a person (with the reasons), on Inbox, Tracking; a new open is an alert. Mail from people who track you is marked "Tracks you", and you get an alert. It works with your own mail tracker on Cloudflare: type its address and paste an access token from it. Switchboard shows mail as text, so their trackers never load here.
- **News and blogs**: Follow sites and blogs (type the site, Switchboard finds its feed) and their newest posts show on Inbox, Reading: quietly, never as something that needs you.
- **Local AI models**: Run AI models on this computer with Ollama: private, free, and they work offline. Install it and get a model from Settings, Connections, then start one from New session (Agent: Local model). It reads like a chat, the same as a Claude session. LM Studio and other local servers show there too.
- **Granola**: Your Granola meeting notes in Notes, one page a meeting with its summary and your own notes, in the project it belongs to (a Granola folder named like the project, the people in it, or its title), so you and your sessions can read them. Read only. Sign in on Granola's own page, any plan, the free one too.
- **Todoist**: Your Todoist tasks due today or overdue show on Now, in the project you pick; Done there ticks them off in Todoist (a repeating one moves to its next date). Paste your Todoist key: the card walks you through it.
- **Trello**: Cards with a due date, on boards you are on, show on Now when due; Done there marks them complete in Trello. Paste two codes from Trello: the card walks you through it.
- **Asana**: Tasks assigned to you, due today or overdue, show on Now; Done completes them in Asana. Paste an Asana key: the card walks you through it.
- **Notion**: Pages in your Notion task database with a date of today or earlier show on Now; Done ticks them off in Notion. Paste a Notion key and share your task database with it: the card walks you through it.
- **LM Studio models as sessions**: If you use LM Studio, the models you downloaded there start from New session (Agent: Local model (LM Studio)) and chat in a terminal: on this computer, private and offline. Settings, Connections, Local AI models lists them.
- **iCloud, Fastmail and Yahoo calendars**: Add the email account and its calendars are offered under Calendars: tick the ones you want, no link to copy. Uses the same app password as the mail.

## Everything it does

- **Chat with the AI on your own computer**: In Sessions, New session, pick Agent: Local AI (Switchboard), no folder needed: a chat with the AI model on this computer, the same one Jarvis thinks with, in the same Chat view as Claude. Nothing you type or show it leaves the computer. It loads onto the graphics card with your first message, making room by unloading other models, and unloads after a few idle minutes; Jarvis and every session share that one loaded copy. Add a picture with the paperclip; Think first lets it work a hard question through. Past chats show under it to pick up again or delete, and clear themselves after 30 days. Pick the model and how much it remembers in Settings, Connections, Local AI models.
- **Flips: is it a good buy?**: Found something on ShopGoodwill, a garage sale or anywhere? Type what it is and the price, paste its link, or press the Check in Flips bookmark on the listing: it says Good deal, Thin or Bad deal, what it sells for on eBay, your profit after fees, shipping and tax, and the most to pay or bid. Jarvis does it too: "is a Steam Deck for 250 a good deal?"
- **Flip log**: Everything you bought to resell, from bought to listed to sold, with the real profit after eBay's fee and the label, the money still sitting in what has not sold, and how many days things take to sell. Under Money, Flip log; "I bought it" on a price check adds one.
- **Flips: surplus auctions nearby**: Government surplus auctions (GSA) within driving distance show under Money, Flips: set the ZIP areas you would drive to and it lists what is up for bid there, ending soonest first.
- **Project dashboards**: Each project gets a Dashboard tab set up for what it is: a client's website (an SEO score, AI search readiness for ChatGPT and Google's AI Overviews, tracking and ads tags, speed, site health, fixes worst first), numbers you track by hand (a rating, reviews, leads), the analysis in words, and the change since day one. Make PDF puts a clean report in the project's Files.
- **Every Teams chat in Inbox**: Inbox has a Teams folder with all your recent Teams chats, answered or not: open one to read the whole thread and write in it whenever you like.
- **Calendar**: A month of everything on your calendars, with the day you pick opened underneath. Sign in with Google (Settings, Connections, Calendars) and you can add, change and delete events here too.
- **Notebook**: Notes, Pages: write with a formatting bar like an email (headings, bold, bullets, checklists). End a line with = for the answer; "shopping eggs" in Ctrl K adds to your Shopping list; "log eggs 14" keeps a running total.
- **Chores and routines**: Things that come back on their own: "walk the dog every day at 6am and 6pm", "filter every 90 days". They show on Now when due; Done sets the next one. Notes has ideas to pick from.
- **Packages**: Shipping emails become one line each on Now: arriving Thursday, out for delivery 10 to 2, delivered, or delayed. Click one to track it.
- **Conversations, like Teams**: Pick a conversation in Inbox and it opens large beside the list, live: new Teams messages show within seconds, your reply shows the moment you send it, and nothing jumps while you read.
- **Switchboard as an app**: Download it, double-click, and Switchboard has its own icon and window, sits in the tray when closed, starts at login and updates itself. No terminal, no browser.
- **One person, every address**: On a project's About card, a person can have a work email and a Gmail, and as many phone numbers as they use: Add email and Add phone under each person. Mail from any of their addresses, and texts from any of their numbers, sort into that project. Two rows that are the same person? Merge with… makes them one and keeps every address.
- **Switchboard in a browser**: At your own domain, with nothing to install: your own projects, notes and to-dos, Teams, Outlook and GitHub, and the projects shared with you, kept in your account and opened only in your browser. The invite button opens it; making the account there is joining.
- **Share everything a project has**: Give a co-founder everything in a project with one button: its pages and sections, to-dos, repos and builds, browser checks, activity, your sessions live (they can ask to send; you let it in), its conversations, calendar, money and files. Each one None, See or Edit on its own.
- **Gmail, Google Calendar, Microsoft 365 and GitHub on the web board**: Anyone on the web board connects their own Google (Gmail in Inbox, replies on your click, Google calendars on Calendar), Microsoft 365 (any work, school or personal account: Outlook mail, and Teams for work accounts) and GitHub, in Settings, Account. Kept sealed in your own account.
- **More of Switchboard in a browser**: On the web board, the projects shared with you now bring their Sessions (follow them live and send to them), Builds, Browser checks, Calendar and Money, on the same pages as the app, with whatever the person who shares them chose.
- **Forgot password**: Forgot the password to your Switchboard account? Whoever runs a project you share presses Reset their password on your card in Settings, Team and gives you a one-time code; press Forgot password? under the sign-in, enter it with a new password, and you are in. Your data stays locked to you: your computers sign out, and each one sends its copy up again when you sign in on it with the new password.
- **Team chat**: A chat for each shared project and one-to-one chats with your teammates, in the Inbox beside your email and Teams. See who has read each message and who is typing, edit or delete your own, reply to a message, @mention someone (they get an alert and a push on their phone) and pin what matters. Encrypted end to end: the sync service holds only sealed lines.
- **Your team**: Settings, Team: invite someone by email once, even before they have Switchboard (the link makes their account and puts them in). Pick their projects and, for pages, to-dos, repos, activity and the About card, None, See or Edit. Shared repos open in Codespaces or as a ZIP, with nothing to install. Encrypted end to end; never mail, terminals or sign-ins.
- **Check codes for your team**: Switchboard keeps the keys of everyone you share with the first time it sees them, and refuses to lock anything to keys that change, with a warning in Team. Check codes let two people read each other a short code to be sure the keys are theirs.
- **What belongs to each project**: Each project's page starts with In this project: its repos, the people, addresses and chats about it, and the pages (or single sections of pages) for it. Add to this project searches everything; anything can be in more than one project, and a note can be tied to one repo.
- **Unsorted, and Hide**: Unsorted, under your projects on the left, lists the repos, folders, people and chats with no project yet: one click files each in its likely project. Hide takes clutter, like folders that are not repos, out of every list and the folder picker. Nothing is deleted.
- **Your notes beside your sessions**: Under a session's messages: the notes for its project, and those tied to its repo. Add to message puts a page or one section in what you are writing. Your agents can read them too.
- **Ctrl K: note and sesh**: From any page: "note call Sam" puts a checkbox at the bottom of a page you pick (or a new one), and "sesh add a test" sends a message to a session you pick. You stay where you are.
- **Pictures and files in Inbox, in and out**: Pictures people send show as pictures in Inbox: in email, Google Voice texts, Outlook and Teams. Other attachments (a PDF, a spreadsheet) show with their name and size; click to save one. Paste, drop or attach pictures in a reply and they arrive as real pictures: attached to an email or an Outlook reply, inline in Teams. Teams chats also show emoji reactions: hover a message to react with 👍 ❤️ 😆 😮 😢 🙏, or click one to add or take back yours.
- **Open Switchboard in your browser**: If the app's window is slow to type or scroll in on your computer, Switchboard says so and offers Open in browser: the same Switchboard, sessions and settings in Chrome, Edge or Brave, with your browser's saved passwords. On Linux the app uses your Chrome window on its own. The button is also in Settings, General, and in the app's tray menu.
- **Remove Switchboard cleanly**: Settings, General, Remove takes out everything Switchboard added to this computer (Switchboard's links into Claude Code, its tools in your other coding agents, start at login) and leaves your own settings as they are. Tick the box to delete your data too.
- **Updates in the app, one click**: In the Switchboard app, Update ready shows at the bottom of the page when there is a new version, like it does everywhere else: click it and the app downloads it and restarts. Settings, About has Check for updates, and a switch to install updates on their own when no agent is working.
- **Only the connections you use**: Settings, Connections now shows just yours. Everything else is under Add a connection, by kind (Messages, Calendars, Money, Coding, Automation), with Add; Remove from list takes back one you are not using.
- **Email drafts, editable in Inbox**: Drafts in your mail, including ones an assistant wrote for you, show in Inbox: in the conversation they answer, or at the top of Inbox. Edit, then Send, Save draft (back to your Drafts, so Gmail shows the same) or Discard.
- **Click a file to read it**: When an agent names a file (a document, a screenshot, a line of code), in Chat or Terminal view, click it: Switchboard shows it right there, a document as a page and code with that line lit, with Open in its own app and Show in folder. Pictures it sends show in the chat.
- **Search everything**: Ctrl K, then type a few letters: sessions (on every computer), people on your projects, emails and Teams chats, calendar events, bills and charges, pages and notes, projects, and Switchboard's own features. Arrow down and Enter opens one; Enter on its own still adds what you typed as a note.
- **Jarvis: talk to Switchboard**: Hold Ctrl+Space anywhere and say it: "what needs me", "go to builds", "open the switchboard session", "remind me tomorrow at 9 to call the bank", or ask a session to do something. It answers out loud and does it. The common things work at once with no AI; anything else goes to the AI model on this computer (Switchboard runs it, or LM Studio or Ollama), so it is free and private.
- **Jarvis answers in under a second**: He starts talking as soon as his first sentence is ready, the model loads while you are still holding Ctrl+Space, and holding it again while he talks stops him. A short tone says he is listening, another that he heard you.
- **Jarvis speaks up**: Switch it on and he says out loud when a session needs you, and when sessions finish ("Two done: notes page and inbox fix"). Ask "what did the switchboard session say" and he reads the start; "read it all" reads the rest.
- **A spoken morning brief**: On your first click of the day Jarvis says the weather, what is on the calendar, what needs you, sessions waiting, builds that failed overnight, mail waiting and bills due. Say "brief me" or "good morning" for it any time.
- **Jarvis remembers**: Say "remember that my sister Ana lives in Denver" and he uses it from then on; "forget…" takes it out, and "what did I say about the bank?" finds earlier words. Each night he tidies his notes about you, kept short so he stays quick. Settings shows them to edit, with Undo.
- **AI plan limits, with a forecast**: The Deck and Now show your Claude plan's 5-hour and weekly limits as small charts: how much is used, when each resets, and where your pace lands by then ("On track, lands near 77%" or "Runs out about 7:20 PM at this pace"), with what each day of the week used. A Claude session's bar on Sessions has a tiny gauge for each. Codex shows too once you use it. It reads what Claude Code already reports, so there is nothing to connect.
- **AI plans: your usage, history and habits**: Click the AI plans card for its own page, on one screen: a big chart of the week you can hover for any moment (with last week's line to compare), when in the week you use the plan, every past week and where it ended (click one to see it again), the last four weeks day by day, your habits (a day's use, an hour of real use, busiest day and hour) and the sessions that made the biggest dents. A tab for each plan you have.
- **Type it once**: Ctrl K, then "remind me to call Sam at 3", "bill rent 1200 on the 1st" or "note gate code 4411".
- **Talk to type**: Click the mic next to any message box and talk. Enter stops, Enter again sends. Settings, General, Microphone picks which mic it listens to (an audio interface or a headset, if your computer's default is another).
- **Text size**: Settings, General: bigger or smaller text, everywhere but the terminal (which has its own size).
- **The Command Deck**: Switchboard opens on the Deck: Jarvis at the centre, every system around it as a live module (needs you, sessions, builds, inbox, calendar, money, notes, checks, projects). Click a module and it opens into its full panel; Esc, the wordmark or "back" returns. Pages, projects, search and settings sit in the ring across the top. Orange still means one thing: it needs you.
- **Sessions on every computer**: Sign in on each computer and every session shows on all of them.
- **GitHub Actions, live**: Sessions, Builds shows every run as it goes: yellow while it runs, green passed, red failed. Each session shows its own repo's runs too.
- **Your agents can use Switchboard**: Claude, Codex and Gemini get Switchboard's tools: they can see what needs you and your builds, put a needs-you card on the board when they are blocked, and hand work to another session.
- **Sessions as lines, with your own names**: Every session is one line on the right, under the repo it works in, named by what it is working on and saying what it is doing. Double-click a line (or More, Rename) to give it your own name; clear the name to go back.
- **Bring one message into a session**: Messages, beside the paperclip on Sessions, lists the recent emails, texts and Teams chats in the session's project, with a search. Click one to add just that message, with who sent it and when. Link to a project on a conversation from elsewhere, and that person's messages go to that project from then on.
- **Sessions read like a chat**: A Claude session opens as a conversation with one message bar, like the Claude and ChatGPT apps. When Claude asks permission or offers choices, they show as buttons in the chat; write a message instead and it answers No and sends yours. While it works you see what it is doing. Prefer Claude's own terminal? Settings, General, Sessions open in: Chat or Terminal; Chat | Terminal on a session switches just that one.
- **Paste images to an agent**: Paste or drop a screenshot into the message bar on Sessions.
- **Talk to type in Notes**: A mic on a page's formatting bar puts your words in where the caret is (one undo takes them out), and one on the Quick notes box. In Ctrl K, "today picked up the parts" puts a timed line on today's page in the project you are in.
- **Send just the bullet you are on**: In a page, a small arrow at the end of the line you are on sends that bullet (and the ones under it) to a session; select a few bullets and it sends those. Whole page is still one click in the dialog.
- **Send a page to a session**: Send to session on a page (or a quick note) sends the whole page, the text you selected, or the line you are on. You see what goes and can change it, and you can add a line like "Turn this into a plan". Send puts it in now, or queues it while the agent is busy. Edit in the message bar opens it there instead.
- **A session from your other computer, as if it were here**: Open a session that runs on your other computer and it shows as a chat too, with its questions as buttons. What you copy in its terminal lands on the computer you are using, not the one it runs on.
- **Pick the model and effort, type / for commands**: New session asks which Claude model (Sonnet, Opus, Haiku, 1M context) and how hard it should think, remembered per folder. In the message bar, type / to list Claude's commands and the project's own shortcuts (skills) with what each does; /model opens Claude's picker as buttons in the chat. The session's bar shows its model, effort, context used and cost as it runs (after you finish Claude Code setup in Settings, Connections).
- **A new face and logo**: Switchboard has a new logo (three streams meeting at one lamp) and its own typefaces now (a warm serif for titles, a plain sans for text, one mono for readouts and the terminal), shipped with it so nothing loads from Google, and the lamp in the wordmark lights up when something needs you. Light and dark are set in Settings, General.
- **System monitor**: See how busy this computer is: processor, memory, graphics, network, storage, temperatures, fans and the apps using the most, with a line in words about what is slowing it down. Settings, System, Open the monitor.
- **End programs from the System monitor**: The monitor marks every app Safe to end, Ask first (a session is using it, it may have unsaved work, or it is busy) or Keep (part of the system). Click an app to see each of its processes: what it is, which session or folder it belongs to, how long it has been open, the ports it serves and the memory and video memory it holds, with End on each. End asks it to close; if it will not, Force end makes it. Anything big sitting idle is named at the top with an End button. Linux for now. Ask Jarvis "what's using my memory" or "end comfyui".
- **Books: a library you read here**: Inbox, Reading is a library now. Add book searches archive.org for books that are free to download (or paste a book's link), and the book opens on its own scanned pages, where you left off. Drag across words to highlight them in four colours or add a note; B bookmarks a page; Text shows the page as plain text, Page shows two pages side by side like an open book, Night dims the paper. Shelves (reading, want to read, finished) and tags keep it arranged. Read aloud reads it to you a sentence at a time, the words lit as it goes, and keeps going while you work on other pages; or play the book's free LibriVox audiobook, chapter by chapter. Ask Jarvis "continue reading", "read to me", "stop reading".
- **Inbox, like a mail app**: Inbox fits on one screen in three columns: folders on the left (Business, Personal, Drafts, Replied, Tracking, Reading, and your team chats), the folder's list in the middle with two short lines per conversation, and the open conversation on the right with the reply box under it. No more rows of filters or drafts piled above your mail. Esc closes a conversation and keeps you on Inbox.
- **Add to and change your calendar by typing or saying it**: In Ctrl K or to Jarvis, one line puts an event on your Google calendar: "lunch with Sam fri noon to my calendar", "meeting dentist tue 3-4pm", "schedule oil change tomorrow" (no time is all day), "add Mia's recital to the family calendar 11/20 6pm". Ask Jarvis "what's on my calendar tomorrow" or "am I free friday". Change them the same way: "move lunch with Sam to 1pm", "reschedule dentist to thu 2-3pm", "rename the dentist event to cleaning", "cancel lunch with Sam friday" (it asks first). It stays in sync with Google both ways: what you change on your phone shows here within about a minute. The Calendar page always has Add event now; it shows how to connect a Google calendar when none can take events yet.
- **Jarvis can do anything Switchboard can**: Ask Jarvis for anything on the page, not only the common things: connect or change a calendar, set the weather units, file something into a project, run a browser check, add a routine, archive a conversation, run the network test and more. He finds the action by what you said and does it. Anything that removes waits for your yes, and anything that would reach another person (a reply, a chat, an invitation) is left for you to send. Hold Ctrl+Space and ask.
- **Network test**: A speed test built in: download and upload on 8 connections at once, latency, jitter, packet loss, and bufferbloat (how far latency rises while the line is busy, which is what makes calls stutter), with what the result is good for in plain words and every past test kept on this computer. It runs from this computer against Cloudflare's nearest server, not in the browser, and checks your router too, so you can tell Wi-Fi trouble from internet trouble. Settings, System, Test the network, or Test speed on the monitor.
- **Every project has its own page**: Click a client or project on the left and it opens its own page: what is in flight, its conversations, sessions, notes and files (drop them on the page), and on the side who it is for, how to reach them (everyone you have written to in that project is offered from your mail, Add or Hide) and links to their site, its admin and anything else you open for them. To narrow a list to one project, use the picker at the top of that page.
- **Messages beside your sessions**: Under the session list on Sessions: the newest email and Teams conversations for the session's project (a new one has an orange dot). Add to message puts one into what you are sending the agent; Earlier shows the conversation; Hide or Clear all keeps the list short until someone writes again.
- **Claude's questions in the chat**: When Claude asks you to choose (one answer, several, or your own words), the choices show in the chat with their descriptions: tick boxes for several, Type something to write your own, and a review before it goes. No switching to the terminal.
- **Look at files without downloading them**: A project's files and the files in your notes open inside Switchboard: pictures, PDFs and text, with Download, Copy, and Move or copy to another project, a note or a session.
- **Files and pictures anywhere**: Drop, paste or pick any file: into a session (the agent gets it), onto its terminal, into a note (pictures show in the page), or onto a project. Up to 1 GB each; they stay on this computer.
- **Problems say so**: If something on the page breaks, a line at the bottom says so with Copy details: the version, the page and the error, ready to paste into a bug report. Nothing is sent anywhere.
- **Keyboard shortcuts**: Press ? for every shortcut. G then a letter goes to a page: G N Now, G S Sessions, G I Inbox, G M Money, G O Notes. In a Claude session's terminal, Shift+Enter is a new line and Ctrl+Enter sends now.
- **Undo**: Done, Delete and archiving a conversation can be taken back for a few seconds: Undo on the line at the bottom, or Ctrl+Z.
- **Morning rundown**: Until noon, the top of Now says how the day looks in one sentence: meetings, what needs you, bills this week, packages and routines, with the weather and the schedule. Read aloud uses a voice on your computer. Done for today puts it away; Rundown on the Today card brings it back.
- **Unload local AI models with a click**: Settings, Connections, Local AI models lists what LM Studio has loaded right now, and models Bionic holds (size, status, how long it has sat idle) with Unload and Unload all, to free the graphics card. Jarvis's own model still unloads itself after a few idle minutes; one you loaded yourself stays until you press Unload, with a quiet note after 30 idle minutes. Or say "unload models".
- **Recurring costs, by project**: Money, Recurring costs: everything you pay again and again (rent, hosting, software, insurance) with what it comes to a month and a year, split by project; each project's page shows its own. Charges in your email that come back each month are offered to add in one click.
- **See which notes went to a session**: A note line you sent to a Claude Code session, however it got there, shows where it went and when Claude finished its turn on it. You check it and tick it off: Mark done crosses it out.
- **Send a note to a session that is not running**: Send to session in Notes no longer needs a session open: it offers Start a session in the folders of the note's project (or any folder), starts it, and your note goes in as soon as the agent is ready.
- **One session runs the others**: Ask the session you are talking to to bring in others: it can start a session in another folder or repo with a first message, read what it answered, and end it when the work is done. Every session it starts shows in Sessions like one you started; it can only end its own.
- **Talk to type in Ctrl K**: The mic beside the Ctrl K box: say a note, a reminder, or "sesh" and what to send to a session. Enter stops the mic so you can check the words; Enter again sends.
- **Start a session in a new folder**: New session has New folder… at the top of the folder list: for a new client or idea with no repo yet. Switchboard makes the folder in your code folder, ready to keep its history (and a private copy on GitHub if you tick it) and starts the session there.
- **Queued messages: Send now and Edit**: A message waiting in a session's queue can go in right away (Send now), or come back into the message bar to change (Edit) instead of being thrown away. In Terminal view a click reaches the agent, so a helper it started opens with a click and Esc comes back; End stops everything the session started.
- **Your turn means done**: A session that sent helpers (sub-agents) off to work no longer says Your turn while they are still going: it stays Working with "2 helpers still working" until the last one is back. End on a session's bar asks once, in place, and waits for your answer.
