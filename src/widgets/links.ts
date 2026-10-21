import { setIcon, TFile, type App, type MetadataCache } from "obsidian";
import type { WidgetType } from "../types";
import { registerWidgetType } from "../registry";

/** For each note path, the set of note paths that link to it (self-links excluded). */
function inboundSources(app: App): Map<string, Set<string>> {
	const resolved =
		(app.metadataCache as MetadataCache & { resolvedLinks?: Record<string, Record<string, number>> }).resolvedLinks ??
		{};
	const map = new Map<string, Set<string>>();
	for (const [source, targets] of Object.entries(resolved)) {
		for (const target of Object.keys(targets)) {
			if (target === source) continue;
			let set = map.get(target);
			if (!set) {
				set = new Set();
				map.set(target, set);
			}
			set.add(source);
		}
	}
	return map;
}

function addRow(list: HTMLElement, f: TFile, meta: string, title: string, open: (file: TFile) => void): void {
	const row = list.createDiv("dash-list-row");
	const icon = row.createDiv("dash-list-icon");
	setIcon(icon, "file-text");
	row.createDiv("dash-list-name").setText(f.basename);
	row.createDiv("dash-list-meta").setText(meta);
	row.setAttr("title", title);
	row.addEventListener("click", () => open(f));
}

export const popularType: WidgetType = {
	type: "popular",
	name: "Popular notes",
	description: "Your most-linked notes",
	icon: "link-2",
	defaultSize: { w: 4, h: 3 },
	defaultSettings: { count: 8 },
	settings: [{ key: "count", label: "Max notes shown", type: "number", min: 3, max: 20 }],
	render(ctx) {
		const app = ctx.plugin.app;
		const count = Math.max(3, Math.min(20, Number(ctx.inst.settings.count ?? 8) || 8));
		const inbound = inboundSources(app);
		const ranked = app.vault
			.getMarkdownFiles()
			.map((f) => ({ f, n: inbound.get(f.path)?.size ?? 0 }))
			.filter((x) => x.n > 0)
			.sort((a, b) => b.n - a.n || b.f.stat.mtime - a.f.stat.mtime)
			.slice(0, count);

		const list = ctx.body.createDiv("dash-list");
		if (!ranked.length) {
			list.createDiv("dash-empty").setText("No backlinks yet — link your notes!");
			return {};
		}
		for (const { f, n } of ranked) {
			addRow(list, f, `${n}↩`, `${f.basename} — linked from ${n} note${n === 1 ? "" : "s"}`, (file) =>
				ctx.plugin.openFile(file)
			);
		}
		return {};
	},
};

export const orphansType: WidgetType = {
	type: "orphans",
	name: "Orphan notes",
	description: "Notes nobody links to",
	icon: "unlink",
	defaultSize: { w: 4, h: 3 },
	defaultSettings: { count: 12 },
	settings: [{ key: "count", label: "Max notes shown", type: "number", min: 3, max: 30 }],
	render(ctx) {
		const app = ctx.plugin.app;
		const count = Math.max(3, Math.min(30, Number(ctx.inst.settings.count ?? 12) || 12));
		const inbound = inboundSources(app);
		const files = app.vault
			.getMarkdownFiles()
			.filter((f) => (inbound.get(f.path)?.size ?? 0) === 0)
			.sort((a, b) => b.stat.mtime - a.stat.mtime)
			.slice(0, count);

		const list = ctx.body.createDiv("dash-list");
		if (!files.length) {
			list.createDiv("dash-empty").setText("No orphan notes — everything is connected!");
			return {};
		}
		list.createDiv("dash-divider").setText(
			files.length === count ? `Orphans · newest first` : `Orphans · ${files.length} shown`
		);
		for (const f of files) {
			addRow(list, f, "", f.path, (file) => ctx.plugin.openFile(file));
		}
		return {};
	},
};

registerWidgetType(popularType);
registerWidgetType(orphansType);
