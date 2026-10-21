import { setIcon } from "obsidian";
import type { WidgetType } from "../types";
import { registerWidgetType } from "../registry";
import { dateKey } from "../utils";

export const calendarType: WidgetType = {
	type: "calendar",
	name: "Calendar",
	description: "Month view of your notes with daily-note navigation",
	icon: "calendar-days",
	defaultSize: { w: 5, h: 4 },
	defaultSettings: { startMonday: true },
	settings: [
		{ key: "startMonday", label: "Start week on Monday", type: "toggle" },
	],
	render(ctx) {
		const startMonday = !!ctx.inst.settings.startMonday;
		const viewDate = new Date();
		viewDate.setDate(1);

		const renderMonth = (): void => {
			ctx.body.empty();

			const head = ctx.body.createDiv("dash-cal-head");
			const prev = head.createDiv("dash-nav-btn");
			setIcon(prev, "chevron-left");
			prev.addEventListener("click", () => {
				viewDate.setMonth(viewDate.getMonth() - 1);
				renderMonth();
			});
			head.createDiv("dash-cal-title").setText(
				viewDate.toLocaleDateString(undefined, { month: "long", year: "numeric" })
			);
			const next = head.createDiv("dash-nav-btn");
			setIcon(next, "chevron-right");
			next.addEventListener("click", () => {
				viewDate.setMonth(viewDate.getMonth() + 1);
				renderMonth();
			});
			head.createDiv("dash-cal-spacer");
			const today = head.createDiv("dash-nav-btn");
			setIcon(today, "circle-dot");
			today.setAttr("aria-label", "Jump to current month");
			today.addEventListener("click", () => {
				const now = new Date();
				viewDate.setFullYear(now.getFullYear(), now.getMonth(), 1);
				renderMonth();
			});

			const grid = ctx.body.createDiv("dash-cal-grid");
			const dow = startMonday
				? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
				: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
			for (const d of dow) grid.createDiv("dash-cal-dow").setText(d);

			const first = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
			const offset = (first.getDay() + (startMonday ? 6 : 0)) % 7;
			const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();
			const todayKey = dateKey(new Date());

			for (let i = 0; i < offset; i++) grid.createDiv("dash-cal-cell dash-cal-empty");

			for (let day = 1; day <= daysInMonth; day++) {
				const d = new Date(viewDate.getFullYear(), viewDate.getMonth(), day);
				const key = dateKey(d);
				const cell = grid.createDiv("dash-cal-cell");
				cell.createDiv("dash-cal-day").setText(String(day));
				if (ctx.plugin.noteExistsFor(d)) cell.addClass("has-note");
				if (key === todayKey) cell.addClass("is-today");
				cell.addEventListener("click", () => void ctx.plugin.openDay(d));
			}
		};

		renderMonth();
		return {};
	},
};

registerWidgetType(calendarType);
