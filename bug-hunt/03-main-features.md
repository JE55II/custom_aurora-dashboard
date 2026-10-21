# Main features findings — activity tracking, daily notes, capture, search plumbing

Scope: `src/main.ts` (activity tracking, `formatDate`, `dailyNotePath`, `noteExistsFor`, `openDay`,
`openFile`, `openSearch`, `captureText`, `showQuickCapture`, and their helpers) plus the two helpers
they lean on in `src/utils.ts` (`formatDate`, `dateKey`). Settings load/save/migration/registration
are another agent's area and are not covered here.

Everything marked **executed** was produced with the README recipe:

```powershell
npx tsc --outDir bug-hunt/scratch-03-features/build --module commonjs --target es2018 `
  --moduleResolution node --skipLibCheck --noEmit false --esModuleInterop `
  --lib es2018,dom --strict false src/main.ts
node bug-hunt/scratch-03-features/verify.cjs        # exits 0, full log in verify-out-final.txt
```

`verify.cjs` wraps the jsdom stub vault in `scratch-03-features/helpers.cjs` so it behaves like the
real Obsidian vault where it matters: `vault.create()` / `vault.modify()` reject when the parent
folder does not exist, and a folder is visible to `getAbstractFileByPath()`. That is required to see
BUG-03/04/05/06 at all — the raw stub silently creates files inside folders that could not exist.

---

## BUG-01 — `formatDate` replaces every token only once, so repeated tokens are left half-substituted

- **Severity**: medium
- **Where**: `src/utils.ts:15-27` (function `formatDate`), consumed by `src/main.ts:150-158` (`formatDate`, `dailyNotePath`)
- **What**: The formatter is a chain of `String.prototype.replace(token, value)` calls — `YYYY`, then
  `YY`, then `MMM`, `MM`, `ddd`, `DD`, `dd`. `String.replace` with a string pattern replaces **only
  the first occurrence**, so in any format that uses the same token twice, or that contains a token
  matched by a later rule, the literal token text survives into the file name.
- **Why it's wrong**: `dailyNoteFormat` is a free-text setting and Obsidian's own Daily Notes core
  plugin (moment.js) replaces every occurrence of every token. A user copying a familiar format such
  as `DD.MM.DD`, `MM/DD/MM` or `ddd, DD MMM YYYY` gets literal `DD`/`MM` characters in the file name,
  and the second `ddd` of a format like `ddd, DD MMM YYYY (ddd)` is even matched by the later `DD`
  rule and turns into `15d`. Because tokens are substituted left to right, a format that omits a
  distinguishing part and repeats another (e.g. `MM/DD/MM`) can also make two different days resolve
  to the same file — see BUG-02 for the deterministic version of that collision.
- **Trigger / repro** (executed):

  ```
  ## BUG-01 formatDate() — chained String.replace substitutes each token only once
  formatDate(2024-06-15, "YYYY-MM-DD")           = "2024-06-15"
  formatDate(2024-06-15, "MM/DD/MM")             = "06/15/MM"
  formatDate(2024-06-15, "DD.MM.DD")             = "15.06.DD"
  formatDate(2024-06-15, "ddd, DD MMM YYYY (ddd)")= "Sat, 15 Jun 2024 (15d)"
  formatDate(2024-06-15, "YYYY YYYY")            = "2024 24YY"   <- YYYY consumed, token 2 re-substituted from "2024"
    dailyNotePath with a repeated token (the surviving literal DD is what varies, so two days
    land on two real files whose NAMES are not what the user configured):
      dailyNoteFormat="DD/MM/DD" 2024-06-15 -> "Daily/15/06/DD.md"
      dailyNoteFormat="DD/MM/DD" 2024-06-16 -> "Daily/16/06/DD.md"
  ```
  `DD.MM.DD` becomes `15.06.DD.md`, `ddd, DD MMM YYYY (ddd)` becomes `Sat, 15 Jun 2024 (15d)` (the
  second `ddd` was matched by the later `DD` rule — `"Sat".replace("DD", "15")` → `"15d"`), and
  `YYYY YYYY` re-substitutes inside the year it just wrote.
- **Impact**: Daily notes get names like `15.06.DD.md` and `Sat, 15 Jun 2024 (15d).md`. Because
  `dailyNotePath` is the single source of the path for the calendar dots (`calendar.ts:68`), streaks
  (`streak.ts:21`), the Today widget (`content.ts:74`), capture (`main.ts:201`) and `openDay`, those
  all agree on the polluted path — and it never matches the notes Obsidian's own Daily Notes core
  plugin creates from the same format string, so an existing daily-note folder looks empty to the
  dashboard. (Severity is medium rather than high because the surviving literal is stable: for
  `DD.MM.DD` the days do not merge, the names are just wrong. BUG-02 covers the format values that
  really do merge days.)
- **Impact**: Daily notes get names like `15.06.DD.md`; calendar "has-note" dots, streaks, the Today
  widget and capture all agree on the wrong, token-polluted path, and the user's real daily notes
  (created by Obsidian's Daily Notes core plugin) are never found again.
- **Evidence**: executed (output above, from `bug-hunt/scratch-03-features/verify.cjs`)
- **Confidence**: high
- **Suggested fix**: do one regex pass instead of a chain:
  `fmt.replace(/YYYY|YY|MMM|MM|ddd|DD|dd/g, (t) => ({YYYY: String(y), YY: String(y).slice(-2), MMM: months[m], MM: pad(m+1), ddd: days[dow], DD: pad(day), dd: pad(day) })[t])`.

## BUG-02 — `dailyNotePath` uses `dailyNoteFormat` verbatim: hidden/nameless files, colliding days, path traversal

- **Severity**: high
- **Where**: `src/main.ts:154-158` (`dailyNotePath`), settings declaration `src/main.ts:425-428`
- **What**: `dailyNoteFolder` is `.trim()`ed, but the formatted `name` is pasted into the path with no
  validation: no trim, no empty-check, no illegal-character check, no `..` check, and no requirement
  that the format contains a day token. The README (`README.md:77`) documents the setting only as
  "folder and filename format (tokens …)", so all of these are user-reachable.
- **Why it's wrong**: A format that does not contain a day token makes every day of the month resolve
  to one file — the calendar marks the whole month, `openDay` opens yesterday's note for tomorrow and
  capture silently appends to the wrong day (data loss). An empty/whitespace format produces `.md` /
  `   .md`, which is a hidden dot-file or an unopenable second file on Windows. `../` in the format
  escapes the configured daily-note folder (and the vault, from the vault root) because
  `normalizePath` normalises slashes but does not resolve `..`. Characters illegal on Windows
  (`: * ? |`) are passed straight through to the vault write.
- **Trigger / repro** (executed):

  ```
  ## BUG-02 dailyNotePath() — dailyNoteFormat is used verbatim (no trim, no invalid-char/path check)
    (a format with no day token maps every day onto ONE file)
    fmt=""             -> "Daily/.md"                    16th -> "Daily/.md"                    same-file-for-two-days=true
    fmt="   "          -> "Daily/   .md"                 16th -> "Daily/   .md"                 same-file-for-two-days=true
    fmt=" 2024-06-15"  -> "Daily/ 2024-06-15.md"         16th -> "Daily/ 2024-06-15.md"         same-file-for-two-days=true
    fmt="a:b*c?d|e"    -> "Daily/a:b*c?d|e.md"           16th -> "Daily/a:b*c?d|e.md"           same-file-for-two-days=true
    fmt="../../outside" -> "Daily/../../outside.md"       16th -> "Daily/../../outside.md"       same-file-for-two-days=true
    fmt="/etc/passwd"  -> "Daily/etc/passwd.md"          16th -> "Daily/etc/passwd.md"          same-file-for-two-days=true
    fmt="YYYY/MM/DD"   -> "Daily/2024/06/15.md"          16th -> "Daily/2024/06/16.md"          same-file-for-two-days=false
    fmt="note"         -> "Daily/note.md"                16th -> "Daily/note.md"                same-file-for-two-days=true
    fmt="YYYY-MM"      -> "Daily/2024-06.md"             16th -> "Daily/2024-06.md"             same-file-for-two-days=true
    fmt="YYYY"         -> "Daily/2024.md"                16th -> "Daily/2024.md"                same-file-for-two-days=true
  ```
  (`YYYY-MM` and `YYYY` are deliberately included: they are the realistic "no day token" settings —
  every day of June resolves to `Daily/2024-06.md`.)
- **Impact**: Silently merging several days into one note (irreversible: capture appends, `openDay`
  creates an empty file), creating files the user cannot see (`Daily/.md`) or open on Windows
  (`Daily/a:b*c?d|e.md`, `Daily/   .md`), and writing outside the folder the user configured.
- **Evidence**: executed (output above)
- **Confidence**: high
- **Suggested fix**: after formatting, `name.trim()`; reject an empty result; require the format to
  contain a day token (or fall back to `YYYY-MM-DD`); replace `/\:*?"<>|/` with `-` or `/`; and reject
  a result containing `..` or starting with `/`.

## BUG-03 — `openDay` never creates `dailyNoteFolder`, so the documented "click a day to open or create it" fails

- **Severity**: high
- **Where**: `src/main.ts:128-141` (`openDay`)
- **What**: `openDay` checks for an existing file and otherwise calls `vault.create(path, "")` directly.
  It never creates the folder part of the path — unlike `captureText`, which calls `ensureFolder`
  (`src/main.ts:197` / `204`) before writing. With `dailyNoteFolder` set to a folder that is not on
  disk yet (the normal state for a fresh install that just typed "Journal"), `vault.create` rejects
  and the generic `Notice("Could not create the note for that day.")` is shown.
- **Why it's wrong**: `README.md:14` promises "the calendar and Today widgets open, **create**, and
  manage your daily notes" and `README.md:28` says "click a day to open or **create** it". The
  creation half of the feature does not work at all until the user manually creates the folder. Two
  call sites are affected: `src/widgets/calendar.ts:70` (every day cell) and
  `src/widgets/quickactions.ts:85` (the "Today's note" quick action).
- **Trigger / repro** (executed): set `dailyNoteFolder = "Journal"` (folder absent), format
  `YYYY-MM-DD`, then call `plugin.openDay(d)`:

  ```
  ## BUG-03 openDay() — does not create dailyNoteFolder (calendar day click / Quick action 'Today')
    dailyNoteFolder="Journal" (not yet on disk), format YYYY-MM-DD
    openDay(2024-06-15) -> Notice="Could not create the note for that day."  file created=false
    vault contents: []
    same settings, capture target = daily (captureText DOES create the folder):
    captureText("hi") -> ok (Notice="Captured")
    vault contents: ["Journal","Journal/2026-09-11.md"]
  ```
- **Impact**: The calendar and "Today's note" quick action are dead in exactly the configuration the
  Daily-notes settings group invites the user to create. The user sees a message that does not say
  which folder is missing, and no note is created.
- **Evidence**: executed (output above)
- **Confidence**: high
- **Suggested fix**: `await this.ensureFolder(dirOf(path))` before `vault.create` in `openDay`
  (same helper `captureText` already uses), and include the folder name in the failure notice.

## BUG-04 — `openDay` also fails when the daily-note path contains sub-folders (folder-style format)

- **Severity**: high
- **Where**: `src/main.ts:128-141` (`openDay`), `src/main.ts:154-158` (`dailyNotePath`)
- **What**: Same root cause as BUG-03, different and much more common trigger: a format that itself
  contains slashes (`YYYY/MM/DD`, `YYYY/MM/DD ddd`, `YYYY/MMMM/DD`), which Obsidian's own Daily Notes
  core plugin supports and which `dailyNotePath` happily produces. Only the configured
  `dailyNoteFolder` may exist; `openDay` creates nothing, so `vault.create` rejects with ENOENT for
  the intermediate folders and the feature fails.
- **Why it's wrong**: `dailyNotePath` deliberately returns a nested path (`normalizePath` keeps the
  slashes), and the folder-style format is one Obsidian's own Daily Notes core plugin supports, yet
  `openDay` creates no part of it. (For a *single-level* daily folder `captureText` does call
  `ensureFolder` and succeeds — see BUG-03's output — but for a nested daily path it fails too, because
  `ensureFolder` cannot create intermediate folders; see BUG-05.)
- **Trigger / repro** (executed): folder `Journal` exists, `dailyNoteFormat = "YYYY/MM/DD"`:

  ```
  ## BUG-04 openDay() — fails whenever dailyNotePath() contains a not-yet-existing sub-folder
    dailyNoteFormat="YYYY/MM/DD" (folder-style, valid for Obsidian's own Daily Notes), Journal exists
    dailyNotePath(2024-06-15) = Journal/2024/06/15.md
    openDay -> Notice="Could not create the note for that day."  created=false
    vault contents: ["Journal"]
  ```
  and the capture path with the same setting:
  `captureText("x") -> REJECTED ENOENT: no such file or folder: Journal/2026/09 (Notice=null)` — so
  neither entry point can produce a folder-style daily note.
- **Impact**: Users with a nested daily-note format can never create a daily note from the dashboard or
  capture into one; the calendar, the streak widget and capture all point at paths that stay empty.
- **Evidence**: executed (outputs above)
- **Confidence**: high
- **Suggested fix**: create the whole folder chain before writing (a recursive `ensureFolder`, shared
  by `openDay` and `captureText`).

## BUG-05 — `captureText` with a nested `captureFolder` fails, and the swallowed folder error turns into a rejected capture with no message

- **Severity**: high
- **Where**: `src/main.ts:193-208` (`captureText`), `src/main.ts:210-218` (`ensureFolder`), `src/main.ts:220-229` (`appendTo`)
- **What**: `ensureFolder` makes a single `vault.createFolder(dir)` call for the *whole* trimmed
  `captureFolder`, then catches **every** error with an empty `catch {}` and returns. Obsidian's
  `createFolder` creates one folder and rejects when the parent is missing, so for
  `captureFolder = "Inbox/Daily"` (or any two-level value) nothing is created, the error is discarded,
  and `appendTo` then rejects with ENOENT (its `else` branch, `src/main.ts:227`) — inside `captureText`,
  which has no try/catch and so never reaches its `new Notice("Captured")`.
- **Why it's wrong**: `README.md:78` documents capture as "target (inbox file vs today's note),
  folder, and inbox filename" with no restriction to one level; `Inbox/Daily` is an entirely natural
  value. Worse, the failure is invisible: the empty `catch` hides the real cause and nothing reports
  the rejection. In the Quick capture modal (`src/main.ts:281-288`) `doIt()` awaits `captureText` with
  no `catch`, so the promise rejects unhandled: the modal stays open and the Capture button appears to
  do nothing — no Notice, no error text, only a console message.
- **Trigger / repro** (executed): `captureTarget="inbox"`, `captureFolder="Inbox/Daily"`,
  `inboxFile="Inbox.md"`:

  ```
  ## BUG-05 captureText() — nested captureFolder fails and the text is silently dropped
    captureFolder="Inbox/Daily" (neither level exists), inboxFile="Inbox.md"
    captureText("first thought") -> REJECTED ENOENT: no such file or folder: Inbox/Daily (Notice=null)
    vault contents: []   <- nothing was written
    single-level captureFolder="Inbox" for comparison:
      captureText("first thought") -> ok (Notice="Captured")
      vault contents: ["Inbox","Inbox/Inbox.md"]  content="first thought"
  ```
- **Impact**: Quick capture is a documented headline feature ("send a thought to your inbox file or
  today's note in one keystroke", `README.md:16`); with a nested folder it loses the thought
  silently, and the user cannot tell whether it was captured.
- **Evidence**: executed (output above)
- **Confidence**: high
- **Suggested fix**: create each path segment in turn (`for (let i = 1; i <= parts.length; i++)
  await createIfMissing(parts.slice(0, i).join("/"))`) and stop swallowing the error — log/notify it.
  Give `captureText` a `try/catch` that shows a failure Notice, and have `doIt()` in
  `QuickCaptureModal` only `this.close()` after a successful capture.

## BUG-06 — a capture target that is not a plain file rejects and loses the text (folder, empty name, missing sub-folder)

- **Severity**: high
- **Where**: `src/main.ts:193-208` (`captureText`), `src/main.ts:220-229` (`appendTo`), `src/main.ts:281-286` (`QuickCaptureModal.doIt`)
- **What**: `appendTo` only handles the "existing `TFile`" case; every other path falls through to
  `vault.create`, which rejects when the resolved path is a folder, when the name resolves to the
  `captureFolder` itself (`inboxFile = ""`), or when the name contains a slash whose folder does not
  exist (`inboxFile = "sub/Inbox.md"`). There is also no fallback from `create` to `modify` when the
  file appears between the `getAbstractFileByPath` check and the write. The rejection propagates out of
  `captureText`; `doIt()` awaits it with no `catch`, so nothing is reported to the user (not even the
  "Captured" Notice) and the modal never closes.
- **Why it's wrong**: The settings UI (`src/main.ts:436-450`) accepts these values without validation
  and the storage layer refuses the write, so a reasonable-looking configuration turns quick capture
  into a button that does nothing. The only feedback is an unhandled promise rejection in the console.
- **Trigger / repro** (executed):

  ```
  ## BUG-06 captureText() — a folder at the target path rejects the promise, user sees nothing
    captureText("boom") -> REJECTED EEXIST: file already exists: Notes (Notice=null)
    inboxFile="" with captureFolder="Inbox":
    captureText("lost thought") -> REJECTED EEXIST: file already exists: Inbox (Notice=null)
    vault contents: [["TFolder","Inbox"]]
    inboxFile="sub/Inbox.md" (no such folder):
    captureText("t") -> REJECTED ENOENT: no such file or folder: sub (Notice=null)
    write failure (EACCES) — exactly what QuickCaptureModal.doIt() awaits (main.ts:281-286, no try/catch):
    captureText("hello") -> REJECTED EACCES: permission denied (Notice=null)
  ```
- **Impact**: Any vault that already contains a folder named like the configured inbox file (e.g. the
  user leaves `inboxFile` empty and `captureFolder = "Inbox"`, or names a folder `Notes` while
  `inboxFile = "Notes"`) makes quick capture fail permanently and silently; a read-only/locked file
  (EACCES) does the same. The Dashboard **Capture** widget is equally affected — it also awaits
  `captureText` without a `catch` (`src/widgets/content.ts:194`), so the button just stops responding.
  Nothing is written and the user is never told why.
- **Evidence**: executed (output above)
- **Confidence**: high
- **Suggested fix**: validate the resolved target before writing (reject an empty path or one that is
  an existing folder), wrap the write in `try/catch` with a `new Notice("Capture failed: " + …)`, and
  keep the modal open on failure so the text is not lost.

## BUG-07 — the inbox file name is not made markdown-safe

- **Severity**: medium
- **Where**: `src/main.ts:195-199` (`captureText`, inbox branch), settings `src/main.ts:446-449`
- **What**: `inboxFile` is concatenated raw. A value without a `.md` extension creates a real but
  non-markdown file (`Inbox`), and a value with a trailing space creates `Inbox.md ` (a different file
  on Windows/macOS as far as the vault index is concerned). Nothing appends the extension or trims.
- **Why it's wrong**: The setting is documented as "inbox filename" (`README.md:78`) and the default is
  `Inbox.md`; nothing tells the user the extension is mandatory. Obsidian only treats `.md` files as
  notes, so a capture into `Inbox` succeeds ("Captured") and then cannot be opened as a note — the
  next capture with the corrected name starts a second, empty file and the earlier text is effectively
  lost. Contrast `dailyNotePath`, which always appends `.md`.
- **Trigger / repro** (executed):

  ```
  ## BUG-07 captureText() — the inbox file name is not made markdown-safe
    inboxFile="Inbox" -> captureText -> ok (Notice="Captured")
    created path = "Inbox" (no .md, so Obsidian refuses to open it as a note)
    inboxFile="Inbox.md " -> ok (Notice="Captured")
    created path = "Inbox" (trailing space kept)
  ```
- **Impact**: Captured thoughts land in a file the user cannot open from Obsidian, and each different
  spelling of the name fragments the inbox.
- **Evidence**: executed (output above)
- **Confidence**: high
- **Suggested fix**: `name = s.inboxFile.trim()`; if `name` is empty use `Inbox.md`; if it has no
  extension append `.md`.

## BUG-08 — `recordActivity` counts the plugin's own writes, inflating the heatmap, streak and totals

- **Severity**: medium
- **Where**: `src/main.ts:166-177` (`onFileActivity`, `recordActivity`), writes at `src/main.ts:136` (`openDay`) and `src/main.ts:225/227` (`appendTo`)
- **What**: Activity is incremented from the vault `create`/`modify` events (`src/main.ts:39-40`) with
  no way to tell who caused the write. The plugin's own `vault.create`/`vault.modify` calls therefore
  count as user edits: opening a day that has no note yet (creates the file) and each quick capture
  (creates or modifies the target note) add to `settings.activity`.
- **Why it's wrong**: The setting is described as "Record note edits to power the heatmap, streaks and
  stats" (`src/main.ts:402`), and `README.md:13` calls it "a GitHub-style heatmap of your note edits".
  Opening a note is not an edit, and capturing a one-line thought is not "editing a note" in the sense
  the widget reports — yet each capture increments the counter exactly like a hand edit.
- **Trigger / repro** (executed; one fresh plugin instance per case — the jsdom stub shares the data
  object between instances in one process, so only the deltas are meaningful):

  ```
  ## BUG-08 recordActivity() counts the plugin's own writes as user activity
    case 1: the user just opens today's not-yet-existing note from the calendar/Quick action
      activity[2026-09-11] before openDay: 2
      activity[2026-09-11] after  openDay: 3   <- +1 although the user edited nothing
      (the note that appeared: "D1/2026-09-11.md", content "")
    case 2: the user captures two thoughts into today's note (that note does not exist yet)
      activity[2026-09-11] 3 -> 4 (create) -> 5 (modify);  delta = +2
      two captured lines the user never opened a note for count as two edits
    case 3: one real user edit, for comparison
      activity[2026-09-11] before: 6
      activity[2026-09-11] after : 7
  ```
- **Impact**: The activity heatmap, "Week" and "Total" chips and the streak are all fed by this record
  (`src/widgets/activity.ts:40,63,66,144-158`), so they over-report. A user who only browses their
  calendar days and captures ideas shows a "busy" day with zero real edits; streaks that are supposed
  to mean "you wrote today" can be held up by a single empty note created by clicking a calendar cell.
- **Evidence**: executed (output above)
- **Confidence**: high
- **Suggested fix**: add a private suppression flag around the plugin's own writes
  (`this.writing = true; try { … } finally { this.writing = false; }` in `openDay`/`appendTo`, checked
  in `onFileActivity`), or call `recordActivity` only for `modify` events on a file that already
  existed before this session.

## BUG-09 — every note save re-renders every dashboard widget, unthrottled

- **Severity**: medium
- **Where**: `src/main.ts:172-181` (`recordActivity` → `refreshActivityWidgets`), `src/view.ts:273-285` (`DashboardView.refreshActivityWidgets` / `refreshAllOfType`), events registered at `src/main.ts:39-40`
- **What**: `queueSave()` debounces the *settings write* by 500 ms, but the same handler immediately
  calls `refreshActivityWidgets()`, which re-renders all nine widget types listed in
  `src/view.ts:274` synchronously for every `create`/`modify` event in the vault. There is no
  throttle, debounce, or idle check anywhere on that path.
- **Why it's wrong**: Obsidian fires `modify` on every autosave (roughly a second after typing
  pauses), so a plain editing session tears down and rebuilds every activity/stats/tasks/calendar/
  recents/vault-tasks/popular/orphans/backlinks widget body over and over. Each rebuild re-reads the
  vault and recreates DOM, which is pure waste when the dashboard is in a background tab.
- **Trigger / repro** (executed; dashboard view opened through `leaf.setViewState` so
  `getLeavesOfType()` finds it, i.e. the real `forDashboard` path):

  ```
  ## BUG-09 one vault event re-renders every dashboard widget, on every autosave, unthrottled
    dashboard widgets on screen: 22
    widgets whose body is torn down per event (view.ts:274): 9
    40 "modify" events (40 autosaves) -> 560 widget bodies wiped and rebuilt = 14.0 per event
    wall time: 450ms for 40 events (11.3ms each), jsdom + 300 notes
    activity delta over those 40 autosaves: +40
    recordActivity() -> refreshActivityWidgets() -> view.refreshActivityWidgets() with NO debounce (main.ts:172-181)
  ```
  (the widget-body count and the 14.0-per-event ratio are deterministic; the wall-clock figure moves
  a few percent between runs)
- **Impact**: Constant DOM churn and repeated vault scans while editing; on a large vault with the
  dashboard open (and especially with several dashboard leaves) the whole `refreshAllOfType` sweep
  runs per autosave, competing with typing. 14 widget rebuilds per save is measurable overhead that
  buys nothing — the user is not even looking at the widget at that moment.
- **Evidence**: executed (output above)
- **Confidence**: medium (the per-event cost is measured in jsdom, not in a real Obsidian window;
  the 14 rebuilds/event and the absence of any throttling are exact)
- **Suggested fix**: debounce the refresh the same way as the save — e.g. a single 500-1000 ms timer
  in `recordActivity` that coalesces `refreshActivityWidgets()`, and skip it entirely when no
  dashboard leaf is open.

## BUG-10 — the debounced activity save is never flushed on unload (counters for the current session are lost)

- **Severity**: medium
- **Where**: `src/main.ts:12` (`saveTimer`), `src/main.ts:87-93` (`queueSave`), `src/main.ts:172-177` (`recordActivity`); no `onunload` in `src/main.ts`
- **What**: `recordActivity` mutates `settings.activity` in memory and schedules `saveSettings()` 500 ms
  later. The plugin declares no `onunload()` at all (and no `registerInterval`/`onunload` flush), so a
  pending timer is simply discarded when the app quits or the plugin is disabled/reloaded.
- **Why it's wrong**: Each edit within the last 500 ms before shutdown is lost. Clicking a calendar day
  (which, per BUG-08, also counts) and immediately closing Obsidian loses the increment outright;
  toggling the plugin off does the same. Obsidian calls `onunload()` synchronously on quit — a
  `if (this.saveTimer !== null) void this.saveSettings()` there would make it lossless.
- **Trigger / repro** (executed):

  ```
  ## BUG-10 the 500 ms activity save is never flushed on unload
    typeof plugin.onunload = undefined   (main.ts defines no onunload at all)
    saveTimer pending when the plugin is torn down: true
    persisted activity: null  <- the increment is only in memory
    after waiting 700ms (simulating a normal session): {"2026-09-11":48}
  ```
- **Impact**: The newest activity counts — the ones the user just made — are the ones dropped, so the
  "Total"/"Week" chips and the streak can be short by a session's worth of edits, and the loss is
  silent.
- **Evidence**: executed (output above)
- **Confidence**: high for the missing flush (no `onunload` is defined, proven by the `undefined`);
  medium for how often real users quit inside that 500 ms window.
- **Suggested fix**: implement `onunload()` that clears the timer and, if one was pending, awaits
  `this.saveSettings()` (Obsidian awaits the returned promise before tearing the plugin down).

---

## Checked and clean

Verified with the same harness (`bug-hunt/scratch-03-features/verify.cjs`, last block), so a later
agent does not need to redo these:

- **Inbox capture with a single-level, missing `captureFolder` works**: `captureFolder="Inbox"`
  creates `Inbox` and writes `Inbox/Inbox.md`.
- **Append does not duplicate or reorder**: three captures produce `"one\n\ntwo\n\nthree"`, single
  blank line between entries, and the pre-existing trailing whitespace is trimmed once (`main.ts:224`).
- **Appending to an existing file is a `modify`, not an overwrite**: verified by content, above.
- **Capture to the daily note prefixes a time heading**: `"### 1:53:16 PM\nx"` — intentional-looking
  (daily branch only, `main.ts:205`), and each capture appends rather than replaces.
- **Non-note files are ignored by activity tracking**: creating `.pdf`/`.txt` changed activity by 0;
  creating a `.md` changed it by 1 (`main.ts:167`).
- **Folders are ignored**: `vault.createFolder` adds no activity (`TFolder` is not a `TFile`).
- **`rename`, `delete` and metadata (`changed`) events add no activity**: firing them manually added 0
  (`main.ts:39-40` registers only `create`/`modify`). Note the flip side is not a bug in this area:
  a rename obviously does not represent an edit.
- **`trackActivity: false` really stops recording**: a `modify` changed activity by 0. The vault
  handlers stay attached (they gate on the setting at call time, `main.ts:167`), which is the cheap
  and correct choice; no stale accumulation was observed.
- **The activity record does not grow unbounded per event**: it is keyed `YYYY-MM-DD`
  (`main.ts:173`, `utils.ts:11-12`), i.e. at most one entry per calendar day, and the key is computed
  from `new Date()` at increment time — no cached "today" that goes stale across midnight.
- **"Clear data" works and persists**: `settings.activity = {}` then `saveSettings()` leaves an empty
  persisted record (`main.ts:407-411`).
- **`noteExistsFor` is not cached**: it re-queries `getAbstractFileByPath` each call, and correctly
  flips after a create and after a delete (`main.ts:160-162`).
- **`openDay` opens an existing note and does not clobber it**: the `instanceof TFile` branch returns
  before any write (`main.ts:131-134`); a folder occupying the path is not mistaken for a note
  (`getAbstractFileByPath(...) instanceof TFile` is false for `TFolder`).
- **`openFile(null)` is a no-op** and `openFile` uses a fresh leaf (`main.ts:124-126`).
- **`openSearch` passes the query through unchanged** and is called with `""` (control bar,
  `view.ts:125`), `"tag:"+tag` (`content.ts:60`) and a trimmed custom query
  (`content.ts:223`, `quickactions.ts:88`); no defect found in the plumbing itself.
- **Calendar display uses the same path as capture/openDay** (`calendar.ts:68` → `noteExistsFor`), so
  the has-note dot and the click agree — the defects are in `dailyNotePath`/`openDay`, not in a
  calendar/path mismatch.
- **Month/year boundaries format correctly** with a normal format:
  `Daily/2024-12-31.md` / `Daily/2025-01-01.md`; a local-midnight date on a DST change day also
  formats to the correct local day. Caveat: the harness machine's timezone may not observe DST, so
  this is verified by inspection (`utils.ts:11-12` and the formatter use `getFullYear/getMonth/
  getDate`, i.e. consistently *local* time — the correct choice) more than by experiment.
- **`node smoke/out.js` still prints `SMOKE TEST PASSED`** and `npx tsc -noEmit -skipLibCheck` exits
  0. Worth knowing for the verifier: the smoke suite asserts `"todayNoteCreated": true` and
  `"activityRecorded": true` independently, in separate scenarios — it never observes that the same
  `openDay` call satisfies the first *by* incrementing the second (BUG-08), which is why the
  inflation survives the suite.
