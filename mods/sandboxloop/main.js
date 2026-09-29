// Sandbox Loop — configurable Sources and Removers for an endless, self-balancing
// system. A Source emits a chosen material at a chosen particles/sec; a Remover
// deletes a chosen material at a chosen rate. Each placed structure BAKES IN the
// config that was showing on the panel when you placed it, so you can mix many
// sources/removers of different materials and rates.
const api = sandkit.api;
const React = sandkit.react;
const h = React.createElement;
const MOD_ID = "brandon.sandboxloop";
const BUILD = "0.4.9";

function safe(fn, fb) { try { return fn(); } catch (e) { return fb; } }
function setting(name, fb) { const v = safe(() => api.settings.get(name)); if (typeof fb === "boolean") return typeof v === "boolean" ? v : fb; return v === undefined ? fb : v; }
function isEnabled() { return setting("enabled", true); }
const Scene = safe(() => sandkit.enums.Scene) || {};
function inWorld() {
	const a = safe(() => api.scene.getActive());
	// Scene: MainMenu=1, Intro=2, Deploy=3 (the landing cinematic), Game=4
	const menus = [Scene.MainMenu, Scene.Intro, Scene.Deploy].filter((v) => typeof v === "number");
	return a !== undefined && a !== null && (menus.length ? !menus.includes(a) : a > 3);
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
function saverSweeping() { return !!safe(() => window.__brandonScreensaver.isSweeping()); }   // the Screensaver's whole-map sweep (optional hook: older builds have none)

const SRC_ID = "brandonSandboxSource", SRC_SPRITE = "brandonSandboxSourceSprite";
const SNK_ID = "brandonSandboxSink",   SNK_SPRITE = "brandonSandboxSinkSprite";
const CFG_KEY = "brandon.sandboxloop.instances";   // posKey -> {type,rate}
const PANEL_KEY = "brandon.sandboxloop.panel";     // current panel selections

// --- material palette (same enumeration the Matter Gun uses) ----------------
let palette = [], paletteByType = new Map();
// The Screensaver mod registers a tracer copy of every material (ids "brandonTrc_…" and
// "brandonTracer…"). They are not materials you'd emit or remove, so keep them out of the
// pickers and the whole-map list.
function isTracerType(t) { const id = safe(() => api.elements.getIdByType(t)); return typeof id === "string" && /^brandonTrc_|^brandonTracer/.test(id); }
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
	}).filter((p) => p.matterType !== (safe(() => sandkit.enums.MatterType.Particle)) && !isTracerType(p.type))
	  .sort((a, b) => a.name.localeCompare(b.name));
	paletteByType = new Map(palette.map((p) => [p.type, p]));
}
buildPalette();
setTimeout(buildPalette, 3000);
// game:ready also fires when the SAME world is reloaded (F10 quickload): every cached
// structure object is dead then, and switchWorld doesn't run because the id didn't change —
// so drop the structure cache and the pacing state here (✎ edits hit dead objects otherwise)
safe(() => api.events.on("game:ready", () => { buildPalette(); safe(ensureDefaults); structsChanged(); runtime.clear(); }));
setTimeout(() => safe(ensureDefaults), 3500);

// resolve stored ids to numbers and fill in a default material if there is none yet
function ensureDefaults() {
	fixCfg(emitCfg); fixCfg(removeCfg);
	if (emitCfg.type == null) { emitCfg.type = defaultType(); emitCfg.mat = eidOfType(emitCfg.type); }
	if (removeCfg.type == null) { removeCfg.type = defaultType(); removeCfg.mat = eidOfType(removeCfg.type); }
	safe(resolvePins);
}
function defaultType() {
	if (!palette.length) buildPalette();
	// by ELEMENT ID, never by display name: other mods rename the vanilla sand to "soil"
	// and add their own material called "Sand", and matching on the name picked THAT
	const t = typeOfEid("sand");
	if (typeof t === "number" && paletteByType.has(t)) return t;
	const sand = palette.find((p) => /^sand$/i.test(p.name)) || palette.find((p) => /redsand|sand/i.test(p.name));
	return (sand || palette[0] || { type: null }).type;
}
// A material is stored as its element ID (a string like "sand"), because the NUMBER the
// game gives an element depends on which mods loaded and in what order — the same map on
// another PC resolved a stored number to a different material.
const eidCache = new Map(), typeCache = new Map();
function typeOfEid(id) {
	if (!id) return undefined;
	if (typeCache.has(id)) return typeCache.get(id);
	const t = safe(() => api.elements.getTypeFromId(id));
	if (typeof t === "number") typeCache.set(id, t);
	return t;
}
function eidOfType(t) {
	if (typeof t !== "number") return undefined;
	if (eidCache.has(t)) return eidCache.get(t);
	const id = safe(() => api.elements.getIdByType(t));
	if (id) eidCache.set(t, id);
	return id;
}
// fill in whichever half is missing, preferring the id
function fixCfg(c) {
	if (!c) return c;
	if (c.mat) { const t = typeOfEid(c.mat); if (typeof t === "number") c.type = t; }
	else if (c.type != null) { const id = eidOfType(c.type); if (id) c.mat = id; }
	return c;
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
	// A number-only entry was saved before 0.4.0. Numbers change between PCs, and the
	// old default picked Manufacturing's golden "Sand" by name — so on the laptop the
	// remembered number pointed at golden Sand and every unset Source emitted it.
	// Throw such entries away; ensureDefaults then picks vanilla sand (soil) by id.
	for (const c of [emitCfg, removeCfg]) if (c && !c.mat && c.type != null) c.type = null;
	// stored on an older build (number only) or on another PC: the id wins
	setTimeout(() => safe(ensureDefaults), 0);
})();
function savePanel() { safe(() => window.localStorage.setItem(PANEL_KEY, JSON.stringify({ emit: emitCfg, remove: removeCfg }))); }

// --- per-instance config (baked on place), persisted -------------------------
const cfgMap = new Map();   // "world@x,y" -> {mat, type, rate}  (older builds: "x,y")
const runtime = new Map();  // "world@x,y" -> {accum, last}  (emit/remove pacing)
// localStorage is one store for the whole PC, but coordinates only mean something on
// one map: keys carry the id the game stamps on a world and keeps in its saves.
function worldId() { const w = safe(() => sandkit.state.store.meta.worldId); return (typeof w === "string" || typeof w === "number") && w !== "" ? String(w) : ""; }
function ikey(x, y) { const w = worldId(); return (w ? w + "@" : "") + x + "," + y; }
// The settings baked into a placed Source/Remover live on the STRUCTURE (so they travel
// with the save to another PC); the old per-cell store is still read, and is copied onto
// the structure the first time it is seen — but only an entry holding the element ID. A
// number-only entry (pre-0.4.0) means whatever this PC numbered it, so it counts as unset.
function cfgFor(s, fallback) {
	const d = s && s.data;   // read fresh every call: updateData/setData REPLACE s.data, so a held object goes stale after a bake
	if (d && d.brandonMat) {
		const t = typeOfEid(d.brandonMat);
		if (typeof t === "number") return { mat: d.brandonMat, type: t, rate: typeof d.brandonRate === "number" ? d.brandonRate : (fallback ? fallback.rate : 0) };
	}
	const c = cfgMap.get(ikey(s.x, s.y)) || cfgMap.get(s.x + "," + s.y);
	if (c && typeof c.mat === "string" && typeof typeOfEid(c.mat) === "number") {
		fixCfg(c);
		if (d) { d.brandonMat = c.mat; if (typeof c.rate === "number") d.brandonRate = c.rate; }
		return c;
	}
	const f = fixCfg(fallback);
	return f ? Object.assign({}, f, { unset: true }) : f;   // nothing baked: follows the panel
}
function bake(s, cfg) {
	const mat = cfg.mat || eidOfType(cfg.type), rate = cfg.rate;
	cfgMap.set(ikey(s.x, s.y), { mat: mat, type: cfg.type, rate: rate });
	// through the game's own setter: updateData (= setData) replaces s.data with the patch
	// merged in and re-writes the tile on the main thread (workers are only told with
	// {propagateToWorkers:true}, which nothing here needs — the loops read s.data from
	// here). Poking s.data directly is only the fallback.
	const viaApi = safe(() => { api.structures.updateData(s, { brandonMat: mat, brandonRate: rate }); return true; }, false);
	if (!viaApi || !s.data || s.data.brandonMat !== mat) { if (!s.data) s.data = {}; s.data.brandonMat = mat; s.data.brandonRate = rate; }
	saveCfg();
}
// "use panel" in a Placed row's editor: bake the panel's current Source (or Remover) setting into a
// structure that is already on the map, so it never has to be re-placed
function applyPanelTo(s, isSrc) {
	const pc = isSrc ? emitCfg : removeCfg;
	fixCfg(pc);
	if (pc.type == null) return false;
	bake(s, { mat: pc.mat || eidOfType(pc.type), type: pc.type, rate: pc.rate });
	runtime.delete(isSrc ? ikey(s.x, s.y) : "r" + ikey(s.x, s.y));
	return true;
}

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
let emitSeq = 0;   // bumped by emitOnce/cancelEmitOnce: a queued tracer that was superseded comes out as the normal material
function bump(m, type) { if (type == null) return; m.set(type, (m.get(type) || 0) + 1); }
const rate = new Map();      // type -> {e, r, _le, _lr}
let lastSample = simNow();
setInterval(() => {
	if (simPaused) { lastSample = simNow(); return; }   // paused: hold every rate where it is
	const now = simNow(), dt = (now - lastSample) / 1000;
	if (dt < 0.25) return;   // too soon (e.g. just unpaused): keep the old baseline, or the next rate reads high
	lastSample = now;
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
// Totals, the census baseline and the history log describe ONE map, so they are stored
// per world ("key@worldId") and swapped when another world is loaded. undefined = no
// world seen yet (nothing is saved); "" = the game gave no world id (unscoped key).
let curWorld;
function scopedKey(base) { return curWorld === undefined ? null : (curWorld ? base + "@" + curWorld : base); }
// Element NUMBERS are handed out at runtime and differ between PCs / mod sets, so anything
// persisted by number carries {number: element id} and is mapped back on load.
function idMapFor(types) { const o = {}; for (const t of types) { const id = eidOfType(+t); if (id) o[t] = id; } return o; }
function remapType(t, ids) {
	if (!ids) return +t;                                   // older store: this PC's numbers
	const id = ids[t]; if (!id) return +t;
	const n = typeOfEid(id); return typeof n === "number" ? n : null;   // material gone → drop
}
function saveTotals() {
	const key = scopedKey(TOTALS_KEY); if (!key) return;
	const ids = idMapFor(new Set([...emitTot.keys(), ...rmTot.keys(), ...censusBase.keys()]));
	safe(() => window.localStorage.setItem(key, JSON.stringify({ e: [...emitTot], r: [...rmTot], b: [...censusBase], ba: censusBaseAt, tm: trackedMs(), ids })));
}
function loadTotals() {
	const raw = safe(() => window.localStorage.getItem(scopedKey(TOTALS_KEY)));
	const o = raw && safe(() => JSON.parse(raw));
	if (!o) return;
	const ids = o.ids && typeof o.ids === "object" ? o.ids : null;
	const put = (m, a) => { if (Array.isArray(a)) for (const kv of a) { const t = remapType(kv[0], ids); if (t !== null) m.set(t, kv[1]); } };
	put(emitTot, o.e); put(rmTot, o.r); put(censusBase, o.b);
	if (typeof o.ba === "number") censusBaseAt = o.ba;
	if (typeof o.tm === "number") { trackedBase = o.tm; trackerStartSim = simNow(); }
}
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
function sweepBudget(total) { return Math.min(BUDGET_MAX, Math.max(BUDGET_MIN, Math.ceil(total / (((scanGentle || saverActive() || saverSweeping()) ? SWEEP_SECS_GENTLE : SWEEP_SECS_NORMAL) * 20)))); }   // screensaver running, or its own map sweep → always gentle (two full-map reads at once stutter)
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
const HIST_SAVE_MS = 5 * 60e3;   // the whole log is ~1-2 MB of JSON: persist every 5 min (and on unload), not every sample
let hist = [], _histSavedAt = 0;
function loadHist() {
	hist = [];
	const raw = safe(() => window.localStorage.getItem(scopedKey(HIST_KEY))); const o = raw && safe(() => JSON.parse(raw));
	const a = Array.isArray(o) ? o : (o && Array.isArray(o.samples) ? o.samples : null);   // 0.4.3+: {v, ids, samples}
	if (!a) return;
	hist = a.filter((s) => s && typeof s.t === "number");
	const ids = o && !Array.isArray(o) && o.ids && typeof o.ids === "object" ? o.ids : null;
	if (ids) {   // numbered on another PC / mod set? map every per-material table back to this session's numbers
		const re = (m) => { if (!m) return m; const n = {}; for (const k in m) { const t = remapType(k, ids); if (t !== null) n[t] = m[k]; } return n; };
		for (const s of hist) { s.c = re(s.c); s.e = re(s.e); s.r = re(s.r); }
	}
	// Samples logged before the game clock existed have no `st`. Backfill them from
	// the wall clock (relative to the first clocked sample) so one log never mixes
	// two clocks — the graph page would otherwise refuse the game-time axis.
	const first = hist.find((s) => typeof s.st === "number");
	if (first) for (const s of hist) { if (typeof s.st !== "number") s.st = first.st - (first.t - s.t); }
	else for (const s of hist) s.st = simMs - (Date.now() - s.t);
}
let _histBucket = -1, _histLastAt = 0, histMsg = "", histErr = "";
function thinHist(now) { hist = hist.filter((s) => (now - s.t) <= HIST_KEEP_MS && ((now - s.t) <= HIST_FINE_MS || s.k)); }
function saveHist() {
	const key = scopedKey(HIST_KEY); if (!key) return;
	_histSavedAt = Date.now();
	const put = (samples) => {
		const types = new Set(); for (const s of samples) for (const m of [s.c, s.e, s.r]) if (m) for (const t in m) types.add(t);
		window.localStorage.setItem(key, JSON.stringify({ v: 2, ids: idMapFor(types), samples }));
	};
	try { put(hist); histErr = ""; }
	catch (e) {   // storage quota — keep the long-term 5-min points, drop the fine 30s ones (the log in memory is untouched)
		try { put(hist.filter((s) => s.k)); histErr = "only the 5-min points saved (storage full)"; } catch (e2) { histErr = "log not saved (storage full)"; }
	}
}
safe(() => window.addEventListener("beforeunload", () => { safe(saveHist); safe(saveTotals); }));
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
	hist.push(s); thinHist(now);
	if (now - _histSavedAt >= HIST_SAVE_MS) saveHist();
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
	if (isThermal(s.type)) { thermalPins.delete(ikey(s.x, s.y)); return; }   // a new buffer starts from its own temperature
	if (s.type !== SRC_ID && s.type !== SNK_ID) return;
	// moved or copy-pasted: the game copies the original's data, baked settings included — keep them
	const d = s.data;
	if (p.isCopied && d && typeof d.brandonMat === "string") {
		const t = typeOfEid(d.brandonMat);
		if (typeof t === "number") { cfgMap.set(ikey(s.x, s.y), { mat: d.brandonMat, type: t, rate: typeof d.brandonRate === "number" ? d.brandonRate : (s.type === SRC_ID ? emitCfg : removeCfg).rate }); saveCfg(); }
		return;
	}
	if (s.type === SRC_ID) bake(s, { mat: emitCfg.mat, type: (emitCfg.type != null ? emitCfg.type : defaultType()), rate: emitCfg.rate });
	else bake(s, { mat: removeCfg.mat, type: (removeCfg.type != null ? removeCfg.type : defaultType()), rate: removeCfg.rate });
}));
// a deconstructed Source/Remover forgets its baked settings (they used to linger in storage forever)
function forgetAt(x, y) { const k = ikey(x, y); if (cfgMap.delete(k) | cfgMap.delete(x + "," + y)) saveCfg(); runtime.delete(k); runtime.delete("r" + k); }
safe(() => api.events.on("building:removed", (p) => {
	structsChanged();
	if (!p || typeof p.x !== "number") return;
	if (p.structureId === SRC_ID || p.structureId === SNK_ID) forgetAt(p.x, p.y);
	else if (isThermal(p.structureId)) thermalPins.delete(ikey(p.x, p.y));
}));
safe(() => api.events.on("structures:removed", (p) => {
	structsChanged();
	const list = p && p.structures;
	if (Array.isArray(list) && list.length) {   // the game always sends an array — EMPTY on a failed move (its own listener checks length too)
		for (const s of list) {
			if (!s || typeof s.x !== "number") continue;
			if (s.type === SRC_ID || s.type === SNK_ID) forgetAt(s.x, s.y);
			else if (isThermal(s.type)) thermalPins.delete(ikey(s.x, s.y));
		}
		return;
	}
	// a move whose targets failed to place sends {removed:[{x,y}…], byMove:true} with an
	// empty structures list: forget the baked settings at those positions too (a lingering entry
	// would be baked into whatever is placed there next)
	const gone = p && p.removed; if (!Array.isArray(gone)) return;
	for (const r of gone) { if (r && typeof r.x === "number") { forgetAt(r.x, r.y); thermalPins.delete(ikey(r.x, r.y)); } }
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
// The game's own emptiness test: false for a cell holding material, terrain OR a building
// (reading the element type gave null for a building cell, so grains were "placed" into
// the hopper and counted though the game never made them). undefined = couldn't tell.
function cellEmpty(x, y) {
	const w = safe(() => api.world);
	if (w && typeof w.isCellEmptyAtCell === "function") return safe(() => !!w.isCellEmptyAtCell(x, y));
	const t = safe(() => api.elements.getResolvedTypeAtCell(x, y));   // older runtime: no element here
	return t === undefined ? undefined : t === null;
}
// Make one grain at a cell verified empty. With api.world.mutate the create runs at the
// sim's next idle moment and is confirmed there, so only grains that really appeared are
// counted, and the Screensaver's tracer is reported only once it exists. A tracer whose
// request was cancelled/replaced meanwhile comes out as the normal material; one that
// found its cell filled (or that the game couldn't make) goes back in the queue.
function emitGrain(ox, oy, s, cfg, tracer) {
	const w = safe(() => api.world), seq = emitSeq;
	const report = (x, y) => { emitOnceAt = { x, y, at: Date.now(), src: { x: s.x, y: s.y }, material: cfg.type }; };
	if (w && typeof w.mutate === "function" && typeof w.isCellEmptyAtCell === "function") {
		const queued = safe(() => { w.mutate((wr) => { try {
			const live = tracer != null && seq === emitSeq;
			if (!w.isCellEmptyAtCell(ox, oy)) { if (live && emitOnceType == null) emitOnceType = tracer; return; }
			// createAtCell silently does nothing when the game's element pool is full. The mutate
			// queue drains synchronously on the main thread with the sim parked, so a read here
			// does see the write: confirm the grain before counting it (or reporting the tracer)
			const want = live ? tracer : cfg.type;
			wr.elements.createAtCell(ox, oy, want);
			if (api.elements.getResolvedTypeAtCell(ox, oy) !== want) { if (live && emitOnceType == null) emitOnceType = tracer; return; }
			bump(emitTot, cfg.type);
			if (live) report(ox, oy);
		} catch (e) {} }); return true; }, false);
		if (queued) return;
	}
	// no mutate: the idle create re-checks the cell itself; the cell was verified empty just now
	safe(() => api.elements.createAtCellWhenIdle(ox, oy, tracer != null ? tracer : cfg.type));
	bump(emitTot, cfg.type);
	if (tracer != null) report(ox, oy);
}

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
		// a tracer request for THIS Source shouldn't wait on a slow rate (below ~0.17/s a grain
		// never accumulates inside the Screensaver's 6s window): let it emit one grain now,
		// once per request (emitSeq changes with every emitOnce / cancelEmitOnce)
		const mineNow = emitOnceType != null && (!emitOnceSrc || (emitOnceSrc.x === s.x && emitOnceSrc.y === s.y));
		if (mineNow && rt.accum < 1 && rt.tracerSeq !== emitSeq) { rt.accum = 1; rt.tracerSeq = emitSeq; }
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
					const empty = cellEmpty(ox, oy);
					if (empty === true) {
						// the one-shot swap only applies at the Source the Screensaver asked for
						const mine = emitOnceType != null && (!emitOnceSrc || (emitOnceSrc.x === s.x && emitOnceSrc.y === s.y));
						const tracer = mine && emitOnceType !== cfg.type ? emitOnceType : null;
						if (tracer != null) emitOnceType = null;                       // taken (restored if it can't be made)
						emitGrain(ox, oy, s, cfg, tracer);
						claimed.add(key); placed = true; break;
					}
					if (empty === false) break;                                        // hit settled material or a building, next column
				}
			}
			col = (col + 1) % COLS; rt.col = col;                                  // spread the next unit to the next column
			if (!placed) break;
			rt.accum -= 1;
		}
	}
}, TICK);

// --- remove loop (rate-limited: deletes only cfg.type, slowly) --------------
// The delete runs at the sim's next idle moment. Neither queued deleter checks the MATERIAL:
// api.elements.removeAtCellWhenIdle requires the cell id to be unchanged since the call (the
// same slot — a grain that changed material in place, wet → dry, melting…, still goes), and
// plain removeAtCell only that something is still there. Through api.world.mutate the material
// is checked again right before the delete, and only a real delete is counted.
function removeGrain(x, y, type) {
	const w = safe(() => api.world);
	if (w && typeof w.mutate === "function") {
		const queued = safe(() => { w.mutate((wr) => { try {
			if (api.elements.getResolvedTypeAtCell(x, y) === type) { wr.elements.removeAtCell(x, y); bump(rmTot, type); }
		} catch (e) {} }); return true; }, false);
		if (queued) return;
	}
	safe(() => api.elements.removeAtCellWhenIdle(x, y)); bump(rmTot, type);   // no mutate (older runtime): WhenIdle = the same slot must still be there
}
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
					removeGrain(x, y, cfg.type); rmRecent.set(key, now + 300); removed = true;
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
const thermalPins = new Map();   // "world@x,y" -> pinned temperature; dropped when that buffer is removed/replaced or the world changes
let thermalCount = 0;
function isThermal(type) { return type != null && (type === THERMAL_ID || type === safe(() => api.structures.getTypeById(THERMAL_ID))); }
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

// --- world changes -----------------------------------------------------------
// Another save loaded: put away the old world's totals/log, load this one's, restart the
// map count and forget every held temperature. The first world after an update adopts
// the old unscoped totals/log (they were written by a build that didn't scope them).
function adoptLegacy(base) {
	if (!curWorld) return;
	safe(() => {
		const ls = window.localStorage, key = base + "@" + curWorld;
		if (ls.getItem(key) !== null) return;
		const old = ls.getItem(base); if (old === null) return;
		ls.setItem(key, old); ls.removeItem(base);
	});
}
function switchWorld(w) {
	if (curWorld !== undefined) { saveTotals(); saveHist(); }   // flush the world we're leaving
	curWorld = w;
	emitTot.clear(); rmTot.clear(); rate.clear();
	_sweep = null; _prevAt = 0; _prevCensus = new Map(); census = new Map(); censusTrend = new Map(); censusInfo = { at: 0 }; _restUntil = 0;
	censusBase = new Map(); censusBaseAt = 0; trackedBase = 0; trackerStartSim = simNow();
	hist = []; _histBucket = -1; _histLastAt = 0; _histSavedAt = Date.now();
	adoptLegacy(TOTALS_KEY); adoptLegacy(HIST_KEY);
	loadTotals(); loadHist();
	thermalPins.clear(); runtime.clear(); structsChanged();
	if (panelRepaint) panelRepaint((v) => v + 1);
}
setInterval(() => {
	if (!inWorld()) { thermalPins.clear(); return; }
	const w = worldId();
	if (w !== curWorld) switchWorld(w);
}, 1000);

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
(function loadPos() {
	const raw = safe(() => window.localStorage.getItem("brandon.sandboxloop.panelpos")); const o = raw && safe(() => JSON.parse(raw));
	if (!o || typeof o.x !== "number" || typeof o.y !== "number") return;
	// clamp to the window: a position saved on a bigger screen would put the panel off-screen
	const W = safe(() => window.innerWidth), H = safe(() => window.innerHeight);
	panelPos = { x: Math.max(0, typeof W === "number" && W > 0 ? Math.min(o.x, W - 60) : o.x), y: Math.max(0, typeof H === "number" && H > 0 ? Math.min(o.y, H - 60) : o.y) };
})();
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
// Stored by element ID (older builds stored this PC's numbers); resolved once the
// element list is up, from ensureDefaults.
const pinned = new Set();
let _pinRaw = null;
(function loadPins() { const raw = safe(() => window.localStorage.getItem("brandon.sandboxloop.pins")); const a = raw && safe(() => JSON.parse(raw)); if (Array.isArray(a)) _pinRaw = a; })();
function resolvePins() {
	if (!_pinRaw || !palette.length) return;
	const left = [];
	for (const p of _pinRaw) { const t = typeof p === "string" ? typeOfEid(p) : p; if (typeof t === "number") pinned.add(t); else left.push(p); }
	const changed = left.length !== _pinRaw.length || _pinRaw.some((p) => typeof p !== "string");
	_pinRaw = left.length ? left : null;   // ids from a mod that isn't loaded: kept, not lost
	if (changed) savePins();
}
function savePins() { safe(() => window.localStorage.setItem("brandon.sandboxloop.pins", JSON.stringify([...pinned].map((t) => eidOfType(t) || t).concat(_pinRaw || [])))); }
function togglePin(t) { resolvePins(); if (pinned.has(t)) pinned.delete(t); else pinned.add(t); savePins(); if (panelRepaint) panelRepaint((v) => v + 1); }
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
	// "— pick —" is shown while nothing (or a material that isn't in the list) is set; without it
	// the select showed the first material and choosing that one did nothing
	const opts = [h("option", { value: "", key: "_none", disabled: true }, "— pick —")].concat(palette.map((p) => h("option", { value: p.type, key: p.type }, p.name)));
	const onMat = (e) => { if (e.target.value === "") return; cfg.type = +e.target.value; cfg.mat = eidOfType(cfg.type); savePanel(); if (panelRepaint) panelRepaint((v) => v + 1); };
	const onRate = (e) => { cfg.rate = clampRate(e.target.value); savePanel(); if (panelRepaint) panelRepaint((v) => v + 1); };
	const stop = (e) => { if (e.stopPropagation) e.stopPropagation(); };   // keep typing from reaching the game's hotkeys
	return h("div", { style: { display: "flex", alignItems: "center", gap: "7px", margin: "3px 0" } },
		h("span", { style: { width: "58px", color: accent, fontWeight: 700 } }, label),
		h("span", { style: { width: "12px", height: "12px", borderRadius: "3px", background: colorOf(cfg.type), border: "1px solid rgba(255,255,255,.3)", flexShrink: 0 } }),
		h("select", { value: cfg.type == null || !paletteByType.has(cfg.type) ? "" : cfg.type, onChange: onMat, style: { width: "100px", background: "#11161d", color: "#e8edf3", border: "1px solid #37414d", borderRadius: "4px", fontSize: "11px", padding: "2px" } }, opts),
		h("input", { type: "range", min: "0", max: String(RATE_MAX), step: "0.5", value: cfg.rate, onChange: onRate, onInput: onRate, title: "drag for a quick rate; type an exact one in the box", style: { width: "58px" } }),
		h("input", { type: "number", min: "0", max: String(RATE_MAX), step: "0.1", value: cfg.rate, onChange: onRate, onKeyDown: stop, onKeyUp: stop, onKeyPress: stop, title: "particles per second — decimals OK (0.5 = one every 2s), up to " + RATE_MAX,
			style: { width: "52px", background: "#11161d", color: "#e8edf3", border: "1px solid #37414d", borderRadius: "4px", fontSize: "11px", padding: "2px 3px", fontVariantNumeric: "tabular-nums" } }),
		h("span", { style: { fontSize: "10px", color: "#93a1b0" } }, "/s"));
}
// --- placed list: every Source / Remover on the map, what it does, and ✎ to edit or remove it --
let placedOpen = true, placedMsg = "";
let placedEdit = null, placedRm = null;   // which Placed row has its editor open / its remove armed
(function loadPl() { if (safe(() => window.localStorage.getItem("brandon.sandboxloop.placedopen")) === "0") placedOpen = false; })();
function playerCell() { const p = safe(() => sandkit.state.store.player); return p && typeof p.x === "number" ? { x: p.x / 4, y: p.y / 4 } : null; }
function PlacedList() {
	const rows = [];
	for (const s of eachOf(SRC_ID)) rows.push({ s, src: true, c: cfgFor(s, { type: emitCfg.type, rate: emitCfg.rate }) });
	for (const s of eachOf(SNK_ID)) rows.push({ s, src: false, c: cfgFor(s, { type: removeCfg.type, rate: removeCfg.rate }) });
	const unset = rows.filter((r) => r.c && r.c.unset).length;
	const me = playerCell();
	let near = null, nd = Infinity;
	if (me) for (const r of rows) { const d = Math.hypot(r.s.x - me.x, r.s.y - me.y); if (d < nd) { nd = d; near = r; } }
	const head = h("div", { key: "ph", style: Object.assign({}, SUB_HEAD, { cursor: "pointer" }), onClick: (e) => { if (e.stopPropagation) e.stopPropagation(); placedOpen = !placedOpen; safe(() => window.localStorage.setItem("brandon.sandboxloop.placedopen", placedOpen ? "1" : "0")); if (panelRepaint) panelRepaint((v) => v + 1); } },
		h("span", null, (placedOpen ? "▾ " : "▸ ") + "Placed (" + rows.length + ")"),
		unset ? h("span", { style: { fontSize: "9px", color: "#e0b060", fontWeight: 800 } }, unset + " not set") : h("span", { style: SUB_DIM }, "✎ = change this one"));
	if (!placedOpen || !rows.length) return h("div", { key: "placed" }, head);
	const repaint = () => { if (panelRepaint) panelRepaint((v) => v + 1); };
	const stop = (e) => { if (e && e.stopPropagation) e.stopPropagation(); };   // keep clicks / typing away from the game
	const list = rows.map((r) => {
		const k = (r.src ? "s" : "r") + r.s.x + "," + r.s.y;
		const who = (r.src ? "Source " : "Remover ") + r.s.x + "," + r.s.y;
		const open = placedEdit === k, arming = placedRm === k;
		const line = h("div", { key: k, style: { display: "flex", alignItems: "center", gap: "5px", fontSize: "10.5px", margin: "2px 0" } },
			h("span", { style: { width: "50px", color: r.src ? "#8fe0aa" : "#e79b9b", fontWeight: 700 } }, r.src ? "Source" : "Remover"),
			swatch(r.c.type),
			h("span", { style: { flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 700 } },
				nameOf(r.c.type) + " " + fmt1(r.c.rate) + "/s",
				r.c.unset ? h("span", { title: "Nothing is baked into this one, so it follows whatever the panel shows. Press ✎ to give it its own setting.", style: { color: "#e0b060", fontWeight: 800 } }, " · not set") : null),
			h("span", { style: { color: "#7f8b98", fontVariantNumeric: "tabular-nums", fontSize: "9.5px" } }, r.s.x + "," + r.s.y + (r === near ? " ◀ you" : "")),
			h("button", { onClick: (e) => { stop(e); placedEdit = open ? null : k; placedRm = null; repaint(); },
				title: open ? "close" : "change this " + (r.src ? "Source" : "Remover") + "'s material and rate, or remove it",
				style: Object.assign({}, SMBTN, { padding: "1px 6px" }, open ? { background: "#2a3645" } : null) }, open ? "✓" : "✎"));
		if (!open) return line;
		// the editor: this structure's OWN material and rate (changes apply at once), copy the
		// panel's setting, or take it off the map
		const cur = r.c;
		const put = (type, rate) => {
			if (type == null) return;
			bake(r.s, { mat: eidOfType(type), type: type, rate: clampRate(rate) });
			runtime.delete(r.src ? ikey(r.s.x, r.s.y) : "r" + ikey(r.s.x, r.s.y));
			placedMsg = who + " → " + nameOf(type) + " " + fmt1(clampRate(rate)) + "/s"; repaint();
		};
		const opts = [h("option", { value: "", key: "_none", disabled: true }, "— pick —")].concat(palette.map((p) => h("option", { value: p.type, key: p.type }, p.name)));
		const pc = r.src ? emitCfg : removeCfg;
		const editor = h("div", { key: k + "ed", onMouseDown: stop, style: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: "5px", margin: "1px 0 5px 55px", fontSize: "10.5px" } },
			h("select", { value: cur.unset || cur.type == null || !paletteByType.has(cur.type) ? "" : cur.type, onChange: (e) => { if (e.target.value !== "") put(+e.target.value, cur.rate); },
				style: { width: "100px", background: "#11161d", color: "#e8edf3", border: "1px solid #37414d", borderRadius: "4px", fontSize: "11px", padding: "2px" } }, opts),
			h("input", { type: "number", min: "0", max: String(RATE_MAX), step: "0.1", value: cur.rate, onChange: (e) => put(cur.type, e.target.value), onKeyDown: stop, onKeyUp: stop, onKeyPress: stop,
				title: "particles per second — decimals OK, up to " + RATE_MAX,
				style: { width: "52px", background: "#11161d", color: "#e8edf3", border: "1px solid #37414d", borderRadius: "4px", fontSize: "11px", padding: "2px 3px", fontVariantNumeric: "tabular-nums" } }),
			h("span", { style: { fontSize: "10px", color: "#93a1b0" } }, "/s"),
			h("button", { onClick: (e) => { stop(e); placedMsg = applyPanelTo(r.s, r.src) ? (who + " → " + nameOf(pc.type) + " " + fmt1(pc.rate) + "/s") : "pick a material on the panel first"; repaint(); },
				title: "Copy the panel's " + (r.src ? "Source" : "Remover") + " setting (" + nameOf(pc.type) + ", " + fmt1(pc.rate) + "/s) into this one.",
				style: Object.assign({}, SMBTN, { padding: "1px 6px" }) }, "use panel"),
			h("button", { onClick: (e) => { stop(e);
					if (!arming) { placedRm = k; repaint(); return; }   // first click arms, second removes
					const ok = safe(() => { api.structures.removeAtCell(r.s.x, r.s.y); return true; }, false);
					placedRm = null; placedEdit = null; placedMsg = ok ? who + " removed" : "couldn't remove " + who + " — deconstruct it in the game";
					repaint(); },
				title: "Take this " + (r.src ? "Source" : "Remover") + " off the map (click twice)",
				style: Object.assign({}, SMBTN, { padding: "1px 6px", color: "#e79b9b", borderColor: arming ? "#e79b9b" : "#3a4550" }) }, arming ? "sure? remove" : "remove"));
		return [line, editor];
	});
	return h("div", { key: "placed" }, head, list,
		placedMsg ? h("div", { style: { fontSize: "9.5px", color: "#8fb98f", fontWeight: 700 } }, placedMsg) : null);
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
			const present = [...census.entries()].filter((p) => p[1] > 0 && !isTracerType(p[0]));
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
//     that render as blank/red "error" blocks. One call per structure, at its
//     origin cell (the game's removeAt finds the structure covering that cell,
//     and every call walks all ~29k structures — the old three-cells-per-structure
//     sweep tripled that). Only the structure's own cell is named, so a conveyor
//     or machine next door is never removed by accident. The removal is QUEUED
//     for the sim's next idle moment, so it hasn't happened when this returns. --
function clearSandbox() {
	let n = 0;
	for (const id of [SRC_ID, SNK_ID]) {
		for (const s of eachOf(id)) {
			safe(() => api.structures.removeAtCell(s.x, s.y));   // = removeAtCellWhenIdle in the runtime (both queue structures.removeAt for the idle moment)
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
	clearMsg = "queued " + n + (n === 1 ? " structure" : " structures") + " for removal";
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
		saverMsg = r ? ("can't start: " + r) : ("started — build " + (hook.build || "?") + " · press E to exit");
		if (panelRepaint) panelRepaint((v) => v + 1);
	};
	return h("div", { style: { margin: "5px 0 2px" } },
		h("div", { style: { display: "flex", alignItems: "center", gap: "7px" } },
			h("span", { style: { width: "58px", color: "#a9b8e8", fontWeight: 700, lineHeight: 1.1 } }, "Screensaver"),
			h("button", { onClick: go, title: hook ? "Start the screensaver now: HUD and cursor hide, the camera follows a grain through your factory. Press E to exit." : "The Screensaver mod isn't loaded — enable it in the Mods menu and relaunch.",
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
		h("span", null, "Sandbox Loop " + BUILD + (regErr ? "  (err: " + regErr.slice(0, 20) + ")" : "")),
		h("span", { style: { flex: "1 1 auto" } }),
		simPaused ? h("span", { title: "Game is paused: sources, removers, rates, the map scan, the running totals and the history log are all frozen until it resumes.", style: { background: "#3a2f12", color: "#e0b060", fontSize: "9px", fontWeight: 800, letterSpacing: ".06em", padding: "2px 8px", borderRadius: "10px", whiteSpace: "nowrap", flexShrink: 0 } }, "⏸ PAUSED") : null,
		h("button", { title: panelMin ? "expand" : "minimize", onMouseDown: (e) => { if (e.stopPropagation) e.stopPropagation(); }, onClick: (e) => { if (e.stopPropagation) e.stopPropagation(); setMin(!panelMin); }, style: MINBTN }, panelMin ? "▢" : "–"));
}
function Panel() {
	const [, b] = React.useState(0); panelRepaint = b;
	if (!isEnabled() || !inWorld() || saverActive()) return null;
	ensureDefaults();
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
	// never taller than the window: the title bar stays put (drag / minimize) and the rest
	// scrolls inside the panel
	return h("div", { style: Object.assign({}, base, { minWidth: "312px", maxWidth: "340px", display: "flex", flexDirection: "column",
		maxHeight: "max(160px, calc(100vh - " + (Math.max(0, panelPos.y) + 8) + "px))" }) },
		TitleBar(),
		h("div", { style: { flex: "1 1 auto", minHeight: 0, overflowY: "auto", overflowX: "hidden", paddingRight: "4px" } },
			Row("Source", emitCfg, "#8fe0aa"),
			Row("Remover", removeCfg, "#e79b9b"),
			h("div", { style: { marginTop: "5px", fontSize: "10px", color: "#93a1b0", fontWeight: 500 } }, "Set these, then place a Source / Remover — each bakes in the settings shown now. To change or remove one already placed, press ✎ on it below."),
			PlacedList(),
			ThermalRow(),
			ScreensaverRow(),
			Tracker(),
			CleanupRow()));
}
// hook for the Screensaver mod: where the Sources are and what each emits
safe(() => {
	window.__brandonSandboxLoop = {
		sources: () => eachOf(SRC_ID).map((s) => { const c = cfgFor(s, { type: emitCfg.type, rate: emitCfg.rate }); return { x: s.x, y: s.y, type: c.type, rate: c.rate }; }),
		// emit ONE grain of `type` instead of the next normal grain, and report where it landed
		emitOnce: (type, src) => { emitSeq++; emitOnceType = type; emitOnceSrc = src && typeof src.x === "number" ? { x: src.x, y: src.y } : null; emitOnceAt = null; return true; },
		emitOnceResult: () => emitOnceAt,
		cancelEmitOnce: () => { emitSeq++; emitOnceType = null; emitOnceSrc = null; },
	};
});
safe(() => api.ui.inject("brandon-sandboxloop-panel", Panel));
setInterval(() => { if (panelRepaint) panelRepaint((v) => v + 1); }, 1000);

console.log("[" + MOD_ID + "] loaded");
