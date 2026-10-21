import type { App, TFile } from "obsidian";

export type CaptureTarget = "inbox" | "daily";

export interface WidgetSize {
	w: number;
	h: number;
}

export interface WidgetInstance {
	type: string;
	uid: string;
	x: number;
	y: number;
	w: number;
	h: number;
	settings: Record<string, unknown>;
	title?: string;
	/** When true the widget is collapsed to a one-row header bar. */
	collapsed?: boolean;
}

export interface Settings {
	version: number;
	columns: number;
	rowHeight: number;
	gap: number;
	accent: string;
	editMode: boolean;
	trackActivity: boolean;
	dailyNoteFolder: string;
	dailyNoteFormat: string;
	captureTarget: CaptureTarget;
	captureFolder: string;
	inboxFile: string;
	pomodoroFocus: number;
	pomodoroBreak: number;
	layout: WidgetInstance[];
	/**
	 * Widgets whose type is not available in this build, kept verbatim so that
	 * installing an older/newer plugin version never destroys them. They are not
	 * rendered and take no grid space; a load that knows their type moves them back.
	 */
	orphans: WidgetInstance[];
	activity: Record<string, number>;
}

export const DEFAULT_SETTINGS: Settings = {
	version: 3,
	columns: 12,
	rowHeight: 88,
	gap: 14,
	accent: "",
	editMode: false,
	trackActivity: true,
	dailyNoteFolder: "",
	dailyNoteFormat: "YYYY-MM-DD",
	captureTarget: "inbox",
	captureFolder: "",
	inboxFile: "Inbox.md",
	pomodoroFocus: 25,
	pomodoroBreak: 5,
	layout: [],
	orphans: [],
	activity: {},
};

export interface WidgetCtx {
	plugin: DashboardPlugin;
	inst: WidgetInstance;
	/** The element this widget should render into. */
	body: HTMLElement;
	/** Re-render this single widget in place. */
	refresh: () => void;
	/**
	 * Register a cleanup that runs when the widget is re-rendered or the view
	 * closes — including when `render` throws after taking a subscription.
	 */
	onDispose?: (fn: () => void) => void;
}

export interface WidgetHandle {
	dispose?: () => void;
}

export interface WidgetSetting {
	key: string;
	label: string;
	type: "text" | "number" | "toggle" | "select";
	options?: string[];
	placeholder?: string;
	min?: number;
	max?: number;
}

export interface WidgetType {
	type: string;
	name: string;
	description: string;
	icon: string;
	min?: WidgetSize;
	max?: WidgetSize;
	defaultSize: WidgetSize;
	defaultSettings?: Record<string, unknown>;
	settings?: WidgetSetting[];
	/** Widgets that should not show a title bar (e.g. the clock). */
	noHeader?: boolean;
	/** Optional custom settings editor for widgets whose config isn't a flat list of scalars. */
	openSettings?: (plugin: DashboardPlugin, inst: WidgetInstance) => void;
	render: (ctx: WidgetCtx) => WidgetHandle;
}

export interface DashboardPlugin {
	app: App;
	settings: Settings;
	saveSettings(): Promise<void>;
	formatDate(d: Date, fmt: string): string;
	dailyNotePath(d: Date): string;
	noteExistsFor(d: Date): boolean;
	openFile(f: TFile | null): void;
	openDay(d: Date): Promise<void>;
	openSearch(query: string): Promise<void>;
	captureText(text: string): Promise<void>;
	addWidget(type: string): void;
	refreshWidget(uid: string): void;
	refreshActivityWidgets(): void;
	showQuickCapture(): void;
}
