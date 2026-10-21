# Grid geometry, layout math and util helpers — findings

Area: `src/layout.ts`, `src/utils.ts`, `src/types.ts`, `src/registry.ts`, layout handling in `src/main.ts`.
Method: `npx tsc` → CJS build + the `bug-hunt/shim.cjs` harness (`bug-hunt/scratch-01-geo/`), driving the real
`onload()`/`DashboardView.render()` plus brute-force property tests over the pure layout functions.
Probe scripts: `probe-invariants.cjs` (4000 random layouts), `probe-paths.cjs` (5000 random findFirstFree/nearestFree cases),
`probe-render.cjs` (real plugin), `probe-identity-dates.cjs`, `probe-defaults.cjs`, `probe-extra.cjs` (uid/instability/null).
Long output lines are wrapped/re-indented where needed to fit this document; every value inside them is copied verbatim
from the probe output (re-run any script to reproduce the exact formatting).

Baseline re-verified before/after the work: `npx tsc -noEmit -skipLibCheck` exits 0; `node smoke/out.js` prints `SMOKE TEST PASSED`.

---

## BUG-01 — Widgets are laid out outside the configured `columns`: nothing ever enforces the grid width
- **Severity**: high
- **Where**: `src/layout.ts:133-157` (`defaultLayout`, hard-codes `x+w = 12`), `src/main.ts:48-50` (load default),
  `src/main.ts:329-333` (Columns slider, `min: 8`), `src/main.ts:349-355` ("Reset layout"), `src/layout.ts:97-108`
  (`resolveOverlaps` never clamps `x + w`), `src/layout.ts:35` (the bound is only checked for the widget being *moved*).
- **What**: `defaultLayout()` is written for exactly 12 columns. The Columns setting is a slider with `min: 8, max: 16`,
  and nothing anywhere clamps or re-flows a layout against `settings.columns`. `loadSettings()` does not touch widget
  coordinates, `resolveOverlaps()` only moves widgets that *overlap*, and `fitsAt()` rejects an over-wide candidate for the
  widget being placed — but an already-persisted/default over-wide widget is left exactly as it is.
- **Why it's wrong**: the plugin's own UI lets the user pick 8…11 columns, and in all of those configurations 6–8 of the
  22 stock widgets are placed at/after the last column. `view.ts:198-202` turns `x`/`w` straight into
  `grid-column: (x+1) / span w` against `--dash-cols` (`styles.css:163`), so those widgets land in *implicit* trailing
  grid tracks: they are drawn beyond the 8-column grid (horizontal overflow / scrollbar, widgets outside the intended
  content width) instead of inside it.
- **Trigger / repro**: `node bug-hunt/scratch-01-geo/probe-render.cjs` sections A–C.
  - (a) Settings → Columns = 8/9/10/11, then "Reset layout" (`main.ts:351`) — or an empty/missing `layout` key, which
    `main.ts:49` fills with `defaultLayout()`:
    ```
    columns = 8  widgets = 22
    widgets whose x+w exceeds columns: 8
    [{"type":"calendar","x":4,"w":5,"right":9},{"type":"activity","x":9,"w":3,"right":12},{"type":"recent","x":4,"w":5,"right":9},
     {"type":"tags","x":9,"w":3,"right":12},{"type":"quote","x":7,"w":5,"right":12},{"type":"vaulttasks","x":6,"w":6,"right":12},
     {"type":"backlinks","x":8,"w":4,"right":12},{"type":"streak","x":8,"w":4,"right":12}]
    --dash-cols = 8
    rendered cards placed beyond column 8: 8/22
    [{"type":"calendar","cx":"5","cw":"5"},{"type":"activity","cx":"10","cw":"3"},...]
    ```
    (`cx` 10 with `--dash-cols: 8` ⇒ `grid-column: 10 / span 3` in an 8-track grid.)
  - (b) Existing 12-column layout, user reduces Columns to 8 (the slider persists `settings.columns` via
    `PluginSettingTab.setControlValue`, `node_modules/obsidian/obsidian.d.ts:5166-5173`; `main.ts` overrides
    `setControlValue` only for `captureTarget`, `main.ts:316-320`, so the layout is not re-flowed):
    ```
    ############ B. existing 12-col layout, user reduces columns to 8 ############
    layout entries after loadSettings: 22
    still out of bounds: 8
    rendered beyond column 8: 8
    ```
  - (c) Columns = 10 + Reset layout: `after reset, widgets beyond column 10: 6 ["activity@x=9w=3","tags@x=9w=3","quote@x=7w=5","vaulttasks@x=6w=6","backlinks@x=8w=4","streak@x=8w=4"]`
  - (d) Conversely at columns 12→16 the default layout only ever occupies 12 of the tracks (cosmetic, same root cause).
- **Impact**: On any grid other than 12 the dashboard is visibly broken: widgets spill past the grid, overlap the
  surrounding chrome or force horizontal scrolling, and dragging/resizing cannot repair them because overlap math only
  compares data coordinates. Since the slider range is 8–16, 4 of the 9 selectable values are affected.
- **Evidence**: executed (DOM/CSS custom-property inspection of the real `DashboardView`; the slider persistence is
  `static only`, cited above).
- **Confidence**: high
- **Suggested fix**: make the layout respect `columns`: (1) generate `defaultLayout(columns)` by scaling/deriving from
  `columns` (or clamp `x = min(x, columns - w)` and `w = min(w, columns)` when building it); (2) add a
  `clampLayout(layout, columns)` pass in `loadSettings()` and whenever `settings.columns` changes; (3) have
  `resolveOverlaps()` clamp `w`/`x` into `[0, columns]` before resolving; (4) clamp `columns` itself
  (`Number.isFinite` + `Math.max(1, …)`) on load.

---

## BUG-02 — Deleting every widget is undone on the next reload; an all-unknown layout silently renders empty
- **Severity**: medium
- **Where**: `src/main.ts:48-59`
  ```ts
  if (!Array.isArray(this.settings.layout) || this.settings.layout.length === 0) {
      this.settings.layout = defaultLayout();
  }
  ...
  this.settings.layout = this.settings.layout.filter((i) => widgetType(i.type))...
  ```
- **What**: the "is the layout empty?" test runs on the *raw* data, before the unknown-type filter. (1) `layout: []` is
  indistinguishable from "never initialised", so it is replaced by the 22 stock widgets. (2) If every entry's type is
  unknown, the filter empties the layout *after* the check, so the dashboard renders nothing and the dropped entries are
  persisted away by the next save.
- **Why it's wrong**: an empty layout is a legitimate, *plugin-produced* state — the ✕ button writes it
  (`src/view.ts:230-233`: `layout.filter((i) => i.uid !== inst.uid)` → `saveSettings()`). The user's explicit action is
  therefore silently reverted on restart, and unknown/renamed widget entries are destroyed rather than kept for a
  downgrade.
- **Trigger / repro**: `node bug-hunt/scratch-01-geo/probe-render.cjs` section D
  ```
  ############ D. deleting every widget, then reloading ############
  data.json layout=[] -> layout after onload: 22 widgets
  types: clock,calendar,activity,stats,tasks,recent,tags,capture,pomodoro,quote,deadline,random,vaulttasks,search,quickactions,popular,orphans,backlinks,pinned,progress,streak,habits
  data.json layout=[unknown type] -> layout after onload: []
  ```
  Remove-widget path is real UI: `node bug-hunt/scratch-01-geo/probe-identity-dates.cjs` section 3 clicks a card's
  `.dash-btn-danger` and the saved layout goes `2 → 0` entries.
- **Impact**: users who clear the board (to rebuild it, or to hide widgets they don't want) get all 22 widgets back after
  a restart; users with entries from another/newer version get an empty dashboard with no explanation, and lose those
  entries on the first save.
- **Evidence**: executed
- **Confidence**: high
- **Suggested fix**: track initialisation explicitly (e.g. a `layoutInitialised` flag or `version === 0`) instead of
  using `length === 0`; only apply `defaultLayout()` when the key is absent/not an array. Move the emptiness handling
  after the filter and keep unknown-type entries (filter only at render time) so a downgrade does not destroy them.

---

## BUG-03 — Widgets wider than the grid cannot be placed: out-of-bounds results and column-stacked boards
- **Severity**: medium
- **Where**: `src/layout.ts:69-82` (`findFirstFree`, fallback `{ x: 0, y: gridRows(layout) + 1 }` at line 81),
  `src/layout.ts:45-67` (`nearestFree`, fallback `{ x: 0, y: maxY }` at line 66),
  `src/layout.ts:35` (`fitsAt` rejects *every* x when `inst.w > columns`), `src/layout.ts:97-108` (`resolveOverlaps`).
- **What**: when `size.w > columns` no candidate can satisfy `x + w <= columns`, so both search functions skip every cell
  and return their fallbacks. For `findFirstFree` the fallback is a cell the scan never validated; for `nearestFree` it is
  `{0, max(rows, targetY)+6}`. `resolveOverlaps` then "resolves" the overlap by pushing the widget down, so a board with
  several over-wide widgets degenerates into a single column of stacked widgets while every one of them is still wider
  than the grid.
- **Why it's wrong**: the functions are documented/used as placement primitives (`main.ts:66`, `main.ts:237`,
  `view.ts:375`, `view.ts:380`), and callers assume the returned position is inside `columns` and free. The invariant
  holds for every legal `w` and fails for every `w > columns` (measured, not guessed): 0 violations out of 5000 cases
  with `w <= columns`, 2250 violations with `w > columns` — see evidence below. Combined with BUG-05/BUG-01 (a persisted
  `w` is never clamped) this is reachable from data the plugin happily loads.
- **Trigger / repro**: `node bug-hunt/scratch-01-geo/probe-paths.cjs` sections A and D
  ```
  ########## A. violation split: does it only happen when w > columns? ##########
  findFirstFree  broke with w<=columns: 0  | with w>columns: 2250
  nearestFree    broke with w<=columns: 0  | with w>columns: 2250
  -- focused: can findFirstFree ever return an occupied cell when w<=columns? --
  columns=12 fully packed 6 rows -> findFirstFree(2x1) = {"x":0,"y":6} occupies: false

  ########## D. resolveOverlaps on a board full of oversized widgets ##########
  rows before: 11
  rows after : 64 (0ms)
  still out of bounds: 8 of 8
  [[0,0],[0,10],[0,20],[0,30],[0,4],[0,40],[0,50],[0,60]]
  ```
  Minimal case (`bug-hunt/scratch-01-geo/probe-invariants.cjs` smallest counterexample): `columns=4`, empty layout,
  `findFirstFree({w:6,h:4})` → `{"x":0,"y":2}` (6 > 4 columns).
- **Impact**: a widget with a persisted `w` larger than the grid (see BUG-05) makes every later widget pile up in column
  0 — an 11-row board becomes 64 rows (≈6,400 px of mostly empty scrolling), and the wider-than-grid widget still
  overflows horizontally. New widgets added afterwards are placed by the same broken fallback.
- **Evidence**: executed (2250/5000 random violations; deterministic minimal repros above).
- **Confidence**: high
- **Suggested fix**: in both functions, clamp the requested size first
  (`const w = Math.max(1, Math.min(size.w, columns));`) and make the fallbacks honest: return `null`/throw when nothing
  fits, or place at `{x:0, y:gridRows(layout)}` (which is provably free) instead of `gridRows+1`. In `resolveOverlaps`,
  clamp `inst.w = Math.min(inst.w, columns)` and `inst.x = Math.max(0, Math.min(inst.x, columns - inst.w))` before the
  loop.

---

## BUG-04 — `onload()` throws on a `null` layout entry, so the whole plugin fails to load
- **Severity**: medium
- **Where**: `src/main.ts:52-53` — `this.settings.layout.filter((i) => widgetType(i.type))`
- **What**: the filter dereferences `i.type` without checking that `i` is an object. A `null` element in the persisted
  `layout` array throws out of `loadSettings()`, which is awaited directly by `onload()` (`main.ts:15`).
- **Why it's wrong**: a plugin must not fail to load because of one unusable entry in its own data file; every other part
  of the codebase treats persisted widget data as untrusted (`habits.ts:19-46` and `quickactions.ts:177` both defensively
  re-read their settings).
- **Trigger / repro**: `node bug-hunt/scratch-01-geo/probe-render.cjs` section J, first case
  ```
  ############ J. malformed persisted layout ############
  layout=[null] -> onload() threw: TypeError: Cannot read properties of null (reading 'type')
  ```
  (Reproduced with `plugin._data = { layout: [null] }` — i.e. `data.json` containing `"layout": [ null ]`, which is what
  a hand-edit, a bad merge or a sync conflict can leave behind.)
- **Impact**: Obsidian reports "Failed to load plugin" — the dashboard view, commands, activity tracking and capture all
  disappear until the user repairs `data.json` by hand, with no clue about which entry is at fault.
- **Evidence**: executed
- **Confidence**: high
- **Suggested fix**: `this.settings.layout.filter((i) => i && typeof i === "object" && widgetType((i as WidgetInstance).type))`
  and, more generally, normalise each entry (drop entries that are not objects/strings) before using them.

---

## BUG-05 — Persisted geometry is never validated: bad numbers go straight into CSS (and one of them freezes the UI)
- **Severity**: medium
- **Where**: `src/main.ts:45-59` (`loadSettings` – no numeric validation at all), `src/view.ts:198-202` (`position`
  writes `x/y/w/h` into `--dash-cx/--dash-cy/--dash-cw/--dash-ch`), `src/layout.ts:52`
  (`nearestFree`'s scan range is derived from `gridRows`), `styles.css:163,183-184`.
- **What**: `x`, `y`, `w`, `h` are copied from `data.json` verbatim (`Object.assign` merge + the `.map` at
  `main.ts:52-59` only fills `uid`/`settings`). No `Number.isFinite` check, no rounding, no clamping to `columns`, no
  minimum sizes. The values are interpolated into CSS `grid-column`/`grid-row` and into layout math.
- **Why it's wrong / impact** (each row is real output from `probe-render.cjs` section J; the consequences follow from
  CSS grid semantics, which is why the *tokens* are the executed evidence):
  | persisted value | kept by loadSettings | emitted to the DOM | user-visible effect |
  |---|---|---|---|
  | `x: -3` | `x:-3` | `--dash-cx: -2` | negative grid lines count **from the end** → the widget is placed on the right-hand side of the grid, on top of other widgets, nowhere near its data position |
  | `y: 1e6` | `y:1000000` | `--dash-cy: 1000001`, `gridRows = 1000002` | the grid is asked for ~1,000,002 implicit rows: elephantine scroll range/blown layout in the renderer |
  | `w: 99` | `w:99` | `--dash-cw: 99` | 99 implicit columns; widget far wider than the dashboard (see BUG-03) |
  | `h: -2` | `h:-2` | `--dash-ch: -2` | `span -2` is invalid → **the whole `grid-row` declaration is dropped** and the widget is auto-placed at an arbitrary spot; `gridRows` also collapses to 1 |
  | `x: "3"` (string) | `x:"3"` | `--dash-cx: 31` | string concatenation (`"3" + 1`) sends the widget to column 31 |
  | `uid: ""` | repaired with a fresh `uid()` | fine | (good) — but the repair is not saved back |
  | `w: null` | `w:null` | `--dash-cw: null` | `span null` is invalid → **`grid-column` dropped** → widget auto-placed |
  | `h: null` | `h:null` | `--dash-ch: null`, `gridRows = 1` | `grid-row` dropped → auto-placed, and the board height collapses to 1 row (`x:null`/`y:null` are harmless — they coerce to 0) |

  Raw rows from the probe:
  ```
  x:-3                 -> kept: {"x":-3,...} | DOM: {"cx":"-2","cy":"1","cw":"4","ch":"2"} | gridRows: 2
  y:1e6                -> kept: {"y":1000000,...} | DOM: {"cy":"1000001",...} | gridRows: 1000002
  w:99                 -> kept: {"w":99,...} | DOM: {"cw":"99",...} | gridRows: 2
  h:-2                 -> kept: {"h":-2,...} | DOM: {"ch":"-2",...} | gridRows: 1
  uid missing + x:"3"  -> kept: {"x":"3",...} | DOM: {"cx":"31",...} | gridRows: 2
  w:null               -> kept: {"w":null,...} | DOM: {"cw":"null",...} | gridRows: 2
  h:null               -> kept: {"h":null,...} | DOM: {"ch":"null",...} | gridRows: 1
  ```
  Non-geometric consequence, measured with 23 widgets and one persisted `y` far down the board — each `nearestFree`
  call scans `(gridRows+7) × columns` cells, and `placeInstance` calls it on every drop plus `resolveOverlaps` on every
  pointer-up (`view.ts:380,385`):
  ```
  ########## C. cost of nearestFree when an out-of-range y is persisted ##########
  persisted y=5000      gridRows=5002    nearestFree -> {"x":6,"y":18} took 3ms
  persisted y=100000    gridRows=100002  nearestFree -> {"x":6,"y":18} took 51ms
  persisted y=1000000   gridRows=1000002 nearestFree -> {"x":6,"y":18} took 535ms
  ```
  i.e. one corrupt coordinate turns every drag/drop into a ~0.5 s main-thread stall.
- **Evidence**: executed (token/`gridRows` output and timings above; the pixel-level CSS consequences are reasoned from
  the emitted tokens).
- **Confidence**: high for the tokens/kept values and the timings; medium for the exact visual result of `w:99`/`y:1e6`.
- **Suggested fix**: normalise every loaded instance to integers:
  `x = clamp(Math.round(Number(x))||0, 0, columns-1)`, `w = clamp(Math.round(Number(w))||type.defaultSize.w, 1, columns)`,
  `h = Math.max(1, Math.round(Number(h))||1)`, `y = Math.max(0, Math.round(Number(y))||0)`, plus a sanity cap on `y`
  (e.g. `gridRows`-derived) so a corrupt value cannot create a million-row grid.

---

## BUG-06 — Duplicate `uid`s are not repaired, and `hasOverlap` treats them as "the same widget": stacked widgets, dead timers, wrong refreshes, and two-for-one deletion
- **Severity**: medium
- **Where**: `src/layout.ts:18-20` (`hasOverlap` → `o.uid !== inst.uid`), `src/main.ts:56` (uid repair only when falsy),
  consequences in `src/view.ts:230-233` (delete by uid), `src/view.ts:241-262` (`handles` Map keyed by uid),
  `src/view.ts:266-270` / `282` (`querySelector`/`find` by uid).
- **What**: `loadSettings()` only assigns a uid when it is missing/falsy; duplicate uids are kept. Since every identity
  comparison in the plugin is uid-based, two instances sharing a uid are indistinguishable: `hasOverlap` skips the twin,
  so `resolveOverlaps` never separates them; `refreshWidget`/`refreshAllOfType` resolve a card to the *first* instance
  with that uid; `handles` can only hold one entry per uid; and removal filters out **all** instances with that uid.
- **Why it's wrong**: a uid is the plugin's only widget identity, so duplicates silently corrupt the layout, the
  per-widget handle bookkeeping and the delete path instead of being repaired or ignored.
- **Trigger / repro**:
  - `probe-paths.cjs` section B / `probe-render.cjs` section F —
    ```
    ############ F. duplicate uid in persisted layout ############
    distinct uids after loadSettings: 1 of 2
    overlaps() says they overlap: true
    hasOverlap() says widget 1 overlaps: false
    positions after resolveOverlaps: [[0,0],[0,0]]
    cards sharing one data-uid: 2
    ```
    The unique-uid control on the same input is correctly separated (`[[0,0],[0,2]]`), so the overlap survives purely
    because of the uid comparison.
  - `probe-identity-dates.cjs` section 1 — one duplicate widget's timer is disposed by the other card's render:
    ```
    distinct uids  -> cards: 2 | live 1s timers: 3 | view.handles.size: 2
    same uid x2    -> cards: 2 | live 1s timers: 2 | view.handles.size: 1
    ```
    (the first clock card stops ticking — its `clearInterval` handle was overwritten/disposed by the second card).
  - section 2 — a **calendar** card gets re-rendered with the **clock** body, because `find(i => i.uid === …)` returns
    the other instance:
    ```
    cards: 2 data-uids: ["SHARED","SHARED"]
    card2 body before: dash-cal-head
    card2 body after refreshAllOfType('calendar'): dash-clock-time
    ```
  - section 3 — clicking ✕ on the duplicated card deletes **both** widgets:
    ```
    layout entries before: 2
    layout entries after clicking remove on the first card: 0 []
    ```
- **Impact**: two widgets render exactly on top of each other (one invisible and unreachable), one of them stops
  updating, another widget's type can be rendered into the wrong card, and removing one widget destroys its twin.
- **Evidence**: executed (all four outputs above are from the real plugin; the delete click is a real DOM event on the
  real card).
- **Confidence**: high
- **Suggested fix**: de-duplicate uids in `loadSettings()` (e.g. keep a `Set`, and re-issue `uid()` for any repeat,
  then save); also repair-and-save when a uid is assigned, so identity is stable across sessions.

---

## BUG-07 — `formatDate` mangles formats: partial token matches and single-occurrence replacement produce wrong daily-note names
- **Severity**: medium
- **Where**: `src/utils.ts:19-26` (the chained `.replace(...)` calls), consumed by `src/main.ts:150-158`
  (`formatDate` → `dailyNotePath`).
- **What**: the formatter is a chain of `String.prototype.replace(search, repl)` — plain-string search, so (a) only the
  **first** occurrence of each token is replaced, and (b) longer tokens are consumed by their own shorter prefixes in
  some orders (`ddd` inside `dddd`, `MMM` inside `MMMM`). Unsupported tokens (`WW`, `M`, `D`, …) are left as literal text.
  Additionally, `dd` is mapped to the **day of month** (line 26), while Obsidian/Moment define `dd` as the short weekday
  name (`ddd` = `Mon`).
- **Why it's wrong**: the setting is presented as a daily-note name template ("Tokens: YYYY, YY, MMM, MM, DD, ddd",
  `main.ts:426`) and Obsidian users copy Moment formats into it. The plugin then resolves to a *different* file than the
  user's existing daily notes, so the plugin creates a new empty note every day instead of opening the existing one, and
  the notes-per-day/streak/backlink features see the wrong files.
- **Trigger / repro**: `node bug-hunt/scratch-01-geo/probe-identity-dates.cjs` sections 5-6, date = Fri 6 Nov 2026
  ```
  (left column = the format string, middle = real `formatDate()` output; `correct` / `<--` notes are my annotations)
  format                   formatDate()
  YYYY-MM-DD               "2026-11-06"          (correct)
  DD.MM.YYYY               "06.11.2026"          (correct)
  dddd, DD MMMM YYYY       "Frid, 06 NovM 2026"  <-- stray letters from the partially replaced dddd/MMMM
  YYYY-MM-DD_dd            "2026-11-06_06"       <-- dd (weekday) replaced by the day number
  DD.MM.DD                 "06.11.DD"            <-- second DD left literal
  MM/DD/MM                 "11/06/MM"            <-- second MM left literal
  YYYY-[W]WW               "2026-[W]WW"          <-- WW not supported
  MM-DD                    "11-06"               (correct)

  ########## 6. formatDate round-trip through dailyNotePath ##########
  YYYY-MM-DD             -> daily note path: 2026-11-06.md
  dddd, DD MMMM YYYY     -> daily note path: Frid, 06 NovM 2026.md
  YYYY-[W]WW             -> daily note path: 2026-[W]WW.md
  YYYY-MM-DD_dd          -> daily note path: 2026-11-06_06.md
  ```
- **Impact**: with any format beyond the six simple tokens, every daily note is written to a garbage filename
  (`Frid, 06 NovM 2026.md`), permanently — the Calendar/Streak/Activity widgets then report "no note" and the user's real
  daily notes are never found. The failure is silent (no notice), and the wrong names are persisted as real files.
- **Evidence**: executed
- **Confidence**: high
- **Suggested fix**: tokenise with one regex pass, longest-token-first, e.g.
  `fmt.replace(/YYYY|YY|MMMM|MMM|MM|DD|dddd|ddd|dd/g, m => TABLE[m])`, and either leave unknown tokens untouched and
  documented as unsupported, or follow Moment's `dd`/`M`/`D`/`WW` semantics. At minimum, document/support the exact token
  set and stop leaving stray letters behind.

---

## BUG-08 — `collapsed` widgets keep their full footprint in every layout computation
- **Severity**: low
- **Where**: `src/types.ts:19-20` (documented as "collapsed to a one-row header bar"), `src/view.ts:202`
  (`--dash-ch: collapsed ? 1 : inst.h`), `src/layout.ts:22-26` (`gridRows` uses `h`), `src/layout.ts:69-82`
  (`findFirstFree`), `src/layout.ts:9-20` (`overlaps`).
- **What**: only the *rendering* honours `collapsed`; the layout array keeps the original `h`, so the collapsed widget
  still blocks its whole footprint for hit-testing, placement, overlap resolution and board height.
- **Why it's wrong**: the documented purpose of collapsing is to shrink a widget to one row so the board gets smaller and
  other widgets can use the freed space. Visually the space *is* freed, but nothing can be placed in it — dropping a
  widget there makes it jump elsewhere.
- **Trigger / repro**: `node bug-hunt/scratch-01-geo/probe-identity-dates.cjs` section 4
  ```
  collapsed 12x4 widget at y=0 -> first free cell for a new 2x2 widget: {"x":0,"y":4}
  gridRows (board height) with it collapsed: 4 rows
  card renders as --dash-ch: 1 while the layout data still records h = 4
  ```
- **Impact**: collapsing widgets does not shrink the dashboard (a user collapsing ten widgets still scrolls past all of
  their empty placeholder rows) and the 1-row-tall gap under each collapsed header is unusable — a drag into it snaps
  the widget somewhere else. Low severity because no crash/data loss.
- **Evidence**: executed
- **Confidence**: high
- **Suggested fix**: use an effective height everywhere (`const eh = inst.collapsed ? 1 : inst.h`) in `gridRows`,
  `overlaps`/`hasOverlap` (or a dedicated `effH()` helper), and recompute `y` positions after toggling `collapsed`
  (`view.ts:216-220`) so the board actually reflows.

---

## BUG-09 — `clamp()` returns `lo` when the bounds are inverted, so a guarded resize can widen a widget past the grid
- **Severity**: low
- **Where**: `src/utils.ts:6-7` (`clamp`), call site `src/view.ts:411`
  (`inst.w = clamp(startW + dCols, min.w, Math.min(maxW, s.columns - inst.x))`).
- **What**: `Math.max(lo, Math.min(hi, n))` silently ignores `hi` whenever `lo > hi` and returns `lo`; with a missing or
  NaN bound it returns `NaN`. A clamp whose upper bound is derived from the remaining grid space can therefore *exceed*
  that space instead of being limited by it.
- **Why it's wrong**: `clamp` is used as a bounds guard, but the inverted range (arriving from `columns - inst.x`, which
  goes to `0`/negative once a widget sits at/after the last column) yields a value the caller believes is inside the
  grid. `min.w` is `2` for every widget (`view.ts:392`, no `WidgetType` in the registry defines `min`), so the result
  overflows by `min.w - (columns - inst.x)` columns.
- **Trigger / repro**: `node bug-hunt/scratch-01-geo/probe-render.cjs` section H
  ```
  clamp(5, 10, 0) = 10 (inverted bounds)
  clamp(9, 2, undefined) = NaN
  clamp(NaN, 2, 8) = NaN
  view.ts:411 pattern: columns=12, inst.x=11 -> hi=1, min.w=2 => w = 2
  ```
  i.e. in edit mode, drag a widget to the last column (`x = 11`) and resize it: `w` becomes `2` while only 1 column is
  left → `x + w = 13 > 12`, and this is persisted; `resolveOverlaps` will not undo it (see BUG-01).
- **Impact**: widgets resized near the right edge end up wider than the grid and stay that way after reload (the same
  overflow as BUG-01). Also masks logic errors elsewhere by returning a plausible-looking number instead of failing.
- **Evidence**: executed for `clamp()` semantics and the arithmetic; the pointer interaction at `view.ts:411` is
  `static only` (this call site belongs to the view area — reported here because the helper's contract is the defect).
- **Confidence**: high for `clamp`'s behaviour; medium for how often users hit the resize path.
- **Suggested fix**: make `clamp` total: `if (!Number.isFinite(n)) return lo; const a = Math.min(lo, hi), b = Math.max(lo, hi); return Math.min(b, Math.max(a, n));`
  (or assert `lo <= hi`). Additionally clamp after assignment in the resize handler:
  `inst.w = Math.min(inst.w, s.columns - inst.x)`.

---

## BUG-10 — `DEFAULT_SETTINGS.activity` is shared by reference, so `recordActivity()` writes into the module singleton
- **Severity**: low
- **Where**: `src/types.ts:42-59` (`DEFAULT_SETTINGS.activity = {}`), `src/main.ts:47`
  (`Object.assign({}, DEFAULT_SETTINGS, raw ?? {})` — shallow), `src/main.ts:51`, `src/main.ts:172-177`
  (`this.settings.activity[key] = ...` mutates in place).
- **What**: when the saved data has no `activity` key (fresh install, deleted/reset `data.json`), `this.settings.activity`
  **is** the exported `DEFAULT_SETTINGS.activity` object. `recordActivity()` then mutates it, so the module-level default
  for the rest of the JS context is polluted. Any later `loadSettings()` in the same context (plugin reload, second
  instance/vault in the same renderer) that also lacks an `activity` key inherits the counts.
- **Why it's wrong**: a "default settings" constant must never accumulate user data; it makes the defaults depend on the
  history of the process.
- **Trigger / repro**: `node bug-hunt/scratch-01-geo/probe-defaults.cjs`
  ```
  fresh install: settings.activity === DEFAULT_SETTINGS.activity ? true
  after one recordActivity() on the fresh install:
    vault session activity : {"2026-09-11":1}
    DEFAULT_SETTINGS.activity (module singleton): {"2026-09-11":1}
  second fresh instance sees activity: {"2026-09-11":1}
  ```
- **Impact**: a newly initialised dashboard can display another session's/vault's edit counts (heatmap, "edits this
  week", streaks) before the user has done anything. Requires a second `loadSettings()` in the same JS context — hence
  low severity and the confidence below.
- **Evidence**: executed (in-process; the multi-context reproduction is the harness equivalent of a plugin reload)
- **Confidence**: medium (the mutation is certain; the user-visible path needs a reload/second instance in one process)
- **Suggested fix**: clone the defaults per instance — `this.settings = { ...DEFAULT_SETTINGS, ...(raw ?? {}) }` plus
  `this.settings.activity = { ...(this.settings.activity ?? {}) }` (and freeze `DEFAULT_SETTINGS`), so no caller can ever
  share the singleton's nested objects.

---

## Checked and clean (do not redo)

- **`resolveOverlaps` terminates, is deterministic and idempotent, and leaves no overlap for unique uids** —
  4000 random layouts (1–12 widgets, coordinates −2…16, sizes 0/negative/oversized, columns 1…16): 0 surviving
  overlaps, byte-identical output for two runs of the same input and for a second pass (`probe-invariants.cjs`). It also
  never throws away a valid position: 20 000 randomly generated *fully in-bounds* layouts all stayed in bounds after
  `resolveOverlaps` (`probe-extra.cjs` §B: `fully in-bounds inputs: 20000 -> inputs that became out of bounds: 0`),
  i.e. it never *repairs* an out-of-bounds board either (`fitsAt` only accepts `x >= 0 && x+w <= columns`, and the
  fallback `{0, maxY}` is in bounds whenever `w <= columns`) — see BUG-01/BUG-03. The only surviving overlap found is the
  duplicate-uid case (BUG-06).
- **The `guard < 50` bail-out at `layout.ts:101-105` is effectively unreachable** — `nearestFree`'s fallback
  `{x:0, y: max(gridRows(prefix), targetY)+6}` is always strictly below every widget in the prefix, so the loop exits
  after one iteration; no input produced 50 iterations or a hang (4000 layouts in 131 ms total). It can only be "hit"
  with duplicate uids, where the widget is invisible to `hasOverlap` anyway (BUG-06). No fix needed beyond BUG-06.
- **`nearestFree`/`findFirstFree` are correct for every legal size** — across 5000 random layouts plus a fully packed
  `columns × 6` board, the returned cell is in bounds, free, and (for `nearestFree`) the nearest one; 0 violations with
  `w <= columns` (all violations are the `w > columns` case → BUG-03). `findFirstFree` returns the top-most/left-most free
  cell, `nearestFree` minimises squared distance with the first (top-left) tie-break — matches its documentation.
- **`defaultLayout()` matches the registry and is internally consistent** — 22 entries vs 22 registered types, no
  missing/duplicated types, 0 overlapping pairs, all inside 12 columns, 22 distinct uids, `gridRows = 23`
  (`probe-render.cjs` section I). Its hard-coded 12-column width is BUG-01, not a separate defect.
- **`overlaps()` (AABB) is correct** — including touching edges (`x+w === other.x` → no overlap) and zero/negative
  extents.
- **`uid()` entropy is fine for real use** — 7 base-36 chars + `Date.now().toString(36)`; 100 000 generated uids were
  all distinct (`probe-extra.cjs` §A), and the 22 default widgets always get 22 distinct uids. Adversarially, with
  `Date.now()` frozen to a single millisecond, 200 000 draws by the same process produced exactly 1 duplicate (the
  birthday bound of the 7-char part is ≈395 889 draws) — irrelevant at dashboard scale, so uid *generation* is not the
  defect. `if (!inst.uid) inst.uid = uid()` repairs empty/missing uids (`uid: ""` → fresh uid, verified), but the repair
  is not saved and duplicate uids are not repaired at all (BUG-06).
- **`dateKey()` / `pad2()` are correct around midnight, month ends and DST** — they use local `getFullYear/getMonth/getDate`
  (never UTC), so the key follows the wall clock the user sees; DST-safe because no arithmetic on timestamps is done.
- **`startOfDay()` is correct and DST-safe** — `new Date(d)` + `setHours(0,0,0,0)` yields local midnight (01:00 on the rare
  zones whose DST switch happens at 00:00, which is still the start of that day); no `setDate`/millisecond arithmetic is
  used that could skip a day.
- **`relTime()` is correct for past timestamps** (just now / m / h / d / date) and never returns `NaN`. A *future*
  timestamp falls into `m < 1` and reads "just now" instead of "in Xm" — cosmetic only (clock skew), not reported.
- **`clamp()` is correct whenever `lo <= hi` and the value is finite** (all in-range uses in `view.ts:293,358`); the
  inverted/NaN cases are BUG-09.
- **NaN coordinates are not reachable from persistence** — `JSON.stringify` turns `NaN`/`Infinity` into `null` (the
  *null* cases that do cause trouble are listed in BUG-05), and the UI never produces `NaN` (`clamp` bounds and mouse
  deltas are finite). For the record: `NaN` in → `gridRows() = NaN` and `nearestFree` returns `{0, NaN}` (no hang, no
  throw) — latent, not reported as a finding.
- **`null` in `x`/`y` is harmless, `null` in `w`/`h` is not** — `"x": null` / `"y": null` coerce to 0 in comparisons and in
  `x + 1`, so the widget renders at column/row 1 (verified: `x:null -> DOM cx "1"`, `y:null -> DOM cy "1"`). `"w": null`
  and `"h": null` are emitted verbatim into CSS (`--dash-cw: null`, `--dash-ch: null`) — an invalid `span`, so the widget
  is auto-placed and `gridRows` drops to 1 (`probe-extra.cjs` §C, folded into BUG-05).
- **Shallow-copy aliasing of widget `defaultSettings`** (`main.ts:57,67,238`, `{...t.defaultSettings}`) shares
  `quickactions.actions`, `pinned.pins`, `habits.habits`, `habits.log` by reference with the type defaults. Checked
  whether any widget mutates those shared arrays in place: `habits.ts:291,296`, `quickactions.ts:277`, `pinned.ts:136` all
  **assign fresh arrays/objects**, so no user-visible defect was found — recorded as a latent hazard only
  (only the `activity` case, BUG-10, demonstrably mutates the shared singleton).
- **`registry.ts`** — no duplicate `registerWidgetType` calls for the same type (22 distinct types), `getWidgetTypes()`
  order is stable, `widgetType()` returns `undefined` for unknown types (used for the filter in BUG-02/BUG-04).
- **Out of my area (handoff, not claimed as fixed here)**: the resize handler's inverted clamp at `view.ts:411`
  (mechanism of BUG-09) and the delete-by-uid filter at `view.ts:230-233` (impact of BUG-06) live in `view.ts`; the
  drag/drop cell math (`view.ts:289-311`) and `editSnapshot` handling were not analysed here.
