import { setIcon } from "obsidian";
import type { WidgetType } from "../types";
import { registerWidgetType } from "../registry";

export const randomType: WidgetType = {
	type: "random",
	name: "Random note",
	description: "Open a random note from your vault",
	icon: "shuffle",
	defaultSize: { w: 3, h: 2 },
	render(ctx) {
		const btn = ctx.body.createDiv("dash-random-btn");
		const icon = btn.createDiv("dash-random-icon");
		setIcon(icon, "shuffle");
		const label = btn.createDiv("dash-random-label");
		label.setText("Random note");

		btn.addEventListener("click", () => {
			const files = ctx.plugin.app.vault.getMarkdownFiles();
			if (!files.length) {
				btn.addClass("dash-random-empty");
				label.setText("No notes yet");
				return;
			}
			ctx.plugin.openFile(files[Math.floor(Math.random() * files.length)]);
		});

		return {};
	},
};

registerWidgetType(randomType);
