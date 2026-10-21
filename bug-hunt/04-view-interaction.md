# Dashboard view (grid, drag/resize, edit mode, modals) findings

Area: `src/view.ts` (569 lines) — control bar, grid rendering, per-widget chrome, drag, resize,
edit mode, collapse, widget-settings/Add-widget modals, reset layout, `.dash-widget-error` boundary.

All reproductions were run with the README recipe (`npx tsc --outDir bug-hunt/scratch-04-view/build
--module commonjs … src/main.ts`, then jsdom + `smoke/stub-obsidian.js` via `bug-hunt/shim.cjs`).
Scripts: `bug-hunt/scratch-04-view/probe*.cjs` (probe5/probe7/probe8 hold the pasted output below).
The probes install a real `getBoundingClientRect` on `.dash-grid` (jsdom has no layout engine) — that
is the only stub; every code path exercised is the real compiled `src/view.ts`.

---

## BUG-01 — Touch drags are cancelled and leak two `document` listeners per gesture (`pointercancel` never handled)
- **Severity**: high
- **Where**: `src/view.ts:340-352` (`enableDrag` → `onUp` / listener registration; same pattern at `src/view.ts:415-425` in `enableResize`); missing rule in `styles.css:220` (`.dash-grip`) / `styles.css:332` (`.dash-resize`)
- **What**: A drag/resize gesture only ever tears itself down from `pointerup`. There is no `pointercancel` listener (`src/view.ts:350-351`, `423-424`), no `Escape` handler, and no `setPointerCapture` on the grip/resize handle. The `pointerdown` handler calls `e.preventDefault()` (`src/view.ts:321`, `397`) but nothing in `styles.css` sets `touch-action`, so on a touch device the browser claims the gesture for panning at the first movement.
- **Why it's wrong**: When the browser claims the gesture it fires `pointercancel` instead of `pointerup`. The two listeners the code added to `document` are never removed, `card.classList` keeps `is-dragging` forever, and the drop-target stays visible. Every cancelled gesture permanently adds one `pointermove` + one `pointerup` handler to `document`; each stale `onMove` then runs `cellAt()` + `showDropTarget()` on *every* subsequent mouse move for the lifetime of the session, and a stale `onUp` will commit a position for a card that is no longer on screen. `View.onClose()` (`src/view.ts:36-40`) cannot clean these up either, because they are not registered in `this.cleanups`.
- **Trigger / repro**: `node bug-hunt/scratch-04-view/probe5.cjs`, section D1 — start a drag, fire `pointercancel` (what a real touch-scroll or a browser-level gesture interruption does), repeat:
  ```
  D1 leaked document listeners after 0/1/2/3 cancelled drags = [0,2,4,6]
  D1 card still has .is-dragging = true
  D1 listeners still there after view.onClose() = 6
  ```
  Real-world trigger: on any phone/tablet open the dashboard, enter edit mode, and drag a widget by its grip — the grid scrolls, the widget snaps back, and (before long) dragging becomes jerky because N stale drag handlers are re-computing the drop cell on every pointermove.
  The same defect is reachable with a mouse: press on the grip, drag to the edge of the window, release outside the web content — the browser may deliver `pointercancel` rather than `pointerup`, with identical results.
- **Impact**: drag/resize is effectively unusable on touch (a documented core feature, and `manifest.json:9` says `isDesktopOnly: false`), plus an unbounded listener leak that degrades the whole workspace session and persists after the dashboard is closed.
- **Evidence**: executed (output above)
- **Confidence**: high (the leak and stuck state are measured; the touch part is the standard `touch-action`/`pointercancel` behaviour and is the reason those events exist)
- **Suggested fix**: factor the teardown into one function and wire it to `pointercancel` as well as `pointerup`:
  ```ts
  let last = { x: drag.startX, y: drag.startY };
  const onMove = (ev: PointerEvent): void => { last = { x: ev.clientX, y: ev.clientY }; /* …as today… */ };
  const detach = (): void => {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    document.removeEventListener("pointercancel", onCancel);
  };
  const onUp = (): void => { detach(); this.finishDrag(card, inst, last.x, last.y, true); };
  const onCancel = (): void => { detach(); this.finishDrag(card, inst, last.x, last.y, false); };
  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp);
  document.addEventListener("pointercancel", onCancel);
  ```
  where `finishDrag` does today's `onUp` body (`card.removeClass("is-dragging")`, `card.style.removeProperty("transform")`, `this.hideDropTarget()`) and calls `this.placeInstance(inst, cell.x, cell.y)` **only when `commit` is true**.
  Add `touch-action: none;` to `.dash-grip` and `.dash-resize` so the browser does not steal the gesture in the first place. Pushing the same teardown into `this.cleanups` also fixes the close-mid-drag case.

---

## BUG-02 — A gesture keeps writing to the layout after edit mode is switched off / the widget is re-rendered
- **Severity**: medium
- **Where**: `src/view.ts:340-348` (`onUp` in `enableDrag`), `src/view.ts:415-421` (`onUp` in `enableResize`), `src/view.ts:387` (`this.render()` inside `placeInstance`), `src/main.ts:118-122` (`toggleEditMode` — it enables edit mode *without* taking an `editSnapshot`)
- **What**: `onUp` unconditionally mutates `plugin.settings.layout` and saves. It never re-checks that edit mode is still on, and it never checks that the `card` element it is dragging is still attached to the document. The dashboard is re-rendered by `render()` on every commit and by `rerenderDashboard()`, so a gesture can outlive the DOM it started on.
- **Why it's wrong**: The dashboard has an explicit "discard my layout edits" path (the *Cancel editing* button, `src/view.ts:148-158`, which restores `editSnapshot`), yet a drag that is already in flight when edit mode ends is committed anyway. Specifically:
  1. Start a drag, then leave edit mode through *Toggle dashboard edit mode* (`main.ts:118-122`) or the settings toggle — no snapshot is taken on that path, so the half-finished drag is written straight to `data.json` and survives.
  2. Any other re-render during the gesture (`plugin.refreshActivityWidgets()` fires on every vault `modify` event via `main.ts:39-40, 176`, so simply typing in a note is enough) detaches the card being dragged. The drag then continues against a detached element, but `placeInstance` still mutates the live instances.
  3. The same applies to resize: `onUp` calls `resolveOverlaps` + `saveSettings` even when edit mode is off, so a widget can be resized after the user has left edit mode.
- **Trigger / repro**: `node bug-hunt/scratch-04-view/probe5.cjs`, section D2:
  ```
  D2 editMode during gesture = false
  D2 position before -> after = [{"x":0,"y":0},{"x":6,"y":3}]
  D2 editMode still off = false
  ```
  (pointerdown on the grip with edit mode on → `plugin.toggleEditMode()` → pointermove/pointerup; the widget moved 6 columns / 3 rows while edit mode was off.)
- **Impact**: layout edits cannot be aborted reliably; a widget can be moved or resized when the user is no longer in edit mode, and the change is persisted immediately with no undo.
- **Evidence**: executed (output above)
- **Confidence**: high
- **Suggested fix**: give the view a render generation counter that is bumped in `render()` and captured at `pointerdown`; in `onUp` return early when `!this.plugin.settings.editMode || gen !== this.renderGen || !card.isConnected`. Also make `main.ts:toggleEditMode()` take/clear the same `editSnapshot` the pencil button does, so both entry points behave identically.

---

## BUG-03 — Narrow windows: the drop preview is drawn in the wrong place and widgets land in the wrong columns
- **Severity**: high
- **Where**: `src/view.ts:289-300` (`cellAt`) and `src/view.ts:302-311` (`showDropTarget`) versus `styles.css:1416-1422` (`@media (max-width: 720px)` forces `.dash-grid { grid-template-columns: 1fr }` and `.dash-widget { grid-column: 1 / -1 }`)
- **What**: All drag maths take the column count from `plugin.settings.columns` (12 by default) and the cell width from `gridEl.getBoundingClientRect().width`. Below 720 px the stylesheet collapses the grid to **one** column and ignores `--dash-cx/--dash-cw`, but the JavaScript still models 12 columns, so it divides the visible width into 12 imaginary tracks.
- **Why it's wrong**: The drop-target rectangle is positioned from the imagined track geometry, so it appears in the middle of the screen instead of in the single visible column, and the committed `inst.x` is a column index that has no relation to what the user sees (all cards are full-width, so the user cannot tell columns apart at all). Note also that the CSS clamps `--dash-cx` for the *rendered* style but `inst.x` is still persisted.
- **Trigger / repro**: `node bug-hunt/scratch-04-view/probe8.cjs` (grid width 700 px, the same value the media query breaks at):
  ```
  N1 configured columns / CSS real columns = [12,1]
  N1 computed cell width from view.ts math = 46
  N1 drop preview left px (should be 0 for a 1-col layout) = "297.5px"
  N1 drop preview width px = "45.5px"
  N1 A position before -> after dropping mid-row = [{"x":0,"y":0},{"x":5,"y":2}]
  N1 rendered grid-column for A = "6"
  ```
  Real-world repro: narrow the Obsidian window (or open the dashboard on a phone) until the grid is one column, enter edit mode, drag the left card by its grip towards the middle of the row — the dashed preview box sits at 297 px in the middle of the row and the widget is stored at column 6 / row 2.
- **Impact**: on small windows/mobile the drag preview is meaningless and a drag silently reshuffles the layout the user cannot see; the saved layout drifts out of sync with what is displayed.
- **Evidence**: executed (output above)
- **Suggested fix**: derive the effective column count from the element and use it everywhere instead of `s.columns` in the gesture path (`cellAt`, `showDropTarget`, `placeInstance`, the resize clamp and the `resolveOverlaps` calls). The breakpoint is explicit in `styles.css`, so the minimal version is:
  ```ts
  /** Columns the grid actually renders with. */
  private effectiveColumns(): number {
    return this.gridEl.getBoundingClientRect().width < 720 ? 1 : this.plugin.settings.columns;
  }
  ```
  Alternatively hide the grip/resize handles entirely while the single-column breakpoint is active, since a column index has no meaning there.

---

## BUG-04 — `noHeader` widgets cannot be moved, removed or configured (and their resize handle does nothing)
- **Severity**: high
- **Where**: `src/view.ts:205-206` (`buildWidgetHeader` returns immediately for `noHeader`), which means no `.dash-grip` is created → `src/view.ts:318-319` (`enableDrag` bails out), no gear / ✕ → `src/view.ts:222-235`; the unused resize handle is still created at `src/view.ts:395`; `src/widgets/clock.ts:10` sets `noHeader: true`
- **What**: `noHeader` widgets get a `.dash-widget-body` and nothing else. `buildWidgetHeader` returns before rendering the grip, the collapse button and the `dash-widget-actions` container (gear + ✕). `buildWidgetCard` still calls `enableDrag`/`enableResize` (`src/view.ts:192-195`), so a resize handle is appended — but `enableDrag` finds no `.dash-grip` and returns without attaching anything. The result is a card that is visually in edit mode (dashed border, resize corner) but has no working controls at all.
- **Why it's wrong**: The plugin ships one `noHeader` widget type (Clock) and it is in the default layout (`src/layout.ts:135`), while `README.md:11-12, 62` documents "Draggable, resizable widgets" and edit mode as "drag, resize, remove, and re-configure widgets". For `noHeader` widgets none of that is true, and because *Add widget* happily creates more clocks (`AddWidgetModal` → `plugin.addWidget`, `src/main.ts:233-255`), a user who adds a second clock has no way to remove it except *Reset layout* — which also throws away every other layout change.
- **Trigger / repro**: `node bug-hunt/scratch-04-view/probe7.cjs`, section C2 and `probe6.cjs` R7:
  ```
  C2 per-widget controls on a clock card (edit mode ON) = []
  C2 clocks in layout after addWidget = 3
  R7 noHeader card has grip = false
  R7 noHeader card has resize handle = true
  R7 noHeader card has settings/remove buttons = 0
  ```
  (edit mode on, 2 clock cards rendered, resize handle present but no grip/gear/✕; `plugin.addWidget("clock")` accepts a third clock.)
- **Impact**: duplicate/interstitial clock widgets are permanent; the clock cannot be repositioned or resized even though the UI implies it can; the documented edit-mode workflow is broken for that widget type.
- **Evidence**: executed (output above)
- **Confirmed by**: nothing in edit mode is keyboard- or command-reachable either — the only commands are *Open dashboard*, *Toggle dashboard edit mode* and *Capture to inbox* (`src/main.ts:21-35`), so a stray clock card cannot be removed from the keyboard either.
- **Confidence**: high
- **Suggested fix**: in edit mode, render a minimal header for `noHeader` widgets (`.dash-grip` + `.dash-widget-actions` only, without the title/icon), or attach the drag handler to the whole card when `type.noHeader` is set *and* edit mode is on, and skip `enableResize` when `!card.querySelector(".dash-grip")` so the dead corner handle is not shown.

---

## BUG-05 — Collapsing and re-expanding a widget leaves it overlapping its neighbour (no re-flow on expand)
- **Severity**: medium
- **Where**: `src/view.ts:216-220` (collapse click handler: toggles `inst.collapsed`, saves, `render()`), `src/view.ts:202` (`position` draws a collapsed card as 1 row high), `src/view.ts:385` (`resolveOverlaps` is only ever called from `placeInstance` and resize `onUp`)
- **What**: Collapsing a widget only changes how tall it is drawn. `inst.y`/`inst.h` stay as they were, and neither the collapse nor the expand path calls `resolveOverlaps` (or any other overlap check). A widget that sits below the collapsed widget occupies a row that the collapsed widget now only visually borrows.
- **Why it's wrong**: The grid is otherwise strictly overlap-free — `placeInstance`/`resolveOverlaps` guarantee it, and I verified that guarantee over 4000 random drags (see *Checked and clean*). The collapse/expand path is the one entry point that bypasses it, so expanding a widget can put two cards on the same grid rows. The persisted layout stays invalid until some later drag/resize happens to re-run `resolveOverlaps`, and the overlapping state is written to `data.json` in the meantime.
- **Trigger / repro**: `node bug-hunt/scratch-04-view/probe5.cjs`, section D3 — two widgets, B directly below A; click A's collapse chevron twice:
  ```
  D3 overlap after collapse+expand = true
  D3 A = {"x":0,"y":0,"w":4,"h":4}
  D3 B = {"x":0,"y":1,"w":4,"h":4}
  D3 rendered grid-row per card = [["A","1/span 4"],["B","2/span 4"]]
  ```
  `A` spans rows 1-4 and `B` starts at row 2 → they visibly overlap (B is drawn on top of A's lower two thirds). With the shipped default layout this is trivial to hit: collapse `clock` (0,0,4,2) and expand it again while `stats` (0,2,4,2) sits under it, or collapse `calendar`/`activity` in the first row.
- **Impact**: widgets render on top of each other and stay that way across reloads; note names, buttons and inputs underneath are unreachable until the user drags a widget to force a re-flow.
- **Evidence**: executed (output above)
- **Confidence**: high
- **Suggested fix**: after toggling `collapsed`, call `resolveOverlaps(this.plugin.settings.layout, this.plugin.settings.columns)` before `saveSettings()`/`render()`; alternatively make `position()` account for the collapsed height in the layout model by keeping a separate `collapsedH`.

---

## BUG-06 — Resizing a collapsed widget silently stores a size you cannot see
- **Severity**: medium
- **Where**: `src/view.ts:408-414` (`onMove` writes `inst.h` then calls `position`), `src/view.ts:202` (`position` always renders a collapsed card as 1 row), `src/view.ts:390-395` (`enableResize` runs for collapsed cards too)
- **What**: A collapsed card is rendered 1 row tall by `position()` (`inst.collapsed ? 1 : inst.h`), but the resize handle is still shown and `onMove` keeps writing to `inst.w` / `inst.h`. Those writes *are* persisted on `pointerup` (`src/view.ts:419`), so a resize performed while collapsed changes the widget's real height without any visible feedback.
- **Why it's wrong**: The user sees the widget stay one row high while dragging the corner; the size change only becomes visible later when the widget is expanded, at which point the widget is a different size than the user intended and has pushed its neighbours around (`resolveOverlaps` runs on `pointerup` too).
- **Trigger / repro**: `node bug-hunt/scratch-04-view/probe5.cjs`, section D4 (collapsed activity widget, edit mode, drag the corner down 3 rows):
  ```
  D4 rendered height while collapsed = "1"
  D4 inst.h while collapsed = 7
  D4 rendered height still = "1"
  D4 persisted inst.h = 7
  ```
- **Impact**: an invisible layout change is committed and saved; expanding the widget later shows an unexpected size and can overlap neighbours.
- **Evidence**: executed (output above)
- **Confidence**: high
- **Suggested fix**: don't create the resize handle when `inst.collapsed` (`enableResize` should return early), or compute the delta against `inst.collapsed ? 1 : inst.h` so the first drag step un-collapses visibly.

---

## BUG-07 — Number settings field rewrites empty and invalid input to the minimum instead of rejecting it
- **Severity**: medium
- **Where**: `src/view.ts:536-548` (`WidgetSettingsModal.addSetting`, `cfg.type === "number"`), specifically `src/view.ts:541-545`
- **What**: `const n = parseFloat(v); let val = Number.isFinite(n) ? n : (cfg.min ?? 0);` — an empty field (`parseFloat("") === NaN`) or unparsable text becomes `cfg.min`, then `commit()` saves it and re-renders the widget. The input element itself still shows what the user typed (it is not reset), so the field and the stored value disagree.
- **Why it's wrong**: Users clear a numeric field as the first step of typing a new value. Every intermediate state (empty, or a partially typed value that parses to something out of range, e.g. a leading `-`) is committed. The last committed keystrokes win, so tabbing away from a field the user left empty silently sets the setting to the minimum (e.g. *Weeks shown* → 4, *Max notes shown* → 3, *Number of notes* → 3), and the UI never says so.
- **Trigger / repro**: `node bug-hunt/scratch-04-view/probe5.cjs`, section D6 — open the settings gear of an activity widget (`weeks: 14`, `min: 4`) and feed the text control's change handler:
  ```
  D6 weeks=14, user types = [{"typed":"9","stored":9,"saved":9},
                             {"typed":"","stored":4,"saved":4},
                             {"typed":"abc","stored":4,"saved":4},
                             {"typed":"-99","stored":4,"saved":4}]
  ```
  (`saved` is the real `plugin.saveData()` payload, so this reaches disk.)
- **Impact**: silently destroyed setting values (the heatmap drops from 14 weeks to 4, etc.) with no way to tell what happened; the input keeps displaying the stale text.
- **Evidence**: executed (output above)
- **Confidence**: high
- **Suggested fix**: bail out while the field is empty/invalid and keep the previous value, clamping only real numbers:
  ```ts
  tb.onChange((v) => {
    if (v.trim() === "") return;                 // don't commit an empty step
    const n = parseFloat(v);
    if (!Number.isFinite(n)) return;
    let val = n;
    if (cfg.min !== undefined) val = Math.max(cfg.min, val);
    if (cfg.max !== undefined) val = Math.min(cfg.max, val);
    this.inst.settings[cfg.key] = val;
    commit();
  });
  ```
  Also reflect the clamped value back into the input (`tb.setValue(String(val))`) so field and state cannot diverge.
- **Confirmed**: no widget setting uses `cfg.type === "number"` with a value that legitimately needs to be zero/empty — all 8 numeric settings declare `min` >= 1 (`src/widgets/activity.ts:13`, `vaulttasks.ts:65,68`, `tools.ts:14,15`, `links.ts:42,75`, `content.ts:12,39`).

---

## BUG-08 — `refreshWidget()` re-renders a widget body but never re-applies its grid position
- **Severity**: low
- **Where**: `src/view.ts:265-271` (`refreshWidget`), versus `src/view.ts:198-203` (`position`, only called from `buildWidgetCard`); `WidgetSettingsModal.commit()` at `src/view.ts:561-564`
- **What**: `refreshWidget` replaces the card's body content but never calls `position(card, inst)`, so `--dash-cx/--dash-cy/--dash-cw/--dash-ch` keep their values from the last full `render()`.
- **Why it's wrong**: Any code path that mutates `inst.w` / `inst.h` / `inst.x` and then refreshes only the widget leaves the card drawn at the old size. Today that is reachable through `inst` object references held by the widget-settings modals (`src/view.ts:561-564` calls exactly `saveSettings()` + `refreshWidget`), so the invariant "card CSS vars == instance geometry" is not maintained by the refresh path. It is also the reason the collapsed-resize bug (BUG-06) is invisible: `position` is the only writer of `--dash-ch`, and the refresh path skips it.
- **Trigger / repro**: `node bug-hunt/scratch-04-view/probe6.cjs`, section R3:
  ```
  R3 --dash-cw before = "4"
  R3 --dash-cw after refresh (inst.w=9) = "4"
  R3 --dash-ch after refresh (inst.h=2) = "4"
  R3 body re-rendered = 1
  ```
  (the body is re-rendered — the heatmap count is 1 — while the size variables stay at the old values.)
- **Impact**: a size change applied through a per-widget editor is not visible until an unrelated full render; the card and the stored layout disagree in the meantime.
- **Evidence**: executed (output above)
- **Confidence**: high for the mechanism; medium for "user-visible today" (no shipped `WidgetSetting` currently changes geometry — the reachable route is `inst` mutation + refresh, and BUG-06 depends on it)
- **Suggested fix**: add `const card = …; if (card) this.position(card, inst);` to `refreshWidget` before/after `renderWidgetBody`.

---

## BUG-09 — A widget that throws while rendering leaks the subscriptions it made before throwing
- **Severity**: low
- **Where**: `src/view.ts:255-262` (the `try` sets `handle` only when `type.render` returns; the `catch` renders the error boundary and then stores `{ dispose: handle.dispose }` = `undefined`), with `src/view.ts:36-40` (`onClose` → `disposeAll`) unable to recover
- **What**: The error boundary at `src/view.ts:258-260` catches render failures but permanently loses the widget's cleanup function. Any listener/timer/subscription the widget registered before the throw is now unreachable.
- **Why it's wrong**: The boundary exists precisely for widgets that fail, and one of the shipped widgets registers subscriptions inside `render()`: `src/widgets/backlinks.ts:58-61` calls `app.workspace.on("active-leaf-change", onLeaf)` and `app.metadataCache.on("changed", onMeta)`, and only returns the `dispose` that removes them at `backlinks.ts:63-68`. If anything after those two lines throws, both subscriptions leak, and the leaked `onLeaf`/`onMeta` handlers call `ctx.refresh()` → `renderWidgetBody` on a stale context for the life of the workspace.
- **Trigger / repro**: `node bug-hunt/scratch-04-view/probe6.cjs`, section R1 (widget's `render` throws after subscribing; # renders → live subscriptions):
  ```
  R1 subscriptions after 1 render = {"active-leaf-change":1,"meta":{"changed":[null]}}
  R1 subscriptions after 4 renders = {"active-leaf-change":5,"meta":{"changed":[null,null,null,null,null]}}
  R1 subscriptions after onClose = {"active-leaf-change":5,"meta":{"changed":[null,null,null,null,null]}}
  ```
  Compare section R2 (healthy path): `R2 subscriptions after 2 clean renders = 1` → `R2 subscriptions after onClose = 0`. So the framework itself is leak-free; only the throwing widget leaks, and `onClose` cannot help.
- **Impact**: a single failing widget permanently multiplies workspace/metadata-cache handlers; each leaf change then re-renders a widget that is showing the error placeholder, and the handlers survive closing the dashboard.
- **Evidence**: executed (output above)
- **Confidence**: medium (the leak is measured; today it needs a widget whose `render` throws after subscribing — `backlinks.ts` is exactly that shape, but the throw is injected in the probe)
- **Suggested fix**: let widgets report cleanup even on failure — either have `renderWidgetBody` keep the *previous* handle and hand the widget a `registerDispose()` on `ctx`, or wrap the body so that a partially built handle is still tracked; minimally, document that `WidgetType.render` must not subscribe before its last statement, and reorder `backlinks.ts` so `dispose` exists before any `on()` call.

---

## Checked and clean

Verified with the same compiled harness; no defect found:

- **Normal drag/resize teardown**: after a completed gesture the two `document` listeners are removed (`probe.cjs` T1: listeners 1 → 3 → 1). No leak on the happy path.
- **Widget interval disposal**: `render()` → `runCleanups()` + `disposeAll()` is correct — clock interval count stays flat over 10 consecutive renders and reaches 0 after `onClose()` (`probe2.cjs` T20: `[2,2] → 2 → 0`).
- **No document-level listeners added per render**: the only `document.addEventListener` calls in `src/` are `view.ts:350-351` and `423-424` (per-gesture, see BUG-01); nothing else in the plugin touches `document`/`window`.
- **Duplicate DOM after re-render**: `render()` empties `contentEl` first; exactly one card per layout entry, no duplicates (`probe2.cjs` T22: `clock widgets in DOM = 1`), and widget bodies re-render in place.
- **`refreshWidget` on a missing uid**: early-returns, no throw (`view.ts:266-267`).
- **Error boundary**: renders exactly one `.dash-widget-error` node with the message "This widget hit a snag — try again.", keeps the widget's chrome usable, and does not double-render the widget on repeated refreshes (`probe2.cjs` T24).
- **`placeInstance` overlap resolution**: 4000 random layouts (2-9 widgets, random x/y/w/h) put through the exact `placeInstance` code path leave **0** remaining overlaps (`probe4.cjs`), i.e. `resolveOverlaps`'s 50-iteration guard is not reachable from dragging. The 3037 reported "off-grid" entries are cases where the *input* layout (pre-drag) already had widgets wider than the remaining columns — dragging never creates the condition.
- **Resize clamps**: width is clamped to `[min.w, min(maxW, columns - x)]` and height to `[min.h, maxH]`; no negative or off-grid result was reachable, including a widget at `x=8` (`probe7.cjs` C4/C5) and a widget with no declared `min`/`max` (`C1`).
- **Widget settings are per-instance**: two `activity` widgets with `weeks` 14 and 4 stay independent through the modal (`probe3.cjs` T32); no shared-state widget type found (`habits`/`quickactions`/`pinned` rebuild their arrays on render/commit).
- **Removing a widget while its settings modal is open**: the modal's later commits write only to the detached instance; `saveData()` payload contains only the surviving widgets (`probe5.cjs` D7: layout length 0, settings `[]`).
- **Add-widget placement**: `plugin.addWidget` inserts with no overlap and never off-grid (`probe6.cjs` R4); adding to an empty layout gives `(0,0)` (R6); the "+/Add widget" modal is only reachable when `editMode` is on.
- **Control bar with an empty vault / no active file**: 22 widgets render with 0 error nodes and every control-bar button click is safe (`probe6.cjs` R5).
- **Cancel-edit snapshot**: restores the exact pre-edit layout array and exits edit mode (`view.ts:148-158`).
- **XSS/text safety in this area**: no `innerHTML`/`insertAdjacentHTML`/`outerHTML` anywhere in `src/`; titles, names and messages use `setText`/`createDiv(...).setText` (`view.ts:105-112, 212, 260`).
- **Detached-instance mutation**: finishing an orphaned drag after the widget was deleted mutates only the detached object — `saveData()` payload is unaffected (`probe7.cjs` C3).
- **`noHeader` + collapse**: collapse is only offered for headered widgets (correct); the only `noHeader` type is `clock` (`src/widgets/clock.ts:10`).
- **Modal accessibility basics**: control-bar buttons carry `aria-label`s (`view.ts:124, 129, 135, 151, 161`), the collapse chevron too (`view.ts:215`), and no listener exception escapes a control-bar click.
