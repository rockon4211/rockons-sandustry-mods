// sim-trcfilter.js — Screensaver 0.19.0 worker.js: filters see a tracer copy as its real material.
// Run from anywhere:  node .handoff/sim-trcfilter.js   (exit 1 on any failed check)
//
// A stand-in for the game's simulation worker: webpack's chunk list (`self.webpackChunksand_v1`,
// whose push hands a chunk's callback the module loader), and a block-grid module that exports
// getFilterConfig / getFilterConfigId / getOrCreateFilterPaletteEntry with the SAME mask logic as
// bundle v0.5.6: 20 uint32 words per palette entry, [0] mode (0 allow / 1 block), [2] flags,
// [3..10] the 256-bit material mask, [11..18] the speed-exempt mask, one shared object `ce`
// returned for every id. The game's filter test is then run on it: copper allowed, a copper copy
// must pass exactly as copper does; everything else must get the game's own answer.
const fs = require("fs"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "mods", "screensaver", "worker.js"), "utf8");
let ok = true; const check = (c, msg) => { console.log((c ? "  ok   " : "  FAIL ") + msg); if (!c) ok = false; };

const COPPER = 36, WATER = 3, GOLD = 7, COPPER_COPY = 95, WATER_COPY = 96, GENERIC_TRACER = 90;

// --- the game's block-grid module, as the bundle writes it --------------------------------
function blockGridModule(module, exports) {
	const y = new Uint32Array(20 * 255); let S = 0;
	const ce = { mode: 0, density: 0, affectsLiquid: false, affectsGas: false, hasExplicitElementMask: false,
		isSpeedExempt: (e) => de(0, e, true), isInElementMask: (e) => de(0, e, false),
		hasElementMask() { return this.hasExplicitElementMask || (() => { for (let e = 0; e < 8; e++) if (y[ue + 3 + e] !== 0) return true; return false; })(); } };
	let ue = -1;
	function de(_, t, i) { return !!(y[ue + ((i ? 11 : 3) + (t >> 5))] & (1 << (31 & t))); }
	function me(e) { const t = 20 * (e - 1); ue = t; ce.mode = y[t]; const i = y[t + 2]; ce.affectsLiquid = !!(1 & i); ce.affectsGas = !!(2 & i); ce.hasExplicitElementMask = !!(4 & i); return ce; }
	function pe(e, t, n) { for (let k = 0; k < 8; k++) t[n + k] = 0; if (!e) return; for (const v of Array.isArray(e) ? e : [e]) t[n + (v >> 5)] |= 1 << (31 & v); }
	function xe(f) { const o = 20 * S; y[o] = f.mode === "allow" ? 0 : 1; y[o + 2] = 4; pe(f.elementType, y, o + 3); pe(f.speedExemptElementTypes, y, o + 11); return ++S; }
	Object.assign(exports, { getFilterConfig: me, getFilterConfigId: () => 0, getOrCreateFilterPaletteEntry: xe });
}
// an unrelated module the search must skip
function otherModule(module, exports) { exports.thing = 1; }

// webpack's runtime: module factories in `m`, a cache the loader fills, and the chunk list
function bootWorker(withChunkList) {
	const m = { 11111: otherModule, 38394: blockGridModule }, cache = {};
	const req = (id) => { if (cache[id]) return cache[id].exports; const mod = cache[id] = { exports: {} }; m[id].call(mod.exports, mod, mod.exports, req); return mod.exports; };
	req.m = m;
	req(38394);   // the sim has loaded it long before any mod entry runs
	const list = []; const push = list.push.bind(list);
	list.push = (chunk) => { const [ids, mods, cb] = chunk; for (const k in mods) m[k] = mods[k]; if (cb) cb(req); return push(chunk); };
	const self = withChunkList ? { webpackChunksand_v1: list } : {};
	return { self, grid: req(38394) };
}
function runEntry(self, realTable) {
	const logs = [];
	const sandkit = { api: { shared: { buffers: { require: (key) => { if (key !== "trcreal") throw new Error("no buffer " + key); return realTable; } } } } };
	global.__brandonHarness = true;
	const con = { log: (m) => logs.push(m), error: (m) => logs.push("ERR " + m) };
	new Function("sandkit", "self", "console", "setTimeout", '"use strict";\n' + src)(sandkit, self, con, () => 0);
	return logs;
}
// the game's own filter decision (bundle v0.5.6, @415048): pass if the mask says so for an "allow"
// filter, the other way round for "block"
function passes(grid, id, type) { const A = grid.getFilterConfig(id); let k = true; if (!A.isInElementMask(type) && A.hasElementMask()) k = false; return A.mode === 0 ? k : !k; }

const real = new Uint8Array(256); real[COPPER_COPY] = COPPER; real[WATER_COPY] = WATER;   // what main.js publishes

// --- 1. before the override: the copy sorts as its own material (the reported bug) --------
{
	const { grid } = bootWorker(true);
	const allowCu = grid.getOrCreateFilterPaletteEntry({ mode: "allow", elementType: [COPPER] });
	check(passes(grid, allowCu, COPPER) === true && passes(grid, allowCu, COPPER_COPY) === false, "without the override an 'allow copper' filter passes copper but NOT the copper copy (the bug)");
}
// --- 2. with the override -----------------------------------------------------------------
{
	const { self, grid } = bootWorker(true);
	const allowCu = grid.getOrCreateFilterPaletteEntry({ mode: "allow", elementType: [COPPER] });
	const blockCu = grid.getOrCreateFilterPaletteEntry({ mode: "block", elementType: [COPPER, GOLD] });
	const allowW = grid.getOrCreateFilterPaletteEntry({ mode: "allow", elementType: [WATER], speedExemptElementTypes: [WATER] });
	const shaker = grid.getOrCreateFilterPaletteEntry({ mode: "allow", elementType: [GOLD] });   // the shaker's own filter
	const logs = runEntry(self, real);
	check(logs.some((l) => /filter override on/.test(l)) && !logs.some((l) => /^ERR/.test(l)), "worker.js finds the module by its exports and switches the override on: " + logs.join(" | "));
	check(passes(grid, allowCu, COPPER_COPY) === passes(grid, allowCu, COPPER) && passes(grid, allowCu, COPPER_COPY) === true, "'allow copper': the copper copy now passes like copper");
	check(passes(grid, blockCu, COPPER_COPY) === false && passes(grid, blockCu, COPPER) === false, "'block copper + gold': the copy is blocked like copper");
	check(passes(grid, allowCu, WATER_COPY) === passes(grid, allowCu, WATER) && passes(grid, allowW, WATER_COPY) === true, "a water copy sorts as water on both filters");
	check(passes(grid, shaker, COPPER_COPY) === passes(grid, shaker, COPPER) && passes(grid, shaker, COPPER_COPY) === false, "the shaker's own filter (allow gold) treats the copper copy exactly as copper");
	check(grid.getFilterConfig(allowW).isSpeedExempt(WATER_COPY) === true && grid.getFilterConfig(allowW).isSpeedExempt(COPPER_COPY) === false, "the speed-exempt list reads a copy as its real material too");
	// real materials and non-copies get the game's own answer, unchanged
	for (const t of [COPPER, WATER, GOLD, 1, 200]) check(passes(grid, allowCu, t) === (t === COPPER) && passes(grid, blockCu, t) === !(t === COPPER || t === GOLD), "type " + t + ": the game's own answer on both filters");
	check(passes(grid, allowCu, GENERIC_TRACER) === false, "a generic tracer (no real material in the table) keeps its own answer");
	// the table is read live: a copy published later is honoured at once
	real[GENERIC_TRACER] = COPPER;
	check(passes(grid, allowCu, GENERIC_TRACER) === true, "the table is live (a later entry works without reloading)");
	real[GENERIC_TRACER] = 0;
	// loading the entry twice doesn't stack the wrapper
	runEntry(self, real);
	check(passes(grid, allowCu, COPPER_COPY) === true && passes(grid, allowCu, WATER) === false, "a second load leaves one working wrapper");
}
// --- 3. a worker without the chunk list (manager / utility): quietly does nothing -----------
{
	const { self } = bootWorker(false);
	const logs = runEntry(self, real);
	check(!logs.some((l) => /^ERR/.test(l)) && !logs.some((l) => /override on/.test(l)), "a worker without the filter module stays quiet: " + JSON.stringify(logs));
}
// --- 4. a game update that renames the method: logged, filters left as they were -----------
{
	const { self, grid } = bootWorker(true);
	const cfg = grid.getFilterConfig(1); const orig = cfg.isInElementMask; delete cfg.isInElementMask; cfg.isInMaskRenamed = orig;
	const logs = runEntry(self, real);
	check(logs.some((l) => /^ERR .*filter override off/.test(l)), "a changed filter object is reported (" + logs.join(" | ") + ") and left alone");
}
console.log(ok ? "\nALL OK" : "\nFAIL: see above"); process.exit(ok ? 0 : 1);
