import { TFile, type MetadataCache } from "obsidian";
import type { WidgetType } from "../types";
import { registerWidgetType } from "../registry";

interface Node {
	path: string;
	name: string;
	group: string;
	x: number;
	y: number;
	vx: number;
	vy: number;
	deg: number;
	r: number;
}

interface View {
	x: number;
	y: number;
	k: number;
}

// Node positions and camera survive re-renders (resize, settings, vault changes),
// so the graph doesn't re-explode every time the widget refreshes.
interface Memory {
	pos: Map<string, { x: number; y: number }>;
	view?: View;
}
const memory = new Map<string, Memory>();

const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const MAX_SPEED = 25;

const PALETTE = ["#7c3aed", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#14b8a6", "#8b5cf6", "#84cc16", "#f97316"];

function hash(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
	return Math.abs(h);
}

export const graphType: WidgetType = {
	type: "graph",
	name: "Graph",
	description: "Interactive link graph of your whole vault",
	icon: "git-fork",
	min: { w: 3, h: 3 },
	defaultSize: { w: 6, h: 5 },
	defaultSettings: { orphans: true, folder: "", colorFolders: true },
	settings: [
		{ key: "folder", label: "Only notes under folder (empty = whole vault)", type: "text", placeholder: "e.g. Clients" },
		{ key: "orphans", label: "Show orphan notes", type: "toggle" },
		{ key: "colorFolders", label: "Color by top-level folder", type: "toggle" },
	],
	render(ctx) {
		const app = ctx.plugin.app;
		const folder = String(ctx.inst.settings.folder ?? "").replace(/^\/+|\/+$/g, "");
		const showOrphans = ctx.inst.settings.orphans !== false;
		const colorFolders = ctx.inst.settings.colorFolders !== false;
		const mem: Memory = memory.get(ctx.inst.uid) ?? { pos: new Map() };
		memory.set(ctx.inst.uid, mem);

		// --- data -------------------------------------------------------------
		const resolved =
			(app.metadataCache as MetadataCache & { resolvedLinks?: Record<string, Record<string, number>> })
				.resolvedLinks ?? {};
		const inScope = (p: string): boolean => p.endsWith(".md") && (!folder || p.startsWith(folder + "/"));
		const index = new Map<string, number>();
		const nodes: Node[] = [];
		const edgeSet = new Set<string>();
		const edges: Array<[number, number]> = [];
		const nodeFor = (path: string): number => {
			let i = index.get(path);
			if (i !== undefined) return i;
			const prev = mem.pos.get(path);
			const name = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
			const slash = path.indexOf("/");
			i = nodes.length;
			nodes.push({
				path,
				name,
				group: slash === -1 ? "" : path.slice(0, slash),
				// New notes start on a phyllotaxis spiral sized to the vault, so a few thousand
				// notes don't all start on top of each other and get flung out of view.
				x: prev?.x ?? 10 * Math.sqrt(0.5 + i) * Math.cos(i * GOLDEN),
				y: prev?.y ?? 10 * Math.sqrt(0.5 + i) * Math.sin(i * GOLDEN),
				vx: 0,
				vy: 0,
				deg: 0,
				r: 0,
			});
			index.set(path, i);
			return i;
		};
		for (const [src, targets] of Object.entries(resolved)) {
			if (!inScope(src)) continue;
			for (const dst of Object.keys(targets)) {
				if (dst === src || !inScope(dst)) continue;
				const a = nodeFor(src);
				const b = nodeFor(dst);
				const key = a < b ? `${a}|${b}` : `${b}|${a}`;
				if (edgeSet.has(key)) continue;
				edgeSet.add(key);
				edges.push([a, b]);
				nodes[a].deg++;
				nodes[b].deg++;
			}
		}
		if (showOrphans) for (const f of app.vault.getMarkdownFiles()) if (inScope(f.path)) nodeFor(f.path);
		for (const n of nodes) n.r = 2.5 + Math.sqrt(n.deg) * 1.6;
		const hubDeg = nodes.map((n) => n.deg).sort((a, b) => b - a)[Math.min(9, nodes.length - 1)] ?? 0;
		const neighbors: number[][] = nodes.map(() => []);
		for (const [a, b] of edges) {
			neighbors[a].push(b);
			neighbors[b].push(a);
		}

		// --- DOM ----------------------------------------------------------------
		const wrap = ctx.body.createDiv("dash-graph");
		const canvas = wrap.createEl("canvas");
		const info = wrap.createDiv("dash-graph-info");
		info.setText(`${nodes.length} notes · ${edges.length} links`);
		const g = canvas.getContext("2d");
		if (!g || !nodes.length) {
			wrap.empty();
			wrap.createDiv("dash-empty").setText(folder ? `No notes under “${folder}”.` : "No notes to graph yet.");
			return {};
		}

		const groups = [...new Set(nodes.map((n) => n.group))].sort();
		const css = getComputedStyle(ctx.body);
		const accent = css.getPropertyValue("--dash-accent").trim() || "#7c3aed";
		const muted = css.getPropertyValue("--text-faint").trim() || "#888";
		const textColor = css.getPropertyValue("--text-normal").trim() || "#ddd";
		// Canvas fonts can't use var(); resolve the interface font once.
		const font = css.getPropertyValue("--font-interface").trim() || "sans-serif";
		const colorOf = (n: Node): string =>
			colorFolders && groups.length > 1 ? PALETTE[hash(n.group) % PALETTE.length] : accent;

		let W = 0;
		let H = 0;
		const dpr = window.devicePixelRatio || 1;
		const view: View = { ...(mem.view ?? { x: 0, y: 0, k: 1 }) };
		let fitted = !!mem.view && [view.x, view.y, view.k].every(isFinite) && view.k > 0;
		const resize = (): void => {
			W = wrap.clientWidth;
			H = wrap.clientHeight;
			canvas.width = Math.max(1, W * dpr);
			canvas.height = Math.max(1, H * dpr);
			canvas.style.width = `${W}px`;
			canvas.style.height = `${H}px`;
			kick();
		};

		// --- simulation ---------------------------------------------------------
		// Repulsion only between nodes in neighbouring grid cells keeps each tick
		// roughly O(n) instead of O(n²), which matters on vaults with thousands of notes.
		let alpha = mem.pos.size ? 0.3 : 1;
		const CELL = 60;
		const tick = (): void => {
			const grid = new Map<string, number[]>();
			for (let i = 0; i < nodes.length; i++) {
				const key = `${Math.floor(nodes[i].x / CELL)},${Math.floor(nodes[i].y / CELL)}`;
				const cell = grid.get(key);
				if (cell) cell.push(i);
				else grid.set(key, [i]);
			}
			for (let i = 0; i < nodes.length; i++) {
				const a = nodes[i];
				const cx = Math.floor(a.x / CELL);
				const cy = Math.floor(a.y / CELL);
				for (let dx = -1; dx <= 1; dx++)
					for (let dy = -1; dy <= 1; dy++) {
						const cell = grid.get(`${cx + dx},${cy + dy}`);
						if (!cell) continue;
						for (const j of cell) {
							if (j <= i) continue;
							const b = nodes[j];
							let ddx = a.x - b.x;
							let ddy = a.y - b.y;
							let d2 = ddx * ddx + ddy * ddy;
							if (d2 < 0.01) {
								ddx = Math.random() - 0.5;
								ddy = Math.random() - 0.5;
								d2 = 0.5;
							}
							if (d2 > CELL * CELL) continue;
							const f = (900 * alpha) / d2;
							a.vx += ddx * f * 0.05;
							a.vy += ddy * f * 0.05;
							b.vx -= ddx * f * 0.05;
							b.vy -= ddy * f * 0.05;
						}
					}
			}
			for (const [i, j] of edges) {
				const a = nodes[i];
				const b = nodes[j];
				const dx = b.x - a.x;
				const dy = b.y - a.y;
				const d = Math.sqrt(dx * dx + dy * dy) || 1;
				const f = ((d - 40) / d) * 0.04 * alpha;
				a.vx += dx * f;
				a.vy += dy * f;
				b.vx -= dx * f;
				b.vy -= dy * f;
			}
			for (const n of nodes) {
				if (n === dragged) continue;
				n.vx -= n.x * 0.004 * alpha; // gentle pull to the centre keeps islands on screen
				n.vy -= n.y * 0.004 * alpha;
				n.vx *= 0.6;
				n.vy *= 0.6;
				const speed = Math.hypot(n.vx, n.vy);
				if (speed > MAX_SPEED) {
					n.vx *= MAX_SPEED / speed;
					n.vy *= MAX_SPEED / speed;
				}
				n.x += n.vx;
				n.y += n.vy;
			}
			alpha = Math.max(0, alpha * 0.985 - 0.0005);
		};

		const fit = (): boolean => {
			// Not laid out yet: fitting to a 0×0 box would park the camera off-screen.
			if (W <= 0 || H <= 0) return false;
			// Fit the central 96% so a few stray notes can't shrink everything else to dust.
			const xs = nodes.map((n) => n.x).sort((a, b) => a - b);
			const ys = nodes.map((n) => n.y).sort((a, b) => a - b);
			const lo = Math.floor(nodes.length * 0.02);
			const hi = nodes.length - 1 - lo;
			const minX = xs[lo];
			const maxX = xs[hi];
			const minY = ys[lo];
			const maxY = ys[hi];
			const k = Math.min(W / (maxX - minX + 40), H / (maxY - minY + 40), 3);
			view.k = isFinite(k) && k > 0 ? k : 1;
			view.x = W / 2 - ((minX + maxX) / 2) * view.k;
			view.y = H / 2 - ((minY + maxY) / 2) * view.k;
			return true;
		};

		// --- drawing ------------------------------------------------------------
		let hover = -1;
		let dragged: Node | null = null;
		const draw = (): void => {
			g.setTransform(dpr, 0, 0, dpr, 0, 0);
			g.clearRect(0, 0, W, H);
			g.translate(view.x, view.y);
			g.scale(view.k, view.k);
			const lit = hover >= 0 ? new Set([hover, ...neighbors[hover]]) : null;

			g.lineWidth = 0.6 / view.k;
			g.strokeStyle = muted;
			g.globalAlpha = lit ? 0.12 : 0.35;
			g.beginPath();
			for (const [i, j] of edges) {
				g.moveTo(nodes[i].x, nodes[i].y);
				g.lineTo(nodes[j].x, nodes[j].y);
			}
			g.stroke();
			if (lit) {
				g.globalAlpha = 0.9;
				g.strokeStyle = accent;
				g.lineWidth = 1.2 / view.k;
				g.beginPath();
				for (const j of neighbors[hover]) {
					g.moveTo(nodes[hover].x, nodes[hover].y);
					g.lineTo(nodes[j].x, nodes[j].y);
				}
				g.stroke();
			}

			for (let i = 0; i < nodes.length; i++) {
				const n = nodes[i];
				g.globalAlpha = lit && !lit.has(i) ? 0.15 : 1;
				g.fillStyle = colorOf(n);
				g.beginPath();
				g.arc(n.x, n.y, n.r, 0, Math.PI * 2);
				g.fill();
			}

			// Labels: hovered neighbourhood always, otherwise only hubs, more as you zoom in.
			g.globalAlpha = 1;
			g.fillStyle = textColor;
			g.font = `${11 / view.k}px ${font}`;
			g.textAlign = "center";
			// Zoomed out: only the top hubs; zooming in reveals progressively more names.
			const minDeg = view.k > 2.2 ? 0 : view.k > 1.2 ? Math.max(3, hubDeg / 2) : Math.max(3, hubDeg);
			for (let i = 0; i < nodes.length; i++) {
				const n = nodes[i];
				if (lit ? !lit.has(i) : n.deg < minDeg) continue;
				g.fillText(n.name, n.x, n.y - n.r - 3 / view.k);
			}
		};

		let raf = 0;
		let failed = false;
		const loop = (): void => {
			raf = 0;
			if (failed) return;
			try {
				if (alpha > 0) tick();
				// Fit whenever the widget first has a real size, not only while settling:
				// a dashboard opened in a background tab measures 0×0 until it is shown.
				if (!fitted) fitted = fit();
				if (![view.x, view.y, view.k].every(isFinite) || view.k <= 0) fitted = fit();
				draw();
			} catch (e) {
				failed = true;
				console.error("Aurora graph widget:", e);
				wrap.empty();
				wrap.createDiv("dash-widget-error").setText(`Graph failed to draw: ${String(e)}`);
				return;
			}
			if (alpha > 0 || dragged) raf = requestAnimationFrame(loop);
		};
		function kick(a = 0): void {
			alpha = Math.max(alpha, a);
			if (!raf) raf = requestAnimationFrame(loop);
		}

		// --- interaction --------------------------------------------------------
		const toWorld = (cx: number, cy: number): [number, number] => [(cx - view.x) / view.k, (cy - view.y) / view.k];
		const pick = (cx: number, cy: number): number => {
			const [wx, wy] = toWorld(cx, cy);
			let best = -1;
			let bestD = Infinity;
			for (let i = 0; i < nodes.length; i++) {
				const d = (nodes[i].x - wx) ** 2 + (nodes[i].y - wy) ** 2;
				const hit = nodes[i].r + 4 / view.k;
				if (d < hit * hit && d < bestD) {
					best = i;
					bestD = d;
				}
			}
			return best;
		};
		const local = (e: PointerEvent | WheelEvent): [number, number] => {
			const r = canvas.getBoundingClientRect();
			return [e.clientX - r.left, e.clientY - r.top];
		};

		const pointers = new Map<number, [number, number]>();
		let panFrom: [number, number] | null = null;
		let pinchDist = 0;
		let moved = false;
		canvas.addEventListener("pointerdown", (e) => {
			canvas.setPointerCapture(e.pointerId);
			const p = local(e);
			pointers.set(e.pointerId, p);
			moved = false;
			if (pointers.size === 2) {
				const [a, b] = [...pointers.values()];
				pinchDist = Math.hypot(a[0] - b[0], a[1] - b[1]);
				dragged = null;
				panFrom = null;
				return;
			}
			const i = pick(...p);
			if (i >= 0) {
				dragged = nodes[i];
				kick(0.3);
			} else panFrom = p;
		});
		canvas.addEventListener("pointermove", (e) => {
			const p = local(e);
			if (pointers.has(e.pointerId)) {
				const prev = pointers.get(e.pointerId)!;
				if (Math.abs(p[0] - prev[0]) + Math.abs(p[1] - prev[1]) > 2) moved = true;
				pointers.set(e.pointerId, p);
			}
			if (pointers.size === 2) {
				const [a, b] = [...pointers.values()];
				const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
				if (pinchDist) zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, d / pinchDist);
				pinchDist = d;
				return;
			}
			if (dragged) {
				[dragged.x, dragged.y] = toWorld(...p);
				dragged.vx = dragged.vy = 0;
				kick(0.3);
			} else if (panFrom) {
				view.x += p[0] - panFrom[0];
				view.y += p[1] - panFrom[1];
				panFrom = p;
				kick();
			} else {
				const h = pick(...p);
				if (h !== hover) {
					hover = h;
					canvas.style.cursor = h >= 0 ? "pointer" : "grab";
					canvas.title = h >= 0 ? nodes[h].path : "";
					kick();
				}
			}
		});
		const release = (e: PointerEvent): void => {
			pointers.delete(e.pointerId);
			if (pointers.size < 2) pinchDist = 0;
			if (!moved && pointers.size === 0) {
				const i = pick(...local(e));
				const f = i >= 0 ? app.vault.getAbstractFileByPath(nodes[i].path) : null;
				if (f instanceof TFile) ctx.plugin.openFile(f);
			}
			dragged = null;
			panFrom = null;
		};
		canvas.addEventListener("pointerup", release);
		canvas.addEventListener("pointercancel", release);
		canvas.addEventListener("pointerleave", () => {
			if (hover >= 0 && !pointers.size) {
				hover = -1;
				kick();
			}
		});
		const zoomAt = (cx: number, cy: number, factor: number): void => {
			const k = Math.min(8, Math.max(0.05, view.k * factor));
			view.x = cx - ((cx - view.x) * k) / view.k;
			view.y = cy - ((cy - view.y) * k) / view.k;
			view.k = k;
			kick();
		};
		canvas.addEventListener(
			"wheel",
			(e) => {
				e.preventDefault();
				zoomAt(...local(e), Math.exp(-e.deltaY * 0.0015));
			},
			{ passive: false }
		);
		canvas.addEventListener("dblclick", () => {
			fit();
			kick();
		});

		if (!mem.pos.size) {
			const t0 = performance.now();
			while (alpha > 0.05 && performance.now() - t0 < 400) tick();
		}

		const ro = new ResizeObserver(resize);
		ro.observe(wrap);
		resize();

		// Link changes re-render the widget; positions are remembered so it settles in place.
		// Only re-render when the link structure actually changed, not on every keystroke.
		const signature = (): string => {
			const r =
				(app.metadataCache as MetadataCache & { resolvedLinks?: Record<string, Record<string, number>> })
					.resolvedLinks ?? {};
			let links = 0;
			for (const t of Object.values(r)) links += Object.keys(t).length;
			return `${Object.keys(r).length}:${links}`;
		};
		const sig = signature();
		let timer = 0;
		const onResolved = (): void => {
			window.clearTimeout(timer);
			timer = window.setTimeout(() => {
				if (signature() !== sig) ctx.refresh();
			}, 1500);
		};
		app.metadataCache?.on?.("resolved", onResolved);
		ctx.onDispose?.(() => {
			app.metadataCache?.off?.("resolved", onResolved);
			window.clearTimeout(timer);
			ro.disconnect();
			if (raf) cancelAnimationFrame(raf);
			mem.pos = new Map(nodes.map((n) => [n.path, { x: n.x, y: n.y }]));
			mem.view = fitted ? { ...view } : undefined;
		});
		return {};
	},
};

registerWidgetType(graphType);
