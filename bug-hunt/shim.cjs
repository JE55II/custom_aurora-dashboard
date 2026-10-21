/*
 * Shared harness helper for the Aurora Dashboard bug hunt.
 *
 * Usage:
 *   require("../../bug-hunt/shim.cjs");       // side effect: jsdom globals + "obsidian" -> smoke stub
 *   const layout = require("./build/layout.js");
 *
 * or:
 *   const { load } = require("../../bug-hunt/shim.cjs");
 *   const layout = load("01-layout", "layout.js");   // -> bug-hunt/scratch-01-layout/build/layout.js
 */
const Module = require("module");
const path = require("path");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..");
const STUB = path.join(ROOT, "smoke", "stub-obsidian.js");

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
	if (request === "obsidian") return STUB;
	return origResolve.call(this, request, ...rest);
};

// Pull in the jsdom Obsidian stub so HTMLElement.prototype.createEl & friends exist.
require(STUB);

function load(area, relPath) {
	const p = path.join(ROOT, "bug-hunt", "scratch-" + area, "build", relPath);
	if (!fs.existsSync(p)) {
		throw new Error("compiled module not found: " + p + " (run the tsc command from bug-hunt/README.md first)");
	}
	return require(p);
}

module.exports = { load, ROOT, STUB };
