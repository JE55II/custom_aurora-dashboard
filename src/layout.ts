import type { WidgetInstance, WidgetSize } from "./types";
import { clamp, uid } from "./utils";

export interface Pos {
	x: number;
	y: number;
}

/** A dashboard taller than this is corrupt data, not a layout. */
export const MAX_ROWS = 400;

/** Coerce a persisted value to a finite number. */
function num(v: unknown, def: number): number {
	const n = typeof v === "number" ? v : Number(v);
	return Number.isFinite(n) ? n : def;
}

/**
 * Force one instance inside the grid: 1..columns wide, `x + w <= columns`, and a
 * bounded height/row. Returns true when anything had to change.
 */
export function clampInstance(inst: WidgetInstance, columns: number): boolean {
	const cols = Math.max(1, columns);
	const w = clamp(Math.round(num(inst.w, 4)), 1, cols);
	const h = clamp(Math.round(num(inst.h, 2)), 1, MAX_ROWS);
	const x = clamp(Math.round(num(inst.x, 0)), 0, Math.max(0, cols - w));
	const y = clamp(Math.round(num(inst.y, 0)), 0, Math.max(0, MAX_ROWS - h));
	const changed = inst.w !== w || inst.h !== h || inst.x !== x || inst.y !== y;
	inst.w = w;
	inst.h = h;
	inst.x = x;
	inst.y = y;
	return changed;
}

/**
 * Bring a whole persisted layout inside the grid. Widgets that only now collide
 * are separated afterwards, so the board is never drawn outside its own columns.
 */
export function clampLayout(layout: WidgetInstance[], columns: number): boolean {
	let changed = false;
	for (const inst of layout) if (clampInstance(inst, columns)) changed = true;
	if (changed) resolveOverlaps(layout, columns);
	return changed;
}

/** The height an instance actually occupies: a collapsed widget is one row. */
export function occupies(inst: WidgetInstance): number {
	return inst.collapsed ? 1 : inst.h;
}

export function overlaps(a: WidgetInstance, b: WidgetInstance): boolean {
	const ah = occupies(a);
	const bh = occupies(b);
	return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + bh && a.y + ah > b.y;
}

export function hasOverlap(layout: WidgetInstance[], inst: WidgetInstance): boolean {
	return layout.some((o) => o.uid !== inst.uid && overlaps(inst, o));
}

export function gridRows(layout: WidgetInstance[]): number {
	let m = 1;
	for (const i of layout) m = Math.max(m, i.y + occupies(i));
	return m;
}

export function fitsAt(
	layout: WidgetInstance[],
	inst: WidgetInstance,
	x: number,
	y: number,
	columns: number
): boolean {
	if (x < 0 || y < 0 || x + inst.w > columns) return false;
	const old = { x: inst.x, y: inst.y };
	inst.x = x;
	inst.y = y;
	const ok = !hasOverlap(layout, inst);
	inst.x = old.x;
	inst.y = old.y;
	return ok;
}

export function nearestFree(
	layout: WidgetInstance[],
	inst: WidgetInstance,
	targetX: number,
	targetY: number,
	columns: number
): Pos {
	const maxY = Math.max(gridRows(layout), targetY) + 6;
	let best: Pos | null = null;
	let bestD = Infinity;
	for (let y = 0; y <= maxY; y++) {
		for (let x = 0; x < columns; x++) {
			if (fitsAt(layout, inst, x, y, columns)) {
				const d = (x - targetX) ** 2 + (y - targetY) ** 2;
				if (d < bestD) {
					bestD = d;
					best = { x, y };
				}
			}
		}
	}
	return best ?? { x: clamp(targetX, 0, Math.max(0, columns - inst.w)), y: maxY };
}

export function findFirstFree(
	layout: WidgetInstance[],
	size: WidgetSize,
	columns: number
): Pos {
	// A widget wider than the grid can never fit; clamp the probe so the search
	// still finds a valid column instead of falling through to an unchecked slot.
	const cols = Math.max(1, columns);
	const w = clamp(Math.round(num(size.w, 4)), 1, cols);
	const h = clamp(Math.round(num(size.h, 2)), 1, MAX_ROWS);
	for (let y = 0; y <= gridRows(layout) + 1; y++) {
		for (let x = 0; x <= cols - w; x++) {
			const probe = makeProbe({ w, h }, x, y);
			if (!hasOverlap(layout, probe)) return { x, y };
		}
	}
	return { x: 0, y: gridRows(layout) + 1 };
}

function makeProbe(size: WidgetSize, x: number, y: number): WidgetInstance {
	return {
		type: "",
		uid: uid(),
		x,
		y,
		w: size.w,
		h: size.h,
		settings: {},
	};
}

/** Resolve overlaps by anchoring earlier widgets in the array and moving later ones down. */
export function resolveOverlaps(layout: WidgetInstance[], columns: number): void {
	for (let i = 0; i < layout.length; i++) {
		const inst = layout[i];
		clampInstance(inst, columns);
		let guard = 0;
		while (hasOverlap(layout.slice(0, i), inst) && guard < 50) {
			const pos = nearestFree(layout.slice(0, i), inst, inst.x, inst.y + 1, columns);
			inst.x = pos.x;
			inst.y = pos.y;
			guard++;
		}
	}
}

export interface LayoutItem {
	type: string;
	x: number;
	y: number;
	w: number;
	h: number;
	settings?: Record<string, unknown>;
	title?: string;
}

export function makeLayout(items: LayoutItem[]): WidgetInstance[] {
	return items.map((i) => ({
		type: i.type,
		uid: uid(),
		x: i.x,
		y: i.y,
		w: i.w,
		h: i.h,
		settings: i.settings ?? {},
		title: i.title,
	}));
}

/**
 * The dashboard's starting board. Designed on 12 columns; `columns` scales the
 * widths and offsets proportionally so no card is ever placed outside the grid.
 */
export function defaultLayout(columns = 12): WidgetInstance[] {
	const layout = makeLayout([
		{ type: "clock", x: 0, y: 0, w: 4, h: 2 },
		{ type: "calendar", x: 4, y: 0, w: 5, h: 4 },
		{ type: "activity", x: 9, y: 0, w: 3, h: 4 },
		{ type: "stats", x: 0, y: 2, w: 4, h: 2 },
		{ type: "tasks", x: 0, y: 4, w: 4, h: 3 },
		{ type: "recent", x: 4, y: 4, w: 5, h: 3 },
		{ type: "tags", x: 9, y: 4, w: 3, h: 3 },
		{ type: "capture", x: 0, y: 7, w: 4, h: 2 },
		{ type: "pomodoro", x: 4, y: 7, w: 3, h: 2 },
		{ type: "quote", x: 7, y: 7, w: 5, h: 2 },
		{ type: "deadline", x: 0, y: 9, w: 3, h: 2 },
		{ type: "random", x: 3, y: 9, w: 3, h: 2 },
		{ type: "vaulttasks", x: 6, y: 9, w: 6, h: 4 },
		{ type: "search", x: 0, y: 11, w: 3, h: 2 },
		{ type: "quickactions", x: 3, y: 11, w: 3, h: 2 },
		{ type: "popular", x: 0, y: 13, w: 4, h: 3 },
		{ type: "orphans", x: 4, y: 13, w: 4, h: 3 },
		{ type: "backlinks", x: 8, y: 13, w: 4, h: 3 },
		{ type: "pinned", x: 0, y: 16, w: 4, h: 3 },
		{ type: "progress", x: 4, y: 16, w: 4, h: 2 },
		{ type: "streak", x: 8, y: 16, w: 4, h: 2 },
		{ type: "habits", x: 0, y: 19, w: 6, h: 4 },
		{ type: "embed", x: 6, y: 19, w: 6, h: 4 },
		{ type: "graph", x: 0, y: 23, w: 12, h: 6 },
		{ type: "noteheatmap", x: 0, y: 29, w: 6, h: 3 },
		{ type: "noteheatmap", x: 6, y: 29, w: 6, h: 3, settings: { source: "Astreinte" } },
	]);

	const cols = Math.max(1, Math.round(columns));
	if (cols !== 12) {
		const scale = cols / 12;
		for (const inst of layout) {
			inst.w = clamp(Math.round(inst.w * scale), 1, cols);
			inst.x = clamp(Math.round(inst.x * scale), 0, Math.max(0, cols - inst.w));
		}
		resolveOverlaps(layout, cols);
	}
	return layout;
}
