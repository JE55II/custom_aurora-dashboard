# 08 — Adversarial verification of every reported finding

Task: **verify-findings** (reviewer). Inputs: `bug-hunt/01-geo-layout.md` … `bug-hunt/07-integration-surface.md`
(62 findings) plus `bug-hunt/README.md`.

Every verdict below was re-derived from `src/` — the referenced file was opened, the referenced lines read, the
quoted code compared with the current text, and the claimed behaviour either executed or traced. Nothing is
accepted on the strength of another agent's summary.

## Method / harness (reproducible)

```powershell
npx tsc --outDir bug-hunt/scratch-08-verify/build --module commonjs --target es2018 `
  --moduleResolution node --skipLibCheck --noEmit false --esModuleInterop --lib es2018,dom --strict false src/main.ts
cd bug-hunt/scratch-08-verify
node p01-geo.cjs ; node p02-main.cjs ; node p03-features.cjs ; node p04-view.cjs
node p05-time.cjs ; node p06-content.cjs ; node p07-integration.cjs ; node p08-misc.cjs
# TZ-sensitive probe:  $env:TZ='America/New_York'; node p05-time.cjs
```

I wrote my own harness (`lib.cjs`) rather than reusing the authors' probes, so nothing is confirmed by a copied
result. Two additions mattered:

* **A faithful vault model** (`lib.cjs:realisticVault`): `vault.create()` requires an existing parent folder and
  rejects duplicates, `vault.createFolder()` requires the parent to exist, existing files imply their ancestor
  folders, and write failures can be forced. The stock `smoke/stub-obsidian.js` `Vault` is permissive —
  `create()` never creates/validates folders and never rejects on a duplicate path — so findings 03-BUG-03/04/05/06/07
  and 06-BUG-07 are simply not visible with the unmodified stub (their authors patched it too; I modelled it
  independently).
* **jsdom cannot apply CSS or lay out.** Anything about implicit grid tracks, the 720 px media query or the visual
  effect of dead rules is *inferred from the declarations* and marked as such. jsdom stores custom properties
  (`--dash-cx` …) verbatim, so the token-level evidence is real.

Baseline re-verified after my work: `npx tsc -noEmit -skipLibCheck` exits 0; `node smoke/out.js` prints
`SMOKE TEST PASSED` (nothing outside `bug-hunt/08-verification.md` and `bug-hunt/scratch-08-verify/` was written).

---

## 1. Verdict table

Severity is **mine** (critical = data loss / crash / security · high = broken feature or wrong data shown ·
medium = degraded UX or leak · low = cosmetic/latent). "M-n" marks merged findings (§2).

| id | source | verdict | my severity | one-line reason |
|---|---|---|---|---|
| 01-BUG-01 | 01-geo-layout | CONFIRMED | high | `defaultLayout()` hard-codes 12 columns; slider allows 8–16; at 8 columns 8/22 cards render at implicit columns; nothing re-flows on change |
| 01-BUG-02 | 01-geo-layout | CONFIRMED | medium | `layout: []` is rebuilt into 22 widgets on load; all-unknown layout renders 0 cards (second half merged into M-5) |
| 01-BUG-03 | 01-geo-layout | CONFIRMED | low | `findFirstFree`/`nearestFree` return out-of-bounds fallbacks when `w > columns`; reachable only downstream of M-11 |
| 01-BUG-04 | 01-geo-layout | CONFIRMED | **critical** | a `null` entry in `layout` throws out of `onload()`; plugin permanently unloadable (M-4) |
| 01-BUG-05 | 01-geo-layout | CONFIRMED | medium | persisted `x/y/w/h` go into CSS tokens unvalidated (`"3"+1`→`31`, `w:null`→`span null`, `y:1e6`→1 000 002 rows) (M-11) |
| 01-BUG-06 | 01-geo-layout | CONFIRMED | medium | duplicate uids are kept; twins cannot be separated, one handle is lost, ✕ deletes **both** (M-2) |
| 01-BUG-07 | 01-geo-layout | CONFIRMED | medium | `formatDate` chain replaces each token once → `"06.11.DD"`, `"Frid, 06 NovM 2026"` (M-1) |
| 01-BUG-08 | 01-geo-layout | CONFIRMED | low | a collapsed widget keeps its full `h` in `gridRows`/`findFirstFree`/`overlaps`; the freed space is unusable |
| 01-BUG-09 | 01-geo-layout | CONFIRMED | low | `clamp` returns `lo` for inverted bounds → a zero-delta resize persists `x=11,w=2` (`x+w=13>12`) |
| 01-BUG-10 | 01-geo-layout | CONFIRMED | low | `DEFAULT_SETTINGS.activity` is aliased by `Object.assign` and mutated in place (M-3) |
| 02-BUG-01 | 02-main-persist | CONFIRMED | **critical** | same defect as 01-BUG-04 (M-4); also `layout:["clock"]/[42]/[true]` silently load as an **empty** dashboard |
| 02-BUG-02 | 02-main-persist | CONFIRMED | high | unknown-type entries are dropped from memory *and from the next save*; no notice (M-5) |
| 02-BUG-03 | 02-main-persist | CONFIRMED | low | non-numeric `version` (`{}`, `"abc"`) skips the v1→v2 migration forever; the `undefined` row is not JSON-reachable |
| 02-BUG-04 | 02-main-persist | CONFIRMED | low | `void this.saveSettings()` in `loadSettings`: `await onload()` resolves with the pre-migration file still on disk |
| 02-BUG-05 | 02-main-persist | CONFIRMED | medium | no `onunload`; the dead instance's debounce wrote `columns=16` back over the new instance's `8` (M-6) |
| 02-BUG-06 | 02-main-persist | CONFIRMED | medium | `columns`/`rowHeight`/`gap` unvalidated → `--dash-cols: abc`, `columns=0` makes `addWidget` stack at `y=rows+1` (M-11) |
| 02-BUG-07 | 02-main-persist | CONFIRMED | medium | `dailyNoteFolder:null` → `.trim()` throws; calendar/tasks/streak each render the error card |
| 02-BUG-08 | 02-main-persist | CONFIRMED | medium | duplicate-uid consequences (M-2) |
| 02-BUG-09 | 02-main-persist | CONFIRMED | low | shared `DEFAULT_SETTINGS.activity` (M-3) |
| 02-BUG-10 | 02-main-persist | CONFIRMED | medium | `activity: 5/"x"/true/0` → `recordActivity()` throws on every note event (M-9) |
| 02-BUG-11 | 02-main-persist | **REFUTED** | — | neither action changes any value the tab renders; the missing `update()` has no user-visible effect |
| 03-BUG-01 | 03-main-features | CONFIRMED | medium | `formatDate` chained replace (M-1) |
| 03-BUG-02 | 03-main-features | **REFUTED** | low* | the headline ("days merge into one file") is intended format semantics, identical to Obsidian's core Daily Notes; one salvageable low sub-claim (§4) |
| 03-BUG-03 | 03-main-features | CONFIRMED | high | `openDay()` creates no folder — calendar/Quick-action "create the daily note" fails with an absent folder (M-7) |
| 03-BUG-04 | 03-main-features | CONFIRMED | high | nested daily format (`YYYY/MM/DD`): `openDay` and capture both fail (M-7) |
| 03-BUG-05 | 03-main-features | CONFIRMED | medium | nested `captureFolder` fails silently; **not** data loss — the typed text survives in the textarea (M-7/M-8) |
| 03-BUG-06 | 03-main-features | CONFIRMED | medium | a folder/empty/slashed capture target rejects with `Notice = null` (M-8) |
| 03-BUG-07 | 03-main-features | CONFIRMED | low | `inboxFile` unvalidated: creates `Inbox` (no `.md`), `Inbox.md `, even a file named `"  "` |
| 03-BUG-08 | 03-main-features | CONFIRMED | medium | the plugin's own `openDay`/`captureText` writes increment the activity counters (+1 / +2 measured) |
| 03-BUG-09 | 03-main-features | CONFIRMED | medium | every vault `modify` re-renders 9 widget types with no throttle (9 bodies per event measured) |
| 03-BUG-10 | 03-main-features | CONFIRMED | medium | no unload flush: the pending activity write never reaches disk (M-6) |
| 04-BUG-01 | 04-view-interaction | CONFIRMED | high | `pointercancel` is never handled: listeners leak 2/gesture, `is-dragging` sticks, no `touch-action` in CSS |
| 04-BUG-02 | 04-view-interaction | CONFIRMED | medium | a gesture commits while `editMode=false` (0,0 → 8,2 measured); also *Cancel editing* is a no-op on that path |
| 04-BUG-03 | 04-view-interaction | CONFIRMED | medium | below 720 px the JS still uses `columns=12`: preview at `left:297.5px/width:45.5px`, `inst.x=5` persisted |
| 04-BUG-04 | 04-view-interaction | CONFIRMED | medium | a `noHeader` clock card has grip=0, gear=0, remove=0 (unremovable); the "resize handle does nothing" sub-claim is REFUTED |
| 04-BUG-05 | 04-view-interaction | **REFUTED** | — | collapse/expand never moves anything; the D3 fixture was already overlapping before the clicks; 200 random layouts → 0 new overlaps |
| 04-BUG-06 | 04-view-interaction | CONFIRMED | low | resizing a collapsed card stores `inst.h=7` while `--dash-ch` stays `1` |
| 04-BUG-07 | 04-view-interaction | CONFIRMED | low | `""`/`"abc"`/`"-99"` in a numeric field commit `cfg.min` to disk (weeks 14 → 4) |
| 04-BUG-08 | 04-view-interaction | **REFUTED** | — | the mechanism is real but no shipped setting changes geometry; unreachable, latent invariant only |
| 04-BUG-09 | 04-view-interaction | CONFIRMED | low | a widget throwing after subscribing loses its handle (2 registered, 0 unregistered, `dispose=undefined`); latent today |
| 05-BUG-01 | 05-widgets-time | CONFIRMED | low | `data-lvl="NaN"` whenever the busiest day has exactly 1 edit |
| 05-BUG-02 | 05-widgets-time | CONFIRMED | medium | nothing re-renders at midnight: calendar/habits/heatmap keep yesterday while the clock rolls over (M-10) |
| 05-BUG-03 | 05-widgets-time | CONFIRMED | low | ms/86 400 000 day-of-year: 210 wrong days (Bucharest) / 238 (New York); 58/66 days show a wrong Year % |
| 05-BUG-04 | 05-widgets-time | CONFIRMED | low | `2026-02-30` → countdown to "Mar 2, 2026" |
| 05-BUG-05 | 05-widgets-time | CONFIRMED | low | `Best · 801d` next to a 1000-day current streak |
| 05-BUG-06 | 05-widgets-time | CONFIRMED | low | `activity` non-object → heatmap nonsense (`Total · 3` for `[1,2]`); the *null crash* is not reachable from `data.json` (M-9) |
| 05-BUG-07 | 05-widgets-time | CONFIRMED | low | id-less habits get a new uid each render, so their log keys evaporate |
| 06-BUG-01 | 06-widgets-content | CONFIRMED | high | clicking one duplicate task marks **every** same-text task done (`- [x]` on both lines) |
| 06-BUG-02 | 06-widgets-content | CONFIRMED | low | `+ [ ]`, `1. [ ]`, `2) [ ]` are not listed/toggleable (incompleteness) |
| 06-BUG-03 | 06-widgets-content | CONFIRMED | medium | a checkbox inside a ```` ``` ```` fence is listed and the click rewrites the code sample (frontmatter sub-claim not reproduced) |
| 06-BUG-04 | 06-widgets-content | CONFIRMED | low | with a stale cached line, the `findIndex` fallback flips the *first* same-text task (demonstrated) |
| 06-BUG-05 | 06-widgets-content | CONFIRMED | medium | a task typed after midnight is written into yesterday's note (`2025-06-11.md` never created) (M-10) |
| 06-BUG-06 | 06-widgets-content | **REFUTED** | — | skipping unresolvable pins is correct behaviour; the generic empty state is a copy/UX preference, not wrong output |
| 06-BUG-07 | 06-widgets-content | CONFIRMED | low | the template name has minute resolution → 2nd click: `Notice "Couldn't create note from template."` |
| 07-BUG-01 | 07-integration | CONFIRMED | medium | 12/12 `.widget-* .dash-widget-body` rules match 0 elements — the wrapper class is on the same element (cites are +2 off) |
| 07-BUG-02 | 07-integration | **REFUTED** | — | unstyled wrapper classes produce no demonstrable wrong output (the parents already centre/stack them) |
| 07-BUG-03 | 07-integration | CONFIRMED | medium | README promises `Ctrl/Cmd + Shift + D` twice; no command declares `hotkeys` |
| 07-BUG-04 | 07-integration | CONFIRMED | medium | `isDesktopOnly:false` + no `touch-action` + no mobile install path (mechanism = 04-BUG-01) |
| 07-BUG-05 | 07-integration | CONFIRMED | low | the release workflow never compares the tag with `manifest.json`/`versions.json`; `overwrite_files: true` (process gap, not a runtime bug) |
| 07-BUG-06 | 07-integration | CONFIRMED | medium | failing vault writes are swallowed: no Notice, no `console.error`, task stays open; read failures → "No tasks in your vault yet" |
| 07-BUG-07 | 07-integration | CONFIRMED | low | `getControlValue("accent")` returns `#7c3aed` while the dashboard uses the theme accent |
| 07-BUG-08 | 07-integration | **REFUTED** | — | `.dash-task` **is** applied (`content.ts:126` `"dash-list-row dash-task"`, 1 element in the DOM); their scan missed the multi-class literal |

Totals: **55 CONFIRMED**, **7 REFUTED**, **7 open items in §5 (UNCERTAIN)**, and my severity differs from the
author's on **26** of the 62 findings (including the 7 refutations).

---

## 2. Merged findings (one defect, several report ids)

| merged id | ids | defect |
|---|---|---|
| **M-1** | 01-BUG-07 + 03-BUG-01 (+07's `date-format.cjs` note) | `formatDate` is a chain of single-occurrence `String.replace` calls |
| **M-2** | 01-BUG-06 + 02-BUG-08 | duplicate uids are never repaired; every identity comparison is uid-based |
| **M-3** | 01-BUG-10 + 02-BUG-09 | `DEFAULT_SETTINGS.activity` shared by reference (shallow `Object.assign`) |
| **M-4** | 01-BUG-04 + 02-BUG-01 | a non-object entry in `layout` throws out of `onload()` |
| **M-5** | 02-BUG-02 (+ second half of 01-BUG-02) | unknown-`type` entries are deleted from memory and from disk |
| **M-6** | 02-BUG-05 + 03-BUG-10 | no `onunload`: the debounced `saveTimer` is neither flushed nor cancelled |
| **M-7** | 03-BUG-03 + 03-BUG-04 (+ `ensureFolder` half of 03-BUG-05 / 07-BUG-06) | no recursive folder creation, and `openDay` creates nothing at all |
| **M-8** | 03-BUG-05 + 03-BUG-06 (+ silence half of 07-BUG-06) | capture failures reject with no `Notice`, no log and no UI feedback |
| **M-9** | 02-BUG-10 + 05-BUG-06 | non-object `activity` is not normalised (`?? {}` only catches null/undefined) |
| **M-10** | 05-BUG-02 + 06-BUG-05 | every date-dependent widget freezes "today" at render time |
| **M-11** | 01-BUG-05 + 02-BUG-06 | persisted settings and geometry are copied from `data.json` without any numeric/type validation |
| **M-12** | 04-BUG-01 + 07-BUG-04 (mechanism half) | pointer drag/resize has no `pointercancel` teardown and no `touch-action` |

---

## 3. CONFIRMED — independent evidence + corrected minimal repro

### M-4 / 01-BUG-04 / 02-BUG-01 — a `null` layout entry makes the plugin permanently unloadable
Code (verified verbatim): `src/main.ts:52-53` `.filter((i) => widgetType(i.type))` — `i.type` on `null` throws;
`onload()` awaits `loadSettings()` at `src/main.ts:15` and has no `try`/`catch`.

```
$ node bug-hunt/scratch-08-verify/p01-geo.cjs
layout:[null] -> onload THREW: TypeError: Cannot read properties of null (reading 'type')
layout:["clock"] -> onload OK, layout= 0      <- silently an EMPTY dashboard (02-BUG-01's 2nd half, confirmed)
layout:[42]      -> onload OK, layout= 0
layout:[true]    -> onload OK, layout= 0
```
Severity **critical**, not "high/medium": the throw leaves `this.settings` unassigned, `registerView`/`addCommand`/
`addSettingTab` are never reached, `data.json` is untouched (so the corruption is permanent) and there is no in-app
recovery — the user must hand-edit the file. The `[42]/["clock"]/[true]` cases are a *second*, quieter defect: the
filter leaves an empty array, and `main.ts:48` only refills it when the raw value is not an array, so the dashboard
comes up completely empty and the next save persists that.
**Repro**: `plugin._data = { layout: [null] }; await plugin.onload()` → TypeError. Fix: validate the entry shape
before dereferencing and wrap `loadSettings()` in `onload()` in a `try`/`catch` + `Notice`.

### 01-BUG-01 — the grid width is never enforced
```
columns=8  widgets=22  out of bounds=8  ["calendar@x=4w=5","activity@x=9w=3","recent@x=4w=5","tags@x=9w=3",
                                        "quote@x=7w=5","vaulttasks@x=6w=6","backlinks@x=8w=4","streak@x=8w=4"]
columns=9/10/11 -> 6 out of bounds;  columns=12/16 -> 0
columns=8, rendered: --dash-cols = 8 | cards whose rendered grid-column exceeds the 8-column grid: 8/22
  first three: [{"type":"calendar","cx":"5","cw":"5"},{"type":"activity","cx":"10","cw":"3"}, ...]
existing 12-col layout, slider -> 8: cards beyond col 8 = 8   (nothing re-flows)
```
`src/layout.ts:135-156` lays everything out in 12 columns; no code path compares `x + w` with
`settings.columns` in `loadSettings()` (`src/main.ts:45-59`) or in `resolveOverlaps()` (`src/layout.ts:97-108`).
The emitted `--dash-cx: 10 / --dash-cw: 3` becomes `grid-column: 10 / span 3` in an 8-track grid, so 8 cards are
placed in implicit tracks outside the grid; `.view-content.dash-view` has `overflow:auto`
(`styles.css:5-9`), so the dashboard gains a horizontal scroll region. Severity **high** (a supported setting
value breaks the layout); the pixel-level result is inferred from CSS-grid semantics, the tokens are executed.
**Repro**: `data.json` `{"columns":8,"version":2,"layout":[]}` (or slide Columns after a reset) → render.
Also confirmed: `defaultLayout()` itself is internally consistent (22 entries, 0 overlapping pairs, 22 distinct
uids, max `x+w = 12`, `gridRows = 23`).

### 02-BUG-02 / part of 01-BUG-02 — unknown-type widgets are deleted from memory *and* from `data.json`
```
in-memory layout after onload: ["clock","pomodoro"]                  (was clock, from-newer-version, pomodoro)
serialised layout on the next save: ["clock","pomodoro"]
serialised layout after the 500 ms debounced save: ["clock","pomodoro"]
```
The write is not hypothetical: `recordActivity()` → `queueSave()` runs on every note create/modify
(`main.ts:39-40,172-176`), so any editing session persists the shrunken array. Severity **high** (irreversible
loss of the widget and its per-widget settings on a downgrade or a hand-edited type).
*Correction to the report's aside*: the claim that "the pre-filter array is what gets written if no save happens"
is misleading — `main.ts:52` *reassigns* `this.settings.layout`, so after any save memory and disk agree; only the
window before the first save differs.

### M-7 / 03-BUG-03 + 03-BUG-04 — `openDay()` creates no folder; folder creation is never recursive
```
dailyNoteFolder='Journal' (absent), format YYYY-MM-DD
openDay(2024-06-15) -> Notice = "Could not create the note for that day." | vault contents: ["Notes/Alpha.md"]
  (same settings, capture path — captureText DOES call ensureFolder:
captureText('hi') -> "Captured" | vault contents: ["Notes/Alpha.md","Journal/Inbox.md"])
format="YYYY/MM/DD", folder Journal exists:
openDay -> Notice = "Could not create the note for that day." | folders: ["Journal"]
captureText -> REJECTED ENOENT: no such file or folder: Journal/2026/09 | Notice = null
```
`src/main.ts:128-141` never calls `ensureFolder`; `ensureFolder` (`main.ts:210-218`) makes one
`createFolder(dir)` call for the whole path. Severity **high** — README:14 promises the calendar and Today widget
"open, create, and manage your daily notes" and README:28 "click a day to open or create it", and this is the
default configuration a new user creates by typing a folder name. (The "createFolder is one level only" premise is
the part I could not check against real Obsidian — see §5-U1; the `openDay` half needs no premise at all, because
it creates nothing either way.)

### M-8 / 03-BUG-05 + 03-BUG-06 — capture failures are silent; **not** data loss
```
captureFolder='Inbox/Daily'        -> REJECTED ENOENT: no such file or folder: Inbox/Daily | Notice = null
control captureFolder='Inbox'      -> Notice="Captured" | vault: ["Inbox/Inbox.md"]
inboxFile="" + captureFolder=Inbox -> REJECTED EEXIST: file already exists: Inbox | Notice = null
inboxFile="Notes" (folder Notes)   -> REJECTED EEXIST: file already exists: Notes | Notice = null
inboxFile="sub/Inbox.md"           -> REJECTED ENOENT: no such file or folder: Inbox/sub | Notice = null
createFolder fails (EACCES)        -> captureText REJECTED: ENOENT … | Notice = null | console.error calls: 0
```
Severity **medium**, downgraded from "high" and corrected: the authors' "the text is silently dropped / the
thought is lost" is wrong — neither call site clears the input on the failure path
(`main.ts:281-288` only closes the modal *after* the await; `content.ts:191-196` only does `ta.value = ""` after
the await), so the typed text stays in the textarea/modal and the user's only symptom is a button that appears to
do nothing. What is genuinely broken: no `try`/`catch`, no `Notice`, no `console.error`, and (for the widget) no
indication that the capture did not happen.

### M-11 / 01-BUG-05 + 02-BUG-06 — no validation of persisted settings or geometry
```
x:-3            kept x=-3      DOM cx/cy/cw/ch = -2/1/4/2   gridRows=2
y:1e6           kept y=1000000 DOM cy=1000001               gridRows=1000002
w:99            DOM cw=99          h:-2  DOM ch=-2  gridRows=1
x:"3" (string)  DOM cx=31          w:null DOM cw=null        h:null DOM ch=null gridRows=1
persisted y=5000/100000/1000000 -> nearestFree took 6ms/71ms/692ms
columns:null/0/-5/"abc" -> --dash-cols = null/0/-5/abc ;   rowHeight:NaN -> --dash-row: NaNpx
  addWidget("clock") with columns=0 -> x=0 y=24  (findFirstFree's inner loop never runs)
```
All values reach `src/view.ts:170-172,199-202` and `src/layout.ts:75` unchecked. Confirms both reports at
**medium** (broken/overflowing dashboard + a ~0.7 s main-thread stall per pointer-up with a corrupt `y`; recoverable
only by editing `data.json`). The `h:-2`/"`grid-column` is dropped" and `w:99` conclusions come from invalid CSS
values, which is standard browser behaviour rather than something jsdom can show.

### M-2 / 01-BUG-06 + 02-BUG-08 — duplicate uids
```
uids after loadSettings: ["dup","dup"]     overlaps() = true | hasOverlap(layout, a) = false
positions after resolveOverlaps: [[0,0],[0,0]]      cards: 2 | view.handles.size: 1
layout entries after clicking remove on the first card: 0 []        <- ✕ removed BOTH widgets
clock+calendar sharing uid "SHARED": card2 body before: dash-cal-head
  card2 body after refreshActivityWidgets(): dash-clock-time          <- calendar card re-rendered as a clock
  live 1s-clock intervals before/after: 1 -> 2 (the first card's interval was disposed by its twin)
```
`src/main.ts:56` only fills a *missing* uid; every identity test is uid-based (`layout.ts:18-20`,
`view.ts:231,241-262,269,282`). Severity **medium**; the delete-both consequence is the destructive one.
**Repro**: `{"layout":[{"type":"activity","uid":"dup",...},{"type":"activity","uid":"dup",...}]}` + edit mode →
click the first card's ✕ → `layout.length === 0`.

### 01-BUG-02 — an empty layout is silently restored
```
data.json layout=[] -> layout after onload: 22 widgets
```
`src/main.ts:48` treats `[]` as "never initialised", but the plugin's own ✕ button produces `[]`
(`view.ts:230-233`). Severity **medium** (the user's explicit action is reverted on restart). Fix: distinguish
"key absent" from "empty array" (`"layout" in raw`).

### M-1 / 01-BUG-07 + 03-BUG-01 — `formatDate` mangles formats
```
formatDate(Fri 2026-11-06, "DD.MM.DD")            = "06.11.DD"
formatDate(Fri 2026-11-06, "MM/DD/MM")            = "11/06/MM"
formatDate(Fri 2026-11-06, "dddd, DD MMMM YYYY")  = "Frid, 06 NovM 2026"
formatDate(Fri 2026-11-06, "YYYY-MM-DD_dd")       = "2026-11-06_06"
formatDate(Sat 2024-06-15, "ddd, DD MMM YYYY (ddd)") = "Sat, 15 Jun 2024 (15d)"
formatDate(Fri 2026-11-06, "YYYY YYYY")           = "2026 26YY"   (report: "2024 24YY" — year differs, same shape)
formatDate(…, "dddd") = "Frid" ; formatDate(…, "DDDD") = "06DD"
```
`src/utils.ts:19-26` — plain-string `replace` replaces only the first occurrence, and later rules match inside
earlier results. Severity **medium** (only non-default formats; the surviving literal keeps days apart, so this is
wrong filenames rather than the day-merging claimed in 03-BUG-02). Also relevant: `dd` → *day of month*, while the
setting's own help text (`main.ts:426`) lists `ddd` as the weekday token and never documents `dd`.

### 02-BUG-05 + 03-BUG-10 (M-6) — no `onunload`; the debounced save is neither flushed nor cancelled
```
install: disk.columns = 12 ; user sets 16 -> disk.columns = 16
typeof v1.onunload = undefined | pending debounce timer = true
re-enabled: v2 read disk.columns = 16 ; v2 sets 8 -> disk.columns = 8 (lastWriter = v2-instance)
after 700ms: disk.columns = 16  lastWriter = v1-instance
=> the dead instance's timer wrote its stale snapshot: true
pending activity after the edit: null ; 700ms later: {"2026-09-11":28}
```
Severity **medium**, with an honest qualification: the lost-update needs the disable → re-enable → next settings
change to land inside the ~500 ms debounce window, which is tight; the more likely half is the un-flushed write on
quit (≤ 500 ms of activity counting). Fix is the same for both: implement `onunload()` that clears the timer
*and* flushes a pending write.

### 02-BUG-07 — non-string daily-note settings break three widgets
```
dailyNoteFolder:null        -> error cards: 3 | Dashboard widget failed to render: calendar TypeError:
                               Cannot read properties of null (reading 'trim')
dailyNoteFormat:null        -> error cards: 3
dailyNoteFolder:5           -> error cards: 3
```
`main.ts:156` calls `.trim()` on the raw value and `formatDate` calls `String.replace` on the format. Severity
**medium** (calendar, tasks and streak each show "This widget hit a snag — try again." with the real cause only in
the console).

### 02-BUG-03 — the migration gate accepts non-numeric versions
```
version=1 / "1" / null / [] / 0 / true -> habits added: true, version=2
version={}   -> habits added: false, settings.version = {}      <- version<2 is false -> migration never runs
version="abc"-> habits added: false, settings.version = "abc"
version=(absent) -> habits added: false, version=2 (correct: DEFAULT_SETTINGS is 2)
```
Confirmed for `{}`/non-numeric strings at **low** (a corrupt `version` costs the user the Habits widget and can
never be repaired). **Correction**: the report's `version=undefined` row is not reachable from JSON — an absent
key gets the default `2`; and `git log` shows `DEFAULT_SETTINGS.version` has been written since the field was
introduced (`c8f5cf8 → version: 1`, `52d1509 → version: 2`), so real v1 upgraders are not affected by this.

### 02-BUG-04 — the migration write is fired and forgotten
```
after await plugin.onload(): writes started=1 completed=0 (data.json version on disk = 1)
120ms later: writes started=1 completed=1 (data.json version = 2)
```
`src/main.ts:79` `void this.saveSettings()`. Confirmed at **low**: the fact is exact, but no user-visible harm was
demonstrated (the write lands; a rejected `saveData` surfaces only as an unhandled rejection). Keep as a
one-word fix (`await`).

### M-9 / 02-BUG-10 + 05-BUG-06 — a non-object `activity` map
```
activity=5 / "x" / 0 / true -> settings.activity unchanged; recordActivity() THREW
    TypeError: Cannot create property '2026-09-11' on number '5'     (called from both vault handlers)
activity=[1,2] -> recordActivity() ok  -> array gains a string key;  heatmap renders "Total · 3"
activity=null  -> coerced to {} by main.ts:51 (ok)
heatmap/stats with activity=42  -> renders "Total · 0" / "Edits this week · 0" nonsense
heatmap with activity="x"       -> renders "Total · 0x"
heatmap with activity=null set in-process -> THREW (Cannot read properties of null)
```
Confirmed at **low-medium** (merge of the two reports). **Correction to 05-BUG-06**: the null crash cannot come
from `data.json` — `main.ts:51` repairs null/undefined; only a number/string/array survives, and those render
nonsense instead of throwing. The real defect is the missing type check, whose two symptoms are the throw in
`recordActivity` (02-BUG-10) and the bogus numbers in the Activity/Notes widgets.

### M-3 / 01-BUG-10 + 02-BUG-09 — shared `DEFAULT_SETTINGS.activity`
```
fresh load: settings.activity === DEFAULT_SETTINGS.activity ? true
after one recordActivity: {"2026-09-11":1} | DEFAULT_SETTINGS.activity: {"2026-09-11":1}
a second fresh instance sees: {"2026-09-11":1}
```
Confirmed at **low** (identity + mutation certain; needs a second `loadSettings()` in one JS context).

### 01-BUG-08 — collapsed widgets keep their footprint
```
gridRows with a collapsed 12x4 widget: 4   (it renders as --dash-ch: 1)
findFirstFree for a 12x2 widget next to it: {"x":0,"y":4}
```
Confirmed at **low**.

### 01-BUG-09 — `clamp` with inverted bounds, at the real call site
```
clamp(5,10,0) = 10 ; clamp(9,2,undefined) = NaN ; clamp(NaN,2,8) = NaN
real resize handler, widget at x=11, columns=12, min.w=2:
  before: x/w = 11/1  (x+w = 12)
  after a ZERO-delta resize: w = 2   (clamp bounds [2, min(12, 12-11)=1])
  persisted: x=11 w=2 => x+w = 13 (> columns)  |  rendered tokens cx=12 cw=2
route 2: columns reduced 16->8 with a widget at x=11 -> zero-delta resize -> w=2 (bounds [2, -3]), x+w = 13 > 8
```
Confirmed at **low**; the practical trigger is the documented Columns slider followed by any resize, not a
hand-edited file.

### 01-BUG-03 — out-of-bounds placement primitives
```
columns=4, empty layout, findFirstFree({w:6,h:4}) = {"x":0,"y":2} => x+w = 6 (> 4)
5000 random cases: violations with w<=columns: 0 | with w>columns: 1226
8 *overlapping* widgets of width 20, columns=12 -> resolveOverlaps: rows 67 -> 67, positions all x=0, 8/8 still wider than the grid
fully packed row: findFirstFree(12x2) on a 12-wide widget at y=0 -> {"x":0,"y":4}, overlaps: false
```
Confirmed at **low**: `fitsAt`'s `x + inst.w > columns` makes every candidate fail, so the fallbacks at
`layout.ts:66,81` are returned unvalidated — but `columns` can only be < 6 through M-11 (all widget types have
`defaultSize.w ≤ 6`), and the fallback cell is provably free. Cascade of M-11.

### 04-BUG-01 (M-12) — `pointercancel` leaks the gesture
```
document pointer listeners after pointerdown: ["pointermove","pointerup"]
after pointercancel -> ["pointermove","pointerup"] | card still .is-dragging: true
after two more cancelled gestures -> leaked document listeners: 6
touch-action declared anywhere in styles.css: false
```
`src/view.ts:340-352` / `415-425` only remove listeners from `pointerup`; `onClose()` cannot help because they are
not in `this.cleanups`. Confirmed at **high** (touch drag/resize is a documented feature and
`manifest.json:9` says `isDesktopOnly:false`; the leak is unbounded within a session).

### 04-BUG-02 — a gesture commits after edit mode is left
```
pointerdown (editMode on) -> plugin.toggleEditMode() -> editMode=false, editSnapshot=null
position before -> after: {"x":0,"y":0} {"x":8,"y":2}
additional (not in any report): enter edit mode via toggleEditMode(), move a widget, click "Cancel editing"
  after clicking Cancel editing: editMode = false | layout x,y = [9,9]  <- the moved widget is NOT restored
```
`view.ts:340-348` never re-checks `editMode`, `card.isConnected` or a render generation;
`main.ts:118-122` never takes the `editSnapshot` the pencil button takes (`view.ts:136-146`), so the
"Cancel editing" button silently does nothing on that entry path. Severity **medium** (layout edits cannot be
aborted reliably, and the documented discard path is broken for one of two entry points).

### 04-BUG-03 — the 720 px breakpoint vs 12-column maths
```
configured columns / CSS real columns = [12,1]   computed cell width = 45.5 (a 1-column layout would be 700)
drop preview left/width px: 297.5px / 45.5px
drop mid-row -> A position {"x":5,"y":2} | rendered grid-column: 6
```
`view.ts:289-311` uses `s.columns` and the element width; `styles.css:1416-1422` collapses the grid to one track
and pins every card to `grid-column: 1 / -1`. Severity **medium** — the drop preview is meaningless and the
persisted layout silently drifts (it "reappears" when the window is widened).

### 04-BUG-04 — `noHeader` widgets have no controls
```
clock card:    grip=0  gear=0  remove=0  resize=1  collapse=0
activity card: grip=1  gear+remove=2     resize=1
addWidget('clock') accepted -> layout entries: 2 -> 3
```
Confirmed at **medium**. **Sub-claim refused**: "their resize handle does nothing" — the handle is live
(`enableResize` is called for every card, `view.ts:192-195,390-395`); dragging the clock's corner changed `w`
from 4 to 10 in my probe. The genuine defect is that a clock card cannot be dragged, configured or removed
(`buildWidgetHeader` returns at `view.ts:205-206`), so a stray clock can only be cleared by *Reset layout*.

### 04-BUG-06 — an invisible resize is persisted
```
collapsed: --dash-ch = 1 | inst.h = 4
while dragging: --dash-ch = 1 | inst.h = 7
after pointerup: persisted inst.h = 7 | rendered --dash-ch = 1
```
Confirmed at **low**.

### 04-BUG-07 — numeric field rewrites invalid input to `cfg.min`
```
typed "9"    -> stored weeks = 9 | saved payload weeks = 9
typed ""     -> stored weeks = 4 | saved payload weeks = 4
typed "abc"  -> stored weeks = 4 ;  typed "-99" -> 4 ;  typed "   " -> 4
```
`view.ts:540-546`. Confirmed at **low** (the field and the state diverge; the value written is a legal one).

### 04-BUG-09 — the error boundary discards the widget's cleanup handle
```
error card rendered: 1 | subscriptions registered: 2 | unregistered: 0
after 2 more renders: registered = 6 | unregistered = 0 | handle.dispose = undefined
after view.onClose(): registered = 6 | unregistered = 0
```
`view.ts:255-262` keeps `handle.dispose` only if `type.render` returns. Confirmed at **low**, and qualified: it is
latent — of the shipped widgets only `backlinks.ts` subscribes, and nothing in it throws between the `on()` calls
(`:58-61`) and the `return` (`:63-68`). A real defect of the boundary contract, not a bug a user hits today.

### 05-BUG-01 — `data-lvl="NaN"`
```
activity{}                      -> data-lvl values ["0","1","2","3","4"]        (1..4 are the legend swatches)
activity{today:1}               -> ["0","NaN","1","2","3","4"]   (that cell's title: "2026-09-11 · 1 edit")
activity{today:2}               -> ["0","4","1","2","3"]
```
`activity.ts:38-42,51`: `maxCount` starts at 1 and only strictly-greater counts raise it, so `(count-1)/(maxCount-1)`
is `0/0` for the single-edit case. Confirmed at **low** (the only active square renders as an empty day;
`styles.css:516-527` defines only `0..4`).

### M-10 / 05-BUG-02 + 06-BUG-05 — "today" is frozen at render time
```
23:59:55 on 2026-02-10: cal-today cell "10" | habits is-today "Tu10" | habits last cell 2026-02-10
                        | clock "23:59:55" | clock date "Tuesday, February 10, 2026" | heatmap ends 2026-02-10
00:01:05 on 2026-02-11: cal-today cell "10" | habits is-today "Tu10" | habits last cell 2026-02-10
                        | clock "00:01:05" | clock date "Wednesday, February 11, 2026" | heatmap ends 2026-02-10
Today widget, 23:00 -> 00:05 with the dashboard left open:
  task added after midnight -> "2025-06-10.md" contains it ; 2025-06-11.md exists: false
```
Both halves confirmed at **medium**. `habits.ts:151` writes the cell's own `data-date`, so the stale "today" square
records yesterday's completion — the widget the user is invited to click is the wrong one. Only `clock.ts:21-36`
and `streak.ts:67-76` re-read the date on a timer; `DashboardView` has no rollover hook.

### 05-BUG-03 — day-of-year from elapsed milliseconds
```
TZ=Europe/Bucharest (system):  210 days of 2026 at 00:30 have a wrong day-of-year
                               first 2026-03-30 (widget 88 vs true 89)
                               rendered Year % differs on 58 days; first 2026-03-31 (shown 24% vs true 25%)
TZ=America/New_York:           238 wrong days, first 2026-03-09 (67 vs 68)
                               rendered Year % differs on 66 days; first 2026-03-09 (18% vs 19%)
```
These reproduce the report's figures exactly (`progress.ts:5,63,65`). Confirmed at **low** (a 1 % ring
discrepancy for the first hour of ~60 days a year). `Math.round` on the same difference is the one-line fix.

### 05-BUG-04 — impossible deadlines are normalised
```
date="2026-02-30" -> days="20" foot="Deadline · Mar 2, 2026"
date="2026-02-31" -> days="21" foot="Deadline · Mar 3, 2026"
date="2025-02-29" -> days="346" foot="Deadline · Mar 1, 2025"
date="2026-13-05" -> days="329" foot="Deadline · Jan 5, 2027"
date="2026-02-00" -> days="10"  foot="Deadline · Jan 31, 2026"
date="garbage"/"" -> "—" / "Set a date in settings"
```
`deadline.ts:6-11`. Confirmed at **low** — the widget *does* print the date it resolved to, so the user can see
the interpretation; the defect is that the typo is silently converted instead of rejected.

### 05-BUG-05 — "Best" is windowed
```
1000 consecutive daily notes -> streak number = 1000 | chips = ["Best · 801d","This week · 7/7","Last · 2026-09-11"]
```
`streak.ts:5,40-48` (window) vs `streak.ts:32-35` (unbounded current streak) — the two numbers contradict each
other in the same widget. Mitigation noted: the chip's tooltip does say "Longest run in the last 800 days".
Confirmed at **low**.

### 05-BUG-07 — id-less habits lose their history
```
render #1 habit ids: ["h1","mv5uos6mtwuwmrh"]
render #2 habit ids: ["h1","j798drkmtwuwmrk"]          -> same ids across renders: false
ids persisted back into inst.settings.habits: [{"id":"h1","name":"Exercise"},{"name":"Read"}]
click on the "Read" cell -> log keys: ["j798drkmtwuwmrk"]   (a key the next render no longer uses)
```
`habits.ts:26` mints a uid but never writes it back; `commit()` (`:289-296`) then deletes the orphaned keys.
Confirmed at **low** (needs a legacy/hand-edited config; the normal add flow assigns a uid).

### 06-BUG-01 — one click toggles every same-text task
```
rows rendered: 2 ["dup","dup"]
file after clicking only the first 'dup' row:
  1: - [x] dup
  3: - [x] dup        <- the second task was silently completed too
```
`content.ts:133-147` — the `.map()` rewrites *every* line whose text matches (unlike `vaulttasks.ts:172-189`,
which checks the line index first). Severity **high**: the user's note is modified destructively with no undo hint.

### 06-BUG-03 — checkboxes inside code fences are live tasks
```
Today widget rows: ["inside fenced code block","real task"]
after clicking the code-sample row:
  4: ```
  5: - [x] inside fenced code block      <- the code sample was rewritten
```
Confirmed at **medium**. **Correction**: the frontmatter half of the claim was not reproduced — a frontmatter
*scalar* (`tasks: '- [ ] …'`) does not match `^\s*[-*]\s+\[`, and it did not appear in either widget's rows. Only
an indented frontmatter *list* item would match.

### 06-BUG-02 — `+` / numbered checkboxes are ignored
```
rendered rows:      ["hyphen","star","indented-two","tab-indented"]
vaulttasks rows:    ["hyphen","star","indented-two","tab-indented"]   (no "+ [ ]", "1. [ ]", "2) [ ]")
```
Confirmed at **low** as an incompleteness (the premise that Obsidian renders those as real checkboxes is
reference behaviour I could not execute — §5-U2).

### 06-BUG-04 — the vaulttasks fallback can flip the wrong line
```
rows: ["dup taskT","otherT","dup taskT"]
clicking the LAST row (task text "dup task"); a line is inserted at the top through vault.modify, then the click lands
file after the click:
  0: - [ ] a line was inserted here
  1: - [x] dup task        <- the FIRST same-text task was completed
  3: - [ ] dup task        <- the clicked one was NOT
```
`vaulttasks.ts:176-184`: when the cached index no longer matches, the code falls back to
`findIndex(text)` — first match wins. Confirmed at **low** (needs duplicate texts *and* a click that lands before
the widget's re-scan has re-rendered; the authors had it as static-only, this is now executed). The broader
`catch {}` silence is 07-BUG-06.

### 06-BUG-07 — the template stamp has minute resolution
```
#1 Notice: "Created 2026-09-11-1412"      vault: [... "Templates/2026-09-11-1412.md"]
#2 (same wall-clock minute) Notice: "Couldn't create note from template."   vault: unchanged
```
`quickactions.ts:118-131`. Confirmed at **low** with a faithful-vault run, so the report's "static only" half is
now executed: on real Obsidian the second click fails with a message that does not explain the collision.

### 03-BUG-07 — the inbox file name is not made markdown-safe
```
inboxFile="Inbox"      -> Notice="Captured" created: ["Inbox"]        (no .md)
inboxFile="Inbox.md "  -> Notice="Captured" created: ["Inbox.md "]    (trailing space kept)
inboxFile="  "         -> Notice="Captured" created: ["  "]           (a file whose name is two spaces)
inboxFile="Inbox.md"   -> Notice="Captured" created: ["Inbox.md"]
```
`main.ts:195-199` concatenates `s.inboxFile` raw (contrast `dailyNotePath`, which always appends `.md`), and the
setting is free text (`main.ts:446-449`). Confirmed at **low** — captured text lands in a file Obsidian will not
open as a note, and each spelling fragments the inbox. The Obsidian-side consequence (that an extensionless file is
not usable as a note) is the §5-U5 item.

### 03-BUG-08 — the plugin's own writes count as activity
```
activity[2026-09-11] before openDay: 3
after openDay (creates the empty daily note): 4          <- +1 for clicking a calendar day
after two captures into the same note: 6                 <- +2 for two thought captures
```
Confirmed at **medium** (`main.ts:39-40,166-177`; writes at `:136` and `:225/:227`). The heatmap, the Week/Total
chips and the streak are all fed by this record, so browsing the calendar looks like writing.

### 03-BUG-09 — every vault write re-renders nine widget types
```
cards rendered: 22 ; widget bodies re-rendered by ONE vault modify event: 9
20 modify events -> 180 widget bodies rebuilt in 170ms
```
`main.ts:172-181` → `view.ts:273-285`; only the settings write is debounced. Confirmed at **medium** (the
per-event ratio is exact; the wall-clock cost is jsdom's, not Obsidian's).

### 07-BUG-01 — twelve dead per-widget stylesheet rules
```
rendered .dash-widget-body elements: 22   sample: ["dash-widget-body widget-clock", …]
is .widget-clock the SAME element as .dash-widget-body? true
.widget-clock .dash-widget-body   matches=0 | .dash-widget-body.widget-clock matches=1 | rule at styles.css:369
… (all 12: matches=0, same-element form matches=1)
dead body rules: 12 of 12
generic body rule: styles.css:316 -> .dash-widget-body { flex:1; min-height:0; overflow:auto; padding:4px 12px 14px;
```
`view.ts:190` puts the wrapper class on the body element itself; the rules are descendant selectors, so the
centring/padding they declare never applies. Confirmed at **medium**. *Line drift*: the 12 cited rule lines are
**+2** off — the rules are at `styles.css:369, 736, 805, 846, 856, 947, 1002, 1047, 1103, 1123, 1163, 1289`
(the cited 367/734/803/… all point at the preceding comment line); the "[live]" controls are at 739 / 849 / 1029.
The visual consequence (left-aligned, top-stacked bodies) follows from the declarations at `styles.css:316-322` and
was not rendered in a real browser.

### 07-BUG-03 — a documented hotkey that does not exist
```
'hotkey' occurrences in src/**.ts: 0    'hotkeys' occurrences in main.js: 0
README.md:57: 4. Open it from the ribbon icon, or with `Ctrl/Cmd + Shift + D`.
README.md:61: - **Open the dashboard** — ribbon icon, `Ctrl/Cmd + Shift + D`, or the command palette.
commands registered: open-dashboard / toggle-edit-mode / capture-to-inbox, all hotkeys=undefined
```
Confirmed at **medium** — "documented behaviour that does not occur", and it is the README's primary onboarding
step.

### 07-BUG-04 — mobile contract (merged with M-12's mechanism)
```
manifest isDesktopOnly = false | minAppVersion = 1.13.0 | version = 1.2.6
'touch-action' in styles.css: false
README mentions mobile/iOS/Android/phone/tablet: false
```
Confirmed at **medium**. The interactive half is 04-BUG-01 (executed); the packaging/doc half is a contract gap.
The README's install recipe (`npm run build` → copy into `.obsidian/plugins/`) is also desktop-only.

### 07-BUG-05 — the release workflow never checks versions
Verified against the file: trigger = any tag matching `[0-9]+.[0-9]+.[0-9]+` or a manual `tag` input
(`release.yml:3-12`), tag copied verbatim (`:49-57`), published with `overwrite_files: true` (`:72-82`), and no step
anywhere reads `manifest.json`'s/`package.json`'s/`versions.json`'s version. Confirmed at **low**, and flagged as a
**process/tooling gap rather than a runtime bug** — today the three files agree, so there is no wrong output until a
human mis-tags.

### 07-BUG-06 — swallowed vault failures
```
clicked a task checkbox while vault.modify fails:
   Notice.last = null | console.error calls = 0 | file content = "- [ ] alpha task\n"   (still open)
all reads fail -> widget shows "No tasks in your vault yet" | console.error calls = 0
createFolder fails -> captureText REJECTED ENOENT | Notice.last = null | console.error calls = 0
```
Confirmed at **medium** (`main.ts:210-218`, `view.ts:256-261` as the contrasting path, `vaulttasks.ts:47-49,169-192`,
`content.ts:156-160`, `quickactions.ts:106,130`). A failed task tick is completely invisible to the user.

### 07-BUG-07 — the accent control misrepresents "theme accent"
```
accent=""        -> getControlValue("accent") = "#7c3aed"
accent="#ff0000" -> getControlValue("accent") = "#ff0000"
accent=""        -> dashboard sets --dash-accent inline: "" (empty => styles.css:6 theme accent)
```
Confirmed at **low** (`main.ts:311-314`).

---

## 4. REFUTED (do not let these reach the final report)

**04-BUG-05 (collapse/expand leaves an overlap)** — refuted, and it is the clearest false positive in the set.
Collapse/expand only sets `inst.collapsed` and re-renders (`view.ts:216-220`); it never touches `x/y/h` and never
matches anything, so it *cannot* create an overlap. The report's own fixture is already overlapping before the
clicks:
```
report's D3 fixture BEFORE any click: overlaps(A,B) = true     (A=(0,0,4,4), B=(0,1,4,4) — B starts inside A)
with B properly below A (0,4): after collapse+expand overlaps(A,B) = false
200 random overlap-free layouts, every widget collapsed+expanded: new overlapping pairs created = 0
```
The prose ("two widgets, B directly below A") contradicts the code in `scratch-04-view/probe5.cjs:107-110`. The
real, low-severity finding in this area is 01-BUG-08.

**07-BUG-08 (`.dash-task` is dead CSS)** — refuted. `content.ts:126` is
`list.createDiv("dash-list-row dash-task")`; the extraction script only matched whole string literals and missed the
space-separated multi-class literal:
```
elements carrying .dash-task in the rendered dashboard: 1 | is .dash-list-row.dash-task: 1
styles.css .dash-task rule at line 693 -> .dash-task { cursor: default; }
```
The rule is live. (The same script's "40 TS class tokens with NO CSS rule" list should therefore be treated as
unreliable in general.)

**02-BUG-11 (Reset layout / Clear data do not call `this.update()`)** — factually true
(`Reset layout action calls update()?: false`, `Clear data …: false`, accents `true`) but there is no user-visible
consequence: neither action changes a value the tab renders (layout is an action row; `activity` has no control),
and `getControlValue` is only consulted for control-type items. This is a consistency/style issue, not a defect.

**04-BUG-08 (`refreshWidget` does not re-apply the position)** — the mechanism reproduces
(`--dash-cw before: 4` → `after refreshWidget (inst.w=9): 4`), but the report's own text concedes that no shipped
`WidgetSetting` changes geometry, so there is no reachable wrong output. Latent invariant only.

**06-BUG-06 (a deleted pinned note vanishes silently)** — `pinned.ts:23-35` skips paths that no longer resolve and
falls back to the empty state. Rendering only existing notes is correct behaviour; calling the generic empty state
misleading is a copy/UX preference, not wrong output. (Executed: `before removal "GoneNotes"` →
`after deletion "No pinned notes — edit to add some"`.)

**03-BUG-02 (`dailyNoteFormat` used verbatim)** — refuted as stated. The headline claim, "a format without a day
token makes every day resolve to one file → the calendar marks the whole month, capture appends to the wrong day
(data loss)", describes **intended format semantics that Obsidian's own core Daily Notes plugin shares**: if a user
configures `YYYY-MM` or `YYYY`, they have asked for one note per month/year. Executed path values agree with that
reading (`fmt="YYYY" 15th -> Daily/2024.md | 16th -> Daily/2024.md`), and the dashboard's calendar/capture/openDay
all agree on the same path, so nothing is inconsistent inside the plugin. Salvageable sub-claim (kept at **low**,
not as the report rates it): a *blank* or whitespace format produces `Daily/.md` / `Daily/   .md`
(executed), i.e. the plugin creates a hidden/unopenable file where a one-line validation would be better. The
`../`-traversal and illegal-character halves depend on Obsidian's own writer guards — see §5-U1, they are not
established.

**07-BUG-02 (classes with no CSS rule)** — refuted as a user-visible defect. The three "real rendered" classes are
`dash-brand` (1 element), `dash-cal-day` (30) and `dash-modal-info` (0 in the render), and no rule exists for any of
them — but no wrong output follows: `.dash-cal-cell` already centres its child (`styles.css:448-460`,
`display:flex; align-items:center; justify-content:center`), `.dash-brand`'s two children are styled
(`styles.css:83,89`) and stack as intended, and `.dash-modal-row` is `display:flex` (`styles.css:1208-1216`) with
`.dash-modal-name`/`-desc` styled. This is housekeeping (dead class names), not a bug. `dash-pinned-notes` and
`dash-qa-commands` are `datalist` **ids** and the report already says so.

---

## 5. UNCERTAIN (with exactly what would settle each)

* **U1 — 03-BUG-02's `../` traversal and illegal-character sub-claim.** `dailyNotePath` really does return
  `Daily/../../outside.md` and `Daily/a:b*c?d|e.md` (executed). Whether that reaches the filesystem as a file
  *outside the vault* depends on path validation inside real Obsidian's `Vault.create`/`FileSystemAdapter`, which
  cannot be exercised in this sandbox and is not documented in `node_modules/obsidian/obsidian.d.ts`. Settle by
  writing `../x.md` through the vault API in a throwaway vault and looking at the parent directory on disk.
* **U2 — 06-BUG-02's premise.** That Obsidian renders `+ [ ]` and `1. [ ]`/`2) [ ]` as real checkboxes. This is
  reference-implementation behaviour (Obsidian's markdown parser), not testable here. If it does not, the widget's
  omission is a documented-scope decision rather than a defect. Settle by opening such a file in Obsidian.
* **U3 — 03-BUG-04 / 03-BUG-05 and the capture half of M-7 rest on one assumption: that
  `Vault.createFolder()` cannot create intermediate folders.** Their authors made the same assumption; I modelled
  it, I could not verify it against Obsidian. The `openDay` half (03-BUG-03: no folder creation at all) does **not**
  depend on it. Settle by calling `app.vault.createFolder("a/b")` on an empty vault.
* **U4 — 04-BUG-01's mouse-side trigger.** I executed the touch path (`pointercancel` from a gesture the browser
  claims). The claim that a mouse drag released outside the web content also produces `pointercancel` is
  plausible but unverified. The touch path is sufficient for the finding.
* **U5 — 03-BUG-07's consequence.** That a file created as `Inbox` (no `.md`) cannot be opened or seen as a note in
  Obsidian. The created filename is executed; the Obsidian-side consequence is not.
* **U6 — 02-BUG-10's blast radius.** Whether the `TypeError` thrown from the vault `create`/`modify` handler also
  aborts the dispatch of other listeners registered on the same event. Needs a real Obsidian instance with a
  second vault-event listener.
* **U7 — 07-BUG-05 / 02-BUG-03 / 01-BUG-06 real-world frequency.** All three are confirmed code defects whose
  triggers require a human or tooling mistake (mis-tag, non-numeric `version`, duplicated uid). The defects stand;
  how often users hit them does not.

---

## 6. Areas I consider shallow or under-tested

* **No pixel-level verification anywhere in this run.** jsdom has no layout engine and `styles.css` is never
  applied, so every "the card is drawn outside the grid / not centred / the preview is in the middle" conclusion
  rests on CSS declarations. The token-level evidence (`--dash-cols`, `--dash-cx`, `style.left`) is real; the
  visual outcome is not measured. A single manual check in Obsidian of 01-BUG-01 (columns 8), 07-BUG-01 (clock
  centring) and 04-BUG-03 (720 px) would settle three severities at once.
* **The CSS↔DOM class scan in 07 is unsound** (see the refuted `.dash-task`): it matched whole string literals, so
  it missed `"dash-list-row dash-task"`. Its *measured* DOM selector counts are trustworthy; its class lists and
  its "40 TS classes with no CSS rule" figure are not.
* **The stub is permissive and hides real Obsidian behaviour**: `Vault.create` neither creates nor validates
  folders and never rejects duplicates, `Vault.createFolder` is a no-op, `Modal.open()` never appends `contentEl`
  (so modal bodies are unreachable), `Setting` is a component stub, `MetadataCache` has no `resolvedLinks`, and
  `Workspace.on()` returns an unregistered `{}`. Two of the seven reports' most severe findings (M-7, M-8) exist
  only against a patched vault, and `links.ts`/`popular`/`orphans` were never exercised with real link data by
  anyone.
* **Nobody tested the smoke suite for coverage**: `smoke/out.js` asserts `todayNoteCreated` and `activityRecorded`
  in separate scenarios, so 03-BUG-08 (the same `openDay` call satisfying both) survives it. The suite has no
  assertions for malformed persisted data, gesture teardown, midnight rollover or any per-widget setting.
* **Untouched by any probe I saw**: `quote.ts`, `random.ts`, `tools.ts` (pomodoro was probed by 06), `links.ts`,
  `popular`/`orphans`, and the Add-widget/Quick-actions modals' DOM (unreachable in the stub). The `main.js`
  bundle was never compared against `src/` by execution (only by string grep in 07).
* **Nothing verified the plugin inside real Obsidian.** Every finding here is either pure-function arithmetic, a
  jsdom DOM observation, or a static read; the four highest-value confirmations (M-4, M-7, 01-BUG-01, 07-BUG-01)
  would each be worth 10 minutes in a throwaway vault before the maintainer ships fixes.

---

## 7. Notes for the integrator

* Rank by my severity column, not the authors'. The two changes that matter most: **01-BUG-04/02-BUG-01 is
  critical** (permanently unloadable plugin, one-line fix), and **03-BUG-05/03-BUG-06 are medium, not high**
  (nothing is actually lost — the text stays in the input; the defect is the silence).
* Seven findings should not appear in the final report: 04-BUG-05, 07-BUG-08, 02-BUG-11,
  04-BUG-08, 06-BUG-06, 03-BUG-02 (as stated), 07-BUG-02. Five of those (04-BUG-05, 07-BUG-08, 02-BUG-11,
  04-BUG-08, 06-BUG-06) are the "style preference / latent invariant / wrong fixture" class the brief asked to be
  filtered; 04-BUG-05 is the one that would have sent the maintainer chasing a layout bug that does not exist.
* Line-number drift found (all the rest of the citations I checked matched the current text): the twelve
  `styles.css` rule lines in **07-BUG-01** and its three `[live]` controls are all **+2**; **07-BUG-08**'s
  `.dash-task` rule starts at 693 (691 is the section comment); 07-BUG-06's `.dash-widget-error` is at 325-328
  (cited 323-328) and `.dash-btn-active` at 148-152 (cited 146-150); 01-BUG-01's Columns-slider cite is
  `main.ts:330-333` (cited 329-333).
* Every CONFIRMED finding above can be re-run from `bug-hunt/scratch-08-verify/p01…p08`; each section names the
  probe it came from.
