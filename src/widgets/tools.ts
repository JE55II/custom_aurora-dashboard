import { Notice, setIcon } from "obsidian";
import type { WidgetType } from "../types";
import { registerWidgetType } from "../registry";
import { pad2 } from "../utils";

export const pomodoroType: WidgetType = {
	type: "pomodoro",
	name: "Pomodoro",
	description: "A focus timer with an animated ring",
	icon: "timer",
	defaultSize: { w: 3, h: 2 },
	defaultSettings: { focus: 25, break: 5 },
	settings: [
		{ key: "focus", label: "Focus length (min)", type: "number", min: 1, max: 120 },
		{ key: "break", label: "Break length (min)", type: "number", min: 1, max: 60 },
	],
	render(ctx) {
		const s = ctx.inst.settings;
		const focusMin = Math.max(1, Number(s.focus ?? 25) || 25);
		const breakMin = Math.max(1, Number(s.break ?? 5) || 5);

		let phase: "focus" | "break" = "focus";
		let remaining = focusMin * 60;
		let total = remaining;
		let running = false;
		let interval = 0;

		const ringWrap = ctx.body.createDiv("dash-pomo-ring");
		const NS = "http://www.w3.org/2000/svg";
		const svg = document.createElementNS(NS, "svg");
		svg.setAttribute("viewBox", "0 0 120 120");
		svg.setAttribute("class", "dash-pomo-svg");
		const circle = (cls: string): SVGCircleElement => {
			const c = document.createElementNS(NS, "circle");
			c.setAttribute("cx", "60");
			c.setAttribute("cy", "60");
			c.setAttribute("r", "54");
			c.setAttribute("class", cls);
			return c;
		};
		const track = circle("dash-ring-track");
		const bar = circle("dash-ring-bar");
		svg.append(track, bar);
		ringWrap.appendChild(svg);
		const C = 2 * Math.PI * 54;
		track.setAttribute("stroke-dasharray", String(C));
		bar.setAttribute("stroke-dasharray", String(C));

		const timeEl = ringWrap.createDiv("dash-pomo-time");
		const phaseEl = ctx.body.createDiv("dash-pomo-phase");
		const controls = ctx.body.createDiv("dash-pomo-controls");
		const play = controls.createDiv("dash-btn dash-btn-accent");
		const reset = controls.createDiv("dash-btn");
		setIcon(play, "play");
		setIcon(reset, "rotate-ccw");

		const update = (): void => {
			const m = Math.floor(remaining / 60);
			const sec = remaining % 60;
			timeEl.setText(`${pad2(m)}:${pad2(sec)}`);
			phaseEl.setText(phase === "focus" ? "Focus" : "Break");
			const frac = total > 0 ? remaining / total : 0;
			bar.setAttribute("stroke-dashoffset", String(C * (1 - frac)));
		};

		const tick = (): void => {
			if (!running || remaining <= 0) return;
			remaining--;
			update();
			if (remaining <= 0) {
				if (phase === "focus") {
					phase = "break";
					remaining = breakMin * 60;
					total = remaining;
					new Notice("Focus session complete — take a break");
				} else {
					phase = "focus";
					remaining = focusMin * 60;
					total = remaining;
					new Notice("Break over — back to focus");
				}
				update();
			}
		};

		play.addEventListener("click", () => {
			running = !running;
			setIcon(play, running ? "pause" : "play");
			if (running) {
				if (interval) window.clearInterval(interval);
				interval = window.setInterval(tick, 1000);
			} else {
				window.clearInterval(interval);
			}
		});

		reset.addEventListener("click", () => {
			running = false;
			window.clearInterval(interval);
			setIcon(play, "play");
			remaining = (phase === "focus" ? focusMin : breakMin) * 60;
			total = remaining;
			update();
		});

		update();
		return { dispose: () => window.clearInterval(interval) };
	},
};

export const quoteType: WidgetType = {
	type: "quote",
	name: "Quote",
	description: "A rotating dose of inspiration",
	icon: "quote",
	defaultSize: { w: 5, h: 2 },
	render(ctx) {
		const text = ctx.body.createDiv("dash-quote-text");
		const author = ctx.body.createDiv("dash-quote-author");
		let i = Math.floor(Math.random() * QUOTES.length);

		const show = (): void => {
			text.setText(QUOTES[i].text);
			author.setText("— " + QUOTES[i].author);
		};
		show();
		const id = window.setInterval(() => {
			i = (i + 1) % QUOTES.length;
			show();
		}, 15000);
		return { dispose: () => window.clearInterval(id) };
	},
};

const QUOTES: { text: string; author: string }[] = [
	{ text: "Simplicity is the ultimate sophistication.", author: "Leonardo da Vinci" },
	{ text: "The best way to predict the future is to invent it.", author: "Alan Kay" },
	{ text: "Small deeds done are better than great deeds planned.", author: "Peter Marshall" },
	{ text: "Focus is a matter of deciding what things you're not going to do.", author: "John Carmack" },
	{ text: "A goal without a plan is just a wish.", author: "Antoine de Saint-Exupéry" },
	{ text: "It always seems impossible until it's done.", author: "Nelson Mandela" },
	{ text: "The future depends on what you do today.", author: "Mahatma Gandhi" },
	{ text: "Done is better than perfect.", author: "Sheryl Sandberg" },
	{ text: "Start where you are. Use what you have. Do what you can.", author: "Arthur Ashe" },
	{ text: "Consistency trumps intensity.", author: "James Clear" },
	{ text: "You miss 100% of the shots you don't take.", author: "Wayne Gretzky" },
	{ text: "Make it work, make it right, make it fast.", author: "Kent Beck" },
];

registerWidgetType(pomodoroType);
registerWidgetType(quoteType);
