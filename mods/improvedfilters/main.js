// Improved Filter Options - a clipboard for filter settings, built into the filter menus.
//
// A filter's settings are the `filter` object the game keeps on the structure
// ({mode: allow|block, elementType: one number or a list, affectsLiquid, affectsGas,
// density}). Every kind of filter carries the same object - Mk.2, the Mk.3 from the
// Manufacturing mod, and the Mk.2 filter wall - so settings copied from one kind fit
// any other. (Shakers, growers and critter fences carry a `filter` too, for their own
// purposes; only the real filter kinds count here. The Mk.1 filter and its wall are
// left alone since 0.2.5.)
//
// The clipboard shows up as a strip in the same band as the filter menu, whenever a
// filter menu is up - the game's (a Mk.2 filter in hand, or a Mk.2 row selected in
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
const BUILD = "0.2.7";
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
// The liquid / gas flags are only ever stored or written when they are true: a row's
// own `affectsLiquid: true` must never be overwritten with a false the clipboard made up
// (the game's own editor writes only mode + elementType onto a row).
function saveClip() {
	if (!clip) { safe(() => window.localStorage.removeItem(CLIP_KEY)); return; }
	const ids = asList(clip.elementType).map(eidOfType).filter(Boolean);
	const exempt = asList(clip.speedExemptElementTypes).map(eidOfType).filter(Boolean);
	const o = { mode: clip.mode || "allow", ids, single: !Array.isArray(clip.elementType) };
	if (clip.affectsLiquid) o.affectsLiquid = true;
	if (clip.affectsGas) o.affectsGas = true;
	if (typeof clip.density === "number") o.density = clip.density;
	if (exempt.length) o.exempt = exempt;
	safe(() => window.localStorage.setItem(CLIP_KEY, JSON.stringify(o)));
}
function loadClip() {   // true when the stored clip was resolved (or there is nothing to resolve)
	const raw = safe(() => window.localStorage.getItem(CLIP_KEY)); if (!raw) return true;
	const o = safe(() => JSON.parse(raw));
	if (!o || !Array.isArray(o.ids)) return true;
	const types = o.ids.map(typeOfEid).filter((t) => typeof t === "number");   // a material from a mod that isn't loaded is dropped
	if (!types.length && o.ids.length) return false;
	clip = { mode: o.mode === "block" ? "block" : "allow", elementType: o.single && types.length === 1 ? types[0] : types };
	if (o.affectsLiquid) clip.affectsLiquid = true;
	if (o.affectsGas) clip.affectsGas = true;
	if (typeof o.density === "number") clip.density = o.density;
	const ex = (o.exempt || []).map(typeOfEid).filter((t) => typeof t === "number"); if (ex.length) clip.speedExemptElementTypes = ex;
	return true;
}
// materials only resolve once the world has registered them: try until they do
let clipLoaded = false;
setInterval(() => { if (clipLoaded || !inWorld()) return; if (loadClip()) { clipLoaded = true; repaint(); } }, 1500);

// --- filters on the map ------------------------------------------------------------
const ST = safe(() => sandkit.enums.StructureType) || {};
// Mk.2 (and its wall) only - the clipboard holds between Mk.2 and Mk.3; the Mk.1 filter
// (StructureType.FilterLeft/Right, one material) and its wall are left alone
const VAN = new Set(["filterLeftMk2", "filterRightMk2", "filterWallMk2"]);
const MK3 = new Set(["filterLeftMk3", "filterRightMk3"]);
const WALLS = new Set(["filterWall", "filterWallMk2"]);
const isFilter = (s) => !!s && (VAN.has(s.type) || MK3.has(s.type));   // real filter kinds only
// the game's own row key (its `Ak`): type, mode, whether elementType is set, the sorted
// materials, density, the liquid / gas flags, the sorted speed-exempt list and the
// wall's pass-through flag - so a row here is exactly a row in the game's editor
const sortedList = (v) => [...new Set(asList(v))].sort((a, b) => a - b).join(",");
const filterKey = (s) => { const f = s.filter; if (!f) return "none_" + s.type; return [s.type, f.mode, f.elementType !== undefined ? 1 : 0, sortedList(f.elementType), f.density !== undefined && f.density !== null ? f.density : "", f.affectsLiquid ? 1 : 0, f.affectsGas ? 1 : 0, sortedList(f.speedExemptElementTypes), s.data && s.data.filterPassThrough ? 1 : 0].join("_"); };
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
function writeRow(members) {   // only mode + elementType, exactly as the game's editor apply writes a row
	const c = cloneFilter(clip), mode = c.mode || "allow";
	for (const s of members) s.filter = Object.assign({}, s.filter || { mode }, { mode, elementType: c.elementType });
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
	const vs = vanSel(); if (vs) return VAN.has(vs.structureType) ? "van-row" : null;   // a Mk.1 row open in the game's editor: not ours
	if (mk3Sel()) return "mk3-row";
	const st = safe(state); if (!st) return null;
	// the game's panel shows while one of its filters is the active structure - same gate
	if (VAN.has(safe(() => st.session.building.activeStructureType))) return "van-new";
	// the Mk.3 panel shows while the game says a Mk.3 is in hand (action.getActive is what
	// the game itself goes by), so the strip closes exactly when that panel does
	const act = safe(() => engine().api.action.getActive(engine().state));
	if (act !== undefined) return act && MK3.has(act.id) ? "mk3-new" : null;
	const k = mk3(); return k && safe(() => k.inHand()) ? "mk3-new" : null;
}
function menuFilter(which) {   // what the menu is showing right now
	if (which === "van-row") { const s = vanSel(); return s && s.draft; }
	if (which === "mk3-row") { const k = mk3(); return k && safe(() => k.draft()); }
	return safe(() => state().store.options.defaultFilter);
}
function setNewFilters() {   // what every new Mk.2 / Mk.3 takes - the setting the filter panels edit
	if (!clip) return false;
	const df = cloneFilter(clip); if (!df.affectsLiquid) delete df.affectsLiquid; if (!df.affectsGas) delete df.affectsGas;   // flags only when true
	const ok = safe(() => { const st = state(); st.store.options.defaultFilter = df;
		const cd = st.session.action.customData; if (cd && cd.copiedStructure && cd.copiedStructure.filter) cd.copiedStructure.filter = undefined;   // as the panel does: a copied structure's own filter no longer applies
		return true; }, false);
	const CID = safe(() => sandkit.enums.ComponentId) || {};
	if (CID.FilterConfig !== undefined) safe(() => api.ui.update(CID.FilterConfig));   // the game's panel reads it on render
	safe(() => api.ui.overlays.update("hotbar"));
	const k = mk3(); if (k) safe(() => k.refresh());
	return ok;
}
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
// While a pick is armed the building in hand is put down (its placement ghost would sit
// over the cursor and the game would build on the click), and handed back afterwards
// through the game's own selectStructure - which also brings its filter menu back.
// "In hand" is three things to the game: session.building.activeStructureType, then
// store.player.action, then the active hotbar slot - and its own deselect clears all
// three plus the placing flag (cancelPlacement alone only resets the placement).
let held = null;
const uiHotbar = () => { const CID = safe(() => sandkit.enums.ComponentId) || {}; if (CID.Hotbar !== undefined) safe(() => api.ui.update(CID.Hotbar)); safe(() => api.ui.overlays.update("hotbar")); };
function stash() {
	held = safe(() => {
		const st = state(), b = st.session.building, pl = st.store.player;
		const o = { active: b.activeStructureType, action: pl.action ? Object.assign({}, pl.action) : null, slot: pl.hotbar.activeSlotIndex };
		safe(() => engine().api.building.cancelPlacement(engine().state));
		b.activeStructureType = null; b.placing = false; pl.action = null; pl.hotbar.activeSlotIndex = null;
		safe(() => engine().api.input.resetMouseState(engine().state));
		return o;
	}) || null;
	uiHotbar();
}
function unstash() {
	const o = held; held = null; if (!o) return;
	safe(() => {
		const pl = state().store.player;
		if (o.active) engine().api.building.selectStructure(engine().state, o.active);   // the game's own "put this building in hand"
		else if (o.action) pl.action = o.action;
		if (o.slot !== null && o.slot !== undefined) pl.hotbar.activeSlotIndex = o.slot;
	});
	uiHotbar();
}
function arm(m) {
	// While the game is editing a Mk.2 row nothing is in hand (its editor already cancelled
	// placement) and clearing activeStructureType would make it drop the row - so no stash
	if (m && !mode && menuUp() !== "van-row") stash();
	mode = m;
	if (cursorStyle) { safe(() => cursorStyle.remove()); cursorStyle = null; }
	if (m) safe(() => { cursorStyle = document.createElement("style"); cursorStyle.textContent = "*{cursor:" + (m === "copy" ? "copy" : "cell") + " !important}"; document.head.appendChild(cursorStyle); });
	if (m) msg = m === "copy" ? "click a filter (or its label) to copy its settings — Esc cancels" : "click a filter (or its label): its whole row gets the clipboard — Esc cancels";
	if (!m) { unstash(); wasUp = menuUp(); }   // the row may have closed meanwhile: don't keep saying "this row"
	repaint();
}
function disarmHard() {   // a new world: nothing is armed, held or swallowed any more
	mode = null; held = null; swallowUntil = 0;
	if (cursorStyle) { safe(() => cursorStyle.remove()); cursorStyle = null; }
	repaint();
}
safe(() => api.events.on("game:ready", disarmHard));
function pickRow(r) {   // a label was clicked
	const m = mode; if (!m) return;
	const row = rowAt(r.x, r.y); arm(null);
	if (!row) { msg = "that row is gone"; repaint(); return; }
	if (m === "copy") doCopyRow(row); else doPasteRow(row);
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
		eat(e); swallowUntil = Date.now() + 400;   // every button: its up / click is swallowed below, so its down must be too
		if (e.button === 2) { arm(null); msg = "cancelled"; repaint(); return; }
		if (e.button !== 0) return;
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
	const names = list.length ? list.map(nameOf).join(" / ") : "no material";
	// one narrow line (the band sits this next to the filter panel, so it must stay small):
	// the material list is cut with an ellipsis and shown in full on hover
	return h("div", { "data-brandon-ifo": "1", className: "bg-black bg-opacity-75 px-3 py-2 flex flex-col gap-1 border border-slate-700 rounded ui-box text-white text-xs", style: { width: "max-content", maxWidth: "460px" } },
		h("div", { className: "flex items-center gap-2", style: { whiteSpace: "nowrap" } },
			h("span", { className: "font-semibold text-white" }, "Clipboard"),
			clip
				? h("span", { className: "flex items-center gap-1", style: { minWidth: 0, maxWidth: "170px" }, title: names + " · " + (clip.mode === "block" ? "block" : "allow") },
					list.slice(0, 6).map((t) => h("span", { key: t, className: "w-3 h-3 flex-shrink-0", style: { backgroundColor: colorOf(t), boxShadow: "0 0 6px " + colorOf(t) } })),
					h("span", { className: "text-white", style: { overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 } }, names),
					h("span", { className: "text-[10px] flex-shrink-0 " + (clip.mode === "block" ? "text-[rgb(255,77,21)]" : "text-[rgb(30,255,0)]") }, clip.mode === "block" ? "✕" : "✓"))
				: h("span", { className: "text-white/70" }, "empty"),
			btn("Copy", () => { copyFromMenu(which); repaint(); }, { title: "Copy what this menu is showing (" + (target === "this row" ? "the row being edited" : "the setting new filters take") + ")." }),
			btn("Paste", () => { pasteIntoMenu(which); repaint(); }, { dim: !clip, title: "Put the clipboard into " + target + ". Mk.2 and Mk.3 both ways." }),
			btn(mode === "copy" ? "Pick…" : "Pick", () => arm(mode === "copy" ? null : "copy"), { on: mode === "copy", title: "Pick from map: then click a placed Mk.2 / Mk.3 filter (or its label) to copy its settings." }),
			btn(mode === "paste" ? "Onto…" : "Onto", () => arm(mode === "paste" ? null : "paste"), { on: mode === "paste", dim: !clip, title: "Paste onto map: then click a placed Mk.2 / Mk.3 filter (or its label) - its whole row gets the clipboard." }),
			clip ? btn("✕", () => { clip = null; saveClip(); arm(null); msg = "cleared"; repaint(); }, { title: "Clear the clipboard" }) : null),
		msg ? h("div", { className: "text-[10px] " + (mode ? "text-[#ffe700]" : "text-white/70"), style: { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }, title: msg }, msg) : null);
}
// --- while a pick is armed: the game's own labels, for every filter kind ----------------
// The game's labels overlay draws only while one of ITS filters is in hand, and the hand
// is empty during a pick - so the strip draws the same thing itself: a box and a label
// (materials, allow/block, count) on every filter row of every kind that is in view,
// placed the way the game places its own (screen = canvas origin + (world px - camera)
// * zoom * scale), refreshed every frame; the rows are re-read twice a second (rows
// off screen are skipped then, with a margin for the label). Clicking a label picks it.
function viewCells() {   // the cells the canvas shows, plus a margin, in world cells
	return safe(() => {
		const ses = state().session, M = ses.rendering.canvas.getBoundingClientRect();
		const I = ((ses.view && ses.view.zoom) || 1) * (ses.scale || 1), pad = 240 / I;
		return { x0: (ses.camera.x - pad) / 4, y0: (ses.camera.y - pad) / 4, x1: (ses.camera.x + M.width / I + pad) / 4, y1: (ses.camera.y + M.height / I + pad) / 4 };
	}) || null;
}
function allRows() {
	const N = 4, rows = [], V = viewCells();
	for (const id of [...VAN, ...MK3]) {
		const list = []; safe(() => api.structures.forEachOfType(id, (s) => { if (typeof s.x === "number") list.push(s); }));
		if (!list.length) continue;
		const vert = WALLS.has(id), groups = new Map();
		for (const s of list) { const k = (vert ? s.x : s.y) + "_" + filterKey(s); let g = groups.get(k); if (!g) { g = []; groups.set(k, g); } g.push(s); }
		for (const g of groups.values()) {
			g.sort(vert ? (a, b) => a.y - b.y : (a, b) => a.x - b.x);
			let run = [];
			const flush = () => { if (!run.length) return; const s0 = run[0], f = s0.filter || {};
				const w = vert ? N : run.length * N, hh = vert ? run.length * N : N;
				if (V && (s0.x + w < V.x0 || s0.x > V.x1 || s0.y + hh < V.y0 || s0.y > V.y1)) { run = []; return; }   // entirely off screen
				rows.push({ key: String(s0.type) + "_" + s0.x + "_" + s0.y, type: s0.type, x: s0.x, y: s0.y, w: vert ? N : run.length * N, hh: vert ? run.length * N : N, count: run.length, mode: f.mode === "block" ? "block" : "allow", types: asList(f.elementType) }); run = []; };
			for (const s of g) { if (run.length) { const p = run[run.length - 1]; if (vert ? s.y !== p.y + N : s.x !== p.x + N) flush(); } run.push(s); }
			flush();
		}
	}
	return rows;
}
function PickOverlay() {
	const [rows, setRows] = ReactM.useState([]);
	const box = ReactM.useRef(null), nodes = ReactM.useRef(new Map());
	ReactM.useEffect(() => {
		let raf = 0, last = 0, shown = false;
		const frame = () => {
			raf = requestAnimationFrame(frame);
			const el = box.current; if (!el) return;
			if (!mode || !inWorld()) { if (shown) { el.style.display = "none"; shown = false; setRows([]); } return; }
			if (!shown) { el.style.display = ""; shown = true; last = 0; }
			const now = Date.now(); if (now - last > 500) { last = now; setRows(allRows()); }
			const ses = safe(() => state().session); if (!ses) return;
			const M = safe(() => ses.rendering.canvas.getBoundingClientRect()); if (!M) return;
			const I = ((ses.view && ses.view.zoom) || 1) * (ses.scale || 1), kx = ses.camera.x, ky = ses.camera.y;
			for (const n of nodes.current.values()) {
				const r = n.row; if (!r) continue;
				const sx = M.left + (r.x * 4 - kx) * I, sy = M.top + (r.y * 4 - ky) * I, w = r.w * 4 * I, hh = r.hh * 4 * I;
				if (n.box) { n.box.style.transform = `translate(${sx}px, ${sy}px)`; n.box.style.width = w + "px"; n.box.style.height = hh + "px"; }
				if (n.label) n.label.style.transform = `translate(${sx + w / 2}px, ${sy - 4}px) translate(-50%, -100%)`;
			}
		};
		raf = requestAnimationFrame(frame);
		return () => cancelAnimationFrame(raf);
	}, []);
	const ref = (key, row, part) => (el) => { let n = nodes.current.get(key); if (!el) { if (n) { n[part] = null; if (!n.box && !n.label) nodes.current.delete(key); } return; } if (!n) { n = {}; nodes.current.set(key, n); } n.row = row; n[part] = el; };
	return h("div", { ref: box, "data-brandon-ifo": "1", style: { position: "fixed", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "hidden", fontFamily: "monospace", fontSize: "10px", color: "#fff", zIndex: 31, display: "none" } },
		rows.map((r) => { const col = r.mode === "allow" ? "rgb(0,255,71)" : "#ef4444"; return h(ReactM.Fragment, { key: r.key },
			h("div", { ref: ref(r.key, r, "box"), style: { position: "absolute", left: 0, top: 0, border: "2px dashed " + col, boxSizing: "border-box", transformOrigin: "0 0" } }),
			h("div", { ref: ref(r.key, r, "label"), role: "button", tabIndex: -1, title: (mode === "copy" ? "copy from " : "paste onto ") + kindName(r.type) + " row",
				onMouseDown: (e) => { e.preventDefault(); e.stopPropagation(); }, onPointerDown: (e) => { e.stopPropagation(); },
				onClick: (e) => { e.preventDefault(); e.stopPropagation(); pickRow(r); },
				style: { position: "absolute", left: 0, top: 0, transformOrigin: "0 0", zIndex: 1, pointerEvents: "auto", cursor: "pointer", background: "#000", border: "1px solid " + col, borderRadius: "3px", padding: "2px 6px", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: "5px" } },
				r.types.map((t) => { const c = colorOf(t); return h("span", { key: t, style: { width: "8px", height: "8px", background: c, boxShadow: "0 0 4px " + c, flexShrink: 0 } }); }),
				h("span", null, r.types.length ? r.types.map(nameOf).join(" / ") : "none"),
				h("span", { style: { color: r.mode === "allow" ? "rgb(30,255,0)" : "rgb(255,77,21)", fontWeight: 700 } }, r.mode === "allow" ? "✓" : "✕"),
				h("span", { style: { color: "#94a3b8" } }, kindName(r.type) + (r.count > 1 ? " ×" + r.count : "")))); }));
}
if (h) {
	safe(() => api.ui.inject("brandon-improvedfilters-pick-overlay", () => h(PickOverlay)));
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
