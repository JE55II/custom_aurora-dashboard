# Widgets — notes/tasks/content, links, pinned, quick actions, tools: findings

Area: `src/widgets/content.ts`, `vaulttasks.ts`, `links.ts`, `pinned.ts`, `quickactions.ts`, `tools.ts`,
`random.ts` (+ registration in `src/widgets/index.ts`).

Harness used for every `executed` finding (per `bug-hunt/README.md`):

```powershell
npx tsc --outDir bug-hunt/scratch-06-content/build --module commonjs --target es2018 `
  --moduleResolution node --skipLibCheck --noEmit false --esModuleInterop `
  --lib es2018,dom --strict false src/main.ts        # exit 0
node bug-hunt/scratch-06-content/a-tasks.cjs
```

**Harness gotcha worth recording for other agents:** `plugin.refreshWidget(uid)` goes through
`plugin.forDashboard()` → `app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD)`, and the stub's
`getLeavesOfType` only returns leaves whose `view` is set. If you build a view by hand you **must**
do `leaf.view = view` (as `smoke/entry.js:22-25` does), otherwise every `refreshWidget`/`rerenderDashboard`
silently does nothing and you will "discover" phantom bugs.

---

## BUG-01 — Clicking one task in the "Today" widget checks off *every* task with the same text
- **Severity**: high
- **Where**: `src/widgets/content.ts:133-147` (`toggleTask`; the `.map()` at lines 138-144 has no early exit)
- **What**: `toggleTask(text)` is filtered by task **text only**. It walks the whole file and rewrites *every*
  line whose checkbox text matches, so one click flips all duplicates at once.
- **Why it's wrong**: The widget renders each duplicate as its own row with its own checkbox, so the UI
  promises per-row granularity. The write-back is not line-addressed (unlike `vaulttasks.ts`, which at least
  tries `t.line` first).
- **Trigger / repro**: daily note `2025-06-10.md` containing
  `# doc` / `- [ ] dup` / `middle` / `- [ ] dup`; click the checkbox of the *first* `dup` row.
  ```
  Today rows => ["dup","dup"]
  after clicking 1st dup row => "# doc\n- [x] dup\nmiddle\n- [x] dup"
  ```
  (probe `e-final.cjs`, section `=== duplicate task text, exact lines ===`)
- **Impact**: Silent data corruption — a user ticking one of two identically-named tasks ("Follow up",
  "Buy milk", "Reply") marks the other one done too. There is no undo hint and the second task disappears
  into the "Completed" section.
- **Evidence**: executed (output above)
- **Confidence**: high
- **Suggested fix**: pass the source line index into `toggleTask` (the `load()` loop already knows `i`)
  and rewrite only that line after verifying the text still matches, exactly like
  `src/widgets/vaulttasks.ts:170-189`; fall back to the first text match only when the line check fails.

---

## BUG-02 — "Today" widget ignores `+ [ ]` and numbered-list checkboxes
- **Severity**: medium
- **Where**: `src/widgets/content.ts:92` (`ln.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/)`) and
  `src/widgets/content.ts:140` (same class of regex for the write-back)
- **What**: Only `-` and `*` bullets are recognised. `+ [ ] task` and `1. [ ] task` are invisible to the
  widget: they are neither listed nor toggleable.
- **Why it's wrong**: Obsidian's own Tasks/`- [ ]` convention accepts `+` bullets, and `1. [ ]` / `2) [ ]`
  are valid Markdown ordered-list checkboxes that Obsidian renders as real checkboxes. The widget silently
  drops them and then declares "Nothing here yet".
- **Trigger / repro**: daily note body
  ```
  - [ ] hyphen
  * [ ] star
  + [ ] plus
  1. [ ] numbered-one
  2) [ ] numbered-paren
  ```
  renders exactly:
  ```
  rendered rows (open) => ["hyphen","star","indented-two","tab-indented"," "]
  ```
  (`plus`, `numbered-one`, `numbered-paren` are missing; probe `e-final.cjs`, section
  `=== checkbox variant support (Today widget) ===`)
- **Impact**: Users who write `+` or numbered checklists see an incomplete Today widget and cannot tick those
  tasks from the dashboard; the same pattern is used for the write-back, so even a text-matched toggle could
  never reach them.
- **Evidence**: executed (output above)
- **Confidence**: high
- **Suggested fix**: use one shared pattern, e.g. `/^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s*(.*)$/`, with the
  `(.*)` group so empty-text boxes are handled explicitly, and use the same pattern in `toggleTask`.

---

## BUG-03 — "Today" widget counts checkboxes inside fenced code blocks and frontmatter as real tasks
- **Severity**: medium
- **Where**: `src/widgets/content.ts:88-95` (`load()` splits the raw file text and regexes each line with no
  code-fence/frontmatter awareness); the same defect exists in `src/widgets/vaulttasks.ts:41-45`
- **What**: Any line matching the checkbox regex is treated as a task, including lines inside ```` ``` ````
  fences, indented code blocks, and YAML frontmatter values.
- **Why it's wrong**: Markdown only renders a checkbox in body prose. Counting code/frontmatter makes the
  widget list non-tasks, inflate the "Completed (n)" count, and lets the user "toggle" a line inside a code
  sample — which corrupts the code sample.
- **Trigger / repro**: file containing
  ```markdown
  ```
  - [ ] inside fenced code block
  ```
  ---
  tasks: '- [ ] inside frontmatter'
  ---
  ```
  renders (probe `a-tasks.cjs`):
  ```
  Today widget rows => ["dash task","star task","indented task"," ","inside fenced code block","tab indented","dup task","dup task","upper done","lower done"]
  vaulttasks Flat rows => ["dash task","star task","indented task","","inside fenced code block","tab indented","dup task","dup task"]
  ```
  Note `"inside fenced code block"` appears as a task in both widgets, and a 4-space-indented
  `- [ ]` inside a code block is counted as a top-level task.
- **Impact**: Documentation/notes containing fenced checkbox examples pollute the task list, and one click
  rewrites the example inside the code fence (data corruption).
- **Evidence**: executed (output above)
- **Confidence**: high
- **Suggested fix**: track fence state while scanning — skip lines until the matching closing fence
  (``` and ~~~, ≥3 chars) and skip a leading `---`…`---` frontmatter block — before applying the task regex.
  A shared `parseTasks(content)` helper used by both widgets fixes both call sites at once.

---

## BUG-04 — `vaulttasks` toggles the *first* task with matching text when the remembered line no longer matches
- **Severity**: medium
- **Where**: `src/widgets/vaulttasks.ts:172-189` (line-check at `176-178`, `findIndex` fallback at `180-184`,
  `lines[idx].replace(TASK_BOX, …)` at `186`)
- **What**: When the cached `t.line` no longer holds the expected text (file was edited between render and
  click — the widget keeps an mtime-keyed cache and the scan is async), the code falls back to
  `findIndex(...)` on **text only** and flips that line. With two tasks sharing the same text, the wrong one
  is flipped.
- **Why it's wrong**: The fallback silently substitutes "the first task with this text" for "this task".
  Combined with the duplicate rows the widget itself renders, the user can never reach the second task.
- **Trigger / repro**: file with `- [ ] dup task` on line 19 and `- [ ] dup task` on line 20.
  - *Correct path* (line still valid) — probe `a-tasks.cjs`, `=== vaulttasks duplicate rows ===`:
    ```
    clicked 2nd dup -> line19 => "- [ ] dup task"
    clicked 2nd dup -> line20 => "- [x] dup task"      <- correct row written
    ```
  - *Broken path* — same file, same widget, but the file changed before the click so the validation at
    `vaulttasks.ts:176-178` fails. The only remaining discriminator is the task text, and the
    `findIndex` at line 180 cannot tell line 19 from line 20, so it rewrites line 19 (the first match).
    I could not reproduce this branch in the stub harness — the stub's `read()` is synchronous
    (`Promise.resolve`) and `modify()` always bumps `stat.mtime`, which re-keys the cache at line 35, so the
    in-memory `t.line` stays valid in every click I could construct. The claim rests on the branch itself,
    not on a pasted run.
- **Impact**: When it triggers, the wrong task is completed (and the clicked one is not); the user has no way
  to tell from the UI, because both rows are byte-identical.
- **Evidence**: static only (the fallback branch at `vaulttasks.ts:176-184`; the neighbouring correct path is
  executed output above)
- **Confidence**: medium (branch is unambiguous; the real-Obsidian trigger is a file edit landing between the
  widget's cached scan and the click, which the stub ordering makes hard to stage)
- **Suggested fix**: make the fallback search start at or after the remembered index —
  `lines.findIndex((ln, i) => i >= t.line && matches(ln))` — or drop the fallback and just refresh the widget,
  and keep the raw source line inside `TaskItem` so the validity check is exact rather than text-only.

---

## BUG-05 — "Today" widget stays bound to the note it rendered for, so tasks added after midnight land in yesterday's note
- **Severity**: medium
- **Where**: `src/widgets/content.ts:74` (`const path = plugin.dailyNotePath(new Date())` captured once in
  `render`) used by `load()` (`79`), `toggleTask` (`134`) and `addNewTask` (`151`)
- **What**: `path` is computed once at render time and closed over by every handler. Nothing re-derives it,
  and the widget is only re-rendered by activity events, so an Obsidian window left open across midnight
  keeps reading and writing the *previous* day's daily note.
- **Why it's wrong**: The capture field says "Add a task for today…" and the widget is named "Today", but the
  write target is frozen at render time. (`plugin.dailyNotePath(new Date())` elsewhere — e.g.
  `main.ts:201` — does recompute, so the two code paths disagree.)
- **Trigger / repro**: probe `d-misc.cjs`, section `=== Today widget vs. midnight rollover ===`
  (clock at 2025-06-10 23:00, then advanced to 2025-06-11 00:05 with the dashboard left open):
  ```
  day 1 path => "2025-06-10.md"
  day 2 path => "2025-06-11.md"
  day1 content => "- [ ] existing day1 task\n- [ ] task added after midnight"
  day2 file exists? => false
  ```
- **Impact**: Tasks typed after midnight are silently filed into yesterday's note; the user opens today's
  daily note and the task is not there (apparent data loss). Completion counts are attributed to the wrong day.
- **Evidence**: executed (output above)
- **Confidence**: high
- **Suggested fix**: recompute `plugin.dailyNotePath(new Date())` inside `load()`, `toggleTask()` and
  `addNewTask()` (or re-render the widget on a date change), and show the resolved path in the widget so the
  user can see which note is being written.

---

## BUG-06 — Deleting/renaming a pinned note removes it from the widget with no "missing" indication
- **Severity**: low
- **Where**: `src/widgets/pinned.ts:23-35` (silent `continue` at line 25, empty state at line 35)
- **What**: Pins whose path no longer resolves to a `TFile` are skipped entirely, and if that leaves nothing
  the widget prints the generic "No pinned notes — edit to add some". The stale path stays in
  `inst.settings.pins` forever.
- **Why it's wrong**: A moved/renamed note silently vanishes from the user's pinned list; the widget claims
  there are no pins at all, so the user cannot tell whether they never pinned anything or whether their pins
  are broken, and the settings modal still lists the dead path (making it look like a widget bug).
- **Trigger / repro**: pin `Notes/Gone.md`, render (shows `GoneNotes`), then remove the file from the vault
  and refresh (`c3-clean.cjs`, section `=== pinned ===`):
  ```
  before removal => "GoneNotes"
  after file removed from vault => "No pinned notes — edit to add some"
  ```
- **Impact**: Pinned shortcuts silently disappear after a vault rename/move (Obsidian renames are extremely
  common); no way to notice or clean up the broken pin from the widget.
- **Evidence**: executed (output above)
- **Confidence**: high
- **Suggested fix**: render unresolved pins as a dimmed row (`is-missing`, title = the stored path, tooltip
  "Note not found") and count them in `shown`, so the list degrades visibly instead of collapsing to the
  empty state.

---

## BUG-07 — "New note from template" collides within the same minute and reports success
- **Severity**: low
- **Where**: `src/widgets/quickactions.ts:118-131` (name built from `YYYY-MM-DD HHMM` at lines 119-123,
  `vault.create` at 127, blanket `catch` → `"Couldn't create note from template."` at 130-131)
- **What**: The generated note name has minute resolution (`.replace(/ /g, "-")` on
  `"YYYY-MM-DD HHMM"`), so two activations of the same template action inside one minute produce the same
  target path. `vault.create` then fails ("file already exists") and the generic catch message is shown.
- **Why it's wrong**: The user pressed the button twice and got one new note plus an unhelpful error, with no
  hint that the name is the problem (and no `Notice` about *which* file exists). The stamp also ignores
  seconds entirely.
- **Trigger / repro**: probe `c3-clean.cjs`, section `=== quick actions ===` — click the template action twice:
  ```
  template #1 Notice => "Created 2026-09-11-1358"
  files after #1 => ["Templates/Weekly.md","Templates/2026-09-11-1358.md"]
  template #2 (same wall-clock minute) Notice => "Created 2026-09-11-1358"
  ```
  (the stub vault allows duplicate paths, so it reports success twice; in real Obsidian the same call is the
  documented `vault.create` "already exists" rejection, which lands in the `catch` at line 130.)
- **Impact**: Repeating a template action in the same minute fails with a misleading message; the user may
  believe the note was created when it was not.
- **Evidence**: executed for the path collision (notice strings above); the throw-on-existing behaviour
  itself is `static only` (`Vault.create` in the stub does not enforce uniqueness).
- **Confidence**: medium (path collision is proven; the failure message depends on Obsidian's real `Vault.create`)
- **Suggested fix**: include seconds and a short suffix in the stamp
  (`` `${stamp}-${String(d.getSeconds()).padStart(2,"0")}` ``) or probe with
  `getAbstractFileByPath` and append ` 2`, ` 3`, … before creating; surface the actual error text instead of
  swallowing it.

---

## Checked and clean (do not re-verify)

- **XSS / HTML injection** — no `innerHTML`, `insertAdjacentHTML`, `outerHTML`, `eval`, or `new Function`
  anywhere in `src/` (grep). Every user-controlled string (note basename, tag, task text, action label,
  pinned path, quote) goes through `setText`/`text:`/`createEl({text})`. Verified with a note named
  `Notes/<img src=x onerror="alert(1)">.md` and a tag `#<b>bold</b>`: rendered as text, no element created
  (`c-actions.cjs`: `recent widget raw HTML has <img>? => false`, `tags widget injects <b>? => false`).
- **Search widget query handling** (`content.ts:220-225`, `main.ts:143-146`) — the query is passed through
  untouched to `setViewState({type:"search", state:{query}})`. Nothing is URL-encoded by the plugin, so
  `"`, `\`, `#` are safe; `#tag` stays `#tag`. Only a literal newline is lost, and that is `HTMLInputElement`
  behaviour (jsdom strips it), so it is not a plugin defect.
- **Tags widget** (`content.ts:40-63`) — sort/limit behave for malformed `count` (`"abc"`, `null`, `-5`,
  huge values all render without throwing). One inaccuracy found but not worth a bug entry: a tag repeated
  three times in a *single* file is counted as 3 (`#x3` for one note) because `cache.tags` is counted per
  entry rather than per file.
- **Pinned** — duplicates cannot be created through the UI: `addPath` checks `this.pins.includes(p)`
  (`pinned.ts:122`) and the datalist excludes already-pinned paths (`pinned.ts:89-93`). Root-level pins
  correctly show `root` as their meta (`pinned.ts:31-32`).
- **Quick actions dispatch** (`quickactions.ts:78-136`) — verified with a deliberately malformed action list:
  unknown `kind` (`"banana"`), non-object entries (`5`, `"a string"`), missing/blank `target`, and
  non-string `label` are all normalised by `sanitizeAction` without throwing; blank/unknown command targets
  produce the "No command selected." notice rather than a silent no-op.
- **Random note** (`random.ts:18-26`) — never picks folders (`getMarkdownFiles()`), never returns `null`
  (60 clicks over a 3-note vault opened only `A/B/C.md`), and renders "No notes yet" instead of crashing on
  an empty vault.
- **Pomodoro** (`tools.ts:57-107`) — forced-clock probe drove the timer across both zero crossings:
  `01:00 Focus → 01:00 Break` with notice `Focus session complete — take a break`, then `01:00 Focus` with
  `Break over — back to focus`. It does not stall at zero, does not tick twice, and does not drift per tick.
  Interval bookkeeping is clean: with `setInterval` instrumented, starting the timer and doing
  refresh+play three times left the live-interval count unchanged (7 → 7), so `dispose()` (called from
  `view.ts:243` and `view.ts:56-64`) genuinely clears the old interval and re-rendering does not leak timers.
- **Remaining widget settings robustness** — `vaulttasks` with `{count:"x", maxFiles:-1, groupBy:7}`,
  `popular {count:{}}` and `orphans {count:[]}` all fall back to sane defaults and render without throwing.
- **`links.ts` link filtering** (`links.ts:6-23`, `76-97`) — the graph is read from
  `metadataCache.resolvedLinks` with a safe `?? {}` fallback (`links.ts:7-9`). Obsidian resolves aliases,
  `[[Note#Heading]]`, `![[embeds]]` and `\`-vs-`/` spellings into that map before the plugin sees it, and
  unresolved links never appear there, so orphans are computed from working links only. Self-links are
  explicitly excluded at line 13. `evidence: static only` for the resolution semantics (the stub's
  `MetadataCache` exposes no `resolvedLinks`); the `?? {}` empty-state path is what the rendered widgets
  exercise. No per-keystroke scan: both widgets recompute `inboundSources` only on render/refresh.
- **`addNewTask` newline handling** (`content.ts:162-163`) — appending to a file with no trailing newline
  produced `"no trailing newline\n- [ ] added task"` (the template literal's leading `\n` prevents the
  joined-lines corruption I expected). Only literal whitespace is still lost, which is not a defect.
- **Path normalisation with backslashes** — `captureFolder: "Inbox\\Sub"` and
  `dailyNoteFolder: "Daily\\Notes"` both produced clean `Inbox/Sub/Inbox.md` and `Daily/Notes/<date>.md`
  (both paths flow through `normalizePath` in `main.ts:196-198` / `157`).
- **Baseline intact** — `npx tsc -noEmit -skipLibCheck` exits 0 and `node smoke/out.js` prints
  `SMOKE TEST PASSED` with this working tree; no repo file outside `bug-hunt/06-widgets-content.md` and
  `bug-hunt/scratch-06-content/` was touched.

### Reported only as notes (real but below the bug bar)

- `vaulttasks.ts:104-110` shows the file basename on completed rows for a reason that only applies to the
  flat/ungrouped layout, and the "Completed (n)" divider makes no distinction between notes
  (`vaulttasks.ts:105`, `137`), so in grouped mode a done task looks like it belongs to the group above it.
- `vaulttasks.ts:146-150` claims "All caught up — nothing open" even when `showDone` is off and completed
  tasks were found.
- `vaulttasks.ts:22` `fileCache` is a module-level `Map` keyed by path that is never pruned on delete/rename,
  so it grows for the lifetime of the plugin (bounded by distinct paths seen, not by vault size).
- Scan cost on every vault write: `main.ts:39-40` wires *create* and *modify* to `onFileActivity` →
  `refreshActivityWidgets()` (`main.ts:176,179-181`, `view.ts:273-285`), whose list includes `vaulttasks`
  (`view.ts:274`). Every note write therefore triggers `scanTasks` over the newest
  `maxFiles` files (default **200**, max 2000) and re-reads each one whose `stat.mtime` moved — the mtime
  key only spares *untouched* files, and the modified file always misses. The 500 ms `queueSave` debounce
  (`main.ts:87-93`) only covers settings persistence, not this scan, so rapid typing in a large vault queues
  a full re-scan per write. It is a genuine performance hazard but I did not measure a UI freeze, so it is
  recorded here rather than as a bug.
