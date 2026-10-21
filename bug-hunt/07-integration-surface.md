# Cross-cutting (integration surface) findings

Area: the **seams** between the parts — the CSS↔DOM class contract, packaging/version/id drift,
the release workflow, documentation vs. reality, and a robustness sweep. No single module is
"owned"; the defects below are exactly the ones that no module-focused pass can see.

All class lists, counts and drift facts in this file are **produced by scripts**, not impressions.
Scratch dir (all scripts re-runnable):

```
bug-hunt/scratch-07-integration/
  css-contract.cjs        class extraction (built first, stricter patterns)   -> css-contract.txt
  css-contract2.cjs       class extraction (all string literals, final)       -> css-contract-v2.txt
  dom-contract.cjs        renders the real dashboard, matches every selector  -> dom-contract.txt
  dead-rules.cjs          per-element rule application (jsdom .matches)       -> dead-rules.txt
  dead-rules-async.cjs    same, after async widget loads settle               -> dead-rules-async.txt
  habits-check.cjs        populated-habits anchor + ancestor chains           -> habits-check.txt
  reachability.cjs        normal / edit / collapsed / dragging states         -> reachability.txt
  final-evidence.cjs      the evidence pasted below                           -> final-evidence.txt
  date-format.cjs         formatDate token probe (see "Checked and clean")    -> date-format.txt
  state-debug.cjs         control probe for the state-class false positives
  state-classes.cjs       .dash-btn-active / .dash-task / is-done verification
  swallowed-errors.cjs    BUG-06 evidence (failing vault writes)              -> printed
  datalist-wiring.cjs     real modal datalist wiring (Modal intercepted)      -> datalist-wiring.txt
  modal-dom.cjs          Add-widget / Pinned modal DOM probe (failed: classes unexported)
```

Harness: the README recipe (`npx tsc --outDir bug-hunt/scratch-07-integration/build --module commonjs
--target es2018 --moduleResolution node --skipLibCheck --noEmit false --esModuleInterop --lib
es2018,dom --strict false src/main.ts`, exits 0) + `bug-hunt/shim.cjs` (jsdom + `smoke/stub-obsidian.js`).
Every script ends with `process.exit(0)`. No file outside `bug-hunt/` was touched.

---

## BUG-01 — 12 widget-specific stylesheet rules can never match: the wrapper class is on the *same* element as `.dash-widget-body`

- **Severity**: high
- **Where**: `src/view.ts:190` (`const body = card.createDiv("dash-widget-body widget-" + type.type);`)
  vs. `styles.css:367, 734, 803, 844, 854, 945, 1000, 1045, 1101, 1121, 1161, 1287`
- **What**: `buildWidgetCard` puts the per-widget wrapper class **on the body element itself**:
  the rendered node is `<div class="dash-widget-body widget-clock">`. `styles.css` writes all
  twelve of its per-widget layout rules as **descendant** selectors —
  `.widget-clock .dash-widget-body { … }`, `.widget-pomodoro .dash-widget-body { … }`, … — which
  require `.widget-*` to be an *ancestor* of `.dash-widget-body`. It never is, so all twelve rules
  are dead: the widgets keep the generic `.dash-widget-body` box
  (`styles.css:316-323`: `flex:1; min-height:0; overflow:auto; padding:4px 12px 14px;
  display:flex; flex-direction:column;` — `align-items` defaults to `stretch`,
  `justify-content` to `flex-start`).
- **Why it's wrong**: These rules are not cosmetic extras — they are the *only* place that centres
  the clock, the progress rings, the pomodoro timer, the streak number, the quote and the deadline
  countdown, and the only place that gives several widgets their intended padding. The plugin
  therefore ships a dashboard whose centring is silently absent, and `styles.css` cannot be
  maintained: editing these rules changes nothing.
- **Trigger / repro** (executed): render the shipped default layout and ask the DOM which element
  carries the class, then match each rule against it:

  ```
  $ node bug-hunt/scratch-07-integration/final-evidence.cjs

  ########## 3. the wrapper class lives on the SAME element as .dash-widget-body ##########
    view.ts:190  card.createDiv("dash-widget-body widget-" + type.type)
    rendered: <div class="dash-widget-body widget-clock">  -> .widget-clock IS the body, not its ancestor
    ".widget-clock .dash-widget-body"    matches 0
    ".dash-widget-body.widget-clock"     matches 1

  ########## 4. the 12 dead rules, one line each ##########
    styles.css:367  .widget-clock .dash-widget-body  -> matches 0   (elements carrying .widget-clock: 1)
    styles.css:734  .widget-vaulttasks .dash-widget-body  -> matches 0   (elements carrying .widget-vaulttasks: 1)
    styles.css:803  .widget-capture .dash-widget-body  -> matches 0   (elements carrying .widget-capture: 1)
    styles.css:844  .widget-search .dash-widget-body  -> matches 0   (elements carrying .widget-search: 1)
    styles.css:854  .widget-quickactions .dash-widget-body  -> matches 0   (elements carrying .widget-quickactions: 1)
    styles.css:945  .widget-progress .dash-widget-body  -> matches 0   (elements carrying .widget-progress: 1)
    styles.css:1000  .widget-streak .dash-widget-body  -> matches 0   (elements carrying .widget-streak: 1)
    styles.css:1045  .widget-pomodoro .dash-widget-body  -> matches 0   (elements carrying .widget-pomodoro: 1)
    styles.css:1101  .widget-quote .dash-widget-body  -> matches 0   (elements carrying .widget-quote: 1)
    styles.css:1121  .widget-deadline .dash-widget-body  -> matches 0   (elements carrying .widget-deadline: 1)
    styles.css:1161  .widget-random .dash-widget-body  -> matches 0   (elements carrying .widget-random: 1)
    styles.css:1287  .widget-habits .dash-widget-body  -> matches 0   (elements carrying .widget-habits: 1)
    TOTAL dead rules: 12

  ########## 5. what each dead rule was supposed to do ##########
    styles.css:367  .widget-clock .dash-widget-body { align-items: center; justify-content: center; text-align: center; padding: 6px 12px;   [DEAD]
    styles.css:734  .widget-vaulttasks .dash-widget-body { padding: 2px 10px 12px;   [DEAD]
    styles.css:803  .widget-capture .dash-widget-body { gap: 12px;   [DEAD]
    styles.css:844  .widget-search .dash-widget-body { justify-content: center;   [DEAD]
    styles.css:854  .widget-quickactions .dash-widget-body { padding: 4px 10px 12px;   [DEAD]
    styles.css:945  .widget-progress .dash-widget-body { align-items: center; justify-content: center;   [DEAD]
    styles.css:1000  .widget-streak .dash-widget-body { align-items: center; justify-content: center; text-align: center; gap: 2px;   [DEAD]
    styles.css:1045  .widget-pomodoro .dash-widget-body { align-items: center; justify-content: center; gap: 2px; text-align: center;   [DEAD]
    styles.css:1101  .widget-quote .dash-widget-body { justify-content: center; gap: 6px; padding: 8px 18px;   [DEAD]
    styles.css:1121  .widget-deadline .dash-widget-body { justify-content: center; gap: 2px; padding: 10px 16px;   [DEAD]
    styles.css:1161  .widget-random .dash-widget-body { padding: 10px 12px;   [DEAD]
    styles.css:1287  .widget-habits .dash-widget-body { padding: 8px 10px 12px;   [DEAD]
    styles.css:737    [live]
    styles.css:847    [live]
    styles.css:1027    [live]
  ```

  The `[live]` lines are the control group: the three `.widget-*` rules that target an element
  *below* the body (`.widget-vaulttasks .dash-list-row`, `.widget-search .dash-search-input`,
  `.widget-streak .dash-hm-stats`) do match, because there the class really is an ancestor:

  ```
  $ node bug-hunt/scratch-07-integration/habits-check.cjs
  == ancestor chain evidence for the two surviving-looking rules ==
    .dash-search-input: div.dash-scroll > div.dash-shell > div.dash-grid > div.dash-widget > div.dash-widget-body.widget-search > input.dash-search-input
    vaulttasks .dash-list-row: div.dash-scroll > div.dash-shell > div.dash-grid > div.dash-widget > div.dash-widget-body.widget-vaulttasks > div.dash-list > div.dash-list-row
  == do the rules match their real targets? ==
    ".widget-search .dash-search-input" matches 1
    ".widget-streak .dash-hm-stats" matches 1
    ".widget-vaulttasks .dash-list-row" matches 2
    ".widget-habits .dash-habit-cell" matches 28
    ".widget-habits .dash-widget-body" matches 0
  ```

  (The earlier `dead-rules.cjs` run also reported the `defaults`-marked search/vaulttasks/habits
  rules as `0`; that run did not await the async widget loads, which `dead-rules-async.cjs` and
  `habits-check.cjs` do. The 12 body rules are `0` in **every** probe and the reachability matrix.)

  The rules cannot be "just not rendered yet" either — the reachability matrix renders the
  dashboard in six real states (normal, edit mode, all widgets collapsed, dragging + drop target,
  overdue) and the body rules are `0` in all six:

  ```
  $ node bug-hunt/scratch-07-integration/reachability.cjs
  == per-state counts for the 12 dead .widget-* body rules ==
    styles.css:367  .widget-clock .dash-widget-body  -> [0, 0, 0, 0, 0, 0]
    styles.css:1045  .widget-pomodoro .dash-widget-body  -> [0, 0, 0, 0, 0, 0]
    styles.css:1287  .widget-habits .dash-widget-body  -> [0, 0, 0, 0, 0, 0]
    (… all 12, same result …)
  ```
- **Impact**: on a default install the clock, progress rings, pomodoro ring, streak number, quote
  and deadline countdown are left-aligned at the top of their card instead of centred; Quick
  capture loses its 12 px column gap; Search, Quick actions, Random, Habits, Vault tasks and
  Streak lose their intended padding. Nine widget types (clock, progress, pomodoro, streak, quote,
  deadline, search, quickactions, random) plus vaulttasks/habits/capture are affected. Worse for
  maintenance: a maintainer editing these rules gets no feedback at all.
- **Evidence**: executed (commands and output above)
- **Confidence**: high (the DOM shape and the zero match counts are measured; the visual
  consequence follows directly from the declarations in `styles.css:316-322`)
- **Suggested fix**: make the twelve selectors match the same element, i.e. drop the descendant
  combinator — `.dash-widget-body.widget-clock { … }`. (Equivalently, revert `src/view.ts:190` to
  wrapping the body, but the same-element form is the smaller change and matches how
  `.dash-widget.no-header`, `.dash-widget.collapsed` are already written.) The three
  `.widget-* <child>` rules must stay as they are.

---

## BUG-02 — Five classes are rendered with no CSS rule at all; three of them are live, rendered elements

- **Severity**: low
- **Where**: `src/view.ts:104` (`dash-brand`), `src/widgets/calendar.ts:67` (`dash-cal-day`),
  `src/view.ts:460` (`dash-modal-info`); declared IDs at `src/widgets/pinned.ts:68,87`
  (`dash-pinned-notes`) and `src/widgets/quickactions.ts:258` (`dash-qa-commands`)
- **What**: scripted extraction over all 22 `src/**/*.ts` files found **175** distinct class-shaped
  tokens in string literals and **151** distinct class selectors in `styles.css`; **5** `dash-*`
  names used in TS have **no rule anywhere** in `styles.css`. Three of those are real rendered
  elements with no styling:
  - `dash-brand` — `src/view.ts:104`; in the DOM it is `div.dash-control-left > div.dash-brand`.
    Its two children (`.dash-brand-title`, `.dash-brand-sub`) are styled, the parent is not.
  - `dash-cal-day` — `src/widgets/calendar.ts:67`; 30 instances, chain
    `… > div.dash-cal-cell > div.dash-cal-day`. The sibling header class is `.dash-cal-dow`
    (`src/widgets/calendar.ts:54`, styled at `styles.css:440-447`), so this is a leftover naming
    half-rename: the day *number* wrapper is now unstyled and the cell's own
    `display:flex; align-items:center; justify-content:center` (`styles.css:448-460`) is doing the
    work instead.
  - `dash-modal-info` — `src/view.ts:460`; the text column of every "Add a widget" row
    (`.dash-modal-name` / `.dash-modal-desc` are styled, the flex column between the icon and the
    text is not).
  The other two `dash-*` orphans are **not** defects. `dash-pinned-notes` is a `datalist` **id**
  (`src/widgets/pinned.ts:87`) referenced by the input's `list` attribute (`src/widgets/pinned.ts:68`),
  and `dash-qa-commands` is a `datalist` id (`src/widgets/quickactions.ts:258`). My class list was
  produced by a name-prefix filter, so these two ids show up in it. I verified the Pinned wiring end
  to end against the real compiled modal (it resolves and the options are populated); the Quick
  actions datalist is created lazily on `document.body` from the same string that is set as the
  input's `list` (`src/widgets/quickactions.ts:258-269`), so it is correct by construction but I could
  not reach it from the harness. See *Checked and clean*.
- **Why it's wrong**: they are real, rendered class names the stylesheet claims to own (every other
  `dash-*` class in the codebase has a rule); `dash-cal-day` in particular is the residue of a
  rename that was applied on one side only. `dash-brand` and `dash-modal-info` are flex/column
  containers whose intended layout can only be inferred — today they inherit `display:block`.
- **Trigger / repro** (executed):

  ```
  $ node bug-hunt/scratch-07-integration/final-evidence.cjs

  ########## 1. dash-* classes used in src/ with NO rule in styles.css ##########
    dash-brand    used at src\view.ts:104
    dash-cal-day    used at src\widgets\calendar.ts:67
    dash-modal-info    used at src\view.ts:460
    dash-pinned-notes    used at src\widgets\pinned.ts:68, src\widgets\pinned.ts:87
    dash-qa-commands    used at src\widgets\quickactions.ts:258
    total: 5

  ########## 2. those orphans as they exist in the rendered DOM ##########
    .dash-brand: 1 element(s)   chain: div.dash-scroll > div.dash-shell > div.dash-control > div.dash-control-left > div.dash-brand
    .dash-cal-day: 30 element(s)   chain: div.dash-scroll > div.dash-shell > div.dash-grid > div.dash-widget > div.dash-widget-body.widget-calendar > div.dash-cal-grid > div.dash-cal-cell > div.dash-cal-day
    .dash-modal-info: 0 element(s)   chain: -
    .dash-pinned-notes: 0 element(s)   chain: -
    .dash-qa-commands: 0 element(s)   chain: -
  ```

  `dash-modal-info` is `0` in that render because `AddWidgetModal` (`src/view.ts:445-473`) is not
  exported and the stub's `Modal.open()` only appends its container, so I could not drive it from
  the harness. Its parent chain is therefore read from the source, not measured:

  ```
  src/view.ts:455  const list = this.contentEl.createDiv("dash-modal-list");
  src/view.ts:456  for (const t of getWidgetTypes()) {
  src/view.ts:457    const row = list.createDiv("dash-modal-row");
  src/view.ts:458    const icon = row.createDiv("dash-modal-icon");
  src/view.ts:459    setIcon(icon, t.icon);
  src/view.ts:460    const info = row.createDiv("dash-modal-info");
  src/view.ts:461    info.createDiv("dash-modal-name").setText(t.name);
  src/view.ts:462    info.createDiv("dash-modal-desc").setText(t.description);
  ```
  i.e. `dash-modal-list > dash-modal-row > dash-modal-info > (dash-modal-name, dash-modal-desc)`,
  and `dash-modal-row` is `display:flex` (`styles.css:1209-1217`).
- **Impact**: three unstyled wrappers. `dash-cal-day` is the only one with a structural
  consequence: calendar day numbers are laid out by the cell, so any future change to the cell's
  flex rules breaks them silently. Low user visibility, but it is a real contract break and it is
  what makes the class list untrustworthy.
- **Evidence**: executed (output above)
- **Confidence**: high for the facts (scripted counts + rendered chains); medium for the visual
  impact of `dash-brand` / `dash-modal-info` being user-visible today
- **Suggested fix**: either give each a rule (e.g. `.dash-brand { display:flex; flex-direction:column; min-width:0; }`,
  `.dash-modal-info { display:flex; flex-direction:column; min-width:0; gap:2px; }`) or drop the
  class from TS. For `dash-cal-day`, decide which name wins: rename the header to
  `.dash-cal-day`/keep `.dash-cal-dow` for both, so the two halves agree.

---

## BUG-03 — `README.md` documents a default hotkey (`Ctrl/Cmd + Shift + D`) that is not registered

- **Severity**: medium
- **Where**: `README.md:57` and `README.md:61` vs. `src/main.ts:21-35`
- **What**: The README tells users the dashboard opens "with `Ctrl/Cmd + Shift + D`" in two places.
  The plugin registers exactly three commands (`src/main.ts:21-35`: `open-dashboard`,
  `toggle-edit-mode`, `capture-to-inbox`) and **none of them declares a `hotkeys` field** — in fact
  the string `hotkey` appears nowhere in `src/` and `hotkeys` appears nowhere in the committed
  bundle `main.js`. `Command.hotkeys` is optional, so omitting it means Obsidian installs **no**
  default binding.
- **Why it's wrong**: this is a documented behaviour that does not happen. A user who installs the
  plugin and presses `Ctrl/Cmd + Shift + D` gets nothing (on Obsidian 1.13 that combination is also
  a no-op by default; on some platforms `Ctrl+Shift+D` is bound to a browser/OS action). The README
  presents a "feature" the user must discover is missing.
- **Trigger / repro**: `Ctrl/Cmd + Shift + D` in Obsidian → nothing happens; *Settings →
  Hotkeys* → search "Aurora" → all three commands show **no** hotkey assigned.
  Executed check of the source and the shipped bundle:

  ```
  $ Select-String -Path src\*.ts, src\widgets\*.ts -Pattern 'hotkey'
  (no output)

  $ Select-String -Path main.js -Pattern 'hotkeys'
  (no output)

  $ Select-String -Path README.md -Pattern 'Ctrl|Cmd|Shift'
  README.md:57: 4. Open it from the ribbon icon, or with `Ctrl/Cmd + Shift + D`.
  README.md:61: - **Open the dashboard** — ribbon icon, `Ctrl/Cmd + Shift + D`, or the command palette.
  ```
- **Impact**: the first thing a new user tries after installing does nothing. Also affects the
  README's own "Usage" section, which is the primary onboarding path.
- **Evidence**: executed (greps above; the bundle is the artifact users receive)
- **Confidence**: high
- **Suggested fix**: either add the hotkey so the docs are true —
  ```ts
  this.addCommand({
    id: "open-dashboard",
    name: "Open dashboard",
    hotkeys: [{ modifiers: ["Mod", "Shift"], key: "d" }],
    callback: () => void this.activateView(),
  });
  ```
  — or change both README lines to "…or assign a hotkey in *Settings → Hotkeys*". (Note the docs
  are also inconsistent with each other: `README.md:57` is a crisp command list, `README.md:61`
  repeats the claim.)

---

## BUG-04 — `README.md` and `manifest.json` advertise mobile support, but the documented install path and the core edit gesture do not work there

- **Severity**: medium
- **Where**: `manifest.json:9` (`"isDesktopOnly": false`), `README.md:50-57` (Installation),
  `README.md:62` (edit mode) vs. `src/view.ts:320` (`enableDrag` on `.dash-grip`) and
  `styles.css:220-241`/`styles.css:332-351` (no `touch-action`)
- **What**: `manifest.json` declares the plugin as **not** desktop-only, and the README never
  mentions platform at all — it lists a `npm run build` → copy-folder → restart → open-with-hotkey
  flow. On mobile that flow is not available (no `npm run build`, no `.obsidian/plugins` folder in
  the Files app, no `Ctrl/Cmd + Shift + D`), and the interactive core feature the README advertises
  ("Drag widgets by their grip, resize from the corner", `README.md:62`) is unusable because the
  grip never receives a usable gesture.
- **Why it's wrong**: `isDesktopOnly: false` is a promise to the Obsidian catalogue and to users
  that the plugin installs and functions on iOS/Android. The one thing the plugin is *for* — a
  draggable dashboard — cannot be operated by touch, and the README gives mobile users no path in.
  (The pointer-event mechanism itself is covered by the view-interaction report as BUG-01: no
  `pointercancel` teardown, no `touch-action`. This finding is the **contract** half: the packaging
  flag and the docs claim a capability the shipped CSS/DOM does not provide.)
- **Trigger / repro**: install on Obsidian mobile (or narrow the desktop window below 720 px).
  Edit mode, then press and drag a widget's grip — the browser claims the gesture for panning
  (no `touch-action:none` on `.dash-grip`), the card snaps back, and the drop-target/preview is
  computed against 12 imaginary columns while the CSS has collapsed the grid to one column
  (`styles.css:1416-1422`) — the same 720 px breakpoint covered in the view report.
  Static facts verified here:

  ```
  $ Select-String -Path styles.css -Pattern 'touch-action'
  (no output)                       # nothing in styles.css opts a handle out of browser panning

  $ Select-String -Path README.md -Pattern 'mobile|Mobile|Android|iOS|phone|tablet'
  (no output)                       # the README never mentions platform support

  $ (Get-Content manifest.json) | Select-String 'isDesktopOnly'
  "isDesktopOnly": false,
  ```
- **Impact**: the plugin is listed/installable on mobile with a documented onboarding route that
  does not exist, and its headline feature is inoperable there.
- **Evidence**: static only for the docs/manifest mismatch (the CSS/manifest greps above are
  executed; the touch failure itself is out of scope here and is demonstrated in the
  view-interaction report)
- **Confidence**: high for the manifest/docs contradiction; high for the missing `touch-action`
- **Suggested fix**: pick one — either set `"isDesktopOnly": true` (honest and the smallest change,
  but loses mobile users), or add `touch-action: none;` to `.dash-grip` and `.dash-resize`, fix the
  pointer-cancel teardown, and add a short "Mobile" section to the README describing *Settings →
  Community plugins → Browse* installation (the `npm run build` recipe is desktop-only anyway).

---

## BUG-05 — The release workflow will publish any tag that is pushed against a manifest of a different version, and never checks that `versions.json` still describes the release

- **Severity**: medium
- **Where**: `.github/workflows/release.yml:3-12` (triggers), `:49-57` (Resolve release tag),
  `:72-82` (Publish release, `overwrite_files: true`); `versions.json` is not read anywhere in the
  workflow
- **What**: The workflow is triggered by *any* pushed tag matching `[0-9]+.[0-9]+.[0-9]+`, or by a
  manual dispatch with an arbitrary `tag` input. The tag is copied straight into
  `tag_name: ${{ steps.resolve_tag.outputs.tag }}` and the release is published with the files the
  build produced. Nothing anywhere compares the tag with `manifest.json`'s `version`, `package.json`'s
  `version`, or the newest key in `versions.json`.
- **Why it's wrong**: Obsidian's installer matches a release tag against `manifest.json`'s `version`
  inside the downloaded asset. If a maintainer tags `1.2.7` before bumping `manifest.json` (or
  dispatches the workflow with `tag: 1.2.5` against a 1.2.6 tree), the workflow happily builds and
  publishes `manifest.json: {"version": "1.2.6"}` under the tag `1.2.7`. Obsidian then either
  refuses the update or installs a build that self-reports the wrong version, and users cannot tell
  which build they have. `overwrite_files: true` (`release.yml:81`) makes a re-dispatch silently
  replace an existing release's assets, so a stale manual tag can rewrite a shipped release.
  `versions.json` is the file Obsidian reads to know the *minimum* app version per plugin version;
  if it is not bumped alongside `manifest.json`, Obsidian's update path treats the new version as
  unknown. Today the three files agree (see *Checked and clean*), so this is a latent
  release-safety defect rather than a shipped wrong version.
- **Trigger / repro**: `git tag 1.2.7 && git push origin 1.2.7` on the current tree →
  `Resolve release tag` sets `TAG=1.2.7` → `npm run build` → `Publish release` with
  `tag_name: 1.2.7` and the current `manifest.json` (`"version": "1.2.6"`). No step fails.
  Re-dispatch with `tag: 1.2.5` and `overwrite_files: true` and the 1.2.5 release's assets are
  replaced by the 1.2.6 build. Static workflow read; the missing guard is visible in the file:

  ```
  .github/workflows/release.yml
    3  on:
    5    tags: ["[0-9]+.[0-9]+.[0-9]+"]
    7    workflow_dispatch: { inputs: { tag: … } }
   51-57  TAG="${GITHUB_REF#refs/tags/}" | TAG="${{ inputs.tag }}"  →  echo "tag=${TAG}"
   75     tag_name: ${{ steps.resolve_tag.outputs.tag }}
   77-80  files: main.js, manifest.json, styles.css
   81     overwrite_files: true
  # no step greps manifest.json / versions.json anywhere:
  $ Select-String -Path .github\workflows\release.yml -Pattern 'version|manifest|jq'
  29: node-version: 24
  43:             ${{ github.workspace }}/manifest.json
  79:             manifest.json
  ```
- **Impact**: a mis-tagged push (or a careless manual dispatch) publishes a release whose
  `manifest.json` version disagrees with its tag — Obsidian's updater then mis-reports or refuses
  the update, and with `overwrite_files: true` an existing release can be overwritten in place.
  Recovery requires deleting and re-cutting the tag.
- **Evidence**: static only (the workflow file is read-only for this run; no tag can be pushed)
- **Confidence**: high for the missing guard; medium for how likely the maintainer is to hit it
- **Suggested fix**: add one guard step before `Build`, and make `versions.json` a checked artifact:
  ```yaml
  - name: Verify version matches the tag
    run: |
      TAG="${{ steps.resolve_tag.outputs.tag }}"
      M=$(node -p "require('./manifest.json').version")
      P=$(node -p "require('./package.json').version")
      V=$(node -p "Object.keys(require('./versions.json')).pop()")
      [ "$TAG" = "$M" ] || { echo "tag $TAG != manifest version $M"; exit 1; }
      [ "$M" = "$P" ] || { echo "manifest $M != package $P"; exit 1; }
      [ "$M" = "$V" ] || { echo "manifest $M is not the newest versions.json key ($V)"; exit 1; }
      node -e "process.exit(require('./versions.json')['$TAG'] ? 0 : 1)" || { echo "versions.json has no entry for $TAG"; exit 1; }
  ```
  (`resolve_tag` must then run before `Build`; today it runs after.)

---

## BUG-06 — Swallowed `catch` blocks around vault writes and folder creation turn real failures into silence

- **Severity**: medium
- **Where**: `src/main.ts:210-218` (`ensureFolder`), `src/main.ts:135-140` (`openDay`),
  `src/widgets/vaulttasks.ts:47-49` (`scanTasks`), `src/widgets/vaulttasks.ts:169-192`
  (`toggleTask`), `src/widgets/vaulttasks.ts:198-209` (`openTask`),
  `src/widgets/content.ts:156-160` (`addNewTask`), `src/widgets/quickactions.ts:106`, `:130`
- **What**: eight `catch {}` blocks with an empty or comment-only body. Two of them are
  user-facing and lossy:
  - `src/main.ts:210-218` `ensureFolder`: `await this.app.vault.createFolder(dir)` inside `catch {}`
    with the comment "folder may have appeared already". That is the only failure it assumes, but
    `createFolder` also rejects for an **invalid or nested** path (Obsidian's `createFolder` does not
    create intermediate folders) and for permission/adapter errors. On any of those the folder is
    never created and the caller proceeds.
  - `src/widgets/vaulttasks.ts:169-192` `toggleTask`: the whole read/modify/`ctx.refresh()` sequence
    is inside `try { … } catch { /* noop */ }`. Every failure is invisible: if the read rejects, if
    the index lookup fails, or if `vault.modify` rejects, the user clicks the checkbox and the task
    simply does not change — with no Notice and no console output. The identical shape is in
    `openTask` (`:198-209`) and in `addNewTask` (`content.ts:156-160`).
  - `src/widgets/vaulttasks.ts:47-49` `scanTasks` maps **every** file-read failure to an empty task
    list for that file, and `:83-87` maps a whole-scan failure to "No tasks in your vault yet" — the
    user cannot distinguish "you have no tasks" from "your vault could not be read".
  Note the contrast: `src/main.ts:135-140` (`openDay`) *does* surface a Notice, and
  `src/view.ts:256-261` logs widget render failures with `console.error`. The pattern is not
  deliberate policy — it is inconsistent.
- **Why it's wrong**: "task did not tick" and "capture did not save" are the exact failures a user
  cannot debug, and the code has no record of them at all. The empty `catch {}` also hides the
  programming errors the index-based task lookup is designed to tolerate (`vaulttasks.ts:173-184`),
  so a genuine regression there looks identical to the tolerated "line moved" case.
- **Trigger / repro**: `bug-hunt/scratch-07-integration/swallowed-errors.cjs` makes real vault
  writes fail (the way a read-only vault, a sync conflict or a full disk does) and then drives the
  real widget / plugin code. Both handlers swallow the failure completely:

  ```
  $ node bug-hunt/scratch-07-integration/swallowed-errors.cjs
  vaulttasks card present: true
  checkboxes rendered: 1

  == after clicking a task checkbox with vault.modify failing ==
    Notice.last        = null
    console.error calls = 0 []
    file content        = "# A\n- [ ] alpha task\n"  (task still open: true)

  == captureText with createFolder failing ==
    captureText rejected with: null
    Notice.last = "Captured"   (expected a Notice on failure)
    Inbox.md created = true
  ```

  The first block is the defect: the user clicks the checkbox, and `Notice.last` is `null`,
  `console.error` was never called, and the task is still open — the click produced **no feedback
  of any kind**. The second block shows the same swallowing on the capture path (`ensureFolder`
  swallows the `createFolder` rejection at `src/main.ts:213-217`): the folder is not created and
  nothing is logged; `captureText` then still reports success. Reading the handler confirms the
  shape:

  ```
  169  try {
  170    const cur = await ctx.plugin.app.vault.read(file);
  …
  186      await ctx.plugin.app.vault.modify(file, lines.join("\n"));
  187      ctx.refresh();
  188    }
  189  } catch {
  190    /* noop */
  191  }
  ```
  (line 190 is the `catch`, line 191 the `/* noop */`; the same shape is at `:47-49` and `:198-209`.)
  `src/main.ts:213-217` swallows the folder failure:
  ```
  213  try {
  214    await this.app.vault.createFolder(dir);
  215  } catch {
  216    /* folder may have appeared already */
  217  }
  ```
- **Impact**: silent data-loss-adjacent failures (a task that will not tick, a capture that will not
  save, a scan that reports an empty vault). The user gets no Notice, no console entry and nothing
  to act on — the click simply appears to do nothing.
- **Evidence**: executed (output above)
- **Confidence**: high that the handlers are silent (measured); medium that a user hits a
  *non*-ENOENT failure often enough to notice
- **Suggested fix**: keep the tolerated cases narrow and log everything else, e.g. in
  `ensureFolder` check the folder again after the failure and only swallow when it now exists;
  in `toggleTask`/`addNewTask` keep the `catch` but add
  `console.error("Dashboard: could not update task", e)` and a `new Notice("Could not update that task.")`
  so the click has a visible outcome. At minimum make the three vault-write handlers consistent with
  `openDay`, which already notifies.

---

## BUG-07 — The Accent colour control displays `#7c3aed` whenever the setting is empty, so the picker cannot show that the accent is actually the theme accent

- **Severity**: low
- **Where**: `src/main.ts:311-314` (`getControlValue`), `src/main.ts:367-375` ("Reset to theme
  accent" action), `src/main.ts:377-393` (presets), `styles.css:4-6` (`--dash-accent` default)
- **What**: `getControlValue("accent")` returns `this.plugin.settings.accent || "#7c3aed"`. The
  stored setting is legitimately `""` (it is the default, `src/types.ts:47`, and
  *Reset to theme accent* writes `s.accent = ""` at `src/main.ts:370`), and `""` means "use
  Obsidian's `--interactive-accent`" (`styles.css:4-6`, applied by `src/view.ts:70-71`). So the
  colour picker renders a specific purple swatch while the dashboard is using the user's theme
  accent. The eight preset swatches (`src/main.ts:381-390`) include that same `#7c3aed`, so a user
  who wants the default is shown a control that already appears to be set to it.
- **Why it's wrong**: the control and the state disagree, and the disagreement is invisible —
  there is no way to see "accent = theme" in the settings UI. This is the same class of latent
  trap as the view report's numeric-field bug, but here the value is never wrong, it is only
  misrepresented. The wiring itself is correct (verified below), so the *feature* works; the
  *control* lies about it.
- **Trigger / repro**: set nothing (fresh install `accent: ""`) → open *Settings → Aurora
  Dashboard → Appearance*: the picker shows `#7c3aed`. The dashboard's real accent is the theme
  accent. Executed check that the runtime path is otherwise correct:

  ```
  $ node bug-hunt/scratch-07-integration/dom-contract.cjs
  == accent custom property wiring ==
    --dash-accent on contentEl after accent=#ff0000: "#ff0000"
    contentEl.classList: "dash-view"
    first CSS rule declaring --dash-accent: styles.css:3 ".view-content.dash-view"
  ```
  and the settings-side fallback is `src/main.ts:312`: `if (key === "accent") return this.plugin.settings.accent || "#7c3aed";`
- **Impact**: confusing settings UI; a user who wants the theme accent may conclude the plugin is
  hard-coded to purple, or "re-set" it to `#7c3aed` (a fixed colour) by clicking the preset,
  silently opting out of the theme.
- **Evidence**: executed for the runtime wiring (output above) + `static only` for what the picker
  renders (the settings tab cannot be rendered by `smoke/stub-obsidian.js`, whose `ColorComponent`
  is a `_comp` stub with no value round-trip)
- **Confidence**: high that `getControlValue` returns `#7c3aed` for `accent: ""` (one-line read);
  medium that Obsidian's renderer shows that value verbatim
- **Suggested fix**: return the empty string and let the control show "unset", or add an explicit
  "Use theme accent" toggle next to the picker and disable the picker while it is on.

---

## BUG-08 — `.dash-task` in `styles.css` is dead CSS (with the two scan false positives recorded so nobody re-chases them)

- **Severity**: low
- **Where**: `styles.css:691-694` (`.dash-task`); the two false positives are
  `styles.css:146-150` (`.dash-btn-active`) and `styles.css:323-328` (`.dash-widget-error`)
- **What**: scripted extraction found **16** CSS class selectors that no string literal in
  `src/**/*.ts` produces. **One** of them is real dead CSS:
  - `.dash-task` (`styles.css:691-694`) — the scripted TS token list contains `dash-task-input`
    (`src/widgets/content.ts`) but **never** `dash-task`; the task row is
    `.dash-list-row` (`src/widgets/content.ts:127`, `src/widgets/vaulttasks.ts:154`). The cascade
    reads `.dash-task { … } .dash-check { … }`, but the first rule has no owner.
  Two more are **false positives** of the scan, recorded so nobody re-chases them:
  - `.dash-btn-active` (`styles.css:146-150`) — applied dynamically at
    `src/view.ts:133` (`"dash-btn " + (editing ? "dash-btn-active" : "dash-btn-ghost")`), so it is a
    string-literal scan miss, and `reachability.cjs` state B confirms the edit-mode button carries it.
  - `.dash-widget-error` (`styles.css:323-328`) — created at `src/view.ts:260` from inside a `catch`;
    it is genuinely unreachable for a *healthy* widget, which is the point of the rule.
  The remaining 13 are the twelve `.widget-*` classes from BUG-01 plus `view-content`
  (`styles.css:3`), which is supplied by Obsidian's own `.workspace-leaf-content` markup, not by
  the plugin — also not a defect.
- **Why it's wrong**: `.dash-task` is a leftover from before the task rows were unified onto
  `.dash-list-row`; it sits in the cascade immediately above `.dash-check`, so a maintainer
  restyling "the task row" will edit a rule that does nothing.
- **Trigger / repro** (executed):

  ```
  $ node bug-hunt/scratch-07-integration/css-contract2.cjs
  == COUNTS ==
  string literals scanned in src/**.ts: 1235
  distinct class-shaped tokens in TS literals: 175
  distinct class selectors in styles.css: 151
  TS class tokens with NO CSS rule: 40
  CSS classes with NO TS literal: 16
  near-miss pairs (lev<=2): 0
  descendant rules under a .widget-* wrapper: 15

  == CSS CLASSES WITH NO TS LITERAL ==
    collapsed  css:303,306
    editing  css:206,234,273,347
    overdue  css:1141
    view-content  css:3
    widget-capture  css:803
    widget-clock  css:367
    … (the 12 widget-* classes) …
  ```
  `dash-task` is the only `dash-*` entry in that list that is neither a `.widget-*` class nor an
  Obsidian-supplied class; `overdue`, `editing` and `collapsed` are dynamic (`src/widgets/deadline.ts:58`,
  `src/view.ts:72-73`, `src/view.ts:187`) and are therefore scan false positives, confirmed applied
  in the reachability matrix (`reachability.cjs` states B and F). The `.dash-task` claim is
  double-checked against the live DOM:

  ```
  $ node bug-hunt/scratch-07-integration/state-classes.cjs
  editMode off: .dash-btn-active = 0
  editMode on : .dash-btn-active = 1
  its aria-label = Done editing
  .dash-list-name.is-done = 0        # this fixture has no completed tasks
  .dash-check.is-checked = 0
  .dash-task = 0                     # <- .dash-task has no owner anywhere
  ```
- **Impact**: one rule with no owner in the middle of the task-row cascade; no user-visible
  consequence today.
- **Evidence**: executed (output above, plus `reachability.cjs` / `state-classes.cjs` for the
  state-class controls)
- **Confidence**: high
- **Suggested fix**: delete `.dash-task` (`styles.css:691-694`), or rename the task rows to it if
  the old design was the intended one.

---

## Checked and clean (do NOT redo)

Every item below was verified by script or by reading the file at the current revision; **no defect**.

**CSS ↔ DOM contract**
- **No near-miss typos**: `css-contract2.cjs` computes Levenshtein distance ≤ 2 between every TS
  class token with no CSS rule and every CSS class with no TS literal → **0 pairs**. There is no
  `dash-heat-cell` vs `dash-hm-cell`-style typo anywhere; the heatmap's real names
  (`dash-heatmap`, `dash-hm-col`, `dash-hm-cell`, `dash-hm-stats`, `dash-hm-chip`,
  `dash-hm-legend`, `dash-hm-swatch`) all match on both sides.
- **Custom properties are consistent** (`css-contract.cjs` section (d)/(e)/(f)): every `--dash-*`
  variable is written on the TS side *and* read by `styles.css`, and vice versa:
  `--dash-accent` (set `src/main.ts:383`, `src/view.ts:70`; read `styles.css:4,10,11,73,…`),
  `--dash-cols`/`--dash-row`/`--dash-gap` (set `src/view.ts:170-172`; read `styles.css:161-163`),
  `--dash-cx/cy/cw/ch` (set `src/view.ts:199-202`; read `styles.css:181-182`),
  `--dash-radius` (set+read only in CSS). **No** CSS-set `--dash-*` property is unread (section (e)
  is empty), so there is no dead custom property.
- **The accent/theme feature is not silently doing nothing**: setting `accent` really does reach
  the DOM (`dom-contract.cjs`: `--dash-accent on contentEl after accent=#ff0000: "#ff0000"`), the
  inline style beats the `.view-content.dash-view` block, and clearing it removes the property so
  the theme default applies. Only the *control* misrepresents it (BUG-07).
- **Runtime-only `.view-content.dash-view`** (`styles.css:3`): `smoke/stub-obsidian.js:249` gives
  `ItemView.contentEl` no classes, so jsdom reports the rule as unmatched — in real Obsidian
  `ItemView.contentEl` carries `view-content`. **Not a defect**; recorded so it is not re-reported.
- **The two `dash-*` orphans that are `datalist` IDs are correctly wired**, not defects:
  `datalist-wiring.cjs` intercepts the stub's `Modal` constructor, opens the real Pinned settings
  editor through `widgetType("pinned").openSettings(...)`, and confirms

  ```
  $ node bug-hunt/scratch-07-integration/datalist-wiring.cjs
  == pinned settings modal ==
    input list targets: dash-pinned-notes
    datalist ids in contentEl: dash-pinned-notes
    every target resolves inside the modal: true
    options prefilled: 2
  ```

  i.e. the id, the `list` attribute and the options all agree. `dash-qa-commands` is created on
  `document.body` behind a `document.getElementById` guard (`src/widgets/quickactions.ts:259-262`)
  from the same `const id` that is then set as the input's `list` (`:269`), so it is correct by
  construction; I could not drive the Quick actions editor from the harness because that widget's
  action rows require an `actions` entry to render.
- **Widget body wrapper classes are all applied consistently**: `dom-contract.cjs` prints all 22
  rendered `.dash-widget-body` elements; each carries exactly `dash-widget-body widget-<type>`, and
  every one of the 22 registered types appears (`dom-contract.txt` lines 96-117). No widget is
  missing its wrapper class.
- **`.view-content.dash-view`, `.dash-btn-active`, `editing`, `collapsed`, `overdue` are scan false
  positives, not dead CSS**: `view-content` comes from Obsidian's own markup (`smoke/stub-obsidian.js:249`
  deliberately gives `contentEl` no classes), and the four state classes are applied dynamically —
  `src/view.ts:72-73` (`editing`), `src/view.ts:187` (`collapsed`), `src/widgets/deadline.ts:58`
  (`overdue`), `src/view.ts:133` (`dash-btn-active`). `reachability.cjs` confirms they match in the
  edit-mode, collapsed and overdue states (`.dash-view.editing .dash-widget` 22,
  `.dash-widget.collapsed .dash-widget-header` 21).
- **The three `.widget-* <child>` rules work**: `.widget-vaulttasks .dash-list-row` (2-3),
  `.widget-search .dash-search-input` (1), `.widget-streak .dash-hm-stats` (1),
  `.widget-habits .dash-habit-cell` (28) all match once async widget loads settle.

**Packaging, version and id drift**
- **All four version numbers agree**: `manifest.json:4` = `1.2.6`, `package.json:3` = `1.2.6`,
  `versions.json:19` = `"1.2.6": "1.13.0"`, and the newest key in `versions.json` is `1.2.6`
  (17 entries, ascending, no gaps other than the unused `1.0.8`/`1.1.3`-style numbers which never
  existed). The git tag `1.2.6` exists and points at `HEAD` (`git rev-parse 1.2.6` =
  `git rev-parse HEAD` = `7ec7479`).
- **No version string in `main.js`** (0 matches for `1.2.6`, `1.2.5`, `"version"`) — Obsidian
  reads the version from `manifest.json` only, so this is expected, not drift.
- **Plugin id is consistent**: `manifest.json:2` = `cool-dashboard`. Grep across `src/**/*.ts`,
  `main.js`, `styles.css`, `manifest.json`, `package.json`, `README.md`, `versions.json`,
  `.github/workflows/release.yml` for `cool-dashboard|aurora-dashboard|aurora_dashboard|cool_dashboard`
  returns only: `manifest.json:2` (the id), `package.json:2` (`"name": "aurora-dashboard"`, the npm
  package name), `README.md:55` (the folder name you copy, which is the repo name), and
  `src/view.ts:7` (`VIEW_TYPE_DASHBOARD = "aurora-dashboard-view"`, a private view type, not the
  plugin id). **Nothing still points at the old id** after the `54ba269` rename and `8648db8`
  revert — no layout keys, settings paths, CSS prefixes or workflow references.
- **`minAppVersion` matches the APIs actually used**: the plugin's only post-1.0 API surface is the
  settings-definition API. `src/main.ts:1` imports `SettingDefinitionItem` and
  `src/main.ts:311-322` overrides `getControlValue` / `setControlValue`; in
  `node_modules/obsidian/obsidian.d.ts` every one of those is annotated **`@since 1.13.0`**
  (`getSettingDefinitions` at :5159, `getControlValue` :5166, `setControlValue` :5173,
  `refreshDomState` :6628, `SettingDefinitionItem` :6147). `manifest.json:5` =
  `"minAppVersion": "1.13.0"` — correct, not understated. Everything else imported
  (`Plugin`, `ItemView`, `Modal`, `Setting`, `Notice`, `TFile`, `MarkdownView`, `WorkspaceLeaf`,
  `setIcon`, `normalizePath`, `app.vault/workspace/metadataCache`) predates 1.13. There is no API
  used that requires a newer version.
- **Required files all ship and are tracked**: `git ls-files` shows `main.js`, `manifest.json`,
  `styles.css`, `versions.json`, `package.json`, `package-lock.json` and
  `.github/workflows/release.yml` all committed, and `.gitignore` excludes none of them
  (its only release-relevant exclusions are `node_modules/`, `smoke/out.js`, `*.log`, `.DS_Store`,
  `.claude/`, `.audit/`). `npm ci` in the workflow needs `package-lock.json` → present.
- **The committed bundle is current with `src/`**: `main.js` (63,783 chars, 17 lines) contains the
  1.2.5-era widget code (`No habits yet`, `No pinned notes`, `No orphan notes`,
  `No actions yet`, `dash-habit-cell`, `dash-habits-grid`, `dash-quick-btn`) — the only probes that
  miss (`No notes link here yet`) are strings that were never in `src/`. `main.js` was last changed
  in `52d1509`, which also added `src/widgets/habits.ts`, so the artifact was rebuilt with the last
  source change that affects it. The release workflow rebuilds it anyway (`release.yml:35-36`).
- **The release workflow builds before publishing and publishes the right paths**:
  `release.yml:32-36` (`npm ci` then `npm run build` = `tsc -noEmit -skipLibCheck && node
  esbuild.config.mjs production`, producing `main.js` at the repo root because
  `esbuild.config.mjs:40` sets `outfile: "main.js"`), then `:38-44` attests
  `main.js`/`manifest.json`/`styles.css`, `:46-47` runs the smoke suite, and `:72-82` publishes
  `main.js`, `manifest.json`, `styles.css` with `overwrite_files: true` and
  `fail_on_unmatched_files: true`. **The "publishes a stale committed `main.js` without rebuilding"
  failure mode does not exist** — the build step precedes every publish path.
- **`minify: prod` is not a bug**: `esbuild.config.mjs:11` parses `process.argv[2]` in *Node*, so
  `node esbuild.config.mjs production` really does see `"production"`; the committed bundle is
  minified (max line length 38,319 chars, 21 `", "` occurrences in 63 KB, 2-char minified
  identifiers). `esbuild.config.mjs:38-41` also sets `sourcemap: false` in production — the
  shipped bundle contains **no** `sourceMappingURL`.

**Documentation vs reality**
- **All 22 registered widget types appear in the README table**: `registerWidgetType` is called 22
  times across `src/widgets/*.ts`, and the names
  (Clock, Calendar, Activity, Notes, Recent, Tags, Today, All tasks, Quick capture, Search,
  Pomodoro, Quote, Deadline, Random note, Quick actions, Pinned, Popular notes, Orphan notes,
  Backlinks, Progress, Daily streak, Habits) each appear as a `**Name**` row in `README.md:25-48`.
  No registered widget is missing and no table row is unregistered.
- **README feature descriptions match the code**: per-widget options named in `README.md:81` exist
  (`src/widgets/content.ts:12,39`, `activity.ts:13`, `vaulttasks.ts:64-69`, `calendar.ts:14` toggle
  "Start week on Monday", `tools.ts:13-16`); collapsed widgets exist (`src/types.ts:20`,
  `src/view.ts:187,202,216-220`); per-habit streaks exist (`src/widgets/habits.ts:61-70,132-138`,
  rendered at `:134-137` with the `flame` icon and a "{n}-day current streak" title); the daily
  note / capture / search / task flows named in `README.md:63-68` map to real commands
  (`src/main.ts:21-35`, `src/main.ts:189-208`).
- **"Fully offline" is true for the plugin**: grep for `fetch(`, `requestUrl`, `XMLHttpRequest`
  over `src/**/*.ts` returns **nothing**; the plugin makes no network requests. (The README's own
  screenshots are GitHub-hosted, but that is a docs-hosting matter, not plugin behaviour, so it is
  not reported as a defect.)
- **README's `npm install` / `npm run dev` / `npm run build` / smoke commands all exist and mean
  what it says**: `package.json:6-9` defines `dev` (`node esbuild.config.mjs`, watch) and `build`
  (`tsc -noEmit -skipLibCheck && node esbuild.config.mjs production`), and
  `smoke/build.mjs` + `smoke/out.js` are the two smoke commands. `node smoke/out.js` exits 0 and
  prints `SMOKE TEST PASSED`.

**Robustness sweep (patterns searched, results)**
- **No `localStorage`/`sessionStorage` anywhere** — 0 matches in `src/**/*.ts`. All state goes
  through `Plugin.saveData`/`loadData`, so there is no un-namespaced or un-cleared browser storage.
- **No `@ts-ignore`, `@ts-expect-error`, `as any`, or non-null `!` assertions** — 0 matches. The
  only casts are the two deliberate widening casts needed to reach Obsidian internals:
  `src/main.ts:313` (`as unknown as Record<string, unknown>`) and `src/widgets/quickactions.ts:103`
  (`app as unknown as { commands?: … }`).
- **No `JSON.parse` on data that can be malformed**: the single call is
  `src/view.ts:141` (`JSON.parse(JSON.stringify(…))` over an in-memory layout) inside the edit-mode
  click handler, i.e. it parses a string this process just produced. Not a risk.
- **No `console.log` in the shipped bundle**: `main.js` contains 0 `console.log`, 0 `console.warn`,
  0 `debugger`. The single `console.error` (`src/view.ts:259`) is the deliberate widget-render
  error boundary and also exists once in the bundle.
- **Timers are all disposed**: every `setInterval` in a widget returns a `dispose` that clears it —
  `src/widgets/clock.ts:35-36`, `deadline.ts:70-71`, `progress.ts:69-70`, `streak.ts:69-76`,
  `tools.ts:91-107` and `tools.ts:127-131`; the control-bar clock registers its interval in
  `view.cleanups` (`src/view.ts:119-120`). The only `setTimeout` is the debounced save
  (`src/main.ts:88-92`), cleared on each re-queue. (The debounce's *unload* behaviour is owned by
  the main-persistence report and is not repeated here.)
- **No module-import-time side effects** that can throw: the only top-level statements in
  `src/**/*.ts` are the 22 `registerWidgetType(...)` calls at the bottom of each widget module
  (`src/widgets/*.ts`), which mutate a module-local `Map` (`src/registry.ts:3-7`) and cannot fail.
  Nothing reads the vault, the DOM, `window` or `document` at import time.
- **No unhandled promise rejections introduced by the cross-cutting code**: every async call is
  either awaited or explicitly `void`ed (`src/main.ts:79,91,115,120,125,144,218,253`,
  `src/view.ts:125,130,144,156,218,232,386,419`, and the widget modules). The one place that could
  produce a rejection is inside the swallowed `catch` blocks of BUG-06 — the rejection is caught,
  which is exactly the problem reported there.

**Overlap note for the verifier/integrator**
- `formatDate`/`dailyNotePath` token handling, the `Ctrl/Cmd + Shift + D` sibling issue of slash
  formats, and the settings-tab control-value staleness are already reported by
  `bug-hunt/01-geo-layout.md`, `02-main-persist.md` and `03-main-features.md`. I deliberately did
  **not** re-report them; `date-format.cjs` in my scratch dir is an independent reproduction of the
  `formatDate` defect (e.g. `formatDate(Thu 2026-02-05, "dddd") = "Thud"`,
  `formatDate(…, "DDDD") = "05DD"`) if the verifier wants a second derivation. My BUG-03 is the
  *hotkey* claim only; BUG-04 is the *mobile contract* only — neither duplicates `04-view-interaction.md`
  BUG-01/BUG-03, which cover the pointer-event mechanism and the 720 px grid maths.
