# custom_aurora-dashboard
rebuilt to add graph support

A fork of [stef4678/aurora-dashboard](https://github.com/stef4678/aurora-dashboard) that adds a **Graph** widget: an interactive link graph of your whole vault, right on the dashboard.

### Graph widget

- Every note in the vault and the links between them; dot size follows link count, colors follow top-level folder
- Hover a note to highlight it and its neighbours; click to open it; drag a note to move it
- Drag the background to pan, wheel or pinch to zoom, double-click to fit everything on screen
- Options (edit mode → gear): limit to one folder, show/hide orphan notes, color by folder
- **Show names**: *Hubs* (the most-linked notes, more as you zoom in), *All* or *None*; hovering always shows names
- **Groups**: rules made of a `#tag` (nested tags included) or a folder path, each with a color and an on/off switch. A note takes the color of the first group it matches (reorder with ↑), a legend shows the groups, and switching a group off hides its notes; *Show other notes* does the same for notes that match no group
- Keeps its layout across re-renders and only redraws when the link structure changes; built to stay smooth on vaults of a couple thousand notes

Source: [`src/widgets/graph.ts`](src/widgets/graph.ts).

### Note heatmap

- **Note heatmap**: a year heatmap (Jan 1 → today) for one source, picked in the widget settings: *SOC Operations* (`♻️ DailyNotes/Soc Operation/SocTickets/YYYY/MM-Month/DD`, tagged `#soc_operation`) or *On-Call* (`🔎⏰On-Call`, tagged `#on_call`). A note counts once per ticket ID in its name; the ID prefix is read from `const TICKET_PREFIX = "…"` in the templates of the vault. The *On-Call* date comes from the `date` property (or the legacy `Date`), then a `**Date** :` line, then the file creation date.

Source: [`src/widgets/nerds.ts`](src/widgets/nerds.ts).

### License

This fork is released under the GPL-3.0 ([LICENSE](LICENSE)). The original Aurora Dashboard code is © 2026 Kerekes Stefan under the MIT license, whose notice is kept in [LICENSE-MIT](LICENSE-MIT).

---

*Original README follows.*

## Aurora Dashboard

A polished, interactive dashboard and control center for [Obsidian](https://obsidian.md) — a grid of draggable, resizable widgets covering your clock, calendar, activity, tasks, capture, links, streaks, and more.

## Features

<img width="700" alt="Screenshot 2026-08-14 203312" src="https://github.com/user-attachments/assets/617a5e93-efc4-46b2-8db9-5ee6d9289d7f" />
<img width="700" alt="Screenshot 2026-08-14 203358" src="https://github.com/user-attachments/assets/5279d59e-ddac-4efe-9bae-3837b5203755" />
<img width="700" alt="Screenshot 2026-08-14 203407" src="https://github.com/user-attachments/assets/dccbb948-a709-4633-bab1-70fa4e2bff92" />

- **Draggable, resizable widgets** on a configurable grid — set columns, row height, and gap to taste
- **Edit mode** — drag, resize, remove, and re-configure widgets, collapse them to a header bar, or reset the layout in one click
- **Activity tracking** — a GitHub-style heatmap of your note edits, with streaks, weekly, and lifetime totals
- **Daily note integration** — the calendar and Today widgets open, create, and manage your daily notes
- **Vault-wide tasks** — every open task from every note, grouped by source; click to jump, tick to complete
- **Embed anything** — a note, today's daily note, a `.base`, a Dataview query, a diagram, or markdown you type, rendered right on the dashboard
- **Quick capture** — send a thought to your inbox file or today's note in one keystroke
- **Quick actions launcher** — configurable buttons that run Obsidian commands, open notes, run searches, or insert notes from templates
- **Link insights** — see which notes are most-linked, which are orphans, and what links to your current note
- **Habit & progress nudges** — daily-note streaks, animated day/month/year progress rings, and a rolling habit tracker with per-habit streaks
- **Custom accent color** — theme the highlights, charts, and progress rings (with presets)
- **Fully offline** — all data lives in your vault, no external services

## Widgets

| Widget | Description |
| --- | --- |
| **Clock** | Live digital clock with the current date; toggle seconds and 24-hour format |
| **Calendar** | Month view with a dot on days that have a daily note; click a day to open or create it |
| **Activity** | GitHub-style heatmap of your editing activity, plus streak, weekly, and total stats |
| **Notes** | Vault stats at a glance — note count, created today, edits this week, 7-day sparkline |
| **Recent** | Notes you touched recently, click to open |
| **Tags** | Your most-used tags, click to run a vault search |
| **Today** | Checkboxes from today's daily note — check them off or add new tasks inline |
| **All tasks** | Every open checkbox task across your vault (any list marker), grouped by note; click a task to jump to it, tick the box to complete it inline |
| **Quick capture** | A textarea that appends to your inbox file or today's note |
| **Search** | Global vault search right from the dashboard |
| **Pomodoro** | A focus timer with an animated ring; configurable focus/break lengths |
| **Quote** | A rotating dose of inspiration |
| **Deadline** | Countdown to a date you set, with an overdue state |
| **Random note** | Open a random note from your vault |
| **Quick actions** | Configurable launcher buttons — run commands, open notes or templates, capture, search |
| **Pinned** | Your favorite notes, one click away; add or remove them from the widget settings |
| **Popular notes** | Your most-linked notes, ranked by how many notes link to them |
| **Orphan notes** | Notes nobody links to, newest first — spot forgotten notes |
| **Backlinks** | Notes that link to the note you're currently viewing (updates live) |
| **Progress** | How much of the day, month, and year has passed, as animated rings |
| **Daily streak** | Consecutive days you've written a daily note, plus your best run |
| **Habits** | Track daily habits on a rolling grid — check off any of the last few days, with today and current-streak chips |
| **Embed** | Render a note, today's daily note, or markdown you write — Bases, Dataview queries, Mermaid diagrams and `![[embeds]]` all render through Obsidian itself |

## Installation

The plugin isn't on the community plugin list yet. To use it:

1. Build it (`npm run build`) or download a release.
2. Copy the `aurora-dashboard` folder into `<your-vault>/.obsidian/plugins/`.
3. Restart Obsidian, then enable **Aurora Dashboard** under *Settings → Community plugins*.
4. Open it from the ribbon icon, the command palette (*Open dashboard*), or a hotkey you assign yourself in *Settings → Hotkeys*.

The plugin is not desktop-only: the dashboard renders as a single column on narrow screens and in edit mode the grip and the resize corner work with touch, so you can rearrange widgets on a phone or tablet with a mouse-free gesture. Install it on mobile the same way as any other plugin (community plugin list, or copy the folder into your vault).

## Usage

- **Open the dashboard** — ribbon icon, the command palette, or a hotkey you assign in *Settings → Hotkeys* (search for “Aurora”). No default binding is set, so nothing collides with your own shortcuts.
- **Edit the layout** — click the pencil button in the dashboard's control bar (or run *Toggle dashboard edit mode*). Drag widgets by their grip, resize from the corner, use the gear for per-widget settings, the ✕ to remove, and the **+** to add new widgets. **Cancel editing** puts the layout back the way it was.
- **Leave it open** — the board follows the calendar on its own: at midnight the calendar, habits grid, heatmap and Today widget roll over to the new day without a reload.
- **Work your tasks** — the **Today** widget manages today's daily-note checklist; the **All tasks** widget lists every open checkbox task in your vault (any list marker; checkboxes inside code blocks are left alone). Click a task to jump to it in its note; tick the box to toggle it.
- **Configure launchers** — **Quick actions** and **Pinned** have their own editors (edit mode → gear): add, reorder, and remove actions or pinned notes.
- **Track habits** — the **Habits** widget's editor (edit mode → gear) names the habits you want to track and how many trailing days to show; click a square to mark that habit done for that day.
- **Embed your own content** — the **Embed** widget (edit mode → gear) shows a note by path, follows today's daily note, or renders markdown you paste in. Non-markdown files are transcluded, so a `.base`, an image or a canvas renders natively; long content scrolls or clips.
- **Explore your links** — the **Backlinks** widget follows the note you have open; **Popular notes** and **Orphan notes** rank your vault's connectivity.
- **Quick capture** — the *Capture to inbox* command, the send button in the control bar, or the Quick capture widget.
- **Search** — the search button in the control bar, or the Search widget.

## Settings

All options live under *Settings → Aurora Dashboard*:

- **Layout** — columns, row height, gap, edit mode, reset layout
- **Appearance** — accent color with a picker and one-click presets
- **Activity** — toggle note-edit tracking and clear collected data
- **Daily notes** — folder and filename format (tokens: `YYYY`, `YY`, `MMMM`, `MMM`, `MM`, `DD`, `dd`, `dddd`, `ddd`). A format may include folders, e.g. `YYYY/MM/DD`; missing folders are created for you.
- **Capture** — target (inbox file vs today's note), folder, and inbox filename
- **Pomodoro** — default focus/break lengths used by new Pomodoro widgets

Many widgets also have per-widget options (edit mode → gear), e.g. how many entries to show, whether to include completed tasks, whether the week starts on Monday, or which actions appear on a Quick actions button.

## Development

```bash
npm install
npm run dev        # watch mode, bundles to main.js
npm run build      # typecheck (tsc --noEmit) + production bundle
```

Smoke test — renders the dashboard in jsdom and runs assertions against every widget:

```bash
node smoke/build.mjs   # bundle the smoke test
node smoke/out.js      # run the checks (exit 0 = pass)
```

## How it works

- `src/registry.ts` — widget type registration
- `src/layout.ts` — grid layout, collision detection, and overlap resolution
- `src/widgets/*.ts` — each widget is a self-contained module with a `render` function
- `src/view.ts` — the dashboard view: grid, drag/resize, edit mode, modals
- `src/main.ts` — plugin lifecycle, settings, commands, and activity tracking

## License

[MIT](LICENSE-MIT) © 2026 Kerekes Stefan (original code); this fork: GPL-3.0, see [LICENSE](LICENSE)
