// Sandustry Screensaver — after N minutes without input the world becomes a
// screensaver: the HUD hides, the cursor disappears, the camera drifts between
// the busiest spots on the map (your machines, belts, buffers…), the frame
// rate is capped and the simulation optionally slowed so it costs little
// power, and a screen wake-lock keeps the monitor from blanking. Press E
// to exit; that restores everything exactly as it was.
//
// At the main menu, if nobody touches anything for a few seconds (i.e. the
// game was launched by the idle scheduled task), it presses Continue for you
// and starts the screensaver as soon as the world is in.
const api = sandkit.api;
const state = sandkit.state;          // the full game state (session, store, settings…)
const MOD_ID = "brandon.screensaver";
const React = sandkit.react;
const h = React && React.createElement;

function safe(fn, fb) { try { return fn(); } catch (e) { return fb; } }
function setting(name, fb) {
	const v = safe(() => api.settings.get(name));
	if (typeof fb === "boolean") return typeof v === "boolean" ? v : fb;
	if (typeof fb === "number") return (typeof v === "number" && isFinite(v)) ? v : fb;
	return v === undefined ? fb : v;
}
const Scene = safe(() => sandkit.enums.Scene) || {};
const ComponentId = safe(() => sandkit.enums.ComponentId) || {};
function scene() { return safe(() => api.scene.getActive()); }
function inWorld() { return typeof Scene.Game === "number" ? scene() === Scene.Game : (scene() > 2); }
function atMenu() { return typeof Scene.MainMenu === "number" && scene() === Scene.MainMenu; }
const CELL = 4;   // px per cell
const ACTIVE_KEY = "brandon.screensaver.active";   // informational; other mods ask window.__brandonScreensaver.isActive() instead
safe(() => window.localStorage.setItem(ACTIVE_KEY, "0"));   // never start with a stale "active" flag

// --- input / idle tracking ----------------------------------------------------
let lastInput = Date.now(), everInput = false, lastMouse = null, graceUntil = 0;
// While the screensaver runs, ONLY the E key ends it (tip in the top-right corner);
// every other key and click is swallowed so it can't nudge the game underneath.
const isExitKey = (e) => e && (e.code === "KeyE" || e.key === "e" || e.key === "E");
function noteInput(e) {
	lastInput = Date.now(); everInput = true;
	if (!active) return;
	if (e && e.type === "keydown" && isExitKey(e) && Date.now() > graceUntil) {
		safe(() => { e.preventDefault(); e.stopImmediatePropagation(); });
		stop("E key");
		return;
	}
	if (e && (e.type === "keydown" || e.type === "keyup" || e.type === "mousedown" || e.type === "mouseup" || e.type === "click" || e.type === "wheel")) safe(() => { e.preventDefault(); e.stopImmediatePropagation(); });
}
safe(() => {
	const opts = { capture: true, passive: true };
	const block = { capture: true, passive: false };
	window.addEventListener("keydown", noteInput, block);
	window.addEventListener("keyup", (e) => { if (active) noteInput(e); }, block);
	window.addEventListener("mousedown", noteInput, block);
	window.addEventListener("mouseup", (e) => { if (active) noteInput(e); }, block);
	window.addEventListener("click", (e) => { if (active) noteInput(e); }, block);
	window.addEventListener("wheel", noteInput, block);
	window.addEventListener("touchstart", noteInput, opts);
	window.addEventListener("mousemove", (e) => {
		// ignore sub-pixel jitter some mice produce at rest
		if (lastMouse && Math.abs(e.clientX - lastMouse.x) < 3 && Math.abs(e.clientY - lastMouse.y) < 3) return;
		lastMouse = { x: e.clientX, y: e.clientY }; noteInput();
	}, opts);
});
function idleMs() { return Date.now() - lastInput; }

// --- points of interest: where the structures are densest ------------------
// Buckets the map into 64-cell squares, weights each by structure count, and
// keeps the top spots (plus the player). Refreshed each time the saver starts.
let pois = [];
function buildPois() {
	const list = safe(() => state.store.structures) || [];
	const B = 64, buckets = new Map();
	for (const s of list) {
		if (typeof s.x !== "number") continue;
		const k = ((s.x / B) | 0) + "," + ((s.y / B) | 0);
		let b = buckets.get(k); if (!b) { b = { n: 0, sx: 0, sy: 0 }; buckets.set(k, b); }
		b.n++; b.sx += s.x; b.sy += s.y;
	}
	const top = [...buckets.values()].filter((b) => b.n >= 6).sort((a, b) => b.n - a.n).slice(0, 14)
		.map((b) => ({ x: (b.sx / b.n) * CELL, y: (b.sy / b.n) * CELL, w: b.n }));
	const p = safe(() => state.store.player);
	if (p && typeof p.x === "number") top.push({ x: p.x, y: p.y, w: 1 });
	// spread them out: drop spots within ~100 cells of a busier one
	const out = [];
	for (const c of top) if (!out.some((o) => Math.hypot(o.x - c.x, o.y - c.y) < 100 * CELL)) out.push(c);
	pois = out.length ? out : (p ? [{ x: p.x, y: p.y, w: 1 }] : []);
}

// --- the tour ----------------------------------------------------------------
let active = false, tour = null, saved = null, wakeLock = null, styleEl = null, lastPoi = -1, startedAt = 0;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);   // ease-in-out cubic
// The game's camera x/y (and overrideCamera) is the TOP-LEFT of the view in
// world px, not its centre — so a point we want centred must be shifted by
// half the view (canvas size ÷ zoom). All our maths is in "centre" space and
// converted at the last moment.
function halfView() {
	const z = safe(() => state.session.view.zoom) || 1, c = safe(() => state.session.rendering.canvas) || {};
	return { w: Math.floor((c.width || 1920) / z / 2), h: Math.floor((c.height || 1080) / z / 2) };
}
function toCam(pt) { const hv = halfView(); return { x: Math.round(pt.x - hv.w), y: Math.round(pt.y - hv.h) }; }
function camNow() {   // current view CENTRE in world px
	const hv = halfView(), o = state.session.overrideCamera;
	if (o && typeof o.x === "number") return { x: o.x + hv.w, y: o.y + hv.h };
	const c = state.session.camera; if (c && typeof c.x === "number") return { x: c.x + hv.w, y: c.y + hv.h };
	const p = state.store.player; return { x: p.x, y: p.y };
}
function nextLeg() {
	if (!pois.length) buildPois();
	if (!pois.length) return null;
	let i; if (pois.length === 1) i = 0; else { do { i = Math.floor(Math.random() * pois.length); } while (i === lastPoi); }
	lastPoi = i;
	const from = camNow(), to = pois[i];
	const dist = Math.hypot(to.x - from.x, to.y - from.y);
	const moveMs = Math.max(4000, Math.min(setting("moveSeconds", 30) * 1000, dist / (2 * CELL) * 1000 / 2));   // never crawl across a huge gap for a minute, never teleport
	return { from, to: { x: to.x, y: to.y }, t0: Date.now(), moveMs, dwellMs: setting("dwellSeconds", 20) * 1000, drift: { a: Math.random() * Math.PI * 2, r: 12 * CELL } };
}
// --- follow the production line ----------------------------------------------
// Individual grains can't be tracked: a falling-sand cell has no identity, and
// conveyors move material by DISPLACEMENT (the belts pass shifts each cell one
// over) without ever setting a per-cell velocity — on a packed belt nothing
// observable changes from one look to the next. So instead of chasing a grain
// we walk the route the grain takes: the belt network itself. From a Source we
// find the belt the drop lands on, follow it cell by cell (stepping up/down a
// row where belts step, taking the drop to the belt below when one ends), and
// glide the camera along that polyline at a steady pace. The material is
// visibly flowing under the camera the whole way, which is what "following a
// grain" looks like — and it can't lose track. If no belts are found the
// material tracer below takes over.
const BUILD = "0.18.0";
const EMPTY = safe(() => sandkit.enums.ElementType.Empty);
const typeAt = (x, y) => safe(() => api.elements.getResolvedTypeAtCell(x, y));
const isMat = (t) => t !== undefined && t !== null && t !== EMPTY;
function sourcesList() { const hook = safe(() => window.__brandonSandboxLoop); return (hook && hook.sources && hook.sources()) || []; }
function matName(t) { return safe(() => api.elements.getNameByType(t)) || ("type " + t); }
let dbg = { phase: "idle", note: "-", tracers: 0, belts: 0, cells: 0, near: -1, path: 0, pos: 0, ms: 0 };

// --- the tracer ----------------------------------------------------------------
// We can't tell two grains of soil apart — but we CAN make one of them unique.
// Since 0.18 the mod registers a copy ("clone") of EVERY material in the game when
// it loads, each carrying all of its material's properties, and teaches each copy
// every reaction and recipe the game has for the real material (touch reactions,
// every machine, burning) with the outputs pointed at the matching copies. The
// Source emits one grain as the copy, and the game itself then carries it through
// the whole chain: soil → wet soil → residue → burnt residue → seed …
//
// Two rules decide what the grain becomes when a step has more than one product:
//   · it never becomes gold — gold is produced as normal, the grain stays the
//     other product;
//   · otherwise it follows the MAIN product (the one the game makes most of).
// Anything the game does in hard-wired code that a copy can't take part in (the
// planter growing a flower, steam turning to cloud…) still hands the grain back
// and picks up what comes out — but only a material that step can really make.
//
// Element copies must exist before the world starts: the simulation workers only
// learn the element list once, at load, so a copy made later would not exist for
// them. That is why every material is copied up front rather than on demand.
const TRACER_KINDS = [["brandonTracerPowder", "Powder", 1600], ["brandonTracerLiquid", "Liquid", 1000], ["brandonTracerGas", "Gas", 2], ["brandonTracerSolid", "Solid", 2000], ["brandonTracerSlushy", "Slushy", 1300]];
// structures that only hold, carry or move material — never a reason to hand the grain back
const PASSIVE = /clearingFrame|launcher|frame|platform|ladder|support|scaffold|wall|pipe|chute|door|light|sign|button|foundation|splitter|dropper|conveyor|belt|filter|soundBox|pump|liquidVent|quantumPortal/i;
// the game's own structures report a NUMBER as their type; these are their names (build 0.5.6)
const VANILLA_STRUCTS = [null, "conveyorLeft", "conveyorRight", "shakerLeft", "shakerRight", "launcherUp", "launcherLeft", "launcherRight", "splitterLeft", "splitterRight", "dropper", "foundation", "foundationAngledLeft", "foundationTriangleLeftDel", "foundationAngledRight", "foundationTriangleRightDel", "collector", "filterLeft", "filterRight", "slidingFoundation", "velocitySoaker", "grower", "soundBox", "pipe", "pump", "liquidVent", "light", "gloomEmitter"];
// which recipe table a machine runs, by its structure name
const FAMILY_OF = [[/shaker/i, "shaker"], [/velocitySoaker|kineticPress/i, "kineticPress"], [/grower|planter/i, "planterBox"], [/thermofroster|condenser/i, "condenser"], [/thermodryer|steamDryer/i, "steamDryer"], [/crystallizer|synthesizer/i, "synthesizer"], [/snowmaker/i, "snowmaker"], [/smelter/i, "smelter"]];
function familyOf(sid) { if (!sid) return null; for (const [re, f] of FAMILY_OF) if (re.test(sid)) return f; return null; }
// Steps the game does in hard-wired code (not in a table a copy can join). Used only
// to know what to look for after handing the grain back. Gold is never followed.
const EXTRA_STEPS = {"wetSeed":["seedling"],"seedling":["petalium"],"steam":["cloud","water"],"cloud":["water"],"water":["steam","freezingIce"],"lava":["basalt"],"moonhop":["prismite"],"prismite":["prismaline"],"voidSeeds":["growingVoidSeed"],"growingVoidSeed":["voidPetal"],"burntResidue":["seed"],"florin":["florinol"],"florinol":["aurixite"],"aurixite":["auralite"],"sunsand":["wetSand"]};
// growth stages: never ride one (a copy can't grow) — look straight for what it grows into
const NO_POSSESS = new Set(["seedling", "growingVoidSeed", "fire", "flame"]);
// materials the game changes on a timer in hard-wired code; the grain is handed back when it
// stops moving so the real material's timer can run
const TIMED_IDS = new Set(["steam", "cloud"]);
function isGasType(t) { const d = safe(() => api.elements.getDefinitionByType(t)); const G = safe(() => sandkit.enums.MatterType.Gas); return !!d && typeof G === "number" && d.matterType === G; }
const tracerFor = new Map();      // matterType -> our element type
const tracerTypes = new Set();    // every tracer element type
(function registerTracers() {
	const MT = safe(() => sandkit.enums.MatterType) || {};
	for (const [id, matter, density] of TRACER_KINDS) {
		const mt = MT[matter]; if (typeof mt !== "number") continue;
		const r = safe(() => api.elements.register({ id: id, name: "Tracer", matterType: mt, density: density, metaColor: 0xffffff, colors: { variants: [[255, 255, 255, 255]] }, isGrabbable: true, isTransportable: true }));
		if (r && typeof r.elementType === "number") { tracerFor.set(mt, r.elementType); tracerTypes.add(r.elementType); }
	}
	dbg.tracers = tracerTypes.size;
})();
const idOf = (t) => safe(() => api.elements.getIdByType(t));
const typeOfId = (id) => safe(() => api.elements.getTypeFromId(id));
const defOf = (t) => safe(() => api.elements.getDefinitionByType(t));
function brightChan(v) { return Math.max(0, Math.min(255, Math.round(v * 0.55 + 118))); }
function brightenVariants(vs) { return (vs || []).map((c) => [brightChan(c[0]), brightChan(c[1]), brightChan(c[2]), c.length > 3 ? c[3] : 255]); }
function brightenMeta(n) {
	if (typeof n !== "number") return 0xffffff;
	return (brightChan((n >> 16) & 255) << 16) | (brightChan((n >> 8) & 255) << 8) | brightChan(n & 255);
}
// --- clones: one tracer element PER MATERIAL, for every material -------------------
const CLONE_PREFIX = "brandonTrc_";
const isOurId = (id) => typeof id === "string" && (id.indexOf(CLONE_PREFIX) === 0 || id.indexOf("brandonTracer") === 0);
const NEVER_CLONE = new Set(["particle", "fire", "flame", "shake", "empty"]);   // effects, not materials
const MAX_TYPE = 250;        // the game allows element types 1–255; leave a little room
const cloneOf = new Map();   // real type -> clone type
const realOf = new Map();    // clone type -> real type
const cloneDefs = new Map(); // clone type -> the definition we keep re-applying
const burnsInto = new Map(); // real type -> real type its clone becomes when burnt
const timedReal = new Set(); // real types the game changes on a timer
let cloneSkipped = 0;
// everything the definition holds is copied, except what would make the copy BE the real
// one (id, names) and what the game runs by itself: a timer would delete the copy, since
// the code that acts on it looks for the real material; burning is copied, pointed at copies
const NO_COPY = new Set(["id", "elementType", "type", "nameKey", "descriptionKey", "name", "description", "mixes", "duration", "durationRandom", "flammable"]);
function cloneDefFor(realType, id, cloneIds) {
	const d = defOf(realType);
	if (!d || typeof d !== "object") return null;
	const def = {};
	for (const k of Object.keys(d)) { const v = d[k]; if (NO_COPY.has(k) || typeof v === "function") continue; def[k] = v; }
	def.name = "· " + (d.name || matName(realType) || id);
	def.metaColor = brightenMeta(d.metaColor);
	if (d.colors && Array.isArray(d.colors.variants)) def.colors = Object.assign({}, d.colors, { variants: brightenVariants(d.colors.variants) });
	// burning: the copy burns into the COPY of what the real material burns into, every time
	// (the real one sometimes burns away to nothing; the traced grain always survives)
	const fl = d.flammable;
	let outId = null;
	if (fl && typeof fl === "object" && typeof fl.outputElementId === "string") outId = fl.outputElementId;
	else if (id === "residue") outId = "burntResidue";   // hard-wired in the game's fire code
	if (outId && outId !== "gold" && cloneIds.has(outId)) {
		def.flammable = Object.assign({}, (fl && typeof fl === "object") ? fl : {}, { outputElementId: CLONE_PREFIX + outId, outputChance: 1 });
		const ot = typeOfId(outId); if (typeof ot === "number") burnsInto.set(realType, ot);
	} else if (fl) def.flammable = fl;   // burns away (or into gold): same as the real material
	if (d.duration !== undefined || d.durationRandom !== undefined || TIMED_IDS.has(id)) timedReal.add(realType);
	return def;
}
(function registerClones() {
	const MT = safe(() => sandkit.enums.MatterType) || {};
	const types = (safe(() => api.elements.getRegisteredTypes(), []) || []).slice();
	const items = [];
	for (const rt of types) {
		const id = idOf(rt);
		if (!id || isOurId(id) || tracerTypes.has(rt) || NEVER_CLONE.has(String(id).toLowerCase())) continue;
		const d = defOf(rt);
		if (!d || typeof d.matterType !== "number" || d.matterType === MT.Particle) continue;
		items.push({ rt: rt, id: String(id) });
	}
	// a fixed order, so every copy gets the same number on every launch
	items.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.rt - b.rt));
	const cloneIds = new Set(items.map((i) => i.id));
	let top = Math.max(0, ...types, ...tracerTypes);
	for (const it of items) {
		if (top + 1 > MAX_TYPE) { cloneSkipped++; continue; }
		const def = cloneDefFor(it.rt, it.id, cloneIds);
		if (!def || typeof def.matterType !== "number") continue;
		let r = safe(() => api.elements.register(Object.assign({ id: CLONE_PREFIX + it.id }, def)));
		if (!(r && typeof r.elementType === "number")) {   // fall back to the basics, then patch the rest in
			r = safe(() => api.elements.register({ id: CLONE_PREFIX + it.id, name: def.name, matterType: def.matterType, density: def.density, metaColor: def.metaColor, colors: def.colors, isGrabbable: true, isTransportable: true }));
		}
		if (r && typeof r.elementType === "number") {
			cloneOf.set(it.rt, r.elementType); realOf.set(r.elementType, it.rt); cloneDefs.set(r.elementType, def); tracerTypes.add(r.elementType);
			top = Math.max(top, r.elementType);
		}
	}
	dbg.tracers = tracerTypes.size;
	console.log("[" + MOD_ID + "] tracer copies registered: " + cloneOf.size + " materials" + (cloneSkipped ? " (" + cloneSkipped + " skipped: out of element slots)" : ""));
})();
// updateDefinition only reaches the render/sim workers once they exist, so re-apply
function applyCloneDefs() { for (const [t, def] of cloneDefs) safe(() => api.elements.updateDefinition(t, Object.assign({ nameKey: undefined }, def))); }
const goldT = () => typeOfId("gold");
const isGold = (t) => typeof t === "number" && t === goldT();
const clonable = (t) => typeof t === "number" && cloneOf.has(t) && !isGold(t);

// --- what each material turns into, and what its copy was taught ---------------------
const succ = new Map();          // real type -> Map(next real type -> weight)  (never gold)
const partnersOf = new Map();    // real type -> Set of real types it reacts with on touch
const covered = new Map();       // real type -> Set of partners its copy reacts with by itself
const cloneMachines = new Map(); // real type -> Set of recipe families its copy runs in
const armedKeys = new Map();     // "kind|…" -> signature of what was registered
let reactionsArmed = 0, armErrors = 0, lastArmAt = 0;
function addSucc(a, b, w) {
	if (typeof a !== "number" || typeof b !== "number" || a === b || isGold(b)) return;
	let m = succ.get(a); if (!m) { m = new Map(); succ.set(a, m); }
	m.set(b, Math.max(m.get(b) || 0, typeof w === "number" ? w : 0.01));
}
function addTo(map, k, v) { let s = map.get(k); if (!s) { s = new Set(); map.set(k, s); } s.add(v); }
function recipesTable() { return safe(() => state.sandkit.mods.recipes) || {}; }
// every touch reaction the game knows, as [material, partner, material becomes, partner becomes]
function contactRules() {
	const out = [];
	const T = (id) => typeOfId(id);
	// the game's hard-wired mixing table (sand = the game's "soil")
	for (const [a, b, ao, bo] of [["sand", "water", "wetSand", "wetSand"], ["water", "sand", "wetSand", "wetSand"], ["seed", "water", "wetSeed", null], ["water", "seed", "wetSeed", null],
		["water", "lava", "steam", "lava"], ["lava", "water", "lava", "steam"], ["water", "flame", "steam", null]]) {
		const A = T(a), B = T(b), AO = T(ao), BO = bo === null ? null : T(bo);
		if (typeof A !== "number" || typeof B !== "number" || typeof AO !== "number" || BO === undefined) continue;
		out.push([A, B, AO, BO]);
	}
	// "mixes" written into element definitions
	for (const rt of cloneOf.keys()) {
		const d = defOf(rt), mx = d && Array.isArray(d.mixes) ? d.mixes : [];
		for (const m of mx) {
			if (!m || typeof m.elementType !== "number" || typeof m.result !== "number") continue;
			const sec = typeof m.secondaryResult === "number" ? m.secondaryResult : m.result;
			out.push([rt, m.elementType, m.result, sec]); out.push([m.elementType, rt, m.result, sec]);
		}
	}
	// contact reactions registered by the game's content and by mods
	for (const c of (recipesTable().contacts || [])) {
		if (!c || typeof c.inputA !== "number" || typeof c.inputB !== "number") continue;
		if (tracerTypes.has(c.inputA) || tracerTypes.has(c.inputB)) continue;   // ours
		out.push([c.inputA, c.inputB, c.outputA, c.outputB, c.orientation]);
		if (c.inputA !== c.inputB) out.push([c.inputB, c.inputA, c.outputB, c.outputA, c.orientation]);
	}
	return out;
}
// the product the grain follows: the one made most often, never gold, and one we have a copy of
function mainOut(outs) {
	let best = null;
	for (const o of outs || []) {
		if (!o || !clonable(o.elementType) || NO_POSSESS.has(idOf(o.elementType))) continue;
		if (!best || (o.chance || 0) > (best.chance || 0)) best = o;
	}
	return best;
}
const armedOk = new Set();      // keys whose registration the game accepted
// register once per rule; again only if the rule itself changed; returns whether it is armed
function armOnce(key, sig, fn) {
	if (armedKeys.get(key) === sig) return armedOk.has(key);
	let err = null;
	try { fn(); } catch (e) { err = e; }
	armedKeys.set(key, sig);   // don't retry a refusal every pass
	if (!err) { if (!armedOk.has(key)) reactionsArmed++; armedOk.add(key); return true; }
	if (armedOk.delete(key)) reactionsArmed--;
	armErrors++; console.log("[" + MOD_ID + "] couldn't teach " + key + ": " + (err && err.message ? err.message : err));
	return false;
}
function armCloneReactions() {
	lastArmAt = Date.now();
	const flameT = typeOfId("flame"), lavaT = typeOfId("lava");
	// 1) touch reactions (the first rule found for a pair wins: the game's own table, then mixes, then mods)
	const pairs = new Set();
	for (const [a, b, ao, bo, orient] of contactRules()) {
		if (tracerTypes.has(a) || tracerTypes.has(b) || pairs.has(a + "|" + b)) continue;
		pairs.add(a + "|" + b);
		addTo(partnersOf, a, b);
		const usable = (t) => typeof t === "number" && !isGold(t) && !NO_POSSESS.has(idOf(t));
		const follows = usable(ao) ? ao : usable(bo) ? bo : null;
		if (follows === null) continue;   // only gold / nothing comes out: leave it to the hand-back
		addSucc(a, follows, 1);
		if (!cloneOf.has(a) || !cloneOf.has(follows)) continue;
		const outA = follows === ao ? cloneOf.get(ao) : (ao === undefined ? null : ao), outB = follows === ao ? bo : cloneOf.get(bo);
		const rule = { inputA: cloneOf.get(a), inputB: b, outputA: outA, outputB: outB, orientation: orient === "stacked" ? "stacked" : "any" };
		if (armOnce("contact|" + a + "|" + b, JSON.stringify(rule), () => api.reactions.registerContact(rule))) addTo(covered, a, b);
	}
	// 2) burning (the copies' definitions already carry it)
	for (const [rt, into] of burnsInto) {
		for (const p of [flameT, lavaT]) if (typeof p === "number") { addTo(partnersOf, rt, p); addTo(covered, rt, p); }
		addSucc(rt, into, 1);
	}
	const resT = typeOfId("residue"), brT = typeOfId("burntResidue");
	if (typeof resT === "number" && typeof brT === "number") { addSucc(resT, brT, 0.25); for (const p of [flameT, lavaT]) if (typeof p === "number") addTo(partnersOf, resT, p); }
	for (const rt of cloneOf.keys()) {   // burns away / into gold: still a reason to hand back near fire
		const d = defOf(rt); if (d && d.flammable && !burnsInto.has(rt)) for (const p of [flameT, lavaT]) if (typeof p === "number") addTo(partnersOf, rt, p);
	}
	// 3) machines — every recipe table the game keeps, plus the two it hard-wires
	const R = recipesTable();
	const reg = (family, rec) => api.structures.recipes.register(family, rec);
	for (const [table, family] of [["condensers", "condenser"], ["steamDryers", "steamDryer"], ["synthesizers", "synthesizer"], ["snowmakers", "snowmaker"], ["smelters", "smelter"]]) {
		for (const r of (R[table] || [])) {
			if (!r) continue;
			for (const o of r.outputs || []) addSucc(r.input, o.elementType, o.chance);
			if (!cloneOf.has(r.input)) continue;
			const m = mainOut(r.outputs); if (!m) continue;
			const rec = { input: cloneOf.get(r.input), outputs: [{ elementType: cloneOf.get(m.elementType), chance: 1 }] };
			if (armOnce(family + "|" + r.input, JSON.stringify(rec), () => reg(family, rec))) addTo(cloneMachines, r.input, family);
		}
	}
	const shakers = (R.shakers || []).slice();
	const wetSand = typeOfId("wetSand"), residue = typeOfId("residue"), burnt = typeOfId("burntResidue"), seed = typeOfId("seed"), gold = goldT();
	// the Shaker's own wet soil rule is hard-wired: residue on top, gold below 1 time in 4
	if (typeof wetSand === "number" && !shakers.some((r) => r && r.input === wetSand) && typeof residue === "number" && typeof gold === "number")
		shakers.push({ input: wetSand, outputsAbove: [{ elementType: residue, chance: 1 }], outputsBelow: [{ elementType: gold, chance: 0.25 }] });
	for (const r of shakers) {
		if (!r) continue;
		const all = (r.outputsAbove || []).concat(r.outputsBelow || []);
		for (const o of all) addSucc(r.input, o.elementType, o.chance);
		if (!cloneOf.has(r.input)) continue;
		const m = mainOut(all); if (!m) continue;
		const swap = (list) => (list || []).map((o) => o === m ? { elementType: cloneOf.get(o.elementType), chance: 1 } : { elementType: o.elementType, chance: o.chance });
		const rec = { input: cloneOf.get(r.input), outputsAbove: swap(r.outputsAbove), outputsBelow: swap(r.outputsBelow) };
		const k = "shaker|" + r.input, sig = JSON.stringify(rec);
		if (armOnce(k, sig, () => { try { reg("shaker", rec); } catch (e) { api.structures.processing.registerShaker(rec); } })) addTo(cloneMachines, r.input, "shaker");
	}
	const presses = (R.kineticPresses || []).slice();
	// the Kinetic Press's burnt residue rule is hard-wired: seed and gold. The copy can't
	// carry the game's drop-height check, so it is pressed whenever it lands on the press.
	if (typeof burnt === "number" && !presses.some((r) => r && r.input === burnt) && typeof seed === "number" && typeof gold === "number")
		presses.push({ input: burnt, minimumDownwardVelocity: 0, outputs: [{ elementType: seed, chance: 1 }, { elementType: gold, chance: 1 }] });
	for (const r of presses) {
		if (!r) continue;
		for (const o of r.outputs || []) addSucc(r.input, o.elementType, o.chance);
		if (!cloneOf.has(r.input)) continue;
		const m = mainOut(r.outputs); if (!m) continue;
		const rec = { input: cloneOf.get(r.input), minimumDownwardVelocity: r.input === burnt ? 0 : (r.minimumDownwardVelocity || 0),
			outputs: r.outputs.map((o) => o === m ? { elementType: cloneOf.get(o.elementType), chance: 1 } : { elementType: o.elementType, chance: o.chance }) };
		const k = "kineticPress|" + r.input, sig = JSON.stringify(rec);
		if (armOnce(k, sig, () => reg("kineticPress", rec))) addTo(cloneMachines, r.input, "kineticPress");
	}
	for (const r of (R.growers || [])) {
		if (!r) continue;
		addSucc(r.input, r.output, r.chance);
		if (!cloneOf.has(r.input) || !clonable(r.output) || NO_POSSESS.has(idOf(r.output))) continue;
		const rec = { input: cloneOf.get(r.input), output: cloneOf.get(r.output), chance: 1 };
		const k = "planterBox|" + r.input, sig = JSON.stringify(rec);
		if (armOnce(k, sig, () => reg("planterBox", rec))) addTo(cloneMachines, r.input, "planterBox");
	}
	// 4) the hard-wired steps (only used to know what to look for after a hand-back)
	for (const id in EXTRA_STEPS) { const a = typeOfId(id); if (typeof a !== "number") continue; for (const b of EXTRA_STEPS[id]) addSucc(a, typeOfId(b), 0.5); }
	applyCloneDefs();
	console.log("[" + MOD_ID + "] tracer copies taught " + reactionsArmed + " reactions/recipes" + (armErrors ? " (" + armErrors + " refused)" : ""));
}
// what a material can turn into next (skipping growth stages, which are never ridden)
function nextOf(t) {
	const out = new Map();
	const walk = (x, depth, w) => {
		const m = succ.get(x); if (!m) return;
		for (const [y, wy] of m) {
			if (isGold(y) || tracerTypes.has(y)) continue;
			if (NO_POSSESS.has(idOf(y))) { if (depth < 3) walk(y, depth + 1, w * wy); continue; }
			out.set(y, Math.max(out.get(y) || 0, w * wy));
		}
	};
	walk(t, 0, 1);
	return out;
}
// --- flight recorder ----------------------------------------------------------
// Guessing at why the tracer vanishes hasn't worked, so let the game tell us:
// record every event with position and material, and at the moment it goes
// missing capture the surrounding cells and structures. Exported as JSON from
// the Sandbox Loop panel so the cause can be read instead of guessed.
const LOG_MAX = 500;
let tlog = [];
function logEvt(kind, extra) {
	const e = { t: Date.now(), kind: kind };
	if (trc) { e.x = trc.x; e.y = trc.y; e.mat = matName(trc.orig); e.miss = trc.miss || 0; }
	if (extra) for (const k in extra) e[k] = extra[k];
	tlog.push(e); if (tlog.length > LOG_MAX) tlog.shift();
}
// --- tracker: counts and plain-English notes on what happened to the grain ----
const stats = { journeys: 0, marksAsked: 0, marksLanded: 0, marksMissed: 0, ghosts: 0, jumps: 0, refound: 0, handbacks: 0, pickups: 0, giveups: 0, piles: 0, losses: {}, longestMs: 0, startedAt: Date.now() };
let recentNotes = [];
function track(txt, bad) {
	const d = new Date(), pad = (n) => String(n).padStart(2, "0");
	recentNotes.push({ time: pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()), txt: txt, bad: !!bad });
	if (recentNotes.length > 9) recentNotes.shift();
}
function lossReason(kind) { stats.losses[kind] = (stats.losses[kind] || 0) + 1; }
function speedOf(v) {
	if (!v) return 0;
	if (typeof v === "number") return Math.abs(v);
	const x = +(v.x !== undefined ? v.x : v[0]) || 0, y = +(v.y !== undefined ? v.y : v[1]) || 0;
	return Math.hypot(x, y);
}
// the game's own structures report a number; 0.17 printed them as "#7" and so never
// recognised a Launcher as passive — the grain was handed back on one and lost
function structName(s) {
	if (!s) return null;
	if (typeof s.type === "number") return VANILLA_STRUCTS[s.type] || ("#" + s.type);
	return String(s.type);
}
function structIdAt(x, y) {
	const s = safe(() => api.structures.getAtCell(x, y));
	if (!s) return null;
	return structName(s) + (beltAt(x, y) ? "(belt)" : "");
}
// everything around a cell: materials, structures, and the immediate neighbours
function areaReport(cx, cy, R) {
	const mats = {}, structs = {}, near = [];
	for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
		const x = cx + dx, y = cy + dy, t = typeAt(x, y);
		if (isMat(t)) { const n = matName(t); mats[n] = (mats[n] || 0) + 1; }
		const id = structIdAt(x, y);
		if (id) { structs[id] = (structs[id] || 0) + 1; if (Math.abs(dx) <= 2 && Math.abs(dy) <= 2) near.push(dx + "," + dy + " " + id); }
	}
	return { at: cx + "," + cy, materials: mats, structures: structs, neighbours: near };
}
function exportLog() {
	const payload = { format: "sandustry-tracer-log", build: BUILD, exportedAt: new Date().toISOString(),
		sources: sourcesList(), tracerElementTypes: [...tracerTypes], copies: cloneOf.size, copiesSkipped: cloneSkipped, recipesTaught: reactionsArmed, recipesRefused: armErrors,
		taught: [...armedOk].map((k) => { const p = k.split("|"); return p[0] + ": " + matName(+p[1]) + (p[2] ? " + " + matName(+p[2]) : ""); }),
		stats: stats, notes: recentNotes, events: tlog };
	try {
		const blob = new Blob([JSON.stringify(payload, null, 1)], { type: "application/json" });
		const url = URL.createObjectURL(blob), a = document.createElement("a"), d = new Date(), pad = (n) => String(n).padStart(2, "0");
		a.href = url; a.download = "tracer-log-" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "-" + pad(d.getHours()) + pad(d.getMinutes()) + ".json";
		document.body.appendChild(a); a.click(); a.remove();
		setTimeout(() => URL.revokeObjectURL(url), 5000);
		return "saved " + tlog.length + " events to Downloads";
	} catch (e) { return "export failed: " + (e && e.message ? e.message : e); }
}
let trc = null, possessFails = 0;   // { t, orig, x, y, lastMove, since, hops[], search }
function possess(x, y, matType) {
	const def = safe(() => api.elements.getDefinitionByType(matType)) || {};
	const tt = tracerTypeFor(matType);
	if (tt === undefined) return false;
	// make the tracer look and behave like the grain it is replacing, a shade brighter
	if (!realOf.has(tt)) safe(() => api.elements.updateDefinition(tt, {
		nameKey: undefined, name: "· " + (def.name || "tracer"),
		density: def.density,
		metaColor: brightenMeta(def.metaColor),
		colors: def.colors && def.colors.variants ? { variants: brightenVariants(def.colors.variants) } : undefined,
	}));
	const stray = findTracer(x, y, 130);   // leave no second tracer behind
	if (stray && trc) safe(() => api.elements.replaceAtCell(stray.x, stray.y, realOf.get(stray.t) !== undefined ? realOf.get(stray.t) : trc.orig));
	const ok = safe(() => { api.elements.replaceAtCell(x, y, tt); return true; });
	if (!ok) return false;
	const name = matName(matType);
	const hops = trc ? trc.hops.slice() : [], hopTypes = trc ? (trc.hopTypes || []).slice() : [];
	if (!hops.length || hops[hops.length - 1] !== name) { hops.push(name); hopTypes.push(matType); }
	while (hops.length > 6) { hops.shift(); hopTypes.shift(); }
	trc = { t: tt, orig: matType, x: x, y: y, lastMove: Date.now(), since: Date.now(), pending: true, pendingAt: Date.now(), tries: 0, hops: hops, hopTypes: hopTypes, search: null };
	dbg.note = "possessed " + name + " at " + x + "," + y;
	logEvt("possess", { stray: stray ? (stray.x + "," + stray.y) : null, moving: !!safe(() => api.elements.isFreeFallingAtCell(x, y)), onBelt: !!(beltAt(x, y) || beltAt(x, y + 1)) });
	stats.marksAsked++;
	if (stray) track("cleared a leftover tracer at " + stray.x + "," + stray.y, true);
	return true;
}
// hand the grain back to the factory (never leave our element behind)
function release() {
	if (!trc) return;
	const at = { x: trc.x, y: trc.y }, orig = trc.orig;
	trc = null;
	// the queued swap only applies if the cell hasn't moved on, so sweep a few times
	const put = () => { const f = findTracer(at.x, at.y, 60); if (f) { at.x = f.x; at.y = f.y; const real = realOf.get(f.t) !== undefined ? realOf.get(f.t) : orig; safe(() => api.elements.replaceAtCell(f.x, f.y, real)); return true; } return false; };
	put();
	for (const ms of [200, 600, 1200, 2500]) setTimeout(() => safe(put), ms);
}
// the screensaver is over: just delete our grain (no need to give it back)
function discard() {
	if (!trc) return;
	const at = { x: trc.x, y: trc.y };
	trc = null;
	const del = () => { let f, n = 0; while ((f = findTracer(at.x, at.y, 60)) && n++ < 8) { at.x = f.x; at.y = f.y; safe(() => api.elements.removeAtCell(f.x, f.y)); } };
	del();
	for (const ms of [200, 600, 1200, 2500]) setTimeout(() => safe(del), ms);
}
function findTracer(cx, cy, R) {
	for (let r = 0; r <= R; r++) {
		for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
			if (r && Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
			const t = typeAt(cx + dx, cy + dy);
			if (t !== undefined && t !== null && tracerTypes.has(t)) return { x: cx + dx, y: cy + dy, t: t };
		}
	}
	return null;
}
// Only real reagents count: the partners the game's own reaction tables list for this
// material (and fire/lava for anything that burns). "Touching any other material" was
// far too broad — a grain at a machine's output sits among the machine's other outputs.
const NO_PARTNERS = new Set();
function reagentsOf(orig) { return partnersOf.get(orig) || NO_PARTNERS; }
function touchingOther(x, y, orig) {
	const want = reagentsOf(orig);
	if (!want.size) return 0;
	for (let i = 0; i < 8; i++) {
		const dx = [0, 0, 1, -1, 1, 1, -1, -1][i], dy = [1, -1, 0, 0, 1, -1, 1, -1][i];
		const t = typeAt(x + dx, y + dy);
		if (want.has(t)) return t;
	}
	return 0;
}
function nearestOf(cx, cy, type, R) {
	for (let r = 0; r <= R; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
		if (r && Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
		if (typeAt(cx + dx, cy + dy) === type) return { x: cx + dx, y: cy + dy };
	}
	return null;
}
function grainNearSource(s) {
	for (let y = s.y + 12; y < s.y + 90; y++) for (let x = s.x + 1; x <= s.x + 10; x++) if (typeAt(x, y) === s.type) return { x: x, y: y, type: s.type };
	return null;
}
// Marking a grain that is already falling almost never lands: the swap is applied
// at the sim's next idle moment and by then the grain has moved on. So we ask the
// Source to EMIT the tracer in place of one normal grain — no race, and no extra
// material either (that grain simply isn't emitted).
let waitEmit = null;
function tracerTypeFor(matType) {
	if (cloneOf.has(matType)) return cloneOf.get(matType);
	const def = safe(() => api.elements.getDefinitionByType(matType)) || {};
	const tt = tracerFor.get(def.matterType);
	return tt !== undefined ? tt : tracerFor.values().next().value;
}
function dressTracer(tt, matType) {
	if (realOf.has(tt)) return;   // clones already ARE that material
	const def = safe(() => api.elements.getDefinitionByType(matType)) || {};
	safe(() => api.elements.updateDefinition(tt, {
		nameKey: undefined, name: "· " + (def.name || "tracer"),
		density: def.density,
		metaColor: brightenMeta(def.metaColor),
		colors: def.colors && def.colors.variants ? { variants: brightenVariants(def.colors.variants) } : undefined,
	}));
}
function startTracer(now) {
	const hook = safe(() => window.__brandonSandboxLoop);
	const srcs = sourcesList().filter((s) => s.type != null && s.rate > 0);
	if (!srcs.length) { dbg.note = "no Sources (is Sandbox Loop loaded?)"; return false; }
	if (waitEmit) {   // already asked — see whether it has been emitted yet
		const r = safe(() => hook && hook.emitOnceResult && hook.emitOnceResult());
		if (r && r.at >= waitEmit.asked) {
			// trust what actually happened: which Source emitted it, and as what material
			// (an older Sandbox Loop swapped a grain at whichever Source fired first —
			// the camera then flew hundreds of cells through the terrain to it)
			const material = typeof r.material === "number" ? r.material : waitEmit.material;
			if (r.src && (r.src.x !== waitEmit.src.x || r.src.y !== waitEmit.src.y)) {
				track("asked the Source at " + waitEmit.src.x + "," + waitEmit.src.y + " but the one at " + r.src.x + "," + r.src.y + " emitted it", true);
				logEvt("wrong-source", { asked: waitEmit.src.x + "," + waitEmit.src.y, got: r.src.x + "," + r.src.y });
				if (r.src) waitEmit.src = { x: r.src.x, y: r.src.y };
			}
			if (material !== waitEmit.material) dressTracer(waitEmit.tt, material);
			const name = matName(material);
			trc = { t: waitEmit.tt, orig: material, x: r.x, y: r.y, lastMove: now, since: now, pending: false, tries: 0, hops: [name], hopTypes: [material], search: null };
			dbg.note = "tracer emitted at " + r.x + "," + r.y + " as " + name;
			logEvt("emitted", { src: waitEmit.src.x + "," + waitEmit.src.y, area: areaReport(r.x, r.y, 3) });
			stats.journeys++; track("journey #" + stats.journeys + ": " + name + " from the Source at " + waitEmit.src.x + "," + waitEmit.src.y);
			waitEmit = null; return true;
		}
		if (now - waitEmit.asked > 6000) { safe(() => hook && hook.cancelEmitOnce && hook.cancelEmitOnce()); logEvt("emit-timeout", { src: waitEmit.src.x + "," + waitEmit.src.y }); track("the Source at " + waitEmit.src.x + "," + waitEmit.src.y + " didn't emit the tracer within 6s", true); waitEmit = null; }
		dbg.phase = "waiting for the Source to emit the tracer";
		return false;
	}
	if (!hook || !hook.emitOnce) { dbg.note = "Sandbox Loop is too old for tracer emission"; return false; }
	const s = srcs[Math.floor(Math.random() * srcs.length)];
	const tt = tracerTypeFor(s.type);
	if (tt === undefined) { dbg.note = "no tracer element for that matter type"; return false; }
	dressTracer(tt, s.type);
	safe(() => hook.emitOnce(tt, { x: s.x, y: s.y }));
	waitEmit = { asked: now, tt: tt, material: s.type, src: s };
	dbg.note = "asked " + s.x + "," + s.y + " to emit a " + matName(s.type) + " tracer";
	return false;
}
function snapArea(cx, cy, R) {
	const m = new Map();
	for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const t = typeAt(cx + dx, cy + dy); if (isMat(t)) m.set((cx + dx) + "," + (cy + dy), t); }
	return m;
}
// after handing the grain back: what should we follow now?
function handoff(now) {
	const s = trc.search, R = 20;
	if (now - s.at < 200) return;
	s.at = now;
	// still alive somewhere? then it was never consumed — resume riding it rather
	// than adopting a second grain (which would leave two tracers in the world)
	const alive = findTracer(s.x, s.y, 130);
	if (alive) {
		const gap = Math.round(Math.hypot(alive.x - s.x, alive.y - s.y)), ms = now - s.t0;
		stats.refound++;
		logEvt("refound", { at: alive.x + "," + alive.y, cells: gap, afterMs: ms });
		track("…it wasn't gone: found it " + gap + " cells away after " + (ms / 1000).toFixed(1) + "s" + (s.lostWhy ? " (it had " + s.lostWhy + ")" : ""), true); trc.x = alive.x; trc.y = alive.y; trc.miss = 0; trc.search = null; trc.lastMove = now; dbg.note = "found it again at " + alive.x + "," + alive.y; return; }
	// only a material this one can really turn into (the game's own tables), best first —
	// 0.17 also grabbed "anything new nearby", which is how wet soil became a Copper grain
	const want = nextOf(s.orig);
	const b = snapArea(s.x, s.y, R);
	let hinted = null, hs = -Infinity, same = null, sd = Infinity;
	// LOST (not handed back): the grain most likely just slipped out of sight, so the
	// best guess is the nearest grain of the SAME material (after giving it a moment to
	// reappear — grabbing a second grain too early left two tracers in the world)
	const lostIt = !!s.lostWhy;
	for (const [k, t] of b) {
		if (tracerTypes.has(t)) continue;
		const x = +k.slice(0, k.indexOf(",")), y = +k.slice(k.indexOf(",") + 1), d = Math.hypot(x - s.x, y - s.y);
		if (t === s.orig) { if (lostIt && d < sd) { sd = d; same = { x: x, y: y, t: t }; } continue; }
		if (!want.has(t) || isGold(t)) continue;
		// something new (wasn't there when we let go), the likelier product first, then the nearest
		const fresh = s.before.get(k) !== t ? 1 : 0, score = fresh * 1000 + want.get(t) * 100 - d;
		if (score > hs) { hs = score; hinted = { x: x, y: y, t: t, fresh: fresh }; }
	}
	const settled = (c) => c && !safe(() => api.elements.isFreeFallingAtCell(c.x, c.y));
	const atMachine = lostIt && /gone into|sitting on/.test(s.lostWhy);
	if (lostIt && same && sd <= 12 && now - s.t0 > 1500 && (!atMachine || (!hinted && now - s.t0 > 3000))) {
		stats.pickups++; track("lost it, so picked up the nearest " + matName(same.t) + " " + Math.round(sd) + " cells away at " + same.x + "," + same.y);
		logEvt("pickup", { became: matName(same.t), how: "same material", at: same.x + "," + same.y, cells: Math.round(sd) });
		possess(same.x, same.y, same.t); return;
	}
	// prefer a grain that has come to rest (a falling one is hard to mark); a fresh product over
	// one that was already lying there
	const pick = hinted && (hinted.fresh || now - s.t0 > 2500) && (settled(hinted) || now - s.t0 > 1200) ? hinted : null;
	if (pick) { stats.pickups++; track((s.lostWhy ? "lost it, so " : "") + "picked up " + matName(pick.t) + " (what " + matName(s.orig) + " turns into) at " + pick.x + "," + pick.y); dbg.note = "picked up " + matName(pick.t); logEvt("pickup", { became: matName(pick.t), how: "next step", at: pick.x + "," + pick.y }); possess(pick.x, pick.y, pick.t); return; }
	const waitMs = (s.waitMs || setting("handoffSeconds", 8) * 1000);
	dbg.phase = "waiting for what it becomes (" + Math.ceil((waitMs - (now - s.t0)) / 1000) + "s)";
	if (now - s.t0 > waitMs) { dbg.note = "nothing came out at " + s.x + "," + s.y + " — new journey"; logEvt("giveup", { wanted: [...want.keys()].map(matName), area: areaReport(s.x, s.y, 6) }); stats.giveups++; track("nothing " + matName(s.orig) + " turns into showed up at " + s.x + "," + s.y + " — starting a new journey", true); trc = null; }
}
// the structure at a cell, if it is one that PROCESSES material (not a belt, frame, launcher…)
function machineAt(x, y) {
	const s = safe(() => api.structures.getAtCell(x, y));
	const n = structName(s);
	if (!n || beltAt(x, y) || PASSIVE.test(n)) return null;
	return n;
}
let flameType;
function flameNear(x, y, R) {
	if (flameType === undefined) flameType = typeOfId("flame");
	if (typeof flameType !== "number") return false;
	for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (typeAt(x + dx, y + dy) === flameType) return true;
	return false;
}
function tracerTick(now) {
	if (!tracerTypes.size) { dbg.note = "tracer element not registered"; return null; }
	if (!trc) {
		possessFails = 0;
		if (!startTracer(now)) {
			if (waitEmit) return { x: (waitEmit.src.x + 6) * CELL, y: (waitEmit.src.y + 20) * CELL };   // watch the hopper
			return null;
		}
	}
	if (trc.search) {
		dbg.phase = "waiting for the machine";
		const at = { x: trc.search.x, y: trc.search.y };
		handoff(now);   // may possess a new grain (moves trc) or clear it
		const p = trc && !trc.search ? { x: trc.x, y: trc.y } : at;
		return { x: p.x * CELL + CELL / 2, y: p.y * CELL + CELL / 2 };
	}
	trc.miss = trc.miss || 0;
	const f = findTracer(trc.x, trc.y, 14) || findTracer(trc.x, trc.y, 44) || (trc.miss >= 2 ? findTracer(trc.x, trc.y, 130) : null);
	// burning: for a moment the grain IS a flame (the game's fire code swaps it for a Flame
	// that remembers what to leave behind), then it comes back as the burnt copy — wait for it
	if (!f && !trc.pending && flameNear(trc.x, trc.y, 3)) {
		if (!trc.burnAt) { trc.burnAt = now; logEvt("burning", { onStructure: structIdAt(trc.x, trc.y) || structIdAt(trc.x, trc.y + 1) }); track(matName(trc.orig) + " caught fire — waiting for it to burn"); }
		if (now - trc.burnAt < 6000) { dbg.phase = "burning…"; return { x: trc.x * CELL + CELL / 2, y: trc.y * CELL + CELL / 2 }; }
	}
	if (!f && ++trc.miss < 8) {   // a hitch can move it further than one scan window
		if (trc.miss === 1) logEvt("miss", { area: areaReport(trc.x, trc.y, 4) });
		dbg.phase = "looking for the tracer (" + trc.miss + "/8)";
		return { x: trc.x * CELL + CELL / 2, y: trc.y * CELL + CELL / 2 };
	}
	if (f) { trc.miss = 0; if (trc.burnAt) { stats.burns = (stats.burns || 0) + 1; trc.burnAt = 0; } }
	if (f) {
		// the grain changed INTO another clone (a touch reaction or a machine recipe
		// did it, exactly as it would the real material) — follow the new material
		if (f.t !== undefined && f.t !== trc.t && realOf.has(f.t)) {
			const was = matName(trc.orig), nowReal = realOf.get(f.t), name = matName(nowReal);
			trc.t = f.t;
			if (nowReal !== trc.orig) {
				trc.orig = nowReal; trc.since = now; trc.moved = 0; trc.touchSince = 0;
				if (trc.hops[trc.hops.length - 1] !== name) { trc.hops.push(name); trc.hopTypes.push(nowReal); while (trc.hops.length > 6) { trc.hops.shift(); trc.hopTypes.shift(); } }
				stats.transforms = (stats.transforms || 0) + 1;
				logEvt("became", { from: was, to: name, onStructure: structIdAt(f.x, f.y) });
				track(was + " became " + name + " — still our grain");
			}
		}
		if (trc.pending) { stats.marksLanded++; logEvt("marked", { afterMs: now - (trc.pendingAt || now), tries: trc.tries }); track("marked a " + matName(trc.orig) + " grain" + (trc.tries ? " (took " + (trc.tries + 1) + " tries)" : "")); }
		trc.pending = false;
		const step = Math.max(Math.abs(f.x - trc.x), Math.abs(f.y - trc.y));
		const portal = step > 12 && /quantumPortal/i.test((structIdAt(trc.x, trc.y) || "") + (structIdAt(f.x, f.y) || "") + JSON.stringify(areaReport(f.x, f.y, 2).structures));
		if (portal) { logEvt("teleported", { from: trc.x + "," + trc.y, to: f.x + "," + f.y, cells: step }); track("went through a quantum portal (" + step + " cells)"); }
		else if (step > 12 && now - trc.since > 500) {   // no grain moves that far in one look — a second tracer?
			stats.jumps++;
			logEvt("jump", { from: trc.x + "," + trc.y, to: f.x + "," + f.y, cells: step, area: areaReport(f.x, f.y, 3) });
			track("jumped " + step + " cells in one step (" + trc.x + "," + trc.y + " → " + f.x + "," + f.y + ") — possibly a second tracer", true);
		}
		trc.vel = speedOf(safe(() => api.elements.getVelocityAtCell(f.x, f.y)));
		trc.onBelt = !!(beltAt(f.x, f.y) || beltAt(f.x, f.y + 1));
		trc.maxStep = Math.max(trc.maxStep || 0, step);
		if (now - trc.since > stats.longestMs) stats.longestMs = now - trc.since;
		if (f.x !== trc.x || f.y !== trc.y) {
			if (!trc.trail) trc.trail = [];
			trc.trail.push(f.x + "," + f.y + "@" + (Math.round((now - trc.since) / 100) / 10) + "s");
			if (trc.trail.length > 30) trc.trail.shift();
			trc.moved = (trc.moved || 0) + Math.max(Math.abs(f.x - trc.x), Math.abs(f.y - trc.y));
			trc.x = f.x; trc.y = f.y; trc.lastMove = now;
		}
		dbg.phase = "riding " + matName(trc.orig);
		// Handing the grain back is how we LOSE it (it becomes ordinary material again,
		// indistinguishable from its neighbours), so only do it when there is a reason:
		//   · it is touching something it ought to react with (our element never reacts)
		//   · it is sitting on a machine (a machine will never consume our element)
		// Just being settled in a pile of its own kind is NOT a reason — we keep the
		// tracer and wait for the pile to move, which is what "keep track of it" means.
		const touch = touchingOther(trc.x, trc.y, trc.orig);
		if (touch) { if (!trc.touchSince) trc.touchSince = now; } else trc.touchSince = 0;
		const still = now - trc.lastMove, stillFor = setting("handBackSeconds", 2) * 1000;
		// a newly picked-up grain gets a grace period, and only counts as "at a machine"
		// once it has actually travelled somewhere — an output grain STARTS on the machine
		const settledIn = now - trc.since > 3000, arrived = (trc.moved || 0) >= 4;
		// a clone reacts by itself with the partners the game's mixing table covers —
		// only step in (hand it back) if that somehow hasn't happened after a while
		const selfReacts = realOf.has(trc.t) && touch && covered.has(trc.orig) && covered.get(trc.orig).has(touch);
		const reacting = settledIn && trc.touchSince && now - trc.touchSince > (selfReacts ? 6000 : 1200);
		// only a structure that PROCESSES material counts — frames, launchers and the like
		// just hold or move it (handing back on a clearing frame lost the grain for nothing)
		// the grain sits ON a machine, so look at its own cell and the one below it
		const sid = still > stillFor ? (machineAt(trc.x, trc.y) || machineAt(trc.x, trc.y + 1)) : null;
		// a machine whose recipe the copy was taught processes the grain itself — leave it be
		const fam = familyOf(sid);
		const selfMachine = !!fam && realOf.has(trc.t) && cloneMachines.has(trc.orig) && cloneMachines.get(trc.orig).has(fam);
		const onMachine = settledIn && arrived && !!sid && (!selfMachine || still > 15000);
		// steam, cloud…: the game changes these on a timer that only runs for the real material
		const timed = settledIn && timedReal.has(trc.orig) && still > 4000;
		const pileMs = setting("pileSeconds", 25) * 1000;
		if (reacting) dbg.phase = "touching " + matName(touch) + " — handing back to react";
		else if (onMachine) dbg.phase = "at a machine — handing the grain back";
		else if (timed) dbg.phase = "letting " + matName(trc.orig) + " change on its own";
		else if (selfMachine) dbg.phase = "in the " + sid + " — the machine is processing it";
		else if (still > stillFor) dbg.phase = "settled in " + matName(trc.orig) + " — waiting (" + Math.ceil((pileMs - still) / 1000) + "s)";
		if (still > pileMs && !reacting && !onMachine && !timed) {   // nothing is going to happen here
			dbg.note = "sat in a pile at " + trc.x + "," + trc.y + " — new journey";
			logEvt("pile-giveup", { onStructure: structIdAt(trc.x, trc.y) });
			stats.piles++; track("sat still in a pile for " + Math.round(pileMs / 1000) + "s at " + trc.x + "," + trc.y + " — new journey");
			release(); return null;
		}
		if (reacting || onMachine || timed) {
			const x = trc.x, y = trc.y, orig = trc.orig;
			safe(() => api.elements.replaceAtCell(x, y, orig));
			// a planter grows a whole flower before anything comes out, so wait longer there
			const waitMs = fam === "planterBox" ? 90000 : timed ? 30000 : setting("handoffSeconds", 8) * 1000;
			trc.search = { x: x, y: y, orig: orig, at: now, t0: now, before: snapArea(x, y, 20), waitMs: waitMs };
			const why = reacting ? ("touching " + matName(touch)) : onMachine ? ("on a machine (" + sid + ")") : "changes on a timer";
			dbg.note = "handed " + matName(orig) + " back at " + x + "," + y + " — " + why;
			logEvt("handback", { why: why, onStructure: sid || structIdAt(x, y), wants: [...nextOf(orig).keys()].map(matName) });
			stats.handbacks++; track("handed " + matName(orig) + " back (" + why + ") — watching for " + ([...nextOf(orig).keys()].map(matName).join(" / ") || "what it becomes"));
		}
	} else if (trc && trc.pending) {
		// the mark applies at the sim's next idle moment; until it shows up, keep
		// re-aiming at the nearest grain of the same material (the stream moves)
		dbg.phase = "marking a grain…";
		const g = nearestOf(trc.x, trc.y, trc.orig, 10);
		// re-stamp only every few ticks: each stamp that lands late can leave a stray tracer
		if (g && trc.tries % 4 === 3) { trc.x = g.x; trc.y = g.y; safe(() => api.elements.replaceAtCell(g.x, g.y, trc.t)); }
		if (++trc.tries > 45) {   // ~1.5s of trying: start over from a Source
			stats.marksMissed++; lossReason("the mark never landed (grain kept moving)");
			logEvt("mark-missed", { tries: trc.tries, area: areaReport(trc.x, trc.y, 4) });
			track("couldn't mark a " + matName(trc.orig) + " grain at " + trc.x + "," + trc.y + " — it kept moving", true);
			trc = null; possessFails++;
			if (possessFails < 6) startTracer(now);
			else { dbg.note = "couldn't mark a grain — using the belt route"; return null; }
		}
	} else if (trc) {   // the grain was consumed (a machine, a Remover) — watch where it went
		dbg.phase = "tracer consumed — watching";
		dbg.note = "lost the tracer at " + trc.x + "," + trc.y + " — watching for what came out";
		const stillMs = now - trc.lastMove, st = structIdAt(trc.x, trc.y) || structIdAt(trc.x, trc.y + 1);
		let why, kind;
		if (stillMs > 1000) { why = st && !trc.onBelt ? "been sitting on " + st : "been sitting still (" + (stillMs / 1000).toFixed(1) + "s)"; kind = st && !trc.onBelt ? "sitting on a machine" : "sitting still"; }
		else if (trc.onBelt) { why = "been moving on a belt"; kind = "moving on a belt"; }
		else if (st) { why = "gone into " + st; kind = "going into a structure"; }
		else if (trc.vel > 3) { why = "been flying fast (speed " + trc.vel.toFixed(1) + ")"; kind = "flying fast"; }
		else { why = "been falling / loose"; kind = "falling / loose"; }
		lossReason("vanished while " + kind);
		track("LOST " + matName(trc.orig) + " at " + trc.x + "," + trc.y + " — it had " + why + " (rode " + ((now - trc.since) / 1000).toFixed(1) + "s)", true);
		logEvt("LOST", { why: why, speed: trc.vel, maxStep: trc.maxStep || 0, stillMs: now - trc.lastMove, rodeMs: now - trc.since, onStructure: structIdAt(trc.x, trc.y), trail: (trc.trail || []).slice(-15), area: areaReport(trc.x, trc.y, 6) });
		// the same spot keeps eating it? stop re-picking grains there and start fresh
		lossSpots = lossSpots.filter((p) => now - p.t < 90000); lossSpots.push({ x: trc.x, y: trc.y, t: now });
		const here = lossSpots.filter((p) => Math.abs(p.x - trc.x) <= 16 && Math.abs(p.y - trc.y) <= 16).length;
		if (here >= 3) {
			lossReason("hot spot — lost 3+ times in the same place");
			logEvt("hotspot", { at: trc.x + "," + trc.y, times: here, area: areaReport(trc.x, trc.y, 8) });
			track("keeps losing it around " + trc.x + "," + trc.y + " (" + here + "× in 90s) — starting a new journey", true);
			trc = null; return null;
		}
		trc.search = { x: trc.x, y: trc.y, orig: trc.orig, at: now, t0: now, before: snapArea(trc.x, trc.y, 20), lostWhy: why };
	}
	if (!trc) return null;
	return { x: trc.x * CELL + CELL / 2, y: trc.y * CELL + CELL / 2 };
}
// census: any OTHER tracer cells near the one we follow? (late stamps can leave strays,
// and the camera would jump to them)
let lastCensus = 0, lossSpots = [];
function censusTick(now) {
	if (!trc || trc.search || trc.pending || now - lastCensus < 700) return;
	lastCensus = now;
	const R = 40, extra = [];
	for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
		// right next to it is most likely the SAME grain seen twice while it flies (a moving
		// grain is drawn as a particle linked to it) — turning that back would lose our grain
		if (Math.abs(dx) <= 3 && Math.abs(dy) <= 3) continue;
		const t = typeAt(trc.x + dx, trc.y + dy);
		if (t !== undefined && t !== null && tracerTypes.has(t)) extra.push({ x: trc.x + dx, y: trc.y + dy, t: t });
	}
	if (!extra.length) return;
	stats.ghosts += extra.length;
	logEvt("ghost", { cells: extra.map((c) => c.x + "," + c.y), kinds: extra.map((c) => matName(c.t) + (safe(() => api.elements.getInfoAtCell(c.x, c.y).isParticle) ? " (flying)" : "")) });
	track(extra.length + " extra tracer grain" + (extra.length > 1 ? "s" : "") + " near it (e.g. " + extra[0].x + "," + extra[0].y + ") — turned back into their real material", true);
	const orig = trc.orig;
	for (const c of extra) { const real = realOf.get(c.t) !== undefined ? realOf.get(c.t) : orig; safe(() => api.elements.replaceAtCell(c.x, c.y, real)); }
}
// safety: never leave our element in the world
function sweepTracers() {
	safe(() => { const hook = window.__brandonSandboxLoop; if (hook && hook.cancelEmitOnce) hook.cancelEmitOnce(); });
	waitEmit = null;
	if (trc) discard();
}

// --- belt index ----------------------------------------------------------------
// Probing cells under a Source doesn't work — a Source may drop into a pit, a
// machine or a pile before anything reaches a belt. So index EVERY belt cell on
// the map once per journey (forEachOfType walks the structure list), then start
// from whichever belt is nearest the Source and walk the chain from there.
const BELT_IDS = [["conveyorLeft", -1], ["conveyorRight", 1], ["conveyorLeftMk2", -1], ["conveyorRightMk2", 1],
	["burnerBeltLeft", -1], ["burnerBeltRight", 1], ["filterLeft", -1], ["filterRight", 1], ["filterLeftMk2", -1], ["filterRightMk2", 1]];
let beltCells = new Map(), beltsAt = 0;   // "x,y" -> direction (-1 / +1)
function indexBelts(force) {
	const now = Date.now();
	if (!force && beltCells.size && now - beltsAt < 30000) return beltCells.size;
	const m = new Map();
	let kinds = 0;
	for (const [id, d] of BELT_IDS) {
		let n = 0;
		safe(() => api.structures.forEachOfType(id, (s) => {
			if (typeof s.x !== "number") return;
			// belts are 4x4 structures: index the whole footprint, not just the origin
			for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) m.set((s.x + dx) + "," + (s.y + dy), d);
			n++;
		}));
		if (n) kinds++;
	}
	beltCells = m; beltsAt = now;
	dbg.belts = kinds; dbg.cells = m.size;
	return m.size;
}
function beltAt(x, y) { return beltCells.get(x + "," + y) || 0; }
// the belt to start a journey from: nearest to the Source, preferring one below it
function beltNear(s) {
	let best = null, bd = Infinity;
	for (const [k, d] of beltCells) {
		const i = k.indexOf(","), x = +k.slice(0, i), y = +k.slice(i + 1);
		const dx = x - (s.x + 6), dy = y - (s.y + 12);
		const dist = Math.hypot(dx, dy) * (dy >= 0 ? 1 : 2.5);   // below the hopper is much likelier to be its belt
		if (dist < bd) { bd = dist; best = { x, y, d }; }
	}
	dbg.near = best ? Math.round(bd) : -1;
	return best;
}
// walk the belt network from a starting belt cell into a polyline of cells
function buildPath(start) {
	const pts = []; let x = start.x, y = start.y, dir = start.d, guard = 0;
	const seen = new Set();
	while (guard++ < 4000) {
		const k = x + "," + y; if (seen.has(k)) break; seen.add(k);
		pts.push({ x, y });
		let nx = x + dir, ny = y, nd = beltAt(nx, ny);
		if (!nd) for (const off of [-1, 1, -2, 2]) { const d2 = beltAt(nx, ny + off); if (d2) { ny += off; nd = d2; break; } }
		if (nd) { x = nx; y = ny; dir = nd; continue; }
		// this run ended: material drops to whatever is below (another belt, a machine floor)
		let next = null;
		for (let i = 1; i <= 120 && !next; i++) for (const ox of [0, dir, 2 * dir, -dir, 2, -2]) { const d2 = beltAt(x + ox, y + i); if (d2) next = { x: x + ox, y: y + i, d: d2 }; }
		if (next) { pts.push({ x, y, hold: 1200 }); x = next.x; y = next.y; dir = next.d; continue; }
		// or the run continues a short way ahead (past a machine)
		for (let r = 2; r <= 40 && !next; r++) for (let dy = -r; dy <= r && !next; dy++) {
			const d2 = beltAt(x + dir * r, y + dy);
			if (d2) next = { x: x + dir * r, y: y + dy, d: d2 };
		}
		if (next) { pts.push({ x, y, hold: 2500 }); x = next.x; y = next.y; dir = next.d; continue; }
		pts.push({ x, y, hold: 3500, end: true });
		break;
	}
	return pts;
}
// --- travelling along a path ---------------------------------------------------
let path = null, pathI = 0, pathFrac = 0, holdUntil = 0, pathSrc = null, pathAt = 0;
function newPath(now) {
	if (!indexBelts()) { dbg.note = "no conveyor structures found on the map"; return false; }
	const srcs = sourcesList().filter((s) => s.type != null && s.rate > 0);
	if (!srcs.length) { dbg.note = "no Sources (is Sandbox Loop loaded?)"; return false; }
	const order = srcs.slice().sort(() => Math.random() - 0.5);
	for (const s of order) {
		const b = beltNear(s);
		if (!b) continue;
		const pts = buildPath(b);
		if (pts.length < 3) continue;
		// start at the hopper mouth so the journey begins where the material does
		path = [{ x: s.x + 6, y: s.y + 14 }].concat(pts);
		pathI = 0; pathFrac = 0; holdUntil = 0; pathSrc = s; pathAt = now;
		dbg.path = path.length;
		dbg.note = matName(s.type) + " from " + s.x + "," + s.y + " → belt " + b.x + "," + b.y + " (" + dbg.near + " cells)";
		return true;
	}
	dbg.note = "no usable belt run near any Source";
	return false;
}
function pathTick(now, dt) {
	if (!path && !newPath(now)) return null;
	if (now < holdUntil) { dbg.phase = "holding"; return ptAt(pathI); }
	const speed = Math.max(1, setting("followSpeed", 14));
	let left = speed * dt;
	while (left > 0 && pathI < path.length - 1) {
		const a = path[pathI], b2 = path[pathI + 1], seg = Math.max(0.001, Math.hypot(b2.x - a.x, b2.y - a.y));
		const step = Math.min(left, seg * (1 - pathFrac));
		pathFrac += step / seg; left -= step;
		if (pathFrac >= 0.999) {
			pathI++; pathFrac = 0;
			const p = path[pathI];
			if (p && p.hold) { holdUntil = now + p.hold; dbg.phase = p.end ? "end of the line" : "at a machine"; break; }
		}
	}
	dbg.pos = pathI; dbg.phase = now < holdUntil ? dbg.phase : "following the line";
	if (pathI >= path.length - 1 && now >= holdUntil) {   // finished: take another route
		path = null;
		if (setting("tourStops", false)) return null;         // let a tour stop happen, then a new path
		if (newPath(now)) return ptAt(0);
		return null;
	}
	return ptAt(pathI);
}
function ptAt(i) {
	if (!path) return null;
	const a = path[Math.min(i, path.length - 1)], b2 = path[Math.min(i + 1, path.length - 1)];
	const x = a.x + (b2.x - a.x) * pathFrac, y = a.y + (b2.y - a.y) * pathFrac;
	return { x: x * CELL + CELL / 2, y: y * CELL + CELL / 2 };
}
// --- fallback: no belts at all → drift along the body of material --------------
let fol = null;
const R_BODY = 18, LINK = 3;
function pickFreshGrain() {
	const srcs = sourcesList().filter((s) => s.type != null && s.rate > 0);
	if (!srcs.length) return null;
	for (const s of srcs.slice().sort(() => Math.random() - 0.5)) {
		for (let y = s.y + 12; y < s.y + 80; y++) for (let x = s.x + 1; x <= s.x + 10; x++) {
			if (typeAt(x, y) === s.type) return { cx: x, cy: y, type: s.type, dx: 0, dy: 1, acc: 0, since: Date.now(), lastAt: Date.now(), names: [matName(s.type)] };
		}
	}
	return null;
}
function reachable(cx, cy, type) {
	const R = R_BODY, W = 2 * R + 1, grid = new Uint8Array(W * W), dist = new Int16Array(W * W).fill(-1);
	for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) if (typeAt(cx - R + i, cy - R + j) === type) grid[j * W + i] = 1;
	const q = [R * W + R]; dist[R * W + R] = 0; const out = [];
	while (q.length) {
		const k = q.shift(), i = k % W, j = (k / W) | 0, d = dist[k];
		if (d > 0) out.push({ x: cx - R + i, y: cy - R + j });
		for (let dj = -LINK; dj <= LINK; dj++) for (let di = -LINK; di <= LINK; di++) {
			const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= W || jj >= W) continue;
			const kk = jj * W + ii; if (!grid[kk] || dist[kk] >= 0) continue;
			dist[kk] = d + 1; q.push(kk);
		}
	}
	return out;
}
function bodyTick(now, dt) {
	if (!fol) { fol = pickFreshGrain(); if (!fol) { dbg.phase = "waiting for material"; return null; } }
	const f = fol; f.acc += Math.max(1, setting("followSpeed", 14)) * dt;
	if (f.acc >= 1) {
		const step = Math.min(6, Math.floor(f.acc)); f.acc -= step;
		const cells = reachable(f.cx, f.cy, f.type);
		const dm = Math.hypot(f.dx, f.dy) || 1, ux = f.dx / dm, uy = f.dy / dm;
		let best = null, bs = -Infinity;
		for (const c of cells) {
			const ex = c.x - f.cx, ey = c.y - f.cy, e = Math.hypot(ex, ey), dot = (ex * ux + ey * uy) / e;
			if (dot < -0.15) continue;
			const sc = -Math.abs(e - step) * 2 + dot * 3 + Math.min(e, step);
			if (sc > bs) { bs = sc; best = c; }
		}
		if (best) { const ex = best.x - f.cx, ey = best.y - f.cy, e = Math.hypot(ex, ey) || 1; f.dx = f.dx * 0.6 + (ex / e) * 0.4; f.dy = f.dy * 0.6 + (ey / e) * 0.4; f.cx = best.x; f.cy = best.y; f.lastAt = now; }
		else if (now - f.lastAt > 3000) { fol = null; return null; }
	}
	dbg.phase = "drifting along " + matName(f.type); dbg.path = 0;
	return { x: f.cx * CELL + CELL / 2, y: f.cy * CELL + CELL / 2 };
}
let lastFollowAt = 0;
function followTick(now) {
	const t0 = safe(() => performance.now()) || 0;
	const dt = Math.min(0.5, (now - lastFollowAt) / 1000); lastFollowAt = now;
	let t = null;
	if (setting("useTracer", true)) { t = tracerTick(now); safe(() => censusTick(now)); }
	if (!t) { t = pathTick(now, dt); if (!t && !path) t = bodyTick(now, dt); }
	dbg.ms = (safe(() => performance.now()) || 0) - t0;
	return t;
}
let cam = null;   // smoothed camera position (view centre, world px)
function tick() {
	if (!active) return;
	if (!inWorld()) { stop("left world"); return; }
	const now = Date.now();
	// follow mode: ride a grain; after followMaxSeconds hand over to one tour leg (if mixing) or a fresh grain
	if (setting("followGrain", true) && !tour) {
		// 0 = follow a grain for as long as it lasts (the default now: the old 90s limit
		// glided the camera off to a tour stop in a straight line through the terrain,
		// always at about the same point on the route, which looked like losing it)
		const maxSec = setting("rideLimitSeconds", 0), maxMs = maxSec > 0 ? maxSec * 1000 : Infinity;
		const longRide = trc && now - trc.since > maxMs;
		if (longRide || (path && now - pathAt > maxMs)) {
			if (longRide) { track("ride limit (" + maxSec + "s) reached — letting go of the grain"); release(); }
			path = null; fol = null;
			if (setting("tourStops", false)) { tour = nextLeg(); cam = null; if (tour) track("gliding to a tour stop — straight line, not following anything", true); }
		}
		const t = !tour ? followTick(now) : null;
		if (t) {
			if (!cam) cam = camNow();
			const k = 0.12; cam = { x: cam.x + (t.x - cam.x) * k, y: cam.y + (t.y - cam.y) * k };
			state.session.overrideCamera = toCam(cam);
			return;
		}
		// nothing to follow for a moment (between journeys): hold still rather than
		// gliding off to a tour stop — unless tour stops are switched on
		if (!tour && !setting("tourStops", false)) return;
		if (!tour) { tour = nextLeg(); if (tour) track("nothing to follow — gliding to a tour stop", true); }
	}
	if (!tour) tour = nextLeg();
	if (!tour) return;
	const el = now - tour.t0;
	let x, y;
	if (el < tour.moveMs) { const k = ease(el / tour.moveMs); x = tour.from.x + (tour.to.x - tour.from.x) * k; y = tour.from.y + (tour.to.y - tour.from.y) * k; }
	else {
		const d = (el - tour.moveMs) / tour.dwellMs;   // slow figure-of-eight drift while dwelling
		x = tour.to.x + Math.sin(tour.drift.a + d * Math.PI * 2) * tour.drift.r;
		y = tour.to.y + Math.sin(tour.drift.a * 2 + d * Math.PI * 4) * tour.drift.r * 0.5;
		if (d >= 1) { tour = null; cam = null; }
	}
	state.session.overrideCamera = toCam({ x, y });
}

function start(reason) {
	if (active || !inWorld() || !setting("enabled", true)) return;
	active = true; startedAt = Date.now(); tour = null; fol = null; cam = null; path = null; trc = null; waitEmit = null; indexBelts(true);
	safe(armCloneReactions);
	graceUntil = Date.now() + (reason === "menu" ? 2500 : 0);   // started by hand (panel button): ignore the mouse settling after the click
	saved = {
		hud: !!safe(() => state.session.ui.hudHidden),
		fps: safe(() => state.session.settings.frameRateCap),
		windowMode: safe(() => state.session.settings.windowMode),
		override: state.session.overrideCamera,
	};
	buildPois();
	// hide the HUD (the game's own hotkey does exactly this) and the cursor
	if (setting("hideHud", true)) { safe(() => { state.session.ui.hudHidden = true; }); safe(() => api.ui.update(ComponentId.Root)); }
	if (setting("hideCursor", true)) safe(() => { styleEl = document.createElement("style"); styleEl.textContent = "*{cursor:none !important}"; document.head.appendChild(styleEl); });
	// power: cap the frame rate, optionally slow the simulation
	const fps = setting("fpsCap", 30); if (fps > 0) safe(() => { state.session.settings.frameRateCap = fps; });
	const spd = setting("simSpeed", 1); if (spd > 0 && spd !== 1) postSimSpeed(spd);
	// fullscreen if asked and not already
	if (setting("fullscreen", true) && saved.windowMode !== "fullscreen") safe(() => window.electron.setFullscreen(true));
	// keep the screen on
	safe(() => navigator.wakeLock.request("screen").then((l) => { wakeLock = l; }).catch(() => {}));
	safe(() => window.localStorage.setItem(ACTIVE_KEY, "1"));
	console.log("[" + MOD_ID + "] started (" + reason + ") — " + pois.length + " points of interest");
	if (repaint) repaint((v) => v + 1);
}
function stop(reason) {
	if (!active) return;
	// hand over the evidence automatically if anything went wrong during this run
	const troubles = tlog.filter((e) => e.t >= startedAt && /LOST|jump|ghost|mark-missed|giveup/.test(e.kind)).length;
	if (troubles && setting("saveLogOnStop", true)) setTimeout(() => safe(exportLog), 300);
	active = false; tour = null; fol = null; cam = null; path = null; sweepTracers();
	safe(() => { state.session.overrideCamera = saved && saved.override ? saved.override : false; });
	safe(() => { state.session.ui.hudHidden = saved ? saved.hud : false; }); safe(() => api.ui.update(ComponentId.Root));
	if (styleEl) { safe(() => styleEl.remove()); styleEl = null; }
	if (saved) {
		safe(() => { state.session.settings.frameRateCap = typeof saved.fps === "number" ? saved.fps : 0; });
		if (setting("fullscreen", true) && saved.windowMode !== "fullscreen") safe(() => window.electron.setFullscreen(false));
	}
	postSimSpeed(1);
	if (wakeLock) { safe(() => wakeLock.release()); wakeLock = null; }
	safe(() => window.localStorage.setItem(ACTIVE_KEY, "0"));
	lastInput = Date.now();   // don't restart immediately
	console.log("[" + MOD_ID + "] stopped (" + reason + ") after " + Math.round((Date.now() - startedAt) / 1000) + "s");
	if (repaint) repaint((v) => v + 1);
}
const SIM_SPEED_MSG = 68;   // worker message id for SetSimulationSpeed (v0.5.6)
function postSimSpeed(m) { safe(() => { const mgr = state.environment.multithreading.simulation.manager; if (mgr && mgr.postMessage) mgr.postMessage([SIM_SPEED_MSG, m]); }); }

// --- scheduler ----------------------------------------------------------------
let autoContinued = false, continueAt = 0;
setInterval(() => {
	if (!setting("enabled", true)) { if (active) stop("disabled"); return; }
	if (active) return;
	const menuIdle = setting("menuIdleSeconds", 20);
	if (atMenu()) {
		// launched and left alone (the idle task, or you walked away at the menu): press Continue
		if (menuIdle > 0 && !everInput && !autoContinued && idleMs() > menuIdle * 1000) {
			const btn = document.getElementById("main-menu-continue");
			if (btn) { autoContinued = true; continueAt = Date.now(); btn.click(); console.log("[" + MOD_ID + "] pressed Continue at the main menu"); }
		}
		return;
	}
	if (!inWorld()) return;
	if (autoContinued && !everInput && Date.now() - continueAt > 4000) { start("auto-continued"); return; }
	if (idleMs() > setting("idleMinutes", 10) * 60000) start("idle");
}, 1000);
setInterval(tick, 33);
setInterval(() => { if (!active && trc) { dbg.note = "cleanup: removing the tracer grain"; discard(); } }, 2000);
safe(() => window.addEventListener("beforeunload", () => safe(discard)));
// safety: if the page is hidden (alt-tabbed / minimized) the wake lock is released by the browser; re-take it when visible
safe(() => document.addEventListener("visibilitychange", () => { if (active && document.visibilityState === "visible" && !wakeLock) safe(() => navigator.wakeLock.request("screen").then((l) => { wakeLock = l; }).catch(() => {})); }));

// --- hook for other mods (the Sandbox Loop panel has a "Start now" button) ----
safe(() => { window.__brandonScreensaver = {
	build: BUILD,
	isActive: () => active,
	exportLog: () => exportLog(),
	logSize: () => tlog.length,
	stop: () => stop("hook"),
	// returns a short status string so the Sandbox Loop button can say what happened
	start: () => {
		if (!setting("enabled", true)) return "the Screensaver mod is switched off in its settings";
		if (!inWorld()) return "not in a world";
		if (active) { return "already running"; }
		start("menu");
		return active ? "" : "start refused";
	},
}; });

// --- tiny status pill (only while the saver is NOT active; hidden with the HUD) --
let repaint = null, captionRepaint = null;
const CAP = { position: "fixed", left: "50%", bottom: "28px", transform: "translateX(-50%)", zIndex: 99997, pointerEvents: "none", font: '600 12px -apple-system,"Segoe UI",Roboto,sans-serif', color: "#cfd7e0", background: "rgba(10,14,20,0.55)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "999px", padding: "4px 12px", letterSpacing: ".02em" };
function Caption() {
	const [, b] = React.useState(0); captionRepaint = b;
	if (!active || !setting("showCaption", true)) return null;
	const what = trc ? trc.hops.join(" → ") : (pathSrc ? matName(pathSrc.type) : (fol ? fol.names[fol.names.length - 1] : null));
	if (!what) return null;
	return h("div", { style: CAP }, "following " + what + "  ·  " + dbg.phase);
}
if (h) { safe(() => api.ui.inject("brandon-screensaver-caption", Caption)); setInterval(() => { if (captionRepaint) captionRepaint((v) => v + 1); }, 500); }
// what the game reports at the cell the camera is on — tells us whether belts are
// being recognised at all, and in what form (numeric type vs string id)
function probeUnderCam() {
	if (!cam) return "-";
	const cx = Math.round(cam.x / CELL), cy = Math.round(cam.y / CELL), out = [];
	for (let dy = -1; dy <= 2; dy++) {
		const s = safe(() => api.structures.getAtCell(cx, cy + dy));
		if (s) { out.push((dy >= 0 ? "+" : "") + dy + ":" + (typeof s.type === "number" ? "#" + s.type : s.type) + (beltAt(cx, cy + dy) ? "(BELT)" : "")); }
	}
	const m = typeAt(cx, cy);
	return (out.length ? out.join(" ") : "no structure") + "   material:" + (isMat(m) ? matName(m) : "-");
}
let dbgRepaint = null;
function Debug() {
	const [, b] = React.useState(0); dbgRepaint = b;
	if (!setting("debugOverlay", false) || !inWorld()) return null;
	const srcs = sourcesList();
	const lines = [
		"screensaver " + BUILD + (active ? "  ACTIVE" : "  idle (" + Math.ceil(Math.max(0, setting("idleMinutes", 10) * 60000 - idleMs()) / 1000) + "s)"),
		"phase: " + dbg.phase,
		"note: " + dbg.note,
		"tracer: " + (trc ? matName(trc.orig) + " @" + trc.x + "," + trc.y + (trc.search ? " [handed back]" : "") + (trc.miss ? "  misses " + trc.miss : "") : "none") + "   elements: " + dbg.tracers,
		"belt kinds: " + dbg.belts + "  belt cells: " + dbg.cells + "  nearest to src: " + dbg.near + "   path: " + dbg.path + " at " + dbg.pos,
		"cam: " + (cam ? Math.round(cam.x / CELL) + "," + Math.round(cam.y / CELL) : "-") + "   scan " + dbg.ms.toFixed(1) + "ms",
		"sources: " + (srcs.length ? srcs.map((s) => s.x + "," + s.y + " " + matName(s.type) + " @" + s.rate + "/s").join(" | ") : "none — is Sandbox Loop loaded?"),
		"under cam: " + probeUnderCam(),
	];
	return h("div", { style: { position: "fixed", left: "12px", top: "12px", zIndex: 99999, pointerEvents: "none", font: '600 11px ui-monospace,Consolas,monospace', color: "#e8edf3", background: "rgba(10,14,20,0.82)", border: "1px solid rgba(255,255,255,0.18)", borderRadius: "6px", padding: "6px 9px", whiteSpace: "pre", lineHeight: 1.5, maxWidth: "620px" } }, lines.join("\n"));
}
if (h) { safe(() => api.ui.inject("brandon-screensaver-debug", Debug)); setInterval(() => { if (dbgRepaint) dbgRepaint((v) => v + 1); }, 250); }
// --- tracker panel: what the tracer is doing, and every time it loses the grain, why --
let trkRepaint = null;
const TRK = { position: "fixed", right: "12px", top: "46px", zIndex: 99998, pointerEvents: "none", width: "400px", font: '500 11px ui-monospace,Consolas,monospace', color: "#dfe6ee", background: "rgba(10,14,20,0.8)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: "6px", padding: "7px 10px", lineHeight: 1.45 };
function Tracker() {
	const [, b] = React.useState(0); trkRepaint = b;
	if (!setting("showTracker", true) || !inWorld() || !(active || setting("debugOverlay", false))) return null;
	const now = Date.now(), secs = (ms) => (ms / 1000).toFixed(1) + "s";
	let state;
	if (tour) state = "TOUR STOP — gliding in a straight line, not following a grain";
	else if (!trc) state = waitEmit ? "waiting for a Source to emit the tracer" : "between journeys";
	else if (trc.search) state = (trc.search.lostWhy ? "LOST — searching" : "handed back — watching the machine") + " at " + trc.search.x + "," + trc.search.y + " (" + secs(now - trc.search.t0) + ")";
	else if (trc.pending) state = "marking a " + matName(trc.orig) + " grain… (try " + (trc.tries + 1) + ")";
	else if (trc.miss) state = "can't see it — looking (" + trc.miss + "/8) near " + trc.x + "," + trc.y;
	else state = "riding " + matName(trc.orig) + " " + secs(now - trc.since) + " · " + (trc.moved || 0) + " cells" + (trc.onBelt ? " · on a belt" : "");
	const lost = Object.values(stats.losses).reduce((a, n) => a + n, 0);
	const row = (txt, color, weight) => h("div", { style: { color: color || undefined, fontWeight: weight || undefined } }, txt);
	const kids = [
		row("TRACKER  ·  build " + BUILD, "#8fb3d9", 700),
		row("now: " + state, trc && !trc.search && !trc.miss && !trc.pending ? "#9fe0a8" : "#f2c46b"),
		row("journeys " + stats.journeys + " · grains marked " + stats.marksLanded + "/" + stats.marksAsked + " · lost " + lost + " · re-found " + stats.refound),
		row("copies " + cloneOf.size + (cloneSkipped ? " (" + cloneSkipped + " skipped)" : "") + " · recipes taught " + reactionsArmed + (armErrors ? " (" + armErrors + " refused)" : "") + " · changes followed " + (stats.transforms || 0) + " · burns " + (stats.burns || 0)),
		row("jumps " + stats.jumps + " · extra tracers " + stats.ghosts + " · hand-backs " + stats.handbacks + " · longest ride " + secs(stats.longestMs)),
	];
	const reasons = Object.entries(stats.losses).sort((a, b2) => b2[1] - a[1]);
	if (reasons.length) {
		kids.push(row("why it was lost:", "#8fb3d9", 700));
		for (const [k, n] of reasons) kids.push(row("  " + n + "×  " + k, "#f2c46b"));
	}
	if (recentNotes.length) {
		kids.push(row("recent:", "#8fb3d9", 700));
		for (const e of recentNotes.slice().reverse()) kids.push(h("div", { style: { color: e.bad ? "#f2a36b" : "#c9d2dc", whiteSpace: "normal", paddingLeft: "6px", textIndent: "-6px" } }, e.time + "  " + e.txt));
	}
	return h("div", { style: TRK }, kids);
}
if (h) { safe(() => api.ui.inject("brandon-screensaver-tracker", Tracker)); setInterval(() => { if (trkRepaint) trkRepaint((v) => v + 1); }, 300); }
// the one way out, spelled out in the corner
let tipRepaint = null;
function ExitTip() {
	const [, b] = React.useState(0); tipRepaint = b;
	if (!active) return null;
	return h("div", { style: { position: "fixed", right: "12px", top: "12px", zIndex: 99999, pointerEvents: "none", font: '600 12px -apple-system,"Segoe UI",Roboto,sans-serif', color: "#dfe6ee", background: "rgba(10,14,20,0.6)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: "6px", padding: "4px 10px", letterSpacing: ".02em" } },
		"press ", h("span", { style: { display: "inline-block", minWidth: "16px", textAlign: "center", padding: "0 5px", margin: "0 2px", border: "1px solid rgba(255,255,255,0.45)", borderRadius: "4px", fontWeight: 700 } }, "E"), " to exit");
}
if (h) { safe(() => api.ui.inject("brandon-screensaver-exittip", ExitTip)); setInterval(() => { if (tipRepaint) tipRepaint((v) => v + 1); }, 500); }
function Pill() {
	const [, b] = React.useState(0); repaint = b;
	if (!setting("enabled", true) || !setting("showStatus", true) || !inWorld() || active) return null;
	const left = Math.max(0, setting("idleMinutes", 10) * 60000 - idleMs());
	return h("div", { title: "Sandustry Screensaver: starts after " + setting("idleMinutes", 10) + " min without input. Press E to exit it.", style: { position: "fixed", right: "12px", bottom: "12px", zIndex: 99997, pointerEvents: "none", font: '600 10px -apple-system,"Segoe UI",Roboto,sans-serif', color: "#8a94a0", background: "rgba(10,14,20,0.6)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "6px", padding: "2px 7px" } },
		"🌙 screensaver in " + Math.ceil(left / 60000) + "m");
}
if (h) { safe(() => api.ui.inject("brandon-screensaver-pill", Pill)); setInterval(() => { if (repaint) repaint((v) => v + 1); }, 15000); }

// Teach the copies after the game's content (and other mods) have registered their recipes;
// look again for a while, since some mods add recipes late. Only new or changed rules are sent.
safe(() => api.events.on("game:ready", () => { indexBelts(true); safe(armCloneReactions); }));
for (const ms of [3000, 9000, 20000, 45000]) setTimeout(() => safe(() => { if (inWorld()) armCloneReactions(); }), ms);
setInterval(() => safe(() => { if (inWorld() && Date.now() - lastArmAt > 60000) armCloneReactions(); }), 15000);
setTimeout(() => safe(() => indexBelts(true)), 8000);
console.log("[" + MOD_ID + "] loaded — build " + BUILD);
