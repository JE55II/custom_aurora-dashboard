import type { App } from "obsidian";
import type { WidgetType } from "../types";
import { registerWidgetType } from "../registry";
import { dateKey } from "../utils";

const LOOKBACK_DAYS = 800;
/** Hard cap so a vault with an implausible timestamp cannot make the scan huge. */
const MAX_LOOKBACK_DAYS = 365 * 30;

function shift(d: Date, days: number): Date {
	const c = new Date(d);
	c.setDate(c.getDate() + days);
	return c;
}

/**
 * Where the "best run" scan starts: as far back as the vault's oldest note.
 * A fixed window would cap "Best" while the current streak keeps growing.
 */
function scanStart(app: App, today: Date): Date {
	let oldest = Infinity;
	for (const f of app.vault.getMarkdownFiles()) {
		const created = f.stat.ctime || f.stat.mtime || 0;
		const edited = f.stat.mtime || f.stat.ctime || 0;
		const t = Math.min(created || Infinity, edited || Infinity);
		if (t < oldest) oldest = t;
	}
	if (!Number.isFinite(oldest)) return shift(today, -LOOKBACK_DAYS);
	const from = new Date(oldest);
	from.setHours(0, 0, 0, 0);
	const limit = shift(today, -MAX_LOOKBACK_DAYS);
	return from < limit ? limit : from;
}

export const streakType: WidgetType = {
	type: "streak",
	name: "Daily streak",
	description: "Consecutive days you've written a daily note",
	icon: "calendar-check",
	defaultSize: { w: 4, h: 2 },
	render(ctx) {
		const plugin = ctx.plugin;
		const exists = (d: Date): boolean => plugin.noteExistsFor(d);

		const numEl = ctx.body.createDiv("dash-streak-num");
		const subEl = ctx.body.createDiv("dash-streak-sub");

		const renderStats = (): void => {
			const today = new Date();
			// Current streak: allow today to not be written yet.
			let cur = today;
			if (!exists(cur)) cur = shift(cur, -1);
			let streak = 0;
			while (exists(cur)) {
				streak++;
				cur = shift(cur, -1);
			}

			// Longest run over the whole note history.
			let best = 0;
			let run = 0;
			const start = scanStart(plugin.app, today);
			for (let d = new Date(start); d <= today; d = shift(d, 1)) {
				if (exists(d)) {
					run++;
					if (run > best) best = run;
				} else {
					run = 0;
				}
			}

			let thisWeek = 0;
			const weekStart = shift(today, -6);
			for (let d = new Date(weekStart); d <= today; d = shift(d, 1)) {
				if (exists(d)) thisWeek++;
			}

			const last = lastNoteDate(exists, today);
			numEl.setText(String(streak));
			subEl.setText(streak === 1 ? "day streak" : "days streak");
			const chips = ctx.body.createDiv("dash-hm-stats");
			chip(chips, `Best · ${best}d`, "Longest run on record");
			chip(chips, `This week · ${thisWeek}/7`, "Daily notes in the last 7 days");
			if (last) chip(chips, `Last · ${dateKey(last)}`, "Most recent daily note");
		};

		renderStats();

		// Re-render when the day rolls over.
		let curKey = dateKey(new Date());
		const id = window.setInterval(() => {
			const k = dateKey(new Date());
			if (k !== curKey) {
				curKey = k;
				ctx.refresh();
			}
		}, 30_000);
		return { dispose: () => window.clearInterval(id) };
	},
};

function chip(parent: HTMLElement, text: string, title: string): void {
	const c = parent.createDiv("dash-hm-chip");
	c.setText(text);
	c.setAttr("title", title);
}

function lastNoteDate(exists: (d: Date) => boolean, today: Date): Date | null {
	for (let i = 0; i <= LOOKBACK_DAYS; i++) {
		const d = shift(today, -i);
		if (exists(d)) return d;
	}
	return null;
}

registerWidgetType(streakType);
