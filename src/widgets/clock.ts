import type { WidgetType } from "../types";
import { registerWidgetType } from "../registry";
import { pad2 } from "../utils";

export const clockType: WidgetType = {
	type: "clock",
	name: "Clock",
	description: "A live digital clock with the current date",
	icon: "clock",
	noHeader: true,
	defaultSize: { w: 4, h: 2 },
	defaultSettings: { showSeconds: true, format24: true },
	settings: [
		{ key: "showSeconds", label: "Show seconds", type: "toggle" },
		{ key: "format24", label: "24-hour format", type: "toggle" },
	],
	render(ctx) {
		const timeEl = ctx.body.createDiv("dash-clock-time");
		const dateEl = ctx.body.createDiv("dash-clock-date");

		const tick = (): void => {
			const d = new Date();
			const s = ctx.inst.settings;
			let h = d.getHours();
			const ampm = h >= 12 ? "PM" : "AM";
			if (!s.format24) h = h % 12 || 12;
			const sec = s.showSeconds ? `:${pad2(d.getSeconds())}` : "";
			timeEl.setText(`${pad2(h)}:${pad2(d.getMinutes())}${sec}${s.format24 ? "" : " " + ampm}`);
			dateEl.setText(
				d.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })
			);
		};

		tick();
		const id = window.setInterval(tick, 1000);
		return { dispose: () => window.clearInterval(id) };
	},
};

registerWidgetType(clockType);
