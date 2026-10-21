# Bug hunt — shared instructions (read this first)

Target: the Obsidian plugin **Aurora Dashboard** in this repo (plugin id `cool-dashboard`).
TypeScript source lives in `src/`; `main.js` and `smoke/out.js` are bundles generated from it
(both were verified current with `src/` at the start of this run — treat `src/` as ground truth).

## Ground rules

1. **Do not modify any file outside your own assigned outputs.** Never edit `src/`, `main.js`,
   `styles.css`, `manifest.json`, `package.json`, or `smoke/*`. This is a *detection* exercise.
   All scratch files go under your own `bug-hunt/scratch-<your-area>/` directory.
2. A finding is only a finding if it is a **real defect**: wrong output, crash, data loss,
   broken feature, leak, security issue, or a documented behaviour that does not happen.
   Style preferences, "could be refactored", and missing tests are NOT bugs.
3. Every finding needs: exact `file:line`, what the code does, why it is wrong, a concrete
   trigger, the user-visible impact, and a minimal suggested fix. No invented line numbers —
   re-read the file before quoting a line.
4. Prefer **demonstrated** bugs. Run the code where you can (recipe below) and paste real output.
   If you could not execute it, say `evidence: static only` and mark confidence honestly.
5. Do not report the same defect twice; instead merge into one finding with all call sites.
6. Also record what you checked and found clean, so the next agent does not redo it.

## Blocked in this sandbox (do NOT retry these)

- `node smoke/build.mjs`, `npm run build`, `npx esbuild`, anything that bundles with esbuild:
  esbuild spawns a child process with piped stdio, which the sandbox denies with `EPERM`.
- Do not try to work around this by editing build files.

These DO work:

- `npx tsc -noEmit -skipLibCheck` — the repo typecheck (currently exits 0).
- `node smoke/out.js` — the prebuilt jsdom smoke suite (currently prints `SMOKE TEST PASSED`).
- The compile-and-require recipe below.

## Recipe: run real plugin code in Node (works!)

The plugin is plain TypeScript and can be compiled to CommonJS and driven in-process with the
existing jsdom Obsidian stub. From the repo root, using your own scratch dir:

```powershell
# 1. compile everything to CJS in YOUR scratch dir (do not use a shared dir)
npx tsc --outDir bug-hunt/scratch-<area>/build --module commonjs --target es2018 `
  --moduleResolution node --skipLibCheck --noEmit false --esModuleInterop `
  --lib es2018,dom --strict false src/main.ts
```

```js
// 2. bug-hunt/scratch-<area>/probe.cjs
require("../../bug-hunt/shim.cjs");            // installs global.document + maps "obsidian" -> smoke/stub-obsidian.js
const { App } = require("obsidian");
const Plugin = require("./build/main.js").default;
const { DashboardView } = require("./build/view.js");
const { getWidgetTypes } = require("./build/registry.js");
const layout = require("./build/layout.js");
const utils = require("./build/utils.js");

(async () => {
  const app = new App();
  await app.vault.create("Notes/Alpha.md", "# Alpha\nhello");
  const plugin = new Plugin(app, { id: "cool-dashboard" });
  await plugin.onload();
  const view = new DashboardView(app.workspace.getLeaf(false), plugin);
  await view.onOpen();               // renders the whole dashboard into view.contentEl
  console.log(view.contentEl.querySelectorAll(".dash-widget").length);
})();
```

```powershell
node bug-hunt/scratch-<area>/probe.cjs
```

**IMPORTANT — always end your script with `process.exit(0)`.** Rendering the dashboard starts real
timers (clock, activity tick), so Node will hang forever on a finished script without it. A working,
verified template you can copy is `bug-hunt/scratch-00-selftest/probe.cjs` (prints
`SELFTEST widgets= 22` in under a second).

`bug-hunt/shim.cjs` also exposes `load(area, relPath)` which requires a compiled module from
`bug-hunt/scratch-<area>/build/...`. See `smoke/entry.js` for many more working interaction
patterns (checkbox clicks, edit mode, widget settings modals) you can copy from.

## Report format (your output file)

```markdown
# <Area> findings

## BUG-01 — <one-line title>
- **Severity**: critical | high | medium | low
- **Where**: `src/layout.ts:55-67` (function `nearestFree`)
- **What**: ...
- **Why it's wrong**: ...
- **Trigger / repro**: <exact steps or script + real output>
- **Impact**: ...
- **Evidence**: executed | static only  (paste command output for executed)
- **Confidence**: high | medium | low
- **Suggested fix**: ...

## Checked and clean
- ... (short list, with file:line where useful)
```

Keep the file focused: a reader should be able to fix every bug from it without re-reading the repo.
