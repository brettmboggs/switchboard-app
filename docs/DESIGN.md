# Design

How Switchboard looks and why, for anyone (person or agent) building on it.
The brand first, then the tokens, the type, the components, the layout, and
the rules every page keeps to. Everything here lives in `public/css`.

## The brand: three streams, one lamp

The mark: three streams (the inputs, each ending in a dot) bend together into
a ring, the socket of a switchboard jack, with the lamp inside it, and leave as
one line. The idea is the product's: everything you run converges on one place
and comes out as one thing you can act on. The lamp is the state light, the
same light as the `.needs i` dot in the header.

The lamp has three states, and only three:

| State | Lamp | Colour | When |
| --- | --- | --- | --- |
| Needs you | lit | signal `#FF4F00` (`--accent`) | the needs-you count is above 0 |
| Calm | lit | brand cobalt (`--brand`) | before the board has loaded, and the resting app icon |
| All clear | lit | ok `#1F7A4D` (`--ok`) | the board has loaded and the count is 0 |

The rule: **orange means needs you and nothing else.** Cobalt is the brand's
own colour and is used only in the mark (the three dots, and the calm lamp);
it is never a UI state and never a button. The app icon in the dock is calm
(paper and soft cobalt on ink), not orange: an icon cannot know the count.

The streams and ring take the ink of whatever they sit on: ink `#15171C` on
paper and the counter, paper `#FCFCFA` on ink (the dock tile, dark surfaces, a
dark tab strip). Cobalt is `--brand` (`#4967E8` on light, `#8EA0FF` on dark).

### Geometry

viewBox `0 0 48 48`, stroke based so it scales. One drawing, three cuts, all
made by `markShapes` in `scripts/icons.mjs`:

| Cut | Used for | Stroke | Ring | Input dots | Lamp |
| --- | --- | --- | --- | --- | --- |
| full | the app icon, the PWA icons, the brand pack | 4 | r 7.6, 3.6 | r 3 | r 3.3 |
| heavy | beside the bold wordmark text, in the header and the welcome | 4.8 | r 8, 4.2 | r 3.4 | r 3.6 |
| small | the favicon, 16 to 32 px | 5 | r 8, 4 | none | r 3.9 |

Rows at y 10, 24 and 38; the streams run level to x 6 (the dots), bend between
x 11 or 12 and the ring with level tangents at both ends, and meet at the ring's
left edge; the ring is at (28, 24); one stream leaves on the right to x 44. The
small cut drops the dots because at 16 px they merge into the line ends; a
thinner ring went grey and a smaller lamp merged into it. Do not add detail.

The wordmark is the mark (heavy cut) and the word **switchboard** in Public
Sans Bold, lowercase, letter-spacing -0.02em, the lamp on the word's x-height
midline and the mark about 30% taller than the tallest letter. In the page it
is live text beside an inline SVG (`MARK_SVG` in `core.js`, styled by
`css/brand.css`: dots `--brand`, lamp `--lamp`, set by `data-board` on the
page). The standalone SVGs in `docs/brand` have the letters turned into
outlines (`scripts/wordmark.json`, made once with fontTools and HarfBuzz from
the shipped Public Sans at weight 700 with kerning) so they need no font. To
change the word or weight, regenerate that JSON the same way.

### Where each asset lives

| Asset | Path | Made by |
| --- | --- | --- |
| App icon (calm, paper and soft cobalt on an ink tile, rx 12/48) | `public/icon.svg` | `scripts/icons.mjs` |
| PWA icons | `public/icon-192.png`, `public/icon-512.png` | `scripts/icons.mjs` |
| Maskable PWA icon (full-bleed ink, mark in the central 60%) | `public/icon-maskable.png` | `scripts/icons.mjs` |
| Desktop app icons (32, 64, 128, 128@2x, icon.png, .icns, .ico) | `desktop/src-tauri/icons/` | `tauri icon` from the 1024 px render |
| Brand pack: app icon, mark (colour, light, monochrome, small cut), wordmark (colour, light, monochrome) | `docs/brand/*.svg` | `scripts/icons.mjs` |
| Live favicon with the state in the lamp | `public/js/favicon.js` | hand-kept copy of the small cut |
| Header and welcome wordmark | `public/index.html` (header, a static copy) and `MARK_SVG` in `public/js/core.js`; `public/css/brand.css` | hand-kept copy of the heavy cut |
| Manifest colours (theme ink, background counter) | `public/manifest.webmanifest` | hand-kept |

The favicon reads the needs-you count from `document.title`, which
`renderShell` in `core.js` sets to `(n) Switchboard`, through a
MutationObserver on the `<title>` element; it touches nothing else on the
page. Its lines follow `prefers-color-scheme`, not the page theme, because the
tab strip is the browser's. The page's own lamp follows `data-board` on `<html>`,
set in the same place.

### Regenerating

```
node scripts/icons.mjs            # icon.svg, docs/brand/*.svg, the three PNGs, and a 1024 px PNG in the temp dir
cd desktop && npx tauri icon <the 1024 px path the script prints>
```

`scripts/icons.mjs` renders the PNGs with a headless Chrome through
Playwright. It finds `playwright-core` from `$PLAYWRIGHT_CORE`, a local
install, or the global `@playwright/cli` next to the running Node (that last
one is the development machine); Chrome from `$CHROME`, else
`/usr/bin/google-chrome-stable`, else Playwright's own. `--svg` writes only the
SVGs and needs no browser.

`tauri icon` also writes `android/`, `ios/`, `Square*Logo.png` and
`StoreLogo.png`; `tauri.conf.json` references none of them, so delete them.
Keep the geometry in `scripts/icons.mjs`, `public/js/favicon.js` and
`MARK_SVG` in step if it ever changes.

## Tokens

`public/css/tokens.css` is the one place a value is decided. Every other file
uses a token by name; **no hex colour, pixel font size, radius or shadow is
written anywhere else** (the GitHub run yellow and the terminal's sixteen ANSI
colours are the two exceptions, and both are tokens or fallbacks too).

| Group | Tokens | Values |
| --- | --- | --- |
| Spacing | `--sp-1` to `--sp-8` | 4, 8, 12, 16, 20, 24, 32, 40 px |
| Type scale | `--fs-xs` `--fs-sm` `--fs-base` `--fs-md` `--fs-lg` `--fs-xl` `--fs-2xl` `--fs-3xl` | 11, 12.5, 14, 15, 17, 20, 26, 32 px |
| Line heights | `--lh-tight` `--lh` `--lh-loose` | 1.25, 1.45, 1.6 |
| Faces | `--font-display` `--font-body` `--font-mono` | Fraunces, Public Sans, JetBrains Mono (with system fallbacks) |
| Display setting | `--display-weight` `--display-opsz` `--display-soft` | 600, auto, 30 |
| Radii | `--r-xs` `--r-sm` `--r-md` `--r-lg` `--r-xl` `--r-pill` | 3, 6, 10, 14, 18, 999 px |
| Elevation | `--shadow-1` `--shadow-2` `--shadow-3`, `--con-shadow` | a hairline, a popover, a dialog; one for the dark console |
| Layers | `--z-bar` `--z-overlay` `--z-popover` `--z-toast` `--z-prompt` | 5, 10, 20, 30, 40 |
| Frame | `--top-h`, `--zoom` | 64 px; the text-size setting |

Colour comes as roles, in one light block and one dark block:

| Role | Light | Dark | Use |
| --- | --- | --- | --- |
| `--bg-canvas` | #E4E7EB | #0F1115 | the counter the page sits on |
| `--bg-surface` | #FCFCFA | #191C22 | paper: cards, dialogs, buttons |
| `--bg-raised` | #FFFFFF | #121419 | a field you type in |
| `--bg-hover` / `--bg-selected` | #F4F5F6 / #F1F2F4 | #21252C / #262A32 | a row under the pointer / the open one |
| `--fg` / `--fg-muted` | #15171C / #5C626C | #ECEDEF / #9BA1AA | ink; the second line |
| `--border` / `--border-soft` / `--border-faint` | #CDD1D7 / #DCDFE4 / #EAECEF | #2F343C / #272B32 / #24282F | a control's edge / a card's edge / a hair-line between rows |
| `--accent` / `--accent-fg` / `--accent-text` | #FF4F00 / #15171C / #B33300 | same / same / #FF8A57 | the one orange; ink on it; orange as text |
| `--accent-tint` `--accent-ring` `--accent-half` | orange at 8 %, 12 %, 50 % | | a wash, a focus ring, an edge that asks |
| `--ok` `--bad` `--info` `--warn` (+ `-tint`) | green, red, blue, ochre | lighter | passed, failed, working, waiting on others |
| `--placeholder` | #747A84 | #8B919B | placeholder text, 4.5:1 on its field |
| `--ci-run` / `--ci-glow` | GitHub's running yellow | | the Builds dot only |
| `--knob` `--fg-on-color` `--mail-paper` `--mail-ink` `--overlay-ink` | fixed | fixed | the toggle knob; initials on a project colour; an email preview; a button over an image |

The console block (`--con-bg`, `--con-bg-2`, `--con-bg-3`, `--con-border`,
`--con-border-2`, `--con-fg`, `--con-fg-strong`, `--con-fg-soft`,
`--con-fg-dim`, `--con-muted`, `--con-faint`, `--con-accent-text`, `--con-ok`,
`--con-bad`, `--con-info`, `--con-warn` and their `-2` brights,
`--con-code-bg`, `--con-selection`, `--con-thumb`, `--con-inline`) is always
ink, in both themes: the session bar, terminal, chat and message bar sit on
it. `TERM_THEME` in `public/js/sessions.js` reads these with
`getComputedStyle` when the page loads, so the terminal and the chat are one
palette; change a console colour here and both follow.

The old names (`--counter --paper --ink --muted --signal --line --soft
--field --hover --sel --card-line`, the `--tint-*`, `--con --con-2 --con-3
--con-line --con-ink`, and `--display --body --mono`) are aliases of the
roles above. Nothing new should use them.

## Type

Three faces, shipped in `public/fonts` (Latin subsets, variable weight 400 to
700, OFL; `public/fonts/LICENSES.md`), declared in `public/css/fonts.css`
with `font-display: swap`. The page loads nothing from Google.

- **Fraunces** is the display face, and it has **one setting**: the
  selector list at the top of `base.css` (`.display, .mark, .page-head h1,
  .card h2, .sheet h2, .tile .big, .ed-title, .ed-doc h1 …`) sets
  `font-weight: var(--display-weight)` (600), optical sizing on,
  `"SOFT" 30` for the warmer cut, and a touch of negative tracking that
  tightens at the big sizes. A new heading joins that list or takes
  `.display`; nothing sets a second weight or stretch. It appears on the
  wordmark, page titles, card titles, dialog titles, the money figures, the
  welcome, a page's title in Notes. Not on buttons, not on rows.
- **Public Sans** is everything else, 15 px / 1.45 (`--fs-md`, `--lh`).
  Weights: 400 for reading, 500 for a quiet label, 600 for a name or a
  button, 700 only for the session's name on its bar. Numbers that line up
  (money, times, counts, the sessions' states) carry
  `font-variant-numeric: tabular-nums`.
- **JetBrains Mono** is for readouts: the kicker, a count, a path, a branch,
  a time, code, and the terminal itself. `.mono` is 11 px with a little
  tracking; `.kicker` is 11 px, 500, uppercase, `.08em` tracking, muted. The
  terminal is the one place a font size is set in a script (Settings, General,
  Terminal text).

Sizes come from the scale only; the chat and the editor scale their text with
`calc(var(--fs-md) * var(--chat-k))` and the editor's own `.fs-*` classes.

## Components

One rule each. `public/css/components/*.css`, one file per component; a page
that needs a variant adds a modifier or a page-scoped override in its own
file, never a copy. **A new component gets its file under `css/components`
and a paragraph here.**

**Button** (`button.css`). `.btn` is outlined in ink on paper, 600, a pill,
32 px tall. Variants: `.btn--primary` (orange, ink text: the one action that
goes somewhere, Send, Start, Connect), `.btn--quiet` (a soft border, 500:
Close, Done, Settings, Copy), `.btn--ghost` (no box, underlined muted text:
Skip, Show all), `.btn--danger` (red outline; `[data-sure]` is the armed
second click), sizes `.btn--sm` (26 px) and `.btn--lg` (40 px), and
`.btn--wide`. Inside the console (`.chat-host`, `.term-bar`,
`.term-compose`) a `.btn` takes the console's border and text by itself.
`.actions` is a row of them. `.mic` is the round talk-to-type button (pulses
while listening, dims while thinking). The session bar's own small controls
(`.tb-btn`, `.tb-segb`), the message bar's tools (`.ptool`, `.send`), the
rail (`.space`, `.page-link`) and a few page-specific pressables keep their
own rules, on tokens.

**Tabs** (`chip.css`, `.chips.tabs`). A page's own tabs (Now's filters,
Inbox's Business · Personal · Reading, Notes' four, Sessions' three) are one
style everywhere: words in 600, muted, with a 2 px line under the one you are
on and its count in mono beside it. Pills (plain `.chips`) are only for the
smaller filters inside a tab (Inbox's All · Email · Teams).

The rail's current page is paper with a hairline, not a solid ink block, and
the need-you count is an orange-tinted bar with the number in `--accent-text`
(paper when nothing needs you): the loudest thing on screen is what needs you.

**Chip and pill** (`chip.css`). `.chip` is a filter or tab you press (the
Now filters, Inbox's projects, Notes' tabs) with its count in `.c`; pressed
is solid ink. `.pill` is a state word on a card or row, mono uppercase
("FAILED", "DONE"); the colours per state live beside the thing that shows
them (`.st-*` in `pages/now.css`). `.pill--soft` is the same shape in body
type for a package or weather note. `.via` is the little bordered source
label on a row.

**Card** (`card.css`). Paper, `--border-soft`, radius `--r-lg`, 16/18 px
padding. Every box on the page is one, through the selector list in the file
(`.card .tile .acct-card .proj .toggles .w-use .w-conn .unlock-way
.prompt-card .job .convo .rt-ideas .ed-logsum`): a new box joins the list
rather than drawing its own edge. `.card--tight` (tiles) has less padding;
`.card--line` (a box on paper, inside a dialog) uses the firmer `--border`.
`.card h2` is the title row, with `.count` and `.aside` as quiet mono notes.

**Row** (`row.css`). One line in a list: full width, left aligned, a
hair-line (`--border-faint`) above every row but the first in its `.list`,
`--bg-hover` under the pointer, `--bg-selected` when open. The base is shared
by `.item` (board rows: tag, title `.t`, second line `.s`, right column
`.r`), `.ci-row`, `.send-term`, `.ship`, `.nb-item`, `.cmd-hit`, `.bring-add`,
`.bring-msg` and `.slash-opt`; each sets only its columns. Rows that float
(`.ship`, `.nb-item`, `.cmd-hit`, the popover rows) have no hair-line and a
`--r-md` corner. The sessions list (`.line`) is deliberately quieter and keeps
its own rule in `pages/sessions.css`. `.tag` is the 9 px square of a
project's colour.

**Field** (`field.css`). Every input, select and textarea: `--bg-raised`, a
`--border` edge, radius `--r-md`, 8/11 px padding; the border turns ink on
focus. Forms that emit bare `<input>`s are in the selector list rather than
styling their own. `.field--sm` is the compact select on a row; `.field--bare`
has no box (the page title in Notes). `.form-grid` is a label column and a
field column; `.form-row` a row of them; `.field-label` the small muted label
above one. Placeholders are `--placeholder` everywhere.

**The side panel lines up** (`detail.js`, `alignPanel`). The detail panel on
the right starts level with the first block under the page's title (its first
card, Money's tiles, Inbox's list below its chips), not with the title, so the
top edges of the two columns meet. Measured after each draw; Sessions places
its own panel, and in a narrow window the panel sits underneath.

**Dialog** (`dialog.css`). Every dialog is a `.scrim` (fixed, the whole
window, `--z-overlay`, shown with `.open`) holding one box: `.palette`
(Ctrl K), `.sheet` (a form with `.sheet-head`), `.drawer` (from the right),
`.prefs` (Settings) or `.welcome`. The boxes share one surface: paper,
`--r-xl`, `--shadow-3`. A dialog never grows past the window
(`--dialog-max-h`): its frame stays put and only its contents scroll. The
head (title, Close or Done, and in Settings the sections down the left) is
sticky; the page behind never scrolls with it (`overscroll-behavior:
contain`). Every new dialog, panel or drawer does the same: the frame is
fixed, the contents move. Open them only through `openDialog(id)` /
`closeDialog(id)` in `core.js`: it remembers the opener, puts focus on the
first `[autofocus]`, field or heading inside, makes `.top` and `.frame`
`inert`, keeps Tab inside, and on close restores focus and the page. A
`[data-close="id"]` button or a click on the scrim closes; Escape closes the
topmost only. The account prompts (`.prompt-card`, `.acct-prompts`) sit over
everything at `--z-prompt`. The toast (`.toast`) is in this file too: one
line at the bottom, `--z-toast`; `toast(msg, { kind: 'error' })` gives it a
red edge and six seconds instead of three; `{ undo }` adds an underlined
Undo (`.toast-undo`, Ctrl+Z too) and keeps it up while the undo can be taken.
Done, Delete and archive use it through `doLater()` in actions.js: hidden at
once, sent six seconds later, sent at once if the page is left.
`{ action: { label, run } }` puts any other button there the same way:
`oops()` (actions.js) uses it for "Something went wrong on this page" with
Copy details, on any uncaught error or rejected promise on the page (one per
ten seconds; network drops while the server restarts and extension errors are
left out).

**Files** (`pages/sessions.css` `.q-file`, `pages/notes.css`). In the
message bar a picture is a 72 px square thumbnail and any other file a card of
the same height with its name (600) and size (mono); both have the round ×.
In a note a picture fits the page's width with a soft edge, and a file is a
bordered chip with a paperclip that downloads it. Nothing from outside is
ever shown inline except PNG, JPEG, GIF, WebP, AVIF and BMP.

**Messages beside a session** (`pages/sessions.css` `.ses-msgs`,
`public/js/bring.js`). Under the session list on Sessions, a kicker
"Messages · <project>" with All, then the project's six newest
conversations: who (600, an orange dot when unread), when, three lines of the
newest message, and Add to message, Earlier and Hide, always visible; Clear
all in the head. Hidden is for this list only (Inbox is untouched) and lasts
until someone writes again (`prefs.msgHidden`, this computer's settings).

**Keys** (`keys.css`, `public/js/keys.js`). `kbd` is a small paper key cap
in the mono face with a heavier bottom edge; two keys pressed together are
joined by a muted +, a sequence by "then". The ? sheet lists every shortcut
in groups (a kicker each), the keys on the left, what they do on the right.

**Project page** (`pages/project.css`, `public/js/project.js`). A project's
own page: a head with its colour square and name, then two columns, the work
(In flight with the same `.job` cards as Now, Conversations, Sessions, Notes,
Files) and a sticky side card (About, People, Links; Edit turns it into a
form in place). Links are bordered blocks with the label over the address in
mono. Found in your mail is one line per person (name, then address,
messages and when, muted) with Add and Hide. The Files card is where drops land: a dashed ink edge while a file is
dragged over the page, never orange. `.proj-filter` is the project picker in a
list page's head (a `.field--sm` select); with a project picked its edge turns
ink, so a narrowed list never passes for the whole list.

**Reading** (`pages/inbox.css`, `public/js/feeds.js`). The third tab on Inbox:
one row per post, the feed's name as the `via` label, unread in bold and read
ones muted. Unread has no dot: the orange dot on Inbox means a person is
waiting on you, and a blog post never is.

**Recurring costs** (`pages/money.css`, `public/js/costs.js`). One card: the
month and year totals in mono in its head, a line of each project's share
with its colour square, one row per cost (the amount, and per month under it
when it is not monthly), then Looks recurring with Add and Not recurring.
Adding and editing are a form in the side panel that is not redrawn while it
is open.

**Morning rundown** (`pages/rundown.css`, `public/js/rundown.js`). Takes
the Today card's place on Now until noon (or when Rundown is pressed on it).
A kicker with the date, the greeting in Fraunces at `--fs-3xl`, one lead
paragraph of plain sentences at `--fs-lg`, then up to four figures between two
hairlines (a big display number, a 600 label, a mono note; the needs-you one is
`--accent-text`), then two columns: the schedule (the Today card's `.ev-list`)
and the lists (needs you, bills, routines, packages) as `.rd-row`s with a mono
time or day on the left. One column under 760 px. Read aloud and Done for
today are quiet small buttons; nothing else on it is orange.

**Connections** (Settings, `pages/settings.css`, `public/js/connections.js`,
`public/js/connlist.js`). Two parts under one search box. Your connections:
the cards you use (connected, or added and not finished), in groups with a
small mono label (Messages, Calendars, Money, Coding and sessions, Automation);
an unconnected one has a ghost "Remove from list". Add a connection: category
chips over a grid of `.conn-tile`s, each a name, one line and an Add button;
Coming soon tiles are dashed with no button, since a button only appears once
it does something.

**Chart** (`chart.css`). Live numbers drawn as pictures, used by the System
monitor (`pages/system.css`, `public/js/sysmon.js`). `.chart` is an SVG that
stretches to its box: a smooth line over a soft fill of its own colour
(`--series`, set by `.s-info`, `.s-ok` or `.s-ink`; tokens only), dashed grid
lines at quarters, a scale label top and bottom, and on hover a cursor, a dot
and a read-out ("62% · 14 s ago"). `.meter` is a bar (`--lo` info, `--mid`
warn, `--hi` bad, `--ok`), `.segbar` one bar cut into parts with a
`.seglegend`, `.dial` a ring for a fan. Charts are never orange: orange is the
one verdict line that says something is straining, the same "needs you" rule as
everywhere. The page builds its skeleton once and updates it in place, so a
refresh never interrupts a hover, a scroll or typing. `prefers-reduced-motion`
turns the transitions and the live dot's pulse off.

**In this project and Unsorted** (`members.css`, `public/js/members.js`,
`public/js/unsorted.js`). A project's page opens with `.mb-card`: three
columns of kinds (Repos and folders · People and mail · Notes), each a stack
of `.mb-tile`s on white with a mono icon square (`.mb-ico`: gh, @, initials, ¶
for a page, § for a section). The name is 600 and the line under it says what
the thing is and what it brings. A dashed `.mb-add` sits at the foot of each
column. × to take a thing out shows on hover (always on touch). A note's tile
has a small select for which repo's sessions it shows in. Add opens the Ctrl K
palette's box with its own results, so finding things looks the same
everywhere. Unsorted is one card of `.us-row`s: icon, name and line, the likely
project as a bold pill (`.us-target.sug`), the two most used as plain pills,
Other… and a quiet Hide. The "folders that are not repos" offer is an info-blue
`.us-tip`: blue, never orange, since sorting never needs you. The rail's
Unsorted count is muted for the same reason.

**File links and the reader** (`fileview.css`, `public/js/fileview.js`). A
file name an agent writes in the chat that exists on this computer is
`.file-link`: console blue (`--con-info-2`) with a dotted underline that goes
solid on hover; blue, never orange, since a file is not something that needs
you. Files the agent sends are `.cf-card`s (a picture shown, then the name and
its folder in mono). The reader is a `.sheet.file-sheet`: the paper head holds
the name, where it is, and Open · Show in folder · Copy where it is · Close as
quiet buttons; the page under it is console ink (`.fv-body`), so markdown reads
exactly as in the chat, code has line numbers and the named line is lit
(`--con-lit`, blue).

**Draft** (`pages/inbox.css`, `public/js/drafts.js`). An email draft is a
dashed card, so it never reads as sent: a small blue Draft tag (blue, since
orange means needs you), who it is to and when, then the subject and text.
Edit turns it into labelled fields and a tall text box in place, with Send
(primary), Save draft, Cancel and, set apart, Discard, which asks once in place.

**Kicker** (`base.css`). The small mono uppercase label over a group or
beside a value: `.kicker`, with the older names a script still emits
(`.section-label .ship-label .ls-k .rail h3 .facts dt .cv-sub .cv-day …`)
in the same selector list. One rule; do not restyle it locally.

## Signing in

Every sign-in is a click away and easy to finish. The block is one section in
the item's panel: a sentence saying where things stand, then the button that
moves it on (**Sign in**, then **Done, I'm signed in** and **Cancel** while the
window is up, **Sign in again** and **Sign out** once saved), and a muted
line saying what is kept and where. When one is required it is also a Needs-you
card on Now with the label "Sign in". Built in public/js/checksauth.js; copy it
for the next one rather than inventing a new flow. The rules behind it are in
AGENTS.md.

## Layout and z-order

`layout.css`: there is no top bar. The frame (`.frame`) is a grid of the
rail (`--rail-w`, 244 px), the page, and the detail panel (360 px), which is
there only when it has something to show: a picked item, or the session list
on Sessions (`renderDetail` sets `body[data-panel]`); otherwise the page takes
the width. 1280 px drops the panel under the page; 860 px stacks everything
and the rail becomes a block that scrolls away. `--top-h` is now only the
space above a page.

The rail (`.rail`, as tall as the window, stays put) holds everything the top
bar did, each with a fixed place: at the top the wordmark with **What's new**
beside it (a small `--info` word, only while something is new; it opens the
list and counts as checked), Search or add (Ctrl K), and the need-you count
(jumps to Needs you); then the pages and projects; and at its foot a broken
connection in red, **Update ready** (orange: it needs you), Install app, and
Windows, Check now (↻) and Settings. Nothing in it moves between pages.

Now is rows, not cards: one group per state (Needs you, Working, Waiting on
others, Done, Open), a row each with the project's dot, what it is (600),
where from (muted), the state as a word in its colour and how long ago
(`.now-row`, `pages/now.css`). Today folds to one line (`.today-strip`) with
Show the day and Rundown; unfolded it is the full card. Sessions and the Inbox
conversation view override the frame in their own files to fill one screen.

Layers, from the tokens: the sticky bars at 5, a dialog's scrim at 10, a
popover (the session menu, the weather results, a swatch picker) at 20, the
toast at 30 (so a menu never hides under it), and the prompts (the account
prompt cards, the slash menu and bring-in sheet over the message bar) at 40.
Anything that is not one of those five is not positioned above the page.

## Motion

Short and functional: 120 to 150 ms for hover and focus, the mic's pulse, the
build dot's glow, three dots while an agent works, a flash to point at a
thing. One rule in `base.css` under `prefers-reduced-motion: reduce` cuts
every animation and transition to nothing; no component carries its own.
Scrolling into view uses `behavior: 'smooth'`, which that rule also turns off.

## Accessibility rules

- **Focus** is always visible: a 2 px orange ring, 2 px out, on
  `:focus-visible`, on everything (a dialog's heading, focused by script on
  open, is the one thing without it). Dialogs trap Tab and give focus back.
- **Contrast** minimums: 4.5:1 for text, 3:1 for a control's edge and for
  large display text. `--fg-muted` is 6.6:1 on paper; `--placeholder` 4.5:1;
  `--con-muted` 5.9:1 on the console; text on orange is ink, never white.
  Orange as text is `--accent-text`, not `--accent`.
- **Live regions**: the toast (`role="status"`), "Saved" in Settings and the
  chat's live end (`#chat-live`: the question or what the agent is doing) are
  `aria-live="polite"`. The transcript itself is not live; a long answer
  would be read in full.
- **Names**: an icon-only button has an `aria-label` (Check everything now,
  Dictate, Send, Add an image); decorative marks (the lamp, the welcome's
  step dots, toolbar glyphs) are `aria-hidden`.
- **Reduced motion** is honoured by the one global rule; nothing needs to opt in.
- **Keyboard**: Ctrl K opens the command bar, Escape closes the dialog on
  top, Enter sends, Shift+Enter breaks a line, arrows move through the slash
  menu and search results.

## Dark theme

`:root[data-theme="dark"]` sets the same colour roles again and nothing
else; no rule says "in dark do this" except the few that must (the orange
count on an ink button turns to the lighter orange text). `applyPrefs` in
`settings.js` sets `data-theme` from Settings, General (Light, Dark, Match
computer) and stores it so the next load paints right at once. The console is
ink in both themes by design, so a session looks the same whichever is on.
`color-scheme` follows the theme so native controls and scrollbars match.
Check both: the screenshot script in the review notes runs every page light
and dark.

## How to add a page

1. The page's script in `public/js/<page>.js`, registered in `PAGES`
   (`core.js`) and loaded by `index.html` in order.
2. Its styles in `public/css/pages/<page>.css`, linked from `index.html`
   after the components; the server serves it by name (`PAGE_CSS` in
   `server.js`) and the file is part of `BUILD`, so an open page reloads
   when it changes. Only tokens inside; use `.card`, `.row`, `.btn`,
   `.chip`, `.field`, `.kicker` before writing a rule.
3. A heading uses `.page-head h1` (or joins the display list); lists use
   `.list` and `.row`; anything that opens over the page goes through
   `openDialog`.
4. An entry in `public/setup.js` so the welcome and What's new
   show it, a line in `CHANGELOG.md`, and the README section that explains
   it.
5. Screenshots light and dark before it ships; the orange rule holds: if it
   is orange, the person has to do something about it.
