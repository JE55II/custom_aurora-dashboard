import type { WidgetType } from "./types";

const registry = new Map<string, WidgetType>();

export function registerWidgetType(t: WidgetType): void {
	registry.set(t.type, t);
}

export function widgetType(type: string): WidgetType | undefined {
	return registry.get(type);
}

export function getWidgetTypes(): WidgetType[] {
	return [...registry.values()];
}
