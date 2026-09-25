// Rebuild mods/manufacturing/{main,worker}.js from main.real.js / worker.real.js.
// Run after EVERY edit to a .real file:  node tools/rebuild-manufacturing-stubs.js
// Each stub = its existing header, a verbatim baked copy of the .real file inside
// `async function __baked(sandkit) { … }` / `function __baked(sandkit) { … }`, then the
// hot-load loader below (reads the .real file from the mod folder; baked only if that
// can not be read or does not compile). Keeps each file's line endings.
const fs = require("fs");
const path = require("path");
// the mod folder next to this script, so it works from any clone on any PC
const dir = path.join(__dirname, "..", "mods", "manufacturing") + path.sep;

const MAIN_LOADER = `// Hot-load. main.real.js is read from THIS mod's own folder (the game resolves
// it via api.assets.getUrl, so any install path works), and the worker is told
// the same folder through the "hotloadUrl" shared buffer. The baked copy above
// runs only if the file can't be read or doesn't compile - never after the real
// code has started (its registrations would happen twice). The game awaits this
// entry, so the real code is awaited too and its errors reach the game.
await (async function () {
	var src = null, fn = null;
	try {
		var wu = sandkit.api.assets.getUrl("worker.real.js"), wb = sandkit.api.shared.buffers.create("hotloadUrl", { type: "uint16", length: 1024 });
		if (wu.length < wb.length) for (var i = 0; i < wu.length; i++) wb[i] = wu.charCodeAt(i);
	} catch (e) {}
	try {
		var xhr = new XMLHttpRequest();
		xhr.open("GET", sandkit.api.assets.getUrl("main.real.js") + "?ts=" + Date.now(), false);
		xhr.send();
		if (xhr.status === 0 || xhr.status === 200) src = xhr.responseText;
	} catch (e) { src = null; }
	if (src) {
		try { fn = new (Object.getPrototypeOf(async function(){}).constructor)("sandkit", "\\"use strict\\";\\n" + src); }
		catch (e) { console.warn("[brandon.manufacturing] main.real.js failed to compile, using baked:", e && e.message); }
	}
	if (fn) { await fn(sandkit); console.log("[brandon.manufacturing] main.js hot-loaded fresh from disk"); }
	else { await __baked(sandkit); if (!src) console.log("[brandon.manufacturing] main.js using baked code (no disk read)"); }
})();
`;

const WORKER_LOADER = `// Hot-load. Workers have no assets API, so main.js publishes this mod's own
// worker.real.js URL in the "hotloadUrl" shared buffer - no install path is
// hard-coded. The baked copy above runs only if the file can't be read or
// doesn't compile - never after the real code has started (it would arm twice).
(function () {
	var url = "", src = null, fn = null;
	try {
		var b = sandkit.api.shared.buffers.require("hotloadUrl", { type: "uint16", length: 1024 });
		for (var i = 0; i < b.length && b[i]; i++) url += String.fromCharCode(b[i]);
	} catch (e) { url = ""; }
	if (url) {
		try {
			var xhr = new XMLHttpRequest();
			xhr.open("GET", url + "?ts=" + Date.now(), false);
			xhr.send();
			if (xhr.status === 0 || xhr.status === 200) src = xhr.responseText;
		} catch (e) { src = null; }
	}
	if (src) {
		try { fn = new Function("sandkit", "\\"use strict\\";\\n" + src); }
		catch (e) { console.warn("[brandon.manufacturing] worker.real.js failed to compile, using baked:", e && e.message); }
	}
	if (fn) { fn(sandkit); console.log("[brandon.manufacturing] worker.js hot-loaded fresh from disk"); }
	else { __baked(sandkit); if (!src) console.log("[brandon.manufacturing] worker.js using baked code (no disk read)"); }
})();
`;

for (const [stub, real, loader] of [["main.js", "main.real.js", MAIN_LOADER], ["worker.js", "worker.real.js", WORKER_LOADER]]) {
	const raw = fs.readFileSync(dir + stub, "utf8");
	const eol = raw.includes("\r\n") ? "\r\n" : "\n";
	const lines = raw.replace(/\r\n/g, "\n").split("\n");
	const i = lines.findIndex((l) => /^(async )?function __baked\(sandkit\) \{$/.test(l));
	if (i < 0) throw new Error("no __baked in " + stub);
	const realSrc = fs.readFileSync(dir + real, "utf8").replace(/\r\n/g, "\n").replace(/\n$/, "");
	const out = lines.slice(0, i + 1).join("\n") + "\n" + realSrc + "\n}\n" + loader;
	fs.writeFileSync(dir + stub, out.replace(/\n/g, eol));
	console.log("rebuilt", stub, eol === "\r\n" ? "CRLF" : "LF");
}
