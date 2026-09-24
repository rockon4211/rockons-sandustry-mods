// Improved Filter Options - a clipboard for filter settings, built into the filter menus.
//
// A filter's settings are the `filter` object the game keeps on the structure
// ({mode: allow|block, elementType: one number or a list, affectsLiquid, affectsGas,
// density}). Every kind of filter carries the same object - Mk.1, Mk.2, the Mk.3 from
// the Manufacturing mod, and the filter walls - so settings copied from one kind fit
// any other. (Shakers, growers and critter fences carry a `filter` too, for their own
// purposes; only the real filter kinds count here.)
//
// The clipboard shows up as a strip in the same band as the filter menu, whenever a
// filter menu is up - the game's (a Mk.1 / Mk.2 filter in hand, or a row selected in
// its editor) or the Mk.3's. COPY takes what that menu is showing (the row being
// edited, else the setting new filters take); PASTE puts the clipboard into it (the
// row - through the game's own editor, setDraft + apply - or store.options.defaultFilter,
// which every new Mk.2 / Mk.3 takes when placed). PICK / ONTO arm a click on any placed
// filter instead, for a row that isn't open in a menu.
//
// The clipboard is saved by material id (names like "water"), never by the number the
// game gives a material - those differ between PCs and mod sets.
const api = sandkit.api;
const MOD_ID = "brandon.improvedfilters";
const BUILD = "0.2.1";
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
const state = () => sandkit.state;
const engine = () => sandkit.engine;

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
const VAN = new Set([ST.FilterLeft, ST.FilterRight, "filterLeftMk2", "filterRightMk2", "filterWall", "filterWallMk2"].filter((v) => v !== undefined));
const MK3 = new Set(["filterLeftMk3", "filterRightMk3"]);
const WALLS = new Set(["filterWall", "filterWallMk2"]);
const isFilter = (s) => !!s && (VAN.has(s.type) || MK3.has(s.type));   // real filter kinds only
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
const kindName = (t) => t === ST.FilterLeft || t === ST.FilterRight ? "Filter" : t === "filterLeftMk2" || t === "filterRightMk2" ? "Filter Mk.2" : MK3.has(t) ? "Filter Mk.3" : t === "filterWall" ? "Filter wall" : t === "filterWallMk2" ? "Filter wall Mk.2" : String(t);
function describe(f) { const l = asList(f && f.elementType); return (l.length ? l.map(nameOf).join(" / ") : "no material") + " · " + ((f && f.mode) === "block" ? "block" : "allow"); }
function writeRow(members) {
	for (const s of members) s.filter = Object.assign({}, s.filter || {}, cloneFilter(clip));
	return safe(() => { engine().api.structures.updateMany(engine().state, members, { propagateToWorkers: true }); return true; }, false);
}

// --- the menus: which one is up, what it shows, and how to put a setting into it ------
// the game's row editor (its filter panel in "editing" mode) is on the engine api
const vanEditor = () => safe(() => engine().api.filterGroupEditor) || null;
const vanSel = () => { const ed = vanEditor(); return ed ? (safe(() => ed.getSelection(engine().state)) || null) : null; };
// the Mk.3 panel (Manufacturing) says what it is doing through this hook
const mk3 = () => safe(() => window.__brandonFilterMk3) || null;
const mk3Sel = () => { const k = mk3(); return k ? (safe(() => k.selection()) || null) : null; };
function menuUp() {
	if (vanSel()) return "van-row";
	if (mk3Sel()) return "mk3-row";
	const st = safe(state); if (!st) return null;
	const t = safe(() => st.session.building.activeStructureType), a = safe(() => st.store.player.action && st.store.player.action.id);
	if (VAN.has(t)) return "van-new";
	if (MK3.has(t) || MK3.has(a)) return "mk3-new";
	return null;
}
function menuFilter(which) {   // what the menu is showing right now
	if (which === "van-row") { const s = vanSel(); return s && s.draft; }
	if (which === "mk3-row") { const k = mk3(); return k && safe(() => k.draft()); }
	return safe(() => state().store.options.defaultFilter);
}
function setNewFilters() {   // what every new Mk.2 / Mk.3 takes - the setting the filter panels edit
	if (!clip) return false;
	const ok = safe(() => { const st = state(); st.store.options.defaultFilter = cloneFilter(clip);
		const cd = st.session.action.customData; if (cd && cd.copiedStructure && cd.copiedStructure.filter) cd.copiedStructure.filter = undefined;   // as the panel does: a copied structure's own filter no longer applies
		return true; }, false);
	const CID = safe(() => sandkit.enums.ComponentId) || {};
	if (CID.FilterConfig !== undefined) safe(() => api.ui.update(CID.FilterConfig));   // the game's panel reads it on render
	safe(() => api.ui.overlays.update("hotbar"));
	const k = mk3(); if (k) safe(() => k.refresh());
	return ok;
}
function newFiltersMatch() { const df = safe(() => state().store.options.defaultFilter); return !!clip && !!df && filterKey({ type: 0, filter: df }) === filterKey({ type: 0, filter: clip }); }
let msg = "";
function copyFromMenu(which) {
	const f = menuFilter(which); if (!f) { msg = "nothing to copy"; return; }
	clip = cloneFilter(f); saveClip();
	const s = which === "van-row" ? vanSel() : which === "mk3-row" ? mk3Sel() : null;
	const from = s ? (which === "van-row" ? kindName(s.structureType) + " row (" + s.memberCount + ")" : "Filter Mk.3 row (" + (s.count || "?") + ")") : "new-filter setting";
	const forNew = which !== "van-new" && which !== "mk3-new" && setting("copyAlsoSetsNew", true) && setNewFilters();
	msg = "copied from " + from + ": " + describe(clip) + (forNew ? " — new filters take it" : "");
	safe(() => api.ui.toast("Copied filter settings: " + describe(clip)));
}
function pasteIntoMenu(which) {
	if (!clip) { msg = "nothing copied yet"; return; }
	if (which === "van-row") {   // the game's editor: set its draft, then its own apply writes the row and closes
		const ed = vanEditor(), st = engine().state, s = vanSel();
		const ok = ed && safe(() => ed.setDraft(st, cloneFilter(clip)), false) && safe(() => ed.apply(st), false);
		msg = ok ? "pasted onto " + kindName(s.structureType) + " row (" + s.memberCount + "): " + describe(clip) : "the game's editor refused it";
		if (ok) safe(() => api.ui.toast("Pasted filter settings onto " + s.memberCount + " " + kindName(s.structureType) + (s.memberCount === 1 ? "" : "s")));
		return;
	}
	if (which === "mk3-row") {
		const k = mk3(), s = mk3Sel();
		const ok = k && safe(() => k.setDraft(cloneFilter(clip)), false) && safe(() => k.apply(), false);
		msg = ok ? "pasted onto Filter Mk.3 row (" + (s && s.count || "?") + "): " + describe(clip) : "the Mk.3 panel refused it";
		if (ok) safe(() => api.ui.toast("Pasted filter settings onto the Filter Mk.3 row"));
		return;
	}
	msg = setNewFilters() ? "new filters now take: " + describe(clip) : "couldn't set it";
}
// PICK / ONTO: a click on any placed filter, taken before the game sees it (capture),
// so nothing gets built or grabbed. Esc / right-click cancels.
let mode = null, cursorStyle = null, swallowUntil = 0;
function arm(m) {
	mode = m;
	if (cursorStyle) { safe(() => cursorStyle.remove()); cursorStyle = null; }
	if (m) safe(() => { cursorStyle = document.createElement("style"); cursorStyle.textContent = "*{cursor:" + (m === "copy" ? "copy" : "cell") + " !important}"; document.head.appendChild(cursorStyle); });
	if (m) msg = m === "copy" ? "click a placed filter to copy its settings (Esc cancels)" : "click a placed filter: its whole row gets the clipboard (Esc cancels)";
	repaint();
}
function doCopyRow(row) {
	clip = cloneFilter(row.members[0].filter); saveClip();
	const forNew = setting("copyAlsoSetsNew", true) && setNewFilters();
	msg = "copied " + kindName(row.type) + " row (" + row.members.length + "): " + describe(clip) + (forNew ? " — new filters take it" : "");
	safe(() => api.ui.toast("Copied filter settings: " + describe(clip)));
}
function doPasteRow(row) {
	const ok = writeRow(row.members);
	msg = ok ? "pasted onto " + kindName(row.type) + " row (" + row.members.length + "): " + describe(clip) : "couldn't write the row";
	if (ok) safe(() => api.ui.toast("Pasted filter settings onto " + row.members.length + " " + kindName(row.type) + (row.members.length === 1 ? "" : "s")));
}
safe(() => {
	const block = { capture: true, passive: false };
	const eat = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };
	const ours = (e) => !!(e.target && e.target.closest && e.target.closest("[data-brandon-ifo]"));
	// the cell under a screen point, the way the game maps its own overlay labels:
	// screen = canvas origin + (world px - camera) * zoom * scale; a cell is 4 world px
	function cellFromClient(x, y) {
		return safe(() => {
			const ses = state().session, M = ses.rendering.canvas.getBoundingClientRect();
			const I = ((ses.view && ses.view.zoom) || 1) * ses.scale;
			return { x: Math.floor(((x - M.left) / I + ses.camera.x) / 4), y: Math.floor(((y - M.top) / I + ses.camera.y) / 4) };
		}) || safe(() => { const cp = state().session.input.mouse.cellPosition; return { x: Math.floor(cp.x), y: Math.floor(cp.y) }; }) || null;
	}
	// The armed click is handled on POINTERDOWN: a preventDefault there also stops the
	// browser's follow-up mousedown / click (which is what keeps the game from acting),
	// so a handler waiting on mousedown would never run.
	window.addEventListener("pointerdown", (e) => {
		if (!mode || ours(e)) return;
		if (e.button === 2) { eat(e); swallowUntil = Date.now() + 400; arm(null); msg = "cancelled"; repaint(); return; }
		if (e.button !== 0) return;
		eat(e); swallowUntil = Date.now() + 400;
		const c = cellFromClient(e.clientX, e.clientY);
		const row = c ? rowAt(c.x, c.y) : null;
		const m = mode; arm(null);
		if (!row) { msg = "that isn't a filter" + (c ? " (cell " + c.x + "," + c.y + ")" : "") + " — cancelled"; repaint(); return; }
		if (m === "copy") doCopyRow(row); else doPasteRow(row);
		repaint();
	}, block);
	for (const t of ["mousedown", "pointerup", "mouseup", "click", "contextmenu"]) window.addEventListener(t, (e) => {
		if ((!mode && Date.now() > swallowUntil) || ours(e)) return;
		eat(e);
	}, block);
	window.addEventListener("keydown", (e) => { if (mode && e.code === "Escape") { eat(e); arm(null); msg = "cancelled"; repaint(); } }, block);
});

// --- the strip in the filter menu's band ---------------------------------------------
let repaintFn = null, wasUp = null;
function repaint() { if (repaintFn) repaintFn((v) => v + 1); safe(() => api.ui.overlays.update("hotbar")); }
// the game's own classes, so it matches the filter panel next to it
const BTN = "text-xs px-2 py-0.5 text-white bg-black border rounded-tr-lg rounded-bl-lg item-button-transition border-slate-200 border-opacity-25 hover:text-[#ffe700] hover:border-opacity-0";
const BTN_ON = "text-xs px-2 py-0.5 bg-black border rounded-tr-lg rounded-bl-lg item-button-transition text-[#ffe700] border-[#ffe700]";
function btn(label, onClick, o) {
	o = o || {};
	return h("button", { className: o.on ? BTN_ON : BTN, style: o.dim ? { opacity: 0.45 } : undefined, title: o.title || "", tabIndex: -1,
		onClick: (e) => { e.stopPropagation(); if (!o.dim) onClick(); }, onMouseDown: (e) => { e.preventDefault(); e.stopPropagation(); } }, label);
}
function Strip() {
	const [, rp] = ReactM.useState(0); repaintFn = rp;
	if (!isEnabled() || !inWorld()) return null;
	if (safe(() => window.__brandonScreensaver && window.__brandonScreensaver.isActive())) return null;
	const which = mode ? (wasUp || menuUp()) : menuUp();
	if (!which) return null;
	const list = asList(clip && clip.elementType);
	const target = which === "van-row" || which === "mk3-row" ? "this row" : "new filters";
	return h("div", { "data-brandon-ifo": "1", className: "bg-black bg-opacity-75 px-4 py-2 flex items-center gap-3 border border-slate-700 rounded ui-box text-white text-xs", style: { flexWrap: "wrap" } },
		h("span", { className: "font-semibold text-white" }, "Clipboard"),
		clip
			? h("div", { className: "flex flex-wrap items-center gap-x-2 gap-y-1" },
				list.map((t) => h("span", { key: t, className: "w-3 h-3 flex-shrink-0", style: { backgroundColor: colorOf(t), boxShadow: "0 0 6px " + colorOf(t) } })),
				h("span", { className: "text-white" }, list.length ? list.map(nameOf).join(" / ") : "no material"),
				h("span", { className: "text-[10px] " + (clip.mode === "block" ? "text-[rgb(255,77,21)]" : "text-[rgb(30,255,0)]") }, clip.mode === "block" ? "✕ block" : "✓ allow"))
			: h("span", { className: "text-white/70" }, "empty"),
		btn("Copy", () => { copyFromMenu(which); repaint(); }, { title: "Copy what this menu is showing (" + (target === "this row" ? "the row being edited" : "the setting new filters take") + ")." }),
		btn("Paste", () => { pasteIntoMenu(which); repaint(); }, { dim: !clip, title: "Put the clipboard into " + target + ". Works from any filter kind onto any other." }),
		btn(mode === "copy" ? "Pick: click a filter…" : "Pick from map", () => arm(mode === "copy" ? null : "copy"), { on: mode === "copy", title: "Then click any placed filter (Mk.1 / Mk.2 / Mk.3 / wall) to copy its settings." }),
		btn(mode === "paste" ? "Onto: click a filter…" : "Paste onto map", () => arm(mode === "paste" ? null : "paste"), { on: mode === "paste", dim: !clip, title: "Then click a placed filter: its whole row gets the clipboard." }),
		clip ? btn("Clear", () => { clip = null; saveClip(); arm(null); msg = "cleared"; repaint(); }) : null,
		msg ? h("span", { className: "text-[10px] " + (mode ? "text-[#ffe700]" : "text-white/70") }, msg) : null);
}
if (h) {
	// the same band above the hotbar the filter menus live in; a fixed box if that can't be used
	const mounted = safe(() => { api.ui.overlays.register("hotbar", "brandonFilterClipboard", () => h(Strip)); return true; }, false);
	if (!mounted) safe(() => api.ui.inject("brandon-improvedfilters-strip", () => h("div", { style: { position: "fixed", left: "50%", bottom: "96px", transform: "translateX(-50%)", zIndex: 40, pointerEvents: "auto" } }, h(Strip))));
	setInterval(() => {   // show / hide with the filter menus
		if (!isEnabled()) return;
		const up = menuUp();
		if (up !== wasUp) { if (!up && mode) { /* keep the strip while a pick is armed */ } else { wasUp = up; if (!up) { arm(null); msg = ""; } repaint(); } }
	}, 250);
} else console.error(`[${MOD_ID}] React not available - no clipboard strip`);
console.log(`[${MOD_ID}] loaded (build ${BUILD})`);
