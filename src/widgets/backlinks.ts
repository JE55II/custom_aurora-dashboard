import { setIcon, TFile, type MetadataCache } from "obsidian";
import type { WidgetType } from "../types";
import { registerWidgetType } from "../registry";

const MAX = 12;

export const backlinksType: WidgetType = {
	type: "backlinks",
	name: "Backlinks",
	description: "Notes that link to the note you're viewing",
	icon: "corner-up-left",
	defaultSize: { w: 4, h: 3 },
	render(ctx) {
		const app = ctx.plugin.app;

		const render = (): void => {
			const body = ctx.body;
			body.empty();
			const active = app.workspace.getActiveFile ? app.workspace.getActiveFile() : null;
			const list = body.createDiv("dash-list");
			if (!(active instanceof TFile) || active.extension !== "md") {
				list.createDiv("dash-empty").setText("Open a note to see its backlinks");
				return;
			}
			list.createDiv("dash-divider").setText(`In “${active.basename}”`);

			const resolved =
				(app.metadataCache as MetadataCache & { resolvedLinks?: Record<string, Record<string, number>> })
					.resolvedLinks ?? {};
			const sources: string[] = [];
			for (const [source, targets] of Object.entries(resolved)) {
				if (source === active.path) continue;
				if (targets[active.path]) sources.push(source);
			}
			sources.sort();

			if (!sources.length) {
				list.createDiv("dash-empty").setText("No backlinks yet");
				return;
			}
			for (const path of sources.slice(0, MAX)) {
				const f = app.vault.getAbstractFileByPath(path);
				if (!(f instanceof TFile)) continue;
				const row = list.createDiv("dash-list-row");
				const icon = row.createDiv("dash-list-icon");
				setIcon(icon, "file-text");
				row.createDiv("dash-list-name").setText(f.basename);
				row.createDiv("dash-list-meta").setText(path);
				row.addEventListener("click", () => ctx.plugin.openFile(f));
			}
			if (sources.length > MAX) {
				list.createDiv("dash-empty").setText(`…and ${sources.length - MAX} more`);
			}
		};

		render();

		const onLeaf = (): void => ctx.refresh();
		const onMeta = (): void => ctx.refresh();
		app.workspace.on("active-leaf-change", onLeaf);
		app.metadataCache?.on?.("changed", onMeta);
		// Registered through the context, so the subscriptions are released even if
		// something below throws before render returns.
		ctx.onDispose?.(() => {
			app.workspace.off?.("active-leaf-change", onLeaf);
			app.metadataCache?.off?.("changed", onMeta);
		});

		return {};
	},
};

registerWidgetType(backlinksType);
