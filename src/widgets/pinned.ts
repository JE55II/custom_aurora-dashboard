import { Modal, Notice, setIcon, TFile, type App } from "obsidian";
import type { DashboardPlugin, WidgetInstance, WidgetType } from "../types";
import { registerWidgetType } from "../registry";

function pinnedPaths(inst: WidgetInstance): string[] {
	const v = inst.settings.pins;
	return Array.isArray(v) ? v.filter((p): p is string => typeof p === "string") : [];
}

export const pinnedType: WidgetType = {
	type: "pinned",
	name: "Pinned",
	description: "Your favorite notes, one click away",
	icon: "pin",
	defaultSize: { w: 4, h: 3 },
	defaultSettings: { pins: [] },
	openSettings(plugin, inst) {
		new PinnedModal(plugin.app, plugin, inst).open();
	},
	render(ctx) {
		const list = ctx.body.createDiv("dash-list");
		let shown = 0;
		for (const path of pinnedPaths(ctx.inst)) {
			const f = ctx.plugin.app.vault.getAbstractFileByPath(path);
			if (!(f instanceof TFile)) continue; // note was deleted
			shown++;
			const row = list.createDiv("dash-list-row");
			const icon = row.createDiv("dash-list-icon");
			setIcon(icon, "file-text");
			row.createDiv("dash-list-name").setText(f.basename);
			const slash = path.lastIndexOf("/");
			row.createDiv("dash-list-meta").setText(slash > 0 ? path.slice(0, slash) : "root");
			row.addEventListener("click", () => ctx.plugin.openFile(f));
		}
		if (!shown) list.createDiv("dash-empty").setText("No pinned notes — edit to add some");
		return {};
	},
};

class PinnedModal extends Modal {
	plugin: DashboardPlugin;
	inst: WidgetInstance;
	private pins: string[];
	private input: HTMLInputElement | null = null;

	constructor(app: App, plugin: DashboardPlugin, inst: WidgetInstance) {
		super(app);
		this.plugin = plugin;
		this.inst = inst;
		this.pins = [...pinnedPaths(inst)];
	}

	onOpen(): void {
		this.titleEl.setText("Pinned notes — choose notes");
		this.render();
	}

	onClose(): void {
		// Pins are written through as they change, so closing the modal any way at
		// all keeps them. A path typed but never submitted is the one thing left to
		// rescue — otherwise closing would silently drop it.
		const typed = this.input ? this.input.value.trim() : "";
		if (typed && !this.pins.includes(typed)) this.addPath(typed);
		this.contentEl.empty();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();

		const addRow = contentEl.createDiv("dash-qa-row");
		const input = addRow.createEl("input", {
			cls: "dash-qa-input",
			attr: { placeholder: "Note path (start typing to search)…", list: "dash-pinned-notes" },
		});
		this.input = input;
		const btn = addRow.createDiv("dash-btn dash-btn-accent");
		setIcon(btn, "plus");
		btn.addEventListener("click", () => this.submit(input));

		const addNow = (): void => this.submit(input);
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				addNow();
			}
		});

		const datalist = contentEl.createEl("datalist", { attr: { id: "dash-pinned-notes" } });
		const files = this.plugin.app.vault.getMarkdownFiles();
		const used = new Set(this.pins);
		for (const f of files) {
			if (used.has(f.path)) continue;
			datalist.createEl("option", { value: f.path });
		}

		const list = contentEl.createDiv("dash-qa-list");
		if (!this.pins.length) list.createDiv("dash-empty").setText("Nothing pinned yet.");
		for (const p of this.pins) {
			const row = list.createDiv("dash-qa-row");
			const name = row.createDiv("dash-qa-name");
			name.setText(p);
			name.setAttr("title", p);
			const del = row.createDiv("dash-btn dash-btn-danger");
			setIcon(del, "x");
			del.setAttr("aria-label", "Unpin");
			del.addEventListener("click", () => {
				this.removePath(p);
				this.render();
			});
		}

		contentEl.createDiv("dash-modal-foot", (foot) => {
			const done = foot.createDiv("dash-btn dash-btn-accent");
			done.setText("Done");
			done.addEventListener("click", () => this.commit());
		});
		input.focus();
	}

	/** Take the typed path, persist it, and re-render the list. */
	private submit(input: HTMLInputElement): void {
		const p = input.value.trim();
		if (!p) return;
		this.addPath(p);
		input.value = "";
		this.render();
	}

	/**
	 * Add a validated path and write it through right away: the Notice says
	 * "Pinned", so that has to be true before the modal is closed.
	 */
	private addPath(p: string): void {
		if (!p) return;
		if (this.pins.includes(p)) {
			new Notice("Already pinned");
			return;
		}
		if (!(this.plugin.app.vault.getAbstractFileByPath(p) instanceof TFile)) {
			new Notice("Note not found");
			return;
		}
		this.pins.push(p);
		new Notice("Pinned " + p);
		void this.persist();
	}

	private removePath(p: string): void {
		this.pins = this.pins.filter((x) => x !== p);
		void this.persist();
	}

	/** Save the pins and refresh the widget behind the modal. */
	private async persist(): Promise<void> {
		this.inst.settings.pins = [...this.pins];
		await this.plugin.saveSettings();
		this.plugin.refreshWidget(this.inst.uid);
	}

	private commit(): void {
		// Everything is already saved; closing is enough (onClose rescues a typed path).
		this.close();
	}
}

registerWidgetType(pinnedType);
