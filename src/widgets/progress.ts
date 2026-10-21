import type { WidgetType } from "../types";
import { registerWidgetType } from "../registry";

const NS = "http://www.w3.org/2000/svg";
const MS_PER_DAY = 86_400_000;

function makeRing(parent: HTMLElement, label: string): (frac: number) => void {
	const wrap = parent.createDiv("dash-prog-ring");
	const svg = document.createElementNS(NS, "svg");
	svg.setAttribute("viewBox", "0 0 120 120");
	svg.setAttribute("class", "dash-prog-svg");
	const mk = (cls: string): SVGCircleElement => {
		const c = document.createElementNS(NS, "circle");
		c.setAttribute("cx", "60");
		c.setAttribute("cy", "60");
		c.setAttribute("r", "52");
		c.setAttribute("class", cls);
		return c;
	};
	const track = mk("dash-ring-track");
	const bar = mk("dash-ring-bar");
	svg.append(track, bar);
	wrap.appendChild(svg);
	const C = 2 * Math.PI * 52;
	track.setAttribute("stroke-dasharray", String(C));
	bar.setAttribute("stroke-dasharray", String(C));

	const val = wrap.createDiv("dash-prog-val");
	wrap.createDiv("dash-prog-label").setText(label);

	return (frac: number): void => {
		const f = Math.max(0, Math.min(1, frac));
		val.setText(String(Math.round(f * 100)) + "%");
		bar.setAttribute("stroke-dashoffset", String(C * (1 - f)));
	};
}

function isLeap(y: number): boolean {
	return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export const progressType: WidgetType = {
	type: "progress",
	name: "Progress",
	description: "How much of the day, month and year has passed",
	icon: "gauge",
	defaultSize: { w: 4, h: 2 },
	render(ctx) {
		const row = ctx.body.createDiv("dash-prog-row");
		const dayRing = makeRing(row, "Day");
		const monthRing = makeRing(row, "Month");
		const yearRing = makeRing(row, "Year");

		const update = (): void => {
			const now = new Date();
			const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
			// Measured against tomorrow's midnight, so a 23- or 25-hour DST day
			// still shows a full ring.
			const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
			dayRing((now.getTime() - startOfDay.getTime()) / (endOfDay.getTime() - startOfDay.getTime()));

			const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
			monthRing(now.getDate() / dim);

			const startOfYear = new Date(now.getFullYear(), 0, 1);
			// Midnight to midnight, rounded: dividing raw elapsed ms rounds down one
			// day too many for the first hour after a DST shift.
			const doy = Math.round((startOfDay.getTime() - startOfYear.getTime()) / MS_PER_DAY) + 1;
			const daysInYear = isLeap(now.getFullYear()) ? 366 : 365;
			yearRing(doy / daysInYear);
		};

		update();
		const id = window.setInterval(update, 60_000);
		return { dispose: () => window.clearInterval(id) };
	},
};

registerWidgetType(progressType);
