import { App, ItemView, Modal, Notice, Setting, WorkspaceLeaf, setIcon } from "obsidian";
import type { DashboardPlugin, WidgetCtx, WidgetHandle, WidgetInstance, WidgetSetting, WidgetType } from "./types";
import { getWidgetTypes, widgetType } from "./registry";
import { gridRows, hasOverlap, nearestFree, resolveOverlaps } from "./layout";
import { clamp, dateKey } from "./utils";

export const VIEW_TYPE_DASHBOARD = "aurora-dashboard-view";

export class DashboardView extends ItemView {
	plugin: DashboardPlugin;
	private gridEl!: HTMLElement;
	private dropTarget!: HTMLElement;
	private handles = new Map<string, { dispose?: () => void }>();
	private cleanups: Array<() => void> = [];
	private editSnapshot: WidgetInstance[] | null = null;
	/** Bumped on every render, so a gesture from a detached card cannot commit. */
	private renderGen = 0;
	/** The local day the board was last rendered for. */
	private dayKey = "";

	constructor(leaf: WorkspaceLeaf, plugin: DashboardPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_DASHBOARD;
	}
	getDisplayText(): string {
		return "Aurora Dashboard";
	}
	getIcon(): string {
		return "layout-dashboard";
	}

	async onOpen(): Promise<void> {
		this.render();
	}

	onClose(): Promise<void> {
		this.runCleanups();
		this.disposeAll();
		return Promise.resolve();
	}

	// ---- lifecycle ----

	private runCleanups(): void {
		for (const fn of this.cleanups) {
			try {
				fn();
			} catch {
				/* noop */
			}
		}
		this.cleanups = [];
	}

	private disposeAll(): void {
		for (const h of this.handles.values()) {
			try {
				h.dispose?.();
			} catch {
				/* noop */
			}
		}
		this.handles.clear();
	}

	render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("dash-view");
		if (this.plugin.settings.accent) contentEl.style.setProperty("--dash-accent", this.plugin.settings.accent);
		else contentEl.style.removeProperty("--dash-accent");

		const editing = this.plugin.settings.editMode;
		if (editing) contentEl.addClass("editing");
		else contentEl.removeClass("editing");

		// Entering edit mode snapshots the layout, whichever entry point was used —
		// the pencil button or the "Toggle dashboard edit mode" command — so that
		// Cancel editing can always put it back.
		if (editing && !this.editSnapshot) {
			this.editSnapshot = JSON.parse(JSON.stringify(this.plugin.settings.layout)) as WidgetInstance[];
		} else if (!editing) {
			this.editSnapshot = null;
		}

		this.renderGen++;
		this.runCleanups();
		this.disposeAll();

		contentEl.createDiv("dash-scroll", (scroll) => {
			scroll.createDiv("dash-shell", (shell) => {
				this.buildControlBar(shell);
				this.gridEl = shell.createDiv("dash-grid");
				this.applyGrid();
				this.dropTarget = this.gridEl.createDiv("dash-drop-target");
				this.buildWidgets();
			});
		});

		this.watchForNewDay();
	}

	/**
	 * A dashboard is meant to be left open, so the board follows the local date.
	 * Without this the calendar, habits grid, heatmap and Today widget keep
	 * pointing at yesterday after midnight while the clock rolls over.
	 */
	private watchForNewDay(): void {
		this.dayKey = dateKey(new Date());
		const timer = window.setInterval(() => {
			const now = dateKey(new Date());
			if (now === this.dayKey) return;
			this.dayKey = now;
			this.render();
		}, 1000);
		this.cleanups.push(() => window.clearInterval(timer));
	}

	// ---- control center ----

	private greeting(): string {
		const h = new Date().getHours();
		if (h < 5) return "Burning the midnight oil";
		if (h < 12) return "Good morning";
		if (h < 18) return "Good afternoon";
		return "Good evening";
	}

	private buildControlBar(shell: HTMLElement): void {
		const bar = shell.createDiv("dash-control");
		const left = bar.createDiv("dash-control-left");
		const logo = left.createDiv("dash-logo");
		setIcon(logo, "layout-dashboard");
		const brand = left.createDiv("dash-brand");
		brand.createDiv("dash-brand-title").setText("Aurora Dashboard");
		brand.createDiv("dash-brand-sub").setText(
			`${this.greeting()} · ${new Date().toLocaleDateString(undefined, {
				weekday: "long",
				month: "long",
				day: "numeric",
			})}`
		);

		const right = bar.createDiv("dash-control-right");

		const clockChip = right.createDiv("dash-chip dash-chip-time");
		const tick = (): void => clockChip.setText(new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }));
		tick();
		const clockTimer = window.setInterval(tick, 1000);
		this.cleanups.push(() => window.clearInterval(clockTimer));

		const searchBtn = right.createDiv("dash-btn dash-btn-ghost");
		setIcon(searchBtn, "search");
		searchBtn.setAttr("aria-label", "Search");
		searchBtn.addEventListener("click", () => void this.plugin.openSearch(""));

		const captureBtn = right.createDiv("dash-btn dash-btn-ghost");
		setIcon(captureBtn, "send");
		captureBtn.setAttr("aria-label", "Quick capture");
		captureBtn.addEventListener("click", () => this.plugin.showQuickCapture());

		const editing = this.plugin.settings.editMode;
		const editBtn = right.createDiv("dash-btn " + (editing ? "dash-btn-active" : "dash-btn-ghost"));
		setIcon(editBtn, editing ? "check" : "pencil");
		editBtn.setAttr("aria-label", editing ? "Done editing" : "Edit layout");
		editBtn.addEventListener("click", () => {
			this.plugin.settings.editMode = !this.plugin.settings.editMode;
			void this.plugin.saveSettings();
			this.render();
		});

		if (editing) {
			const cancelBtn = right.createDiv("dash-btn dash-btn-ghost");
			setIcon(cancelBtn, "x");
			cancelBtn.setAttr("aria-label", "Cancel editing");
			cancelBtn.addEventListener("click", () => {
				if (this.editSnapshot) this.plugin.settings.layout = this.editSnapshot;
				this.editSnapshot = null;
				this.plugin.settings.editMode = false;
				void this.plugin.saveSettings();
				this.render();
			});
			const addBtn = right.createDiv("dash-btn dash-btn-accent");
			setIcon(addBtn, "plus");
			addBtn.setAttr("aria-label", "Add widget");
			addBtn.addEventListener("click", () => new AddWidgetModal(this.app, this.plugin).open());
		}
	}

	// ---- grid ----

	private applyGrid(): void {
		const s = this.plugin.settings;
		this.gridEl.style.setProperty("--dash-cols", String(s.columns));
		this.gridEl.style.setProperty("--dash-row", s.rowHeight + "px");
		this.gridEl.style.setProperty("--dash-gap", s.gap + "px");
	}

	private buildWidgets(): void {
		for (const inst of this.plugin.settings.layout) this.buildWidgetCard(inst);
	}

	private buildWidgetCard(inst: WidgetInstance): void {
		const type = widgetType(inst.type);
		if (!type) return;
		const card = this.gridEl.createDiv({
			cls: "dash-widget",
			attr: { "data-uid": inst.uid, "data-type": inst.type },
		});
		if (type.noHeader) card.addClass("no-header");
		if (inst.collapsed) card.addClass("collapsed");
		this.position(card, inst);
		this.buildWidgetHeader(card, inst, type);
		const body = card.createDiv("dash-widget-body widget-" + type.type);
		this.renderWidgetBody(body, inst);
		if (this.plugin.settings.editMode) {
			this.enableDrag(card, inst);
			this.enableResize(card, inst);
		}
	}

	private position(card: HTMLElement, inst: WidgetInstance): void {
		card.style.setProperty("--dash-cx", String(inst.x + 1));
		card.style.setProperty("--dash-cy", String(inst.y + 1));
		card.style.setProperty("--dash-cw", String(inst.w));
		card.style.setProperty("--dash-ch", String(inst.collapsed ? 1 : inst.h));
	}

	private buildWidgetHeader(card: HTMLElement, inst: WidgetInstance, type: WidgetType): void {
		const editing = this.plugin.settings.editMode;
		// A no-header widget (the clock) keeps its bare look while in use, but in
		// edit mode it still needs a grip and its actions, or it could never be
		// moved, configured or removed.
		if (type.noHeader && !editing) return;
		const header = card.createDiv("dash-widget-header");
		const grip = header.createDiv("dash-grip");
		setIcon(grip, "grip-vertical");

		if (!type.noHeader) {
			const icon = header.createDiv("dash-widget-icon");
			setIcon(icon, type.icon);
			header.createDiv("dash-widget-title").setText(inst.title || type.name);
			const collapse = header.createDiv("dash-widget-collapse");
			setIcon(collapse, inst.collapsed ? "chevron-right" : "chevron-down");
			collapse.setAttr("aria-label", inst.collapsed ? "Expand widget" : "Collapse widget");
			collapse.addEventListener("click", () => {
				inst.collapsed = !inst.collapsed;
				// Expanding needs the room back that collapsing freed.
				if (!inst.collapsed) resolveOverlaps(this.plugin.settings.layout, this.plugin.settings.columns);
				void this.plugin.saveSettings();
				this.render();
			});
		}

		const actions = header.createDiv("dash-widget-actions");
		if (!editing) return;
		const gear = actions.createDiv("dash-btn");
		setIcon(gear, "settings-2");
		gear.setAttr("aria-label", "Widget settings");
		gear.addEventListener("click", () => this.openWidgetSettings(inst));
		const del = actions.createDiv("dash-btn dash-btn-danger");
		setIcon(del, "x");
		del.setAttr("aria-label", "Remove widget");
		del.addEventListener("click", () => {
			this.plugin.settings.layout = this.plugin.settings.layout.filter((i) => i.uid !== inst.uid);
			void this.plugin.saveSettings();
			this.render();
		});
	}

	private renderWidgetBody(body: HTMLElement, inst: WidgetInstance): void {
		const type = widgetType(inst.type);
		if (!type) return;
		const prev = this.handles.get(inst.uid);
		try {
			prev?.dispose?.();
		} catch {
			/* noop */
		}
		while (body.firstChild) body.removeChild(body.firstChild);

		// A widget can hand its cleanups over while it renders, so a widget that
		// throws after subscribing still releases what it took.
		const disposers: Array<() => void> = [];
		const ctx: WidgetCtx = {
			plugin: this.plugin,
			inst,
			body,
			refresh: () => this.refreshWidget(inst.uid),
			onDispose: (fn) => disposers.push(fn),
		};
		let handle: WidgetHandle = {};
		try {
			handle = type.render(ctx);
		} catch (e) {
			console.error("Dashboard widget failed to render:", inst.type, e);
			body.createDiv("dash-widget-error").setText("This widget hit a snag — try again.");
		}
		this.handles.set(inst.uid, {
			dispose: () => {
				for (const fn of disposers.splice(0)) {
					try {
						fn();
					} catch {
						/* noop */
					}
				}
				handle.dispose?.();
			},
		});
	}

	refreshWidget(uid: string): void {
		const card = this.gridEl.querySelector<HTMLElement>(`.dash-widget[data-uid="${uid}"]`);
		if (!card) return;
		const body = card.querySelector<HTMLElement>(".dash-widget-body");
		const inst = this.plugin.settings.layout.find((i) => i.uid === uid);
		if (body && inst) this.renderWidgetBody(body, inst);
	}

	refreshActivityWidgets(): void {
		for (const t of ["activity", "stats", "tasks", "calendar", "recent", "vaulttasks", "popular", "orphans", "backlinks", "embed"]) this.refreshAllOfType(t);
	}

	private refreshAllOfType(type: string): void {
		this.gridEl
			.querySelectorAll<HTMLElement>(`.dash-widget[data-type="${type}"]`)
			.forEach((card) => {
				const body = card.querySelector<HTMLElement>(".dash-widget-body");
				const inst = this.plugin.settings.layout.find((i) => i.uid === card.getAttribute("data-uid"));
				if (body && inst) this.renderWidgetBody(body, inst);
			});
	}

	// ---- drag & drop ----

	/**
	 * The number of columns the stylesheet is actually showing: below the 720 px
	 * breakpoint the grid collapses to one track, so the gesture maths has to
	 * follow or the preview and the committed position describe different boards.
	 */
	private effColumns(): number {
		const width = this.gridEl ? this.gridEl.getBoundingClientRect().width : 0;
		return width > 0 && width < 720 ? 1 : this.plugin.settings.columns;
	}

	private cellAt(clientX: number, clientY: number): { x: number; y: number; cols: number } {
		const s = this.plugin.settings;
		const cols = this.effColumns();
		const rect = this.gridEl.getBoundingClientRect();
		const cw = (rect.width - s.gap * (cols - 1)) / cols;
		const x = clamp(Math.floor((clientX - rect.left) / (cw + s.gap)), 0, cols - 1);
		const y = clamp(
			Math.floor((clientY - rect.top) / (s.rowHeight + s.gap)),
			0,
			Math.max(gridRows(s.layout) - 1, 0)
		);
		return { x, y, cols };
	}

	private showDropTarget(cell: { x: number; y: number; cols: number }): void {
		const s = this.plugin.settings;
		const rect = this.gridEl.getBoundingClientRect();
		const cw = (rect.width - s.gap * (cell.cols - 1)) / cell.cols;
		this.dropTarget.style.left = cell.x * (cw + s.gap) + "px";
		this.dropTarget.style.top = cell.y * (s.rowHeight + s.gap) + "px";
		this.dropTarget.style.width = cw + "px";
		this.dropTarget.style.height = s.rowHeight + "px";
		this.dropTarget.addClass("is-visible");
	}

	private hideDropTarget(): void {
		this.dropTarget.removeClass("is-visible");
	}

	/**
	 * Wire one pointer gesture so it always tears down: on release, on
	 * `pointercancel` (what a touch device fires when it claims the gesture for
	 * panning) and when the view re-renders or closes mid-gesture. `settle` is
	 * called exactly once, with `commit: false` for every path but a real release.
	 */
	private beginGesture(
		down: PointerEvent,
		move: (ev: PointerEvent) => void,
		settle: (commit: boolean) => void
	): void {
		down.preventDefault();
		down.stopPropagation();
		let done = false;
		const detach = (): void => {
			document.removeEventListener("pointermove", move);
			document.removeEventListener("pointerup", onUp);
			document.removeEventListener("pointercancel", onCancel);
		};
		const onUp = (): void => {
			if (done) return;
			done = true;
			detach();
			settle(true);
		};
		const onCancel = (): void => {
			if (done) return;
			done = true;
			detach();
			settle(false);
		};
		document.addEventListener("pointermove", move);
		document.addEventListener("pointerup", onUp);
		document.addEventListener("pointercancel", onCancel);
		this.cleanups.push(onCancel);
	}

	private enableDrag(card: HTMLElement, inst: WidgetInstance): void {
		const grip = card.querySelector<HTMLElement>(".dash-grip");
		if (!grip) return;
		grip.addEventListener("pointerdown", (e) => {
			const startX = e.clientX;
			const startY = e.clientY;
			let lastX = startX;
			let lastY = startY;
			const gen = this.renderGen;
			card.addClass("is-dragging");
			this.beginGesture(
				e,
				(ev) => {
					lastX = ev.clientX;
					lastY = ev.clientY;
					card.style.transform = `translate3d(${ev.clientX - startX}px, ${ev.clientY - startY}px, 0) scale(1.03)`;
					this.showDropTarget(this.cellAt(ev.clientX, ev.clientY));
				},
				(commit) => {
					card.removeClass("is-dragging");
					card.style.removeProperty("transform");
					this.hideDropTarget();
					// A gesture only lands while the user is still editing the same board.
					if (!commit || gen !== this.renderGen || !this.plugin.settings.editMode) return;
					const cell = this.cellAt(lastX, lastY);
					this.placeInstance(inst, cell.x, cell.y, cell.cols);
				}
			);
		});
	}

	private placeInstance(inst: WidgetInstance, col: number, row: number, cols: number): void {
		const s = this.plugin.settings;
		const layout = s.layout;
		row = Math.max(row, 0);

		if (cols <= 1) {
			// Single-column breakpoint: only the row is meaningful, and widgets keep
			// their width for when the window is wide enough to show it again.
			inst.x = 0;
			inst.y = row;
			resolveOverlaps(layout, s.columns);
			void this.plugin.saveSettings();
			this.render();
			return;
		}

		col = clamp(col, 0, cols - 1);
		const occupant = layout.find((i) => i.uid !== inst.uid && i.x === col && i.y === row);

		if (occupant) {
			const oldX = inst.x;
			const oldY = inst.y;
			inst.x = col;
			inst.y = row;
			occupant.x = oldX;
			occupant.y = oldY;
			if (hasOverlap(layout, inst) || hasOverlap(layout, occupant)) {
				inst.x = oldX;
				inst.y = oldY;
				occupant.x = col;
				occupant.y = row;
				const free = nearestFree(layout, inst, col, row, cols);
				inst.x = free.x;
				inst.y = free.y;
			}
		} else {
			const free = nearestFree(layout, inst, col, row, cols);
			inst.x = free.x;
			inst.y = free.y;
		}

		resolveOverlaps(layout, s.columns);
		void this.plugin.saveSettings();
		this.render();
	}

	private enableResize(card: HTMLElement, inst: WidgetInstance): void {
		const type = widgetType(inst.type);
		const min = type?.min ?? { w: 2, h: 2 };
		const maxW = type?.max?.w ?? this.plugin.settings.columns;
		const maxH = type?.max?.h ?? 8;
		const handle = card.createDiv("dash-resize");
		handle.addEventListener("pointerdown", (e) => {
			const s = this.plugin.settings;
			const cols = this.effColumns();
			const rect = this.gridEl.getBoundingClientRect();
			const cw = (rect.width - s.gap * (cols - 1)) / cols;
			const ch = s.rowHeight;
			const startW = inst.w;
			const startH = inst.h;
			const sx = e.clientX;
			const sy = e.clientY;
			const gen = this.renderGen;

			this.beginGesture(
				e,
				(ev) => {
					const dCols = Math.round((ev.clientX - sx) / (cw + s.gap));
					const dRows = Math.round((ev.clientY - sy) / (ch + s.gap));
					inst.w = clamp(startW + dCols, min.w, Math.min(maxW, cols - inst.x));
					inst.h = clamp(startH + dRows, min.h, maxH);
					this.position(card, inst);
				},
				(commit) => {
					if (!commit || gen !== this.renderGen || !this.plugin.settings.editMode) return;
					resolveOverlaps(this.plugin.settings.layout, this.plugin.settings.columns);
					void this.plugin.saveSettings();
					this.render();
				}
			);
		});
	}

	// ---- settings ----

	private openWidgetSettings(inst: WidgetInstance): void {
		const type = widgetType(inst.type);
		if (!type) return;
		if (type.openSettings) {
			type.openSettings(this.plugin, inst);
			return;
		}
		if (!type?.settings?.length && !inst.title) {
			new Notice("No settings for this widget.");
			return;
		}
		new WidgetSettingsModal(this.app, this.plugin, inst).open();
	}
}

class AddWidgetModal extends Modal {
	plugin: DashboardPlugin;

	constructor(app: App, plugin: DashboardPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen(): void {
		this.titleEl.setText("Add a widget");
		const list = this.contentEl.createDiv("dash-modal-list");
		for (const t of getWidgetTypes()) {
			const row = list.createDiv("dash-modal-row");
			const icon = row.createDiv("dash-modal-icon");
			setIcon(icon, t.icon);
			const info = row.createDiv("dash-modal-info");
			info.createDiv("dash-modal-name").setText(t.name);
			info.createDiv("dash-modal-desc").setText(t.description);
			row.addEventListener("click", () => {
				this.plugin.addWidget(t.type);
				this.close();
			});
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

class WidgetSettingsModal extends Modal {
	plugin: DashboardPlugin;
	inst: WidgetInstance;

	constructor(app: App, plugin: DashboardPlugin, inst: WidgetInstance) {
		super(app);
		this.plugin = plugin;
		this.inst = inst;
	}

	onOpen(): void {
		const type = widgetType(this.inst.type);
		this.titleEl.setText((this.inst.title || type?.name || "Widget") + " — settings");
		const { contentEl } = this;
		contentEl.empty();
		if (!type) return;

		if (!type.noHeader) {
			new Setting(contentEl)
				.setName("Title")
				.setDesc("Leave blank to use the default")
				.addText((tb) => {
					tb.setValue(this.inst.title ?? "");
					tb.onChange((v) => {
						this.inst.title = v || undefined;
						this.commit();
					});
				});
		}

		for (const cfg of type.settings ?? []) this.addSetting(contentEl, cfg);

		contentEl.createDiv("dash-modal-gap");
		const done = contentEl.createDiv("dash-modal-foot");
		const btn = done.createDiv("dash-btn dash-btn-accent");
		btn.setText("Done");
		btn.addEventListener("click", () => this.close());
	}

	private addSetting(contentEl: HTMLElement, cfg: WidgetSetting): void {
		const st = new Setting(contentEl).setName(cfg.label);
		const commit = (): void => {
			void this.plugin.saveSettings();
			this.plugin.refreshWidget(this.inst.uid);
		};

		if (cfg.type === "toggle") {
			st.addToggle((tg) =>
				tg.setValue(!!this.inst.settings[cfg.key]).onChange((v) => {
					this.inst.settings[cfg.key] = v;
					commit();
				})
			);
		} else if (cfg.type === "select") {
			st.addDropdown((dd) => {
				for (const o of cfg.options ?? []) dd.addOption(o, o);
				dd.setValue(String(this.inst.settings[cfg.key] ?? cfg.options?.[0] ?? "")).onChange((v) => {
					this.inst.settings[cfg.key] = v;
					commit();
				});
			});
		} else if (cfg.type === "number") {
			st.addText((tb) => {
				tb.inputEl.type = "number";
				tb.setValue(String(this.inst.settings[cfg.key] ?? ""));
				tb.onChange((v) => {
					// An emptied or unparsable field must leave the stored value alone
					// instead of silently rewriting it to the minimum.
					if (!v.trim()) return;
					const n = parseFloat(v);
					if (!Number.isFinite(n)) return;
					let val = n;
					if (cfg.min !== undefined) val = Math.max(cfg.min, val);
					if (cfg.max !== undefined) val = Math.min(cfg.max, val);
					this.inst.settings[cfg.key] = val;
					commit();
				});
			});
		} else {
			st.addText((tb) => {
				tb.setValue(String(this.inst.settings[cfg.key] ?? ""));
				tb.setPlaceholder(cfg.placeholder ?? "");
				tb.onChange((v) => {
					this.inst.settings[cfg.key] = v;
					commit();
				});
			});
		}
	}

	private commit(): void {
		void this.plugin.saveSettings();
		this.plugin.refreshWidget(this.inst.uid);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
