// Sandbox Loop — configurable Sources and Removers for an endless, self-balancing
// system. A Source emits a chosen material at a chosen particles/sec; a Remover
// deletes a chosen material at a chosen rate. Each placed structure BAKES IN the
// config that was showing on the panel when you placed it, so you can mix many
// sources/removers of different materials and rates.
const api = sandkit.api;
const React = sandkit.react;
const h = React.createElement;
const MOD_ID = "brandon.sandboxloop";

function safe(fn, fb) { try { return fn(); } catch (e) { return fb; } }
function setting(name, fb) { const v = safe(() => api.settings.get(name)); if (typeof fb === "boolean") return typeof v === "boolean" ? v : fb; return v === undefined ? fb : v; }
function isEnabled() { return setting("enabled", true); }
const Scene = safe(() => sandkit.enums.Scene) || {};
function inWorld() {
	const a = safe(() => api.scene.getActive());
	const menus = [Scene.MainMenu, Scene.Intro].filter((v) => typeof v === "number");
	return a !== undefined && a !== null && (menus.length ? !menus.includes(a) : a > 2);
}

// --- pause detection + game clock -------------------------------------------
// The sim tick (api.time.getTick) stops advancing while the game is paused
// (pause menu, tech tree, build menu…). We poll it 10×/s: no advance for two
// polls = paused. simMs is a clock that only runs while the sim runs (and is
// persisted, so it keeps counting across restarts). Every rate, trend,
// duration, the emit/remove pacing and the history log use it instead of the
// wall clock — so pausing the game freezes all of them.
const SIM_KEY = "brandon.sandboxloop.simclock";
let simMs = safe(() => +window.localStorage.getItem(SIM_KEY)) || 0;
let simPaused = false, _lastTick = -1, _lastPoll = Date.now(), _stillPolls = 0;
setInterval(() => {
	const now = Date.now(), dt = Math.min(1000, now - _lastPoll); _lastPoll = now;
	if (!inWorld()) { simPaused = true; _lastTick = -1; return; }
	const tick = safe(() => api.time.getTick());
	if (typeof tick !== "number") { simPaused = false; simMs += dt; return; }   // no tick API → assume running while in a world
	if (tick !== _lastTick) { if (!simPaused && _lastTick !== -1) simMs += dt; _lastTick = tick; _stillPolls = 0; simPaused = false; }
	else if (++_stillPolls >= 2) simPaused = true;
}, 100);
setInterval(() => safe(() => window.localStorage.setItem(SIM_KEY, String(Math.round(simMs)))), 4000);
function simNow() { return simMs; }
function running() { return isEnabled() && inWorld() && !simPaused; }
function saverActive() { const s = safe(() => window.__brandonScreensaver); return !!(s && s.isActive && s.isActive()); }   // live answer from the Screensaver mod (a stored flag went stale and hid the panel)

const SRC_ID = "brandonSandboxSource", SRC_SPRITE = "brandonSandboxSourceSprite";
const SNK_ID = "brandonSandboxSink",   SNK_SPRITE = "brandonSandboxSinkSprite";
const CFG_KEY = "brandon.sandboxloop.instances";   // posKey -> {type,rate}
const PANEL_KEY = "brandon.sandboxloop.panel";     // current panel selections

// --- material palette (same enumeration the Matter Gun uses) ----------------
let palette = [], paletteByType = new Map();
function buildPalette() {
	const types = safe(() => api.elements.getRegisteredTypes(), []) || [];
	const MT = safe(() => sandkit.enums.MatterType) || {};
	palette = types.map((type) => {
		const def = safe(() => api.elements.getDefinitionByType(type)) || {};
		const mc = typeof def.metaColor === "number" ? def.metaColor : null;
		return {
			type,
			name: safe(() => api.elements.getNameByType(type), null) || ("type " + type),
			matterType: def.matterType,
			color: mc === null ? "#8a8a8a" : "#" + mc.toString(16).padStart(6, "0"),
		};
	}).filter((p) => p.matterType !== (safe(() => sandkit.enums.MatterType.Particle)))
	  .sort((a, b) => a.name.localeCompare(b.name));
	paletteByType = new Map(palette.map((p) => [p.type, p]));
}
buildPalette();
setTimeout(buildPalette, 3000);
safe(() => api.events.on("game:ready", buildPalette));

function defaultType() {
	if (!palette.length) buildPalette();
	const sand = palette.find((p) => /^sand$/i.test(p.name)) || palette.find((p) => /redsand|sand/i.test(p.name));
	return (sand || palette[0] || { type: null }).type;
}
function nameOf(type) { const p = paletteByType.get(type); return p ? p.name : ("type " + type); }
function colorOf(type) { const p = paletteByType.get(type); return p ? p.color : "#8a8a8a"; }

// --- panel config (current selections, baked into the next placed structure) -
const RATE_MAX = 100;   // particles/sec; decimals allowed (0.5/s = one every 2s)
let emitCfg = { type: null, rate: 10 };
let removeCfg = { type: null, rate: 8 };
function clampRate(v) { v = +v; if (!isFinite(v) || v < 0) v = 0; if (v > RATE_MAX) v = RATE_MAX; return Math.round(v * 100) / 100; }
(function loadPanel() {
	const raw = safe(() => window.localStorage.getItem(PANEL_KEY));
	const o = raw && safe(() => JSON.parse(raw));
	if (o) { if (o.emit) emitCfg = o.emit; if (o.remove) removeCfg = o.remove; }
})();
function savePanel() { safe(() => window.localStorage.setItem(PANEL_KEY, JSON.stringify({ emit: emitCfg, remove: removeCfg }))); }

// --- per-instance config (baked on place), persisted -------------------------
const cfgMap = new Map();   // "x,y" -> {type, rate}
const runtime = new Map();  // "x,y" -> {accum, last}  (emit/remove pacing)
function ikey(x, y) { return x + "," + y; }
function cfgFor(s, fallback) { return cfgMap.get(ikey(s.x, s.y)) || fallback; }

// --- structure cache ---------------------------------------------------------
// api.structures.forEachOfType walks EVERY structure on the map (~29k here) on
// every call — the game keeps no per-type index. The emit, remove and thermal
// loops used to call it ~40×/s. Instead we cache the live structure objects for
// the few types we care about and refresh when a building is placed or removed
// (plus a 5s safety refresh, which also covers loading a different save).
const structCache = new Map();   // id -> { ver, at, list }
let _structVer = 0;
function structsChanged() { _structVer++; }
function eachOf(id) {
	const c = structCache.get(id), now = Date.now();
	if (c && c.ver === _structVer && now - c.at < 5000) return c.list;
	const list = [];
	safe(() => api.structures.forEachOfType(id, (s) => { if (typeof s.x === "number") list.push(s); }));
	structCache.set(id, { ver: _structVer, at: now, list });
	return list;
}

// --- throughput tracking (per material type) --------------------------------
// emitTot/rmTot count what the loops ACTUALLY do (a place / delete that found
// room or found the material) — so a choked Source or a starved Remover shows a
// lower effective rate than its configured rate, which is exactly the surplus /
// deficit signal. rate{} smooths those into effective particles/sec.
const emitTot = new Map(), rmTot = new Map();
let emitOnceType = null, emitOnceAt = null, emitOnceSrc = null;   // one-shot element swap for the Screensaver mod
function bump(m, type) { if (type == null) return; m.set(type, (m.get(type) || 0) + 1); }
const rate = new Map();      // type -> {e, r, _le, _lr}
let lastSample = simNow();
setInterval(() => {
	if (simPaused) { lastSample = simNow(); return; }   // paused: hold every rate where it is
	const now = simNow(), dt = (now - lastSample) / 1000; lastSample = now;
	if (dt < 0.25) return;
	const types = new Set(); for (const k of emitTot.keys()) types.add(k); for (const k of rmTot.keys()) types.add(k); for (const k of rate.keys()) types.add(k);
	const A = 0.4; // EMA smoothing on the per-second rate
	for (const t of types) {
		let s = rate.get(t); if (!s) { s = { e: 0, r: 0, _le: emitTot.get(t) || 0, _lr: rmTot.get(t) || 0 }; rate.set(t, s); }
		const eNow = emitTot.get(t) || 0, rNow = rmTot.get(t) || 0;
		s.e += A * ((eNow - s._le) / dt - s.e); s.r += A * ((rNow - s._lr) / dt - s.r);
		s._le = eNow; s._lr = rNow;
	}
}, 1000);
// configured (target) rate per type, summed across every placed Source / Remover
function cfgTotals() {
	const e = new Map(), r = new Map();
	for (const s of eachOf(SRC_ID)) { const c = cfgFor(s, { type: emitCfg.type, rate: emitCfg.rate }); if (c && c.type != null && c.rate > 0) e.set(c.type, (e.get(c.type) || 0) + c.rate); }
	for (const s of eachOf(SNK_ID)) { const c = cfgFor(s, { type: removeCfg.type, rate: removeCfg.rate }); if (c && c.type != null && c.rate > 0) r.set(c.type, (r.get(c.type) || 0) + c.rate); }
	return { e, r };
}

// --- world census (counts EVERY material on the whole map, so materials the
//     loop never touches — water, steam, prismite, anything the game itself
//     makes — show a real surplus/deficit). Every cell is read (an exact count;
//     coarse sampling stepped over thin blobs like a prismite column). The work
//     is time-sliced: a bounded budget of cells per 50ms tick in a tight loop
//     (no per-cell wrapper — that was most of the cost on 14.7M cells), so a
//     sweep never stalls a frame. Speed: NORMAL finishes a pass in ~30s,
//     GENTLE spreads it over ~2 min at about a fifth of the CPU. Trend = the
//     change in a material's count from one sweep to the next, per second of
//     game time.
const BUDGET_MAX = 25000, BUDGET_MIN = 1500, REST_MS = 400;
const SWEEP_SECS_NORMAL = 30, SWEEP_SECS_GENTLE = 120;
const EPS = 0.75;   // cells/s below which a trend counts as steady
let census = new Map();        // type -> estimated cell count (last full sweep)
let censusTrend = new Map();   // type -> estimated Δ cells / second
let censusInfo = { at: 0 };   // at = wall-clock ms of the last completed sweep (0 = none yet)
let censusBase = new Map(), censusBaseAt = 0;   // baseline for the "since reset" running total
let trackedBase = 0, trackerStartSim = simNow();   // game-time (not wall-clock) the running totals have been counting
function trackedMs() { return trackedBase + (simNow() - trackerStartSim); }
let _prevCensus = new Map(), _prevAt = 0, _restUntil = 0;
let _sweep = null, _acc = new Map(), _cursor = 0;
function censusOn() { return setting("worldCensus", true); }

// --- persist the running totals so they survive a mod/scene reload (they were
//     memory-only, which is why "since reset" kept clearing itself). We restore
//     the cumulative counters, the census baseline and the start time; only the
//     reset button (or the user) zeroes them. -------------------------------
const TOTALS_KEY = "brandon.sandboxloop.totals";
function saveTotals() {
	safe(() => window.localStorage.setItem(TOTALS_KEY, JSON.stringify({ e: [...emitTot], r: [...rmTot], b: [...censusBase], ba: censusBaseAt, tm: trackedMs() })));
}
(function loadTotals() {
	const raw = safe(() => window.localStorage.getItem(TOTALS_KEY));
	const o = raw && safe(() => JSON.parse(raw));
	if (!o) return;
	if (Array.isArray(o.e)) for (const kv of o.e) emitTot.set(+kv[0], kv[1]);
	if (Array.isArray(o.r)) for (const kv of o.r) rmTot.set(+kv[0], kv[1]);
	if (Array.isArray(o.b)) for (const kv of o.b) censusBase.set(+kv[0], kv[1]);
	if (typeof o.ba === "number") censusBaseAt = o.ba;
	if (typeof o.tm === "number") { trackedBase = o.tm; trackerStartSim = simNow(); }
})();
setInterval(saveTotals, 4000);   // keep the persisted copy fresh as totals grow
// --- scan speed ---------------------------------------------------------------
let scanGentle = false;
(function loadSpeed() { if (safe(() => window.localStorage.getItem("brandon.sandboxloop.scangentle")) === "1") scanGentle = true; safe(() => window.localStorage.removeItem("brandon.sandboxloop.exact")); })();
function setGentle(v) {
	scanGentle = !!v;
	safe(() => window.localStorage.setItem("brandon.sandboxloop.scangentle", scanGentle ? "1" : "0"));
	if (_sweep) _sweep.budget = sweepBudget(_sweep.total);   // takes effect on the running sweep too
	if (panelRepaint) panelRepaint((x) => x + 1);
}
function sweepBudget(total) { return Math.min(BUDGET_MAX, Math.max(BUDGET_MIN, Math.ceil(total / (((scanGentle || saverActive()) ? SWEEP_SECS_GENTLE : SWEEP_SECS_NORMAL) * 20)))); }   // screensaver → always gentle
// watchlist: show only the materials you've pinned (★) instead of the top movers
let censusWatchOnly = false;
(function loadWatch() { if (safe(() => window.localStorage.getItem("brandon.sandboxloop.watch")) === "1") censusWatchOnly = true; })();
function setWatch(v) { censusWatchOnly = !!v; safe(() => window.localStorage.setItem("brandon.sandboxloop.watch", censusWatchOnly ? "1" : "0")); if (panelRepaint) panelRepaint((x) => x + 1); }
function censusProgress() { return _sweep ? Math.min(100, Math.floor((100 * _cursor) / _sweep.total)) : 0; }
setInterval(() => {
	// Not in a state to scan? PAUSE (keep the in-progress sweep) rather than
	// discard it — on a big world a sweep takes tens of seconds, and throwing it
	// away on every brief "not in world" flicker meant it never finished.
	if (!running() || !setting("showTracker", true) || !censusOn()) return;   // paused → the sweep waits too
	const now = Date.now(), sn = simNow();
	const d = safe(() => api.world && api.world.getDimensions()) || {};
	const W = d.widthCells | 0, H = d.heightCells | 0;
	if (W <= 0 || H <= 0) return;
	if (_sweep && (_sweep.W !== W || _sweep.H !== H)) _sweep = null;   // a different world loaded → start over
	if (!_sweep) {
		if (now < _restUntil) return;
		const total = W * H;
		_sweep = { W, H, cols: W, total, budget: sweepBudget(total) }; _acc = new Map(); _cursor = 0;
	}
	const s = _sweep, el = api.elements, acc = _acc;
	let n = 0;
	// Tight loop: direct calls, one try/catch for the whole batch. The old
	// per-cell safe() wrapper allocated a closure + try/catch per read, which
	// was most of the cost on a 14.7M-cell sweep.
	try {
		while (_cursor < s.total && n < s.budget) {
			const cx = _cursor % s.cols, cy = (_cursor / s.cols) | 0;
			const t = el.getResolvedTypeAtCell(cx, cy);
			if (t !== null && t !== undefined) acc.set(t, (acc.get(t) || 0) + 1);
			_cursor++; n++;
		}
	} catch (e) { _cursor++; }   // skip a bad cell, keep going
	if (_cursor >= s.total) {
		const fresh = acc;
		censusTrend = new Map();
		if (_prevAt && sn - _prevAt >= 1000) {   // trend per second of GAME time (a pause between sweeps doesn't dilute it)
			const dt = (sn - _prevAt) / 1000;
			const types = new Set(); for (const k of fresh.keys()) types.add(k); for (const k of _prevCensus.keys()) types.add(k);
			for (const t of types) censusTrend.set(t, ((fresh.get(t) || 0) - (_prevCensus.get(t) || 0)) / dt);
		}
		_prevCensus = fresh; _prevAt = sn; census = fresh;
		if (!censusBaseAt) { censusBase = new Map(fresh); censusBaseAt = now; saveTotals(); }   // first sweep sets (and persists) the "since reset" baseline
		censusInfo = { at: now };
		_sweep = null; _restUntil = now + REST_MS;
	}
}, 50);

// --- long-term history log ---------------------------------------------------
// Every HIST_MS (30s) a sample of every material's whole-map count, plus your
// loop's effective source/remover rates, is appended and persisted — so the
// export can be graphed over hours or days. Fine 30s samples are kept for the
// last 6h; older ones are thinned to one per 5 minutes and kept for 48h.
// Reset doesn't touch the log; "clear log" is its own
// two-click button. Each sample: {t: ms, x: 1 if exact, c: {type: count},
//                                 e: {type: emit/s}, r: {type: remove/s}, k: 1 = 5-min keeper,
//                                 st: game-time ms — the clock that stops when the game is paused}
// histExport() wraps it with the material names/colours and the loop config.
const HIST_KEY = "brandon.sandboxloop.history";
const HIST_MS = 30000, HIST_FINE_MS = 6 * 3600e3, HIST_KEEP_MS = 48 * 3600e3, HIST_COARSE_MS = 300e3;
let hist = [];
(function loadHist() {
	const raw = safe(() => window.localStorage.getItem(HIST_KEY)); const a = raw && safe(() => JSON.parse(raw));
	if (!Array.isArray(a)) return;
	hist = a.filter((s) => s && typeof s.t === "number");
	// Samples logged before the game clock existed have no `st`. Backfill them from
	// the wall clock (relative to the first clocked sample) so one log never mixes
	// two clocks — the graph page would otherwise refuse the game-time axis.
	const first = hist.find((s) => typeof s.st === "number");
	if (first) for (const s of hist) { if (typeof s.st !== "number") s.st = first.st - (first.t - s.t); }
	else for (const s of hist) s.st = simMs - (Date.now() - s.t);
})();
let _histBucket = -1, _histLastAt = 0, histMsg = "", histErr = "";
function thinHist(now) { hist = hist.filter((s) => (now - s.t) <= HIST_KEEP_MS && ((now - s.t) <= HIST_FINE_MS || s.k)); }
function saveHist() {
	try { window.localStorage.setItem(HIST_KEY, JSON.stringify(hist)); histErr = ""; }
	catch (e) {   // storage quota — drop the oldest quarter and retry once
		hist = hist.slice(Math.floor(hist.length / 4));
		try { window.localStorage.setItem(HIST_KEY, JSON.stringify(hist)); histErr = ""; } catch (e2) { histErr = "log not saved (storage full)"; }
	}
}
function recordHist() {
	if (!running() || !setting("showTracker", true) || !censusOn() || !censusInfo.at) return;   // paused → nothing is logged
	const now = Date.now();
	if (now - _histLastAt < HIST_MS - 500) return;
	if (censusInfo.at <= _histLastAt) return;   // wait until the map count has refreshed since the last sample
	_histLastAt = now;
	const c = {}; for (const [t, n] of census) if (n > 0) c[t] = Math.round(n);
	const e = {}, r = {};
	for (const [t, s] of rate) { if (s.e > 0.05) e[t] = Math.round(s.e * 10) / 10; if (s.r > 0.05) r[t] = Math.round(s.r * 10) / 10; }
	const s = { t: now, st: Math.round(simNow()), x: 1, c, e, r };   // st = game-time ms (pauses excluded); x: 1 = exact count
	const bucket = Math.floor(now / HIST_COARSE_MS);
	if (bucket !== _histBucket) { s.k = 1; _histBucket = bucket; }
	hist.push(s); thinHist(now); saveHist();
}
setInterval(recordHist, 5000);
function histSpan() { return hist.length ? (hist[hist.length - 1].t - hist[0].t) : 0; }
function histExport() {
	const types = {}; for (const p of palette) types[p.type] = { name: p.name, color: p.color };
	for (const s of hist) for (const t of Object.keys(s.c || {})) if (!types[t]) types[t] = { name: nameOf(+t), color: colorOf(+t) };
	const d = safe(() => api.world && api.world.getDimensions()) || {};
	const loop = { sources: [], removers: [] };
	for (const s of eachOf(SRC_ID)) { const c = cfgFor(s, { type: emitCfg.type, rate: emitCfg.rate }); if (c) loop.sources.push({ x: s.x, y: s.y, type: c.type, rate: c.rate }); }
	for (const s of eachOf(SNK_ID)) { const c = cfgFor(s, { type: removeCfg.type, rate: removeCfg.rate }); if (c) loop.removers.push({ x: s.x, y: s.y, type: c.type, rate: c.rate }); }
	return { format: "sandbox-loop-history", version: 1, exportedAt: new Date().toISOString(), sampleMs: HIST_MS,
		world: { widthCells: d.widthCells || 0, heightCells: d.heightCells || 0 }, types, loop, samples: hist };
}
function histStamp() { const d = new Date(), p = (n) => String(n).padStart(2, "0"); return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()); }
function histDownload() {
	if (!hist.length) { histMsg = "nothing logged yet"; return; }
	const name = "sandbox-loop-history-" + histStamp() + ".json";
	try {   // same mechanism the game itself uses for "export save"
		const blob = new Blob([JSON.stringify(histExport())], { type: "application/json" });
		const url = URL.createObjectURL(blob), a = document.createElement("a");
		a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
		setTimeout(() => URL.revokeObjectURL(url), 5000);
		histMsg = "saved " + name + " (check your Downloads)";
		safe(() => api.ui.toast("Sandbox Loop: exported " + hist.length + " samples → " + name));
	} catch (e) { histMsg = "export failed: " + (e && e.message ? e.message : e); }
	if (panelRepaint) panelRepaint((v) => v + 1);
}
function histCopy() {
	if (!hist.length) { histMsg = "nothing logged yet"; return; }
	const json = JSON.stringify(histExport());
	const done = () => { histMsg = "copied " + hist.length + " samples — paste into the Resource History page"; if (panelRepaint) panelRepaint((v) => v + 1); };
	const fail = (e) => { histMsg = "copy failed: " + (e && e.message ? e.message : e); if (panelRepaint) panelRepaint((v) => v + 1); };
	try { navigator.clipboard.writeText(json).then(done, fail); } catch (e) { fail(e); }
}
let histClearArmed = 0;
function histClear() {
	const now = Date.now();
	if (histClearArmed < now) { histClearArmed = now + 3000; if (panelRepaint) panelRepaint((v) => v + 1); return; }
	histClearArmed = 0; hist = []; _histBucket = -1; saveHist(); histMsg = "log cleared";
	if (panelRepaint) panelRepaint((v) => v + 1);
}
(function loadCfg() {
	const raw = safe(() => window.localStorage.getItem(CFG_KEY));
	const o = raw && safe(() => JSON.parse(raw));
	if (o) for (const k in o) cfgMap.set(k, o[k]);
})();
function saveCfg() { const o = {}; for (const [k, v] of cfgMap) o[k] = v; safe(() => window.localStorage.setItem(CFG_KEY, JSON.stringify(o))); }

safe(() => api.events.on("building:placed", (p) => {
	structsChanged();
	const s = p && p.structure; if (!s) return;
	if (s.type === SRC_ID) { cfgMap.set(ikey(s.x, s.y), { type: (emitCfg.type != null ? emitCfg.type : defaultType()), rate: emitCfg.rate }); saveCfg(); }
	else if (s.type === SNK_ID) { cfgMap.set(ikey(s.x, s.y), { type: (removeCfg.type != null ? removeCfg.type : defaultType()), rate: removeCfg.rate }); saveCfg(); }
}));
// a deconstructed Source/Remover forgets its baked settings (they used to linger in storage forever)
function forgetAt(x, y) { const k = ikey(x, y); if (cfgMap.delete(k)) saveCfg(); runtime.delete(k); runtime.delete("r" + k); }
safe(() => api.events.on("building:removed", (p) => {
	structsChanged();
	if (p && (p.structureId === SRC_ID || p.structureId === SNK_ID) && typeof p.x === "number") forgetAt(p.x, p.y);
}));
safe(() => api.events.on("structures:removed", (p) => {
	structsChanged();
	const list = p && p.structures; if (!Array.isArray(list)) return;
	for (const s of list) if (s && (s.type === SRC_ID || s.type === SNK_ID) && typeof s.x === "number") forgetAt(s.x, s.y);
}));

// --- register the two structures --------------------------------------------
const SHAPE_SRC = [
	[1,1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1,1],
	[1,1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1,1],
	[1,1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1,1],
	[1,1,1,1,1,1,1,1,1,1,1,1],[0,0,0,0,1,1,1,1,0,0,0,0],[0,0,0,0,1,0,0,1,0,0,0,0],
];
// Remover: ONE block (4x4 cells = 16x16 px), solid. Small enough to sit at the
// end of a belt. It eats the chosen material that lands ON TOP of it and that
// gets pushed against its SIDES, so it works whether a belt drops onto it or
// runs into it. Solid = real footprint, so it deconstructs normally.
const SNK_CELLS = 4;
const SHAPE_SNK = [[1,1,1,1],[1,1,1,1],[1,1,1,1],[1,1,1,1]];
let regErr = "";
(async () => {
	try { await api.sprites.loadFromMod(SRC_SPRITE, "source.png"); await api.sprites.loadFromMod(SNK_SPRITE, "sink.png"); }
	catch (e) { regErr = "sprites"; console.error("[" + MOD_ID + "] sprites failed:", e); }
	try {
		api.structures.register({ id: SRC_ID, name: "Source", description: "Emits the material shown on the Sandbox panel when you place it, at the set particles/sec.", categoryKey: "special", buildModes: [{ type: "single" }], variants: [{ id: SRC_ID, angles: [0] }], render: { imageName: SRC_SPRITE, size: { width: 48, height: 48 }, offset: { x: 0, y: 0 }, ui: { outline: true } }, shape: SHAPE_SRC, defaultData: {} });
		api.structures.register({ id: SNK_ID, name: "Remover", description: "A single solid block. The material shown on the Sandbox panel (only that one) is deleted at the set rate when it lands on top of it or is pushed against its sides — put it at the end of a belt. Everything else piles up normally.", categoryKey: "special", buildModes: [{ type: "single" }], variants: [{ id: SNK_ID, angles: [0] }], render: { imageName: SNK_SPRITE, size: { width: 16, height: 16 }, offset: { x: 0, y: 0 }, ui: { outline: true } }, shape: SHAPE_SNK, defaultData: {} });
		console.log("[" + MOD_ID + "] Source + Remover registered");
	} catch (e) { regErr = String(e && e.message || e); console.error("[" + MOD_ID + "] register failed:", e); }
})();

// keep both buildable
setInterval(() => {
	const store = safe(() => sandkit.state.store);
	if (!store || !store.player || !Array.isArray(store.player.buildings)) return;
	for (const id of [SRC_ID, SNK_ID]) if (store.player.buildings.indexOf(id) === -1) store.player.buildings.push(id);
}, 3000);

// --- emit loop --------------------------------------------------------------
const TICK = 200;

setInterval(() => {
	if (!running()) return;                       // paused → no emitting, and no catch-up burst after (pacing runs on game time)
	const now = simNow();
	for (const s of eachOf(SRC_ID)) {
		const cfg = cfgFor(s, { type: emitCfg.type, rate: emitCfg.rate });
		if (cfg.type == null || cfg.rate <= 0) continue;
		const k = ikey(s.x, s.y); let rt = runtime.get(k); if (!rt) { rt = { accum: 0, last: now }; runtime.set(k, rt); }
		const dt = Math.min(now - rt.last, 1000); rt.last = now;
		rt.accum += (cfg.rate * dt) / 1000;
		const cap = Math.max(8, cfg.rate);              // buffer up to ~1s of the set rate
		if (rt.accum > cap) rt.accum = cap;
		const EMPTY = safe(() => api.elements.getResolvedTypeAtCell(s.x + 6, s.y - 6));
		// Drop across the WHOLE underside of the hopper (10 cols) and well below it,
		// not a 2-cell column — that alone was choking the rate. And keep a per-tick
		// `claimed` set: createAtCellWhenIdle is queued, so within one tick re-reads
		// still show our just-placed cells as empty; without this, every unit this
		// tick targets the same cell and only ~1 survives (the "1 at a time" bug).
		const claimed = new Set();
		const COLS = 10, X0 = s.x + 1, TOP = s.y + 12, BOT = s.y + 60;
		let guard = 0, col = (rt.col || 0) % COLS;
		while (rt.accum >= 1 && guard < 240) {
			guard++; let placed = false;
			for (let ci = 0; ci < COLS && !placed; ci++) {
				const ox = X0 + ((col + ci) % COLS);
				for (let oy = TOP; oy <= BOT; oy++) {
					const key = ox + "," + oy;
					if (claimed.has(key)) continue;                                   // already targeted this tick
					if (safe(() => api.world && api.world.isTerrainAtCell(ox, oy))) break; // pile rests on ground — stop this column
					const t = safe(() => api.elements.getResolvedTypeAtCell(ox, oy));
					if (EMPTY !== undefined && t === EMPTY) {
						// the one-shot swap only applies at the Source the Screensaver asked for
						const mine = emitOnceType != null && (!emitOnceSrc || (emitOnceSrc.x === s.x && emitOnceSrc.y === s.y));
						const useType = mine ? emitOnceType : cfg.type;
						safe(() => api.elements.createAtCellWhenIdle(ox, oy, useType));
						if (useType !== cfg.type) { emitOnceAt = { x: ox, y: oy, at: Date.now(), src: { x: s.x, y: s.y }, material: cfg.type }; emitOnceType = null; }
						claimed.add(key); placed = true; bump(emitTot, cfg.type); break;
					}
					if (t !== EMPTY && t !== undefined) break;                         // hit settled material, next column
				}
			}
			col = (col + 1) % COLS; rt.col = col;                                  // spread the next unit to the next column
			if (!placed) break;
			rt.accum -= 1;
		}
	}
}, TICK);

// --- remove loop (rate-limited: deletes only cfg.type, slowly) --------------
const rmRecent = new Map();
setInterval(() => {
	if (!running()) return;                       // paused → no removing
	const now = Date.now(), sn = simNow();        // sn paces the rate; now only expires the "just removed" cell guard
	for (const s of eachOf(SNK_ID)) {
		const cfg = cfgFor(s, { type: removeCfg.type, rate: removeCfg.rate });
		if (cfg.type == null || cfg.rate <= 0) continue;
		const k = "r" + ikey(s.x, s.y); let rt = runtime.get(k); if (!rt) { rt = { accum: 0, last: sn }; runtime.set(k, rt); }
		const dt = Math.min(sn - rt.last, 1000); rt.last = sn;
		rt.accum += (cfg.rate * dt) / 1000; const rcap = Math.max(12, cfg.rate); if (rt.accum > rcap) rt.accum = rcap;
		let guard = 0;
		// Eat zone for a one-block (4x4) solid remover: the column ABOVE it (rows
		// s.y-1 up to s.y-6, cols s.x..s.x+3, lowest row first so a pile settles
		// down onto the block) plus the cells hugging its LEFT and RIGHT sides
		// (rows s.y..s.y+3), so material a belt pushes into it is eaten too.
		const N = SNK_CELLS;
		const zone = [];
		for (let y = s.y - 1; y >= s.y - 6; y--) for (let x = s.x; x < s.x + N; x++) zone.push([x, y]);
		for (let y = s.y; y < s.y + N; y++) { zone.push([s.x - 1, y]); zone.push([s.x + N, y]); }
		while (rt.accum >= 1 && guard < 120) {
			guard++; let removed = false;
			for (let i = 0; i < zone.length && !removed; i++) {
				const x = zone[i][0], y = zone[i][1];
				const key = x + "," + y; if ((rmRecent.get(key) || 0) > now) continue;
				if (safe(() => api.elements.getResolvedTypeAtCell(x, y)) === cfg.type) {
					safe(() => api.elements.removeAtCellWhenIdle(x, y)); rmRecent.set(key, now + 300); removed = true; bump(rmTot, cfg.type);
				}
			}
			if (!removed) break;
			rt.accum -= 1;
		}
	}
	if (rmRecent.size > 512) { for (const [k, exp] of rmRecent) if (exp < now) rmRecent.delete(k); }
}, 80);

// --- thermal buffer lock ----------------------------------------------------
// The Thermal Buffer (structure "thermalRelay") keeps its charge in
// data.temperature (+ hot / − cold). It drains as it heats or cools neighbours
// and equalises with connected buffers. With the lock ON we remember each
// buffer's PEAK temperature and restore it every tick: charging still raises
// it, but it can never drain — so they keep working forever. Lock OFF = normal.
const THERMAL_ID = "thermalRelay";
let thermalLock = false;
(function loadTL() { if (safe(() => window.localStorage.getItem("brandon.sandboxloop.thermallock")) === "1") thermalLock = true; })();
const thermalPins = new Map();   // "x,y" -> pinned temperature
let thermalCount = 0;
function setThermalLock(v) {
	thermalLock = !!v;
	safe(() => window.localStorage.setItem("brandon.sandboxloop.thermallock", thermalLock ? "1" : "0"));
	if (!thermalLock) thermalPins.clear();   // release: buffers behave normally again
	if (panelRepaint) panelRepaint((x) => x + 1);
}
setInterval(() => {
	if (!running()) return;
	const list = eachOf(THERMAL_ID);
	thermalCount = list.length;
	if (!thermalLock) return;
	for (const s of list) {
		const t = (s.data && typeof s.data.temperature === "number") ? s.data.temperature : 0;
		const k = ikey(s.x, s.y), pin = thermalPins.get(k);
		if (pin === undefined || Math.abs(t) >= Math.abs(pin)) thermalPins.set(k, t);      // charging up (or first sight): follow it
		else if (t !== pin) safe(() => api.structures.setData(s, { temperature: pin }));   // draining: put it back
	}
}, 50);

// --- config panel (interactive) ---------------------------------------------
let panelRepaint = null;
// Reset the running totals: zero the cumulative emit/remove counters (and the
// rate baselines), and re-baseline the world census to "now" so every "since
// reset" figure starts from zero again.
function resetTotals() {
	emitTot.clear(); rmTot.clear(); rate.clear();
	// also restart the whole-map scan from scratch: drop the current/last sweep
	// so the "since reset" baseline comes from a brand-new count, not a stale one
	_sweep = null; _prevAt = 0; _prevCensus = new Map(); census = new Map(); censusTrend = new Map();
	censusInfo = { at: 0 }; _restUntil = 0;
	censusBase = new Map(); censusBaseAt = 0;   // first sweep after the reset sets the baseline
	trackedBase = 0; trackerStartSim = simNow();
	saveTotals();
	if (panelRepaint) panelRepaint((v) => v + 1);
}
// two-click confirm for the reset button
let resetArmed = 0;
function doReset() {
	const now = Date.now();
	if (resetArmed < now) { resetArmed = now + 3000; if (panelRepaint) panelRepaint((v) => v + 1); return; }
	resetArmed = 0; resetTotals();
}
// --- draggable panel position (drag the title bar) --------------------------
let panelPos = { x: 12, y: 84 };
(function loadPos() { const raw = safe(() => window.localStorage.getItem("brandon.sandboxloop.panelpos")); const o = raw && safe(() => JSON.parse(raw)); if (o && typeof o.x === "number" && typeof o.y === "number") panelPos = o; })();
let _drag = false, _ddx = 0, _ddy = 0;
safe(() => {
	window.addEventListener("mousemove", (e) => { if (!_drag) return; panelPos = { x: Math.max(0, e.clientX - _ddx), y: Math.max(0, e.clientY - _ddy) }; if (panelRepaint) panelRepaint((v) => v + 1); });
	window.addEventListener("mouseup", () => { if (!_drag) return; _drag = false; safe(() => window.localStorage.setItem("brandon.sandboxloop.panelpos", JSON.stringify(panelPos))); });
});
function startDrag(e) { _drag = true; _ddx = e.clientX - panelPos.x; _ddy = e.clientY - panelPos.y; if (e.preventDefault) e.preventDefault(); }
// --- minimize / restore ------------------------------------------------------
let panelMin = false;
(function loadMin() { if (safe(() => window.localStorage.getItem("brandon.sandboxloop.panelmin")) === "1") panelMin = true; })();
function setMin(v) { panelMin = v; safe(() => window.localStorage.setItem("brandon.sandboxloop.panelmin", v ? "1" : "0")); if (panelRepaint) panelRepaint((x) => x + 1); }
// --- pin favourites to the top (so they stop reordering under you) ----------
const pinned = new Set();
(function loadPins() { const raw = safe(() => window.localStorage.getItem("brandon.sandboxloop.pins")); const a = raw && safe(() => JSON.parse(raw)); if (Array.isArray(a)) for (const t of a) pinned.add(t); })();
function savePins() { safe(() => window.localStorage.setItem("brandon.sandboxloop.pins", JSON.stringify([...pinned]))); }
function togglePin(t) { if (pinned.has(t)) pinned.delete(t); else pinned.add(t); savePins(); if (panelRepaint) panelRepaint((v) => v + 1); }
function pinStar(t) {
	const on = pinned.has(t);
	return h("span", { onClick: (e) => { if (e.stopPropagation) e.stopPropagation(); togglePin(t); }, title: on ? "unpin" : "pin to top", style: { cursor: "pointer", color: on ? "#ffd166" : "#57616e", fontSize: "12px", lineHeight: 1, width: "14px", textAlign: "center", flexShrink: 0, userSelect: "none" } }, on ? "★" : "☆");
}
// pinned first (stable, alphabetical), then the rest by the caller's order
function pinnedFirst(arr, keyOf, restCmp) {
	return arr.slice().sort((a, b) => {
		const pa = pinned.has(keyOf(a)) ? 1 : 0, pb = pinned.has(keyOf(b)) ? 1 : 0;
		if (pa !== pb) return pb - pa;
		if (pa) return nameOf(keyOf(a)).localeCompare(nameOf(keyOf(b)));
		return restCmp(a, b);
	});
}
function Row(label, cfg, accent) {
	const opts = palette.map((p) => h("option", { value: p.type, key: p.type }, p.name));
	const onMat = (e) => { cfg.type = +e.target.value; savePanel(); if (panelRepaint) panelRepaint((v) => v + 1); };
	const onRate = (e) => { cfg.rate = clampRate(e.target.value); savePanel(); if (panelRepaint) panelRepaint((v) => v + 1); };
	const stop = (e) => { if (e.stopPropagation) e.stopPropagation(); };   // keep typing from reaching the game's hotkeys
	return h("div", { style: { display: "flex", alignItems: "center", gap: "7px", margin: "3px 0" } },
		h("span", { style: { width: "58px", color: accent, fontWeight: 700 } }, label),
		h("span", { style: { width: "12px", height: "12px", borderRadius: "3px", background: colorOf(cfg.type), border: "1px solid rgba(255,255,255,.3)", flexShrink: 0 } }),
		h("select", { value: cfg.type == null ? "" : cfg.type, onChange: onMat, style: { width: "100px", background: "#11161d", color: "#e8edf3", border: "1px solid #37414d", borderRadius: "4px", fontSize: "11px", padding: "2px" } }, opts),
		h("input", { type: "range", min: "0", max: String(RATE_MAX), step: "0.5", value: cfg.rate, onChange: onRate, onInput: onRate, title: "drag for a quick rate; type an exact one in the box", style: { width: "58px" } }),
		h("input", { type: "number", min: "0", max: String(RATE_MAX), step: "0.1", value: cfg.rate, onChange: onRate, onKeyDown: stop, onKeyUp: stop, onKeyPress: stop, title: "particles per second — decimals OK (0.5 = one every 2s), up to " + RATE_MAX,
			style: { width: "52px", background: "#11161d", color: "#e8edf3", border: "1px solid #37414d", borderRadius: "4px", fontSize: "11px", padding: "2px 3px", fontVariantNumeric: "tabular-nums" } }),
		h("span", { style: { fontSize: "10px", color: "#93a1b0" } }, "/s"));
}
// --- balance tracker (per-material surplus / deficit) -----------------------
let trackerOpen = true;
(function loadTk() { if (safe(() => window.localStorage.getItem("brandon.sandboxloop.tkopen")) === "0") trackerOpen = false; })();
function fmt1(n) { return (Math.round(n * 10) / 10).toFixed(1); }
function fmtCount(n) { n = Math.abs(Math.round(n)); if (n >= 100000) return Math.round(n / 1000) + "k"; if (n >= 1000) return (n / 1000).toFixed(1) + "k"; return "" + n; }
const SUB_HEAD = { marginTop: "8px", marginBottom: "2px", fontWeight: 800, fontSize: "11px", display: "flex", justifyContent: "space-between", alignItems: "baseline", color: "#dbe3ec", letterSpacing: ".02em" };
const SUB_DIM = { fontSize: "9px", color: "#7f8b98", fontWeight: 600 };
const SUBLINE = { fontSize: "10.5px", color: "#9aa6b2", fontWeight: 600, marginLeft: "33px", lineHeight: 1.55 };
function swatch(t) { return h("span", { style: { width: "12px", height: "12px", borderRadius: "3px", background: colorOf(t), border: "1px solid rgba(255,255,255,.35)", flexShrink: 0 } }); }
function nameCell(t) { return h("span", { style: { flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 700, fontSize: "12.5px" } }, nameOf(t)); }
function cspan(color, text) { return h("span", { style: { color: color, fontWeight: 700, fontVariantNumeric: "tabular-nums" } }, text); }
function fmtSigned(n) { return (n >= 0 ? "+" : "−") + fmtCount(n); }
function fmtDur(ms) { const s = Math.max(0, Math.floor(ms / 1000)), m = Math.floor(s / 60), hh = Math.floor(m / 60); return hh ? (hh + "h " + String(m % 60).padStart(2, "0") + "m") : m ? (m + "m") : (s + "s"); }
function kindCol(k) { return k === "up" ? "#8fe0aa" : k === "down" ? "#e79b9b" : "#aab4c0"; }
function badge(text, k) {
	const bg = k === "up" ? "#16351f" : k === "down" ? "#351717" : "#232a31";
	return h("span", { style: { background: bg, color: kindCol(k), fontSize: "9px", fontWeight: 800, letterSpacing: ".06em", padding: "2px 8px", borderRadius: "10px", whiteSpace: "nowrap", flexShrink: 0 } }, text);
}
function pillStyle(on, onColor, onBg) { return { background: on ? onBg : "#232a31", color: on ? onColor : "#9aa6b2", border: "1px solid " + (on ? onColor : "#3a4550"), borderRadius: "9px", fontSize: "8.5px", fontWeight: 800, letterSpacing: ".03em", padding: "2px 7px", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }; }
// one material in the "Your loop" section (what your Sources/Removers push)
function loopRow(t, cfgE, cfgR) {
	const s = rate.get(t) || { e: 0, r: 0 }, em = s.e, rm = s.r, modNet = em - rm;
	const ce = cfgE.get(t) || 0, cr = cfgR.get(t) || 0;
	// Ground truth is the MAP: is this material actually piling up or draining?
	// Sources − Removers alone is wrong for anything the game's machines consume
	// (e.g. soil fed to shakers reads +30/s "surplus" forever while the map is flat).
	const haveMap = censusInfo.at > 0 && (census.has(t) || censusTrend.has(t));
	const mapTrend = haveMap ? (censusTrend.get(t) || 0) : null;
	const k = haveMap ? (mapTrend > EPS ? "up" : mapTrend < -EPS ? "down" : "flat")
	                  : (modNet > 0.3 ? "up" : modNet < -0.3 ? "down" : "flat");
	// what the game itself is doing to it = what we put in − what we took out − what the map gained
	const machines = haveMap ? (modNet - mapTrend) : null;
	let tag = "";
	if (ce > 0 && em < ce * 0.5) tag = "source can't keep up — backing up";
	else if (cr > 0 && rm < cr * 0.5) tag = "remover idle — nothing arriving";
	const since = haveMap ? ((census.get(t) || 0) - (censusBase.get(t) || 0)) : 0;
	const line3 = [];
	if (machines !== null && Math.abs(machines) > 0.3) line3.push(machines > 0 ? ["machines eat ≈ ", cspan("#c7a0e8", fmt1(machines) + "/s")] : ["machines make ≈ ", cspan("#c7a0e8", fmt1(-machines) + "/s")]);
	if (haveMap) line3.push(["since reset: ", cspan(since >= 0 ? "#8fe0aa" : "#e79b9b", fmtSigned(since) + " on map")]);
	else line3.push([h("span", { style: { color: "#6f7b88" } }, censusOn() ? "map count pending…" : "map scan is off (mod settings)")]);
	return h("div", { key: "l_" + t, style: { margin: "6px 0" } },
		h("div", { style: { display: "flex", alignItems: "center", gap: "7px" } }, pinStar(t), swatch(t), nameCell(t), badge(k === "up" ? "SURPLUS" : k === "down" ? "DEFICIT" : "BALANCED", k)),
		h("div", { style: SUBLINE }, "sources ", cspan("#8fe0aa", "+" + fmt1(em) + "/s"), "  removers ", cspan("#e79b9b", "−" + fmt1(rm) + "/s"),
			"  on map ", haveMap ? cspan(kindCol(k), fmtSigned(mapTrend) + "/s") : cspan("#6f7b88", "—")),
		h("div", { style: SUBLINE }, ...line3.flatMap((seg, i) => (i ? ["  ·  "] : []).concat(seg)),
			tag ? h("span", { style: { color: "#e0b060", display: "block" } }, "⚠ " + tag) : null));
}
// one material in the "Whole map" section (sampled count + trend)
function censusRow(t, count) {
	const tr = censusTrend.get(t) || 0, since = count - (censusBase.get(t) || 0);
	const k = tr > EPS ? "up" : tr < -EPS ? "down" : "flat";
	return h("div", { key: "c_" + t, style: { margin: "6px 0" } },
		h("div", { key: "h", style: { display: "flex", alignItems: "center", gap: "7px" } }, pinStar(t), swatch(t), nameCell(t), badge(k === "up" ? "RISING" : k === "down" ? "FALLING" : "STEADY", k)),
		h("div", { key: "a", style: SUBLINE }, cspan("#c7d0da", fmtCount(count)), " on the map  ·  now ", cspan(kindCol(k), fmtSigned(tr) + "/s"), "  ·  since reset: ", cspan(since >= 0 ? "#8fe0aa" : "#e79b9b", fmtSigned(since))));
}
function Tracker() {
	if (!setting("showTracker", true)) return null;
	const header = h("div", {
		onClick: () => { trackerOpen = !trackerOpen; safe(() => window.localStorage.setItem("brandon.sandboxloop.tkopen", trackerOpen ? "1" : "0")); if (panelRepaint) panelRepaint((v) => v + 1); },
		style: { marginTop: "8px", paddingTop: "7px", borderTop: "1px solid rgba(255,255,255,.14)", display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", userSelect: "none" },
	},
		h("span", { style: { display: "inline-block", transform: trackerOpen ? "rotate(90deg)" : "none", fontSize: "9px", color: "#93a1b0" } }, "▶"),
		h("span", { style: { fontWeight: 800, fontSize: "13px" } }, "Balance"),
		h("span", { style: { flex: "1 1 auto" } }),
		h("span", { style: SUB_DIM }, "tracking " + fmtDur(trackedMs()) + " of game time"),
		(function () { const armed = resetArmed > Date.now();
			return h("button", { onClick: (e) => { if (e.stopPropagation) e.stopPropagation(); doReset(); },
				title: "Zeroes the running totals AND restarts the whole-map scan from scratch. Click twice to confirm.",
				style: { background: armed ? "#7a2f2f" : "#1c2530", color: armed ? "#ffd0d0" : "#cdd6df", border: "1px solid " + (armed ? "#a04040" : "#3a4550"), borderRadius: "5px", fontSize: "10px", fontWeight: 700, padding: "2px 8px", cursor: "pointer" } },
				armed ? "click again to reset" : "↺ reset"); })());
	if (!trackerOpen) return header;
	const kids = [header];
	// legend — spell out what the words mean
	kids.push(h("div", { key: "leg", style: { fontSize: "9.5px", color: "#8a94a0", fontWeight: 600, margin: "3px 0 2px", lineHeight: 1.5 } },
		cspan("#8fe0aa", "SURPLUS / RISING"), " = piling up on the map.  ", cspan("#e79b9b", "DEFICIT / FALLING"), " = draining off the map.  Verdicts come from the map count, not just your sources/removers."));

	// ---- your loop: what the Sources/Removers actually push, per material ----
	const { e: cfgE, r: cfgR } = cfgTotals();
	const loopTypes = new Set(); for (const k of cfgE.keys()) loopTypes.add(k); for (const k of cfgR.keys()) loopTypes.add(k);
	kids.push(h("div", { key: "lh", style: SUB_HEAD }, h("span", null, "Your loop"), h("span", { style: SUB_DIM }, "materials your Sources / Removers touch")));
	if (loopTypes.size === 0) kids.push(h("div", { key: "ln", style: { fontSize: "10px", color: "#93a1b0", fontWeight: 500, margin: "1px 0 2px" } }, "No Source or Remover placed yet."));
	else kids.push(h("div", { key: "lr" }, pinnedFirst([...loopTypes], (t) => t, (a, b) => nameOf(a).localeCompare(nameOf(b))).map((t) => loopRow(t, cfgE, cfgR))));

	// ---- world census: every material actually on the map + its trend ----
	if (censusOn()) {
		const gentle = scanGentle, watch = censusWatchOnly;
		kids.push(h("div", { key: "ch", style: SUB_HEAD }, h("span", null, "Whole map"),
			h("span", { style: { display: "flex", gap: "5px", alignItems: "center" } },
				h("button", { onClick: (e) => { if (e.stopPropagation) e.stopPropagation(); setWatch(!watch); },
					title: watch ? "Watchlist: showing ONLY the materials you pinned (★). Tap to show top movers." : "Showing the top movers. Tap to show only your pinned (★) materials.",
					style: pillStyle(watch, "#ffd166", "#3a2f12") }, watch ? "★ WATCH" : "TOP"),
				h("button", { onClick: (e) => { if (e.stopPropagation) e.stopPropagation(); setGentle(!gentle); },
					title: gentle ? "GENTLE: the exact scan is spread over ~2 min per pass, about a fifth of the CPU. Tap for NORMAL (~30s per pass)." : "NORMAL: an exact pass every ~30s. If the game stutters, tap for GENTLE (~2 min per pass, much lighter).",
					style: pillStyle(gentle, "#8fe0aa", "#16351f") }, gentle ? "GENTLE" : "NORMAL"))));
		// live scan status: a pass takes ~30s (NORMAL) or ~2 min (GENTLE) every
		// time, so always show where the current one is; the first gets a louder banner.
		const scanning = !!_sweep, pct = censusProgress(), passSecs = gentle ? SWEEP_SECS_GENTLE : SWEEP_SECS_NORMAL;
		const ago = censusInfo.at ? Math.max(0, Math.round((Date.now() - censusInfo.at) / 1000)) : null;
		if (!censusInfo.at) kids.push(h("div", { key: "cp", style: { fontSize: "10px", color: "#e0b060", fontWeight: 700, margin: "2px 0" } },
			"First scan of the whole map… " + pct + "%  (~" + fmtDur(passSecs * 1000) + " per pass)"));
		else kids.push(h("div", { key: "cs", style: { fontSize: "9.5px", color: scanning ? "#e0b060" : "#7f8b98", fontWeight: 600, margin: "1px 0 2px", display: "flex", alignItems: "center", gap: "6px" } },
			scanning
				? [h("span", { key: "b", style: { display: "inline-block", width: "90px", height: "5px", background: "#232a31", borderRadius: "3px", overflow: "hidden" } },
						h("span", { style: { display: "block", width: pct + "%", height: "100%", background: "#e0b060" } })),
				   h("span", { key: "t" }, "rescanning… " + pct + "%")]
				: h("span", null, simPaused ? "paused — scan resumes with the game" : "counts from " + ago + "s ago · next pass soon")));
		if (watch) {
			const pins = [...pinned];
			if (!pins.length) kids.push(h("div", { key: "cw", style: { fontSize: "10px", color: "#93a1b0", fontWeight: 500, margin: "2px 0" } },
				"Watchlist is empty — tap ", h("span", { style: { color: "#ffd166" } }, "★"), " on any material to add it (it'll show here even at 0)."));
			else {
				const rows = pins.map((t) => [t, census.get(t) || 0]).sort((a, b) => nameOf(a[0]).localeCompare(nameOf(b[0])));
				kids.push(h("div", { key: "cr", style: { maxHeight: "320px", overflowY: "auto" } }, rows.map((p) => censusRow(p[0], p[1]))));
			}
		} else if (!census.size) {
			if (censusInfo.at) kids.push(h("div", { key: "cn", style: { fontSize: "10px", color: "#93a1b0", fontWeight: 500 } }, "No loose material found on the map."));
		} else {
			const present = [...census.entries()].filter((p) => p[1] > 0);
			const ordered = pinnedFirst(present, (p) => p[0], (a, b) => (Math.abs(censusTrend.get(b[0]) || 0) - Math.abs(censusTrend.get(a[0]) || 0)) || (b[1] - a[1]));
			const pinnedCount = ordered.filter((p) => pinned.has(p[0])).length;
			const top = ordered.slice(0, Math.max(12, pinnedCount));   // always keep every pinned row visible
			kids.push(h("div", { key: "cr", style: { maxHeight: "260px", overflowY: "auto" } }, top.map((p) => censusRow(p[0], p[1]))));
			if (present.length > top.length) kids.push(h("div", { key: "cm", style: { fontSize: "9px", color: "#7f8b98", marginTop: "2px" } }, "+" + (present.length - top.length) + " more, near steady — pin them or use ★ WATCH"));
		}
		kids.push(h("div", { key: "ce", style: { fontSize: "9px", color: "#6f7b88", marginTop: "4px", lineHeight: 1.5 } },
			"Every cell on the map is counted each pass.  Tap ", h("span", { style: { color: "#ffd166" } }, "★"), watch ? " to add/remove from the watchlist." : " to pin; ★ WATCH shows only pinned."));
	}
	kids.push(HistoryRow());
	return h("div", null, kids);
}
// --- history log row: what's logged + Export / Copy / clear ------------------
const SMBTN = { background: "#1c2530", color: "#cdd6df", border: "1px solid #3a4550", borderRadius: "5px", fontSize: "10px", fontWeight: 700, padding: "2px 8px", cursor: "pointer", whiteSpace: "nowrap" };
function HistoryRow() {
	const n = hist.length, span = histSpan(), armed = histClearArmed > Date.now();
	const logging = censusOn() && censusInfo.at > 0 && !simPaused;
	return h("div", { key: "hist", style: { marginTop: "8px", paddingTop: "6px", borderTop: "1px solid rgba(255,255,255,.12)" } },
		h("div", { style: { display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" } },
			h("span", { style: { fontWeight: 800, fontSize: "11px", color: "#dbe3ec" } }, "📈 History log"),
			h("span", { style: SUB_DIM }, n ? (n + " samples · " + fmtDur(span) + (logging ? " · logging every 30s" : simPaused ? " · paused with the game" : " · paused")) : (logging ? "first sample in ~30s" : "waiting for a map count")),
			h("span", { style: { flex: "1 1 auto" } }),
			h("button", { onClick: (e) => { if (e.stopPropagation) e.stopPropagation(); histDownload(); }, title: "Download the whole log as a .json file (lands in your Downloads, like the game's own Export Save). Open it on the Resource History page to graph it.", style: SMBTN }, "⤓ Export"),
			h("button", { onClick: (e) => { if (e.stopPropagation) e.stopPropagation(); histCopy(); }, title: "Copy the log to the clipboard instead — paste it into the Resource History page.", style: SMBTN }, "Copy"),
			h("button", { onClick: (e) => { if (e.stopPropagation) e.stopPropagation(); histClear(); }, title: "Wipe the history log (export first!). Click twice to confirm.",
				style: Object.assign({}, SMBTN, armed ? { background: "#7a2f2f", color: "#ffd0d0", border: "1px solid #a04040" } : { color: "#b39a9a", border: "1px solid #5a3a3a" }) }, armed ? "click again" : "clear")),
		(histMsg || histErr) ? h("div", { style: { fontSize: "9.5px", color: histErr ? "#e79b9b" : "#8fb98f", fontWeight: 700, marginTop: "2px" } }, histErr || histMsg) : null,
		h("div", { style: { fontSize: "9px", color: "#6f7b88", marginTop: "3px", lineHeight: 1.5 } },
			"Logs every material's exact map count (+ your sources/removers) every 30s: last 6h in full, older thinned to 5-min points, kept 48h. Survives resets and restarts; pauses aren't logged."));
}

// --- cleanup: remove every Source/Remover the mod knows about, including ones
//     that render as blank/red "error" blocks. Only cells INSIDE each
//     structure's own footprint are touched (Source 12×12, Remover 4×4), so a
//     conveyor or machine next door is never removed by accident. -------------
const FOOTPRINT = { [SRC_ID]: [[0, 0], [5, 5], [11, 9]], [SNK_ID]: [[0, 0], [3, 3]] };
function clearSandbox() {
	let n = 0;
	for (const id of [SRC_ID, SNK_ID]) {
		for (const s of eachOf(id)) {
			for (const c of FOOTPRINT[id]) safe(() => api.structures.removeAtCellWhenIdle(s.x + c[0], s.y + c[1]));
			forgetAt(s.x, s.y);
			n++;
		}
	}
	structsChanged();
	return n;
}
let clearArmed = 0, clearMsg = "";
function doClear() {
	const now = Date.now();
	if (clearArmed < now) { clearArmed = now + 3000; clearMsg = ""; if (panelRepaint) panelRepaint((v) => v + 1); return; }
	clearArmed = 0;
	const n = clearSandbox();
	clearMsg = "removed " + n + (n === 1 ? " structure" : " structures");
	if (panelRepaint) panelRepaint((v) => v + 1);
}
function CleanupRow() {
	const armed = clearArmed > Date.now();
	return h("div", { style: { marginTop: "6px", paddingTop: "6px", borderTop: "1px solid rgba(255,255,255,.12)", display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" } },
		h("button", { onClick: doClear, style: { background: armed ? "#7a2f2f" : "#241b1b", color: "#ffd0d0", border: "1px solid #7a3a3a", borderRadius: "5px", fontSize: "11px", fontWeight: 700, padding: "3px 9px", cursor: "pointer" } }, armed ? "click again to confirm" : "Clear ALL Sources + Removers"),
		clearMsg ? h("span", { style: { fontSize: "10px", color: "#8fb98f", fontWeight: 700 } }, clearMsg) : null);
}

function ThermalRow() {
	const on = thermalLock, pinned = thermalPins.size;
	return h("div", { style: { display: "flex", alignItems: "center", gap: "7px", margin: "5px 0 2px" } },
		h("span", { style: { width: "58px", color: "#f0a58a", fontWeight: 700, lineHeight: 1.1 } }, "Thermal buffer"),
		h("button", { onClick: (e) => { if (e.stopPropagation) e.stopPropagation(); setThermalLock(!on); },
			title: on ? "Thermal Buffers never lose their temperature (hot or cold): each is held at its peak, charging still raises it. Tap to return to normal." : "Thermal Buffers drain normally. Tap to lock their temperature (hot or cold) at its peak so they always work.",
			style: pillStyle(on, "#f0a58a", "#3a2116") }, on ? "🔒 TEMP LOCKED" : "NORMAL"),
		h("span", { style: { fontSize: "10px", color: "#93a1b0", fontWeight: 600 } },
			thermalCount + (thermalCount === 1 ? " buffer" : " buffers") + (on ? " · " + pinned + " held at peak temp" : " · drain normally")));
}
// --- screensaver row: hands off to the Screensaver mod (window.__brandonScreensaver) --
let saverMsg = "";
function ScreensaverRow() {
	const hook = safe(() => window.__brandonScreensaver);
	const go = (e) => {
		if (e && e.stopPropagation) e.stopPropagation();
		if (!hook) { saverMsg = "Screensaver mod isn't loaded — check the Mods menu (enable it, then fully quit and relaunch)."; if (panelRepaint) panelRepaint((v) => v + 1); return; }
		let r; try { r = hook.start(); } catch (err) { r = "error: " + (err && err.message ? err.message : err); }
		saverMsg = r ? ("can't start: " + r) : ("started — build " + (hook.build || "?") + " · move the mouse to stop");
		if (panelRepaint) panelRepaint((v) => v + 1);
	};
	return h("div", { style: { margin: "5px 0 2px" } },
		h("div", { style: { display: "flex", alignItems: "center", gap: "7px" } },
			h("span", { style: { width: "58px", color: "#a9b8e8", fontWeight: 700, lineHeight: 1.1 } }, "Screensaver"),
			h("button", { onClick: go, title: hook ? "Start the screensaver now: HUD and cursor hide, the camera follows a grain through your factory. Any key or mouse movement stops it." : "The Screensaver mod isn't loaded — enable it in the Mods menu and relaunch.",
			style: Object.assign(pillStyle(!!hook, "#a9b8e8", "#1c2340"), { cursor: "pointer" }) }, "🌙 START NOW"),
		h("button", { onClick: (e) => {
				if (e && e.stopPropagation) e.stopPropagation();
				if (!hook || !hook.exportLog) { saverMsg = "this Screensaver build has no log"; }
				else { saverMsg = safe(() => hook.exportLog()) || "export failed"; }
				if (panelRepaint) panelRepaint((v) => v + 1);
			}, title: "Save the tracer's flight recorder (where it went, and what was around it when it vanished) to Downloads.",
			style: Object.assign(pillStyle(!!(hook && hook.exportLog), "#cdd6df", "#232a31"), { cursor: "pointer" }) },
			"⤓ log" + (hook && hook.logSize ? " (" + (safe(() => hook.logSize()) || 0) + ")" : "")),
		h("span", { style: { fontSize: "10px", color: "#93a1b0", fontWeight: 600 } }, hook ? ("build " + (hook.build || "?")) : "mod not loaded")),
		saverMsg ? h("div", { style: { fontSize: "9.5px", color: "#e0b060", fontWeight: 600, marginLeft: "65px", lineHeight: 1.4 } }, saverMsg) : null);
}
const MINBTN = { background: "#1c2530", color: "#cdd6df", border: "1px solid #3a4550", borderRadius: "5px", fontSize: "13px", fontWeight: 800, lineHeight: 1, padding: "2px 9px", cursor: "pointer", flexShrink: 0 };
function TitleBar() {
	return h("div", { onMouseDown: startDrag, title: "drag to move", style: { fontWeight: 800, marginBottom: "4px", letterSpacing: ".02em", cursor: _drag ? "grabbing" : "grab", userSelect: "none", display: "flex", alignItems: "center", gap: "7px" } },
		h("span", { style: { color: "#5b6470", fontSize: "13px", lineHeight: 1 } }, "⠿"),
		h("span", null, "Sandbox Loop" + (regErr ? "  (err: " + regErr.slice(0, 20) + ")" : "")),
		h("span", { style: { flex: "1 1 auto" } }),
		simPaused ? h("span", { title: "Game is paused: sources, removers, rates, the map scan, the running totals and the history log are all frozen until it resumes.", style: { background: "#3a2f12", color: "#e0b060", fontSize: "9px", fontWeight: 800, letterSpacing: ".06em", padding: "2px 8px", borderRadius: "10px", whiteSpace: "nowrap", flexShrink: 0 } }, "⏸ PAUSED") : null,
		h("button", { title: panelMin ? "expand" : "minimize", onMouseDown: (e) => { if (e.stopPropagation) e.stopPropagation(); }, onClick: (e) => { if (e.stopPropagation) e.stopPropagation(); setMin(!panelMin); }, style: MINBTN }, panelMin ? "▢" : "–"));
}
function Panel() {
	const [, b] = React.useState(0); panelRepaint = b;
	if (!isEnabled() || !inWorld() || saverActive()) return null;
	if (emitCfg.type == null) emitCfg.type = defaultType();
	if (removeCfg.type == null) removeCfg.type = defaultType();
	const base = {
		position: "fixed", left: panelPos.x + "px", top: panelPos.y + "px", zIndex: 99998, pointerEvents: "auto",
		background: "rgba(10,14,20,0.94)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: "8px",
		padding: "8px 10px", font: '600 12px -apple-system,"Segoe UI",Roboto,sans-serif', color: "#e8edf3",
		boxShadow: "0 4px 16px rgba(0,0,0,.5)",
	};
	if (panelMin) {
		const ns = eachOf(SRC_ID).length, nr = eachOf(SNK_ID).length;
		return h("div", { style: Object.assign({}, base, { minWidth: "210px" }) },
			TitleBar(),
			h("div", { style: { fontSize: "10px", color: "#93a1b0", fontWeight: 600, marginLeft: "20px" } }, ns + (ns === 1 ? " source" : " sources") + " · " + nr + (nr === 1 ? " remover" : " removers")));
	}
	return h("div", { style: Object.assign({}, base, { minWidth: "312px", maxWidth: "340px" }) },
		TitleBar(),
		Row("Source", emitCfg, "#8fe0aa"),
		Row("Remover", removeCfg, "#e79b9b"),
		h("div", { style: { marginTop: "5px", fontSize: "10px", color: "#93a1b0", fontWeight: 500 } }, "Set these, then place a Source / Remover — each bakes in the settings shown now."),
		ThermalRow(),
		ScreensaverRow(),
		Tracker(),
		CleanupRow());
}
// hook for the Screensaver mod: where the Sources are and what each emits
safe(() => {
	window.__brandonSandboxLoop = {
		sources: () => eachOf(SRC_ID).map((s) => { const c = cfgFor(s, { type: emitCfg.type, rate: emitCfg.rate }); return { x: s.x, y: s.y, type: c.type, rate: c.rate }; }),
		// emit ONE grain of `type` instead of the next normal grain, and report where it landed
		emitOnce: (type, src) => { emitOnceType = type; emitOnceSrc = src && typeof src.x === "number" ? { x: src.x, y: src.y } : null; emitOnceAt = null; return true; },
		emitOnceResult: () => emitOnceAt,
		cancelEmitOnce: () => { emitOnceType = null; emitOnceSrc = null; },
	};
});
safe(() => api.ui.inject("brandon-sandboxloop-panel", Panel));
setInterval(() => { if (panelRepaint) panelRepaint((v) => v + 1); }, 1000);

console.log("[" + MOD_ID + "] loaded");
