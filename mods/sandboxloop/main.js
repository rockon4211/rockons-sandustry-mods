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

// --- world census (samples the WHOLE map so materials the loop never touches —
//     water, steam, gold, anything the game itself makes — still show a real
//     surplus/deficit). Cost is bounded no matter how big the world is: each
//     sweep reads a fixed ~TARGET coarse lattice points, time-sliced a few
//     thousand per 150ms tick, with a rest between sweeps. Trend = the change in
//     a material's estimated count from one completed sweep to the next.
const TARGET = 16000, BUDGET = 3000, REST_MS = 1500;
let census = new Map();        // type -> estimated cell count (last full sweep)
let censusTrend = new Map();   // type -> estimated Δ cells / second
let censusInfo = { step: 0, eps: 0, at: 0 };
let _prevCensus = new Map(), _prevAt = 0, _restUntil = 0;
let _sweep = null, _acc = new Map(), _cursor = 0;
function censusOn() { return setting("worldCensus", true); }
setInterval(() => {
	if (!isEnabled() || !inWorld() || !setting("showTracker", true) || !censusOn()) { _sweep = null; return; }
	const now = Date.now();
	if (!_sweep) {
		if (now < _restUntil) return;
		const d = safe(() => api.world && api.world.getDimensions()) || {};
		const W = d.widthCells | 0, H = d.heightCells | 0;
		if (W <= 0 || H <= 0) { _restUntil = now + 500; return; }
		const step = Math.max(1, Math.round(Math.sqrt((W * H) / TARGET)));
		const cols = Math.ceil(W / step), rows = Math.ceil(H / step);
		_sweep = { step, cols, total: cols * rows }; _acc = new Map(); _cursor = 0;
	}
	const { step, cols, total } = _sweep;
	let n = 0;
	while (_cursor < total && n < BUDGET) {
		const cx = (_cursor % cols) * step, cy = ((_cursor / cols) | 0) * step;
		const t = safe(() => api.elements.getResolvedTypeAtCell(cx, cy));
		if (t !== null && t !== undefined) _acc.set(t, (_acc.get(t) || 0) + 1);
		_cursor++; n++;
	}
	if (_cursor >= total) {
		const scale = step * step, fresh = new Map();
		for (const [t, c] of _acc) fresh.set(t, c * scale);
		censusTrend = new Map();
		if (_prevAt) {
			const dt = Math.max(0.001, (now - _prevAt) / 1000);
			const types = new Set(); for (const k of fresh.keys()) types.add(k); for (const k of _prevCensus.keys()) types.add(k);
			for (const t of types) censusTrend.set(t, ((fresh.get(t) || 0) - (_prevCensus.get(t) || 0)) / dt);
		}
		const dtPrev = _prevAt ? Math.max(0.5, (now - _prevAt) / 1000) : 2.4;
		_prevCensus = fresh; _prevAt = now; census = fresh;
		censusInfo = { step, eps: (scale * 1.5) / dtPrev, at: now };
		_sweep = null; _restUntil = now + REST_MS;
	}
}, 150);
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
const SHAPE_SNK = [
	[0,0,0,0,0,0,0,0,0,0,0,0],[1,1,0,0,0,0,0,0,0,0,1,1],[1,1,0,0,0,0,0,0,0,0,1,1],
	[1,1,0,0,0,0,0,0,0,0,1,1],[1,1,0,0,0,0,0,0,0,0,1,1],[1,1,0,0,0,0,0,0,0,0,1,1],
	[1,1,0,0,0,0,0,0,0,0,1,1],[1,1,0,0,0,0,0,0,0,0,1,1],[1,1,0,0,0,0,0,0,0,0,1,1],
	[1,1,0,0,0,0,0,0,0,0,1,1],[1,1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1,1],
];
let regErr = "";
(async () => {
	try { await api.sprites.loadFromMod(SRC_SPRITE, "source.png"); await api.sprites.loadFromMod(SNK_SPRITE, "sink.png"); }
	catch (e) { regErr = "sprites"; console.error("[" + MOD_ID + "] sprites failed:", e); }
	try {
		api.structures.register({ id: SRC_ID, name: "Source", description: "Emits the material shown on the Sandbox panel when you place it, at the set particles/sec.", categoryKey: "special", buildModes: [{ type: "single" }], variants: [{ id: SRC_ID, angles: [0] }], render: { imageName: SRC_SPRITE, size: { width: 48, height: 48 }, offset: { x: 0, y: 0 }, ui: { outline: true } }, shape: SHAPE_SRC, defaultData: {} });
		api.structures.register({ id: SNK_ID, name: "Remover", description: "Deletes the material shown on the Sandbox panel (only that one) at the set rate, when it pools in the basin.", categoryKey: "special", buildModes: [{ type: "single" }], variants: [{ id: SNK_ID, angles: [0] }], render: { imageName: SNK_SPRITE, size: { width: 48, height: 48 }, offset: { x: 0, y: 0 }, ui: { outline: true } }, shape: SHAPE_SNK, defaultData: {} });
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
		rt.accum += (cfg.rate * dt) / 1000; if (rt.accum > 12) rt.accum = 12;
		let guard = 0;
		while (rt.accum >= 1 && guard < 40) {
			guard++; let removed = false;
			for (let x = s.x + 2; x <= s.x + 9 && !removed; x++) {
				for (let y = s.y; y <= s.y + 9 && !removed; y++) {
					const key = x + "," + y; if ((rmRecent.get(key) || 0) > now) continue;
					if (safe(() => api.elements.getResolvedTypeAtCell(x, y)) === cfg.type) {
						safe(() => api.elements.removeAtCellWhenIdle(x, y)); rmRecent.set(key, now + 500); removed = true; bump(rmTot, cfg.type);
					}
				}
			}
			if (!removed) break;
			rt.accum -= 1;
		}
	}
	if (rmRecent.size > 512) { for (const [k, exp] of rmRecent) if (exp < now) rmRecent.delete(k); }
}, 150);

// --- config panel (interactive) ---------------------------------------------
let panelRepaint = null;
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
const SUB_HEAD = { marginTop: "6px", marginBottom: "1px", fontWeight: 800, fontSize: "11px", display: "flex", justifyContent: "space-between", alignItems: "baseline", color: "#cdd6df" };
const SUB_DIM = { fontSize: "9px", color: "#7f8b98", fontWeight: 600 };
function swatch(t) { return h("span", { style: { width: "11px", height: "11px", borderRadius: "3px", background: colorOf(t), border: "1px solid rgba(255,255,255,.3)", flexShrink: 0 } }); }
function nameCell(t) { return h("span", { style: { flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, nameOf(t)); }
// one row of the "your loop" section (mod emit/remove throughput)
function loopRow(t, cfgE, cfgR) {
	const s = rate.get(t) || { e: 0, r: 0 }, em = s.e, rm = s.r, net = em - rm;
	const ce = cfgE.get(t) || 0, cr = cfgR.get(t) || 0;
	let verdict, vcol;
	if (net > 0.3) { verdict = "SURPLUS ↑"; vcol = "#8fe0aa"; }
	else if (net < -0.3) { verdict = "DEFICIT ↓"; vcol = "#e79b9b"; }
	else { verdict = "balanced"; vcol = "#c7d0da"; }
	let tag = "";
	if (ce > 0 && em < ce * 0.5) tag = "source backed up";
	else if (cr > 0 && rm < cr * 0.5) tag = "remover starved";
	return h("div", { key: "l_" + t, style: { margin: "3px 0" } },
		h("div", { style: { display: "flex", alignItems: "center", gap: "6px" } },
			swatch(t), nameCell(t),
			h("span", { style: { color: "#8fe0aa", width: "44px", textAlign: "right", fontVariantNumeric: "tabular-nums" } }, "+" + fmt1(em)),
			h("span", { style: { color: "#e79b9b", width: "44px", textAlign: "right", fontVariantNumeric: "tabular-nums" } }, "−" + fmt1(rm)),
			h("span", { style: { color: vcol, fontWeight: 800, width: "52px", textAlign: "right", fontVariantNumeric: "tabular-nums" } }, (net >= 0 ? "+" : "") + fmt1(net))),
		h("div", { style: { display: "flex", justifyContent: "space-between", fontSize: "9px", fontWeight: 600, marginLeft: "17px" } },
			h("span", { style: { color: vcol } }, verdict),
			h("span", { style: { color: "#7f8b98" } }, tag || ("target +" + fmt1(ce) + " / −" + fmt1(cr)))));
}
// one row of the "world census" section (sampled whole-map count + trend)
function censusRow(t, count, eps) {
	const tr = censusTrend.get(t) || 0;
	let col = "#c7d0da", arrow = "–", word = "steady";
	if (tr > eps) { col = "#8fe0aa"; arrow = "▲"; word = "surplus"; }
	else if (tr < -eps) { col = "#e79b9b"; arrow = "▼"; word = "deficit"; }
	return h("div", { key: "c_" + t, style: { display: "flex", alignItems: "center", gap: "6px", margin: "2px 0" } },
		swatch(t), nameCell(t),
		h("span", { style: { width: "42px", textAlign: "right", color: "#c7d0da", fontVariantNumeric: "tabular-nums" } }, "~" + fmtCount(count)),
		h("span", { title: word, style: { width: "74px", textAlign: "right", color: col, fontWeight: 800, fontVariantNumeric: "tabular-nums" } }, arrow + " " + (tr >= 0 ? "+" : "−") + fmtCount(tr) + "/s"));
}
function Tracker() {
	if (!setting("showTracker", true)) return null;
	const header = h("div", {
		onClick: () => { trackerOpen = !trackerOpen; safe(() => window.localStorage.setItem("brandon.sandboxloop.tkopen", trackerOpen ? "1" : "0")); if (panelRepaint) panelRepaint((v) => v + 1); },
		style: { marginTop: "7px", paddingTop: "6px", borderTop: "1px solid rgba(255,255,255,.12)", display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", userSelect: "none" },
	},
		h("span", { style: { display: "inline-block", transform: trackerOpen ? "rotate(90deg)" : "none", fontSize: "9px", color: "#93a1b0" } }, "▶"),
		h("span", { style: { fontWeight: 800 } }, "Balance"),
		h("span", { style: { fontSize: "10px", color: "#93a1b0", fontWeight: 600 } }, "surplus / deficit"));
	if (!trackerOpen) return header;
	const kids = [header];

	// ---- your loop: what the Sources/Removers actually push, per material ----
	const { e: cfgE, r: cfgR } = cfgTotals();
	const loopTypes = new Set(); for (const k of cfgE.keys()) loopTypes.add(k); for (const k of cfgR.keys()) loopTypes.add(k);
	kids.push(h("div", { key: "lh", style: SUB_HEAD }, h("span", null, "Your loop"), h("span", { style: SUB_DIM }, "emit − remove /s")));
	if (loopTypes.size === 0) kids.push(h("div", { key: "ln", style: { fontSize: "10px", color: "#93a1b0", fontWeight: 500, margin: "1px 0 2px" } }, "No Source or Remover placed yet."));
	else kids.push(h("div", { key: "lr" }, [...loopTypes].sort((a, b) => nameOf(a).localeCompare(nameOf(b))).map((t) => loopRow(t, cfgE, cfgR))));

	// ---- world census: every material actually on the map + its trend ----
	if (censusOn()) {
		const present = [...census.entries()].filter((p) => p[1] > 0);
		kids.push(h("div", { key: "ch", style: SUB_HEAD }, h("span", null, "World census"),
			h("span", { style: SUB_DIM }, censusInfo.at ? "all materials · sampled ≈2s" : "scanning…")));
		if (!present.length) kids.push(h("div", { key: "cn", style: { fontSize: "10px", color: "#93a1b0", fontWeight: 500 } }, "Scanning the map… (first read takes a moment)"));
		else {
			const eps = censusInfo.eps || 0;
			present.sort((a, b) => (Math.abs(censusTrend.get(b[0]) || 0) - Math.abs(censusTrend.get(a[0]) || 0)) || (b[1] - a[1]));
			const top = present.slice(0, 14);
			kids.push(h("div", { key: "cr", style: { maxHeight: "196px", overflowY: "auto" } }, top.map((p) => censusRow(p[0], p[1], eps))));
			if (present.length > top.length) kids.push(h("div", { key: "cm", style: { fontSize: "9px", color: "#7f8b98", marginTop: "2px" } }, "+" + (present.length - top.length) + " more, near steady"));
			kids.push(h("div", { key: "ce", style: { fontSize: "9px", color: "#6f7b88", marginTop: "3px" } }, "~ = estimated from sampling; watch the arrow (trend), not the exact number."));
		}
	}
	return h("div", null, kids);
}

function Panel() {
	const [, b] = React.useState(0); panelRepaint = b;
	if (!isEnabled() || !inWorld()) return null;
	if (emitCfg.type == null) emitCfg.type = defaultType();
	if (removeCfg.type == null) removeCfg.type = defaultType();
	return h("div", {
		style: {
			position: "fixed", left: "12px", top: "84px", zIndex: 99998, pointerEvents: "auto",
			background: "rgba(10,14,20,0.94)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: "8px",
			padding: "8px 10px", font: '600 12px -apple-system,"Segoe UI",Roboto,sans-serif', color: "#e8edf3",
			boxShadow: "0 4px 16px rgba(0,0,0,.5)", minWidth: "312px",
		},
	},
		h("div", { style: { fontWeight: 800, marginBottom: "4px", letterSpacing: ".02em" } }, "Sandbox Loop" + (regErr ? "  (err: " + regErr.slice(0, 20) + ")" : "")),
		Row("Source", emitCfg, "#8fe0aa"),
		Row("Remover", removeCfg, "#e79b9b"),
		h("div", { style: { marginTop: "5px", fontSize: "10px", color: "#93a1b0", fontWeight: 500 } }, "Set these, then place a Source / Remover — each bakes in the settings shown now."),
		Tracker());
}
safe(() => api.ui.inject("brandon-sandboxloop-panel", Panel));
setInterval(() => { if (panelRepaint) panelRepaint((v) => v + 1); }, 1000);

console.log("[" + MOD_ID + "] loaded");
