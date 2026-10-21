import { App, Modal, Notice, Plugin, PluginSettingTab, TFile, normalizePath, type SettingDefinitionItem } from "obsidian";
import "./widgets/index";
import { DashboardView, VIEW_TYPE_DASHBOARD } from "./view";
import type { DashboardPlugin, Settings, WidgetInstance } from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { widgetType } from "./registry";
import { clampLayout, defaultLayout, findFirstFree } from "./layout";
import { dateKey as dk, formatDate as fmtDate, uid } from "./utils";

/** Vault writes are coalesced into a single widget refresh this far apart. */
const REFRESH_DELAY = 500;
/** Shown when the theme exposes no usable accent colour. */
const DEFAULT_ACCENT = "#7c3aed";

export default class AuroraDashboardPlugin extends Plugin implements DashboardPlugin {
	settings: Settings;
	private saveTimer: number | null = null;
	private refreshTimer: number | null = null;

	async onload(): Promise<void> {
		try {
			await this.loadSettings();
		} catch (e) {
			// A hand-edited or corrupt data.json must never make the plugin
			// unloadable: fall back to defaults so the view, ribbon icon,
			// commands and settings tab still register.
			console.error("Aurora Dashboard: settings could not be loaded, using defaults.", e);
			this.settings = Object.assign({}, DEFAULT_SETTINGS, {
				layout: defaultLayout(),
				orphans: [],
				activity: {},
			});
		}

		this.registerView(VIEW_TYPE_DASHBOARD, (leaf) => new DashboardView(leaf, this));

		this.addRibbonIcon("layout-dashboard", "Open dashboard", () => void this.activateView());

		this.addCommand({
			id: "open-dashboard",
			name: "Open dashboard",
			// No default hotkey on purpose: shipping one can collide with bindings
			// the user already has. Assign it under Settings -> Hotkeys.
			callback: () => void this.activateView(),
		});
		this.addCommand({
			id: "toggle-edit-mode",
			name: "Toggle dashboard edit mode",
			callback: () => this.toggleEditMode(),
		});
		this.addCommand({
			id: "capture-to-inbox",
			name: "Capture to inbox",
			callback: () => this.showQuickCapture(),
		});

		this.addSettingTab(new DashboardSettingTab(this.app, this));

		this.registerEvent(this.app.vault.on("create", (f) => this.onFileActivity(f)));
		this.registerEvent(this.app.vault.on("modify", (f) => this.onFileActivity(f)));
	}

	onunload(): void {
		// Flush instead of dropping the newest activity counts, and make sure a
		// dead instance can never write its stale snapshot over a fresh one.
		if (this.saveTimer !== null) {
			window.clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
		if (this.refreshTimer !== null) {
			window.clearTimeout(this.refreshTimer);
			this.refreshTimer = null;
		}
		void this.saveSettings();
	}

	// ---- data ----

	async loadSettings(): Promise<void> {
		const raw = (await this.loadData()) as Partial<Settings> | null;
		// An explicitly stored layout is respected even when it is empty: removing
		// every widget is a user decision, not an uninitialised file.
		const hadLayout = isPlainObject(raw) && Array.isArray(raw.layout);
		this.settings = Object.assign({}, DEFAULT_SETTINGS, raw ?? {});

		// Scalars: a hand-edited or sync-damaged file must not be able to inject
		// invalid CSS or break the grid arithmetic.
		const s = this.settings;
		s.columns = numOr(s.columns, 12, 8, 16);
		s.rowHeight = numOr(s.rowHeight, 88, 60, 140);
		s.gap = numOr(s.gap, 14, 8, 28);
		s.accent = strOr(s.accent, "");
		s.dailyNoteFolder = strOr(s.dailyNoteFolder, "");
		s.dailyNoteFormat = strOr(s.dailyNoteFormat, DEFAULT_SETTINGS.dailyNoteFormat);
		s.captureFolder = strOr(s.captureFolder, "");
		s.inboxFile = strOr(s.inboxFile, DEFAULT_SETTINGS.inboxFile);
		s.captureTarget = s.captureTarget === "daily" ? "daily" : "inbox";
		s.pomodoroFocus = numOr(s.pomodoroFocus, 25, 1, 120);
		s.pomodoroBreak = numOr(s.pomodoroBreak, 5, 1, 60);
		s.trackActivity = s.trackActivity !== false;
		s.editMode = s.editMode === true;
		// A non-numeric version must still run the migrations below.
		s.version = numOr(s.version, 0, 0, 1000);

		// Activity: a fresh map holding only positive finite numbers, never the
		// shared DEFAULT_SETTINGS object.
		const activity: Record<string, number> = {};
		if (isPlainObject(s.activity)) {
			for (const [day, count] of Object.entries(s.activity)) {
				const n = Number(count);
				if (Number.isFinite(n) && n > 0) activity[day] = Math.round(n);
			}
		}
		s.activity = activity;

		if (!Array.isArray(s.layout) || (s.layout.length === 0 && !hadLayout)) {
			s.layout = defaultLayout(s.columns);
		}
		s.orphans = Array.isArray(s.orphans) ? s.orphans : [];

		// Every entry is re-validated before use: a single malformed entry used to
		// throw out of onload() and leave the plugin permanently unloadable.
		const seen = new Set<string>();
		const kept: WidgetInstance[] = [];
		const quarantined: WidgetInstance[] = [];
		for (const entry of s.layout) {
			if (!isWidgetInstance(entry)) continue;
			if (this.adoptInstance(entry, seen)) kept.push(entry);
			else quarantined.push(entry);
		}

		// Widgets set aside by an earlier load come back once their type exists again.
		const stillQuarantined: WidgetInstance[] = [...quarantined];
		for (const entry of s.orphans) {
			if (!isWidgetInstance(entry)) continue;
			if (this.adoptInstance(entry, seen)) kept.push(entry);
			else stillQuarantined.push(entry);
		}

		s.layout = kept;
		s.orphans = stillQuarantined;
		if (stillQuarantined.length) {
			new Notice(
				`Aurora Dashboard: ${stillQuarantined.length} widget${
					stillQuarantined.length === 1 ? "" : "s"
				} kept aside — unknown type for this version.`
			);
		}

		// Persisted geometry is repaired on load, never rendered outside the grid.
		if (clampLayout(s.layout, s.columns)) await this.saveSettings();

		// v2 / v3: widgets that became part of the default board are added to
		// existing layouts once, so nobody has to add them by hand.
		if (this.settings.version < 2) {
			this.addWidgetToLayout("habits");
			this.settings.version = 2;
			await this.saveSettings();
		}
		if (this.settings.version < 3) {
			this.addWidgetToLayout("embed");
			this.settings.version = 3;
			await this.saveSettings();
		}
	}

	/** Put one widget of `type` on the board, unless it already has one. */
	private addWidgetToLayout(type: string): void {
		const t = widgetType(type);
		if (!t || this.settings.layout.some((i) => i.type === type)) return;
		const pos = findFirstFree(this.settings.layout, t.defaultSize, this.settings.columns);
		this.settings.layout.push({
			type,
			uid: uid(),
			x: pos.x,
			y: pos.y,
			w: t.defaultSize.w,
			h: t.defaultSize.h,
			settings: { ...(t.defaultSettings ?? {}) },
		});
	}

	/**
	 * Prepare a persisted instance for use. Returns false when its widget type is
	 * not registered in this build — the caller keeps it instead of dropping it.
	 */
	private adoptInstance(inst: WidgetInstance, seen: Set<string>): boolean {
		const t = widgetType(inst.type);
		if (!t) return false;
		// A uid is a widget's only identity: duplicates make two cards inseparable
		// (one stops refreshing, and ✕ removes both), so repair them on load.
		if (!inst.uid || seen.has(inst.uid)) inst.uid = uid();
		seen.add(inst.uid);
		const saved = isPlainObject(inst.settings) ? inst.settings : {};
		inst.settings = t.defaultSettings ? Object.assign({}, t.defaultSettings, saved) : saved;
		return true;
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private queueSave(): void {
		if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
		this.saveTimer = window.setTimeout(() => {
			this.saveTimer = null;
			void this.saveSettings();
		}, 500);
	}

	private forDashboard(fn: (v: DashboardView) => void): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD)) {
			if (leaf.view instanceof DashboardView) fn(leaf.view);
		}
	}

	rerenderDashboard(): void {
		this.forDashboard((v) => v.render());
	}

	// ---- commands / navigation ----

	async activateView(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD);
		if (existing.length) {
			await this.app.workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = this.app.workspace.getLeaf(false);
		await leaf.setViewState({ type: VIEW_TYPE_DASHBOARD, active: true });
		void this.app.workspace.revealLeaf(leaf);
	}

	toggleEditMode(): void {
		this.settings.editMode = !this.settings.editMode;
		void this.saveSettings();
		this.rerenderDashboard();
	}

	openFile(f: TFile | null): void {
		if (f) void this.app.workspace.getLeaf(false).openFile(f);
	}

	async openDay(d: Date): Promise<void> {
		const path = this.dailyNotePath(d);
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) {
			await this.app.workspace.getLeaf(false).openFile(existing);
			return;
		}
		try {
			// The folder is usually the part that is missing, so create the whole
			// chain before writing the note.
			await this.ensureFolder(parentOf(path));
			this.markSelfWrite(path);
			const f = await this.app.vault.create(path, "");
			await this.app.workspace.getLeaf(false).openFile(f);
		} catch (e) {
			console.error("Aurora Dashboard: could not create the daily note.", path, e);
			new Notice("Could not create " + path + " — is the folder there?");
		}
	}

	async openSearch(query: string): Promise<void> {
		const leaf = this.app.workspace.getLeaf("tab");
		await leaf.setViewState({ type: "search", state: { query } });
	}

	// ---- daily notes ----

	formatDate(d: Date, fmt: string): string {
		return fmtDate(d, fmt);
	}

	dailyNotePath(d: Date): string {
		const folder = this.settings.dailyNoteFolder.trim();
		let name = this.formatDate(d, this.settings.dailyNoteFormat).trim();
		// A blank format would otherwise resolve to a hidden "Daily/.md".
		if (!name) name = this.formatDate(d, DEFAULT_SETTINGS.dailyNoteFormat);
		return normalizePath(folder ? folder + "/" + name + ".md" : name + ".md");
	}

	noteExistsFor(d: Date): boolean {
		return this.app.vault.getAbstractFileByPath(this.dailyNotePath(d)) instanceof TFile;
	}

	// ---- activity tracking ----

	/**
	 * Writing a note is not editing it: opening an empty daily note or capturing a
	 * thought must not inflate the heatmap, so the plugin recognises its own writes.
	 * Path-keyed with a short window, because the vault event may arrive after the
	 * awaited write resolves.
	 */
	private selfWrites = new Map<string, number>();

	private markSelfWrite(path: string): void {
		this.selfWrites.set(path, Date.now());
	}

	private takeSelfWrite(path: string): boolean {
		const at = this.selfWrites.get(path);
		if (at === undefined) return false;
		this.selfWrites.delete(path);
		return Date.now() - at < 5000;
	}

	private onFileActivity(file: unknown): void {
		if (!this.settings.trackActivity) return;
		if (!(file instanceof TFile) || file.extension !== "md") return;
		if (this.takeSelfWrite(file.path)) return;
		this.recordActivity();
	}

	recordActivity(): void {
		const key = dk(new Date());
		this.settings.activity[key] = (this.settings.activity[key] ?? 0) + 1;
		this.queueSave();
		this.queueWidgetRefresh();
	}

	/**
	 * One vault write lands here; an editing session fires dozens of them.
	 * Coalesce them into a single refresh, and skip the work entirely when no
	 * dashboard is open to show it.
	 */
	private queueWidgetRefresh(): void {
		if (this.refreshTimer !== null) return;
		if (!this.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD).length) return;
		this.refreshTimer = window.setTimeout(() => {
			this.refreshTimer = null;
			this.refreshActivityWidgets();
		}, REFRESH_DELAY);
	}

	refreshActivityWidgets(): void {
		this.forDashboard((v) => v.refreshActivityWidgets());
	}

	refreshWidget(uid: string): void {
		this.forDashboard((v) => v.refreshWidget(uid));
	}

	// ---- capture ----

	showQuickCapture(): void {
		new QuickCaptureModal(this.app, this).open();
	}

	async captureText(text: string): Promise<void> {
		const s = this.settings;
		try {
			if (s.captureTarget === "inbox") {
				const dir = normalizePath(s.captureFolder.trim());
				await this.ensureFolder(dir);
				const path = normalizePath((dir ? dir + "/" : "") + inboxFileName(s.inboxFile));
				await this.appendTo(path, text);
			} else {
				const path = this.dailyNotePath(new Date());
				await this.ensureFolder(parentOf(path));
				await this.appendTo(path, `### ${new Date().toLocaleTimeString()}\n${text}`);
			}
		} catch (e) {
			console.error("Aurora Dashboard: capture failed.", e);
			new Notice("Could not save that capture — see the developer console.");
			throw e; // callers keep the user's text on screen
		}
		new Notice("Captured");
	}

	/** Create every missing folder in `dir`, including intermediate ones. */
	private async ensureFolder(dir: string): Promise<void> {
		const norm = normalizePath(dir.trim());
		if (!norm || norm === "." || norm === "/") return;
		let current = "";
		for (const part of norm.split("/").filter(Boolean)) {
			current = current ? current + "/" + part : part;
			if (this.app.vault.getAbstractFileByPath(current)) continue;
			try {
				await this.app.vault.createFolder(current);
			} catch (e) {
				// Tolerate a folder that appeared meanwhile; surface anything else.
				if (!this.app.vault.getAbstractFileByPath(current)) {
					console.error("Aurora Dashboard: could not create folder", current, e);
					throw e;
				}
			}
		}
	}

	private async appendTo(path: string, text: string): Promise<void> {
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) {
			const cur: string = await this.app.vault.read(existing);
			const next = cur.replace(/\s+$/, "") + "\n\n" + text;
			this.markSelfWrite(path);
			await this.app.vault.modify(existing, next);
		} else {
			this.markSelfWrite(path);
			await this.app.vault.create(path, text);
		}
	}

	// ---- widgets ----

	addWidget(type: string): void {
		const t = widgetType(type);
		if (!t) return;
		const size = t.defaultSize;
		const pos = findFirstFree(this.settings.layout, size, this.settings.columns);
		const defaults: Record<string, unknown> = { ...(t.defaultSettings ?? {}) };
		if (type === "pomodoro") {
			defaults.focus = this.settings.pomodoroFocus;
			defaults.break = this.settings.pomodoroBreak;
		}
		const inst: WidgetInstance = {
			type,
			uid: uid(),
			x: pos.x,
			y: pos.y,
			w: size.w,
			h: size.h,
			settings: defaults,
		};
		this.settings.layout.push(inst);
		void this.saveSettings();
		this.rerenderDashboard();
	}
}

class QuickCaptureModal extends Modal {
	plugin: AuroraDashboardPlugin;

	constructor(app: App, plugin: AuroraDashboardPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen(): void {
		this.titleEl.setText("Quick capture");
		const ta = this.contentEl.createEl("textarea", {
			cls: "dash-capture-input dash-modal-capture",
			attr: { placeholder: "Capture a thought…" },
		});
		const foot = this.contentEl.createDiv("dash-modal-foot");
		const target =
			this.plugin.settings.captureTarget === "daily"
				? "today's note"
				: this.plugin.settings.inboxFile;
		foot.createDiv("dash-capture-hint").setText("→ " + target);
		const btn = foot.createDiv("dash-btn dash-btn-accent");
		btn.setText("Capture");

		const doIt = async (): Promise<void> => {
			const t = ta.value.trim();
			if (!t) return;
			try {
				await this.plugin.captureText(t);
				this.close();
			} catch {
				// captureText reported the failure; stay open so the text survives.
			}
		};

		btn.addEventListener("click", () => void doIt());
		ta.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				void doIt();
			}
		});
		ta.focus();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

class DashboardSettingTab extends PluginSettingTab {
	plugin: AuroraDashboardPlugin;

	constructor(app: App, plugin: AuroraDashboardPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	override getControlValue(key: string): unknown {
		// With no accent configured the dashboard follows the theme, so the picker
		// should show that colour rather than a fixed purple swatch.
		if (key === "accent") return this.plugin.settings.accent || themeAccent();
		return (this.plugin.settings as unknown as Record<string, unknown>)[key];
	}

	override setControlValue(key: string, value: unknown): void | Promise<void> {
		const s = this.plugin.settings;
		// Never trust the control: clamp here too, so the tab cannot write an
		// out-of-range value back into a repaired settings file.
		let v = value;
		if (key === "columns") v = numOr(value, s.columns, 8, 16);
		else if (key === "rowHeight") v = numOr(value, s.rowHeight, 60, 140);
		else if (key === "gap") v = numOr(value, s.gap, 8, 28);

		const ret = super.setControlValue(key, v);
		if (key === "captureTarget") this.refreshDomState();
		if (key === "columns") {
			// The board has to agree with its own column count.
			clampLayout(s.layout, s.columns);
			void this.plugin.saveSettings();
			this.plugin.rerenderDashboard();
		}
		return ret;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const s = this.plugin.settings;
		return [
			{
				type: "group",
				heading: "Layout",
				items: [
					{
						name: "Columns",
						desc: "Number of grid columns. More columns means finer-grained widget sizing.",
						control: { type: "slider", key: "columns", min: 8, max: 16, step: 1 },
					},
					{
						name: "Row height",
						control: { type: "slider", key: "rowHeight", min: 60, max: 140, step: 4 },
					},
					{
						name: "Gap",
						desc: "Spacing between widgets.",
						control: { type: "slider", key: "gap", min: 8, max: 28, step: 2 },
					},
					{
						name: "Edit mode",
						desc: "Show widget handles for dragging, resizing and removing.",
						control: { type: "toggle", key: "editMode" },
					},
					{
						name: "Reset layout",
						action: () => {
							s.layout = defaultLayout(s.columns);
							void this.plugin.saveSettings();
							this.plugin.rerenderDashboard();
						},
					},
				],
			},
			{
				type: "group",
				heading: "Appearance",
				items: [
					{
						name: "Accent color",
						desc: "Used for highlights, charts and progress.",
						control: { type: "color", key: "accent" },
					},
					{
						name: "Reset to theme accent",
						action: () => {
							s.accent = "";
							void this.plugin.saveSettings();
							this.plugin.rerenderDashboard();
							this.update();
						},
					},
					{
						name: "Accent presets",
						desc: "One-click options.",
						render: (setting) => {
							const wrap = setting.controlEl.createDiv("dash-accent-presets");
							for (const c of ["#7c3aed", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#14b8a6", "#6366f1"]) {
								const sw = wrap.createDiv("dash-accent-swatch");
								sw.style.setProperty("--dash-accent", c);
								sw.setAttr("aria-label", c);
								sw.addEventListener("click", () => {
									s.accent = c;
									void this.plugin.saveSettings();
									this.plugin.rerenderDashboard();
									this.update();
								});
							}
						},
					},
				],
			},
			{
				type: "group",
				heading: "Activity",
				items: [
					{
						name: "Track activity",
						desc: "Record note edits to power the heatmap, streaks and stats.",
						control: { type: "toggle", key: "trackActivity" },
					},
					{
						name: "Clear data",
						action: () => {
							s.activity = {};
							void this.plugin.saveSettings();
							this.plugin.rerenderDashboard();
						},
					},
				],
			},
			{
				type: "group",
				heading: "Daily notes",
				items: [
					{
						name: "Daily note folder",
						desc: "Optional folder for daily notes (blank = vault root).",
						control: { type: "text", key: "dailyNoteFolder", placeholder: "e.g. Daily" },
					},
					{
						name: "Daily note format",
						desc: "Tokens: YYYY, YY, MMMM, MMM, MM, DD, dd, dddd, ddd. A format may contain folders (e.g. YYYY/MM/DD).",
						control: { type: "text", key: "dailyNoteFormat", placeholder: "YYYY-MM-DD" },
					},
				],
			},
			{
				type: "group",
				heading: "Capture",
				items: [
					{
						name: "Capture target",
						control: { type: "dropdown", key: "captureTarget", options: { inbox: "Inbox file", daily: "Today's daily note" } },
					},
					{
						name: "Capture folder",
						desc: "Optional folder for the inbox file.",
						control: { type: "text", key: "captureFolder", placeholder: "e.g. Inbox" },
						visible: () => s.captureTarget === "inbox",
					},
					{
						name: "Inbox file",
						control: { type: "text", key: "inboxFile", placeholder: "Inbox.md" },
						visible: () => s.captureTarget === "inbox",
					},
				],
			},
			{
				type: "group",
				heading: "Pomodoro",
				items: [
					{
						name: "Focus length",
						desc: "Default work interval (min) for new Pomodoro widgets. Existing widgets keep their own value.",
						control: { type: "number", key: "pomodoroFocus", min: 1, max: 120, placeholder: "25" },
					},
					{
						name: "Break length",
						desc: "Default break (min) for new Pomodoro widgets. Existing widgets keep their own value.",
						control: { type: "number", key: "pomodoroBreak", min: 1, max: 60, placeholder: "5" },
					},
				],
			},
		];
	}
}

/** True for a non-null, non-array object — the only shape persisted data may have. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** True for a layout entry with enough shape to be handled safely. */
function isWidgetInstance(v: unknown): v is WidgetInstance {
	return isPlainObject(v) && typeof (v as { type?: unknown }).type === "string";
}

/** Coerce a persisted value to a whole number inside [min, max]. */
function numOr(v: unknown, def: number, min: number, max: number): number {
	const n = typeof v === "number" ? v : Number(v);
	if (!Number.isFinite(n)) return def;
	return Math.max(min, Math.min(max, Math.round(n)));
}

/** Coerce a persisted value to a string, falling back to the default. */
function strOr(v: unknown, def: string): string {
	return typeof v === "string" ? v : def;
}

/** The folder part of a vault path, or "" for a root-level file. */
function parentOf(path: string): string {
	const slash = path.lastIndexOf("/");
	return slash > 0 ? path.slice(0, slash) : "";
}

/** The inbox file name, always something Obsidian will open as a markdown note. */
function inboxFileName(raw: string): string {
	const name = raw.trim();
	if (!name) return DEFAULT_SETTINGS.inboxFile;
	return /\.(md|markdown)$/i.test(name) ? name : name + ".md";
}

/** The accent Obsidian itself is using, so settings match what the dashboard shows. */
function themeAccent(): string {
	try {
		const raw = getComputedStyle(document.body).getPropertyValue("--interactive-accent").trim();
		if (/^#[0-9a-f]{3,8}$/i.test(raw) || /^rgba?\(/i.test(raw)) return raw;
	} catch {
		/* no DOM available */
	}
	return DEFAULT_ACCENT;
}
