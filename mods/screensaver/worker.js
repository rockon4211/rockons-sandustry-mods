// Screensaver — worker entry (runs in each simulation worker thread).
//
// FILTERS SEE A TRACER COPY AS ITS REAL MATERIAL (0.19.0). A copy (e.g. brandonTrc_copper) is
// its own element type, so every filter sorted it as "not copper": a filter allowing copper
// sent the copy the other way, and the followed grain took a different path from the real
// material. Filters decide with a 256-bit material mask per filter setting, asked through ONE
// shared object the game's block-grid module hands out, `getFilterConfig(id)` (bundle v0.5.6:
// `const ce = {…, isInElementMask: t => …, isSpeedExempt: t => …}`, reused for every filter).
// The mod API offers no hook there, so this finds that module through webpack's chunk list
// (`self.webpackChunksand_v1`: a pushed chunk's callback receives the module loader), picks it
// by its exports - getFilterConfig + getFilterConfigId + getOrCreateFilterPaletteEntry, never a
// build-specific module number - and wraps those two methods: a copy's type is looked up as its
// real material ("trcreal" buffer from main.js: [copy] = real, 0 = not a copy). Every other
// material goes straight to the game's own answer, and nothing is written anywhere - saves,
// structures and the filter palette are untouched. If a game update moves any of this, the
// override logs why and stays off; copies then sort as their own material, as before.
const api = sandkit.api;
const MOD_ID = "brandon.screensaver";
function safe(fn, fb) { try { return fn(); } catch (e) { return fb; } }

// the loader, via a chunk of our own on webpack's global list (manager/utility workers have
// their own bundles without the filter module - there the search just finds nothing)
function findFilterModule() {
	const list = safe(() => self.webpackChunksand_v1);
	if (!list || typeof list.push !== "function") return { why: "no webpack chunk list in this worker" };
	let req = null;
	safe(() => list.push([["brandonScreensaverFilterProbe"], {}, (r) => { req = r; }]));
	if (!req || !req.m) return { why: "the chunk list gave no module loader" };
	for (const id of Object.keys(req.m)) {
		const src = safe(() => Function.prototype.toString.call(req.m[id]), "");
		if (src.indexOf("getFilterConfig:") === -1 || src.indexOf("getFilterConfigId:") === -1 || src.indexOf("getOrCreateFilterPaletteEntry:") === -1) continue;
		const ex = safe(() => req(id));   // already loaded by the sim: the loader returns its cached exports
		if (ex && typeof ex.getFilterConfig === "function") return { ex };
	}
	return { why: "no module exporting getFilterConfig" };
}

// wrap the shared filter object's two material questions; `real` is the live shared table
function installOverride(cfg, real) {
	if (!cfg || typeof cfg.isInElementMask !== "function" || typeof cfg.isSpeedExempt !== "function") return "the filter object has no isInElementMask / isSpeedExempt";
	if (cfg.__brandonTrcReal) return "";   // already in place (a second load of this entry)
	const inMask = cfg.isInElementMask, exempt = cfg.isSpeedExempt;
	cfg.isInElementMask = function (t) { const r = t > 0 && t < 256 ? real[t] : 0; return inMask.call(this, r ? r : t); };
	cfg.isSpeedExempt = function (t) { const r = t > 0 && t < 256 ? real[t] : 0; return exempt.call(this, r ? r : t); };
	Object.defineProperty(cfg, "__brandonTrcReal", { value: true });
	return "";
}

let done = false;
(function attach(n) {
	if (done) return;
	const real = safe(() => api.shared.buffers.require("trcreal", { type: "uint8", length: 256 })) || null;   // 0.5.6's require throws until main.js has created it
	if (!real) { if (n < 400 && typeof setTimeout === "function") setTimeout(() => attach(n + 1), 100); return; }
	done = true;
	const f = findFilterModule();
	if (!f.ex) { if (!/no webpack chunk list|no module exporting/.test(f.why)) console.error("[" + MOD_ID + "] filter override off: " + f.why); return; }
	const cfg = safe(() => f.ex.getFilterConfig(1));   // the shared object (reading entry 1 changes nothing)
	const err = installOverride(cfg, real);
	if (err) console.error("[" + MOD_ID + "] filter override off: " + err);
	else console.log("[" + MOD_ID + "] filter override on: filters see tracer copies as their real material");
})(0);

if (typeof globalThis !== "undefined" && globalThis.__brandonHarness) globalThis.__brandonTrcFilterTest = { findFilterModule, installOverride };   // harness only
