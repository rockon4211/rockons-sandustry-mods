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
		rt.accum += (cfg.rate * dt) / 1000; if (rt.accum > 8) rt.accum = 8;
		const EMPTY = safe(() => api.elements.getResolvedTypeAtCell(s.x + 6, s.y - 6));
		let guard = 0;
		while (rt.accum >= 1 && guard < 20) {
			guard++; let placed = false;
			for (const ox of [s.x + 5, s.x + 6]) {
				for (let oy = s.y + 11; oy <= s.y + 40 && !placed; oy++) {
					const t = safe(() => api.elements.getResolvedTypeAtCell(ox, oy));
					if (EMPTY !== undefined && t === EMPTY) { safe(() => api.elements.createAtCellWhenIdle(ox, oy, cfg.type)); placed = true; bump(emitTot, cfg.type); }
				}
				if (placed) break;
			}
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
function Tracker() {
	if (!setting("showTracker", true)) return null;
	const header = h("div", {
		onClick: () => { trackerOpen = !trackerOpen; safe(() => window.localStorage.setItem("brandon.sandboxloop.tkopen", trackerOpen ? "1" : "0")); if (panelRepaint) panelRepaint((v) => v + 1); },
		style: { marginTop: "7px", paddingTop: "6px", borderTop: "1px solid rgba(255,255,255,.12)", display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", userSelect: "none" },
	},
		h("span", { style: { display: "inline-block", transform: trackerOpen ? "rotate(90deg)" : "none", fontSize: "9px", color: "#93a1b0" } }, "▶"),
		h("span", { style: { fontWeight: 800 } }, "Balance"),
		h("span", { style: { fontSize: "10px", color: "#93a1b0", fontWeight: 600 } }, "emit − remove, live /s"));
	if (!trackerOpen) return header;
	const { e: cfgE, r: cfgR } = cfgTotals();
	const types = new Set(); for (const k of cfgE.keys()) types.add(k); for (const k of cfgR.keys()) types.add(k);
	if (types.size === 0)
		return h("div", null, header, h("div", { style: { fontSize: "10px", color: "#93a1b0", fontWeight: 500, margin: "4px 0 2px" } }, "Place a Source or Remover to see each material's surplus / deficit here."));
	const rows = [...types].sort((a, b) => nameOf(a).localeCompare(nameOf(b))).map((t) => {
		const s = rate.get(t) || { e: 0, r: 0 };
		const em = s.e, rm = s.r, net = em - rm;
		const ce = cfgE.get(t) || 0, cr = cfgR.get(t) || 0;
		let verdict, vcol;
		if (net > 0.3) { verdict = "SURPLUS ↑"; vcol = "#8fe0aa"; }
		else if (net < -0.3) { verdict = "DEFICIT ↓"; vcol = "#e79b9b"; }
		else { verdict = "balanced"; vcol = "#c7d0da"; }
		let tag = "";
		if (ce > 0 && em < ce * 0.5) tag = "source backed up";
		else if (cr > 0 && rm < cr * 0.5) tag = "remover starved";
		return h("div", { key: t, style: { margin: "3px 0" } },
			h("div", { style: { display: "flex", alignItems: "center", gap: "6px" } },
				h("span", { style: { width: "11px", height: "11px", borderRadius: "3px", background: colorOf(t), border: "1px solid rgba(255,255,255,.3)", flexShrink: 0 } }),
				h("span", { style: { flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, nameOf(t)),
				h("span", { style: { color: "#8fe0aa", width: "44px", textAlign: "right", fontVariantNumeric: "tabular-nums" } }, "+" + fmt1(em)),
				h("span", { style: { color: "#e79b9b", width: "44px", textAlign: "right", fontVariantNumeric: "tabular-nums" } }, "−" + fmt1(rm)),
				h("span", { style: { color: vcol, fontWeight: 800, width: "52px", textAlign: "right", fontVariantNumeric: "tabular-nums" } }, (net >= 0 ? "+" : "") + fmt1(net))),
			h("div", { style: { display: "flex", justifyContent: "space-between", fontSize: "9px", fontWeight: 600, marginLeft: "17px" } },
				h("span", { style: { color: vcol } }, verdict),
				h("span", { style: { color: "#7f8b98" } }, tag || ("target +" + fmt1(ce) + " / −" + fmt1(cr)))));
	});
	return h("div", null, header, h("div", { style: { maxHeight: "184px", overflowY: "auto", marginTop: "3px" } }, rows));
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
