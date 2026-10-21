# Widgets: clock, calendar, activity heatmap, habits, streak, progress, deadline — findings

Area: `src/widgets/clock.ts`, `calendar.ts`, `activity.ts`, `habits.ts`, `streak.ts`, `progress.ts`,
`deadline.ts` (registration in `src/widgets/index.ts` was also checked).

**Method.** Followed `bug-hunt/README.md`: compiled the real plugin to CJS into
`bug-hunt/scratch-05-time/build` with the `npx tsc --outDir … --module commonjs …` recipe, loaded the
jsdom Obsidian stub via `bug-hunt/shim.cjs`, and rendered each widget type with a stub plugin/instance
(`scratch-05-time/harness.cjs`). `Date` was replaced by a subclass whose no-argument constructor returns
a fixed instant (`Date.now()` overridden too) so "today" could be moved to arbitrary days, DST
transition days, Feb 29, Dec 31/Jan 1 and 23:59:5x. Timer creation/clearing was counted by wrapping
`window.setInterval/clearInterval`. The consolidated probe is
`bug-hunt/scratch-05-time/p20-final.cjs` (single-widget probes: `p1`–`p21`). Probes were run under
`TZ=Europe/Bucharest` (system), `TZ=America/New_York`, `TZ=America/Los_Angeles` and
`TZ=Australia/Sydney`.

Run it with:

```powershell
npx tsc --outDir bug-hunt/scratch-05-time/build --module commonjs --target es2018 `
  --moduleResolution node --skipLibCheck --noEmit false --esModuleInterop `
  --lib es2018,dom --strict false src/main.ts
node bug-hunt/scratch-05-time/p20-final.cjs
```

Harness honesty notes: in the smoke stub `Modal.open()` does not append `contentEl` to `containerEl`
(probe p18b patches `Modal.prototype.open` to reach the modal), and `Workspace.getLeavesOfType()` only
matches leaves whose `viewType` was set, so probes that exercise plugin-driven refreshes set
`leaf.viewType = view.getViewType()` exactly like `WorkspaceLeaf.setViewState` does in the real app.

---

## BUG-01 — Heatmap writes an invalid `data-lvl="NaN"` whenever the busiest day has exactly one edit

- **Severity**: low
- **Where**: `src/widgets/activity.ts:51` (`level`), inside `activityType.render`; consumed by
  `styles.css:516-527` (`.dash-hm-cell[data-lvl="1"…"4"]`)
- **What**: the intensity bucket is computed as
  `count === 0 ? 0 : 1 + Math.round(((count - 1) / (maxCount - 1)) * 3)`. `maxCount` starts at `1` and
  is only raised by *strictly greater* values (`activity.ts:38-42`), so a window whose busiest day has
  exactly **one** edit keeps `maxCount === 1` and the divisor `maxCount - 1` is `0`. For the day with
  the edit, `(1-1)/0` is `NaN`, `Math.round(NaN)` is `NaN`, and the guard `count === 0 ? … : …` never
  applies a fallback — the attribute is literally written as `"NaN"`.
- **Why it's wrong**: `data-lvl` is meant to be one of `0..4` (the CSS only defines those five states,
  and the legend at `activity.ts:71-78` emits exactly `0..4`). `NaN` matches no rule, so that day loses
  the accent background it should get; the element also carries a non-numeric value that any future
  CSS/JS consumer (or a user's theme snippet) cannot interpret.
- **Trigger / repro**: fresh install, one edit today (or any single edit inside the 14-week window),
  the widget re-renders → every cell of that window is affected. Probe output:

  ```
  $ node bug-hunt/scratch-05-time/p20-final.cjs
  === BUG-01  heatmap writes data-lvl="NaN" (maxCount=1 => (count-1)/(maxCount-1)) ===
    empty activity        -> data-lvl values = ["0"]
    activity{2026-02-01:1} -> that cell data-lvl = "NaN"  (title "2026-02-01 · 1 edit")
    activity{2026-02-01:2} -> that cell data-lvl = "4"  (title "2026-02-01 · 2 edits")
  ```
- **Impact**: as soon as activity tracking has exactly one edit inside the window (the state every new
  user is in for their first day) the heatmap's only active square renders with the empty-day
  background; the day is indistinguishable from a day with no edits. Reproducible on every render that
  happens to have `maxCount === 1`.
- **Evidence**: executed (output above; also `p1-activity.cjs` case B).
- **Confidence**: high
- **Suggested fix**: make `maxCount` at least `2`, or special-case the divisor:
  `const level = count === 0 ? 0 : 1 + Math.round(((count - 1) / Math.max(1, maxCount - 1)) * 3);`

## BUG-02 — No timeline widget refreshes when the day changes: "today" stays yesterday for calendar, habits, heatmap, stats, progress and deadline

- **Severity**: medium
- **Where**: `src/widgets/calendar.ts:59` (`const todayKey = dateKey(new Date())`, computed once per
  month render and only recomputed inside `renderMonth()`), `src/widgets/habits.ts:88`
  (`const today = new Date()` for the whole render) and `habits.ts:97/118/141-150` (window, header and
  cell keys), `src/widgets/activity.ts:19` (`today`), `activity.ts:19-36` (window and cells),
  `activity.ts:94`/`activity.ts:104-106` (`statsType` sparkline + "Created today"),
  `src/widgets/progress.ts:54-66` (`update()` reads `new Date()` only every 60 s but the *day* value is
  never re-anchored to a rollover), `src/widgets/deadline.ts:34-67`. Only `clock.ts:35` and
  `streak.ts:69-75` install a repeating timer.
- **What**: every one of these widgets computes its notion of "today" at render time and none of them
  re-renders when the local day changes while the dashboard stays open. `DashboardView` has no rollover
  hook either (`src/view.ts:66-87` `render()` and `view.ts:273-285` `refreshActivityWidgets()` only list
  `activity, stats, tasks, calendar, recent, vaulttasks, popular, orphans, backlinks` and are driven by
  vault events/settings, never by a date change). The clock widget's `tick` (`clock.ts:21-36`) and the
  control-bar chip (`view.ts:117-120`) *do* update because they re-read `new Date()` every second, which
  is what makes the staleness of the others visible.
- **Why it's wrong**: a dashboard that is left open (the plugin's whole point — it is a pinned
  dashboard view) silently shows the previous day. `calendar.ts:69` marks the wrong square as
  `is-today`, `habits.ts:63/103/118/141-148` anchors the habit window and the `is-today` column on
  yesterday, `activity.ts:28` (`while (d <= today)`) stops the heatmap one day short (today's square
  does not exist yet), and the `streak`/`progress`/`deadline` numbers keep ticking against the old day.
- **Trigger / repro**: render the dashboard at 23:59:55 and let the clock roll over; the clock updates
  but nothing else does. Real output:

  ```
  === BUG-02  nothing refreshes at midnight: calendar/habits/activity/stats/progress/deadline keep yesterday ===
    23:59:55 (2026-02-10):
       calendar .is-today cell      = "10"
       habits   header .is-today    = 1
       habits   last cell data-date = 2026-02-10
       heatmap  chips               = "Streak · 0dWeek · 0Total · 0"
       progress rings               = 100%,36%,11%
       clock widget date            = "Tuesday, February 10, 2026"
       control-bar clock chip       = "11:59 PM"
    00:00:05 (+1.5s, no user action) — today is 2026-02-11:
       calendar .is-today cell      = "10"
       habits   header .is-today    = 1
       habits   last cell data-date = 2026-02-10
       progress rings               = 100%,36%,11%
       clock widget date            = "Wednesday, February 11, 2026"
       control-bar clock chip       = "12:00 AM"
    00:00:35 (+30s, the streak widget's tick has fired):   <-- unchanged from 00:00:05
  ```

  and in a separate run the habit cell the user is invited to click is still the previous day's:

  ```
  B) habit cell marked is-today: true | its data-date: 2026-02-10
  B) calendar cell marked is-today: 10            (today is 2026-02-11)
  ```
  (`p15-e2e-real.cjs`, whose `boot()` sets `leaf.viewType` so the plugin's own refresh path is live.)
- **Impact**: (a) the Habits widget's highlighted "today" column and the cell tooltips say
  "not done — click to mark done" for **yesterday**; a user who opens the dashboard in the morning and
  ticks their habit records it on the previous day, and the `Today n/m` chip keeps yesterday's state;
  (b) the Calendar highlights the wrong square as today and its click target opens the wrong day's note;
  (c) the Activity heatmap is missing today's square (and its Streak/Week chips) until something else
  happens to refresh the widget — the `streak` widget in the same layout *has* updated, so two widgets
  disagree about which day it is.
- **Evidence**: executed (both transcripts above).
- **Confidence**: high
- **Suggested fix**: give `DashboardView` one rollover timer for the whole view, e.g. in `render()` add
  `const t = window.setInterval(() => { if (dateKey(new Date()) !== openKey) { openKey = dateKey(new Date()); this.render(); } }, 30_000); this.cleanups.push(() => window.clearInterval(t));`
  (the pattern `streak.ts:67-76` already uses), so every date-dependent widget re-renders at midnight;
  the Calendar/Habits could alternatively recompute `todayKey` on each of their own clicks.

## BUG-03 — Progress "Year" ring counts elapsed days with `ms / 86400000`, so it is one day behind for ~58–66 days a year in any DST zone

- **Severity**: medium
- **Where**: `src/widgets/progress.ts:63` — `const doy = Math.floor((now.getTime() - startOfYear.getTime()) / MS_PER_DAY) + 1;`
  (`MS_PER_DAY = 86_400_000` at `progress.ts:5`), consumed at `progress.ts:65`.
- **What**: the day-of-year is derived by dividing elapsed **milliseconds** by 24 h. In every timezone
  with DST, the local day that contains the spring-forward transition is only 23 h long, so from that
  day until the autumn fall-back (25 h) the elapsed-ms value is one hour short of `N × 86400000`. The
  `Math.floor` therefore returns `trueDoy - 1` for the first hour of each of those days (00:00–00:59),
  i.e. exactly while a user may have the dashboard open overnight and the 60 s timer repaints it.
- **Why it's wrong**: the calendar date and the "number of days elapsed this year" disagree. The correct
  count is a *calendar* count (e.g. `Math.round` of the same difference, or counting month lengths),
  not an elapsed-time count. Note that `progress.ts:57` (day ring) and `deadline.ts:44-46` (day delta,
  rounded) are not affected — this is specific to the floored day-of-year.
- **Trigger / repro**: render the Progress widget at 00:00 on/after the spring-forward date in a DST
  zone. Probe (run in this container's timezone `Europe/Bucharest`, where 2026-03-29 is the
  spring-forward; the same probe under `TZ=America/New_York` shows the window starting 2026-03-09):

  ```
  === BUG-03  progress Year ring uses ms/86400000 day counting (breaks right after a DST spring-forward) ===
    TZ=(system)
    2026-03-09 00:00 -> rings=0%,29%,19%   widget day-of-year=68 true day-of-year=68
    2026-07-01 00:00 -> rings=0%,3%,50%    widget day-of-year=181 true day-of-year=182
    2026-03-08 00:00 -> rings=0%,26%,18%   widget day-of-year=67 true day-of-year=67
    2026-02-10 12:00 (control, no transition nearby) -> rings=50%,36%,11%
  ```

  Exhaustive sweep (`p21-yearring-visible.cjs`, render the widget at 00:00 for every day of 2026 and
  compare the *displayed* percentage with the true one):

  ```
  TZ = Europe/Bucharest
  days in 2026 where the *rendered* Year % differs from the true value: 58
    first: 2026-03-31: shown 24%, true 25% (doy 89 vs 90)
  TZ = America/New_York
  days in 2026 where the *rendered* Year % differs from the true value: 66
    first: 2026-03-09: shown 18%, true 19% (doy 67 vs 68)
  ```
  (`p17-doy2.cjs` confirms the underlying count is wrong on 210 (Bucharest) / 238 (New York) days of
  2026 between 00:00 and 00:59, and correct at every other time of day.)
- **Impact**: the "Year" ring and its percentage are one day (usually 1 %) low on ~60 days a year,
  always in the small hours — the ring says less of the year has passed than actually has, and its
  fill animation jumps two days' worth at 01:00.
- **Evidence**: executed (two transcripts above).
- **Confidence**: high
- **Suggested fix**: count calendar days instead of elapsed milliseconds, e.g.
  `const daysInYear = isLeap(y) ? 366 : 365; const doy = Math.round((now.getTime() - startOfYear.getTime()) / MS_PER_DAY) + 1;`
  or compute it from the month lengths like `refDoy` in the probe.

## BUG-04 — Deadline accepts impossible dates and silently counts down to a different day

- **Severity**: medium
- **Where**: `src/widgets/deadline.ts:6-11` (`parseDate`), used at `deadline.ts:36`; the settings field is
  free text (`deadline.ts:25`).
- **What**: `parseDate` matches `^(\d{4})-(\d{1,2})-(\d{1,2})$` and then calls
  `new Date(Number(y), Number(m) - 1, Number(d))`, which **normalises** out-of-range components instead
  of rejecting them (`2026-02-30` → Mar 2, `2026-13-05` → Jan 5 of the next year, `2026-02-00` →
  Jan 31). It only rejects genuinely non-numeric input, and the guard
  `Number.isNaN(d.getTime())` at `deadline.ts:10` can never fire for these inputs.
- **Why it's wrong**: the widget then displays a confident countdown to the *rolled-over* date, and
  `footEl` (`deadline.ts:60-66`) prints that different date, so the user's typo is converted into a
  wrong deadline with no warning anywhere in the UI.
- **Trigger / repro**: set the widget's "Deadline date" to `2026-02-30` with the dashboard's date being
  2026-02-10. Probe output:

  ```
  === BUG-04  deadline accepts impossible dates (parseDate never compares the result back to the input) ===
    date="2026-02-30" -> days="20" sub="days left" foot="Deadline · Mar 2, 2026"
    date="2026-02-31" -> days="21" sub="days left" foot="Deadline · Mar 3, 2026"
    date="2025-02-29" -> days="346" sub="days overdue" foot="Deadline · Mar 1, 2025"
    date="2026-13-05" -> days="329" sub="days left" foot="Deadline · Jan 5, 2027"
    date="2026-02-00" -> days="10" sub="days overdue" foot="Deadline · Jan 31, 2026"
    date="2026-02-11" -> days="1" sub="day left" foot="Deadline · Feb 11, 2026"
  ```
  (the same output was reproduced under `TZ=America/New_York`, so it is not timezone dependent.)
- **Impact**: a mistyped deadline (a real risk specifically at month ends and for Feb 29 in non-leap
  years) is accepted silently and the widget counts down to a date the user never chose — e.g. a
  "Feb 30" deadline displayed as "Mar 2" and, once passed, flagged overdue instead of showing an error.
- **Evidence**: executed (output above).
- **Confidence**: high
- **Suggested fix**: reject when the components do not round-trip:
  `if (d.getFullYear() !== +m[1] || d.getMonth() !== +m[2] - 1 || d.getDate() !== +m[3]) return null;`
  (the widget then shows its existing "Set a date in settings" state).

## BUG-05 — Streak "Best" can never exceed 801 days

- **Severity**: low
- **Where**: `src/widgets/streak.ts:5` (`LOOKBACK_DAYS = 800`), `streak.ts:40-48` (best-run scan
  `for (let d = new Date(start); d <= today; d = shift(d, 1))`), chip at `streak.ts:60`.
- **What**: the "Best" run is measured only over the fixed 800-day window (`shift(today, -800)` …
  today = 801 days inclusive), while the *current* streak is computed by an unbounded
  `while (exists(cur))` walk (`streak.ts:32-35`). For anyone with more than 800 days of consecutive
  daily notes the two numbers contradict each other, and "Best" is silently capped.
- **Why it's wrong**: the label reads `Best · Nd` without a bound, so it is presented as the user's all
  time best while it is a windowed maximum.
- **Trigger / repro**: a vault with 1000 consecutive daily notes:

  ```
  === BUG-05  streak 'Best' is clamped to the 800-day lookback ===
    vault with 1000 consecutive daily notes -> num=1000 chips=["Best · 801d","This week · 7/7","Last · 2026-02-10"]
  ```
  (`p7-streak-timers.cjs` prints the same figure; 801 rather than 800 because the scan is inclusive of
  both ends.)
- **Impact**: users with >2.2 years of daily notes see "Best · 801d" next to a larger current streak;
  the number is wrong and visibly so.
- **Evidence**: executed (output above).
- **Confidence**: high
- **Suggested fix**: derive `best` from the same unbounded walk used for the current streak (keep a
  running maximum while walking back), or raise/remove `LOOKBACK_DAYS` and say so in the label
  (`Best (800d) · Nd`).

## BUG-06 — Heatmap and Notes widgets crash to the "hit a snag" card when `settings.activity` is not an object

- **Severity**: low
- **Where**: `src/widgets/activity.ts:16` (`const activity = ctx.plugin.settings.activity;`) then
  `activity[dateKey(day)]` at `activity.ts:40`, `activity.ts:66` (`Object.values(activity)`),
  `activity.ts:95-96`/`activity.ts:107` in `statsType`. Type is `Record<string, number>`
  (`src/types.ts:39`).
- **What**: the render path never validates the shape of `settings.activity`. A `null` value throws
  inside `render`, which `DashboardView.renderWidgetBody` catches (`src/view.ts:256-261`) and replaces
  with the generic error card. `plugin.loadSettings()` coerces a persisted `null`/`undefined`
  (`src/main.ts:51` — `this.settings.activity = this.settings.activity ?? {}`) but nothing else, so any
  other wrong type that can reach the widget (a
  hand-edited or partially-written `data.json`, another plugin/version writing the key, a corrupted
  save) breaks two widgets at once.
- **Why it's wrong**: it is a render-time crash on persisted data, and the user is told only
  "This widget hit a snag — try again." with no way to recover from inside the dashboard.
- **Trigger / repro**:
  ```
  === BUG-06  heatmap crashes (render error card) when settings.activity is not an object ===
    settings.activity=null -> activity: THREW Cannot read properties of null (reading '2025-11-03')
    settings.activity=null -> stats: THREW Cannot read properties of null (reading '2026-02-04')
    settings.activity=42 -> activity: rendered ok (text "Streak · 0dWeek · 0Total · 0LessMore")
    settings.activity="x" -> activity: rendered ok (text "Streak · 0dWeek · 0Total · 0xLessMore")
  ```
  (`p19-malformed.cjs` found the same for the full matrix of malformed `plugin.settings` values;
  `activity` and `stats` are the only two widgets in this area that throw.)
- **Impact**: both the Activity heatmap and the Notes/Stats widget are replaced by an error card and
  stay broken until the data file is fixed or "Clear data" is used; a string/array value silently
  renders nonsense (`Total · 0x`, `undefined` counts) instead.
- **Evidence**: executed (output above).
- **Confidence**: medium (the crash is certain; how a wrong-typed value gets persisted in practice is
  the uncertain part — `loadSettings` repairs the common `null` case)
- **Suggested fix**: normalise once at entry, e.g.
  `const raw = ctx.plugin.settings.activity; const activity = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};`
  (and the same guard in `statsType`, or better, in `main.ts:51`).

## BUG-07 — A habit row that has no stored id keeps its completion history out of the settings file

- **Severity**: low
- **Where**: `src/widgets/habits.ts:26` (`const id = typeof o.id === "string" && o.id !== "" ? o.id : uid();`
  in `readHabits`), `habits.ts:148` (`cell.setAttr("data-hid", h.id)`), `habits.ts:160-168` (`toggle`
  writes `log[hid]`) and `habits.ts:289-296` (`commit()` drops log keys whose habit id is not in
  `keep`).
- **What**: `readHabits` mints a fresh `uid()` for every stored habit that lacks an `id`, but never
  writes it back to `inst.settings.habits`. Every render therefore produces a *new* id for that habit,
  so completions logged by `toggle` are written under an id that no longer exists on the next render,
  and a later "Done" in the habits editor deletes those keys (`habits.ts:295`).
- **Why it's wrong**: the widget accepts a habit without an id as valid (renders it, lets the user tick
  it) and then silently discards the ticks; `commit()` treats the orphan ids as belonging to deleted
  habits.
- **Trigger / repro**: `inst.settings.habits = [{id:"h1",name:"Exercise"},{name:"Read"}]` (a legacy or
  hand-edited config), render, refresh, render again:
  ```
  === BUG-07  habit rows with no stored id get a fresh random id on every render ===
    render #1 habit ids on cells       = ["h1","1xai45wmlgfjgg0"]
    render #2 habit ids on cells       = ["h1","k0nx6tbmlgfjgg0"]
    ids persisted back to settings     = [{"id":"h1","name":"Exercise"},{"name":"Read"}]
  ```
- **Impact**: for affected configs the "Read" row can never show a completion, the `Today n/m`,
  `% this window` and `n/days` chips stay wrong, and any completions that were logged are removed from
  the saved data the next time the habit editor is committed. Not reachable through the plugin's normal
  add-habit flow (`habits.ts:244` always assigns `uid()`), so it needs a legacy/hand-edited layout.
- **Evidence**: executed (output above)
- **Confidence**: medium (the id churn is proven; the history loss requires a config without ids,
  which the normal UI does not produce)
- **Suggested fix**: persist the generated id: in `readHabits`, assign
  `const habit = { id, name }; out.push(habit);` and write the repaired array back
  (`inst.settings.habits = out`) before returning, so ids are stable from the first render onward.

---

## Checked and clean

- **Calendar month grid (`calendar.ts:56-71`) — correct.** Brute-forced 16 month/settings combinations
  (`2024-02` leap, `2025-02`, `2026-02/03/05/11/12`, `2027-01`, each with `startMonday` true/false):
  day-of-week header order, leading blank-cell count
  `(first.getDay() + (startMonday ? 6 : 0)) % 7`, day-cell count vs `daysInMonth`, day numbering, and
  exactly one `is-today` cell when the viewed month is the current one — all matched an independently
  computed expectation. Feb 2024 renders 29 cells, Jan 2026 → Feb 2026 keeps 28 days, `prev` past
  January lands on December of the previous year, the jump-to-today button restores the current month,
  and a day cell calls `openDay` with the cell's own date (`p4-calendar.cjs`: `calendar FAILURES: 0`).
- **Clock (`clock.ts:21-36`) — correct.** All 24 h × {0,5,59} min × 8 combinations of `format24`/
  `showSeconds` produced exactly the expected string, including `12:xx AM`/`12:xx PM`; the date line
  rolls over at midnight because `tick` re-reads `new Date()`; `tick()` runs once before the interval,
  the handle clears the interval, and `{format24:"no"}` / `{format24:null}` / `{showSeconds:0}` behave
  sanely (`p8-clock-stats.cjs`: `clock time-format mismatches: 0`).
- **Heatmap window and alignment (`activity.ts:19-56`) — correct apart from BUG-01.** The rendered
  window always ends on today, starts on a Monday, columns are capped at 7 days with a short last
  column, every cell lands in the row matching its own weekday (verified through the `title` date, not
  assumed), `weeks` is clamped to 4…26 (`0`→14, `99`→26, `"x"`→14), keys are `YYYY-MM-DD` with no
  duplicates, the 7-day chip counts exactly today-6…today, `Total` sums the whole stored map, and future
  days are forced to 0 (`p1-activity.cjs`, `p16-doy-alignment.cjs`, `p17-doy2.cjs`).
- **Streak maths (`streak.ts:26-63`) — correct apart from BUG-05.** Current streak matches an
  independent reference for today-only / today+yesterday / yesterday-only / gap / 30-day run / no-notes
  cases (today is allowed to be missing, a one-day gap ends the run, `Best` and `This week` agree with
  the reference) (`p7-streak-timers.cjs`).
- **Habits maths (`habits.ts:49-158`) — correct.** `days` clamps to 7…31 with a 14 fallback for
  non-numeric values (note `null`/`0`/negatives fall to the 7-day floor, since
  `Number(null) === 0` is finite — `readDays`'s `Number.isFinite` default of 14 is only reached for
  `NaN`); the window is anchored on today; `currentStreak` matches the documented "today may still be
  pending" rule (gap yesterday ⇒ 0, run ending yesterday ⇒ n); `filled/slots` never divides by zero
  because the empty-habits case returns early; malformed `habits`/`log` values (`"Read"`, `null`,
  arrays, non-array log values, junk/invalid date strings) are all filtered without throwing and without
  echoing junk into the DOM (`p6-habits.cjs`).
- **Progress rings (`progress.ts:31-35, 54-66`) — correct apart from BUG-03.** `makeRing` clamps the
  fraction to 0…1 so `stroke-dashoffset` can never be negative/NaN, the day ring's fraction matches
  elapsed ms and never goes out of range, the month ring uses the real `daysInMonth` (Feb 2024 = 29),
  and day/time/leap-year cases Dec 31 23:30, Jan 1, Mar 1 2024 all produced sensible values
  (`p3-progress.cjs`).
- **Deadline countdown (`deadline.ts:44-46`) — DST-safe.** Because both sides are local midnights and
  the difference is `Math.round`ed, a 23 h or 25 h DST day still yields the correct whole-day count
  (Mar 7 → Mar 9 = 2 days, Mar 8 → Mar 9 = 1 day, Oct 31 → Nov 2 = 2 days under
  `TZ=America/New_York`). "Today" is shown as `0 / today` (not overdue), a past date is `n days overdue`
  with the `overdue` class, and an empty/unparseable/whitespace-padded/garbage input falls back to the
  `—` state; non-string persisted values (`null`, number, boolean, `{}`, `[]`) do not throw
  (`p5-deadline.cjs`).
- **Timers/leaks — no leak found in this area.** Each of `clock`, `progress`, `streak` and `deadline`
  creates exactly one interval and returns a `dispose` that clears it (interval count returns to 0 after
  `dispose()`); `calendar`, `activity`, `stats` and `habits` create none. `DashboardView.renderWidgetBody`
  (`src/view.ts:241-247`) disposes the previous handle before re-rendering and `render()` (`view.ts:75-76`)
  runs `runCleanups()`/`disposeAll()`, so repeated `render()`/`refreshWidget()` cycles do not accumulate
  intervals (`p7-streak-timers.cjs`).
- **Date stepping across DST — clean.** The `shift()`/`setDate(+1/-1)` walks used by `streak.ts:7-11`,
  `habits.ts:54-58` and `activity.ts:28-34` were brute-forced over every day of 2024–2027 for offsets
  1,2,7,14,27,29,30,365 under `Europe/Bucharest`, `America/New_York` and `Australia/Sydney`: **0
  mismatches** — `setDate` keeps the local clock time, so the date keys stay aligned (`p2-dst-walk.cjs`).
  (The `+86400000` style arithmetic the area brief warned about does not appear in these widgets; the
  closest analogue is BUG-03.)
- **Note/`Date` key helpers feeding these widgets — clean.** `dateKey` (`src/utils.ts:11-12`) uses local
  components, so activity keys, habit keys, daily-note paths and `noteExistsFor` agree on the local
  calendar day regardless of timezone.
- **`src/widgets/index.ts` — all seven modules are imported** (clock, calendar, activity, deadline,
  progress, streak, habits) and every type registers; the default layout (`src/layout.ts:133-157`)
  instantiates all of them without a render error (22 widgets render).
- **Malformed/legacy instance settings — no crash.** Replacing `inst.settings` with `null`, a string, a
  number or an array, and `plugin.settings` with `null`/string/number/bool/array, rendered all eight
  widget types without a `render` throw (the only failures being the `activity` ones in BUG-06)
  (`p19-malformed.cjs`).
