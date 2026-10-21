import type { WidgetType } from "../types";
import { registerWidgetType } from "../registry";
import { dateKey, startOfDay } from "../utils";

export const activityType: WidgetType = {
	type: "activity",
	name: "Activity",
	description: "GitHub-style heatmap of your editing activity",
	icon: "flame",
	defaultSize: { w: 3, h: 4 },
	defaultSettings: { weeks: 14 },
	settings: [
		{ key: "weeks", label: "Weeks shown", type: "number", min: 4, max: 26 },
	],
	render(ctx) {
		const activity = ctx.plugin.settings.activity;
		const weeksShown = Math.max(4, Math.min(26, Number(ctx.inst.settings.weeks ?? 14) || 14));

		const today = new Date();
		const start = new Date(today);
		start.setDate(start.getDate() - (weeksShown * 7 - 1));
		const align = (start.getDay() + 6) % 7;
		start.setDate(start.getDate() - align);

		const weeks: Date[][] = [];
		let col: Date[] = [];
		const d = new Date(start);
		while (d <= today) {
			col.push(new Date(d));
			if (col.length === 7) {
				weeks.push(col);
				col = [];
			}
			d.setDate(d.getDate() + 1);
		}
		if (col.length) weeks.push(col);

		let maxCount = 1;
		for (const c of weeks) for (const day of c) {
			const n = activity[dateKey(day)] ?? 0;
			if (n > maxCount) maxCount = n;
		}

		const hm = ctx.body.createDiv("dash-heatmap");
		hm.setAttr("title", "Each square is one day. Darker = more edits. Hover a square for details.");
		for (const colDays of weeks) {
			const wEl = hm.createDiv("dash-hm-col");
			for (const day of colDays) {
				const key = dateKey(day);
				const count = day <= today ? activity[key] ?? 0 : 0;
				// A single-edit day is the busiest day there is: without the guard the
				// ratio is 0/0 and the only active square renders as empty ("NaN").
				const level = count === 0 ? 0 : maxCount <= 1 ? 4 : 1 + Math.round(((count - 1) / (maxCount - 1)) * 3);
				const cell = wEl.createDiv("dash-hm-cell");
				cell.setAttr("data-lvl", String(level));
				cell.setAttr("title", `${key} · ${count} edit${count === 1 ? "" : "s"}`);
			}
		}

		const stats = ctx.body.createDiv("dash-hm-stats");
		const streakChip = stats.createDiv("dash-hm-chip");
		streakChip.setText(`Streak · ${currentStreak(activity, today)}d`);
		streakChip.setAttr("title", "Consecutive days with at least one edit");
		const weekChip = stats.createDiv("dash-hm-chip");
		weekChip.setText(`Week · ${sumRange(activity, today, 7)}`);
		weekChip.setAttr("title", "Total edits in the last 7 days");
		const totalChip = stats.createDiv("dash-hm-chip");
		totalChip.setText(`Total · ${Object.values(activity).reduce((a, b) => a + b, 0)}`);
		totalChip.setAttr("title", "All edits since tracking started");

		const legend = ctx.body.createDiv("dash-hm-legend");
		legend.createDiv("dash-hm-legend-label").setText("Less");
		for (let lvl = 0; lvl <= 4; lvl++) {
			const sw = legend.createDiv("dash-hm-cell dash-hm-swatch");
			sw.setAttr("data-lvl", String(lvl));
			sw.setAttr(
				"title",
				lvl === 0 ? "No activity" : `${["Light", "Moderate", "Busy", "Very active"][lvl - 1]} day`
			);
		}
		legend.createDiv("dash-hm-legend-label").setText("More");

		return {};
	},
};

export const statsType: WidgetType = {
	type: "stats",
	name: "Notes",
	description: "Your vault stats at a glance",
	icon: "chart-bar",
	defaultSize: { w: 4, h: 2 },
	render(ctx) {
		const app = ctx.plugin.app;
		const files = app.vault.getMarkdownFiles();
		const today = new Date();
		const createdToday = files.filter((f) => f.stat.ctime >= startOfDay(today)).length;
		const activity = ctx.plugin.settings.activity;

		const row = ctx.body.createDiv("dash-stat-row");
		statCell(row, "Notes", String(files.length));
		statCell(row, "Created today", String(createdToday));
		statCell(row, "Edits this week", String(sumRange(activity, today, 7)));

		const spark = ctx.body.createDiv("dash-spark");
		for (let i = 6; i >= 0; i--) {
			const d = new Date(today);
			d.setDate(d.getDate() - i);
			const n = activity[dateKey(d)] ?? 0;
			const max = Math.max(1, ...lastSeven(activity, today));
			const col = spark.createDiv("dash-spark-col");
			const plot = col.createDiv("dash-spark-plot");
			const bar = plot.createDiv("dash-spark-bar");
			bar.style.height = Math.round((n / max) * 100) + "%";
			bar.setAttr("title", `${dateKey(d)} · ${n} edits`);
			const lab = col.createDiv("dash-spark-label");
			lab.setText(dayLabel(d));
			if (i === 0) lab.addClass("dash-spark-today");
		}

		return {};
	},
};

function statCell(parent: HTMLElement, label: string, value: string): void {
	const cell = parent.createDiv("dash-stat");
	cell.createDiv("dash-stat-value").setText(value);
	cell.createDiv("dash-stat-label").setText(label);
}

function dayLabel(d: Date): string {
	return ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][d.getDay()];
}

function lastSeven(activity: Record<string, number>, today: Date): number[] {
	const out: number[] = [];
	for (let i = 6; i >= 0; i--) {
		const d = new Date(today);
		d.setDate(d.getDate() - i);
		out.push(activity[dateKey(d)] ?? 0);
	}
	return out;
}

function sumRange(activity: Record<string, number>, today: Date, days: number): number {
	return lastSeven(activity, today)
		.slice(0, days)
		.reduce((a, b) => a + b, 0);
}

function currentStreak(activity: Record<string, number>, today: Date): number {
	const d = new Date(today);
	if (!activity[dateKey(d)]) d.setDate(d.getDate() - 1);
	let s = 0;
	while (activity[dateKey(d)]) {
		s++;
		d.setDate(d.getDate() - 1);
	}
	return s;
}

registerWidgetType(activityType);
registerWidgetType(statsType);
