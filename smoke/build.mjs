import esbuild from "esbuild";
import path from "path";
import { fileURLToPath } from "url";

const dir = path.dirname(fileURLToPath(import.meta.url));

await esbuild.build({
	entryPoints: [path.join(dir, "entry.js")],
	bundle: true,
	platform: "node",
	format: "cjs",
	outfile: path.join(dir, "out.js"),
	logLevel: "warning",
	external: ["jsdom"],
	alias: { obsidian: path.join(dir, "stub-obsidian.js") },
});
console.log("bundled smoke/out.js");
