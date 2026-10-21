# Aurora Dashboard (`cool-dashboard`) 1.2.6 — consolidated bug report

Single deliverable of the run *Aurora Dashboard — bug detection sweep*. It contains **only findings the
adversarial verifier marked CONFIRMED** (`bug-hunt/08-verification.md`, 55 of 62), deduplicated across the
seven area reports, re-ranked by the verifier's severity, and ordered by fix priority. Seven refuted claims
are listed in Appendix A so nobody re-reports them. No fix was applied to the plugin: this is a detection
exercise, and the working tree is unchanged apart from `bug-hunt/`.

**Totals: 45 findings — 1 critical, 6 high, 16 medium, 22 low.**

Every `file:line` below was re-read in `src/` while writing this report (the verifier's line-drift notes are
applied: the twelve `styles.css` rule lines are `+2` on the original citation, and the Columns-slider cite is
`src/main.ts:329-333`). Where a claim is marked **executed**, the pasted output is real. I re-ran the critical
finding and five others myself with my own harness (`bug-hunt/scratch-09-integrator/probe.cjs`); those entries
say so and quote my own output, so the maintainer has two independent derivations for the worst defects.

Environment for every executed result: Node + jsdom with `smoke/stub-obsidian.js` (not real Obsidian).
`esbuild`/`npm run build` are blocked in the sandbox, so nothing was verified through the shipped `main.js`
bundle. See **Coverage and limits**.

---

## Summary

| id | title | severity | area | verified by |
|---|---|---|---|---|
| CRIT-01 | A non-object entry in `layout` makes the plugin permanently unloadable | **critical** | main / persistence | 08-verify + integrator re-run |
| HIGH-01 | The grid width is never enforced — Columns 8–11 place 6–8 cards outside the grid | high | layout / main / view | 08-verify + integrator re-run |
| HIGH-02 | Unknown-type widgets are deleted from memory **and** from `data.json` | high | main / persistence | 08-verify + integrator re-run |
| HIGH-03 | `openDay()` creates no daily-note folder; folder creation is never recursive | high | main features | 08-verify |
| HIGH-04 | `pointercancel` is never handled: drag/resize leaks listeners and sticks | high | view / integration | 08-verify |
| HIGH-05 | `noHeader` widgets (Clock) cannot be dragged, configured or removed | high | view | 08-verify |
| HIGH-06 | Clicking one task completes **every** task with the same text | high | widgets / content | 08-verify |
| MED-01 | `formatDate` is a chain of single-occurrence replaces → mangled daily-note names | medium | utils / main | 08-verify + integrator re-run |
| MED-02 | Duplicate `uid`s are never repaired → stacked cards, dead timer, ✕ deletes both | medium | layout / main / view | 08-verify |
| MED-03 | Persisted settings and geometry are used completely unvalidated | medium | main / view / layout | 08-verify |
| MED-04 | No `onunload`: the debounced save is neither flushed nor cancelled | medium | main | 08-verify + integrator re-run |
| MED-05 | Vault-write failures are swallowed: silence, no Notice, no log | medium | main / widgets | 08-verify |
| MED-06 | Non-string `dailyNoteFolder`/`dailyNoteFormat` break three widgets | medium | main / widgets | 08-verify |
| MED-07 | A non-object `activity` map is not normalised (throw on every edit) | medium | main / widgets | 08-verify |
| MED-08 | Every date-dependent widget freezes "today" at render time | medium | widgets | 08-verify |
| MED-09 | The plugin's own writes count as user activity | medium | main features | 08-verify |
| MED-10 | Every vault write re-renders nine widget types with no throttle | medium | main / view | 08-verify |
| MED-11 | A gesture commits after edit mode is left; *Cancel editing* is a no-op on that path | medium | view | 08-verify |
| MED-12 | Below 720 px the JS still uses 12 columns: preview and stored position are wrong | medium | view / CSS | 08-verify |
| MED-13 | Checkboxes inside fenced code blocks are live tasks and get rewritten | medium | widgets / content | 08-verify |
| MED-14 | Twelve per-widget `styles.css` rules can never match | medium | CSS ↔ DOM | 08-verify |
| MED-15 | README documents a hotkey that is not registered | medium | docs | 08-verify |
| MED-16 | Mobile contract: `isDesktopOnly:false` + no `touch-action` + no install path | medium | packaging / docs | 08-verify |
| LOW-01 | `layout: []` is silently repopulated with 22 widgets on load | low | main | 08-verify |
| LOW-02 | Placement primitives return out-of-bounds fallbacks when `w > columns` | low | layout | 08-verify |
| LOW-03 | Collapsed widgets keep their full footprint in every layout computation | low | layout / view | 08-verify |
| LOW-04 | `clamp()` returns `lo` for inverted bounds (zero-delta resize widens past the grid) | low | utils / view | 08-verify |
| LOW-05 | `DEFAULT_SETTINGS.activity` is shared by reference and mutated in place | low | types / main | 08-verify |
| LOW-06 | The v1→v2 migration is skipped for a non-numeric `version` | low | main | 08-verify |
| LOW-07 | The migration's write is fired and forgotten (`void this.saveSettings()`) | low | main | 08-verify |
| LOW-08 | The inbox file name is not made markdown-safe | low | main features | 08-verify |
| LOW-09 | Resizing a collapsed card persists a height you cannot see | low | view | 08-verify |
| LOW-10 | Numeric widget setting commits `cfg.min` for empty/invalid input | low | view | 08-verify |
| LOW-11 | The widget error boundary discards the widget's cleanup handle | low | view | 08-verify |
| LOW-12 | Heatmap writes `data-lvl="NaN"` when the busiest day has one edit | low | widgets / activity | 08-verify |
| LOW-13 | Progress "Year" ring counts days with `ms / 86400000` (DST) | low | widgets / progress | 08-verify |
| LOW-14 | Deadline accepts impossible dates and counts down to another day | low | widgets / deadline | 08-verify |
| LOW-15 | Streak "Best" is windowed to 801 days | low | widgets / streak | 08-verify |
| LOW-16 | Habit rows without a stored id lose their completion history | low | widgets / habits | 08-verify |
| LOW-17 | `+ [ ]` and numbered-list checkboxes are ignored | low | widgets / content | 08-verify |
| LOW-18 | `vaulttasks` can toggle the *first* same-text task | low | widgets / vaulttasks | 08-verify |
| LOW-19 | "New note from template" collides within one minute | low | widgets / quickactions | 08-verify |
| LOW-20 | The release workflow never checks the tag against the versions | low | CI / packaging | 08-verify |
| LOW-21 | The Accent control shows `#7c3aed` while the dashboard uses the theme accent | low | settings UI | 08-verify |
| LOW-22 | A blank/whitespace `dailyNoteFormat` creates a hidden/unopenable file | low | main / daily notes | **integrator re-verify** (salvaged from a refuted claim) |

### Findings with a data-loss / file-corruption component (prioritise these)

| id | what gets damaged |
|---|---|
| HIGH-06 | **User note content** — ticking one checkbox rewrites every same-text task in the file |
| HIGH-02 | **`data.json`** — unknown-type widget entries and their per-widget settings are deleted from disk |
| MED-01 | **Vault filenames** — daily notes are created under token-polluted names (`06.11.DD.md`) that the user's existing notes never match |
| MED-08 | **Wrong note** — a task typed after midnight is written into yesterday's daily note |
| MED-13 | **User note content** — clicking a checkbox inside a code fence rewrites the code sample |
| MED-02 | **Layout config** — with duplicate uids, ✕ on one card deletes both widgets |
| LOW-08 | **Captured text** — lands in a file named `Inbox` (no `.md`) that Obsidian will not open as a note |
| LOW-22 | **File system** — a hidden `Daily/.md` / unopenable `Daily/   .md` is created |
| CRIT-01 | **Plugin state** — permanently unloadable until the user hand-edits `data.json` |

---

## Critical

### CRIT-01 — A non-object entry in `layout` makes the plugin permanently unloadable
- **Severity**: critical
- **Where**: `src/main.ts:52-53` (`.filter((i) => widgetType(i.type))`), reached from `src/main.ts:15` (`await this.loadSettings()` in `onload`). Same defect reported as `01-BUG-04` and `02-BUG-01` (merged).
- **What happens**: `loadSettings()` trusts `data.json` to hold an array of objects. `widgetType(i.type)` dereferences `i.type`, so one `null` entry throws `TypeError` out of `onload()`. Nothing registers: `registerView`, `addRibbonIcon`, the three `addCommand` calls, `addSettingTab` and the vault event handlers are all after the `await` on line 15 and never run. The bad array stays in `data.json`, so every subsequent start throws identically — the plugin cannot be enabled at all.
- **Why it's a defect**: the loader already defends against `layout` being missing / not an array / empty (`src/main.ts:48-50`) and against unknown types (line 53), but not against a non-object *entry* — the one case that makes the plugin unloadable instead of merely wrong. There is no `try`/`catch` in `onload()`.
- **Repro** (executed — my own harness, independent of the verifier's):
  ```
  $ npx tsc --outDir bug-hunt/scratch-09-integrator/build --module commonjs --target es2018 \
      --moduleResolution node --skipLibCheck --noEmit false --esModuleInterop --lib es2018,dom \
      --strict false src/main.ts          # exit 0
  $ node bug-hunt/scratch-09-integrator/probe.cjs
  ########## A. CRITICAL: a null entry in the persisted layout ##########
  layout:[null]        -> onload THREW: TypeError: Cannot read properties of null (reading 'type')
    settings assigned: true | commands registered: 0 | setting tab registered: false
    data.json payload untouched (still has the bad entry): {"layout":[null],"version":2}
  layout:["clock"] -> onload OK | in-memory layout = 0 | cards rendered = 0
  layout:[42]     -> onload OK | in-memory layout = 0 | cards rendered = 0
  layout:[true]   -> onload OK | in-memory layout = 0 | cards rendered = 0
  ```
  `data.json` = `{"layout":[null],"version":2}` is what a hand-edit, a bad merge or a sync conflict can leave behind. The verifier reproduced the same throw (`layout:[null] -> onload THREW: TypeError: Cannot read properties of null (reading 'type')`).
- **Second half of the same filter (quieter, same fix)**: `["clock"]`, `[42]`, `[true]` do not throw — the filter empties the layout *after* the emptiness check on line 48, so the dashboard comes up **completely empty** with no notice, and the next save persists the empty array.
- **Impact**: the whole dashboard, all 22 widgets, the settings tab and all commands disappear for that user, permanently, on every restart, with no in-app recovery — the user must find and hand-edit `data.json`.
- **Suggested minimal fix**: validate the shape before dereferencing, and make `onload` degrade instead of failing:
  ```ts
  this.settings.layout = this.settings.layout
      .filter((i): i is WidgetInstance => !!i && typeof i === "object" && !!widgetType((i as WidgetInstance).type));
  ```
  plus wrap `await this.loadSettings()` in `onload()` in a `try`/`catch` that falls back to `DEFAULT_SETTINGS` and shows a `Notice`.
- **Confidence**: high.
- **Correction to the earlier draft**: `02-BUG-01` claimed the throw leaves `this.settings` *unassigned*. It does not — line 47 assigns it before line 53 throws (measured above). The consequence that matters is unchanged: **zero** commands and no settings tab are registered, and the throw repeats on every load.

---

## High

### HIGH-01 — The grid width is never enforced: Columns 8–11 place 6–8 cards outside the grid
- **Severity**: high
- **Where**: `src/layout.ts:133-158` (`defaultLayout()` hard-codes `x + w = 12`), `src/main.ts:48-49`, `src/main.ts:329-333` (Columns slider, `min: 8, max: 16`), `src/layout.ts:97-108` (`resolveOverlaps` never clamps `x + w`), `src/layout.ts:35` (`fitsAt` bounds only the widget being placed), `src/view.ts:198-202` (`--dash-cx/--dash-cw`), `styles.css:161-163`. Reported as `01-BUG-01`.
- **What happens**: the plugin's own UI offers 8…16 columns, but `defaultLayout()` is written for exactly 12 and no code path compares `x + w` with `settings.columns` on load or when the slider changes. `position()` turns the raw values into `grid-column: (x+1) / span w` against `--dash-cols`, so an over-wide card is placed in *implicit* trailing tracks, outside the declared grid.
- **Why it's a defect**: 4 of the 9 selectable slider values produce a broken board, and neither "Reset layout" (`src/main.ts:350-354`) nor a drag can repair it because the overlap maths only compares data coordinates.
- **Repro** (executed — my own harness): `data.json` `{"version":2,"columns":8,"layout":[]}` (equivalently: slide Columns to 8 and press *Reset layout*), then render.
  ```
  ########## C. the grid width is never enforced (columns=8) ##########
    --dash-cols on the grid: 8
    cards rendered: 22 | placed beyond column 8: 8
    first 4: [{"type":"calendar","cx":"5","cw":"5"},{"type":"activity","cx":"10","cw":"3"},
              {"type":"recent","cx":"5","cw":"5"},{"type":"tags","cx":"10","cw":"3"}]
  ```
  The verifier measured the same set at columns 8/9/10/11 (8, 6, 6, 6 cards out of bounds; 0 at 12/16), and confirmed that an *existing* 12-column layout is not re-flowed when the slider is reduced.
- **Impact**: on any setting other than 12 the dashboard spills past the grid — cards overlap the surrounding chrome or force horizontal scrolling (`.view-content.dash-view` is `overflow:auto`, `styles.css:5-9`), and the user cannot fix it by dragging. (The pixel-level outcome follows from CSS-grid semantics; the emitted tokens above are measured. A 5-minute check in real Obsidian at Columns 8 settles it.)
- **Suggested minimal fix**: make the layout respect `columns` — generate `defaultLayout(columns)` (or clamp `x = min(x, columns - w)`, `w = min(w, columns)`), add a `clampLayout(layout, columns)` pass in `loadSettings()` and whenever `settings.columns` changes, clamp inside `resolveOverlaps()`, and validate `columns` itself (`Number.isFinite` + `Math.max(1, …)`).
- **Confidence**: high.

### HIGH-02 — Unknown-type widgets are deleted from memory and from `data.json`
- **Severity**: high
- **Where**: `src/main.ts:52-53` (in-place `.filter`), `src/main.ts:48-49`, and any save (`src/main.ts:79`, `:91`, `:253`). Reported as `02-BUG-02` plus the second half of `01-BUG-02` (merged).
- **What happens**: the filter drops every layout entry whose `type` is not registered *in this build* and reassigns `this.settings.layout`. Nothing tells the user. The next save — which happens on any note edit via `recordActivity()` → `queueSave()` (`src/main.ts:172-176`) — therefore writes the shrunken array to disk, taking the widget's per-widget settings with it.
- **Why it's a defect**: it is irreversible silent data loss on a normal upgrade/downgrade or a hand-edited type, with no Notice and no backup. The render path is already safe for unknown types (`src/view.ts:180-181` returns early), so the entry could simply be kept.
- **Repro** (executed — my own harness):
  ```
  ########## B. unknown widget type survives in memory but not on disk ##########
    layout in data.json before onload: ["clock","from-newer-version","pomodoro"]
    layout in memory after onload   : ["clock","pomodoro"]
    layout on disk after one save   : ["clock","pomodoro"]
  ```
  Scenario: install a newer Aurora Dashboard that added a widget type, roll back to 1.2.6, open the dashboard.
- **Impact**: the user's widget and its settings vanish on downgrade and are gone from `data.json` after the first edit; restoring the newer plugin version does **not** bring them back.
- **Suggested minimal fix**: keep unknown-type instances in the array and skip them at render time (`buildWidgetCard` already does); if they must be dropped, show `new Notice("Aurora Dashboard: N widgets were removed because their type is unknown")` and do not persist the shrunk layout without confirmation.
- **Confidence**: high.

### HIGH-03 — `openDay()` creates no daily-note folder; folder creation is never recursive
- **Severity**: high
- **Where**: `src/main.ts:128-141` (`openDay`), `src/main.ts:210-218` (`ensureFolder`), `src/main.ts:154-158` (`dailyNotePath`); call sites `src/widgets/calendar.ts:70` and `src/widgets/quickactions.ts:85`. Reported as `03-BUG-03` + `03-BUG-04` (merged).
- **What happens**: `openDay` checks for an existing file and otherwise calls `vault.create(path, "")` directly — it never creates the folder part. `ensureFolder` (used by the *capture* path only) makes a single `createFolder(dir)` call for the whole path, which cannot create intermediate folders. So a daily-note folder that does not exist yet (the normal state after typing "Journal" in settings) and any folder-style format (`YYYY/MM/DD`) both fail.
- **Why it's a defect**: `README.md:14` promises the calendar and Today widgets "open, **create**, and manage your daily notes" and `README.md:28` says "click a day to open or **create** it". The creation half does not work in the configuration the settings group invites the user to create.
- **Repro** (executed by the verifier with a folder-validating vault model):
  ```
  dailyNoteFolder='Journal' (absent), format YYYY-MM-DD
  openDay(2024-06-15) -> Notice = "Could not create the note for that day." | vault contents: ["Notes/Alpha.md"]
    (same settings, capture path — captureText DOES call ensureFolder:
     captureText('hi') -> "Captured" | vault contents: ["Notes/Alpha.md","Journal/Inbox.md"])
  format="YYYY/MM/DD", folder Journal exists:
  openDay -> Notice = "Could not create the note for that day." | folders: ["Journal"]
  captureText -> REJECTED ENOENT: no such file or folder: Journal/2026/09 | Notice = null
  ```
- **Impact**: the calendar day cells and the "Today's note" quick action are dead in a fresh install; the notice does not say which folder is missing and no note is created. Users with a nested format can never create a daily note from the dashboard, and the calendar/streak widgets keep pointing at paths that stay empty.
- **Suggested minimal fix**: create the whole folder chain in a shared recursive `ensureFolder` (create each segment in turn) and call it from `openDay` before `vault.create`; include the missing folder in the failure notice.
- **Confidence**: high. *Caveat*: the "capture fails too" half assumes real `Vault.createFolder` cannot create intermediate folders (unverifiable in this sandbox, see Coverage and limits). The `openDay` half needs no such assumption — it creates nothing at all either way.

### HIGH-04 — `pointercancel` is never handled: drag/resize leaks listeners and sticks
- **Severity**: high
- **Where**: `src/view.ts:340-352` (`enableDrag`), `src/view.ts:415-425` (`enableResize`); no `touch-action` anywhere in `styles.css` (checked: `grep touch-action styles.css` → none). Reported as `04-BUG-01` (mechanism half merged with `07-BUG-04`).
- **What happens**: a gesture only tears itself down from `pointerup`. There is no `pointercancel` listener, no `Escape` handler and no `setPointerCapture`, and no CSS opts the grip/resize handle out of browser panning. On a touch device the browser claims the gesture at the first movement and fires `pointercancel` instead of `pointerup`, so the two `document` listeners are never removed, `card.classList` keeps `is-dragging` forever, and the drop target stays visible. `onClose()` cannot help — these listeners are not in `this.cleanups`.
- **Why it's a defect**: every cancelled gesture permanently adds a `pointermove` + `pointerup` handler, and each stale `onMove` runs `cellAt()` + `showDropTarget()` on every later mouse move; a stale `onUp` can commit a position for a card that is no longer on screen. `manifest.json:9` says `isDesktopOnly: false`, so touch is a supported target.
- **Repro** (executed by the verifier):
  ```
  document pointer listeners after pointerdown: ["pointermove","pointerup"]
  after pointercancel -> ["pointermove","pointerup"] | card still .is-dragging: true
  after two more cancelled gestures -> leaked document listeners: 6
  touch-action declared anywhere in styles.css: false
  ```
  Real-world: on a phone/tablet in edit mode, drag a widget by its grip — the grid scrolls, the widget snaps back, and dragging degrades as stale handlers accumulate.
- **Impact**: drag/resize is effectively unusable on touch (a documented core feature, `README.md:62`), plus an unbounded listener leak that persists after the dashboard is closed and degrades the whole workspace session.
- **Suggested minimal fix**: factor the teardown into one function and attach it to `pointercancel` as well as `pointerup`, committing only on `pointerup`; push it into `this.cleanups` so `onClose()` also detaches; add `touch-action: none;` to `.dash-grip` and `.dash-resize`. (Snippet in `04-view-interaction.md` BUG-01.)
- **Confidence**: high for the leak and stuck state (measured). The mouse-side trigger (release outside the window content) is plausible but unverified; the touch path alone establishes the finding.

### HIGH-05 — `noHeader` widgets (Clock) cannot be dragged, configured or removed
- **Severity**: high
- **Where**: `src/view.ts:205-206` (`buildWidgetHeader` returns immediately for `noHeader`), so no `.dash-grip` exists and `src/view.ts:318-319` (`enableDrag`) bails; no gear/✕ because `src/view.ts:222-235` is never reached; the now-dead resize corner is still created at `src/view.ts:395`; `src/widgets/clock.ts:10` sets `noHeader: true`. Reported as `04-BUG-04`.
- **What happens**: a `noHeader` card is in edit mode (dashed border, resize corner) but has no controls at all. The Clock is in the default layout (`src/layout.ts:135`) and *Add widget* will happily create more (`src/main.ts:233-255`), so a stray clock can only be cleared by *Reset layout*, which discards every other layout change.
- **Why it's a defect**: `README.md:12` documents edit mode as "drag, resize, remove, and re-configure widgets" and `README.md:62` says "Drag widgets by their grip, resize from the corner, use the gear for per-widget settings, the ✕ to remove". None of that is true for this shipped widget type, and nothing is keyboard- or command-reachable either (the only three commands are `src/main.ts:21-35`).
- **Repro** (executed by the verifier):
  ```
  clock card:    grip=0  gear=0  remove=0  resize=1  collapse=0
  activity card: grip=1  gear+remove=2     resize=1
  addWidget('clock') accepted -> layout entries: 2 -> 3
  ```
  *Sub-claim refused*: the report's "their resize handle does nothing" is wrong — the handle is live (`enableResize` runs for every card) and dragging the clock's corner changed `w` from 4 to 10 in the verifier's probe.
- **Impact**: duplicate/interstitial clock widgets are permanent; the clock cannot be repositioned, resized, configured or removed through the UI.
- **Suggested minimal fix**: in edit mode render a minimal header for `noHeader` widgets (`.dash-grip` + `.dash-widget-actions` only, without title/icon), or attach the drag handler to the whole card while edit mode is on; skip `enableResize` when the card has no grip so the dead corner is not shown.
- **Confidence**: high.

### HIGH-06 — Clicking one task completes every task with the same text
- **Severity**: high
- **Where**: `src/widgets/content.ts:133-147` (`toggleTask`) — the `.map()` at 138-144 rewrites every matching line; the row binds the task **text** only (`src/widgets/content.ts:130`, `cb.addEventListener("click", () => void toggleTask(text))`). Reported as `06-BUG-01`.
- **What happens**: `toggleTask(text)` matches on text alone, so one click flips every line in the daily note whose checkbox text is identical. Unlike `vaulttasks.ts:172-189`, the write-back is not line-addressed.
- **Why it's a defect**: the widget renders each duplicate as its own row with its own checkbox, so the UI promises per-row granularity and then silently modifies other tasks. There is no undo hint, and the second task disappears into the "Completed" section.
- **Repro** (executed by the verifier): daily note containing `# doc` / `- [ ] dup` / `middle` / `- [ ] dup`; click the checkbox of the *first* `dup` row.
  ```
  rows rendered: 2 ["dup","dup"]
  file after clicking only the first 'dup' row:
    1: - [x] dup
    3: - [x] dup        <- the second task was silently completed too
  ```
- **Impact**: **user note content is modified destructively with no confirmation** — a user ticking one of two identically-named tasks ("Follow up", "Buy milk", "Reply") marks the other done as well. This is one of the two findings with direct note corruption; treat it as the top fix after CRIT-01.
- **Suggested minimal fix**: pass the source line index from the `load()` loop into `toggleTask` and rewrite only that line after verifying the text still matches (the pattern already used in `src/widgets/vaulttasks.ts:172-189`); fall back to a text match only when the line check fails.
- **Confidence**: high.

---

## Medium

### MED-01 — `formatDate` is a chain of single-occurrence replaces, so formats are mangled
- **Severity**: medium · **Where**: `src/utils.ts:19-26`, consumed by `src/main.ts:150-158` (`dailyNotePath`). Reported as `01-BUG-07` + `03-BUG-01` (merged).
- **What happens**: each token is replaced with `String.prototype.replace(string, …)`, which replaces only the **first** occurrence, and later rules match inside earlier results. There is no tokeniser, so repeated tokens survive as literal text.
- **Why it's a defect**: `dailyNoteFormat` is free text that Obsidian users fill with Moment-style formats; the plugin then resolves to a *different* file than the user's existing daily notes, so the calendar dots, streak, Today widget and capture all agree on a filename that never matches reality. (`dd` is also mapped to day-of-month while the setting's own help text lists `ddd` as the weekday token and never documents `dd`.)
- **Repro** (executed — my own harness, Fri 6 Nov 2026):
  ```
  ########## E. formatDate chained replace (spot check) ##########
    formatDate("YYYY-MM-DD"          ) = "2026-11-06"
    formatDate("DD.MM.DD"            ) = "06.11.DD"
    formatDate("MM/DD/MM"            ) = "11/06/MM"
    formatDate("dddd, DD MMMM YYYY"  ) = "Frid, 06 NovM 2026"
    formatDate("YYYY-MM-DD_dd"       ) = "2026-11-06_06"
  ```
  `dailyNotePath` then returns `Daily/06.11.DD.md` / `Frid, 06 NovM 2026.md`.
- **Impact**: with any format beyond the six simple tokens every daily note is written to a garbage filename, permanently; the user's real daily notes are never found again and the failure is silent.
- **Suggested minimal fix**: one longest-token-first regex pass, e.g.
  `fmt.replace(/YYYY|YY|MMMM|MMM|MM|DD|dddd|ddd|dd/g, (m) => TABLE[m])`, and document the supported token set.
- **Confidence**: high.

### MED-02 — Duplicate `uid`s are never repaired
- **Severity**: medium · **Where**: `src/main.ts:56` (a uid is seeded only when falsy), `src/layout.ts:18-20` (`hasOverlap` skips same-uid), `src/view.ts:231` (delete by uid), `src/view.ts:241-262` (`handles` keyed by uid), `src/view.ts:269`, `src/view.ts:282`. Reported as `01-BUG-06` + `02-BUG-08` (merged).
- **What happens**: two entries sharing a uid are indistinguishable to every identity comparison in the plugin, so `resolveOverlaps` never separates them, `refreshWidget`/`refreshAllOfType` resolve to the first instance, `handles` can hold only one entry, and ✕ removes **both**.
- **Why it's a defect**: a uid is the plugin's only widget identity, and the loader keeps duplicates instead of repairing or rejecting them.
- **Repro** (executed by the verifier): `data.json` with two entries sharing `uid: "dup"` / `"SHARED"`:
  ```
  uids after loadSettings: ["dup","dup"]     overlaps() = true | hasOverlap(layout, a) = false
  positions after resolveOverlaps: [[0,0],[0,0]]      cards: 2 | view.handles.size: 1
  layout entries after clicking remove on the first card: 0 []        <- ✕ removed BOTH widgets
  clock+calendar sharing uid "SHARED": card2 body before: dash-cal-head
    card2 body after refreshActivityWidgets(): dash-clock-time          <- calendar card re-rendered as a clock
    live 1s-clock intervals before/after: 1 -> 2 (the first card's interval was disposed by its twin)
  ```
- **Impact**: two widgets render exactly on top of each other (one unreachable), one stops updating, a card can be re-rendered with another widget's body, and removing one widget destroys its twin.
- **Suggested minimal fix**: de-duplicate on load (`const seen = new Set<string>(); … if (!inst.uid || seen.has(inst.uid)) inst.uid = uid(); seen.add(inst.uid)`) and persist the repair.
- **Confidence**: high (behaviour); medium on how often users hit it (needs a duplicated uid in the file).

### MED-03 — Persisted settings and geometry are used completely unvalidated
- **Severity**: medium · **Where**: `src/main.ts:45-51` (`loadSettings`, no type/number validation at all), `src/view.ts:170-172` (`--dash-cols/--dash-row/--dash-gap`), `src/view.ts:199-202` (`--dash-cx/--dash-cy/--dash-cw/--dash-ch`), `src/layout.ts:74-75` (`for (let x = 0; x < columns; x++)`). Reported as `01-BUG-05` + `02-BUG-06` (merged).
- **What happens**: `Object.assign({}, DEFAULT_SETTINGS, raw)` copies whatever `data.json` contains; the following `.map` only fills `uid`/`settings`. Bad values go straight into CSS custom properties and layout arithmetic.
- **Why it's a defect**: a corrupt or hand-edited file produces invalid CSS and broken grid maths that the plugin never repairs, and the sliders only bound values the user *drags* — they never sanitise what was loaded.
- **Repro** (executed by the verifier):
  ```
  x:-3            kept x=-3      DOM cx/cy/cw/ch = -2/1/4/2   gridRows=2
  y:1e6           kept y=1000000 DOM cy=1000001               gridRows=1000002
  w:99            DOM cw=99          h:-2  DOM ch=-2  gridRows=1
  x:"3" (string)  DOM cx=31          w:null DOM cw=null        h:null DOM ch=null gridRows=1
  persisted y=5000/100000/1000000 -> nearestFree took 6ms/71ms/692ms
  columns:null/0/-5/"abc" -> --dash-cols = null/0/-5/abc ;   rowHeight:NaN -> --dash-row: NaNpx
    addWidget("clock") with columns=0 -> x=0 y=24  (findFirstFree's inner loop never runs)
  ```
- **Impact**: a dashboard with cards at negative/implicit grid lines, a ~1,000,000-row grid, dropped `grid-column` declarations, and a ~0.7 s main-thread stall on every pointer-up when a corrupt `y` is persisted. Recoverable only by editing `data.json` by hand. (The exact pixel result of `w:99`/`y:1e6` follows from invalid CSS — standard browser behaviour, not observable in jsdom.)
- **Suggested minimal fix**: normalise on load — `clamp(Number.isFinite(+v) ? Math.round(+v) : default, …)` for `columns`/`rowHeight`/`gap` and for every instance's `x/y/w/h` (clamp `w` to `[1, columns]`, `x` to `[0, columns - w]`, `y` to a sane cap), and apply the same clamp in `setControlValue` so the tab cannot write an out-of-range value back.
- **Confidence**: high (the emitted tokens and timings are measured; the pixel consequences are inferred from CSS).

### MED-04 — No `onunload`: the debounced save is neither flushed nor cancelled
- **Severity**: medium · **Where**: `src/main.ts:87-93` (`queueSave`, a bare `window.setTimeout` closing over `this`), `src/main.ts:12` (`saveTimer`); the class defines no `onunload`/`unload` at all. Reported as `02-BUG-05` + `03-BUG-10` (merged).
- **What happens**: a pending 500 ms write keeps the dead plugin instance and its `this.settings` alive and writes `data.json` after teardown. There is also nothing that *flushes* an intentionally pending write, so the newest activity counts are dropped on quit.
- **Why it's a defect**: a plugin that has been unloaded keeps executing and writing; and if the user disables/re-enables inside the 500 ms window, the zombie timer overwrites the new instance's settings with the dead instance's snapshot.
- **Repro** (executed by the verifier; my probe confirms the missing hook and the un-flushed write):
  ```
  install: disk.columns = 12 ; user sets 16 -> disk.columns = 16
  typeof v1.onunload = undefined | pending debounce timer = true
  re-enabled: v2 read disk.columns = 16 ; v2 sets 8 -> disk.columns = 8 (lastWriter = v2-instance)
  after 700ms: disk.columns = 16  lastWriter = v1-instance
  => the dead instance's timer wrote its stale snapshot: true
  pending activity after the edit: null ; 700ms later: {"2026-09-11":28}

  my own probe:
  ########## F. no onunload / debounced save not flushed ##########
    typeof plugin.onunload = undefined
    activity in memory       : {"2026-09-11":2}
    activity in data.json    : undefined
  ```
- **Impact**: settings silently revert to their pre-disable values when the re-enable happens inside the debounce window (tight but real); more likely, up to 500 ms of activity counting is lost on every quit — the counts the user just made are the ones dropped.
- **Suggested minimal fix**:
  ```ts
  onunload(): void {
    if (this.saveTimer !== null) { window.clearTimeout(this.saveTimer); this.saveTimer = null; }
    void this.saveSettings();   // flush instead of dropping
  }
  ```
- **Confidence**: high for the missing hook and un-flushed write; medium for how often real users quit inside the window.

### MED-05 — Vault-write failures are swallowed: silence, no Notice, no log
- **Severity**: medium · **Where**: `src/main.ts:210-218` (`ensureFolder`, empty `catch`), `src/main.ts:193-208` (`captureText`, no try/catch), `src/main.ts:281-286` (`QuickCaptureModal.doIt` awaits with no catch), `src/widgets/vaulttasks.ts:47-49` (`scanTasks` read failures → empty list), `src/widgets/vaulttasks.ts:169-192` (`toggleTask`, `catch { /* noop */ }`), `src/widgets/vaulttasks.ts:198-209` (`openTask`), `src/widgets/content.ts:156-160` (`addNewTask`), `src/widgets/quickactions.ts:106,130`. Reported as `03-BUG-05` + `03-BUG-06` + `07-BUG-06` (merged).
- **What happens**: eight catch blocks with an empty or comment-only body turn real write/read failures into no-ops. A failed task tick, a failed capture and a failed scan all look identical to success from the UI.
- **Why it's a defect**: "the task did not tick" and "the capture did not save" are exactly the failures a user cannot debug, and the code neither notifies nor logs. The contrast is inside the same codebase: `src/main.ts:135-140` (`openDay`) *does* show a Notice and `src/view.ts:258-260` logs render failures with `console.error`.
- **Repro** (executed by the verifier, forcing the failures a read-only vault/sync conflict/full disk produces):
  ```
  == after clicking a task checkbox with vault.modify failing ==
    Notice.last        = null
    console.error calls = 0 []
    file content        = "# A\n- [ ] alpha task\n"  (task still open: true)
  all reads fail -> widget shows "No tasks in your vault yet" | console.error calls = 0
  createFolder fails -> captureText REJECTED ENOENT | Notice.last = null | console.error calls = 0
  captureFolder='Inbox/Daily'        -> REJECTED ENOENT: no such file or folder: Inbox/Daily | Notice = null
  inboxFile="" + captureFolder=Inbox -> REJECTED EEXIST: file already exists: Inbox   | Notice = null
  inboxFile="Notes" (folder Notes)   -> REJECTED EEXIST: file already exists: Notes   | Notice = null
  ```
- **Impact**: a click that appears to do nothing, a capture with no feedback, and a widget that claims the vault is empty when it is merely unreadable. **Not data loss** — corrected from the earlier drafts: neither capture call site clears the input on the failure path (`src/main.ts:284-285` closes the modal only after the await; `src/widgets/content.ts:191-196` clears the textarea only after the await), so the typed text survives.
- **Suggested minimal fix**: keep the tolerated cases narrow and log/notify everything else — in `ensureFolder` re-check the folder after the failure and only swallow when it now exists; in `toggleTask`/`addNewTask`/`captureText` add `console.error(…)` plus `new Notice("Could not update that task.")` / a capture-failure Notice, and keep the capture modal open on failure. Make the recursive folder creation from HIGH-03 shared by both entry points.
- **Confidence**: high that the handlers are silent (measured); medium that users hit a non-ENOENT failure often enough to notice.

### MED-06 — Non-string `dailyNoteFolder`/`dailyNoteFormat` break three widgets
- **Severity**: medium · **Where**: `src/main.ts:45-51` → `src/main.ts:154-158` (`.trim()` on line 156, `formatDate` on 155). Reported as `02-BUG-07`.
- **What happens**: a `null`/number/object value survives the merge and then throws (`Cannot read properties of null (reading 'trim')`, or `String.replace` on a non-string).
- **Why it's a defect**: three widgets share `dailyNotePath`, so instead of one clear error the user gets three generic error cards and the real cause only in the console.
- **Repro** (executed by the verifier): `data.json` `{"dailyNoteFolder":null,…}` → `error cards: 3` with `Dashboard widget failed to render: calendar TypeError: Cannot read properties of null (reading 'trim')` (same for `tasks`, `streak`); `dailyNoteFormat:null` and `dailyNoteFolder:5` behave the same.
- **Impact**: calendar, Today/tasks and streak stay broken (with a misleading "This widget hit a snag — try again.") until the user edits `data.json`; no Notice, no validation feedback.
- **Suggested minimal fix**: coerce on load — `this.settings.dailyNoteFolder = typeof … === "string" ? … : ""` (same for `dailyNoteFormat`, `captureFolder`, `inboxFile`, `accent`) — or make `dailyNotePath` defensive with `String(this.settings.dailyNoteFolder ?? "").trim()`.
- **Confidence**: high.

### MED-07 — A non-object `activity` map is not normalised
- **Severity**: medium · **Where**: `src/main.ts:51` (`?? {}` only catches `null`/`undefined`) → `src/main.ts:172-177` (`recordActivity`); render side `src/widgets/activity.ts:16`, `:40`, `:66`. Reported as `02-BUG-10` + `05-BUG-06` (merged).
- **What happens**: a primitive `activity` passes the guard and `recordActivity()` then tries to create a property on a primitive, which always throws in strict-mode compiled code — once per note edit, inside the vault event handler. A number/string also renders nonsense in the heatmap.
- **Why it's a defect**: the loader makes `layout` safe with `Array.isArray` but performs no type check on `activity`, so a hand-edited/sync-damaged file turns every edit into a thrown TypeError with no user-visible repair.
- **Repro** (executed by the verifier; my own probe reproduces the write path):
  ```
  activity=5 / "x" / 0 / true -> settings.activity unchanged; recordActivity() THREW
      TypeError: Cannot create property '2026-09-11' on number '5'     (called from both vault handlers)
  activity=[1,2] -> recordActivity() ok -> array gains a string key;  heatmap renders "Total · 3"
  activity=null  -> coerced to {} by main.ts:51 (ok)
  heatmap/stats with activity=42  -> renders "Total · 0" / "Edits this week · 0" nonsense
  heatmap with activity="x"       -> renders "Total · 0x"
  ```
  *Correction*: the report's "`activity: null` crashes the heatmap" is **not reachable from `data.json`** — line 51 repairs null/undefined. Only a number/string/array survives, and those render nonsense rather than throwing.
- **Impact**: activity tracking silently stops for that install and a TypeError is thrown into Obsidian's vault event dispatch on every edit (nothing is surfaced to the user). The heatmap/Stats widgets show bogus totals for a string/array value.
- **Suggested minimal fix**: type-check instead of nullish-check on line 51 —
  `this.settings.activity = this.settings.activity && typeof … === "object" && !Array.isArray(…) ? … : {}`.
- **Confidence**: medium (trigger requires a malformed file; the throw and the bogus rendering are measured).

### MED-08 — Every date-dependent widget freezes "today" at render time
- **Severity**: medium · **Where**: `src/widgets/calendar.ts:59`, `src/widgets/habits.ts:88` (and 97/118/141-150), `src/widgets/activity.ts:19-36`, `src/widgets/progress.ts:54-66`, `src/widgets/deadline.ts:34-67`, `src/widgets/content.ts:74`; no rollover hook in `src/view.ts:66-87` or `:273-285`. Reported as `05-BUG-02` + `06-BUG-05` (merged).
- **What happens**: each widget computes its notion of "today" once per render and nothing re-renders when the local day changes. Only `clock.ts:21-36` and `streak.ts:67-76` re-read the date on a timer — which is what makes the staleness of the others visible.
- **Why it's a defect**: the plugin's whole point is a dashboard left open (a pinned view); after midnight the Calendar highlights yesterday, the Habits column records yesterday, the heatmap is missing today's square, and the Today widget writes to yesterday's note — while the clock in the same layout rolls over correctly, so two widgets disagree about the date.
- **Repro** (executed by the verifier):
  ```
  23:59:55 on 2026-02-10: cal-today cell "10" | habits is-today "Tu10" | habits last cell 2026-02-10
                          | clock "23:59:55" | clock date "Tuesday, February 10, 2026" | heatmap ends 2026-02-10
  00:01:05 on 2026-02-11: cal-today cell "10" | habits is-today "Tu10" | habits last cell 2026-02-10
                          | clock "00:01:05" | clock date "Wednesday, February 11, 2026" | heatmap ends 2026-02-10
  Today widget, 23:00 -> 00:05 with the dashboard left open:
    task added after midnight -> "2025-06-10.md" contains it ; 2025-06-11.md exists: false
  ```
  `habits.ts:148` writes the cell's own `data-date`, so the stale "today" square records yesterday's completion — the widget the user is invited to click is the wrong one.
- **Impact**: a task typed after midnight is filed into yesterday's note (looks like data loss: the user opens today's note and it is not there), habit ticks are recorded on the wrong day, and the heatmap/calendar show the wrong day until an unrelated event triggers a refresh.
- **Suggested minimal fix**: add one rollover timer to `DashboardView.render()` (the pattern `streak.ts:67-76` already uses) that re-renders when `dateKey(new Date())` changes, and/or recompute the path inside `load()`/`toggleTask()`/`addNewTask()` in `content.ts`.
- **Confidence**: high.

### MED-09 — The plugin's own writes count as user activity
- **Severity**: medium · **Where**: `src/main.ts:39-40` and `:166-177` (`onFileActivity`/`recordActivity`); the plugin's writes at `src/main.ts:136` (`openDay`) and `:225/:227` (`appendTo`). Reported as `03-BUG-08`.
- **What happens**: activity is incremented from vault `create`/`modify` events with no way to tell who caused the write, so opening a not-yet-existing daily note and each quick capture count as edits.
- **Why it's a defect**: the setting is described as "Record note edits to power the heatmap, streaks and stats" (`src/main.ts:402`) and `README.md:13` calls it "a GitHub-style heatmap of your note edits". Clicking a calendar cell is not an edit.
- **Repro** (executed by the verifier):
  ```
  activity[2026-09-11] before openDay: 3
  after openDay (creates the empty daily note): 4          <- +1 for clicking a calendar day
  after two captures into the same note: 6                 <- +2 for two thought captures
  ```
- **Impact**: the heatmap, Week/Total chips and the streak over-report; a user who only browses the calendar and captures ideas shows a "busy" day with zero real edits, and a streak can be held up by an empty note created by a click. The existing smoke suite misses this because it asserts `todayNoteCreated` and `activityRecorded` in separate scenarios.
- **Suggested minimal fix**: set a `this.writing = true` flag around the plugin's own writes and skip recording while it is set, or record only `modify` events on files that already existed before the session.
- **Confidence**: high.

### MED-10 — Every vault write re-renders nine widget types with no throttle
- **Severity**: medium · **Where**: `src/main.ts:172-181` (`recordActivity` → `refreshActivityWidgets`) → `src/view.ts:273-285`; events registered at `src/main.ts:39-40`. Reported as `03-BUG-09`.
- **What happens**: only the settings write is debounced; the same handler synchronously rebuilds the bodies of nine widget types for every `create`/`modify` event in the vault. Each rebuild re-reads the vault and recreates DOM.
- **Why it's a defect**: Obsidian fires `modify` on every autosave, so a normal editing session tears down and rebuilds the same widgets repeatedly while the user is not even looking at the dashboard; `vaulttasks` additionally re-scans its newest 200 files.
- **Repro** (executed by the verifier): `cards rendered: 22 ; widget bodies re-rendered by ONE vault modify event: 9` and `20 modify events -> 180 widget bodies rebuilt in 170ms`.
- **Impact**: constant DOM churn and repeated vault scans competing with typing on a large vault, especially with several dashboard leaves open. (The per-event ratio is exact; the wall-clock figure is jsdom's, not Obsidian's.)
- **Suggested minimal fix**: debounce the refresh with the same 500 ms timer as the save, and skip it entirely when no dashboard leaf is open.
- **Confidence**: medium (per-event cost measured in jsdom).

### MED-11 — A gesture commits after edit mode is left; *Cancel editing* is a no-op on that path
- **Severity**: medium · **Where**: `src/view.ts:340-348` (`onUp` in `enableDrag`), `src/view.ts:415-421` (resize), `src/main.ts:118-122` (`toggleEditMode` takes no `editSnapshot`, unlike the pencil button at `src/view.ts:136-146`). Reported as `04-BUG-02`.
- **What happens**: `onUp` unconditionally mutates the layout and saves; it never re-checks `editMode`, `card.isConnected` or a render generation. A re-render during a gesture (any note edit triggers one, `src/main.ts:176`) detaches the card being dragged, and the gesture keeps writing to the live instances.
- **Why it's a defect**: the dashboard has an explicit discarding path, yet a drag that is in flight when edit mode ends is committed anyway — and `toggleEditMode()` never takes the snapshot that *Cancel editing* restores, so the documented discard path silently does nothing on that entry point.
- **Repro** (executed by the verifier):
  ```
  pointerdown (editMode on) -> plugin.toggleEditMode() -> editMode=false, editSnapshot=null
  position before -> after: {"x":0,"y":0} {"x":8,"y":2}
  enter edit mode via toggleEditMode(), move a widget, click "Cancel editing":
    after clicking Cancel editing: editMode = false | layout x,y = [9,9]  <- the moved widget is NOT restored
  ```
- **Impact**: layout edits cannot be aborted reliably, a widget can be moved/resized when the user is no longer in edit mode, and the change is persisted immediately with no undo.
- **Suggested minimal fix**: capture a render-generation counter at `pointerdown` and return early in `onUp` when `!editMode || gen !== this.renderGen || !card.isConnected`; make `toggleEditMode()` take/clear the same `editSnapshot` as the pencil button.
- **Confidence**: high.

### MED-12 — Below 720 px the JS still uses 12 columns
- **Severity**: medium · **Where**: `src/view.ts:289-300` (`cellAt`), `src/view.ts:302-311` (`showDropTarget`) using `s.columns` and the element width, vs `styles.css:1416-1422` (`@media (max-width: 720px)` forces one column and `grid-column: 1 / -1`). Reported as `04-BUG-03`.
- **What happens**: the stylesheet collapses the grid to a single track and ignores `--dash-cx/--dash-cw`, but the drag maths still divides the visible width into 12 imaginary tracks, so the drop preview is drawn in the wrong place and the committed `inst.x` bears no relation to what the user sees (and is persisted anyway).
- **Why it's a defect**: on a narrow window or a phone the grid maths and the rendered grid describe different layouts, and the stored layout silently drifts.
- **Repro** (executed by the verifier, grid width 700 px):
  ```
  configured columns / CSS real columns = [12,1]   computed cell width = 45.5
  drop preview left/width px: 297.5px / 45.5px
  drop mid-row -> A position {"x":5,"y":2} | rendered grid-column: 6
  ```
- **Impact**: on small windows/mobile the drag preview is meaningless and a drag reshuffles a layout the user cannot see; the change persists and "reappears" when the window is widened.
- **Suggested minimal fix**: derive the effective column count from the element (`rect.width < 720 ? 1 : s.columns`) and use it in `cellAt`, `showDropTarget`, `placeInstance` and the resize clamp — or hide the grip/resize handles while the single-column breakpoint is active.
- **Confidence**: high.

### MED-13 — Checkboxes inside fenced code blocks are live tasks and get rewritten
- **Severity**: medium · **Where**: `src/widgets/content.ts:88-95` (line-by-line regex, no fence awareness) and `:133-147`; same defect in `src/widgets/vaulttasks.ts:41-45`. Reported as `06-BUG-03`.
- **What happens**: any line matching `/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/` is treated as a task, including lines inside ` ``` ` fences and indented code blocks, and the write-back then edits that line.
- **Why it's a defect**: Markdown only renders a checkbox in body prose; counting code samples inflates the "Completed (n)" count and lets the user "toggle" a line inside documentation — corrupting the sample.
- **Repro** (executed by the verifier): a file with a fenced `- [ ] inside fenced code block` renders it as a row in both widgets; clicking that row rewrites the fence content (`- [x] inside fenced code block`).
  *Correction*: the frontmatter half of the original claim was not reproduced — a frontmatter scalar does not match the regex, and it did not appear in either widget's rows.
- **Impact**: notes containing fenced checkbox examples pollute the task list, and one click corrupts the code sample.
- **Suggested minimal fix**: track fence state while scanning (skip until the matching closing ` ``` `/`~~~` and a leading `---`…`---` frontmatter block) in a shared `parseTasks(content)` helper used by both widgets.
- **Confidence**: high.

### MED-14 — Twelve per-widget `styles.css` rules can never match
- **Severity**: medium · **Where**: `src/view.ts:190` (`card.createDiv("dash-widget-body widget-" + type.type)`) vs `styles.css:369, 736, 805, 846, 856, 947, 1002, 1047, 1103, 1123, 1163, 1289` (all written as descendant selectors `.widget-x .dash-widget-body`). Reported as `07-BUG-01`.
- **What happens**: the wrapper class is on the **same** element as `.dash-widget-body`, so every descendant selector matches 0 elements. The control group is convincing: the three `.widget-*` rules that target a child element (`.widget-vaulttasks .dash-list-row`, `.widget-search .dash-search-input`, `.widget-streak .dash-hm-stats`) do match.
- **Why it's a defect**: these twelve rules are the only place that centres the clock, progress rings, pomodoro, streak number, quote and deadline countdown, and the only place that gives several widgets their intended padding. The plugin ships without that styling, and editing those rules has no effect.
- **Repro** (executed by the verifier): all twelve report `matches 0` in six rendered states (normal, edit mode, all collapsed, dragging, overdue), while `.dash-widget-body.widget-clock` matches 1.
- **Impact**: nine widget types render left-aligned/top-stacked instead of centred; Quick capture loses its 12 px column gap; Search/Quick actions/Random/Habits/Vault tasks/Streak lose their intended padding. (Token-level DOM evidence is measured; the visual result follows from the declarations at `styles.css:316-322` and was not rendered in a real browser.)
- **Suggested minimal fix**: drop the descendant combinator — `.dash-widget-body.widget-clock { … }` — for all twelve. Leave the three child rules alone.
- **Confidence**: high.

### MED-15 — README documents a hotkey that is not registered
- **Severity**: medium · **Where**: `README.md:57` and `README.md:61` vs `src/main.ts:21-35`. Reported as `07-BUG-03`.
- **What happens**: the README tells users the dashboard opens "with `Ctrl/Cmd + Shift + D`" in two places; the plugin registers three commands and none declares `hotkeys` (`grep hotkey src` → 0 matches; `grep hotkeys main.js` → 0 matches), so Obsidian installs no default binding.
- **Why it's a defect**: documented behaviour that does not occur, in the README's primary onboarding step.
- **Repro**: press `Ctrl/Cmd + Shift + D` in Obsidian → nothing; *Settings → Hotkeys →* search "Aurora" → all three commands show no hotkey.
- **Impact**: the first thing a new user tries after installing does nothing.
- **Suggested minimal fix**: add `hotkeys: [{ modifiers: ["Mod", "Shift"], key: "d" }]` to the `open-dashboard` command, or change both README lines to "…or assign a hotkey in *Settings → Hotkeys*".
- **Confidence**: high.

### MED-16 — Mobile contract: `isDesktopOnly:false`, no `touch-action`, no mobile install path
- **Severity**: medium · **Where**: `manifest.json:9`, `README.md:50-57` and `:62`, vs the missing `touch-action` in `styles.css` (`grep touch-action styles.css` → none) and `src/view.ts:320`. Reported as `07-BUG-04` (contract half; the interactive half is HIGH-04).
- **What happens**: the manifest declares the plugin installable on iOS/Android, but the README's only install recipe is `npm run build` + copy into `.obsidian/plugins/` + the nonexistent hotkey, and the core edit gesture cannot be performed by touch.
- **Why it's a defect**: `isDesktopOnly: false` is a promise to the Obsidian catalogue and to users; the one thing the plugin is for — a draggable dashboard — is inoperable there and the docs give mobile users no path in.
- **Repro**: install on mobile (or narrow the desktop window below 720 px), enter edit mode, drag a widget's grip — the browser claims the gesture for panning and the card snaps back (HIGH-04), while the preview is computed against 12 imaginary columns (MED-12).
- **Impact**: the plugin is listed on mobile with a documented onboarding route that does not exist.
- **Suggested minimal fix**: either set `"isDesktopOnly": true` (smallest honest change) or add `touch-action: none`, fix the pointer-cancel teardown, and add a short "Mobile" section describing the community-plugins install path.
- **Confidence**: high for the contradiction and the missing CSS; the touch behaviour itself is HIGH-04.

---

## Low

| id | finding | where | repro / evidence (executed unless noted) |
|---|---|---|---|
| LOW-01 | `layout: []` is silently repopulated: the ✕ button's own output (`src/view.ts:230-233`) is undone on the next load, because `length === 0` is treated as "never initialised". `01-BUG-02` | `src/main.ts:48-49` | `data.json layout=[] -> layout after onload: 22 widgets` |
| LOW-02 | With `w > columns`, `fitsAt` rejects every candidate so `findFirstFree`/`nearestFree` return unvalidated fallbacks (`layout.ts:81`, `:66`) and a board of over-wide widgets degenerates to one column. Reachable only via MED-03. `01-BUG-03` | `src/layout.ts:35, 66, 81, 97-108` | `columns=4, findFirstFree({w:6,h:4}) = {"x":0,"y":2}`; 5000 random cases: 0 violations with `w ≤ columns`, 1226 with `w > columns` |
| LOW-03 | Only *rendering* honours `collapsed`; `h` is unchanged in `gridRows`/`overlaps`/`findFirstFree`, so the freed space is unusable and the board does not shrink. `01-BUG-08` | `src/types.ts:19-20`, `src/view.ts:202`, `src/layout.ts:22-26, 69-82, 9-20` | `gridRows with a collapsed 12x4 widget: 4` (renders as `--dash-ch: 1`); `findFirstFree for a 12x2 next to it: {"x":0,"y":4}` |
| LOW-04 | `clamp` returns `lo` when `lo > hi` (and `NaN` for a missing bound), so the resize guard `min.w, min(maxW, columns - inst.x)` at `view.ts:411` *exceeds* the remaining grid. `01-BUG-09` | `src/utils.ts:6-7`, `src/view.ts:411` | zero-delta resize of a widget at `x=11`, `columns=12`: `w` goes `1 → 2`, persisted `x+w = 13 > 12` |
| LOW-05 | `DEFAULT_SETTINGS.activity` is aliased by the shallow `Object.assign` and mutated in place, so a later `loadSettings()` in the same process inherits another session's counts. `01-BUG-10` + `02-BUG-09` | `src/types.ts:58`, `src/main.ts:47, 51, 172-177` | `settings.activity === DEFAULT_SETTINGS.activity → true`; after one `recordActivity()` the module singleton reads `{"2026-09-11":1}` |
| LOW-06 | The migration gate `if (this.settings.version < 2)` is false for `{}` / non-numeric strings, so the Habits widget is never added and the version is never repaired. (`version: undefined` is not reachable from JSON — the default `2` applies.) `02-BUG-03` | `src/main.ts:63-80` | `version={} -> habits added: false, settings.version = {}` |
| LOW-07 | `void this.saveSettings()` on the migration path returns before the write lands, and a rejected `saveData` is dropped silently. `02-BUG-04` | `src/main.ts:79` | `after await plugin.onload(): writes started=1 completed=0 (data.json version on disk = 1)`; 120 ms later `version = 2` |
| LOW-08 | `inboxFile` is concatenated raw, so a capture can create `Inbox` (no `.md`, not openable as a note), `Inbox.md ` (trailing space) or a file literally named `"  "`. `03-BUG-07` | `src/main.ts:195-199` | `inboxFile="Inbox" -> Notice="Captured" created: ["Inbox"]`; `"  " -> created: ["  "]` |
| LOW-09 | A collapsed card is drawn 1 row tall but the resize handle still writes and persists `inst.h` — an invisible size change plus a `resolveOverlaps` re-flow on pointer-up. `04-BUG-06` | `src/view.ts:408-414`, `:202`, `:390-395` | `collapsed: --dash-ch = 1, inst.h = 4`; after dragging: `--dash-ch = 1, inst.h = 7` persisted |
| LOW-10 | A numeric widget setting commits `cfg.min` when the field is empty or unparsable (and the input keeps showing the typed text), so clearing a field silently rewrites it. `04-BUG-07` | `src/view.ts:536-548` | `typed "" -> stored weeks = 4, saved payload weeks = 4` (heatmap drops 14 → 4) |
| LOW-11 | The render error boundary stores `{ dispose: undefined }`, so a widget that subscribes before throwing loses its cleanup permanently (`onClose` cannot recover). Latent: only `backlinks.ts:58-61` subscribes and does not throw. `04-BUG-09` | `src/view.ts:255-262`, `:36-40` | `error card rendered: 1, subscriptions registered: 2, unregistered: 0`; after `onClose()` still 6/0 |
| LOW-12 | `maxCount` starts at 1 and only strictly-greater counts raise it, so the single-edit case computes `0/0` and the cell is written with `data-lvl="NaN"` — the only active day renders as empty. `05-BUG-01` | `src/widgets/activity.ts:38-42, 51, 53` | `activity{today:1} -> data-lvl values ["0","NaN","1","2","3","4"]` |
| LOW-13 | Day-of-year is derived by dividing elapsed milliseconds by `86_400_000`, so it is one day low for the first hour of ~60 days a year in any DST zone (210 wrong days in Bucharest, 238 in New York). `05-BUG-03` | `src/widgets/progress.ts:5, 63, 65` | `rendered Year % differs on 58 days` (Bucharest) / `66` (New York); fix is `Math.round` on the same difference |
| LOW-14 | `parseDate` lets `new Date(y, m-1, d)` normalise out-of-range components, so `2026-02-30` becomes a confident countdown to "Mar 2, 2026". `05-BUG-04` | `src/widgets/deadline.ts:6-11` | `date="2026-02-30" -> days="20" foot="Deadline · Mar 2, 2026"`; the widget does print the resolved date, so the interpretation is visible |
| LOW-15 | "Best" is measured over a fixed 800-day window while the current streak is unbounded, so the two chips contradict each other. `05-BUG-05` | `src/widgets/streak.ts:5, 40-48` | `1000 consecutive daily notes -> num=1000 chips=["Best · 801d","This week · 7/7",…]` (the tooltip does say "last 800 days") |
| LOW-16 | `readHabits` mints a uid for an id-less habit but never writes it back, so each render uses a new id and the logged completions are orphaned and later pruned by `commit()`. Needs a legacy/hand-edited config. `05-BUG-07` | `src/widgets/habits.ts:26, 148, 160-168, 289-296` | `render #1 ids ["h1","mv5…"]; render #2 ["h1","j79…"]; ids persisted back: [{"id":"h1",…},{"name":"Read"}]` |
| LOW-17 | Only `-`/`*` bullets are recognised, so `+ [ ]`, `1. [ ]` and `2) [ ]` are neither listed nor toggleable. Incompleteness — the "Obsidian renders those as checkboxes" premise is reference behaviour I could not test here. `06-BUG-02` | `src/widgets/content.ts:92, 140` | `rendered rows: ["hyphen","star","indented-two","tab-indented"]` (no `plus`, `numbered-one`, `numbered-paren`) |
| LOW-18 | When the cached line index no longer matches, `vaulttasks` falls back to `findIndex` on text only, so the *first* same-text task is flipped instead of the clicked one. `06-BUG-04` | `src/widgets/vaulttasks.ts:176-184` | with a line inserted at the top before the click: `1: - [x] dup task` (the first) while `3: - [ ] dup task` (the clicked one) is untouched |
| LOW-19 | The template note name has minute resolution, so a second click in the same minute fails with the unhelpful `Couldn't create note from template.`. Executed against a folder-validating vault by the verifier. `06-BUG-07` | `src/widgets/quickactions.ts:118-131` | `#1 Notice: "Created 2026-09-11-1412"`; `#2 (same minute): "Couldn't create note from template."` |
| LOW-20 | The release workflow is triggered by any matching tag, copies it verbatim and publishes with `overwrite_files: true`, never comparing it with `manifest.json`/`package.json`/`versions.json`. Process gap, not a runtime bug (all three agree today). `07-BUG-05` | `.github/workflows/release.yml:3-12, 49-57, 72-82` | static only; no step greps any version file |
| LOW-21 | `getControlValue("accent")` returns `#7c3aed` when the stored value is `""`, so the picker shows a fixed purple swatch while the dashboard is actually using the theme accent. `07-BUG-07` | `src/main.ts:311-314` | `accent="" -> getControlValue("accent") = "#7c3aed"` while the dashboard sets `--dash-accent` to `""` |
| LOW-22 | **Integrator re-verification.** A blank or whitespace-only `dailyNoteFormat` produces `Daily/.md` / `Daily/   .md`: a hidden dot-file or a name Windows will not open. This is the only salvageable part of the otherwise-refuted `03-BUG-02` (see Appendix A); nothing here depends on the refuted "days merge into one file" claim, and `dailyNotePath` is not validated at `src/main.ts:154-158`. | `src/main.ts:154-158`, settings `src/main.ts:425-428` | my own run: `fmt="" 15th -> "Daily/.md"`; `fmt="   " 15th -> "Daily/   .md"` (single-line fix: trim the formatted name, reject an empty result, default to `YYYY-MM-DD`) |

---

## Coverage and limits

**Areas analysed** (7 parallel passes + 1 verification pass, 62 raw findings → 55 confirmed → 45 after merging):

1. `src/layout.ts`, `src/utils.ts`, `src/types.ts`, `src/registry.ts` and layout handling in `main.ts` (grid maths, placement primitives, `formatDate`, uid generation).
2. `src/main.ts` lifecycle: `onload`/`loadSettings`/`saveSettings`/`queueSave`, migration, settings tab, commands.
3. `src/main.ts` features: activity recording, daily-note paths, `openDay`, capture, search plumbing.
4. `src/view.ts`: control bar, grid, per-widget chrome, drag/resize, edit mode, collapse, modals, error boundary.
5. Time widgets: clock, calendar, activity heatmap, habits, streak, progress, deadline.
6. Content widgets: `content.ts` (Today), vaulttasks, links, pinned, quickactions, tools (pomodoro), random.
7. Cross-cutting seams: CSS↔DOM class contract, packaging/version/id drift, the release workflow, docs vs reality, a robustness sweep.

**Executed vs static.** The great majority of findings here are **executed**: the real TypeScript sources were
compiled to CommonJS with `npx tsc --outDir … --module commonjs … src/main.ts` (exit 0) and driven in-process
with jsdom + `smoke/stub-obsidian.js` via `bug-hunt/shim.cjs`. Pure-function findings (layout maths,
`formatDate`, date arithmetic) were additionally brute-forced with property tests. The critical finding and
four others were re-derived by me in a separate harness (`bug-hunt/scratch-09-integrator/probe.cjs`, output
quoted above) rather than trusted from a report.

Findings that are **static only**, partially, or rest on an unverifiable premise:
- **LOW-20** (release workflow) — read from the YAML; no tag can be pushed here.
- **MED-16** (mobile) — the docs/manifest/CSS greps are executed; the on-device behaviour is inferred.
- **HIGH-03**'s capture half and **MED-05**'s folder-creation arm assume real `Vault.createFolder` cannot create intermediate folders. The `openDay` half of HIGH-03 needs no such assumption (it creates nothing at all).
- **LOW-08**'s "Obsidian will not open an extensionless file as a note" and **LOW-17**'s "Obsidian renders `+ [ ]`/`1. [ ]` as checkboxes" are reference-implementation behaviour, not testable here.
- **MED-14**, **HIGH-01** and **MED-12**'s *visual* consequences follow from the emitted CSS custom properties and the declarations in `styles.css`; jsdom has no layout engine, so no pixel-level result was ever measured.
- **LOW-14**'s trigger is a typo the user makes; the normalisation itself is executed.

**Environment caveats (important for any fix work).**
- **jsdom stub, not real Obsidian.** `Vault.create` neither creates nor validates folders and never rejects
  duplicates, `Vault.createFolder` is a no-op, `Modal.open()` never appends `contentEl` (so modal bodies are
  mostly unreachable), `Setting` is a component stub, `MetadataCache` exposes no `resolvedLinks`, and
  `Workspace.on()` returns an unregistered `{}`. Two of the most severe findings (HIGH-03, MED-05) exist only
  against a folder-validating vault model that the authors and the verifier each built independently; on real
  Obsidian they are *stronger*, not weaker, but they were never observed there.
- **`esbuild`/`npm run build`/`node smoke/build.mjs` are blocked** by the sandbox (EPERM on the child
  process), so nothing was bundled and the shipped `main.js` was never executed or diffed against `src/` by
  execution (only by string grep). `main.js` was verified current with `src/` at run start.
- **No pixel-level verification anywhere in this run**; `styles.css` is never applied by jsdom.
- **The plugin was never run inside a real Obsidian instance.** Four findings would each be worth ten minutes
  in a throwaway vault before shipping fixes: CRIT-01 (does a `null` in `data.json` really disable the plugin),
  HIGH-01 (Columns = 8), MED-14 (is the clock really left-aligned), HIGH-03 (does clicking an empty calendar
  day create the note).
- Baseline re-verified at the end of the run: `npx tsc -noEmit -skipLibCheck` exits 0 and `node smoke/out.js`
  prints `SMOKE TEST PASSED`.

**Known-untested paths** (nothing found either way; do not read their absence as a clean bill of health):
`quote.ts`, `random.ts` beyond a click probe, `tools.ts` pomodoro beyond a forced-clock probe, `links.ts` with
real `resolvedLinks` data (`popular`/`orphans` were only ever exercised on the empty-state path), the Add-widget
and Quick-actions modal DOM, the mobile runtime, and the installer/updater path. The existing smoke suite has no
assertions for malformed persisted data, gesture teardown, midnight rollover or any per-widget setting.

---

## Appendix A — ruled out (do not re-report)

These were reported by an area agent and **refuted** by the verifier's independent re-derivation. They are
excluded from the findings above; several of them are convincing-sounding and would waste maintainer time.

| refuted claim | why it is not a defect |
|---|---|
| `04-BUG-05` — collapse/expand leaves two widgets overlapping | Collapse/expand only sets `inst.collapsed` and re-renders (`src/view.ts:216-220`); it never touches `x/y/h`. The report's own fixture was already overlapping before the clicks (`A=(0,0,4,4)`, `B=(0,1,4,4)`). 200 random overlap-free layouts, every widget collapsed+expanded → **0** new overlapping pairs. The real, low-severity issue in that area is LOW-03. |
| `07-BUG-08` — `.dash-task` is dead CSS | `src/widgets/content.ts:126` is `list.createDiv("dash-list-row dash-task")`; the class **is** applied (1 element in the render) and the rule at `styles.css:693` is live. The scanning script only matched whole string literals; treat its "40 TS classes with no CSS rule" figure as unreliable. |
| `02-BUG-11` — Reset layout / Clear data do not call `this.update()` | Factually true, but neither action changes a value the tab renders, so there is no user-visible consequence. Consistency, not a defect. |
| `04-BUG-08` — `refreshWidget` does not re-apply the grid position | The mechanism reproduces (`--dash-cw` stays `4` after `inst.w = 9`), but no shipped `WidgetSetting` changes geometry, so there is no reachable wrong output. Latent invariant only. |
| `06-BUG-06` — a deleted pinned note vanishes silently | Skipping paths that no longer resolve and falling back to the empty state is correct behaviour; calling the generic empty state misleading is a copy preference, not wrong output. |
| `03-BUG-02` — `dailyNoteFormat` used verbatim merges days / allows path traversal | The headline describes intended format semantics that Obsidian's own Daily Notes core plugin shares: a user who configures `YYYY` has asked for one note per year, and every dashboard path agrees. The `../`-traversal and illegal-character halves depend on Obsidian's own writer guards and were not established. Only the blank/whitespace sub-claim survives — it is kept as **LOW-22**, at low severity. |
| `07-BUG-02` — five classes rendered with no CSS rule | Housekeeping: the parents already centre/stack them (`.dash-cal-cell` is `display:flex; align-items:center; justify-content:center`, `.dash-modal-row` is `display:flex`), so no wrong output follows. Two of the five are `datalist` **ids** and correctly wired. |

**Partially-refuted sub-claims worth recording** so they are not re-argued:
- `04-BUG-04`'s "a `noHeader` widget's resize handle does nothing" — refuted; the handle is live (dragging the clock's corner changed `w` from 4 to 10). The genuine defect is HIGH-05.
- `05-BUG-06`'s "`activity: null` crashes the heatmap" — not reachable from `data.json`; `src/main.ts:51` repairs null/undefined. Folded into MED-07.
- `02-BUG-03`'s `version: undefined` row — not reachable from JSON (an absent key gets the default `2`). LOW-06 is limited to `{}`/non-numeric strings.
- `02-BUG-02`'s aside "the pre-filter array is what gets written if no save happens" — misleading; line 52 reassigns `this.settings.layout`, so memory and disk agree after any save.
- `06-BUG-03`'s frontmatter half — not reproduced; only an indented frontmatter *list* item would match the regex.
- `02-BUG-01`'s "the throw leaves `this.settings` unassigned" — wrong (line 47 runs first); the plugin still registers nothing (see CRIT-01's correction).

---

## Appendix B — corrections to severity used in this report

The verifier's severity overrides the area reports' own ratings on 26 of 62 findings. The ones that change
what a maintainer should do first:

- `01-BUG-04` + `02-BUG-01` (CRIT-01) was rated **high/medium** by its authors. It is **critical**: the plugin
  becomes permanently unloadable and there is no in-app recovery.
- `03-BUG-05` + `03-BUG-06` (MED-05) were rated **high** ("the text is silently dropped"). They are **medium**:
  nothing is actually lost — the typed text stays in the textarea/modal, and the defect is the silence.
- `04-BUG-04` (HIGH-05) was rated high partly on a **refuted** sub-claim; the surviving defect
  (no drag/gear/remove) still rates high.
- `05-BUG-06`, `04-BUG-08`, `02-BUG-11`, `06-BUG-06`, `07-BUG-02`, `03-BUG-02` were rated medium/high and are
  now **low** or **excluded** (Appendix A).

---

## Recommended fix order

1. **CRIT-01** — one-line shape check plus a `try`/`catch` in `onload()`. Highest severity, smallest change,
   and it is the only finding that makes the plugin impossible to enable at all. Ship it alone if necessary.
2. **HIGH-06** — line-address the task toggle in the Today widget. It is the only confirmed defect that
   *silently rewrites the user's own note content*, and the fix pattern already exists in `vaulttasks.ts`.
3. **HIGH-02** — keep unknown-type layout entries instead of deleting them, with a Notice if any are dropped.
   Irreversible loss of a user's widget and its settings from `data.json`.
4. **MED-01 + MED-08 + MED-13** — the remaining note/filename-corruption cluster: tokenise `formatDate` in one
   regex pass, add a midnight rollover, and skip code fences when scanning tasks. These three are what turn
   "the dashboard is wrong" into "my files are wrong".
5. **HIGH-01 + MED-03 + LOW-02 + LOW-04** — do these as one piece of work, because they are one root cause: no
   validation of persisted geometry/columns. A single `normaliseSettings()` + `clampLayout(layout, columns)`
   pass on load (and a clamp in `setControlValue`) fixes all four and removes the corrupt-`y` main-thread
   stall.
6. **HIGH-03 + MED-05** — a recursive `ensureFolder` shared by `openDay` and `captureText`, plus surfacing the
   failures. Restores the documented "click a day to create it" feature and makes failed writes visible.
7. **HIGH-04 + MED-12 + MED-16** — the touch/mobile cluster: `pointercancel` teardown, `touch-action: none`,
   effective column count at the 720 px breakpoint, and then decide honestly between `isDesktopOnly: true` and
   a real mobile path.
8. **HIGH-05** — minimal edit-mode chrome for `noHeader` widgets so a stray Clock can be removed.
9. **MED-02 + MED-04 + MED-07 + MED-06** — identity and lifecycle hardening: de-duplicate uids, add
   `onunload` (clear **and** flush), type-check `activity`, coerce the string settings. Small, mechanical,
   each removing a class of corrupt-file symptom.
10. **MED-09 + MED-10** — activity fidelity and refresh throttling (perf, no correctness risk).
11. **MED-11 + MED-14 + MED-15** — layout-edit abort path, the twelve dead CSS selectors, and the README
    hotkey (docs are a one-line fix; the CSS fix is mechanical but visible).
12. **LOW-01 … LOW-22** — polish, latent invariants and the release-workflow guard. LOW-20 is worth doing
    before the next release even though it is only a process gap; LOW-08/LOW-22 are cheap input-validation
    additions to make while touching the capture/daily-note code in step 6.
