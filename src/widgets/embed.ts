import { Component, MarkdownRenderer, Modal, Notice, setIcon, TFile, type App } from "obsidian";
import type { DashboardPlugin, WidgetInstance, WidgetType } from "../types";
import { registerWidgetType } from "../registry";

/**
 * Renders markdown straight into a widget, so the dashboard can show content the
 * built-in widgets do not cover: a note's body, today's daily note, a `.base`,
 * a Dataview/Tasks query, a Mermaid diagram, or markdown typed by hand.
 *
 * Everything goes through Obsidian's own `MarkdownRenderer`, so the embed
 * inherits whatever the vault already has enabled instead of reimplementing it.
 */
type EmbedMode = "note" | "daily" | "markdown";

interface EmbedConfig {
	mode: EmbedMode;
	/** Vault path used by `note` mode. */
	path: string;
	/** Literal markdown used by `markdown` mode. */
	markdown: string;
	/** When false, long content is clipped instead of scrolled. */
	scroll: boolean;
}

function readConfig(inst: WidgetInstance): EmbedConfig {
	const s = inst.settings;
	const mode: EmbedMode = s.mode === "note" || s.mode === "markdown" ? s.mode : "daily";
	return {
		mode,
		path: typeof s.path === "string" ? s.path : "",
		markdown: typeof s.markdown === "string" ? s.markdown : "",
		scroll: s.scroll !== false,
	};
}

/** Drop a leading YAML frontmatter block so it does not render as body text. */
function stripFrontmatter(md: string): string {
	if (!md.startsWith("---")) return md;
	const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(md);
	// Require a `key:` line, so a note that merely opens with a horizontal rule
	// survives. `replace(/^\s+/)` rather than `trimStart()`: the plugin targets
	// ES2018, where the `trim*` methods do not exist.
	if (!m || !/^[^\s:]+:/.test(m[1].replace(/^\s+/, ""))) return md;
	return md.slice(m[0].length);
}

export const embedType: WidgetType = {
	type: "embed",
	name: "Embed",
	description: "Render a note, today's daily note, or your own markdown",
	icon: "book-open",
	defaultSize: { w: 6, h: 4 },
	min: { w: 3, h: 2 },
	max: { w: 12, h: 12 },
	defaultSettings: { mode: "daily", path: "", markdown: "", scroll: true },
	openSettings(plugin, inst) {
		new EmbedSettingsModal(plugin.app, plugin, inst).open();
	},
	render(ctx) {
		const cfg = readConfig(ctx.inst);
		// A component per render: MarkdownRenderer registers the child components it
		// creates (embeds, Dataview views) against it, so it must be unloaded with them.
		const component = new Component();
		component.load();
		let disposed = false;

		const wrap = ctx.body.createDiv("dash-embed");
		const content = wrap.createDiv("dash-embed-content markdown-rendered");
		if (!cfg.scroll) content.addClass("is-clipped");

		const fail = (msg: string): void => {
			if (disposed) return;
			content.empty();
			content.removeClass("markdown-rendered");
			content.createDiv("dash-empty").setText(msg);
		};

		const addSource = (file: TFile): void => {
			if (disposed) return;
			const foot = wrap.createDiv("dash-embed-source");
			const icon = foot.createDiv("dash-list-icon");
			setIcon(icon, "file-text");
			foot.createDiv("dash-embed-source-name").setText(file.basename);
			foot.setAttr("aria-label", "Open " + file.path);
			foot.addEventListener("click", () => ctx.plugin.openFile(file));
		};

		const resolve = async (): Promise<{ markdown: string; path: string; file: TFile | null } | null> => {
			if (cfg.mode === "markdown") return { markdown: cfg.markdown, path: "", file: null };

			const wanted = cfg.mode === "daily" ? ctx.plugin.dailyNotePath(new Date()) : cfg.path;
			if (!wanted) {
				fail("No note chosen — edit the widget to pick one.");
				return null;
			}
			const file = ctx.plugin.app.vault.getAbstractFileByPath(wanted);
			if (!(file instanceof TFile)) {
				fail(
					cfg.mode === "daily"
						? "No daily note for today yet — the calendar can create one."
						: "Not found: " + wanted
				);
				return null;
			}
			// Only markdown is inlined; anything else (.base, images, canvas, PDF) is
			// handed to Obsidian's own embed renderer as a transclusion.
			const markdown = file.extension === "md" ? stripFrontmatter(await ctx.plugin.app.vault.read(file)) : `![[${file.path}]]`;
			return { markdown, path: file.path, file };
		};

		const show = async (): Promise<void> => {
			let loaded: { markdown: string; path: string; file: TFile | null } | null = null;
			try {
				loaded = await resolve();
			} catch (e) {
				console.error("Aurora Dashboard: embed could not read its source.", e);
				fail("Could not read that file.");
				return;
			}
			if (disposed || !loaded) return;

			const src = loaded;
			if (!src.markdown.trim()) {
				fail("Nothing to show yet — the source is empty.");
				return;
			}
			try {
				await MarkdownRenderer.render(ctx.plugin.app, src.markdown, content, src.path, component);
			} catch (e) {
				console.error("Aurora Dashboard: embed failed to render.", e);
				fail("Could not render this content.");
				return;
			}
			if (disposed) return;
			if (src.file) addSource(src.file);
		};

		void show();
		return {
			dispose: () => {
				disposed = true;
				component.unload();
			},
		};
	},
};

class EmbedSettingsModal extends Modal {
	plugin: DashboardPlugin;
	inst: WidgetInstance;
	private draft: EmbedConfig;
	private title: string;

	constructor(app: App, plugin: DashboardPlugin, inst: WidgetInstance) {
		super(app);
		this.plugin = plugin;
		this.inst = inst;
		this.draft = readConfig(inst);
		this.title = inst.title ?? "";
	}

	onOpen(): void {
		this.titleEl.setText("Embed — settings");
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();

		const titleRow = contentEl.createDiv("dash-qa-row");
		titleRow.createDiv("dash-qa-name").setText("Title");
		const titleInput = titleRow.createEl("input", {
			cls: "dash-qa-input",
			attr: { placeholder: "Embed", value: this.title },
		});
		titleInput.addEventListener("input", () => {
			this.title = titleInput.value;
		});

		const modeRow = contentEl.createDiv("dash-qa-row");
		modeRow.createDiv("dash-qa-name").setText("Source");
		const modeSel = modeRow.createEl("select", { cls: "dash-qa-select dash-embed-select" });
		for (const [value, label] of [
			["note", "A note"],
			["daily", "Today's daily note"],
			["markdown", "Inline markdown"],
		] as const) {
			modeSel.createEl("option", { value }).setText(label);
		}
		modeSel.value = this.draft.mode;
		modeSel.addEventListener("change", () => {
			const v = modeSel.value;
			this.draft.mode = v === "note" || v === "markdown" ? v : "daily";
			this.render();
		});

		if (this.draft.mode === "note") {
			const row = contentEl.createDiv("dash-qa-row");
			const input = row.createEl("input", {
				cls: "dash-qa-input",
				attr: { placeholder: "Start typing to search…", list: "dash-embed-files", value: this.draft.path },
			});
			input.addEventListener("input", () => {
				this.draft.path = input.value;
			});
			// Markdown notes plus .base files — the two things worth embedding by path.
			const list = contentEl.createEl("datalist", { attr: { id: "dash-embed-files" } });
			for (const f of this.plugin.app.vault.getFiles()) {
				if (f.extension === "md" || f.extension === "base") list.createEl("option", { value: f.path });
			}
			input.focus();
		} else if (this.draft.mode === "markdown") {
			const ta = contentEl.createEl("textarea", {
				cls: "dash-qa-input dash-embed-md",
				attr: { placeholder: "Any markdown — tables, ```dataview, ```base, mermaid, ![[embeds]]…" },
			});
			ta.value = this.draft.markdown;
			ta.addEventListener("input", () => {
				this.draft.markdown = ta.value;
			});
			ta.focus();
		}

		const scrollRow = contentEl.createDiv("dash-qa-row");
		scrollRow.createDiv("dash-qa-name").setText("Long content");
		const scrollSel = scrollRow.createEl("select", { cls: "dash-qa-select dash-embed-select" });
		scrollSel.createEl("option", { value: "scroll" }).setText("Scroll");
		scrollSel.createEl("option", { value: "clip" }).setText("Clip");
		scrollSel.value = this.draft.scroll ? "scroll" : "clip";
		scrollSel.addEventListener("change", () => {
			this.draft.scroll = scrollSel.value !== "clip";
		});

		contentEl.createDiv("dash-modal-foot", (foot) => {
			const done = foot.createDiv("dash-btn dash-btn-accent");
			done.setText("Done");
			done.addEventListener("click", () => void this.commit());
		});
	}

	/** Write the draft through and refresh the widget behind the modal. */
	private async persist(): Promise<void> {
		this.inst.title = this.title.trim() || undefined;
		this.inst.settings.mode = this.draft.mode;
		this.inst.settings.path = this.draft.path;
		this.inst.settings.markdown = this.draft.markdown;
		this.inst.settings.scroll = this.draft.scroll;
		await this.plugin.saveSettings();
		this.plugin.refreshWidget(this.inst.uid);
	}

	private async commit(): Promise<void> {
		if (this.draft.mode === "note") {
			const path = this.draft.path.trim();
			if (path && !(this.plugin.app.vault.getAbstractFileByPath(path) instanceof TFile)) {
				new Notice("Note not found: " + path);
				return;
			}
			this.draft.path = path;
		}
		await this.persist();
		this.close();
	}

	onClose(): void {
		// The editor commits on Done, but closing with the ✕ must not throw the draft
		// away. An unresolvable note path falls back to the last working one.
		if (this.draft.mode === "note") {
			const path = this.draft.path.trim();
			const known = path && this.plugin.app.vault.getAbstractFileByPath(path) instanceof TFile;
			this.draft.path = known ? path : typeof this.inst.settings.path === "string" ? this.inst.settings.path : "";
		}
		void this.persist();
		this.contentEl.empty();
	}
}

registerWidgetType(embedType);
