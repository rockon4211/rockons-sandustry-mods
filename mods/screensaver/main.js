// Sandustry Screensaver — after N minutes without input the world becomes a
// screensaver: the HUD hides, the cursor disappears, the camera drifts between
// the busiest spots on the map (your machines, belts, buffers…), the frame
// rate is capped and the simulation optionally slowed so it costs little
// power, and a screen wake-lock keeps the monitor from blanking. Any key,
// click, wheel or real mouse movement restores everything exactly as it was.
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
function noteInput() { lastInput = Date.now(); everInput = true; if (active && Date.now() > graceUntil) stop("input"); }
safe(() => {
	const opts = { capture: true, passive: true };
	window.addEventListener("keydown", noteInput, opts);
	window.addEventListener("mousedown", noteInput, opts);
	window.addEventListener("wheel", noteInput, opts);
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
const BUILD = "0.10.0";
const EMPTY = safe(() => sandkit.enums.ElementType.Empty);
const typeAt = (x, y) => safe(() => api.elements.getResolvedTypeAtCell(x, y));
const isMat = (t) => t !== undefined && t !== null && t !== EMPTY;
function sourcesList() { const hook = safe(() => window.__brandonSandboxLoop); return (hook && hook.sources && hook.sources()) || []; }
function matName(t) { return safe(() => api.elements.getNameByType(t)) || ("type " + t); }
let dbg = { phase: "idle", note: "-", tracers: 0, belts: 0, cells: 0, near: -1, path: 0, pos: 0, ms: 0 };

// --- the tracer ----------------------------------------------------------------
// We can't tell two grains of soil apart — but we CAN make one of them unique.
// The mod registers its own element (one per matter type, so physics match) and
// POSSESSES a real grain: that cell becomes the tracer, keeping the material's
// density and a slightly brighter version of its colour, so it rides belts,
// falls and flows exactly like the grain it replaced. Nothing is added to the
// factory — one grain is borrowed and handed back.
//
// A machine won't accept a foreign element, so when the tracer stops moving we
// hand the grain back (it becomes its real material again and the machine eats
// it normally), watch the spot, and possess whatever comes out: a material the
// crafting chain says it should become, or failing that whatever new material
// appears. That's how one journey runs soil → wet soil → gold → liquid gold.
const CHAIN = {"wetSand":["gold","residue"],"sand":["wetSand"],"residue":["burntResidue"],"gold":["liquidGold"],"copper":["liquidCopper"],"water":["steam","freezingIce"],"steam":["water"],"sunsand":["wetSand"],"seed":["wetSeed"],"wetSeed":["seedling"],"seedling":["petalium"],"petalium":["dryPetalium"],"dryPetalium":["florin"],"florin":["florinol","gold"],"lava":["basalt"],"fire":["flame"],"moonhop":["prismite"],"prismite":["prismaline"],"voidSeeds":["growingVoidSeed"],"burntResidue":["seed","gold"],"florinol":["aurixite"],"aurixite":["auralite"]};
const TRACER_KINDS = [["brandonTracerPowder", "Powder", 1600], ["brandonTracerLiquid", "Liquid", 1000], ["brandonTracerGas", "Gas", 2], ["brandonTracerSolid", "Solid", 2000], ["brandonTracerSlushy", "Slushy", 1300]];
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
function brightChan(v) { return Math.max(0, Math.min(255, Math.round(v * 0.55 + 118))); }
function brightenVariants(vs) { return (vs || []).map((c) => [brightChan(c[0]), brightChan(c[1]), brightChan(c[2]), c.length > 3 ? c[3] : 255]); }
function brightenMeta(n) {
	if (typeof n !== "number") return 0xffffff;
	return (brightChan((n >> 16) & 255) << 16) | (brightChan((n >> 8) & 255) << 8) | brightChan(n & 255);
}
let trc = null, possessFails = 0;   // { t, orig, x, y, lastMove, since, hops[], search }
function possess(x, y, matType) {
	const def = safe(() => api.elements.getDefinitionByType(matType)) || {};
	const tt = tracerFor.get(def.matterType) !== undefined ? tracerFor.get(def.matterType) : tracerFor.values().next().value;
	if (tt === undefined) return false;
	// make the tracer look and behave like the grain it is replacing, a shade brighter
	safe(() => api.elements.updateDefinition(tt, {
		nameKey: undefined, name: "· " + (def.name || "tracer"),
		density: def.density, metaColor: brightenMeta(def.metaColor),
		colors: def.colors && def.colors.variants ? { variants: brightenVariants(def.colors.variants) } : undefined,
	}));
	const stray = findTracer(x, y, 130);   // leave no second tracer behind
	if (stray && trc) safe(() => api.elements.replaceAtCell(stray.x, stray.y, trc.orig));
	const ok = safe(() => { api.elements.replaceAtCell(x, y, tt); return true; });
	if (!ok) return false;
	const name = matName(matType);
	const hops = trc ? trc.hops.slice() : [], hopTypes = trc ? (trc.hopTypes || []).slice() : [];
	if (!hops.length || hops[hops.length - 1] !== name) { hops.push(name); hopTypes.push(matType); }
	while (hops.length > 6) { hops.shift(); hopTypes.shift(); }
	trc = { t: tt, orig: matType, x: x, y: y, lastMove: Date.now(), since: Date.now(), pending: true, pendingAt: Date.now(), tries: 0, hops: hops, hopTypes: hopTypes, search: null };
	dbg.note = "possessed " + name + " at " + x + "," + y;
	return true;
}
// hand the grain back to the factory (never leave our element behind)
function release() {
	if (!trc) return;
	const at = { x: trc.x, y: trc.y }, orig = trc.orig;
	trc = null;
	// the queued swap only applies if the cell hasn't moved on, so sweep a few times
	const put = () => { const f = findTracer(at.x, at.y, 60); if (f) { at.x = f.x; at.y = f.y; safe(() => api.elements.replaceAtCell(f.x, f.y, orig)); return true; } return false; };
	put();
	for (const ms of [200, 600, 1200, 2500]) setTimeout(() => safe(put), ms);
}
function findTracer(cx, cy, R) {
	for (let r = 0; r <= R; r++) {
		for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
			if (r && Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
			const t = typeAt(cx + dx, cy + dy);
			if (t !== undefined && t !== null && tracerTypes.has(t)) return { x: cx + dx, y: cy + dy };
		}
	}
	return null;
}
function touchingOther(x, y, orig) {
	for (let i = 0; i < 8; i++) {
		const dx = [0, 0, 1, -1, 1, 1, -1, -1][i], dy = [1, -1, 0, 0, 1, -1, 1, -1][i];
		const t = typeAt(x + dx, y + dy);
		if (isMat(t) && t !== orig && !tracerTypes.has(t)) return t;
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
	const def = safe(() => api.elements.getDefinitionByType(matType)) || {};
	const tt = tracerFor.get(def.matterType);
	return tt !== undefined ? tt : tracerFor.values().next().value;
}
function dressTracer(tt, matType) {
	const def = safe(() => api.elements.getDefinitionByType(matType)) || {};
	safe(() => api.elements.updateDefinition(tt, {
		nameKey: undefined, name: "· " + (def.name || "tracer"),
		density: def.density, metaColor: brightenMeta(def.metaColor),
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
			const name = matName(waitEmit.material);
			trc = { t: waitEmit.tt, orig: waitEmit.material, x: r.x, y: r.y, lastMove: now, since: now, pending: false, tries: 0, hops: [name], hopTypes: [waitEmit.material], search: null };
			dbg.note = "tracer emitted at " + r.x + "," + r.y + " as " + name;
			waitEmit = null; return true;
		}
		if (now - waitEmit.asked > 6000) { safe(() => hook && hook.cancelEmitOnce && hook.cancelEmitOnce()); waitEmit = null; }
		dbg.phase = "waiting for the Source to emit the tracer";
		return false;
	}
	if (!hook || !hook.emitOnce) { dbg.note = "Sandbox Loop is too old for tracer emission"; return false; }
	const s = srcs[Math.floor(Math.random() * srcs.length)];
	const tt = tracerTypeFor(s.type);
	if (tt === undefined) { dbg.note = "no tracer element for that matter type"; return false; }
	dressTracer(tt, s.type);
	safe(() => hook.emitOnce(tt));
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
	if (alive) { trc.x = alive.x; trc.y = alive.y; trc.miss = 0; trc.search = null; trc.lastMove = now; dbg.note = "found it again at " + alive.x + "," + alive.y; return; }
	const want = new Set();
	for (const id of (CHAIN[idOf(s.orig)] || [])) { const t = typeOfId(id); if (typeof t === "number") want.add(t); }
	const b = snapArea(s.x, s.y, R);
	// don't walk the chain backwards into what we just came from
	const recent = new Set((trc.hopTypes || []).slice(-2));
	let hinted = null, hd = Infinity, other = null, od = Infinity;
	for (const [k, t] of b) {
		if (t === s.orig || tracerTypes.has(t)) continue;
		if (recent.has(t) && !want.has(t) && now - s.t0 < 3000) continue;
		const x = +k.slice(0, k.indexOf(",")), y = +k.slice(k.indexOf(",") + 1), d = Math.hypot(x - s.x, y - s.y);
		if (want.has(t) && d < hd) { hd = d; hinted = { x: x, y: y, t: t }; }
		if (s.before.get(k) !== t && d < od) { od = d; other = { x: x, y: y, t: t }; }
	}
	const settled = (c) => c && !safe(() => api.elements.isFreeFallingAtCell(c.x, c.y));
	const pick = (settled(hinted) ? hinted : null) || (settled(other) && now - s.t0 > 800 ? other : null) || hinted || (now - s.t0 > 1800 ? other : null);
	if (pick) { dbg.note = "picked up " + matName(pick.t) + (hinted ? " (chain)" : " (new material)"); possess(pick.x, pick.y, pick.t); return; }
	const waitMs = setting("handoffSeconds", 8) * 1000;
	dbg.phase = "waiting for what it becomes (" + Math.ceil((waitMs - (now - s.t0)) / 1000) + "s)";
	if (now - s.t0 > waitMs) { dbg.note = "nothing came out at " + s.x + "," + s.y + " — new journey"; trc = null; }
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
	if (!f && ++trc.miss < 8) {   // a hitch can move it further than one scan window
		dbg.phase = "looking for the tracer (" + trc.miss + "/8)";
		return { x: trc.x * CELL + CELL / 2, y: trc.y * CELL + CELL / 2 };
	}
	if (f) trc.miss = 0;
	if (f) {
		trc.pending = false;
		if (f.x !== trc.x || f.y !== trc.y) { trc.x = f.x; trc.y = f.y; trc.lastMove = now; }
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
		const reacting = trc.touchSince && now - trc.touchSince > 1200;
		const onMachine = still > stillFor && !!safe(() => api.structures.getAtCell(trc.x, trc.y)) && !beltAt(trc.x, trc.y);
		const pileMs = setting("pileSeconds", 25) * 1000;
		if (reacting) dbg.phase = "touching " + matName(touch) + " — handing back to react";
		else if (onMachine) dbg.phase = "at a machine — handing the grain back";
		else if (still > stillFor) dbg.phase = "settled in " + matName(trc.orig) + " — waiting (" + Math.ceil((pileMs - still) / 1000) + "s)";
		if (still > pileMs && !reacting && !onMachine) {   // nothing is going to happen here
			dbg.note = "sat in a pile at " + trc.x + "," + trc.y + " — new journey";
			release(); return null;
		}
		if (reacting || onMachine) {
			const x = trc.x, y = trc.y, orig = trc.orig;
			safe(() => api.elements.replaceAtCell(x, y, orig));
			trc.search = { x: x, y: y, orig: orig, at: now, t0: now, before: snapArea(x, y, 20) };
			dbg.note = "handed " + matName(orig) + " back at " + x + "," + y + (reacting ? " (to react)" : " (stalled)");
		}
	} else if (trc && trc.pending) {
		// the mark applies at the sim's next idle moment; until it shows up, keep
		// re-aiming at the nearest grain of the same material (the stream moves)
		dbg.phase = "marking a grain…";
		const g = nearestOf(trc.x, trc.y, trc.orig, 10);
		if (g) { trc.x = g.x; trc.y = g.y; safe(() => api.elements.replaceAtCell(g.x, g.y, trc.t)); }
		if (++trc.tries > 45) {   // ~1.5s of trying: start over from a Source
			trc = null; possessFails++;
			if (possessFails < 6) startTracer(now);
			else { dbg.note = "couldn't mark a grain — using the belt route"; return null; }
		}
	} else if (trc) {   // the grain was consumed (a machine, a Remover) — watch where it went
		dbg.phase = "tracer consumed — watching";
		dbg.note = "lost the tracer at " + trc.x + "," + trc.y + " — watching for what came out";
		trc.search = { x: trc.x, y: trc.y, orig: trc.orig, at: now, t0: now, before: snapArea(trc.x, trc.y, 20) };
	}
	if (!trc) return null;
	return { x: trc.x * CELL + CELL / 2, y: trc.y * CELL + CELL / 2 };
}
// safety: never leave our element in the world
function sweepTracers() {
	safe(() => { const hook = window.__brandonSandboxLoop; if (hook && hook.cancelEmitOnce) hook.cancelEmitOnce(); });
	waitEmit = null;
	if (trc) release();
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
		safe(() => api.structures.forEachOfType(id, (s) => { if (typeof s.x === "number") { m.set(s.x + "," + s.y, d); n++; } }));
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
		if (setting("mixTour", true)) return null;         // let a tour stop happen, then a new path
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
	if (setting("useTracer", true)) t = tracerTick(now);
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
		const maxMs = setting("followMaxSeconds", 90) * 1000;
		const longRide = trc && now - trc.since > maxMs;
		if (longRide || (path && now - pathAt > maxMs)) {
			if (longRide) release();
			path = null; fol = null;
			if (setting("mixTour", true)) { tour = nextLeg(); cam = null; }
		}
		const t = !tour ? followTick(now) : null;
		if (t) {
			if (!cam) cam = camNow();
			const k = 0.12; cam = { x: cam.x + (t.x - cam.x) * k, y: cam.y + (t.y - cam.y) * k };
			state.session.overrideCamera = toCam(cam);
			return;
		}
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
setInterval(() => { if (!active && trc) { dbg.note = "cleanup: handing the grain back"; release(); } }, 2000);
safe(() => window.addEventListener("beforeunload", () => safe(release)));
// safety: if the page is hidden (alt-tabbed / minimized) the wake lock is released by the browser; re-take it when visible
safe(() => document.addEventListener("visibilitychange", () => { if (active && document.visibilityState === "visible" && !wakeLock) safe(() => navigator.wakeLock.request("screen").then((l) => { wakeLock = l; }).catch(() => {})); }));

// --- hook for other mods (the Sandbox Loop panel has a "Start now" button) ----
safe(() => { window.__brandonScreensaver = {
	build: BUILD,
	isActive: () => active,
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
function Pill() {
	const [, b] = React.useState(0); repaint = b;
	if (!setting("enabled", true) || !setting("showStatus", true) || !inWorld() || active) return null;
	const left = Math.max(0, setting("idleMinutes", 10) * 60000 - idleMs());
	return h("div", { title: "Sandustry Screensaver: starts after " + setting("idleMinutes", 10) + " min without input. Any key or mouse movement stops it.", style: { position: "fixed", right: "12px", bottom: "12px", zIndex: 99997, pointerEvents: "none", font: '600 10px -apple-system,"Segoe UI",Roboto,sans-serif', color: "#8a94a0", background: "rgba(10,14,20,0.6)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "6px", padding: "2px 7px" } },
		"🌙 screensaver in " + Math.ceil(left / 60000) + "m");
}
if (h) { safe(() => api.ui.inject("brandon-screensaver-pill", Pill)); setInterval(() => { if (repaint) repaint((v) => v + 1); }, 15000); }

safe(() => api.events.on("game:ready", () => indexBelts(true)));
setTimeout(() => safe(() => indexBelts(true)), 8000);
console.log("[" + MOD_ID + "] loaded — build " + BUILD);
