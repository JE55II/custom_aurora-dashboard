import { getAllTags, TFile, type App } from "obsidian";
import type { WidgetCtx, WidgetType } from "../types";
import { registerWidgetType } from "../registry";
import { dateKey } from "../utils";

/**
 * Ports of the "Heatmaps for nerds" dataviewjs blocks (Five9s vault) and a CVE
 * chart fed by the CVE-Report Update Tracker. Same counting rules as the notes,
 * but native, so they need neither Dataview nor Heatmap Calendar.
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
	"Daily News": {
		folder: "📡Koffei/Daily CyberNews",
		color: "hsl(119, 45%, 45%)",
		unit: "post",
		async count(app, files) {
			const c: Counts = {};
			for (const f of files) {
				const tags = tagsOf(app, f);
				if (!tags.includes("cybernews") || tags.includes("index")) continue;
				const fm = app.metadataCache.getFileCache(f)?.frontmatter;
				const date = ISO.exec(f.basename)?.[1] ?? ISO.exec(String(fm?.date ?? ""))?.[1];
				if (date) add(c, date, 1);
			}
			return c;
		},
	},
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
	description: "Year heatmap of Daily News posts, SOC operations or astreintes",
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

// ---- CVEs per day ---------------------------------------------------------

const WORDS: Record<string, number> = {
	one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
	eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
	eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
};
const NUM = `\\b(\\d+|${Object.keys(WORDS).join("|")})`;
const toNum = (s: string): number => WORDS[s.toLowerCase()] ?? Number(s);

export interface TrackerRun {
	date: string;
	title: string;
	added: number;
}

/**
 * Reads the "## Update Tracker" section: each bold "Run of DD/MM/YYYY …" line opens a
 * run. New CVEs come from the run title ("(87 new CVEs)", "twenty new CVEs", "four more
 * CVEs", "one CVE added"); a title that says "added" without a number falls back to a
 * "- N CVEs …" body line, then to the CVE IDs mentioned in the tracker for the first
 * time. Recheck-only runs add 0.
 */
export function parseTracker(md: string): TrackerRun[] {
	const start = md.search(/^## Update Tracker\s*$/m);
	if (start < 0) return [];
	const rest = md.slice(start).split("\n").slice(1);
	const end = rest.findIndex((l) => /^#{1,2} /.test(l));
	const lines = end < 0 ? rest : rest.slice(0, end);

	const runs: Array<{ date: string; title: string; body: string[] }> = [];
	for (const l of lines) {
		const m = /^\*\*(.*?(\d{2})\/(\d{2})\/(\d{4}).*?)\*\*\s*$/.exec(l);
		if (m) runs.push({ date: `${m[4]}-${m[3]}-${m[2]}`, title: m[1], body: [] });
		else runs[runs.length - 1]?.body.push(l);
	}
	const seen = new Set<string>();
	return runs.map(({ date, title, body }) => {
		const t = title.toLowerCase();
		const ids = [...new Set(body.join("\n").match(/CVE-\d{4}-\d{4,}/g) ?? [])];
		const firstSeen = ids.filter((id) => !seen.has(id)).length;
		ids.forEach((id) => seen.add(id));
		const n =
			new RegExp(`${NUM} (?:new|more) (?:cves?|identifiers?)`).exec(t) ??
			new RegExp(`${NUM} cves? added`).exec(t) ??
			new RegExp(`— ${NUM} cves?$`).exec(t);
		let added = n ? toNum(n[1]) : 0;
		if (!n && /\b(added|new)\b/.test(t)) {
			const line = body.map((l) => /^- (\d+) CVEs\b/.exec(l)).find(Boolean);
			added = line ? Number(line[1]) : firstSeen;
		}
		return { date, title, added };
	});
}

export const cveChartType: WidgetType = {
	type: "cvechart",
	name: "CVEs per day",
	description: "New CVEs added per day, from the CVE-Report Update Tracker",
	icon: "shield-alert",
	min: { w: 4, h: 2 },
	defaultSize: { w: 6, h: 3 },
	defaultSettings: { path: "📡Koffei/Articles/CVE-Report/CVE-Report-Index.md", days: 30 },
	settings: [
		{ key: "path", label: "Report note", type: "text", placeholder: "path/to/CVE-Report-Index.md" },
		{ key: "days", label: "Days shown", type: "number", min: 7, max: 90 },
	],
	render(ctx) {
		const app = ctx.plugin.app;
		const path = String(ctx.inst.settings.path ?? "");
		const days = Math.max(7, Math.min(90, Number(ctx.inst.settings.days ?? 30) || 30));
		const file = app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			ctx.body.createDiv("dash-empty").setText(`Note not found: ${path || "(none)"}`);
			return {};
		}
		const chart = ctx.body.createDiv("dash-cve");
		const stats = ctx.body.createDiv("dash-hm-stats");
		let alive = true;
		ctx.onDispose?.(() => (alive = false));
		const onModify = (f: unknown): void => {
			if (f === file) ctx.refresh();
		};
		app.vault.on("modify", onModify);
		ctx.onDispose?.(() => app.vault.off("modify", onModify));

		void app.vault.cachedRead(file).then((md) => {
			if (!alive) return;
			const byDay = new Map<string, TrackerRun[]>();
			for (const r of parseTracker(md)) byDay.set(r.date, [...(byDay.get(r.date) ?? []), r]);
			const today = new Date();
			const series: Array<{ key: string; d: Date; n: number; runs: TrackerRun[] }> = [];
			for (let i = days - 1; i >= 0; i--) {
				const d = new Date(today);
				d.setDate(d.getDate() - i);
				const runs = byDay.get(dateKey(d)) ?? [];
				series.push({ key: dateKey(d), d, n: runs.reduce((a, r) => a + r.added, 0), runs });
			}
			const max = Math.max(1, ...series.map((s) => s.n));
			for (const s of series) {
				const col = chart.createDiv("dash-cve-col");
				const plot = col.createDiv("dash-spark-plot");
				const bar = plot.createDiv("dash-spark-bar");
				bar.style.height = s.n ? `${Math.max(4, Math.round((s.n / max) * 100))}%` : "0";
				if (!s.n) bar.addClass("dash-cve-zero");
				col.setAttr(
					"title",
					`${s.key} · ${s.n} new CVE${s.n === 1 ? "" : "s"}` +
						s.runs.map((r) => `\n• ${r.title} (+${r.added})`).join("")
				);
				const lab = col.createDiv("dash-spark-label");
				// Label Mondays and today only, so 30+ bars stay readable.
				if (s.d.getDay() === 1 || s.key === dateKey(today)) lab.setText(String(s.d.getDate()));
				if (s.key === dateKey(today)) lab.addClass("dash-spark-today");
			}
			const total = series.reduce((a, s) => a + s.n, 0);
			const chip = (text: string, title: string): void => {
				const el = stats.createDiv("dash-hm-chip");
				el.setText(text);
				el.setAttr("title", title);
			};
			chip(`${days}d · ${total} new`, `New CVEs in the last ${days} days`);
			chip(`Runs · ${series.reduce((a, s) => a + s.runs.length, 0)}`, "Tracker runs in the period");
			chip(`Peak · ${max === 1 && !total ? 0 : max}`, "Most new CVEs in one day");
		});
		return {};
	},
};

registerWidgetType(noteHeatmapType);
registerWidgetType(cveChartType);
