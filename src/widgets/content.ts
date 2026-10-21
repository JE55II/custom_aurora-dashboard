import { Notice, setIcon, TFile } from "obsidian";
import type { WidgetType } from "../types";
import { registerWidgetType } from "../registry";
import { relTime } from "../utils";
import { nearestTaskLine, lineMatchesTask, parseTasks, toggleTaskLine, type ParsedTask } from "../tasks";

export const recentType: WidgetType = {
	type: "recent",
	name: "Recent",
	description: "Notes you touched recently",
	icon: "history",
	defaultSize: { w: 5, h: 3 },
	settings: [{ key: "count", label: "Number of notes", type: "number", min: 3, max: 20 }],
	render(ctx) {
		const count = Math.max(3, Math.min(20, Number(ctx.inst.settings.count ?? 8) || 8));
		const files = ctx.plugin.app.vault
			.getMarkdownFiles()
			.sort((a, b) => b.stat.mtime - a.stat.mtime)
			.slice(0, count);

		const list = ctx.body.createDiv("dash-list");
		for (const f of files) {
			const row = list.createDiv("dash-list-row");
			const icon = row.createDiv("dash-list-icon");
			setIcon(icon, "file-text");
			row.createDiv("dash-list-name").setText(f.basename);
			row.createDiv("dash-list-meta").setText(relTime(f.stat.mtime));
			row.addEventListener("click", () => ctx.plugin.openFile(f));
		}
		return {};
	},
};

export const tagsType: WidgetType = {
	type: "tags",
	name: "Tags",
	description: "Your most-used tags, click to search",
	icon: "tag",
	defaultSize: { w: 3, h: 3 },
	settings: [{ key: "count", label: "Number of tags", type: "number", min: 3, max: 20 }],
	render(ctx) {
		const count = Math.max(3, Math.min(20, Number(ctx.inst.settings.count ?? 10) || 10));
		const counts = new Map<string, number>();
		const files = ctx.plugin.app.vault.getMarkdownFiles().slice(0, 1500);
		for (const f of files) {
			const cache = ctx.plugin.app.metadataCache.getFileCache(f);
			for (const t of cache?.tags ?? []) {
				const name = t.tag.replace(/^#/, "");
				counts.set(name, (counts.get(name) ?? 0) + 1);
			}
		}
		const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, count);

		const list = ctx.body.createDiv("dash-list");
		for (const [tag, n] of top) {
			const row = list.createDiv("dash-list-row");
			const icon = row.createDiv("dash-list-icon");
			setIcon(icon, "hash");
			row.createDiv("dash-list-name").setText("#" + tag);
			row.createDiv("dash-list-meta").setText(String(n));
			row.addEventListener("click", () => void ctx.plugin.openSearch("tag:" + tag));
		}
		return {};
	},
};

export const tasksType: WidgetType = {
	type: "tasks",
	name: "Today",
	description: "Checkboxes from your daily note",
	icon: "check-square",
	defaultSize: { w: 4, h: 3 },
	render(ctx) {
		const plugin = ctx.plugin;
		const body = ctx.body;
		// Re-derived for every action: a dashboard left open across midnight must
		// write to the new day's note, not the one it was drawn for.
		const currentPath = (): string => plugin.dailyNotePath(new Date());

		const load = async (): Promise<void> => {
			body.empty();
			const file = plugin.app.vault.getAbstractFileByPath(currentPath());
			const list = body.createDiv("dash-list");

			if (!(file instanceof TFile)) {
				list.createDiv("dash-empty").setText("No daily note yet — add one below");
				addBar();
				return;
			}

			const tasks = parseTasks(await plugin.app.vault.read(file));
			const open = tasks.filter((t) => !t.done);
			const done = tasks.filter((t) => t.done);

			for (const t of open.slice(0, 20)) addRow(list, t);
			if (done.length) {
				list.createDiv("dash-divider").setText(`Completed (${done.length})`);
				for (const t of done.slice(0, 5)) addRow(list, t);
			}
			if (!open.length && !done.length) {
				list.createDiv("dash-empty").setText("Nothing here yet");
			}
			addBar();
		};

		const addBar = (): void => {
			const bar = body.createDiv("dash-add-row");
			const input = bar.createEl("input", {
				cls: "dash-task-input",
				attr: { placeholder: "Add a task for today…" },
			});
			const btn = bar.createDiv("dash-btn dash-btn-accent");
			setIcon(btn, "plus");
			btn.addEventListener("click", () => void addNewTask(input.value.trim()));
			input.addEventListener("keydown", (e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					void addNewTask(input.value.trim());
				}
			});
		};

		const addRow = (list: HTMLElement, task: ParsedTask): void => {
			const row = list.createDiv("dash-list-row dash-task");
			const cb = row.createDiv("dash-check" + (task.done ? " is-checked" : ""));
			setIcon(cb, task.done ? "check-circle" : "circle");
			row.createDiv("dash-list-name" + (task.done ? " is-done" : "")).setText(task.text);
			cb.addEventListener("click", () => void toggleTask(task));
		};

		const toggleTask = async (task: ParsedTask): Promise<void> => {
			const file = plugin.app.vault.getAbstractFileByPath(currentPath());
			if (!(file instanceof TFile)) return;
			try {
				const lines = (await plugin.app.vault.read(file)).split("\n");
				// Rewrite the one line this row came from. Matching on text alone would
				// flip every task in the note that happens to share the wording.
				let idx = task.line;
				if (!lineMatchesTask(lines[idx], task.text)) idx = nearestTaskLine(lines, task.text, task.line);
				if (idx < 0) return;
				lines[idx] = toggleTaskLine(lines[idx]);
				await plugin.app.vault.modify(file, lines.join("\n"));
			} catch (e) {
				console.error("Aurora Dashboard: could not update that task.", e);
				new Notice("Could not update that task.");
				return;
			}
			ctx.refresh();
		};

		const addNewTask = async (text: string): Promise<void> => {
			if (!text) return;
			const path = currentPath();
			try {
				const existing = plugin.app.vault.getAbstractFileByPath(path);
				const file = existing instanceof TFile ? existing : await plugin.app.vault.create(path, "");
				const cur = await plugin.app.vault.read(file);
				await plugin.app.vault.modify(file, (cur ? cur + "\n" : "") + "- [ ] " + text);
			} catch (e) {
				console.error("Aurora Dashboard: could not add that task.", e);
				new Notice("Could not add that task.");
				return;
			}
			ctx.refresh();
		};

		void load();
		return {};
	},
};

export const captureType: WidgetType = {
	type: "capture",
	name: "Quick capture",
	description: "Capture a thought straight to your inbox",
	icon: "send",
	defaultSize: { w: 4, h: 2 },
	render(ctx) {
		const body = ctx.body;
		const ta = body.createEl("textarea", {
			cls: "dash-capture-input",
			attr: { placeholder: "Capture a thought…  (Enter saves, Shift+Enter new line)" },
		});
		const foot = body.createDiv("dash-capture-foot");
		const target = ctx.plugin.settings.captureTarget === "daily" ? "today's note" : ctx.plugin.settings.inboxFile;
		foot.createDiv("dash-capture-hint").setText("→ " + target);
		const btn = foot.createDiv("dash-btn dash-btn-accent");
		setIcon(btn, "send");
		btn.appendText(" Capture");

		const doCapture = async (): Promise<void> => {
			const t = ta.value.trim();
			if (!t) return;
			try {
				await ctx.plugin.captureText(t);
				ta.value = "";
			} catch {
				// captureText has already reported it; keep the text in the box.
			}
		};

		btn.addEventListener("click", () => void doCapture());
		ta.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				void doCapture();
			}
		});
		return {};
	},
};

export const searchType: WidgetType = {
	type: "search",
	name: "Search",
	description: "Run a global vault search",
	icon: "search",
	defaultSize: { w: 3, h: 2 },
	render(ctx) {
		const input = ctx.body.createEl("input", {
			cls: "dash-search-input",
			attr: { placeholder: "Search your vault…  (Enter)" },
		});
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				const q = input.value.trim();
				if (q) void ctx.plugin.openSearch(q);
			}
		});
		return {};
	},
};

registerWidgetType(recentType);
registerWidgetType(tagsType);
registerWidgetType(tasksType);
registerWidgetType(captureType);
registerWidgetType(searchType);
