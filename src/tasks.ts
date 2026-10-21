/**
 * Task-line parsing shared by the Today and All-tasks widgets.
 *
 * Markdown only renders a checkbox in body prose, so a `- [ ]` inside a fenced
 * code block or an indented code sample is a code sample, not a task: counting or
 * toggling it would corrupt the user's documentation. Any list marker that
 * Obsidian renders as a checkbox counts (`-`, `*`, `+`, `1.`, `1)`).
 */

export interface ParsedTask {
	/** 0-based line index in the source text, used to target the write-back. */
	line: number;
	text: string;
	done: boolean;
}

const TASK_RE = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s+(.+)$/;
const TASK_BOX = /\[([ xX])\]/;
const FENCE_RE = /^[ \t]{0,3}(`{3,}|~{3,})/;
const DELIM_RE = /^(---|\.\.\.)[ \t]*$/;

/** Index of the line that closes a leading frontmatter block, or -1 when there is none. */
function frontmatterEnd(lines: string[]): number {
	if (!DELIM_RE.test(lines[0] ?? "")) return -1;
	for (let i = 1; i < lines.length; i++) if (DELIM_RE.test(lines[i])) return i;
	return -1;
}

/** Every task line outside fenced code blocks and frontmatter. */
export function parseTasks(content: string): ParsedTask[] {
	const out: ParsedTask[] = [];
	const lines = content.split("\n");
	const fmEnd = frontmatterEnd(lines);
	let fence: string | null = null;

	for (let i = 0; i < lines.length; i++) {
		if (i <= fmEnd) continue;
		const line = lines[i];
		const f = FENCE_RE.exec(line);
		if (f) {
			const marker = f[1].charAt(0);
			if (fence === null) fence = marker;
			else if (fence === marker) fence = null;
			continue;
		}
		if (fence !== null) continue;
		const m = TASK_RE.exec(line);
		if (!m) continue;
		out.push({ line: i, text: m[2].trim(), done: m[1] !== " " });
	}
	return out;
}

/** True when `line` is a task whose text matches `text`. */
export function lineMatchesTask(line: string | undefined, text: string): boolean {
	if (typeof line !== "string") return false;
	const m = TASK_RE.exec(line);
	return !!m && m[2].trim() === text;
}

/** Index of the first task line whose text matches, or -1. */
export function findTaskLine(lines: string[], text: string): number {
	return lines.findIndex((ln) => lineMatchesTask(ln, text));
}

/**
 * The task line matching `text` closest to a cached index, or -1.
 *
 * Used when the file changed under the widget: plain "first match" would flip a
 * different task that happens to share the wording. Ties go to the line at or
 * after the hint, because text inserted above a task pushes it down, not up.
 */
export function nearestTaskLine(lines: string[], text: string, hint: number): number {
	let best = -1;
	let bestD = Infinity;
	for (let i = 0; i < lines.length; i++) {
		if (!lineMatchesTask(lines[i], text)) continue;
		const d = Math.abs(i - hint) * 2 + (i >= hint ? 0 : 1);
		if (d < bestD) {
			bestD = d;
			best = i;
		}
	}
	return best;
}

/** Flip the checkbox state of a single task line. */
export function toggleTaskLine(line: string): string {
	return line.replace(TASK_BOX, (_m, g1: string) => (g1 === " " ? "[x]" : "[ ]"));
}
