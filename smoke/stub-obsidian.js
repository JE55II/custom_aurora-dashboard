/*
 * Minimal Obsidian API stub for the smoke test.
 * Provides just enough of the plugin API to render the dashboard in jsdom.
 */
const { JSDOM } = require("jsdom");

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
	pretendToBeVisual: true,
});
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.HTMLElement = window.HTMLElement;
globalThis.SVGElement = window.SVGElement;
globalThis.Node = window.Node;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.requestAnimationFrame = window.requestAnimationFrame;

// ---- DOM helpers that Obsidian injects onto HTMLElement ----
const proto = window.HTMLElement.prototype;

proto.createEl = function (tag, opts, cb) {
	if (typeof opts === "function") {
		cb = opts;
		opts = undefined;
	}
	if (typeof cb !== "function") cb = null;
	if (typeof opts === "string") opts = { cls: opts };
	opts = opts || {};
	const el = document.createElement(tag);
	if (opts.cls) {
		el.className = typeof opts.cls === "string" ? opts.cls : opts.cls.join(" ");
	}
	if (opts.attr) for (const k in opts.attr) el.setAttribute(k, opts.attr[k]);
	if (opts.text !== undefined && opts.text !== null) el.textContent = opts.text;
	if (opts.placeholder) el.setAttribute("placeholder", opts.placeholder);
	if (opts.value) el.setAttribute("value", opts.value);
	this.appendChild(el);
	if (cb) cb(el);
	return el;
};
proto.createDiv = function (a, b) {
	return this.createEl("div", a, b);
};
proto.createSpan = function (a, b) {
	return this.createEl("span", a, b);
};
proto.createButton = function (a, b) {
	return this.createEl("button", a, b);
};
proto.empty = function () {
	while (this.firstChild) this.removeChild(this.firstChild);
	return this;
};
proto.setText = function (t) {
	this.textContent = t;
	return this;
};
proto.appendText = function (t) {
	this.appendChild(document.createTextNode(t));
	return this;
};
proto.addClass = function (c) {
	this.classList.add(c);
	return this;
};
proto.removeClass = function (c) {
	this.classList.remove(c);
	return this;
};
proto.toggleClass = function (c, on) {
	this.classList.toggle(c, on);
	return this;
};
proto.setAttr = function (k, v) {
	this.setAttribute(k, v);
	return this;
};

// ---- types ----
class TAbstractFile {}
class TFolder extends TAbstractFile {
	constructor(path) {
		super();
		this.path = path;
		this.name = path.split("/").pop() || path;
		this.children = [];
	}
}
class TFile extends TAbstractFile {
	constructor(path, content, ctime, mtime) {
		super();
		this.path = path;
		this.extension = path.endsWith(".md") ? "md" : path.split(".").pop() || "";
		this.name = path.split("/").pop() || path;
		this.basename = this.name.replace(/\.[^.]+$/, "");
		this.parent = null;
		this.stat = { ctime, mtime, size: content ? content.length : 0 };
		this._content = content ?? "";
	}
}

class Notice {
	static last = null;
	constructor(message) {
		this.message = message;
		Notice.last = message;
	}
}

function normalizePath(p) {
	return String(p).replace(/\\/g, "/").split("/").filter(Boolean).join("/");
}

function setIcon(el, name) {
	el.innerHTML = `<svg data-icon="${name}" viewBox="0 0 24 24"><path/></svg>`;
	return el;
}

// ---- lifecycle / markdown rendering ----

class Component {
	load() {}
	unload() {}
	onload() {}
	onunload() {}
	addChild(c) {
		return c;
	}
	removeChild(c) {
		return c;
	}
	registerEvent() {}
	registerDomEvent() {}
	registerInterval() {}
}

/*
 * Text-only stand-in for Obsidian's renderer: it appends the markdown as text so
 * widgets that embed content can be asserted on without a real markdown pipeline.
 */
const MarkdownRenderer = {
	async render(app, markdown, el, sourcePath, component) {
		const div = document.createElement("div");
		div.className = "markdown-rendered";
		div.textContent = markdown;
		el.appendChild(div);
	},
};

// ---- workspace / vault / metadata cache ----
class WorkspaceLeaf {
	constructor(app, type) {
		this.app = app;
		this.view = null;
		this.viewType = type || "";
	}
	async setViewState(state) {
		const factory = this.app.workspace._viewFactories[state.type];
		if (factory) {
			this.view = factory(this);
			this.viewType = state.type;
			if (this.view.onOpen) await this.view.onOpen();
		}
		this._state = state;
	}
	async openFile(file) {
		this._opened = file;
	}
}

class Workspace {
	constructor() {
		this.leaves = [];
		this._viewFactories = {};
		this._refs = [];
		this._offrefs = [];
	}
	getLeaf(type) {
		const leaf = new WorkspaceLeaf(this._app, type);
		this.leaves.push(leaf);
		return leaf;
	}
	getLeavesOfType(type) {
		return this.leaves.filter((l) => l.view && l.view.getViewType && l.view.getViewType() === type);
	}
	revealLeaf() {}
	detachLeavesOfType() {}
	getActiveViewOfType() {
		return null;
	}
	getActiveFile() {
		return null;
	}
	on(name, cb) {
		const ref = { name, cb };
		this._refs.push(ref);
		return ref;
	}
	off(name, cb) {
		this._offrefs.push({ name, cb });
	}
	offref(ref) {
		this._offrefs.push(ref);
	}
}

class Vault {
	constructor() {
		this.files = [];
		this.folders = [];
		this._listeners = { create: [], modify: [], delete: [] };
	}
	on(name, cb) {
		(this._listeners[name] = this._listeners[name] || []).push(cb);
		return {};
	}
	_fire(name, file) {
		for (const cb of this._listeners[name] || []) cb(file);
	}
	getMarkdownFiles() {
		return this.files.filter((f) => f.extension === "md");
	}
	getFiles() {
		return this.files.slice();
	}
	getAbstractFileByPath(p) {
		return this.files.find((f) => f.path === p) || this.folders.find((f) => f.path === p) || null;
	}
	getFolderByPath(p) {
		return this.folders.find((f) => f.path === p) || null;
	}
	async create(path, content) {
		const f = new TFile(path, content, Date.now(), Date.now());
		this.files.push(f);
		this._fire("create", f);
		return f;
	}
	async createFolder(path) {
		const p = normalizePath(path);
		if (!p) throw new Error("no folder path given");
		if (this.folders.some((f) => f.path === p)) throw new Error("folder already exists: " + p);
		const folder = new TFolder(p);
		this.folders.push(folder);
		return folder;
	}
	async read(f) {
		return f._content ?? "";
	}
	async modify(f, content) {
		f._content = content;
		f.stat.mtime = Date.now();
		this._fire("modify", f);
	}
}

class MetadataCache {
	getFileCache() {
		return { tags: [], frontmatter: null };
	}
}

class App {
	constructor() {
		this.workspace = new Workspace();
		this.vault = new Vault();
		this.metadataCache = new MetadataCache();
		this.workspace._app = this;
	}
}

// ---- plugin base classes ----
class Plugin {
	constructor(app, manifest) {
		this.app = app;
		this.manifest = manifest || {};
		this._data = null;
		this._commands = [];
		this._views = {};
	}
	addRibbonIcon(icon, title, cb) {
		const el = document.createElement("div");
		el.addEventListener("click", cb);
		return el;
	}
	addCommand(cmd) {
		this._commands.push(cmd);
		return cmd;
	}
	addSettingTab(tab) {
		this._settingTab = tab;
		return tab;
	}
	registerEvent(ref) {}
	registerView(type, factory) {
		this.app.workspace._viewFactories[type] = factory;
		this._views[type] = factory;
	}
	async loadData() {
		return this._data;
	}
	async saveData(data) {
		// Deferred, like the real write: a fire-and-forget save has not landed when
		// the caller returns, which is what the smoke suite asserts about.
		await new Promise((resolve) => setTimeout(resolve, 0));
		this._data = data;
	}
}

class ItemView {
	constructor(leaf) {
		this.leaf = leaf;
		this.app = leaf.app;
		this.contentEl = document.createElement("div");
		this.containerEl = document.createElement("div");
	}
	getViewType() {
		return "item-view";
	}
}

class Modal {
	constructor(app) {
		this.app = app;
		this.containerEl = document.createElement("div");
		this.modalEl = document.createElement("div");
		this.titleEl = document.createElement("div");
		this.contentEl = document.createElement("div");
		this.modalEl.appendChild(this.titleEl);
		this.modalEl.appendChild(this.contentEl);
		this.containerEl.appendChild(this.modalEl);
	}
	open() {
		Modal.last = this; // lets a test close the modal the way a user would (✕ / Escape)
		document.body.appendChild(this.containerEl);
		this.onOpen();
	}
	close() {
		this.onClose();
	}
	onOpen() {}
	onClose() {}
}

class PluginSettingTab {
	constructor(app, plugin) {
		this.app = app;
		this.plugin = plugin;
		this.containerEl = document.createElement("div");
	}
	display() {}
	getControlValue(key) {
		return this.plugin.settings[key];
	}
	setControlValue(key, value) {
		this.plugin.settings[key] = value;
		return this.plugin.saveSettings();
	}
}

class Setting {
	constructor(containerEl) {
		this.containerEl = containerEl;
		this.controlEl = document.createElement("div");
		if (containerEl && containerEl.appendChild) containerEl.appendChild(this.controlEl);
	}
	setName(n) {
		this.nameEl = document.createElement("div");
		this.nameEl.textContent = n;
		return this;
	}
	setDesc() {
		return this;
	}
	setHeading() {
		return this;
	}
	_comp(fn) {
		const comp = {
			_value: undefined,
			_onChange: () => {},
			setValue(v) {
				this._value = v;
				return this;
			},
			setPlaceholder() {
				return this;
			},
			setDynamicTooltip() {
				return this;
			},
			setLimits() {
				return this;
			},
			onChange(fn) {
				this._onChange = fn;
				return this;
			},
			onClick(fn) {
				this._onClick = fn;
				return this;
			},
			setTooltip() {
				return this;
			},
			setIcon() {
				return this;
			},
			addOption(k, v) {
				this._options = this._options || [];
				this._options.push([k, v]);
				return this;
			},
			setButtonText() {
				return this;
			},
			setWarning() {
				return this;
			},
			setDisabled() {
				return this;
			},
		};
		comp.inputEl = document.createElement("input");
		comp.buttonEl = document.createElement("button");
		fn(comp);
		return this;
	}
	addToggle(fn) {
		return this._comp(fn);
	}
	addText(fn) {
		return this._comp(fn);
	}
	addDropdown(fn) {
		return this._comp(fn);
	}
	addSlider(fn) {
		return this._comp(fn);
	}
	addButton(fn) {
		return this._comp(fn);
	}
	addExtraButton(fn) {
		return this._comp(fn);
	}
	addColorPicker(fn) {
		return this._comp(fn);
	}
}

module.exports = {
	App,
	Component,
	ItemView,
	MarkdownRenderer,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	WorkspaceLeaf,
	TFile,
	TFolder,
	TAbstractFile,
	normalizePath,
	setIcon,
};
