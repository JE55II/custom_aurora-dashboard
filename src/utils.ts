import { setIcon } from "obsidian";

export const uid = (): string =>
	Math.random().toString(36).slice(2, 9) + Date.now().toString(36);

/**
 * `clamp` that also survives inverted or non-numeric bounds. When `lo > hi` the
 * upper bound wins, because callers derive it from a hard limit (the grid space
 * actually available) while `lo` is only a preference.
 */
export function clamp(n: number, lo: number, hi: number): number {
	const a = Number.isFinite(lo) ? lo : 0;
	const b = Number.isFinite(hi) ? hi : a;
	const x = Number.isFinite(n) ? n : a;
	if (a > b) return b;
	return Math.max(a, Math.min(b, x));
}

export const pad2 = (n: number): string => String(n).padStart(2, "0");

export const dateKey = (d: Date): string =>
	`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];

/** Longest token first, so `MMMM` never resolves as `MM` followed by literal text. */
const DATE_TOKENS = /YYYY|YY|MMMM|MMM|MM|DD|dddd|ddd|dd/g;

/**
 * Date formatter supporting YYYY, YY, MMMM, MMM, MM, DD, dddd, ddd and dd.
 * One regex pass, so repeated and adjacent tokens both resolve correctly
 * (`DD.MM.DD` used to come out as `06.11.DD`).
 */
export function formatDate(d: Date, fmt: string): string {
	return fmt.replace(DATE_TOKENS, (token) => {
		switch (token) {
			case "YYYY":
				return String(d.getFullYear());
			case "YY":
				return String(d.getFullYear()).slice(-2);
			case "MMMM":
				return MONTHS_LONG[d.getMonth()];
			case "MMM":
				return MONTHS_SHORT[d.getMonth()];
			case "MM":
				return pad2(d.getMonth() + 1);
			case "DD":
			case "dd":
				return pad2(d.getDate());
			case "dddd":
				return DAYS_LONG[d.getDay()];
			case "ddd":
				return DAYS_SHORT[d.getDay()];
			default:
				return token;
		}
	});
}

export function setIconSafe(el: HTMLElement, name: string): void {
	try {
		setIcon(el, name);
	} catch {
		el.setText("·");
	}
}

export function iconInto(el: HTMLElement, cls: string, name: string): HTMLElement {
	const holder = el.createDiv({ cls });
	setIconSafe(holder, name);
	return holder;
}

export function relTime(ts: number): string {
	const diff = Date.now() - ts;
	const m = Math.floor(diff / 60000);
	if (m < 1) return "just now";
	if (m < 60) return `${m}m ago`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}h ago`;
	const days = Math.floor(h / 24);
	if (days < 7) return `${days}d ago`;
	return new Date(ts).toLocaleDateString();
}

export function startOfDay(d: Date): number {
	const c = new Date(d);
	c.setHours(0, 0, 0, 0);
	return c.getTime();
}
