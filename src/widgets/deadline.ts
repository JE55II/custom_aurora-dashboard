import type { WidgetType } from "../types";
import { registerWidgetType } from "../registry";

const MS_PER_DAY = 86_400_000;

function parseDate(s: string): Date | null {
	const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s.trim());
	if (!m) return null;
	const year = Number(m[1]);
	const month = Number(m[2]);
	const day = Number(m[3]);
	const d = new Date(year, month - 1, day);
	// `new Date` normalises out-of-range components, so 2026-02-30 would silently
	// become Mar 2 — a confident countdown to a date the user never typed.
	if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
	return Number.isNaN(d.getTime()) ? null : d;
}

function localMidnight(d: Date): Date {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export const deadlineType: WidgetType = {
	type: "deadline",
	name: "Deadline",
	description: "Countdown to a date you set",
	icon: "hourglass",
	defaultSize: { w: 3, h: 2 },
	defaultSettings: { date: "", label: "" },
	settings: [
		{ key: "date", label: "Deadline date", type: "text", placeholder: "YYYY-MM-DD" },
		{ key: "label", label: "Label", type: "text", placeholder: "e.g. Launch" },
	],
	render(ctx) {
		const s = ctx.inst.settings;
		const daysEl = ctx.body.createDiv("dash-deadline-days");
		const subEl = ctx.body.createDiv("dash-deadline-sub");
		const footEl = ctx.body.createDiv("dash-deadline-date");

		const update = (): void => {
			const raw = typeof s.date === "string" ? s.date : "";
			const target = parseDate(raw);
			if (!target) {
				daysEl.setText("—");
				subEl.setText("Set a date in settings");
				footEl.setText("");
				daysEl.removeClass("overdue");
				return;
			}
			const diff = Math.round(
				(localMidnight(target).getTime() - localMidnight(new Date()).getTime()) / MS_PER_DAY
			);
			const label = typeof s.label === "string" && s.label.trim() ? s.label.trim() : "Deadline";
			daysEl.removeClass("overdue");
			if (diff > 0) {
				daysEl.setText(String(diff));
				subEl.setText(diff === 1 ? "day left" : "days left");
			} else if (diff === 0) {
				daysEl.setText("0");
				subEl.setText("today");
			} else {
				daysEl.setText(String(-diff));
				subEl.setText(-diff === 1 ? "day overdue" : "days overdue");
				daysEl.addClass("overdue");
			}
			footEl.setText(
				`${label} · ${target.toLocaleDateString(undefined, {
					month: "short",
					day: "numeric",
					year: "numeric",
				})}`
			);
		};

		update();
		const id = window.setInterval(update, 60000);
		return { dispose: () => window.clearInterval(id) };
	},
};

registerWidgetType(deadlineType);
