import { App, MarkdownView, Notice, setIcon, TFile } from "obsidian";
import type { WidgetType } from "../types";
import { registerWidgetType } from "../registry";
import { nearestTaskLine, lineMatchesTask, parseTasks, toggleTaskLine, type ParsedTask } from "../tasks";

interface VaultTask {
	file: TFile;
	line: number;
	text: string;
	done: boolean;
}

/** In-memory scan cache, keyed by file path. Re-reads only files whose mtime changed. */
const fileCache = new Map<string, { mtime: number; items: ParsedTask[] }>();

async function scanTasks(app: App, maxFiles: number): Promise<VaultTask[]> {
	const files = app.vault
		.getMarkdownFiles()
		.sort((a, b) => b.stat.mtime - a.stat.mtime)
		.slice(0, maxFiles);

	const out: VaultTask[] = [];
	for (const f of files) {
		const key = f.path;
		let items: ParsedTask[] | null = null;
		const cached = fileCache.get(key);
		if (cached && cached.mtime === f.stat.mtime) {
			items = cached.items;
		} else {
			try {
				items = parseTasks(await app.vault.read(f));
			} catch (e) {
				console.error("Aurora Dashboard: could not read tasks from", f.path, e);
				items = [];
			}
			fileCache.set(key, { mtime: f.stat.mtime, items });
		}
		for (const it of items) out.push({ file: f, line: it.line, text: it.text, done: it.done });
	}
	return out;
}

export const vaultTasksType: WidgetType = {
	type: "vaulttasks",
	name: "All tasks",
	description: "Every open task across your vault",
	icon: "list-checks",
	defaultSize: { w: 5, h: 4 },
	defaultSettings: { count: 25, groupBy: "Note", showDone: false, maxFiles: 200 },
	settings: [
		{ key: "count", label: "Max tasks shown", type: "number", min: 5, max: 200 },
		{ key: "groupBy", label: "Group by", type: "select", options: ["Note", "Flat"] },
		{ key: "showDone", label: "Show completed", type: "toggle" },
		{ key: "maxFiles", label: "Files scanned", type: "number", min: 10, max: 2000 },
	],
	render(ctx) {
		const body = ctx.body;
		const s = ctx.inst.settings;
		const count = Math.max(5, Math.min(200, Number(s.count ?? 25) || 25));
		const groupBy = String(s.groupBy || "Note");
		const showDone = !!s.showDone;
		const maxFiles = Math.max(10, Math.min(2000, Number(s.maxFiles ?? 200) || 200));

		body.createDiv("dash-empty").setText("Loading tasks…");
		void load();

		async function load(): Promise<void> {
			let all: VaultTask[] = [];
			try {
				all = await scanTasks(ctx.plugin.app, maxFiles);
			} catch {
				/* fall through to empty state */
			}
			renderTasks(all);
		}

		function renderTasks(all: VaultTask[]): void {
			body.empty();
			const open = all.filter((t) => !t.done);
			const done = all.filter((t) => t.done);
			const list = body.createDiv("dash-list");
			let used = 0;

			if (groupBy.toLowerCase() === "flat") {
				for (const t of open) {
					if (used >= count) break;
					addRow(list, t, true);
					used++;
				}
				if (showDone && done.length) {
					list.createDiv("dash-divider").setText(`Completed (${done.length})`);
					for (const t of done) {
						if (used >= count) break;
						addRow(list, t, true);
						used++;
					}
				}
			} else {
				const groups = new Map<string, { file: TFile; tasks: VaultTask[] }>();
				for (const t of open) {
					let g = groups.get(t.file.path);
					if (!g) {
						g = { file: t.file, tasks: [] };
						groups.set(t.file.path, g);
					}
					g.tasks.push(t);
				}
				for (const g of groups.values()) {
					if (used >= count) break;
					const header = list.createDiv("dash-group-header");
					const icon = header.createDiv("dash-list-icon");
					setIcon(icon, "file-text");
					header.createDiv("dash-group-name").setText(g.file.basename);
					header.createDiv("dash-group-count").setText(String(g.tasks.length));
					header.addEventListener("click", () => ctx.plugin.openFile(g.file));
					for (const t of g.tasks) {
						if (used >= count) break;
						addRow(list, t, false);
						used++;
					}
				}
				if (showDone && done.length) {
					list.createDiv("dash-divider").setText(`Completed (${done.length})`);
					for (const t of done) {
						if (used >= count) break;
						addRow(list, t, true);
						used++;
					}
				}
			}

			if (!list.childElementCount) {
				list.createDiv("dash-empty").setText(
					done.length > 0 ? "All caught up — nothing open" : "No tasks in your vault yet"
				);
			}
		}

		function addRow(list: HTMLElement, t: VaultTask, showMeta: boolean): void {
			const row = list.createDiv("dash-list-row");
			const cb = row.createDiv("dash-check" + (t.done ? " is-checked" : ""));
			setIcon(cb, t.done ? "check-circle" : "circle");
			cb.addEventListener("click", (e) => {
				e.stopPropagation();
				void toggleTask(t);
			});
			row.createDiv("dash-list-name" + (t.done ? " is-done" : "")).setText(t.text);
			if (showMeta) row.createDiv("dash-list-meta").setText(t.file.basename);
			row.addEventListener("click", () => void openTask(t));
		}

		async function toggleTask(t: VaultTask): Promise<void> {
			const file = t.file;
			if (!(file instanceof TFile) || file.extension !== "md") return;
			try {
				const lines = (await ctx.plugin.app.vault.read(file)).split("\n");
				let idx = t.line >= 0 && lineMatchesTask(lines[t.line], t.text) ? t.line : nearestTaskLine(lines, t.text, t.line);
				if (idx < 0) return;
				lines[idx] = toggleTaskLine(lines[idx]);
				await ctx.plugin.app.vault.modify(file, lines.join("\n"));
				ctx.refresh();
			} catch (e) {
				console.error("Aurora Dashboard: could not update that task.", e);
				new Notice("Could not update that task.");
			}
		}

		async function openTask(t: VaultTask): Promise<void> {
			const file = t.file;
			if (!(file instanceof TFile)) return;
			try {
				const leaf = ctx.plugin.app.workspace.getLeaf(false);
				await leaf.openFile(file);
				const view = leaf.view;
				if (view instanceof MarkdownView) {
					view.editor.setCursor({ line: t.line, ch: 0 });
					view.editor.scrollIntoView({ from: { line: t.line, ch: 0 }, to: { line: t.line + 1, ch: 0 } }, true);
					view.editor.focus();
				}
			} catch (e) {
				console.error("Aurora Dashboard: could not open that task.", e);
			}
		}

		return {};
	},
};

registerWidgetType(vaultTasksType);
