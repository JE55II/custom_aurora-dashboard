# Plugin lifecycle / settings persistence / migration / commands — findings

Area: `src/main.ts` (`onload`, `loadSettings`, `saveSettings`, `queueSave`, migration, settings tab,
commands, `addWidget`/`refreshWidget`/`rerenderDashboard`) plus `Settings`/`DEFAULT_SETTINGS` in
`src/types.ts`. Not covered here (other agents): activity recording / daily-note paths / capture.

Method: everything below was driven through the README recipe — `npx tsc --outDir
bug-hunt/scratch-02-main/build ... src/main.ts`, then Node scripts in `bug-hunt/scratch-02-main/`
that instantiate the real plugin against the jsdom stub, feed pathological `data.json` payloads and
assert on the resulting settings / persisted data. Commands and their real output are pasted inline.

---

## BUG-01 — One `null` (or string/number) entry in `settings.layout` aborts `loadSettings()`; the plugin can never load again

- **Severity**: critical
- **Where**: `src/main.ts:52-59` (function `loadSettings`), specifically `.filter((i) => widgetType(i.type))` on line 53
- **What**: `loadSettings()` trusts `data.json` to contain an array of objects. `widgetType(i.type)` dereferences `i.type`, so any non-object entry (`null`, a number, a string, `true`) throws `TypeError` out of `onload()`. `this.settings` is then left unassigned, `registerView`/`addCommand`/`addSettingTab` are never reached, and the exception propagates out of `Plugin.onload()` — Obsidian reports the plugin as failed to load and leaves it disabled. The bad array stays in `data.json`, so every subsequent start throws identically: the plugin is permanently bricked until the user hand-edits `data.json`.
- **Why it's wrong**: the whole point of the loading code is to sanitise untrusted, user-visible JSON (`data.json` is a plain file users edit, sync and back up, and older/newer versions of the plugin write it too). It already defends against `layout` being missing / not an array / empty (lines 48-50) and against unknown *types* (line 53), but not against a non-object *entry* — the one case that makes the plugin unloadable instead of merely wrong. There is no `try`/`catch` in `onload` either, so nothing degrades gracefully.
- **Trigger / repro**: put a single `null` in the layout array of
  `<vault>/.obsidian/plugins/cool-dashboard/data.json`, e.g.
  `{"layout":[null],"version":2}`, then start Obsidian (or just call `onload()`).
- **Impact**: plugin cannot be enabled at all — whole dashboard, all 22 widgets, all settings and the
  settings tab are gone for that user, permanently, on every restart. This is the worst outcome in the area.
- **Evidence**: executed
  ```
  $ node bug-hunt/scratch-02-main/probe1-settings.cjs
  layout:null                               -> OK   columns=12 ... layoutN=22 widgets=22
  layout:[null]                             -> LOAD-THROW: TypeError: Cannot read properties of null (reading 'type')
  layout:['clock']                          -> OK   ... layoutN=0 widgets=0
  layout:[42]                               -> layoutN=0 l0=undefined widgets=0
  layout:[true]                             -> layoutN=0 l0=undefined widgets=0
  ```
  (The `layout:['clock']` / `[42]` / `[true]` lines are from `probe5-malformed.cjs`; they show the
  filter silently deleting entries instead of crashing. Only `null`/`undefined` entries throw.)
- **Confidence**: high
- **Suggested fix**: validate the shape before dereferencing:
  ```ts
  .filter((i): i is WidgetInstance => !!i && typeof i === "object" && widgetType((i as WidgetInstance).type))
  ```
  and additionally wrap `await this.loadSettings()` in a `try`/`catch` in `onload()` that falls back to
  a default `settings` object and shows a `Notice`, so a corrupt file can never make the plugin unloadable.

---

## BUG-02 — Widgets whose type is not in the current registry are silently deleted from the saved layout

- **Severity**: high
- **Where**: `src/main.ts:52-59` (`loadSettings`) + `src/main.ts:68-80` (`this.settings.layout.push(...)` `void this.saveSettings()`)
- **What**: the `.filter((i) => widgetType(i.type))` on line 53 drops every layout entry whose `type` is not registered in *this* build and mutates `this.settings.layout` in place. Nothing tells the user, and `this.settings` is then written back to `data.json` on the next save (any settings change, any drag/resize, any widget add — or immediately if the v1→v2 migration branch on lines 63-80 also runs, which calls `saveSettings()` for the same array). After that write the widget is gone from disk too.
- **Why it's wrong**: silently discarding user data on load. A downgrade (newer plugin saved a widget type this build does not know), a partially-failed update, or a typo'd type in a hand-edited file all end with irreversible loss of that widget and its per-widget settings, with no Notice and no backup. Also note the asymmetry: `findFirstFree` is called with the *filtered* layout (line 66) but the pre-filter array is what gets written if no save happens, so the on-disk and in-memory layouts disagree.
- **Trigger / repro**: `data.json` containing a widget type this build does not register — e.g. install a newer Aurora Dashboard that added a widget, then roll back to 1.2.6 with `{"version":2,"columns":12,"layout":[{"type":"clock",...},{"type":"from-newer-version",...}]}`.
- **Impact**: user-visible widget (and its settings) disappears from the dashboard on upgrade/downgrade; the next save deletes it from `data.json` permanently. If the plugin is later restored to the version that knew the type, the widget does not come back.
- **Evidence**: executed
  ```
  $ node bug-hunt/scratch-02-main/probe2-persist.cjs
  [1] unknown-type layout: in=3  after-onload= clock,pomodoro
      saved data layout = clock,from-newer-version,pomodoro
  ```
  (in-memory layout 3 → 2; the on-disk snapshot still has the unknown entry until the next save, which
  is why the disagreement is invisible in the first write.)
- **Confidence**: high
- **Suggested fix**: don't destroy the entry — keep unknown-type instances in the array and skip them at render time (`buildWidgetCard` already returns early when `widgetType()` is falsy, `src/view.ts:180-181`), or at minimum record the dropped entries, show `new Notice("Aurora Dashboard: N widgets were removed because their type is unknown")` and refuse to persist a shrunken layout until the user confirms.

---

## BUG-03 — The v1→v2 habits migration is skipped for any `version` that is not a real number on the left of `<`

- **Severity**: medium
- **Where**: `src/main.ts:63-80`, gate on line 63 (`if (this.settings.version < 2)`)
- **What**: the migration runs only when `settings.version < 2` evaluates to `true`. With the `Object.assign` on line 47, any `version` value present in `data.json` *overwrites* the default `2` (`src/types.ts:43`) without normalisation, and `<` is a numeric coercion: `undefined < 2` and `{} < 2` are both **false**, so the migration body never executes, `this.settings.version` is never repaired, and the floating `saveSettings()` on line 79 never runs. `data.json` then keeps the unusable version forever — the "runs once" comment on lines 61-62 is false for that install, and nothing can ever detect that the migration was skipped. (`null`, `""`, `[]`, `true` happen to coerce to numbers and do run the migration, which is why this looks fine in casual testing.)
- **Why it's wrong**: "did this user migrate?" is decided by an unvalidated value parsed from an untrusted file, with no normalisation and no `Number.isFinite` check, even though the surrounding loader tolerates missing/garbage values everywhere else (lines 48-50, 51).
- **Trigger / repro**: `data.json` with a `version` that is not a number where a number belongs — e.g. `{"version":{},"columns":12,"layout":[{...clock...}]}` or a file with no `version` key at all loaded through a path that also clears the default — then load the plugin.
- **Impact**: the user never receives the v2 habits widget; the version stamp stays broken so no later fix can detect that the migration was skipped; and combined with BUG-02 the un-migrated layout is never rewritten, so a layout containing unknown types keeps its dead entries on disk indefinitely.
- **Evidence**: executed
  ```
  $ node bug-hunt/scratch-02-main/probe6-versions.cjs
  == version values: does the v1->v2 habits migration run? ==
    version=1          -> habits added: true  settings.version=2
    version="1"        -> habits added: true  settings.version=2
    version=null       -> habits added: true  settings.version=2
    version=undefined  -> habits added: false settings.version=undefined
    version=""         -> habits added: true  settings.version=2
    version={}         -> habits added: false settings.version={}
    version=[]         -> habits added: true  settings.version=2
    version=0          -> habits added: true  settings.version=2
    version=1.5        -> habits added: true  settings.version=2

  $ node -e "... Object.assign({}, DEFAULT_SETTINGS, {version:v}).version < 2 ..."
  null      -> assign: null      | lt2: true
  undefined -> assign: undefined | lt2: false     <-- migration skipped
  {}        -> assign: {}        | lt2: false     <-- migration skipped
  []        -> assign: []        | lt2: true
  ""        -> assign: ""        | lt2: true
  ```
  The two rows that show the defect are `version=undefined` and `version={}`: `habits added: false`,
  version left unrepaired. `null` is *not* a repro (it coerces to `0`) — corrected after isolating the
  comparison, see the second command above.
- **Confidence**: medium-high (both non-migration rows are ordinary coercion semantics, verified in isolation; how often a real `data.json` ends up with `{}`/missing version is what is uncertain)
- **Suggested fix**:
  ```ts
  const v = Number(this.settings.version);
  if (!Number.isFinite(v) || v < 2) { ...; this.settings.version = 2; await this.saveSettings(); }
  ```

---

## BUG-04 — The migration's write is fired and forgotten, so `onload()` resolves before `data.json` is written

- **Severity**: medium
- **Where**: `src/main.ts:79` (`void this.saveSettings();` inside `loadSettings`) — note the method is `async`
- **What**: `loadSettings()` starts a `Plugin.saveData()` round-trip (real Obsidian: async disk write) and returns without awaiting it. `onload()` therefore completes while the write is still in flight, and an unhandled rejection from `saveData` (disk full, read-only vault, sync conflict) is dropped silently (`void`).
- **Why it's wrong**: two consequences. (1) Nothing downstream — Obsidian's "plugin loaded" state, the user's first settings action, another plugin's `onLayoutReady` — can rely on the migrated settings being on disk; `await plugin.onload()` returns with the pre-migration file still in place. (2) It opens an overlapping-write window: the user can change a setting and trigger `saveSettings()` while the migration write is still pending. Because `saveData(this.settings)` is handed the *same mutable* object, the interleaving happens to settle on the newest state today, but the missing `await` is what creates the window at all, and `Plugin.saveData`'s internal serialisation is the only thing standing between this and a lost update. A rejected write is dropped by `void` with no `Notice`.
- **Trigger / repro**: `data.json` with `{"version":1,...}`, then immediately `await plugin.onload()` and read `data.json`; or make `saveData` slow/reject and watch the promise chain.
- **Impact**: no user-visible corruption in the common case (see BUG-05 for the case where an un-awaited write *does* clobber newer data — there the zombie timer is the writer), but the plugin's "save then reload" contract is not honoured and a failed migration write is invisible to the user.
- **Evidence**: executed
  ```
  $ node bug-hunt/scratch-02-main/probe4-race.cjs
  [10] onload() resolved after 2 ms; saveData calls started so far: 1
       data.json on disk right now: columns = 12  (file may not even exist yet)
  $ node bug-hunt/scratch-02-main/probe2-persist.cjs
  [3] immediately after await onload():  writesStarted= 1  data.version= 1  data.layoutN= 1
      after 80ms:                        data.version= 2  data.layoutN= 2
  ```
  (`await onload()` resolves with the *pre*-migration file still in place; 80 ms later the file has
  changed underneath the caller.)
- **Confidence**: high (missing await / floating write, and the dropped rejection); medium for a concrete lost update from *this* write specifically
- **Suggested fix**: `await this.saveSettings();` on line 79, and make the migration the last thing `loadSettings` does so `onload()` only resolves once settings are durable. Consider wrapping it so a rejected write surfaces a `Notice`.

---

## BUG-05 — The 500 ms debounced save is not flushed (or cancelled) on unload; the orphaned timer writes a stale snapshot over the new instance

- **Severity**: high
- **Where**: `src/main.ts:87-93` (`queueSave`) — the timer is a bare `window.setTimeout` with no owner-side teardown; `src/main.ts:14-41` (`onload`) registers views/commands/events but the class defines **no** `onunload`/`unload` at all (confirmed against the compiled bundle).
- **What**: `queueSave()` schedules a 500 ms `window.setTimeout` that closes over `this`. Because there is no `onunload`, nothing clears `this.saveTimer` when the plugin is disabled, so the timeout keeps the dead plugin instance (and its `this.settings` reference) alive and calls `this.saveSettings()` → `saveData(this.settings)` after teardown. There is nothing that flushes an *intentionally* pending write either — the disable path neither cancels nor commits it, it just happens to run late.
- **Why it's wrong**: (a) a plugin that is supposed to be unloaded keeps executing code and writing `data.json`; (b) if the user disables and re-enables the plugin inside the 500 ms window (or Obsidian reloads the plugin), the new instance reads and writes the file correctly and then the zombie timer overwrites it with the dead instance's snapshot of every setting — a genuine lost update, not just an `activity` bump. This is the "save/`saveSettings` race and lost writes" case in the task brief, demonstrated below.
- **Trigger / repro**: edit a note (starts the debounce) → disable the plugin → re-enable it → change Columns in the new session → wait 500 ms.
- **Impact**: user settings silently revert to what they were before the disable; the plugin instance is pinned in memory for up to 500 ms after unload; a second `data.json` write happens after teardown (which can resurrect settings the user has since changed).
- **Evidence**: executed
  ```
  $ node bug-hunt/scratch-02-main/probe7-orphan-timer.cjs
  install: disk.layoutN = 22  columns = 12
  after slider  : disk.columns = 16
  pending debounce timer on instance 1: true
  re-enabled    : disk.columns = 16  (new instance read the file)
  slider -> 8   : disk.columns = 8
  after 700ms   : disk.columns = 16  lastWriter = v1-instance
  => the dead instance's timer wrote its stale snapshot: true

  $ node bug-hunt/scratch-02-main/probe3-lifecycle.cjs
  [6] pending timer after recordActivity: true  saves so far: 1
      typeof plugin.onunload = undefined -> timer still pending: true
      saves after 700ms: 2 - the 500ms-deferred write did run: true
  [7] Timeout resources  before-enable: 0  while enabled+pending save: 1  after unload(): 1
  ```
- **Confidence**: high
- **Suggested fix**: add
  ```ts
  onunload(): void {
    if (this.saveTimer !== null) { window.clearTimeout(this.saveTimer); this.saveTimer = null; }
    void this.saveSettings();          // flush the pending write instead of dropping it
  }
  ```
  (`Plugin.registerEvent`/`registerView`/`addCommand` dispose themselves; only this timer needs manual teardown.)

---

## BUG-06 — `columns` / `rowHeight` / `gap` are never validated or clamped, producing invalid CSS and broken grid maths

- **Severity**: medium
- **Where**: `src/main.ts:45-51` (`loadSettings`, no numeric validation) and the settings-tab slider definitions at `src/main.ts:329-342` (`min`/`max` are UI hints only — nothing clamps on load or on `setControlValue`, `src/main.ts:316-320`)
- **What**: values from `data.json` are copied straight into `settings` (`Object.assign`, line 47) and then straight into style properties and layout arithmetic: `src/view.ts:170-172` writes `--dash-cols: <columns>`, `--dash-row: <rowHeight>px`, `--dash-gap: <gap>px`; `src/layout.ts:75` (`for (let x = 0; x < columns; x++)`) and `src/view.ts:292-295` (`cellAt`) divide by / clamp against `columns`. `"abc"`, `NaN`, `null`, negative or huge values all reach those sites unchecked.
- **Why it's wrong**: the grid silently degrades instead of the plugin repairing a bad value. `--dash-cols: abc` / `--dash-row: NaNpx` are invalid declarations (the whole grid falls back to defaults); `columns = 0` makes `cellAt`'s clamp bounds `(0, -1)` and `findFirstFree`'s loop body unreachable, so `addWidget` pastes every new widget at `x: 0, y: rows+1`; `columns = "abc"` does the same; negative or >16 values put widgets outside the visible grid. All of it is user-visible and none of it is reported. The sliders only bound values the user *drags* — they never sanitise what was loaded.
- **Trigger / repro**: set `"columns":"abc"` (or `0`, `-5`, `null`) and/or `"rowHeight":NaN` in `data.json`, restart, open the dashboard, then add a widget.
- **Impact**: dashboard renders with a broken/overlapping grid; "Add widget" stops placing widgets in free space; `--dash-*` variables are invalid so CSS rules that depend on them stop applying. Recoverable only by editing `data.json` by hand.
- **Evidence**: executed
  ```
  $ node bug-hunt/scratch-02-main/probe1-settings.cjs
  columns:null                       -> OK   columns=null rowHeight=88 ... gridStyle=cols:[null]
  columns:0                          -> OK   columns=0    rowHeight=88 ... gridStyle=cols:[0]
  columns:-5                         -> OK   columns=-5   rowHeight=88 ... gridStyle=cols:[-5]
  columns:'abc'                      -> OK   columns="abc" rowHeight=88 ... gridStyle=cols:[abc]
  columns:NaN                        -> OK   columns=null rowHeight=88 ... gridStyle=cols:[NaN]
  rowHeight:NaN                      -> OK   columns=12 rowHeight=null ... gridStyle=row:[NaNpx]
  $ node bug-hunt/scratch-02-main/probe5-malformed.cjs
  out-of-range values already in data.json: columns= 20 rowHeight= 400 gap= 0
    (slider definitions say columns 8..16, rowHeight 60..140, gap 8..28)
  ```
- **Confidence**: high (invalid CSS confirmed in the DOM; `cellAt`/`findFirstFree` degradation is static)
- **Suggested fix**: normalise on load, e.g.
  ```ts
  this.settings.columns   = clampInt(this.settings.columns, 8, 16, DEFAULT_SETTINGS.columns);
  this.settings.rowHeight = clampInt(this.settings.rowHeight, 60, 140, DEFAULT_SETTINGS.rowHeight);
  this.settings.gap       = clampInt(this.settings.gap, 8, 28, DEFAULT_SETTINGS.gap);
  ```
  and apply the same clamp in `setControlValue` so the settings tab cannot write an out-of-range value back.

---

## BUG-07 — Non-string `dailyNoteFolder` / `dailyNoteFormat` in `data.json` make every daily-note-dependent widget fail to render

- **Severity**: medium
- **Where**: `src/main.ts:45-51` (`loadSettings`, string fields copied unfiltered) → `src/main.ts:154-158` (`dailyNotePath`: `this.settings.dailyNoteFolder.trim()` and `formatDate(d, this.settings.dailyNoteFormat)`)
- **What**: a `null` (or number/object) value for these two string settings survives the `Object.assign` merge, and `dailyNotePath()` then calls `.trim()` on it (line 156) or passes it to `formatDate` → `String.replace` (`src/utils.ts:19`). Both throw.
- **Why it's wrong**: these fields are consumed by several widgets through the `DashboardPlugin` interface (`noteExistsFor`, `dailyNotePath`). `DashboardView.renderWidgetBody` catches per-widget render errors (`src/view.ts:256-261`), so instead of one clear error the user gets a dashboard where calendar, tasks, streak (and anything else calling `noteExistsFor`) each show "This widget hit a snag — try again." with the real cause only in the console.
- **Trigger / repro**: `data.json` with `{"dailyNoteFolder":null,...}` (or `"dailyNoteFormat":null`), then open the dashboard — the console shows `Cannot read properties of null (reading 'trim')` for calendar/tasks/streak and those widgets show the error card.
- **Impact**: several widgets permanently broken (until the user edits `data.json`), with a misleading generic error; no Notice, no validation feedback.
- **Evidence**: executed
  ```
  $ node bug-hunt/scratch-02-main/probe1-settings.cjs     (case "dailyNoteFolder:null")
  Dashboard widget failed to render: calendar TypeError: Cannot read properties of null (reading 'trim')
      at AuroraDashboardPlugin.dailyNotePath (…/build/main.js:144:54)
      at …renderMonth (…/build/widgets/calendar.js:63:32)
  Dashboard widget failed to render: tasks TypeError: Cannot read properties of null (reading 'trim')
      at AuroraDashboardPlugin.dailyNotePath (…/build/main.js:144:54)
      at Object.render (…/build/widgets/content.js:73:29)
  Dashboard widget failed to render: streak TypeError: Cannot read properties of null (reading 'trim')
      at AuroraDashboardPlugin.dailyNotePath (…/build/main.js:144:54)
      at exists (…/build/widgets/streak.js:20:38)
  ```
- **Confidence**: high
- **Suggested fix**: coerce string settings during load, e.g. `this.settings.dailyNoteFolder = typeof this.settings.dailyNoteFolder === "string" ? this.settings.dailyNoteFolder : "";` (same for `dailyNoteFormat`, `captureFolder`, `inboxFile`, `accent`), or make `dailyNotePath()` defensive: `String(this.settings.dailyNoteFolder ?? "").trim()`.

---

## BUG-08 — Duplicate/missing `uid`s are not repaired, so one widget is never refreshed and a runtime handle leaks

- **Severity**: medium-low
- **Where**: `src/main.ts:52-59` (`loadSettings` seeds a `uid` only when falsy) and `src/main.ts:183-185` (`refreshWidget`) → `src/view.ts:241-271` (`handles` is a `Map<uid, handle>`), `src/view.ts:277-285` (`refreshAllOfType` looks the instance up by `card.getAttribute("data-uid")`).
- **What**: if two layout entries share a `uid` (copy/paste in `data.json`, a sync merge, or any future bug that writes a non-unique uid), `loadSettings` keeps both. `DashboardView` identifies widgets by `uid` everywhere: `renderWidgetBody` stores the handle under `inst.uid` (so the second card's dispose handle is dropped), `refreshWidget(uid)` uses `querySelector` (first match only), and `refreshAllOfType` calls `layout.find(i => i.uid === …)` (first match only).
- **Why it's wrong**: the identity invariant the whole view layer relies on is assumed, never enforced. The visible effect is that one of the two widgets is frozen — it never refreshes when its data changes (both cards get the first instance's settings), and its timers/handles are never disposed on re-render or on `onClose`.
- **Trigger / repro**: `data.json` with two entries sharing `uid: "same"` → open the dashboard → edit a note / call `refreshWidget("same")`: only the first card updates; the second card's handle is absent from `view.handles`.
- **Impact**: stale widget contents on the dashboard, plus an undisposable per-widget timer (the smoke suite's `handles` size check is the observable proxy: 1 handle for 2 widgets).
- **Evidence**: executed
  ```
  $ node bug-hunt/scratch-02-main/probe9-uid.cjs
  layout uids after loadSettings: ["dup","dup"]
  handles map size: 1 of 2 widgets
  $ node bug-hunt/scratch-02-main/probe3-lifecycle.cjs
  [8b] duplicate uid kept: ["same","same"]
      cards: 2  handles map size: 1
      refreshWidget('same') -> handlers map size after: 1 (per-uid map cannot hold both)
  ```
- **Confidence**: high (behaviour); medium on how often real users hit it (requires a non-unique uid in the file)
- **Suggested fix**: dedupe while loading —
  ```ts
  const seen = new Set<string>();
  for (const inst of this.settings.layout) {
    if (!inst.uid || seen.has(inst.uid)) inst.uid = uid();
    seen.add(inst.uid);
  }
  ```

---

## BUG-09 — `DEFAULT_SETTINGS.activity` is a shared module-level object and is mutated in place by `loadSettings`/`recordActivity`

- **Severity**: low
- **Where**: `src/types.ts:58` (`activity: {}` in `DEFAULT_SETTINGS`) + `src/main.ts:47` (`Object.assign({}, DEFAULT_SETTINGS, raw ?? {})` — a shallow merge) + `src/main.ts:51` (`this.settings.activity = this.settings.activity ?? {}`)
- **What**: when `data.json` has no `activity` key, `this.settings.activity` **is** the exported `DEFAULT_SETTINGS.activity` object (identity-confirmed). `recordActivity()` (line 174) then increments keys on that shared object, permanently mutating the module-level default. Every later `loadSettings()` that also lacks an `activity` key receives the polluted object — and the plugin's own save (`saveSettings`, line 84) persists `saveData(this.settings)` by reference, which in Obsidian stringifies the same live object.
- **Why it's wrong**: module-level defaults must be immutable; `Object.assign` is a shallow copy, so any object-valued default is aliased. Today `activity` is the only object-valued default that survives load (`layout` is replaced on line 49), which is why the damage is confined to activity counts — but the pattern is the "DEFAULT_SETTINGS mutation across loads" defect called out in the task brief.
- **Trigger / repro**: two live plugin instances in one app session (e.g. an integration test, or code that constructs the plugin twice); record activity in A, then `loadData()` a profile with no `activity` key in B.
- **Impact**: activity data bleeds between instances/profiles in the same process — heatmap/streak totals can be inflated before the user ever edits a note, and the polluted counts get written back to whichever profile loads next. Low severity because Obsidian normally has one instance per app session.
- **Evidence**: executed
  ```
  $ node bug-hunt/scratch-02-main/probe6-versions.cjs
  == DEFAULT_SETTINGS.activity is shared across plugin instances ==
    A recorded activity: {"2024-05-05":7}
    B (fresh data.json with no activity key) sees: {"2024-05-05":7}
    B.settings.activity === DEFAULT_SETTINGS.activity: true
  ```
- **Confidence**: high (identity and mutation); low for real-world user impact
- **Suggested fix**: deep-copy the defaults when loading —
  ```ts
  this.settings = Object.assign({}, DEFAULT_SETTINGS, raw ?? {});
  this.settings.activity = { ...(raw?.activity ?? {}) };
  ```
  (and keep `DEFAULT_SETTINGS` frozen in dev builds).

---

## BUG-10 — Non-object `activity` in `data.json` makes every note edit throw inside the vault event listener

- **Severity**: medium
- **Where**: `src/main.ts:51` (`this.settings.activity = this.settings.activity ?? {}` — the `??` guard only catches `null`/`undefined`) → `src/main.ts:172-177` (`recordActivity`: `this.settings.activity[key] = (this.settings.activity[key] ?? 0) + 1`), reached from the vault handlers registered at `src/main.ts:39-40`.
- **What**: if `activity` in `data.json` is a primitive (number, string, boolean) the `?? {}` guard passes it through, and `recordActivity()` then tries to create an own property on a primitive, which always throws in TS-compiled strict-mode code. `recordActivity()` is called synchronously from the `vault.on("create")` / `vault.on("modify")` handlers, so the throw happens once per note edit inside Obsidian's event dispatch.
- **Why it's wrong**: the loader is supposed to make a hand-edited / sync-damaged / foreign-version file safe to use; for `layout` it at least checks `Array.isArray` (line 48), but for `activity` there is no type check at all. The failure is silent to the user (no Notice; the counter simply never counts and the heatmap/streak data never changes) and it repeats on every edit.
- **Trigger / repro**: `data.json` with `{"activity":"x", ...}` or `{"activity":0, ...}` (or any JSON scalar) → edit a note.
- **Impact**: activity tracking silently stops working for that install; a `TypeError` is thrown into Obsidian's vault `create`/`modify` event dispatch on every single note edit, with the plugin's own listeners (and other plugins' listeners on the same event) sharing that dispatch; nothing is surfaced to the user and nothing is repaired on disk.
- **Evidence**: executed
  ```
  $ node bug-hunt/scratch-02-main/probe10-activity-write.cjs
  activity=5              settings.activity type: number | recordActivity() THREW TypeError: Cannot create property '2026-09-11' on number '5'
  activity="x"            settings.activity type: string | recordActivity() THREW TypeError: Cannot create property '2026-09-11' on string 'x'
  activity="2024-01-01"   settings.activity type: string | recordActivity() THREW TypeError: Cannot create property '2026-09-11' on string '2024-01-01'
  activity=null           settings.activity type: object | recordActivity() ok -> {"2026-09-11":1}
  activity=undefined      settings.activity type: object | recordActivity() ok -> {"2026-09-11":1}
  activity=0              settings.activity type: number | recordActivity() THREW TypeError: Cannot create property '2026-09-11' on number '0'
  ```
- **Confidence**: high (throw confirmed); medium on whether Obsidian additionally surfaces the error to the user
- **Suggested fix**: check the type instead of just nullish:
  ```ts
  this.settings.activity =
    this.settings.activity && typeof this.settings.activity === "object" && !Array.isArray(this.settings.activity)
      ? this.settings.activity
      : {};
  ```

---

## BUG-11 — Settings-tab actions persist but do not refresh the tab's own controls

- **Severity**: low
- **Where**: `src/main.ts:348-355` ("Reset layout") and `src/main.ts:406-412` ("Clear data"); contrast with `src/main.ts:368-375` / `381-391` (accent actions) which do call `this.update()`
- **What**: the imperative actions mutate `s.layout` / `s.activity` and call `saveSettings()` + `rerenderDashboard()`, but unlike the accent actions they never call `this.update()` (and `setControlValue`, lines 316-320, only calls `refreshDomState()` when the key is `captureTarget`). The declarative tab therefore keeps rendering the pre-action state for anything it caches.
- **Why it's wrong**: inconsistent lifecycle handling in the same settings tab. It is not the same class of bug as the accent path, which was clearly written to refresh; the two "destructive" actions were not.
- **Trigger / repro**: open Settings → Aurora Dashboard → click "Reset layout": the dashboard re-renders from `defaultLayout()` and `data.json` is rewritten, but the tab is not refreshed.
- **Impact**: user sees a stale settings view immediately after a destructive action and has no feedback that the action took effect in the UI (the dashboard behind the modal may be hidden). Low severity — the data itself is correct (`layout` reaches 22, `activity` reaches `{}`, both persisted, verified below).
- **Evidence**: executed
  ```
  $ node bug-hunt/scratch-02-main/probe5-malformed.cjs
  settings tab class: DashboardSettingTab | has getSettingDefinitions: function
  after 'Reset layout' action: layoutN= 22  persistedN= 22
  after 'Clear data' action: activity= {}  persisted= {}
  getControlValue('accent') with accent='' -> "#7c3aed"
  getControlValue('columns') with columns=20 -> 20
  ```
  (The first block shows the tab class existing and the two actions writing through; the *missing*
  refresh is not observable in the jsdom stub because `PluginSettingTab` there has no declarative
  renderer at all — that half of this finding is static reasoning from the source.)
- **Confidence**: medium (the data-write path is verified; the missing UI refresh follows from `update()`/`refreshDomState()` not being called and was not observable in the jsdom stub, which has no declarative renderer)
- **Suggested fix**: add `this.update();` to both actions (matching the accent actions), or call `this.refreshDomState()` if only visibility matters.

---

## Checked and clean (do not re-report)

- **Missing/empty/null `layout`**: `{}`, `null`, `undefined`, `{"layout": null}`, `{"layout": []}` all fall back
  to `defaultLayout()` and render 22 widgets (`src/main.ts:48-50`) — verified in `probe1-settings.cjs`.
- **Unknown widget *type*** — reported as BUG-02, but note the render path itself is safe:
  `DashboardView.buildWidgetCard` returns early for an unregistered type (`src/view.ts:180-181`).
- **`uid()` uniqueness**: 200 000 consecutive `uid()` calls produced 0 collisions; 12 000 uids minted for
  400 foreign layout entries across 30 runs produced 0 duplicates (`probe9-uid.cjs`). `uid()` is
  `Math.random().toString(36).slice(2,9) + Date.now().toString(36)` (`src/utils.ts:3-4`) — no bug.
- **`activity` values**: `{"2024-01-01": null}`, `{"2024-01-01":"x"}`, `{"2024-01-01":1e9}` load and render fine (`?? 0`
  guards the increments, `src/main.ts:174`); the *shape* of `activity` is what breaks, see BUG-10.
  Neither is a case where the dashboard fails to render.
- **Commands on an empty vault / no active leaf**: `open-dashboard`, `toggle-edit-mode`,
  `capture-to-inbox` all invoke without throwing (`probe3-lifecycle.cjs [9]`); `activateView()` creates
  exactly one dashboard leaf and reuses it on the second call (`probe8-plugin.cjs`).
- **`toggleEditMode()` persistence**: `editMode` flips and is written to `data.json` (`probe8-plugin.cjs`).
- **`addWidget()`**: unknown type is a no-op (`src/main.ts:234-235`); known type appends and re-renders
  (`22 → 23`), defaults are spread rather than aliased (`src/main.ts:238`).
- **Per-render timer cleanup in the view**: `render()` → `runCleanups()`/`disposeAll()` keeps the jsdom
  timeout count stable across `rerenderDashboard()` (6 → 6, `probe8-plugin.cjs`). The plugin-level leak is
  only the debounce timer (BUG-05).
- **`setControlValue` override** (`src/main.ts:316-320`): `PluginSettingTab.getControlValue/setControlValue`
  exist since Obsidian 1.13.0 and `manifest.json` declares `minAppVersion: 1.13.0`, so calling
  `super.setControlValue` is safe — not a finding.
- **Vault event registration** (`src/main.ts:39-40`): both handlers go through `this.registerEvent`, so the
  base `Plugin.unload()` detaches them; no duplicate registration after a normal disable/enable.
- **`forDashboard` / `refreshWidget` with a bogus or `undefined` uid**: no throw, simply no-op
  (`probe8-plugin.cjs`) — the `instanceof DashboardView` guard on `src/main.ts:97` works.
- **v1 migration content**: it does *not* drop user widgets and does *not* duplicate habits when run twice
  (`probe2-persist.cjs [2]`, `[2b]`: uids preserved, exactly one habits entry).
