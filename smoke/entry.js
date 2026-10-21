require("./stub-obsidian");
const { App, Modal } = require("obsidian");
const AuroraDashboardPlugin = require("../src/main").default;
const { DashboardView } = require("../src/view");
const { getWidgetTypes, registerWidgetType } = require("../src/registry");
const { clampLayout, gridRows, hasOverlap } = require("../src/layout");
const { DEFAULT_SETTINGS } = require("../src/types");
const { clamp, formatDate } = require("../src/utils");

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

const dateKeyNow = () => {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const shiftDays = (d, n) => {
	const c = new Date(d);
	c.setDate(c.getDate() + n);
	return c;
};

async function main() {
	const app = new App();
	await app.vault.create("Notes/Alpha.md", "# Alpha\nhello world");
	await app.vault.create("Notes/Beta.md", "# Beta\nanother note");

	const plugin = new AuroraDashboardPlugin(app, { id: "cool-dashboard" });
	await plugin.onload();

	const leaf = app.workspace.getLeaf(false);
	const view = new DashboardView(leaf, plugin);
	leaf.view = view;
	await view.onOpen();

	const content = view.contentEl;
	const errors = [];
	content.querySelectorAll(".dash-widget-error").forEach((e) => errors.push(e.textContent));

	const checks = {};
	checks.widgetCount = content.querySelectorAll(".dash-widget").length;
	const layoutTypes = plugin.settings.layout.map((i) => i.type).sort();
	const regTypes = getWidgetTypes().map((t) => t.type).sort();
	checks.allWidgetTypesInDefaultLayout = layoutTypes.join(",") === regTypes.join(",");
	checks.hasControlCenter = content.textContent.includes("Aurora Dashboard");
	checks.hasClock = !!content.querySelector(".dash-clock-time");
	checks.hasCalendar = !!content.querySelector(".dash-cal-grid");
	checks.hasHeatmap = !!content.querySelector(".dash-heatmap");
	checks.hasStats = !!content.querySelector(".dash-stat-row");
	checks.hasRecent = !!content.querySelector(".dash-list");
	checks.hasTasks = !!content.querySelector(".dash-add-row");
	checks.hasCapture = !!content.querySelector(".dash-capture-input");
	checks.hasPomodoro = !!content.querySelector(".dash-pomo-ring");
	checks.hasQuote = !!content.querySelector(".dash-quote-text");
	checks.renderErrors = errors;

	plugin.addWidget("search");
	checks.widgetCountAfterAdd = content.querySelectorAll(".dash-widget").length;

	await app.vault.modify(app.vault.getAbstractFileByPath("Notes/Alpha.md"), "# Alpha\nmore words");
	checks.activityRecorded = (plugin.settings.activity[dateKeyNow()] || 0) > 0;

	await plugin.captureText("hello from smoke test");
	const inbox = app.vault.getAbstractFileByPath("Inbox.md");
	checks.inboxCreated = !!inbox;
	checks.inboxContent = inbox ? (await app.vault.read(inbox)).includes("hello from smoke test") : false;

	await plugin.openDay(new Date());
	const todayPath = plugin.dailyNotePath(new Date());
	const todayFile = app.vault.getAbstractFileByPath(todayPath);
	checks.todayNoteCreated = !!todayFile;
	if (todayFile) {
		await app.vault.modify(todayFile, "- [ ] Write the report\n- [x] Done item");
		plugin.refreshActivityWidgets();
		await tick(30);
		const taskCheck = content.querySelector(".dash-task .dash-check");
		checks.tasksRendered = !!taskCheck;
		if (taskCheck) {
			taskCheck.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
			await tick(30);
			const text = await app.vault.read(todayFile);
			checks.taskToggled = text.includes("- [x] Write the report");
		}
	}

	plugin.settings.editMode = true;
	plugin.rerenderDashboard();
	checks.editingClass = content.classList.contains("editing");
	checks.gripPresent = !!content.querySelector(".dash-grip");
	checks.resizeHandlePresent = !!content.querySelector(".dash-resize");

	const collapseBtn = content.querySelector(".dash-widget:not(.no-header) .dash-widget-collapse");
	if (collapseBtn) {
		collapseBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
		await tick(30);
		checks.collapseApplies = !!content.querySelector(".dash-widget.collapsed");
		const expandBtn = content.querySelector(".dash-widget.collapsed .dash-widget-collapse");
		if (expandBtn) {
			expandBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
			await tick(30);
		}
		checks.collapseReopens = !content.querySelector(".dash-widget.collapsed");
	} else {
		checks.collapseApplies = false;
		checks.collapseReopens = false;
	}

	const cancelBtn = content.querySelector('.dash-control-right .dash-btn[aria-label="Cancel editing"]');
	if (cancelBtn) {
		cancelBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
		await tick(30);
		checks.cancelExitsEditMode = !content.classList.contains("editing") && plugin.settings.editMode === false;
	} else {
		checks.cancelExitsEditMode = false;
	}

	plugin.addWidget("deadline");
	checks.deadlineRenders = !!content.querySelector(".dash-deadline-days");
	const dlInst = plugin.settings.layout.find((i) => i.type === "deadline");
	if (dlInst) {
		dlInst.settings.date = "2099-01-01";
		plugin.refreshWidget(dlInst.uid);
		await tick(30);
		const dlDays = content.querySelector(".dash-deadline-days");
		checks.deadlineCountdown = dlDays ? /^\d+$/.test(dlDays.textContent.trim()) : false;
		dlInst.settings.date = "2000-01-01";
		plugin.refreshWidget(dlInst.uid);
		await tick(30);
		checks.deadlineOverdue = !!content.querySelector(".dash-deadline-days.overdue");
	} else {
		checks.deadlineCountdown = false;
		checks.deadlineOverdue = false;
	}

	plugin.addWidget("random");
	const randomBtn = content.querySelector(".dash-random-btn");
	checks.randomRenders = !!randomBtn;
	const openedLog = [];
	const origOpenFile = plugin.openFile;
	plugin.openFile = (f) => {
		openedLog.push(f);
	};
	if (randomBtn) {
		randomBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
		await tick(30);
	}
	plugin.openFile = origOpenFile;
	checks.randomOpensNote = openedLog.length === 1 && !!openedLog[0] && openedLog[0].extension === "md";

	// vault-wide tasks widget — reset the daily note so it has an open task to find
	const vtf = app.vault.getAbstractFileByPath(plugin.dailyNotePath(new Date()));
	if (vtf) await app.vault.modify(vtf, "- [ ] Plan the weekend\n- [x] Already done");
	plugin.addWidget("vaulttasks");
	await tick(60);
	const vtWidget = content.querySelector(".widget-vaulttasks");
	checks.vaultTasksWidget = !!vtWidget;
	checks.vaultTasksRows = vtWidget ? vtWidget.querySelectorAll(".dash-list-row").length > 0 : false;
	const vtCheck = vtWidget ? vtWidget.querySelector(".dash-list-row .dash-check") : null;
	checks.vaultTasksCheckbox = !!vtCheck;
	if (vtCheck) {
		vtCheck.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
		await tick(30);
		checks.vaultTaskToggled = vtf ? (await app.vault.read(vtf)).includes("- [x] Plan the weekend") : false;
	}

	// quick actions widget
	plugin.addWidget("quickactions");
	await tick(30);
	const qaWidget = content.querySelector(".widget-quickactions");
	checks.quickActionsWidget = !!qaWidget;
	checks.quickActionsButtons = qaWidget ? qaWidget.querySelectorAll(".dash-quick-btn").length > 0 : false;

	// link/streak widgets (part of the default layout)
	checks.hasPopular = !!content.querySelector(".widget-popular");
	checks.hasOrphans = !!content.querySelector(".widget-orphans");
	checks.hasBacklinks = !!content.querySelector(".widget-backlinks");
	checks.hasPinned = !!content.querySelector(".widget-pinned");
	checks.hasProgress = !!content.querySelector(".dash-prog-ring");
	checks.hasStreak = !!content.querySelector(".dash-streak-num");
	checks.newWidgetErrors = errors;

	// habit tracker widget — seed habits + log, then click a cell to toggle it
	const habitsInst = plugin.settings.layout.find((i) => i.type === "habits");
	checks.habitsInDefaultLayout = !!habitsInst;
	if (habitsInst) {
		habitsInst.settings.habits = [
			{ id: "h1", name: "Exercise" },
			{ id: "h2", name: "Read" },
		];
		habitsInst.settings.log = { h1: [dateKeyNow()] };
		plugin.refreshWidget(habitsInst.uid);
		await tick(30);
		const habBody = content.querySelector(".widget-habits");
		checks.habitsRows = habBody ? habBody.querySelectorAll(".dash-habit-name").length : 0;
		checks.habitsCells = habBody ? habBody.querySelectorAll(".dash-habit-cell").length : 0;
		const todayCell = habBody ? habBody.querySelector(`.dash-habit-cell[data-date="${dateKeyNow()}"]`) : null;
		checks.habitsTodayCell = !!todayCell;
		const h2Today = habBody
			? habBody.querySelector(`.dash-habit-cell[data-hid="h2"][data-date="${dateKeyNow()}"]`)
			: null;
		if (h2Today) {
			h2Today.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
			await tick(30);
			checks.habitToggled = (habitsInst.settings.log.h2 || []).includes(dateKeyNow());
			const nowDone = habBody.querySelector(`.dash-habit-cell[data-hid="h2"][data-date="${dateKeyNow()}"]`);
			checks.habitCellDoneClass = nowDone ? nowDone.classList.contains("is-done") : false;
		} else {
			checks.habitToggled = false;
			checks.habitCellDoneClass = false;
		}
	} else {
		checks.habitsRows = 0;
		checks.habitsCells = 0;
		checks.habitsTodayCell = false;
		checks.habitToggled = false;
		checks.habitCellDoneClass = false;
	}

	// ---- embed widget ----
	const embedInst = plugin.settings.layout.find((i) => i.type === "embed");
	checks.embedInDefaultLayout = !!embedInst;
	if (embedInst) {
		await tick(30);
		const dailyBody = content.querySelector(".widget-embed .dash-embed-content");
		checks.embedRendersDailyNote = !!dailyBody && dailyBody.textContent.includes("Plan the weekend");
		checks.embedSourceFooter = !!content.querySelector(".widget-embed .dash-embed-source");

		// inline markdown
		embedInst.settings.mode = "markdown";
		embedInst.settings.markdown = "**bold claim** for the dashboard";
		plugin.refreshWidget(embedInst.uid);
		await tick(30);
		const mdBody = content.querySelector(".widget-embed .dash-embed-content");
		checks.embedInlineMarkdown = !!mdBody && mdBody.textContent.includes("bold claim");
		checks.embedInlineHasNoFooter = !content.querySelector(".widget-embed .dash-embed-source");

		// a note, with its frontmatter stripped
		await app.vault.create("Notes/Embedded.md", "---\ntitle: Hidden Prop\n---\n# Heading\nembed body text");
		embedInst.settings.mode = "note";
		embedInst.settings.path = "Notes/Embedded.md";
		plugin.refreshWidget(embedInst.uid);
		await tick(30);
		const noteBody = content.querySelector(".widget-embed .dash-embed-content");
		checks.embedNoteBody = !!noteBody && noteBody.textContent.includes("embed body text");
		checks.embedStripsFrontmatter = !!noteBody && !noteBody.textContent.includes("Hidden Prop");

		// a non-markdown source is handed to Obsidian's own embed renderer
		await app.vault.create("Views/Board.base", "filters: {}");
		embedInst.settings.path = "Views/Board.base";
		plugin.refreshWidget(embedInst.uid);
		await tick(30);
		const baseBody = content.querySelector(".widget-embed .dash-embed-content");
		checks.embedTranscludesBase = !!baseBody && baseBody.textContent.includes("![[Views/Board.base]]");

		// a note that merely opens with a horizontal rule is not treated as frontmatter
		await app.vault.create("Notes/Rule.md", "---\nplain body text\n---\nmore");
		embedInst.settings.path = "Notes/Rule.md";
		plugin.refreshWidget(embedInst.uid);
		await tick(30);
		const ruleBody = content.querySelector(".widget-embed .dash-embed-content");
		checks.embedKeepsHorizontalRule = !!ruleBody && ruleBody.textContent.includes("plain body text");

		// empty state when no source is chosen
		embedInst.settings.path = "";
		plugin.refreshWidget(embedInst.uid);
		await tick(30);
		checks.embedEmptyState = !!content.querySelector(".widget-embed .dash-empty");

		// its own settings editor: pick a note, then commit with Done
		const embedType = getWidgetTypes().find((t) => t.type === "embed");
		checks.embedHasSettingsEditor = !!(embedType && embedType.openSettings);
		if (embedType && embedType.openSettings) {
			embedType.openSettings(plugin, embedInst);
			const root = document.body.lastElementChild;
			const datalist = root && root.querySelector("datalist#dash-embed-files");
			checks.embedPickerListsFiles = !!datalist && datalist.querySelectorAll("option").length > 0;
			const picker = root && root.querySelector("input[list='dash-embed-files']");
			if (picker) {
				picker.value = "Notes/Embedded.md";
				picker.dispatchEvent(new window.Event("input", { bubbles: true }));
			}
			const done = root && root.querySelector(".dash-modal-foot .dash-btn");
			if (done) done.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
			checks.embedPickerCommits = embedInst.settings.path === "Notes/Embedded.md";
		}

		// one click must flip one line, not every task that shares the wording
		const daily = app.vault.getAbstractFileByPath(plugin.dailyNotePath(new Date()));
		if (daily) {
			await app.vault.modify(daily, "# doc\n- [ ] dup\nmiddle\n- [ ] dup");
			plugin.refreshActivityWidgets();
			await tick(40);
			checks.duplicateTasksRendered = content.querySelectorAll(".widget-tasks .dash-task").length === 2;
			const firstDup = content.querySelector(".widget-tasks .dash-task .dash-check");
			if (firstDup) {
				firstDup.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
				await tick(40);
				const lines = (await app.vault.read(daily)).split("\n");
				checks.onlyClickedDuplicateToggled = lines[1] === "- [x] dup" && lines[3] === "- [ ] dup";
			} else {
				checks.onlyClickedDuplicateToggled = false;
			}
		} else {
			checks.duplicateTasksRendered = false;
			checks.onlyClickedDuplicateToggled = false;
		}
	}

	// ---- date formatting (one token pass) ----
	checks.formatDateRepeatedTokens = formatDate(new Date(2026, 10, 6), "DD.MM.DD") === "06.11.06";
	checks.formatDateLongTokens = formatDate(new Date(2026, 10, 6), "dddd, DD MMMM YYYY") === "Friday, 06 November 2026";
	checks.formatDateAdjacentTokens = formatDate(new Date(2026, 10, 6), "YYYY-MM-DD_dd") === "2026-11-06_06";
	checks.clampHandlesInvertedBounds = clamp(5, 4, 2) === 2;
	checks.clampHandlesNaN = clamp(NaN, 0, 10) === 0 && clamp(5, NaN, 10) === 5;

	// ---- persisted geometry and scalars are repaired, never rendered ----
	const badInst = { type: "clock", uid: "bad", x: -3, y: 1e6, w: 99, h: -2, settings: {} };
	clampLayout([badInst], 12);
	checks.clampLayoutWidth = badInst.w === 12;
	checks.clampLayoutHeight = badInst.h === 1 && badInst.y === 399;
	checks.clampLayoutInsideGrid = badInst.x === 0 && badInst.x + badInst.w <= 12;

	const corrupt = new AuroraDashboardPlugin(new App(), { id: "cool-dashboard" });
	corrupt._data = {
		version: 3,
		columns: 0,
		rowHeight: NaN,
		gap: 999,
		dailyNoteFolder: null,
		dailyNoteFormat: null,
		activity: "x",
		layout: [{ type: "clock", uid: "a", x: -3, y: 1e6, w: 99, h: -2, settings: {} }],
	};
	await corrupt.loadSettings();
	checks.columnsValidated = corrupt.settings.columns === 8;
	checks.rowHeightValidated = corrupt.settings.rowHeight === 88;
	checks.gapValidated = corrupt.settings.gap === 28;
	checks.folderCoerced = corrupt.settings.dailyNoteFolder === "";
	checks.formatCoerced = corrupt.settings.dailyNoteFormat === "YYYY-MM-DD";
	checks.activityNormalised = Object.keys(corrupt.settings.activity).length === 0;
	checks.corruptGeometryClamped = corrupt.settings.layout[0].w === 8 && corrupt.settings.layout[0].x === 0;
	checks.corruptGridHasNoStall = corrupt.settings.layout[0].y < 400;

	// ---- widget identity and an explicitly empty layout ----
	const dup = new AuroraDashboardPlugin(new App(), { id: "cool-dashboard" });
	dup._data = {
		version: 3,
		layout: [
			{ type: "clock", uid: "SHARED", x: 0, y: 0, w: 4, h: 2, settings: {} },
			{ type: "calendar", uid: "SHARED", x: 4, y: 0, w: 4, h: 2, settings: {} },
		],
	};
	await dup.loadSettings();
	checks.duplicateUidsRepaired =
		dup.settings.layout.length === 2 && dup.settings.layout[0].uid !== dup.settings.layout[1].uid;

	const emptyPlugin = new AuroraDashboardPlugin(new App(), { id: "cool-dashboard" });
	emptyPlugin._data = { version: 3, layout: [] };
	await emptyPlugin.loadSettings();
	checks.emptyLayoutRespected = emptyPlugin.settings.layout.length === 0;

	const freshPlugin = new AuroraDashboardPlugin(new App(), { id: "cool-dashboard" });
	await freshPlugin.loadSettings();
	checks.missingLayoutGetsDefaultBoard = freshPlugin.settings.layout.length > 20;

	const badVersion = new AuroraDashboardPlugin(new App(), { id: "cool-dashboard" });
	badVersion._data = {
		version: {},
		layout: [{ type: "clock", uid: "a", x: 0, y: 0, w: 4, h: 2, settings: {} }],
	};
	await badVersion.loadSettings();
	checks.versionRepaired = badVersion.settings.version === 3;
	checks.versionRepairRunsMigration = badVersion.settings.layout.some((i) => i.type === "habits");

	checks.activityNotAliased = freshPlugin.settings.activity !== DEFAULT_SETTINGS.activity;
	freshPlugin.recordActivity();
	checks.defaultActivityUntouched = Object.keys(DEFAULT_SETTINGS.activity).length === 0;

	// ---- teardown flushes the debounced save ----
	const teardown = new AuroraDashboardPlugin(new App(), { id: "cool-dashboard" });
	await teardown.onload();
	teardown.recordActivity();
	const flushedBefore = Object.keys((teardown._data || {}).activity || {}).length;
	teardown.onunload();
	await tick(20);
	checks.onunloadFlushesPendingSave = Object.keys((teardown._data || {}).activity || {}).length > flushedBefore;

	// ---- the plugin's own writes are not user edits ----
	const actPlugin = new AuroraDashboardPlugin(new App(), { id: "cool-dashboard" });
	await actPlugin.onload();
	const actKey = dateKeyNow();
	const actStart = actPlugin.settings.activity[actKey] || 0;
	await actPlugin.captureText("a captured thought");
	checks.captureNotCountedAsActivity = (actPlugin.settings.activity[actKey] || 0) === actStart;
	await actPlugin.openDay(new Date());
	checks.openDayNotCountedAsActivity = (actPlugin.settings.activity[actKey] || 0) === actStart;
	const actedInbox = actPlugin.app.vault.getAbstractFileByPath("Inbox.md");
	checks.inboxFileNameIsMarkdown = !!actedInbox;
	if (actedInbox) await actPlugin.app.vault.modify(actedInbox, "a real edit");
	checks.userEditStillCounted = (actPlugin.settings.activity[actKey] || 0) === actStart + 1;

	// ---- a daily-note path with folders creates the whole chain ----
	const folderPlugin = new AuroraDashboardPlugin(new App(), { id: "cool-dashboard" });
	await folderPlugin.onload();
	folderPlugin.settings.dailyNoteFolder = "Journal/Deep";
	folderPlugin.settings.dailyNoteFormat = "YYYY/MM/DD";
	await folderPlugin.openDay(new Date(2026, 8, 15));
	const folderPaths = folderPlugin.app.vault.folders.map((f) => f.path);
	checks.recursiveFolderChain =
		folderPaths.includes("Journal") &&
		folderPaths.includes("Journal/Deep") &&
		folderPaths.includes("Journal/Deep/2026") &&
		folderPaths.includes("Journal/Deep/2026/09");
	checks.dailyNoteCreatedInNestedFolder = !!folderPlugin.app.vault.getAbstractFileByPath("Journal/Deep/2026/09/15.md");
	folderPlugin.settings.dailyNoteFormat = "   ";
	checks.blankFormatFallsBack = folderPlugin.dailyNotePath(new Date(2026, 8, 15)) === "Journal/Deep/2026-09-15.md";

	// ---- the settings tab cannot write an out-of-range value back ----
	const tabPlugin = new AuroraDashboardPlugin(new App(), { id: "cool-dashboard" });
	await tabPlugin.onload();
	const tab = tabPlugin._settingTab;
	tab.setControlValue("columns", 0);
	checks.tabClampsColumnsLow = tabPlugin.settings.columns === 8;
	tab.setControlValue("columns", 99);
	checks.tabClampsColumnsHigh = tabPlugin.settings.columns === 16;
	tab.setControlValue("rowHeight", "abc");
	checks.tabClampsRowHeight = tabPlugin.settings.rowHeight === 88;

	// ---- edit mode gives a headerless widget its grip and actions ----
	plugin.settings.editMode = true;
	plugin.rerenderDashboard();
	await tick(40);
	const clockCard = content.querySelector('.dash-widget[data-type="clock"]');
	checks.clockHasGripInEditMode = !!clockCard && !!clockCard.querySelector(".dash-grip");
	const clockRemove = clockCard ? clockCard.querySelector(".dash-widget-actions .dash-btn-danger") : null;
	checks.clockHasRemoveInEditMode = !!clockRemove;
	if (clockRemove) {
		clockRemove.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
		await tick(40);
	}
	checks.clockRemovable = !plugin.settings.layout.some((i) => i.type === "clock");

	// ---- gestures on a controlled board: cancel must not commit, release must ----
	const dragPlugin = new AuroraDashboardPlugin(new App(), { id: "cool-dashboard" });
	dragPlugin._data = {
		version: 3,
		editMode: true,
		layout: [
			{ type: "deadline", uid: "d1", x: 0, y: 0, w: 3, h: 2, settings: {} },
			{ type: "random", uid: "d2", x: 6, y: 0, w: 3, h: 2, settings: {} },
		],
	};
	await dragPlugin.onload();
	const dragView = new DashboardView(dragPlugin.app.workspace.getLeaf(false), dragPlugin);
	await dragView.onOpen();
	const dragGrid = dragView.contentEl.querySelector(".dash-grid");
	dragGrid.getBoundingClientRect = () => ({
		left: 0,
		top: 0,
		width: 1200,
		height: 3000,
		right: 1200,
		bottom: 3000,
		x: 0,
		y: 0,
		toJSON() {},
	});
	const dragStep = (1200 - 14 * 11) / 12 + 14;
	const dropX = Math.round(dragStep * 3 + 5);
	const dropY = 5;
	const dragInst = dragPlugin.settings.layout[0];
	const gripOf = () => dragView.contentEl.querySelector('.dash-widget[data-uid="d1"] .dash-grip');
	const pressGrip = () =>
		gripOf().dispatchEvent(new window.MouseEvent("pointerdown", { clientX: 10, clientY: 10, bubbles: true }));
	if (gripOf()) {
		pressGrip();
		document.dispatchEvent(new window.MouseEvent("pointermove", { clientX: dropX, clientY: dropY, bubbles: true }));
		document.dispatchEvent(new window.MouseEvent("pointercancel", { bubbles: true }));
		checks.cancelledDragDoesNotCommit = dragInst.x === 0 && dragInst.y === 0;
		// a stale handler would keep painting the drop preview on later moves
		document.dispatchEvent(new window.MouseEvent("pointermove", { clientX: 400, clientY: 400, bubbles: true }));
		checks.noStaleGestureAfterCancel = !dragView.contentEl
			.querySelector(".dash-drop-target")
			.classList.contains("is-visible");
		pressGrip();
		document.dispatchEvent(new window.MouseEvent("pointermove", { clientX: dropX, clientY: dropY, bubbles: true }));
		document.dispatchEvent(new window.MouseEvent("pointerup", { bubbles: true }));
		await tick(40);
		checks.completedDragCommits = dragInst.x === 3 && dragInst.y === 0;
	} else {
		checks.cancelledDragDoesNotCommit = false;
		checks.noStaleGestureAfterCancel = false;
		checks.completedDragCommits = false;
	}

	// ---- Cancel editing works from the command entry point too ----
	plugin.settings.editMode = false;
	plugin.rerenderDashboard();
	await tick(30);
	plugin.toggleEditMode(); // the command path, not the pencil button
	await tick(30);
	const restored = plugin.settings.layout.find((i) => i.type === "quote");
	const posAtEditStart = { x: restored.x, y: restored.y };
	restored.x = 11;
	restored.y = 30;
	const cancelEdit = content.querySelector('.dash-control-right .dash-btn[aria-label="Cancel editing"]');
	if (cancelEdit) cancelEdit.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	await tick(30);
	const afterCancel = plugin.settings.layout.find((i) => i.type === "quote");
	checks.cancelAfterCommandToggleRestores = afterCancel.x === posAtEditStart.x && afterCancel.y === posAtEditStart.y;
	checks.cancelLeavesEditMode = plugin.settings.editMode === false;

	// ---- a checkbox inside a code fence is a code sample, not a task ----
	const fenceDaily = app.vault.getAbstractFileByPath(plugin.dailyNotePath(new Date()));
	if (fenceDaily) {
		await app.vault.modify(fenceDaily, "# doc\n- [ ] real task\n```\n- [ ] fenced task\n```\n- [x] finished task");
		plugin.refreshActivityWidgets();
		await tick(40);
		const taskNames = [...content.querySelectorAll(".widget-tasks .dash-task .dash-list-name")].map((e) => e.textContent);
		checks.fencedCheckboxIgnored = taskNames.includes("real task") && !taskNames.includes("fenced task");
		const realTask = content.querySelector(".widget-tasks .dash-task .dash-check");
		if (realTask) {
			realTask.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
			await tick(40);
			const fenceText = await app.vault.read(fenceDaily);
			checks.fencedLineNeverRewritten =
				fenceText.includes("- [ ] fenced task") && fenceText.includes("- [x] real task");
		} else {
			checks.fencedLineNeverRewritten = false;
		}
	} else {
		checks.fencedCheckboxIgnored = false;
		checks.fencedLineNeverRewritten = false;
	}

	// ---- midnight rollover: the board follows the local date ----
	const tomorrow = new Date(Date.now() + 86400000);
	const tomorrowPath = plugin.dailyNotePath(tomorrow);
	await app.vault.create(tomorrowPath, "- [ ] tomorrow task");
	plugin.refreshActivityWidgets();
	await tick(40);
	const openTaskNames = () => [...content.querySelectorAll(".widget-tasks .dash-task .dash-list-name")].map((e) => e.textContent);
	checks.beforeRolloverShowsToday = !openTaskNames().includes("tomorrow task");
	const RealDate = Date;
	globalThis.Date = class extends RealDate {
		constructor(...args) {
			if (args.length === 0) super(RealDate.now() + 86400000);
			else super(...args);
		}
		static now() {
			return RealDate.now() + 86400000;
		}
	};
	try {
		await tick(1400); // the rollover watcher checks once a second
		checks.rolloverFollowsNewDay = openTaskNames().includes("tomorrow task");
	} finally {
		globalThis.Date = RealDate;
	}
	plugin.rerenderDashboard();
	await tick(40);
	checks.boardReturnsToToday = !openTaskNames().includes("tomorrow task");

	// ---- MED-10: a burst of vault writes refreshes the widgets once ----
	let burstRefreshes = 0;
	const originalViewRefresh = view.refreshActivityWidgets.bind(view);
	view.refreshActivityWidgets = () => {
		burstRefreshes++;
		originalViewRefresh();
	};
	const burstFile = app.vault.getAbstractFileByPath(plugin.dailyNotePath(new Date()));
	for (let i = 0; i < 8; i++) await app.vault.modify(burstFile, `- [ ] burst ${i}`);
	await tick(900);
	view.refreshActivityWidgets = originalViewRefresh;
	checks.burstCoalescedIntoOneRefresh = burstRefreshes === 1;

	// ---- LOW-03: a collapsed widget occupies one row and gives it back ----
	const collapsedLayout = [{ type: "deadline", uid: "z1", x: 0, y: 0, w: 4, h: 4, settings: {}, collapsed: true }];
	checks.collapsedOccupiesOneRow = gridRows(collapsedLayout) === 1;
	checks.collapsedRowIsUsable = !hasOverlap(collapsedLayout, {
		type: "random",
		uid: "z2",
		x: 0,
		y: 1,
		w: 4,
		h: 2,
		settings: {},
	});
	const collapsePlugin = new AuroraDashboardPlugin(new App(), { id: "cool-dashboard" });
	collapsePlugin._data = {
		version: 3,
		layout: [
			{ type: "deadline", uid: "z1", x: 0, y: 0, w: 4, h: 4, settings: {}, collapsed: true },
			{ type: "random", uid: "z2", x: 0, y: 1, w: 4, h: 2, settings: {} },
		],
	};
	await collapsePlugin.onload();
	const collapseView = new DashboardView(collapsePlugin.app.workspace.getLeaf(false), collapsePlugin);
	await collapseView.onOpen();
	const toggleCollapse = collapseView.contentEl.querySelector('.dash-widget[data-uid="z1"] .dash-widget-collapse');
	if (toggleCollapse) toggleCollapse.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	await tick(40);
	const expanded = collapsePlugin.settings.layout;
	checks.expandingResolvesOverlap = !expanded.some((inst, i) => hasOverlap(expanded.slice(0, i), inst));

	// ---- LOW-07: the migration's write has landed before loadSettings returns ----
	checks.migrationSaveLandsBeforeReturn = badVersion._data.version === 3;

	// ---- LOW-11: a widget that throws after subscribing still releases it ----
	registerWidgetType({
		type: "thrower",
		name: "Thrower",
		description: "smoke-test stand-in",
		icon: "x",
		defaultSize: { w: 3, h: 2 },
		render(ctx) {
			const ref = ctx.plugin.app.workspace.on("active-leaf-change", () => {});
			ctx.onDispose(() => ctx.plugin.app.workspace.offref(ref));
			throw new Error("boom");
		},
	});
	const offrefsBefore = plugin.app.workspace._offrefs.length;
	const realConsoleError = console.error;
	console.error = () => {}; // the throw below is the point of this check
	plugin.addWidget("thrower");
	await tick(40);
	console.error = realConsoleError;
	checks.throwingWidgetShowsErrorCard = !!content.querySelector(".widget-thrower .dash-widget-error");
	plugin.settings.layout = plugin.settings.layout.filter((i) => i.type !== "thrower");
	plugin.rerenderDashboard();
	await tick(40);
	checks.throwingWidgetSubscriptionReleased = plugin.app.workspace._offrefs.length > offrefsBefore;

	// ---- LOW-12: a single-edit day is a lit square, not "NaN" ----
	const heatPlugin = new AuroraDashboardPlugin(new App(), { id: "cool-dashboard" });
	heatPlugin._data = {
		version: 3,
		activity: { [dateKeyNow()]: 1 },
		layout: [{ type: "activity", uid: "h1", x: 0, y: 0, w: 3, h: 4, settings: {} }],
	};
	await heatPlugin.onload();
	const heatView = new DashboardView(heatPlugin.app.workspace.getLeaf(false), heatPlugin);
	await heatView.onOpen();
	const heatLevels = [...heatView.contentEl.querySelectorAll(".dash-heatmap [data-lvl]")].map((e) =>
		e.getAttribute("data-lvl")
	);
	checks.heatmapHasNoNaNLevel = heatLevels.length > 0 && !heatLevels.includes("NaN");
	checks.singleEditDayIsFullyLit = heatLevels.includes("4");

	// ---- LOW-13: the year ring counts calendar days, not elapsed milliseconds ----
	const progPlugin = new AuroraDashboardPlugin(new App(), { id: "cool-dashboard" });
	progPlugin._data = {
		version: 3,
		layout: [{ type: "progress", uid: "p1", x: 0, y: 0, w: 4, h: 2, settings: {} }],
	};
	const DateBeforeRing = Date;
	// A clock an hour behind its calendar date, as it is for the first hour after
	// a DST jump: naive ms arithmetic then reports one day too few.
	globalThis.Date = class extends DateBeforeRing {
		constructor(...args) {
			if (args.length === 0) super(2026, 2, 10, 0, 30);
			else super(...args);
		}
		getTime() {
			const t = super.getTime();
			return t >= new DateBeforeRing(2026, 2, 1).getTime() ? t - 3600000 : t;
		}
		static now() {
			return new DateBeforeRing(2026, 2, 10, 0, 30).getTime() - 3600000;
		}
	};
	let progView = null;
	try {
		await progPlugin.onload();
		progView = new DashboardView(progPlugin.app.workspace.getLeaf(false), progPlugin);
		await progView.onOpen();
	} finally {
		globalThis.Date = DateBeforeRing;
	}
	const yearBar = progView.contentEl.querySelectorAll(".dash-prog-ring .dash-ring-bar")[2];
	const circumference = 2 * Math.PI * 52;
	const expectedYearOffset = circumference * (1 - 69 / 365); // Mar 10 2026 is day 69
	checks.yearRingCountsCalendarDays =
		Math.abs(parseFloat(yearBar.getAttribute("stroke-dashoffset")) - expectedYearOffset) < 0.5;

	// ---- LOW-14: an impossible date is not silently normalised ----
	const deadlineInst = plugin.settings.layout.find((i) => i.type === "deadline");
	if (deadlineInst) {
		deadlineInst.settings.date = "2026-02-30";
		plugin.refreshWidget(deadlineInst.uid);
		await tick(40);
		const badDays = content.querySelector(".widget-deadline .dash-deadline-days");
		checks.impossibleDateRejected = !!badDays && badDays.textContent.trim() === "—";
		deadlineInst.settings.date = "2099-01-01";
		plugin.refreshWidget(deadlineInst.uid);
		await tick(40);
		const goodDays = content.querySelector(".widget-deadline .dash-deadline-days");
		checks.validDateStillCounts = !!goodDays && /^\d+$/.test(goodDays.textContent.trim());
	} else {
		checks.impossibleDateRejected = false;
		checks.validDateStillCounts = false;
	}

	// ---- LOW-15: "Best" is not capped below the current streak ----
	const streakPlugin = new AuroraDashboardPlugin(new App(), { id: "cool-dashboard" });
	streakPlugin._data = {
		version: 3,
		layout: [{ type: "streak", uid: "s1", x: 0, y: 0, w: 4, h: 2, settings: {} }],
	};
	await streakPlugin.onload();
	const today0 = new Date();
	for (let i = 0; i < 1000; i++) {
		const day = shiftDays(today0, -i);
		const f = await streakPlugin.app.vault.create(streakPlugin.dailyNotePath(day), "");
		f.stat.ctime = day.getTime();
		f.stat.mtime = day.getTime();
	}
	const streakView = new DashboardView(streakPlugin.app.workspace.getLeaf(false), streakPlugin);
	await streakView.onOpen();
	const streakChips = [...streakView.contentEl.querySelectorAll(".dash-hm-chip")].map((e) => e.textContent);
	checks.bestStreakIsUnbounded = streakChips.includes("Best · 1000d");
	const streakNum = streakView.contentEl.querySelector(".dash-streak-num");
	checks.currentStreakIsThousand = !!streakNum && streakNum.textContent === "1000";

	// ---- LOW-16: a hand-written habit keeps one identity across renders ----
	const habitPlugin = new AuroraDashboardPlugin(new App(), { id: "cool-dashboard" });
	habitPlugin._data = {
		version: 3,
		layout: [
			{
				type: "habits",
				uid: "hb",
				x: 0,
				y: 0,
				w: 6,
				h: 4,
				settings: { habits: [{ name: "NoId" }, { name: "AlsoNoId" }], days: 7, log: {} },
			},
		],
	};
	await habitPlugin.onload();
	const habitView = new DashboardView(habitPlugin.app.workspace.getLeaf(false), habitPlugin);
	await habitView.onOpen();
	const habitIds = () =>
		[...habitView.contentEl.querySelectorAll(".dash-habit-cell")].map((e) => e.getAttribute("data-hid"));
	const firstIds = habitIds();
	habitView.refreshWidget("hb");
	await tick(40);
	checks.legacyHabitIdsAreStable = firstIds.length > 0 && JSON.stringify(firstIds) === JSON.stringify(habitIds());
	checks.legacyHabitIdsAreDistinct = new Set(firstIds).size === 2;

	// ---- LOW-17: every marker Obsidian renders as a checkbox counts ----
	const markDaily = app.vault.getAbstractFileByPath(plugin.dailyNotePath(new Date()));
	if (markDaily) {
		await app.vault.modify(markDaily, "+ [ ] plus task\n1. [ ] numbered task\n2) [ ] paren task\n- [ ] hyphen task");
		plugin.refreshActivityWidgets();
		await tick(40);
		const markNames = [...content.querySelectorAll(".widget-tasks .dash-task .dash-list-name")].map((e) => e.textContent);
		checks.allCheckboxMarkersListed =
			markNames.includes("plus task") &&
			markNames.includes("numbered task") &&
			markNames.includes("paren task") &&
			markNames.includes("hyphen task");
		const plusRow = [...content.querySelectorAll(".widget-tasks .dash-task")].find((r) =>
			r.textContent.includes("plus task")
		);
		if (plusRow) {
			plusRow.querySelector(".dash-check").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
			await tick(40);
			checks.plusMarkerToggles = (await app.vault.read(markDaily)).includes("+ [x] plus task");
		} else {
			checks.plusMarkerToggles = false;
		}
	} else {
		checks.allCheckboxMarkersListed = false;
		checks.plusMarkerToggles = false;
	}

	// ---- LOW-18: a stale cached line hits the nearest twin, not the first ----
	const twinFile = await app.vault.create("Notes/Twins.md", "x\n- [ ] dup task\ny\n- [ ] dup task");
	plugin.refreshActivityWidgets();
	await tick(60);
	// The suite adds a second All-tasks widget, so scope to the first body.
	const twinBody = content.querySelector(".widget-vaulttasks");
	const twinRows = () =>
		twinBody
			? [...twinBody.querySelectorAll(".dash-list-row")].filter((r) => r.textContent.includes("dup task"))
			: [];
	checks.twinTasksListed = twinRows().length === 2;
	if (twinRows().length === 2) {
		// Shift the file without changing its mtime, so the widget's cached line is stale.
		twinFile._content = "new\nx\n- [ ] dup task\ny\n- [ ] dup task";
		twinRows()[1].querySelector(".dash-check").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
		await tick(60);
		const twinLines = (await app.vault.read(twinFile)).split("\n");
		checks.staleIndexHitsNearestTwin = twinLines[2] === "- [ ] dup task" && twinLines[4] === "- [x] dup task";
	} else {
		checks.staleIndexHitsNearestTwin = false;
	}

	// ---- LOW-19: two notes from a template in the same second ----
	const tmplFile = await app.vault.create("Templates/Weekly.md", "# template");
	const qaInst = plugin.settings.layout.find((i) => i.type === "quickactions");
	if (qaInst) {
		qaInst.settings.actions = [{ id: "tpl1", label: "Tpl", kind: "template", target: tmplFile.path }];
		plugin.refreshWidget(qaInst.uid);
		await tick(40);
		const tplBtn = content.querySelector(".widget-quickactions .dash-quick-btn");
		if (tplBtn) {
			tplBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
			await tick(60);
			tplBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
			await tick(60);
		}
		const madeFromTemplate = plugin.app.vault.files.filter(
			(f) => f.path.startsWith("Templates/") && f.path !== "Templates/Weekly.md"
		);
		checks.templateTwiceInSameMoment = madeFromTemplate.length === 2;
	} else {
		checks.templateTwiceInSameMoment = false;
	}

	// ---- LOW-20: the release path is guarded ----
	const manifestJson = require("../manifest.json");
	const pkgJson = require("../package.json");
	const versionsJson = require("../versions.json");
	checks.releaseVersionsAgree =
		manifestJson.version === pkgJson.version && typeof versionsJson[manifestJson.version] === "string";
	const releaseYml = require("fs").readFileSync(__dirname + "/../.github/workflows/release.yml", "utf8");
	checks.releaseWorkflowChecksTag = releaseYml.includes("Verify the tag matches the plugin version");

	// ---- Obsidian review guards (things tsc cannot catch) ----
	const fs = require("fs");
	const srcFiles = [];
	(function walk(dir) {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const p = dir + "/" + entry.name;
			if (entry.isDirectory()) walk(p);
			else if (p.endsWith(".ts")) srcFiles.push(p);
		}
	})(__dirname + "/../src");
	const es2019Offenders = [];
	for (const file of srcFiles) {
		fs.readFileSync(file, "utf8")
			.split("\n")
			.forEach((line, i) => {
				if (/\.(trimStart|trimEnd|flatMap|matchAll|replaceAll)\(|Object\.fromEntries/.test(line)) {
					es2019Offenders.push(file.split(/[\\/]/).pop() + ":" + (i + 1));
				}
			});
	}
	// The plugin targets ES2018, where those methods do not exist; the reviewer
	// reports them as unsafe calls because the type information degrades to `any`.
	checks.noEs2019LibraryCalls = es2019Offenders;
	checks.noDefaultHotkeys = (plugin._commands || []).every((c) => !c.hotkeys);
	const readmeText = fs.readFileSync(__dirname + "/../README.md", "utf8");
	checks.readmeSendsUsersToHotkeySettings = readmeText.includes("Settings → Hotkeys");
	checks.readmeDoesNotPromiseADefaultHotkey = !readmeText.includes("Ctrl/Cmd + Shift + D");

	// ---- LOW-21: the accent picker shows what the dashboard uses ----
	tabPlugin.settings.accent = "#10b981";
	checks.accentControlShowsStoredAccent = tabPlugin._settingTab.getControlValue("accent") === "#10b981";
	tabPlugin.settings.accent = "";
	document.body.style.setProperty("--interactive-accent", "#123456");
	checks.accentControlFollowsTheme = tabPlugin._settingTab.getControlValue("accent") === "#123456";
	document.body.style.removeProperty("--interactive-accent");

	// ---- modal editors save as they go (reported bug: pins lost on close) ----
	// Every one of these editors used to keep its edits in a local array and only
	// write them on an explicit "Done"; closing with the ✕ discarded the lot.
	const modalPlugin = new AuroraDashboardPlugin(new App(), { id: "cool-dashboard" });
	modalPlugin._data = {
		version: 3,
		layout: [
			{ type: "pinned", uid: "pn", x: 0, y: 0, w: 4, h: 3, settings: { pins: [] } },
			{ type: "quickactions", uid: "qa1", x: 0, y: 3, w: 4, h: 3, settings: { actions: [] } },
			{ type: "habits", uid: "hb2", x: 0, y: 6, w: 6, h: 4, settings: { habits: [], days: 7, log: {} } },
			{ type: "embed", uid: "em1", x: 6, y: 6, w: 6, h: 4, settings: { mode: "daily", path: "", markdown: "", scroll: true } },
		],
	};
	await modalPlugin.onload();
	await modalPlugin.app.vault.create("RESSOURCES/Liens/AVAIA.md", "# AVAIA");
	await modalPlugin.app.vault.create("Notes/Other.md", "# Other");
	const modalLeaf = modalPlugin.app.workspace.getLeaf(false);
	const modalView = new DashboardView(modalLeaf, modalPlugin);
	modalLeaf.view = modalView; // refreshWidget needs the leaf to expose the view
	await modalView.onOpen();
	await tick(40);

	const byUid = (uid) => modalPlugin.settings.layout.find((i) => i.uid === uid);
	const pinInst = byUid("pn");
	const widgetText = (uid) => {
		const card = modalView.contentEl.querySelector(`.dash-widget[data-uid="${uid}"]`);
		return card ? card.textContent : "";
	};

	// pinned: add a note and never press Done
	getWidgetTypes().find((t) => t.type === "pinned").openSettings(modalPlugin, pinInst);
	await tick(20);
	const pinModal = Modal.last;
	const pinInput = pinModal.contentEl.querySelector("input.dash-qa-input");
	pinInput.value = "RESSOURCES/Liens/AVAIA.md";
	pinModal.contentEl.querySelector(".dash-qa-row .dash-btn").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	await tick(40);
	checks.pinSavedWithoutDone = JSON.stringify(pinInst.settings.pins) === '["RESSOURCES/Liens/AVAIA.md"]';
	checks.pinnedWidgetUpdatesLive = widgetText("pn").includes("AVAIA");

	// a path typed but never submitted is rescued when the modal closes
	// (re-query: submitting above re-rendered the modal, replacing the input)
	const pinInputAfterAdd = pinModal.contentEl.querySelector("input.dash-qa-input");
	pinInputAfterAdd.value = "Notes/Other.md";
	pinModal.close();
	await tick(40);
	checks.typedPathRescuedOnClose = (pinInst.settings.pins || []).includes("Notes/Other.md");

	// unpinning persists immediately too
	getWidgetTypes().find((t) => t.type === "pinned").openSettings(modalPlugin, pinInst);
	await tick(20);
	const pinModal2 = Modal.last;
	const pinRows = pinModal2.contentEl.querySelectorAll(".dash-qa-list .dash-qa-row");
	if (pinRows.length) {
		pinRows[0].querySelector(".dash-btn-danger").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
		await tick(40);
	}
	checks.unpinPersistsImmediately =
		(pinInst.settings.pins || []).length === 1 && pinInst.settings.pins[0] === "Notes/Other.md";
	pinModal2.close();

	// quick actions: add one, close without Done
	const qaInst2 = byUid("qa1");
	getWidgetTypes().find((t) => t.type === "quickactions").openSettings(modalPlugin, qaInst2);
	await tick(20);
	const qaModal = Modal.last;
	qaModal.contentEl.querySelector(".dash-modal-foot .dash-btn-accent").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	await tick(40);
	checks.quickActionSavedWithoutDone = Array.isArray(qaInst2.settings.actions) && qaInst2.settings.actions.length === 1;
	qaModal.close();

	// habits: add one, close without Done
	const habInst2 = byUid("hb2");
	getWidgetTypes().find((t) => t.type === "habits").openSettings(modalPlugin, habInst2);
	await tick(20);
	const habModal = Modal.last;
	const habAddRow = [...habModal.contentEl.querySelectorAll(".dash-qa-row")][1];
	habAddRow.querySelector("input").value = "Meditate";
	habAddRow.querySelector(".dash-btn").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	await tick(40);
	checks.habitSavedWithoutDone = (habInst2.settings.habits || []).some((h) => h.name === "Meditate");
	habModal.close();

	// embed: edit inline markdown, close without Done
	const embInst2 = byUid("em1");
	getWidgetTypes().find((t) => t.type === "embed").openSettings(modalPlugin, embInst2);
	await tick(20);
	const embModal = Modal.last;
	const modalClasses = new Set();
	const collectDashClasses = (el) => {
		for (const node of el.querySelectorAll("*")) {
			for (const cls of node.classList) if (cls.indexOf("dash-") === 0) modalClasses.add(cls);
		}
	};
	collectDashClasses(embModal.contentEl);
	const modeSelect = embModal.contentEl.querySelector("select.dash-embed-select");
	modeSelect.value = "markdown";
	modeSelect.dispatchEvent(new window.Event("change", { bubbles: true }));
	await tick(20);
	collectDashClasses(embModal.contentEl);
	const mdArea = embModal.contentEl.querySelector("textarea.dash-embed-md");
	mdArea.value = "closed without Done";
	mdArea.dispatchEvent(new window.Event("input", { bubbles: true }));
	embModal.close();
	await tick(40);
	checks.embedDraftSavedOnClose = embInst2.settings.mode === "markdown" && embInst2.settings.markdown === "closed without Done";

	// ---- the editors' styling contract. jsdom has no layout engine, but it does
	// parse the stylesheet, so the suite can check that it parses at all, that the
	// selectors those editors depend on exist, and that every class they render has
	// a rule (the audit found twelve selectors that could never match).
	const cssText = require("fs").readFileSync(__dirname + "/../styles.css", "utf8");
	const styleEl = document.createElement("style");
	styleEl.textContent = cssText;
	document.head.appendChild(styleEl);
	let cssRules = [];
	try {
		cssRules = [...document.styleSheets[document.styleSheets.length - 1].cssRules];
	} catch {
		// Leave it empty: stylesheetParsesInFull fails loudly below.
	}
	const selectors = cssRules.map((r) => r.selectorText).filter(Boolean);
	checks.stylesheetParsesInFull = selectors.length > 150;
	checks.editorSelectorsExist = [".dash-btn-accent", ".dash-qa-select", ".dash-qa-input", ".dash-embed-select", ".dash-modal-foot"].filter(
		(sel) => !selectors.includes(sel)
	);
	checks.modalClassesAllHaveRules = [...modalClasses].filter((cls) => !cssText.includes("." + cls));
	checks.modalClassContractIsNotEmpty = modalClasses.size >= 6;
	// The editors are modals, rendered outside .dash-view: the accent has to resolve
	// for them too, or their buttons render as bare text.
	checks.accentIsDefinedOutsideTheDashboard =
		/:root\s*\{[^}]*--dash-accent:\s*var\(--interactive-accent/.test(cssText);
	checks.singleLineControlsShareTheThemeHeight =
		/input\.dash-qa-input,\s*select\.dash-qa-select\s*\{[^}]*height:\s*var\(--input-height/.test(cssText);

	checks.settingsSaved = await plugin.saveSettings().then(() => true).catch(() => false);

	// v1 -> v2 migration: an existing layout without the Habits widget gets one added
	const legacy = new AuroraDashboardPlugin(new App(), { id: "cool-dashboard" });
	legacy._data = {
		version: 1,
		columns: 12,
		rowHeight: 88,
		gap: 14,
		accent: "",
		editMode: false,
		trackActivity: true,
		dailyNoteFolder: "",
		dailyNoteFormat: "YYYY-MM-DD",
		captureTarget: "inbox",
		captureFolder: "",
		inboxFile: "Inbox.md",
		pomodoroFocus: 25,
		pomodoroBreak: 5,
		activity: {},
		layout: [
			{ type: "clock", uid: "a", x: 0, y: 0, w: 4, h: 2, settings: {} },
			{ type: "streak", uid: "b", x: 8, y: 16, w: 4, h: 2, settings: {} },
		],
	};
	await legacy.loadSettings();
	checks.migrationAddsHabits = !!legacy.settings.layout.find((i) => i.type === "habits");
	checks.migrationBumpsVersion = legacy.settings.version === 3;
	checks.migrationAddsEmbed = !!legacy.settings.layout.find((i) => i.type === "embed");

	// v2 -> v3: an existing dashboard gains the Embed widget exactly once
	const upgraded = new AuroraDashboardPlugin(new App(), { id: "cool-dashboard" });
	upgraded._data = {
		version: 2,
		layout: [
			{ type: "clock", uid: "c1", x: 0, y: 0, w: 4, h: 2, settings: {} },
			{ type: "embed", uid: "e1", x: 4, y: 0, w: 6, h: 4, settings: { mode: "markdown", markdown: "kept" } },
		],
	};
	await upgraded.loadSettings();
	checks.embedMigrationDoesNotDuplicate = upgraded.settings.layout.filter((i) => i.type === "embed").length === 1;
	checks.embedMigrationKeepsSettings = upgraded.settings.layout.find((i) => i.type === "embed").settings.markdown === "kept";

	const v2Layout = new AuroraDashboardPlugin(new App(), { id: "cool-dashboard" });
	v2Layout._data = {
		version: 2,
		layout: [{ type: "clock", uid: "c1", x: 0, y: 0, w: 4, h: 2, settings: {} }],
	};
	await v2Layout.loadSettings();
	checks.embedMigrationAddsWidget =
		v2Layout.settings.layout.some((i) => i.type === "embed") && v2Layout.settings.version === 3;
	checks.embedMigrationPersists = v2Layout._data.version === 3;

	// a malformed layout entry must not take the whole plugin down with it
	const broken = new AuroraDashboardPlugin(new App(), { id: "cool-dashboard" });
	broken._data = {
		version: 3,
		layout: [null, 7, "junk", { type: "clock", uid: "k", x: 0, y: 0, w: 4, h: 2, settings: {} }],
	};
	let onloadThrew = false;
	try {
		await broken.onload();
	} catch (e) {
		onloadThrew = true;
	}
	checks.corruptDataStillLoads = !onloadThrew;
	checks.corruptDataRegistersView = !!broken.app.workspace._viewFactories["aurora-dashboard-view"];
	checks.corruptDataKeepsValidWidget =
		broken.settings.layout.length === 1 && broken.settings.layout[0].type === "clock";

	// a widget from another plugin version is kept, not deleted
	const unknown = new AuroraDashboardPlugin(new App(), { id: "cool-dashboard" });
	unknown._data = {
		version: 3,
		layout: [
			{ type: "clock", uid: "c", x: 0, y: 0, w: 4, h: 2, settings: {} },
			{ type: "from-newer-version", uid: "z", x: 4, y: 0, w: 4, h: 2, settings: { keep: "me" } },
		],
	};
	await unknown.loadSettings();
	checks.unknownTypeQuarantined = unknown.settings.layout.length === 1 && unknown.settings.orphans.length === 1;
	checks.unknownTypeKeepsItsSettings = unknown.settings.orphans[0].settings.keep === "me";
	await unknown.saveSettings();
	checks.unknownTypeSurvivesSave = unknown._data.orphans.length === 1 && unknown._data.orphans[0].uid === "z";
	checks.unknownTypeOutOfLayout = unknown._data.layout.every((i) => i.type !== "from-newer-version");

	// ...and it comes back once that type exists again
	registerWidgetType({
		type: "from-newer-version",
		name: "From a newer version",
		description: "smoke-test stand-in",
		icon: "box",
		defaultSize: { w: 4, h: 2 },
		render() {
			return {};
		},
	});
	await unknown.loadSettings();
	checks.orphanReturnsWhenTypeKnown =
		unknown.settings.orphans.length === 0 &&
		unknown.settings.layout.some((i) => i.type === "from-newer-version");

	const failed = Object.entries(checks).filter(
		([, v]) => v === false || v === undefined || (Array.isArray(v) && v.length > 0)
	);
	console.log("SMOKE CHECKS:\n" + JSON.stringify(checks, null, 2));
	if (failed.length) {
		console.error("FAILED CHECKS:", JSON.stringify(failed));
		process.exit(1);
	}
	console.log("SMOKE TEST PASSED");
	process.exit(0);
}

main().catch((e) => {
	console.error("SMOKE TEST ERROR:", e);
	process.exit(1);
});
