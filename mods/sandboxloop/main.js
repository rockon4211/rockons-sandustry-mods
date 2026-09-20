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

const SRC_ID = "brandonSandboxSource", SRC_SPRITE = "brandonSandboxSourceSprite";
const SNK_ID = "brandonSandboxSink",   SNK_SPRITE = "brandonSandboxSinkSprite";
const CFG_KEY = "brandon.sandboxloop.instances";   // posKey -> {type,rate}
const PANEL_KEY = "brandon.sandboxloop.panel";     // current panel selections

// --- material palette (same enumeration the Matter Gun uses) ----------------
let palette = [];
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
}
buildPalette();
setTimeout(buildPalette, 3000);
safe(() => api.events.on("game:ready", buildPalette));

function defaultType() {
	if (!palette.length) buildPalette();
	const sand = palette.find((p) => /^sand$/i.test(p.name)) || palette.find((p) => /redsand|sand/i.test(p.name));
	return (sand || palette[0] || { type: null }).type;
}
function nameOf(type) { const p = palette.find((q) => q.type === type); return p ? p.name : ("type " + type); }
function colorOf(type) { const p = palette.find((q) => q.type === type); return p ? p.color : "#8a8a8a"; }

// --- panel config (current selections, baked into the next placed structure) -
let emitCfg = { type: null, rate: 10 };
let removeCfg = { type: null, rate: 8 };
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

// --- throughput tracking (per material type) --------------------------------
// emitTot/rmTot count what the loops ACTUALLY do (a place / delete that found
// room or found the material) — so a choked Source or a starved Remover shows a
// lower effective rate than its configured rate, which is exactly the surplus /
// deficit signal. rate{} smooths those into effective particles/sec.
const emitTot = new Map(), rmTot = new Map();
function bump(m, type) { if (type == null) return; m.set(type, (m.get(type) || 0) + 1); }
const rate = new Map();      // type -> {e, r, _le, _lr}
let lastSample = Date.now();
setInterval(() => {
	const now = Date.now(), dt = Math.max(0.001, (now - lastSample) / 1000); lastSample = now;
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
//     makes — show a real surplus/deficit). Every cell is read for an exact
//     count; the work is time-sliced across ticks so it never stalls a frame,
//     and trend = the change in a material's count from one sweep to the next.
// Exact full-map scan: every cell is read (so narrow/concentrated blobs like a
// prismite column can't be stepped over the way coarse sampling did). It's time-
// sliced — a bounded budget of cells per 100ms tick — so a whole sweep spreads
// over ~SWEEP_SECS and never stalls a frame. Budget adapts to world size.
// Ticks every 50ms. Exact aims to finish a sweep in ~SWEEP_SECS even on a huge
// world (this one is 3840x3840 = 14.7M cells) by reading cells directly in a
// tight loop (no per-cell wrapper); fast samples a ~TARGET-point lattice.
const BUDGET_MAX = 25000, BUDGET_MIN = 4000, SWEEP_SECS = 30, REST_MS = 400;   // exact-mode scan (cells per 50ms tick)
const TARGET = 100000, COARSE_BUDGET = 20000, COARSE_REST = 1200;              // fast-mode coarse sampling
let census = new Map();        // type -> estimated cell count (last full sweep)
let censusTrend = new Map();   // type -> estimated Δ cells / second
let censusInfo = { step: 0, eps: 0, at: 0 };
let censusBase = new Map(), censusBaseAt = 0;   // baseline for the "since reset" running total
let trackerStart = Date.now();                  // when the running totals began
let _prevCensus = new Map(), _prevAt = 0, _restUntil = 0;
let _sweep = null, _acc = new Map(), _cursor = 0;
function censusOn() { return setting("worldCensus", true); }

// --- persist the running totals so they survive a mod/scene reload (they were
//     memory-only, which is why "since reset" kept clearing itself). We restore
//     the cumulative counters, the census baseline and the start time; only the
//     reset button (or the user) zeroes them. -------------------------------
const TOTALS_KEY = "brandon.sandboxloop.totals";
function saveTotals() {
	safe(() => window.localStorage.setItem(TOTALS_KEY, JSON.stringify({ e: [...emitTot], r: [...rmTot], b: [...censusBase], ba: censusBaseAt, st: trackerStart })));
}
(function loadTotals() {
	const raw = safe(() => window.localStorage.getItem(TOTALS_KEY));
	const o = raw && safe(() => JSON.parse(raw));
	if (!o) return;
	if (Array.isArray(o.e)) for (const kv of o.e) emitTot.set(+kv[0], kv[1]);
	if (Array.isArray(o.r)) for (const kv of o.r) rmTot.set(+kv[0], kv[1]);
	if (Array.isArray(o.b)) for (const kv of o.b) censusBase.set(+kv[0], kv[1]);
	if (typeof o.ba === "number") censusBaseAt = o.ba;
	if (typeof o.st === "number") trackerStart = o.st;
})();
setInterval(saveTotals, 4000);   // keep the persisted copy fresh as totals grow
// --- exact vs fast census mode ----------------------------------------------
// fast  = coarse sampling (cheap, ~2s refresh, estimates — can miss thin blobs)
// exact = read every cell (heavier, ~20s refresh, exact — catches everything)
// The "since reset" running total only makes sense with exact counts, so it's
// hidden in fast mode. Default: fast.
let censusExactMode = false;
(function loadExact() { if (safe(() => window.localStorage.getItem("brandon.sandboxloop.exact")) === "1") censusExactMode = true; })();
function censusExact() { return censusExactMode; }
function setExact(v) {
	censusExactMode = !!v;
	safe(() => window.localStorage.setItem("brandon.sandboxloop.exact", censusExactMode ? "1" : "0"));
	// switching modes: throw away the in-progress/last run so estimate and exact
	// counts never mix, and re-baseline the "since reset" from the new mode.
	_sweep = null; _prevAt = 0; _prevCensus = new Map(); census = new Map(); censusTrend = new Map();
	censusBase = new Map(); censusBaseAt = 0; saveTotals();
	censusInfo = { step: 0, eps: 0, at: 0 };   // "first scan not done yet" again — so the progress banner shows for the new mode
	_restUntil = 0;                            // and start the new mode's first sweep immediately
	if (panelRepaint) panelRepaint((x) => x + 1);
}
// watchlist: show only the materials you've pinned (★) instead of the top movers
let censusWatchOnly = false;
(function loadWatch() { if (safe(() => window.localStorage.getItem("brandon.sandboxloop.watch")) === "1") censusWatchOnly = true; })();
function setWatch(v) { censusWatchOnly = !!v; safe(() => window.localStorage.setItem("brandon.sandboxloop.watch", censusWatchOnly ? "1" : "0")); if (panelRepaint) panelRepaint((x) => x + 1); }
function censusProgress() { return _sweep ? Math.min(100, Math.floor((100 * _cursor) / _sweep.total)) : 0; }
setInterval(() => {
	// Not in a state to scan? PAUSE (keep the in-progress sweep) rather than
	// discard it — on a big world a sweep takes tens of seconds, and throwing it
	// away on every brief "not in world" flicker meant it never finished.
	if (!isEnabled() || !inWorld() || !setting("showTracker", true) || !censusOn()) return;
	const now = Date.now();
	const d = safe(() => api.world && api.world.getDimensions()) || {};
	const W = d.widthCells | 0, H = d.heightCells | 0;
	if (W <= 0 || H <= 0) return;
	if (_sweep && (_sweep.W !== W || _sweep.H !== H)) _sweep = null;   // a different world loaded → start over
	if (!_sweep) {
		if (now < _restUntil) return;
		const exact = censusExact();
		let step, cols, total, budget;
		if (exact) {
			step = 1; cols = W; total = W * H;
			budget = Math.min(BUDGET_MAX, Math.max(BUDGET_MIN, Math.ceil(total / (SWEEP_SECS * 20))));
		} else {
			step = Math.max(1, Math.round(Math.sqrt((W * H) / TARGET)));
			cols = Math.ceil(W / step); total = cols * Math.ceil(H / step);
			budget = COARSE_BUDGET;
		}
		_sweep = { W, H, step, cols, total, budget, exact }; _acc = new Map(); _cursor = 0;
	}
	const s = _sweep, el = api.elements, acc = _acc;
	let n = 0;
	// Tight loop: direct calls, one try/catch for the whole batch. The old
	// per-cell safe() wrapper allocated a closure + try/catch per read, which
	// was most of the cost on a 14.7M-cell sweep.
	try {
		while (_cursor < s.total && n < s.budget) {
			const cx = (_cursor % s.cols) * s.step, cy = ((_cursor / s.cols) | 0) * s.step;
			const t = el.getResolvedTypeAtCell(cx, cy);
			if (t !== null && t !== undefined) acc.set(t, (acc.get(t) || 0) + 1);
			_cursor++; n++;
		}
	} catch (e) { _cursor++; }   // skip a bad cell, keep going
	if (_cursor >= s.total) {
		const scale = s.step * s.step, fresh = new Map();
		for (const [t, c] of acc) fresh.set(t, c * scale);
		censusTrend = new Map();
		if (_prevAt) {
			const dt = Math.max(0.001, (now - _prevAt) / 1000);
			const types = new Set(); for (const k of fresh.keys()) types.add(k); for (const k of _prevCensus.keys()) types.add(k);
			for (const t of types) censusTrend.set(t, ((fresh.get(t) || 0) - (_prevCensus.get(t) || 0)) / dt);
		}
		const dtPrev = _prevAt ? Math.max(0.5, (now - _prevAt) / 1000) : 2.4;
		_prevCensus = fresh; _prevAt = now; census = fresh;
		if (!censusBaseAt) { censusBase = new Map(fresh); censusBaseAt = now; saveTotals(); }   // first sweep sets (and persists) the "since reset" baseline
		censusInfo = { exact: s.exact, eps: s.exact ? 0.75 : (scale * 1.5) / dtPrev, at: now };
		_sweep = null; _restUntil = now + (s.exact ? REST_MS : COARSE_REST);
	}
}, 50);
(function loadCfg() {
	const raw = safe(() => window.localStorage.getItem(CFG_KEY));
	const o = raw && safe(() => JSON.parse(raw));
	if (o) for (const k in o) cfgMap.set(k, o[k]);
})();
function saveCfg() { const o = {}; for (const [k, v] of cfgMap) o[k] = v; safe(() => window.localStorage.setItem(CFG_KEY, JSON.stringify(o))); }

safe(() => api.events.on("building:placed", (p) => {
	const s = p && p.structure; if (!s) return;
	if (s.type === SRC_ID) { cfgMap.set(ikey(s.x, s.y), { type: (emitCfg.type != null ? emitCfg.type : defaultType()), rate: emitCfg.rate }); saveCfg(); }
	else if (s.type === SNK_ID) { cfgMap.set(ikey(s.x, s.y), { type: (removeCfg.type != null ? removeCfg.type : defaultType()), rate: removeCfg.rate }); saveCfg(); }
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
function eachOf(id) { const out = []; safe(() => api.structures.forEachOfType(id, (s) => { if (typeof s.x === "number") out.push({ x: s.x, y: s.y }); })); return out; }
function cfgFor(s, fallback) { return cfgMap.get(ikey(s.x, s.y)) || fallback; }

setInterval(() => {
	if (!isEnabled() || !inWorld()) return;
	const now = Date.now();
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
					if (EMPTY !== undefined && t === EMPTY) { safe(() => api.elements.createAtCellWhenIdle(ox, oy, cfg.type)); claimed.add(key); placed = true; bump(emitTot, cfg.type); break; }
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
	if (!isEnabled() || !inWorld()) return;
	const now = Date.now();
	for (const s of eachOf(SNK_ID)) {
		const cfg = cfgFor(s, { type: removeCfg.type, rate: removeCfg.rate });
		if (cfg.type == null || cfg.rate <= 0) continue;
		const k = "r" + ikey(s.x, s.y); let rt = runtime.get(k); if (!rt) { rt = { accum: 0, last: now }; runtime.set(k, rt); }
		const dt = Math.min(now - rt.last, 1000); rt.last = now;
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
	if (!isEnabled() || !inWorld()) return;
	let n = 0;
	safe(() => api.structures.forEachOfType(THERMAL_ID, (s) => {
		n++;
		if (!thermalLock || typeof s.x !== "number") return;
		const t = (s.data && typeof s.data.temperature === "number") ? s.data.temperature : 0;
		const k = ikey(s.x, s.y), pin = thermalPins.get(k);
		if (pin === undefined || Math.abs(t) >= Math.abs(pin)) thermalPins.set(k, t);      // charging up (or first sight): follow it
		else if (t !== pin) safe(() => api.structures.setData(s, { temperature: pin }));   // draining: put it back
	}));
	thermalCount = n;
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
	censusInfo = { step: 0, eps: 0, at: 0 }; _restUntil = 0;
	censusBase = new Map(); censusBaseAt = 0;   // first sweep after the reset sets the baseline
	trackerStart = Date.now();
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
	const onRate = (e) => { cfg.rate = +e.target.value; savePanel(); if (panelRepaint) panelRepaint((v) => v + 1); };
	return h("div", { style: { display: "flex", alignItems: "center", gap: "7px", margin: "3px 0" } },
		h("span", { style: { width: "58px", color: accent, fontWeight: 700 } }, label),
		h("span", { style: { width: "12px", height: "12px", borderRadius: "3px", background: colorOf(cfg.type), border: "1px solid rgba(255,255,255,.3)", flexShrink: 0 } }),
		h("select", { value: cfg.type == null ? "" : cfg.type, onChange: onMat, style: { width: "108px", background: "#11161d", color: "#e8edf3", border: "1px solid #37414d", borderRadius: "4px", fontSize: "11px", padding: "2px" } }, opts),
		h("input", { type: "range", min: "0", max: "60", value: cfg.rate, onChange: onRate, style: { width: "96px" } }),
		h("span", { style: { width: "34px", textAlign: "right", fontVariantNumeric: "tabular-nums" } }, cfg.rate + "/s"));
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
	const eps = censusInfo.eps || 0.75;
	const k = haveMap ? (mapTrend > eps ? "up" : mapTrend < -eps ? "down" : "flat")
	                  : (modNet > 0.3 ? "up" : modNet < -0.3 ? "down" : "flat");
	// what the game itself is doing to it = what we put in − what we took out − what the map gained
	const machines = haveMap ? (modNet - mapTrend) : null;
	let tag = "";
	if (ce > 0 && em < ce * 0.5) tag = "source can't keep up — backing up";
	else if (cr > 0 && rm < cr * 0.5) tag = "remover idle — nothing arriving";
	const ex = censusExact(), since = haveMap ? ((census.get(t) || 0) - (censusBase.get(t) || 0)) : 0;
	const line3 = [];
	if (machines !== null && Math.abs(machines) > 0.3) line3.push(machines > 0 ? ["machines eat ≈ ", cspan("#c7a0e8", fmt1(machines) + "/s")] : ["machines make ≈ ", cspan("#c7a0e8", fmt1(-machines) + "/s")]);
	if (haveMap && ex) line3.push(["since reset: ", cspan(since >= 0 ? "#8fe0aa" : "#e79b9b", fmtSigned(since) + " on map")]);
	else if (haveMap) line3.push([h("span", { style: { color: "#6f7b88" } }, "since-reset total needs EXACT")]);
	else line3.push([h("span", { style: { color: "#6f7b88" } }, "map count pending…")]);
	return h("div", { key: "l_" + t, style: { margin: "6px 0" } },
		h("div", { style: { display: "flex", alignItems: "center", gap: "7px" } }, pinStar(t), swatch(t), nameCell(t), badge(k === "up" ? "SURPLUS" : k === "down" ? "DEFICIT" : "BALANCED", k)),
		h("div", { style: SUBLINE }, "sources ", cspan("#8fe0aa", "+" + fmt1(em) + "/s"), "  removers ", cspan("#e79b9b", "−" + fmt1(rm) + "/s"),
			"  on map ", haveMap ? cspan(kindCol(k), fmtSigned(mapTrend) + "/s") : cspan("#6f7b88", "—")),
		h("div", { style: SUBLINE }, ...line3.flatMap((seg, i) => (i ? ["  ·  "] : []).concat(seg)),
			tag ? h("span", { style: { color: "#e0b060", display: "block" } }, "⚠ " + tag) : null));
}
// one material in the "Whole map" section (sampled count + trend)
function censusRow(t, count, eps) {
	const tr = censusTrend.get(t) || 0, base = censusBase.get(t) || 0, since = count - base;
	const k = tr > eps ? "up" : tr < -eps ? "down" : "flat";
	const rows = [
		h("div", { key: "h", style: { display: "flex", alignItems: "center", gap: "7px" } }, pinStar(t), swatch(t), nameCell(t), badge(k === "up" ? "RISING" : k === "down" ? "FALLING" : "STEADY", k)),
		h("div", { key: "a", style: SUBLINE }, cspan("#c7d0da", fmtCount(count)), " on the map  ·  now ", cspan(kindCol(k), fmtSigned(tr) + "/s")),
	];
	// running total only makes sense with exact counts — hide it in fast mode
	if (censusExact()) rows.push(h("div", { key: "b", style: SUBLINE }, "since reset: ", cspan(since >= 0 ? "#8fe0aa" : "#e79b9b", fmtSigned(since))));
	return h("div", { key: "c_" + t, style: { margin: "6px 0" } }, rows);
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
		h("span", { style: SUB_DIM }, "tracking " + fmtDur(Date.now() - trackerStart)),
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
	kids.push(h("div", { key: "lh", style: SUB_HEAD }, h("span", null, "Your loop"), h("span", { style: SUB_DIM }, "Sources − Removers")));
	if (loopTypes.size === 0) kids.push(h("div", { key: "ln", style: { fontSize: "10px", color: "#93a1b0", fontWeight: 500, margin: "1px 0 2px" } }, "No Source or Remover placed yet."));
	else kids.push(h("div", { key: "lr" }, pinnedFirst([...loopTypes], (t) => t, (a, b) => nameOf(a).localeCompare(nameOf(b))).map((t) => loopRow(t, cfgE, cfgR))));

	// ---- world census: every material actually on the map + its trend ----
	if (censusOn()) {
		const ex = censusExact(), watch = censusWatchOnly, eps = censusInfo.eps || 0;
		kids.push(h("div", { key: "ch", style: SUB_HEAD }, h("span", null, "Whole map"),
			h("span", { style: { display: "flex", gap: "5px", alignItems: "center" } },
				h("button", { onClick: (e) => { if (e.stopPropagation) e.stopPropagation(); setWatch(!watch); },
					title: watch ? "Watchlist: showing ONLY the materials you pinned (★). Tap to show top movers." : "Showing the top movers. Tap to show only your pinned (★) materials.",
					style: pillStyle(watch, "#ffd166", "#3a2f12") }, watch ? "★ WATCH" : "TOP"),
				h("button", { onClick: (e) => { if (e.stopPropagation) e.stopPropagation(); setExact(!ex); },
					title: ex ? "Exact: reads every cell (heavier, ~20s refresh, catches everything). Tap for fast." : "Fast: coarse sampling (cheap, ~2s refresh, can miss thin blobs, no running total). Tap for exact.",
					style: pillStyle(ex, "#8fe0aa", "#16351f") }, ex ? "EXACT ✓" : "FAST"))));
		// live scan status. Exact sweeps take ~30s EVERY time, so always show where
		// the current sweep is; the first one gets a louder banner.
		const scanning = !!_sweep, pct = censusProgress();
		const ago = censusInfo.at ? Math.max(0, Math.round((Date.now() - censusInfo.at) / 1000)) : null;
		if (!censusInfo.at) kids.push(h("div", { key: "cp", style: { fontSize: "10px", color: "#e0b060", fontWeight: 700, margin: "2px 0" } },
			(ex ? "First exact scan of the whole map… " : "First scan… ") + pct + "%" + (ex ? "  (big world — ~30s)" : "")));
		else kids.push(h("div", { key: "cs", style: { fontSize: "9.5px", color: scanning ? "#e0b060" : "#7f8b98", fontWeight: 600, margin: "1px 0 2px", display: "flex", alignItems: "center", gap: "6px" } },
			scanning
				? [h("span", { key: "b", style: { display: "inline-block", width: "90px", height: "5px", background: "#232a31", borderRadius: "3px", overflow: "hidden" } },
						h("span", { style: { display: "block", width: pct + "%", height: "100%", background: "#e0b060" } })),
				   h("span", { key: "t" }, (ex ? "rescanning… " : "sampling… ") + pct + "%")]
				: h("span", null, "counts from " + ago + "s ago" + (ex ? " · next exact scan soon" : ""))));
		if (watch) {
			const pins = [...pinned];
			if (!pins.length) kids.push(h("div", { key: "cw", style: { fontSize: "10px", color: "#93a1b0", fontWeight: 500, margin: "2px 0" } },
				"Watchlist is empty — tap ", h("span", { style: { color: "#ffd166" } }, "★"), " on any material to add it (it'll show here even at 0)."));
			else {
				const rows = pins.map((t) => [t, census.get(t) || 0]).sort((a, b) => nameOf(a[0]).localeCompare(nameOf(b[0])));
				kids.push(h("div", { key: "cr", style: { maxHeight: "320px", overflowY: "auto" } }, rows.map((p) => censusRow(p[0], p[1], eps))));
			}
		} else if (!census.size) {
			if (censusInfo.at) kids.push(h("div", { key: "cn", style: { fontSize: "10px", color: "#93a1b0", fontWeight: 500 } }, "No loose material found on the map."));
		} else {
			const present = [...census.entries()].filter((p) => p[1] > 0);
			const ordered = pinnedFirst(present, (p) => p[0], (a, b) => (Math.abs(censusTrend.get(b[0]) || 0) - Math.abs(censusTrend.get(a[0]) || 0)) || (b[1] - a[1]));
			const pinnedCount = ordered.filter((p) => pinned.has(p[0])).length;
			const top = ordered.slice(0, Math.max(12, pinnedCount));   // always keep every pinned row visible
			kids.push(h("div", { key: "cr", style: { maxHeight: "260px", overflowY: "auto" } }, top.map((p) => censusRow(p[0], p[1], eps))));
			if (present.length > top.length) kids.push(h("div", { key: "cm", style: { fontSize: "9px", color: "#7f8b98", marginTop: "2px" } }, "+" + (present.length - top.length) + " more, near steady — pin them or use ★ WATCH"));
		}
		kids.push(h("div", { key: "ce", style: { fontSize: "9px", color: "#6f7b88", marginTop: "4px", lineHeight: 1.5 } },
			ex ? "Exact scans every material on the map (~20s)." : "Fast sampled estimate — running totals hidden (they'd be inexact).",
			"  Tap ", h("span", { style: { color: "#ffd166" } }, "★"), watch ? " to add/remove from the watchlist." : " to pin; ★ WATCH shows only pinned."));
	}
	return h("div", null, kids);
}

// --- cleanup: remove every Source/Remover the mod knows about, including ones
//     that render as blank/red "error" blocks (forEachOfType still finds them by
//     type, and we hit a spread of footprint cells so it works whatever shape —
//     basin, block, zone or tray — placed them). This is the reliable way to
//     clear Removers you can't click on. ---------------------------------------
function clearSandbox() {
	let n = 0;
	for (const id of [SRC_ID, SNK_ID]) {
		for (const s of eachOf(id)) {
			const cells = [[s.x, s.y], [s.x + 1, s.y + 1], [s.x + 3, s.y + 3], [s.x + 6, s.y + 6], [s.x + 11, s.y + 11], [s.x, s.y + 10], [s.x + 6, s.y + 11]];
			for (const c of cells) safe(() => api.structures.removeAtCellWhenIdle(c[0], c[1]));
			cfgMap.delete(ikey(s.x, s.y));
			n++;
		}
	}
	saveCfg();
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
const MINBTN = { background: "#1c2530", color: "#cdd6df", border: "1px solid #3a4550", borderRadius: "5px", fontSize: "13px", fontWeight: 800, lineHeight: 1, padding: "2px 9px", cursor: "pointer", flexShrink: 0 };
function TitleBar() {
	return h("div", { onMouseDown: startDrag, title: "drag to move", style: { fontWeight: 800, marginBottom: "4px", letterSpacing: ".02em", cursor: _drag ? "grabbing" : "grab", userSelect: "none", display: "flex", alignItems: "center", gap: "7px" } },
		h("span", { style: { color: "#5b6470", fontSize: "13px", lineHeight: 1 } }, "⠿"),
		h("span", null, "Sandbox Loop" + (regErr ? "  (err: " + regErr.slice(0, 20) + ")" : "")),
		h("span", { style: { flex: "1 1 auto" } }),
		h("button", { title: panelMin ? "expand" : "minimize", onMouseDown: (e) => { if (e.stopPropagation) e.stopPropagation(); }, onClick: (e) => { if (e.stopPropagation) e.stopPropagation(); setMin(!panelMin); }, style: MINBTN }, panelMin ? "▢" : "–"));
}
function Panel() {
	const [, b] = React.useState(0); panelRepaint = b;
	if (!isEnabled() || !inWorld()) return null;
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
		Tracker(),
		CleanupRow());
}
safe(() => api.ui.inject("brandon-sandboxloop-panel", Panel));
setInterval(() => { if (panelRepaint) panelRepaint((v) => v + 1); }, 1000);

console.log("[" + MOD_ID + "] loaded");
