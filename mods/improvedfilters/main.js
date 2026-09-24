// Improved Filter Options - a clipboard for filter settings.
//
// A filter's settings are the `filter` object the game keeps on the structure
// ({mode: allow|block, elementType: one number or a list, affectsLiquid, affectsGas,
// density}). Every kind of filter carries the same object - Mk.1, Mk.2, the Mk.3 from
// the Manufacturing mod, and the filter walls - so settings copied from one kind fit
// any other. COPY reads that object off a placed filter; PASTE writes it onto a whole
// row (every joined filter of the same kind and setting, the game's own row rule)
// through the game's own updateMany, which is what its Mk.2 row editor uses; NEW
// FILTERS writes it into store.options.defaultFilter, the setting the Mk.2 / Mk.3
// panels edit and every new Mk.2 / Mk.3 takes when placed.
//
// The clipboard is saved by material id (names like "water"), never by the number the
// game gives a material - those differ between PCs and mod sets.
const api = sandkit.api;
const MOD_ID = "brandon.improvedfilters";
const BUILD = "0.1.0";
function safe(fn, fb) { try { return fn(); } catch (e) { return fb; } }
function setting(name, fb) { const v = safe(() => api.settings.get(name)); if (typeof fb === "boolean") return typeof v === "boolean" ? v : fb; return v === undefined ? fb : v; }
const isEnabled = () => setting("enabled", true);
const Scene = safe(() => sandkit.enums.Scene) || {};
function inWorld() {
	const a = safe(() => api.scene.getActive()); if (a === undefined || a === null) return true;
	const menus = [Scene.MainMenu, Scene.Intro].filter((v) => typeof v === "number");
	return menus.length ? !menus.includes(a) : a > 2;
}
const ReactM = safe(() => sandkit.react), h = ReactM ? ReactM.createElement : null;

// --- materials: numbers <-> ids ---------------------------------------------------
const typeCache = new Map(), idCache = new Map();
function typeOfEid(id) { if (!id) return undefined; if (typeCache.has(id)) return typeCache.get(id); const t = safe(() => api.elements.getTypeFromId(id)); if (typeof t === "number") typeCache.set(id, t); return t; }
function eidOfType(t) { if (typeof t !== "number") return undefined; if (idCache.has(t)) return idCache.get(t); const id = safe(() => api.elements.getIdByType(t)); if (id) idCache.set(t, id); return id; }
const nameOf = (t) => safe(() => api.elements.getNameByType(t), null) || ("type " + t);
function colorOf(t) { const mc = safe(() => api.elements.getDefinitionByType(t).metaColor); return typeof mc === "number" ? `rgb(${mc >> 16 & 255}, ${mc >> 8 & 255}, ${mc & 255})` : "#888888"; }
const asList = (v) => Array.isArray(v) ? v.filter((x) => typeof x === "number") : typeof v === "number" ? [v] : [];

// --- the clipboard ------------------------------------------------------------------
const CLIP_KEY = "brandon.improvedfilters.clip";
let clip = null;   // the filter object, in this PC's numbers
function cloneFilter(f) {
	const o = Object.assign({}, f || { mode: "allow" });
	if (Array.isArray(o.elementType)) o.elementType = o.elementType.slice();
	if (Array.isArray(o.speedExemptElementTypes)) o.speedExemptElementTypes = o.speedExemptElementTypes.slice();
	return o;
}
function saveClip() {
	if (!clip) { safe(() => window.localStorage.removeItem(CLIP_KEY)); return; }
	const ids = asList(clip.elementType).map(eidOfType).filter(Boolean);
	const exempt = asList(clip.speedExemptElementTypes).map(eidOfType).filter(Boolean);
	safe(() => window.localStorage.setItem(CLIP_KEY, JSON.stringify({ mode: clip.mode || "allow", ids, single: !Array.isArray(clip.elementType), affectsLiquid: !!clip.affectsLiquid, affectsGas: !!clip.affectsGas, density: clip.density, exempt })));
}
function loadClip() {
	const raw = safe(() => window.localStorage.getItem(CLIP_KEY)), o = raw && safe(() => JSON.parse(raw));
	if (!o || !Array.isArray(o.ids)) return;
	const types = o.ids.map(typeOfEid).filter((t) => typeof t === "number");   // a material from a mod that isn't loaded is dropped
	if (!types.length && o.ids.length) return;
	clip = { mode: o.mode === "block" ? "block" : "allow", elementType: o.single && types.length === 1 ? types[0] : types, affectsLiquid: !!o.affectsLiquid, affectsGas: !!o.affectsGas };
	if (typeof o.density === "number") clip.density = o.density;
	const ex = (o.exempt || []).map(typeOfEid).filter((t) => typeof t === "number"); if (ex.length) clip.speedExemptElementTypes = ex;
}
// materials only resolve once the world has registered them: try until they do
let clipLoaded = false;
setInterval(() => { if (clipLoaded || !inWorld()) return; loadClip(); clipLoaded = true; repaint(); }, 1500);

// --- filters on the map ------------------------------------------------------------
const ST = safe(() => sandkit.enums.StructureType) || {};
const FILTER_IDS = new Set([ST.FilterLeft, ST.FilterRight, "filterLeftMk2", "filterRightMk2", "filterWall", "filterWallMk2", "filterLeftMk3", "filterRightMk3"].filter((v) => v !== undefined));
const WALLS = new Set(["filterWall", "filterWallMk2"]);
const isFilter = (s) => !!s && ((s.filter && typeof s.filter === "object") || FILTER_IDS.has(s.type));
const filterKey = (s) => { const f = s.filter || {}; return [s.type, f.mode || "allow", asList(f.elementType).slice().sort((a, b) => a - b).join(","), f.affectsLiquid ? 1 : 0, f.affectsGas ? 1 : 0, f.density || 0].join("_"); };
// the whole row joined to the filter at x,y: same kind, same setting, touching - the
// game's own rule for its row editor (walls join vertically)
function rowAt(x, y) {
	const at = (cx, cy) => safe(() => api.structures.getAtCell(cx, cy));
	const s0 = at(x, y); if (!isFilter(s0)) return null;
	const N = 4, k = filterKey(s0), vert = WALLS.has(s0.type);
	const same = (s) => !!s && s.type === s0.type && filterKey(s) === k && (vert ? s.x === s0.x : s.y === s0.y);
	let x0 = s0.x, y0 = s0.y;
	if (vert) { while (y0 - N >= 0 && same(at(x0, y0 - N))) y0 -= N; } else { while (x0 - N >= 0 && same(at(x0 - N, y0))) x0 -= N; }
	const members = [];
	for (let i = 0; i < 4096; i++) { const s = at(vert ? x0 : x0 + i * N, vert ? y0 + i * N : y0); if (!same(s)) break; members.push(s); }
	return { members, type: s0.type, x: s0.x, y: s0.y };
}
const kindName = (t) => t === ST.FilterLeft || t === ST.FilterRight ? "Filter" : t === "filterLeftMk2" || t === "filterRightMk2" ? "Filter Mk.2" : t === "filterLeftMk3" || t === "filterRightMk3" ? "Filter Mk.3" : t === "filterWall" ? "Filter wall" : t === "filterWallMk2" ? "Filter wall Mk.2" : String(t);
function describe(f) { const l = asList(f && f.elementType); return (l.length ? l.map(nameOf).join(" / ") : "no material") + " · " + ((f && f.mode) === "block" ? "block" : "allow"); }

// --- copy / paste / new filters -------------------------------------------------------
let msg = "", mode = null;   // mode: "copy" | "paste" | null (armed: the next click on a filter does it)
function setNewFilters() {
	if (!clip) return false;
	const ok = safe(() => { const st = sandkit.state; st.store.options.defaultFilter = cloneFilter(clip);
		const cd = st.session.action.customData; if (cd && cd.copiedStructure && cd.copiedStructure.filter) cd.copiedStructure.filter = undefined;   // as the panel does: a copied structure's own filter no longer applies
		return true; }, false);
	return ok;
}
function newFiltersMatch() { const df = safe(() => sandkit.state.store.options.defaultFilter); return !!clip && !!df && filterKey({ type: 0, filter: df }) === filterKey({ type: 0, filter: clip }); }
function doCopy(row) {
	clip = cloneFilter(row.members[0].filter); saveClip();
	const forNew = setting("copyAlsoSetsNew", true) && setNewFilters();
	msg = "copied " + kindName(row.type) + " (" + row.members.length + "): " + describe(clip) + (forNew ? " — new filters take it" : "");
	safe(() => api.ui.toast("Copied filter settings: " + describe(clip)));
}
function doPaste(row) {
	if (!clip) { msg = "nothing copied yet"; return; }
	for (const s of row.members) s.filter = Object.assign({}, s.filter || {}, cloneFilter(clip));
	const ok = safe(() => { sandkit.engine.api.structures.updateMany(sandkit.engine.state, row.members, { propagateToWorkers: true }); return true; }, false);
	msg = ok ? "pasted onto " + kindName(row.type) + " (" + row.members.length + "): " + describe(clip) : "couldn't write the row";
	if (ok) safe(() => api.ui.toast("Pasted filter settings onto " + row.members.length + " " + kindName(row.type) + (row.members.length === 1 ? "" : "s")));
}
let cursorStyle = null;
function arm(m) {
	mode = m;
	if (cursorStyle) { safe(() => cursorStyle.remove()); cursorStyle = null; }
	if (m) { safe(() => { cursorStyle = document.createElement("style"); cursorStyle.textContent = "*{cursor:" + (m === "copy" ? "copy" : "cell") + " !important}"; document.head.appendChild(cursorStyle); }); }
	msg = m === "copy" ? "click a placed filter to copy its settings (Esc cancels)" : m === "paste" ? "click a placed filter to paste onto that whole row (Esc cancels)" : msg;
	repaint();
}
// the armed click: taken before the game sees it (capture), so nothing gets built or grabbed
let swallowUntil = 0;
safe(() => {
	const block = { capture: true, passive: false };
	const eat = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };
	window.addEventListener("mousedown", (e) => {
		if (!mode) return;
		if (e.target && e.target.closest && e.target.closest("[data-brandon-ifo]")) return;   // our own panel
		if (e.button === 2) { eat(e); swallowUntil = Date.now() + 400; arm(null); msg = "cancelled"; repaint(); return; }
		if (e.button !== 0) return;
		eat(e); swallowUntil = Date.now() + 400;
		const cp = safe(() => sandkit.state.session.input.mouse.cellPosition);
		const row = cp ? rowAt(Math.floor(cp.x), Math.floor(cp.y)) : null;
		const m = mode; arm(null);
		if (!row) { msg = "that isn't a filter — " + (m === "copy" ? "copy" : "paste") + " cancelled"; repaint(); return; }
		if (m === "copy") doCopy(row); else doPaste(row);
		repaint();
	}, block);
	for (const t of ["pointerdown", "pointerup", "mouseup", "click", "contextmenu"]) window.addEventListener(t, (e) => {
		if (!mode && Date.now() > swallowUntil) return;
		if (e.target && e.target.closest && e.target.closest("[data-brandon-ifo]")) return;
		if (mode && t === "pointerdown" && e.button !== 0 && e.button !== 2) return;
		eat(e);
	}, block);
	window.addEventListener("keydown", (e) => { if (mode && e.code === "Escape") { eat(e); arm(null); msg = "cancelled"; repaint(); } }, block);
});

// --- the panel ----------------------------------------------------------------------
let repaintFn = null;
function repaint() { if (repaintFn) repaintFn((v) => v + 1); }
const POS_KEY = "brandon.improvedfilters.panelpos", MIN_KEY = "brandon.improvedfilters.panelmin";
let panelPos = { x: Math.max(12, (safe(() => window.innerWidth) || 1280) - 340), y: 84 }, panelMin = false;
(function loadUi() {
	const raw = safe(() => window.localStorage.getItem(POS_KEY)), o = raw && safe(() => JSON.parse(raw));
	if (o && typeof o.x === "number" && typeof o.y === "number") panelPos = o;
	if (safe(() => window.localStorage.getItem(MIN_KEY)) === "1") panelMin = true;
})();
let _drag = false, _ddx = 0, _ddy = 0;
safe(() => {
	window.addEventListener("mousemove", (e) => { if (!_drag) return; panelPos = { x: Math.max(0, e.clientX - _ddx), y: Math.max(0, e.clientY - _ddy) }; repaint(); });
	window.addEventListener("mouseup", () => { if (!_drag) return; _drag = false; safe(() => window.localStorage.setItem(POS_KEY, JSON.stringify(panelPos))); });
});
function startDrag(e) { _drag = true; _ddx = e.clientX - panelPos.x; _ddy = e.clientY - panelPos.y; if (e.preventDefault) e.preventDefault(); }
const BTN = { background: "#1c2530", color: "#cdd6df", border: "1px solid #3a4550", borderRadius: "5px", fontSize: "10.5px", fontWeight: 700, padding: "3px 9px", cursor: "pointer", whiteSpace: "nowrap" };
function btn(label, onClick, opts) {
	const o = opts || {};
	return h("button", { onClick: (e) => { if (e.stopPropagation) e.stopPropagation(); onClick(); }, onMouseDown: (e) => { if (e.stopPropagation) e.stopPropagation(); }, title: o.title || "",
		style: Object.assign({}, BTN, o.on ? { background: "#2a3645", color: "#ffe27a", borderColor: "#ffe27a" } : null, o.dim ? { opacity: 0.45, cursor: "default" } : null) }, label);
}
function swatch(t) { const c = colorOf(t); return h("span", { key: t, style: { width: "11px", height: "11px", borderRadius: "2px", background: c, boxShadow: "0 0 5px " + c, flexShrink: 0, display: "inline-block" } }); }
function Panel() {
	const [, rp] = ReactM.useState(0); repaintFn = rp;
	if (!isEnabled() || !inWorld()) return null;
	if (safe(() => window.__brandonScreensaver && window.__brandonScreensaver.isActive())) return null;
	const base = { position: "fixed", left: panelPos.x + "px", top: panelPos.y + "px", zIndex: 99997, pointerEvents: "auto",
		background: "rgba(10,14,20,0.94)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: "8px", padding: "8px 10px",
		font: '600 12px -apple-system,"Segoe UI",Roboto,sans-serif', color: "#e8edf3", boxShadow: "0 4px 16px rgba(0,0,0,.5)", minWidth: "250px", maxWidth: "330px" };
	const title = h("div", { onMouseDown: startDrag, title: "drag to move", style: { fontWeight: 800, marginBottom: panelMin ? 0 : "6px", letterSpacing: ".02em", cursor: _drag ? "grabbing" : "grab", userSelect: "none", display: "flex", alignItems: "center", gap: "7px" } },
		h("span", { style: { color: "#5b6470", fontSize: "13px", lineHeight: 1 } }, "⠿"),
		h("span", null, "Filter clipboard"),
		h("span", { style: { flex: "1 1 auto" } }),
		h("button", { title: panelMin ? "expand" : "minimize", onMouseDown: (e) => { if (e.stopPropagation) e.stopPropagation(); }, onClick: (e) => { if (e.stopPropagation) e.stopPropagation(); panelMin = !panelMin; safe(() => window.localStorage.setItem(MIN_KEY, panelMin ? "1" : "0")); repaint(); },
			style: Object.assign({}, BTN, { fontSize: "13px", fontWeight: 800, lineHeight: 1, padding: "2px 9px" }) }, panelMin ? "▢" : "–"));
	if (panelMin) return h("div", { "data-brandon-ifo": "1", style: base }, title);
	const list = asList(clip && clip.elementType);
	const preview = clip
		? h("div", { style: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: "5px", fontSize: "11px", margin: "4px 0" } },
			list.map(swatch),
			h("span", { style: { fontWeight: 700 } }, list.length ? list.map(nameOf).join(" / ") : "no material"),
			h("span", { style: { color: clip.mode === "block" ? "#ff6a4d" : "#5cff4a", fontWeight: 800, fontSize: "10px" } }, clip.mode === "block" ? "✕ block" : "✓ allow"),
			newFiltersMatch() ? h("span", { style: { color: "#93a1b0", fontSize: "9.5px", fontWeight: 600 } }, "· new filters take this") : null)
		: h("div", { style: { fontSize: "11px", color: "#93a1b0", margin: "4px 0" } }, "empty — press COPY, then click any placed filter");
	return h("div", { "data-brandon-ifo": "1", style: base },
		title,
		h("div", { style: { display: "flex", flexWrap: "wrap", gap: "5px" } },
			btn(mode === "copy" ? "COPY: click a filter…" : "COPY", () => arm(mode === "copy" ? null : "copy"), { on: mode === "copy", title: "Then click any placed filter (Mk.1 / Mk.2 / Mk.3 / wall) to copy its materials and allow/block." }),
			btn(mode === "paste" ? "PASTE: click a filter…" : "PASTE", () => { if (!clip) { msg = "nothing copied yet"; repaint(); return; } arm(mode === "paste" ? null : "paste"); }, { on: mode === "paste", dim: !clip, title: "Then click a placed filter: its whole row gets the copied settings. Works from any kind onto any kind." }),
			btn("NEW FILTERS", () => { msg = setNewFilters() ? "new Mk.2 / Mk.3 filters now take: " + describe(clip) : "nothing copied yet"; repaint(); }, { dim: !clip || newFiltersMatch(), title: "Make the next Mk.2 / Mk.3 filters you place take the copied settings (the same thing the filter panel sets)." }),
			btn("CLEAR", () => { clip = null; saveClip(); arm(null); msg = "cleared"; repaint(); }, { dim: !clip })),
		preview,
		msg ? h("div", { style: { fontSize: "9.5px", color: mode ? "#ffe27a" : "#8fb98f", fontWeight: 700, lineHeight: 1.4 } }, msg) : null);
}
if (h) safe(() => api.ui.inject("brandon-improvedfilters-panel", Panel));
else console.error(`[${MOD_ID}] React not available - no panel`);
console.log(`[${MOD_ID}] loaded (build ${BUILD})`);
