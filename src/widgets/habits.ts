import { Modal, Notice, setIcon, type App } from "obsidian";
import type { DashboardPlugin, WidgetInstance, WidgetType } from "../types";
import { registerWidgetType } from "../registry";
import { dateKey, uid } from "../utils";

interface Habit {
	id: string;
	name: string;
}

/** Completion log keyed by habit id: each entry is the list of completed dateKeys. */
type HabitLog = Record<string, string[]>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_LETTERS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/** A stable id for a hand-written habit that has none: same name, same id. */
function legacyId(name: string): string {
	const slug = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return "legacy-" + (slug || "habit");
}

/** Rebuilds the habit list from (possibly unknown) instance data. */
function readHabits(inst: WidgetInstance): Habit[] {
	const raw = inst.settings.habits;
	if (!Array.isArray(raw)) return [];
	const out: Habit[] = [];
	const seen = new Set<string>();
	for (const v of raw) {
		if (!v || typeof v !== "object") continue;
		const o = v as Record<string, unknown>;
		const name = typeof o.name === "string" && o.name.trim() !== "" ? o.name.trim() : "Habit";
		// An id-less habit used to get a fresh random id on every render, which
		// orphaned the completions logged against it.
		let id = typeof o.id === "string" && o.id !== "" ? o.id : legacyId(name);
		if (seen.has(id)) {
			let n = 2;
			while (seen.has(id + "-" + n)) n++;
			id = id + "-" + n;
		}
		seen.add(id);
		out.push({ id, name });
	}
	return out;
}

/** Rebuilds the completion log into a fresh object of fresh arrays. */
function readLog(inst: WidgetInstance): HabitLog {
	const raw = inst.settings.log;
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
	const out: HabitLog = {};
	for (const [hid, dates] of Object.entries(raw as Record<string, unknown>)) {
		if (!Array.isArray(dates)) continue;
		const arr = dates.filter((d): d is string => typeof d === "string" && DATE_RE.test(d));
		if (arr.length) out[hid] = arr;
	}
	return out;
}

/** How many trailing days the grid shows (7..31, default 14). */
function readDays(inst: WidgetInstance): number {
	const n = Math.round(Number(inst.settings.days));
	return Number.isFinite(n) ? Math.max(7, Math.min(31, n)) : 14;
}

function shift(d: Date, days: number): Date {
	const c = new Date(d);
	c.setDate(c.getDate() + days);
	return c;
}

/** Consecutive completed days ending today (today may still be pending). */
function currentStreak(dates: Set<string>, today: Date): number {
	let cur = today;
	if (!dates.has(dateKey(cur))) cur = shift(cur, -1);
	let s = 0;
	while (dates.has(dateKey(cur))) {
		s++;
		cur = shift(cur, -1);
	}
	return s;
}

export const habitsType: WidgetType = {
	type: "habits",
	name: "Habits",
	description: "Track daily habits on a rolling grid",
	icon: "target",
	defaultSize: { w: 6, h: 4 },
	defaultSettings: { days: 14, habits: [], log: {} },
	openSettings(plugin, inst) {
		new HabitsModal(plugin.app, plugin, inst).open();
	},
	render(ctx) {
		const inst = ctx.inst;
		const body = ctx.body;
		const habits = readHabits(inst);
		const days = readDays(inst);
		const log = readLog(inst);
		const today = new Date();

		if (!habits.length) {
			body.createDiv("dash-empty").setText("No habits yet — open widget settings to add some");
			return {};
		}

		// Rolling window of columns, oldest -> today.
		const cols: Date[] = [];
		for (let i = days - 1; i >= 0; i--) cols.push(shift(today, -i));

		// Summary chips above the grid.
		const chips = body.createDiv("dash-habits-chips");
		let doneToday = 0;
		for (const h of habits) {
			if ((log[h.id] ?? []).includes(dateKey(today))) doneToday++;
		}
		chip(chips, `Today ${doneToday}/${habits.length}`, "Habits completed today");
		let slots = habits.length * days;
		let filled = 0;
		for (const h of habits) filled += (log[h.id] ?? []).filter((k) => cols.some((c) => dateKey(c) === k)).length;
		if (slots > 0) chip(chips, `${Math.round((filled / slots) * 100)}% this window`, "Share of the shown days completed");

		// One shared CSS grid: header row, then one row per habit.
		const grid = body.createDiv("dash-habits-grid");
		grid.style.gridTemplateColumns = `minmax(0, 1fr) repeat(${days}, 18px) 34px`;

		// Header cells.
		grid.createDiv("dash-habit-hname").setText("Habit");
		for (const d of cols) {
			const c = grid.createDiv("dash-habit-hcell" + (dateKey(d) === dateKey(today) ? " is-today" : ""));
			c.createDiv("dash-habit-wd").setText(DAY_LETTERS[d.getDay()]);
			c.createDiv("dash-habit-dn").setText(String(d.getDate()));
			c.setAttr("title", d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }));
		}
		grid.createDiv("dash-habit-hcell");

		// Habit rows.
		for (const h of habits) {
			const dates = new Set(log[h.id] ?? []);
			const name = grid.createDiv("dash-habit-name");
			const label = name.createDiv("dash-habit-name-text");
			label.setText(h.name);
			label.setAttr("title", h.name);
			const streak = currentStreak(dates, today);
			if (streak > 0) {
				const fire = name.createDiv("dash-habit-fire");
				setIcon(fire, "flame");
				fire.appendText(String(streak));
				fire.setAttr("title", `${streak}-day current streak`);
			}

			for (const d of cols) {
				const key = dateKey(d);
				const done = dates.has(key);
				const cell = grid.createDiv(
					"dash-habit-cell" +
						(done ? " is-done" : "") +
						(key === dateKey(today) ? " is-today" : "")
				);
				cell.setAttr("data-hid", h.id);
				cell.setAttr("data-date", key);
				cell.setAttr("title", `${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · ${done ? "done — click to undo" : "not done — click to mark done"}`);
				cell.addEventListener("click", () => void toggle(h.id, key));
			}

			const sum = grid.createDiv("dash-habit-sum");
			const inWindow = (log[h.id] ?? []).filter((k) => cols.some((c) => dateKey(c) === k)).length;
			sum.setText(`${inWindow}/${days}`);
			sum.setAttr("title", `Completed ${inWindow} of the last ${days} days`);
		}

		async function toggle(hid: string, key: string): Promise<void> {
			const cur = log[hid] ?? [];
			const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key].sort();
			if (next.length) log[hid] = next;
			else delete log[hid];
			inst.settings.log = log;
			await ctx.plugin.saveSettings();
			ctx.refresh();
		}

		return {};
	},
};

function chip(parent: HTMLElement, text: string, title: string): void {
	const c = parent.createDiv("dash-hm-chip");
	c.setText(text);
	c.setAttr("title", title);
}

/** Normalizes a working habit list, dropping empty names and duplicates. */
function buildHabits(raw: Habit[]): Habit[] {
	const out: Habit[] = [];
	const seen = new Set<string>();
	for (const h of raw) {
		const name = h.name.trim();
		if (!name || seen.has(name)) continue;
		seen.add(name);
		out.push({ id: h.id, name });
	}
	return out;
}

class HabitsModal extends Modal {
	plugin: DashboardPlugin;
	inst: WidgetInstance;
	private habits: Habit[];
	private days: number;
	private clearLog = false;

	constructor(app: App, plugin: DashboardPlugin, inst: WidgetInstance) {
		super(app);
		this.plugin = plugin;
		this.inst = inst;
		this.habits = readHabits(inst);
		this.days = readDays(inst);
	}

	onOpen(): void {
		this.titleEl.setText("Habits — settings");
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();

		// Window length.
		const winRow = contentEl.createDiv("dash-qa-row");
		const winLabel = winRow.createDiv("dash-qa-name");
		winLabel.setText("Days shown");
		winLabel.setAttr("title", "How many trailing days each habit row shows");
		const winInput = winRow.createEl("input", {
			cls: "dash-qa-input dash-habit-days-input",
			attr: { type: "number", min: "7", max: "31", placeholder: "14" },
		});
		winInput.value = String(this.days);
		winInput.addEventListener("change", () => {
			const n = Math.round(Number(winInput.value));
			this.days = Number.isFinite(n) ? Math.max(7, Math.min(31, n)) : 14;
			winInput.value = String(this.days);
		});

		// Add a habit.
		const addRow = contentEl.createDiv("dash-qa-row");
		const addInput = addRow.createEl("input", {
			cls: "dash-qa-input",
			attr: { placeholder: "New habit name… (Enter to add)" },
		});
		const addBtn = addRow.createDiv("dash-btn dash-btn-accent");
		setIcon(addBtn, "plus");
		const addNow = (): void => {
			const name = addInput.value.trim();
			if (!name) return;
			this.habits.push({ id: uid(), name });
			void this.persist();
			addInput.value = "";
			this.render();
		};
		addBtn.addEventListener("click", addNow);
		addInput.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				addNow();
			}
		});

		// Habit list.
		const list = contentEl.createDiv("dash-qa-list");
		if (!this.habits.length) list.createDiv("dash-empty").setText("No habits yet — add one above.");
		for (const h of this.habits) {
			const row = list.createDiv("dash-qa-row");
			const input = row.createEl("input", { cls: "dash-qa-input", attr: { placeholder: "Habit name" } });
			input.value = h.name;
			input.addEventListener("input", () => (h.name = input.value));
			const del = row.createDiv("dash-btn dash-btn-danger");
			setIcon(del, "x");
			del.setAttr("aria-label", "Remove habit");
			del.addEventListener("click", () => {
				this.habits = this.habits.filter((x) => x.id !== h.id);
				void this.persist();
				this.render();
			});
		}

		contentEl.createDiv("dash-modal-foot", (foot) => {
			const clear = foot.createDiv("dash-btn dash-btn-danger");
			clear.setText("Clear history");
			clear.setAttr("aria-label", "Erase all completion history for these habits");
			clear.addEventListener("click", () => {
				this.clearLog = true;
				new Notice("Habit history will be cleared when you close this window");
			});
			const done = foot.createDiv("dash-btn dash-btn-accent");
			done.setText("Done");
			done.addEventListener("click", () => void this.commit());
		});

		addInput.focus();
	}

	onClose(): void {
		// Habit names, the window length and a pending "clear history" are local
		// until now: persist on the way out, whatever closed the modal.
		void this.persist();
		this.contentEl.empty();
	}

	/** Save the habit list, window length and pruned history, then refresh the widget. */
	private async persist(): Promise<void> {
		this.inst.settings.days = this.days;
		this.inst.settings.habits = buildHabits(this.habits);
		// Drop history for habits that no longer exist (or everything when cleared).
		const keep = new Set((this.inst.settings.habits as Habit[]).map((h) => h.id));
		const log = this.clearLog ? {} : readLog(this.inst);
		for (const hid of Object.keys(log)) if (!keep.has(hid)) delete log[hid];
		this.inst.settings.log = log;
		await this.plugin.saveSettings();
		this.plugin.refreshWidget(this.inst.uid);
	}

	private async commit(): Promise<void> {
		await this.persist();
		this.close();
	}
}

registerWidgetType(habitsType);
