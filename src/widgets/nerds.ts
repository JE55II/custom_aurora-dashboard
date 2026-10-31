import { getAllTags, TFile, type App } from "obsidian";
import type { WidgetCtx, WidgetType } from "../types";
import { registerWidgetType } from "../registry";
import { dateKey } from "../utils";

/**
 * Year heatmaps of the SOC ticket and night-duty (astreinte) notes. Native, so
 * they need neither Dataview nor Heatmap Calendar.
 */

type Counts = Record<string, number>;

interface Source {
	folder: string;
	color: string;
	unit: string;
	count: (app: App, files: TFile[]) => Promise<Counts>;
}

const ISO = /^(\d{4}-\d{2}-\d{2})/;

function tagsOf(app: App, f: TFile): string[] {
	const cache = app.metadataCache.getFileCache(f);
	return cache ? (getAllTags(cache) ?? []).map((t) => t.replace(/^#/, "").toLowerCase()) : [];
}

/**
 * Ticket ID prefixes the user set in the templates (`const TICKET_PREFIX = "INC"`),
 * read from the Templater templates folder so the prefix is edited in one place only.
 */
async function ticketPrefixes(app: App): Promise<string[]> {
	const templater = (app as unknown as {
		plugins?: { plugins?: Record<string, { settings?: { templates_folder?: string } }> };
	}).plugins?.plugins?.["templater-obsidian"];
	const folder = templater?.settings?.templates_folder || "Obsidian-Templates/templates";
	const found = new Set<string>();
	for (const f of app.vault.getMarkdownFiles()) {
		if (!f.path.startsWith(folder + "/")) continue;
		const m = /const\s+TICKET_PREFIX\s*=\s*["'`]([^"'`]+)["'`]/.exec(await app.vault.cachedRead(f));
		if (m) found.add(m[1]);
	}
	return [...found];
}

/** One note may bundle several tickets ("INC-1 INC-2.md"): count each distinct ID. */
function ticketCount(name: string, prefixes: string[]): number {
	if (!prefixes.length) return 1;
	const alt = prefixes.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
	return new Set((name.match(new RegExp(`(?:${alt})-\\d+`, "gi")) ?? []).map((s) => s.toUpperCase())).size || 1;
}

function add(c: Counts, date: string, n: number): void {
	c[date] = (c[date] ?? 0) + n;
}

const SOURCES: Record<string, Source> = {
	"SOC Operations": {
		folder: "♻️ DailyNotes/Soc Operation/SocTickets",
		color: "hsl(119, 45%, 45%)",
		unit: "ticket",
		async count(app, files) {
			const c: Counts = {};
			const prefixes = await ticketPrefixes(app);
			for (const f of files) {
				if (!tagsOf(app, f).includes("soc_operation")) {
					if (!/#soc_operation\b/.test(await app.vault.cachedRead(f))) continue;
				}
				// SocTickets/2026/05-May/06/file.md
				const parts = (f.parent?.path ?? "").split("/");
				if (parts.length < 3) continue;
				const [year, month, day] = parts.slice(-3);
				const mm = /^(\d{2})/.exec(month)?.[1];
				const dd = day.replace(/\D/g, "").padStart(2, "0");
				if (!/^\d{4}$/.test(year) || !mm || !dd) continue;
				add(c, `${year}-${mm}-${dd}`, ticketCount(f.basename, prefixes));
			}
			return c;
		},
	},
	Astreinte: {
		folder: "🔎⏰Astreintes",
		color: "hsl(252, 45%, 45%)",
		unit: "ticket",
		async count(app, files) {
			const c: Counts = {};
			const prefixes = await ticketPrefixes(app);
			for (const f of files) {
				const content = await app.vault.cachedRead(f);
				if (!tagsOf(app, f).includes("astreinte") && !/#astreinte\b/.test(content)) continue;
				// Newer tickets: "date" property (or legacy "Date"); older ones: "**Date** : YYYY-MM-DD" in the body;
				// last resort: file creation date.
				const fm = app.metadataCache.getFileCache(f)?.frontmatter;
				const date =
					ISO.exec(String(fm?.date ?? fm?.Date ?? ""))?.[1] ??
					/\*\*Date\*\*\s*:\s*(\d{4}-\d{2}-\d{2})/.exec(content)?.[1] ??
					dateKey(new Date(f.stat.ctime));
				add(c, date, ticketCount(f.basename, prefixes));
			}
			return c;
		},
	},
};

/** Re-render on vault changes, debounced, through the widget's own lifecycle. */
function refreshOnChange(ctx: WidgetCtx): void {
	const app = ctx.plugin.app;
	let timer = 0;
	const onChange = (): void => {
		window.clearTimeout(timer);
		timer = window.setTimeout(() => ctx.refresh(), 3000);
	};
	app.metadataCache.on("resolved", onChange);
	ctx.onDispose?.(() => {
		app.metadataCache.off("resolved", onChange);
		window.clearTimeout(timer);
	});
}

export const noteHeatmapType: WidgetType = {
	type: "noteheatmap",
	name: "Note heatmap",
	description: "Year heatmap of SOC operations or astreintes",
	icon: "calendar-range",
	min: { w: 4, h: 2 },
	defaultSize: { w: 6, h: 3 },
	defaultSettings: { source: "SOC Operations" },
	settings: [{ key: "source", label: "Source", type: "select", options: Object.keys(SOURCES) }],
	render(ctx) {
		const name = String(ctx.inst.settings.source ?? "SOC Operations");
		const src = SOURCES[name] ?? SOURCES["SOC Operations"];
		const app = ctx.plugin.app;
		ctx.body.style.setProperty("--dash-accent", src.color);
		const files = app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(src.folder + "/"));
		if (!files.length) {
			ctx.body.createDiv("dash-empty").setText(`No notes in “${src.folder}”.`);
			return {};
		}
		const hm = ctx.body.createDiv("dash-heatmap");
		const stats = ctx.body.createDiv("dash-hm-stats");
		let alive = true;
		ctx.onDispose?.(() => (alive = false));
		refreshOnChange(ctx);

		void src.count(app, files).then((counts) => {
			if (!alive) return;
			// Current year, Jan 1 → today, weeks as columns (Monday first).
			const today = new Date();
			const d = new Date(today.getFullYear(), 0, 1);
			d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
			const max = Math.max(1, ...Object.values(counts));
			let col: HTMLElement | null = null;
			let i = 0;
			let yearTotal = 0;
			let activeDays = 0;
			while (d <= today) {
				if (i++ % 7 === 0) col = hm.createDiv("dash-hm-col");
				const key = dateKey(d);
				const inYear = d.getFullYear() === today.getFullYear();
				const n = inYear ? counts[key] ?? 0 : 0;
				if (n) {
					yearTotal += n;
					activeDays++;
				}
				const lvl = n === 0 ? 0 : max <= 1 ? 4 : 1 + Math.round(((n - 1) / (max - 1)) * 3);
				const cell = col!.createDiv("dash-hm-cell");
				if (!inYear) cell.style.visibility = "hidden";
				cell.setAttr("data-lvl", String(lvl));
				cell.setAttr("title", `${key} · ${n} ${src.unit}${n === 1 ? "" : "s"}`);
				d.setDate(d.getDate() + 1);
			}
			const chip = (text: string, title: string): void => {
				const el = stats.createDiv("dash-hm-chip");
				el.setText(text);
				el.setAttr("title", title);
			};
			chip(name, src.folder);
			chip(`${today.getFullYear()} · ${yearTotal}`, `${src.unit}s this year`);
			chip(`Days · ${activeDays}`, "Days with at least one");
		});
		return {};
	},
};

registerWidgetType(noteHeatmapType);
