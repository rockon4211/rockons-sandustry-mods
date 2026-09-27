// sim-mapsweep.js — Screensaver 0.18.3: the whole-map tracer sweep. A seeded grid holds a
// few tracer grains among ordinary material; after the sweep every tracer cell is empty,
// the ordinary cells are untouched, a `map-sweep` log event was written with ONLY the real
// deletes counted, `isSweeping()` answers true while it runs, a sweep that is running when
// a screensaver run starts (`active`) is abandoned, and ~100 consecutive read errors abort
// it (a transient error does not). Also: every element the Screensaver registers (5 generic
// tracers + a copy per material) carries the game's own `showInFilterPicker: false`.
// Run from anywhere:  node .handoff/sim-mapsweep.js   (exit 1 on any failed check)
//
// The mod is booted twice: once with `api.world.mutate` (0.18.3 removes inside the mutate
// callback after re-reading the cell, so a grain that moved on since the outer read is
// left alone and not counted) and once without it (the `removeAtCellWhenIdle` fallback,
// which the real engine performs on ANY element still in the slot). Timers are recorded,
// not run: the 50 ms sweep interval is driven by hand, a tick at a time.
const fs = require("fs"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "mods", "screensaver", "main.js"), "utf8");
let ok = true; const check = (c, msg) => { console.log((c ? "  ok   " : "  FAIL ") + msg); if (!c) ok = false; };

// --- a small mocked game --------------------------------------------------------------
const W = 300, H = 200;   // 60,000 cells: more than one 25k-cell slice, so the sweep needs several ticks
const E = [["sand", 1, "soil", 7], ["water", 3, "Water", 2], ["wetSand", 4, "Wet Soil", 6], ["copper", 36, "Copper", 1]];
const IDS = {}, defs = {}, byType = {};
for (const [id, t, name, mt] of E) { IDS[id] = t; byType[t] = id; defs[t] = { name, matterType: mt, density: 100 + t, metaColor: 0x886644, colors: { variants: [[100, 80, 60, 255]] } }; }
const cells = new Map(); const K = (x, y) => x + "," + y;
// `movers`: cells whose tracer grain "moves on" the moment it is first read — the slot then
// holds soil, as it would when the sim ran between the sweep's read and its delete
const movers = new Set(); let throwing = false, reads = 0;
function typeAt(x, y) {
	if (throwing) throw new Error("harness: read error");
	reads++;
	if (x < 0 || y < 0 || x >= W || y >= H) return null;
	const k = K(x, y), t = cells.get(k) || 0;
	if (movers.has(k)) { movers.delete(k); cells.set(k, IDS.sand); }
	return t;
}
const removed = [];   // every removal the mod asked for, whichever API it used
function removeCell(x, y, how, onlyIfHeld) { const k = K(x, y); if (onlyIfHeld && !cells.get(k)) return; removed.push({ x, y, how, was: cells.get(k) }); cells.delete(k); }
let NOW = 1e9; const RD = Date; global.Date = class extends RD { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } };
global.performance = { now: () => NOW };
global.requestAnimationFrame = () => 0; global.clearTimeout = () => {}; global.clearInterval = () => {};
global.navigator = { wakeLock: { request: () => Promise.resolve({ release() {} }) } };
global.document = { addEventListener() {}, createElement: () => ({ remove() {} }), head: { appendChild() {} }, body: { appendChild() {} }, getElementById: () => null };

function boot(withMutate) {
	let next = 55; const regs = {}, registerCalls = [], handlers = {}, intervals = [], timeouts = [], toasts = [];
	for (const k of Object.keys(byType)) if (+k >= 55) delete byType[k];
	const world = { getDimensions: () => ({ widthCells: W, heightCells: H }), isCellEmptyAtCell: (x, y) => !typeAt(x, y), isTerrainAtCell: () => false };
	// the writer handed to a mutate callback: it trusts the caller (no re-check), the same grid
	if (withMutate) world.mutate = (cb) => cb({ elements: { removeAtCell: (x, y) => removeCell(x, y, "mutate.removeAtCell"), createAtCell() {}, replaceAtCell() {} } });
	global.sandkit = { api: {
		elements: { getRegisteredTypes: () => Object.keys(defs).map(Number).concat(Object.keys(regs).map(Number)).sort((a, b) => a - b),
			getResolvedTypeAtCell: typeAt, getInfoAtCell: (x, y) => ({ elementType: typeAt(x, y), isParticle: false }),
			getNameByType: (t) => (defs[t] || regs[t] || {}).name, getDefinitionByType: (t) => defs[t] || regs[t],
			getIdByType: (t) => byType[t], getTypeFromId: (id) => { for (const k in byType) if (byType[k] === id) return +k; return undefined; },
			register: (d) => { registerCalls.push(d); const t = next++; regs[t] = JSON.parse(JSON.stringify(d)); byType[t] = d.id; return { elementType: t }; },
			updateDefinition(t, p) { if (regs[t]) Object.assign(regs[t], p); },
			// the engine's WhenIdle delete only checks that the slot still holds SOME element
			removeAtCell: (x, y) => removeCell(x, y, "removeAtCell"), removeAtCellWhenIdle: (x, y) => removeCell(x, y, "removeAtCellWhenIdle", true),
			replaceAtCell() {}, replaceAtCellWhenIdle() {}, createAtCellWhenIdle() {}, isFreeFallingAtCell: () => false, getVelocityAtCell: () => ({ x: 0, y: 0 }) },
		world,
		reactions: { registerContact() {} },
		structures: { getAtCell: () => null, forEachOfType: () => {}, getTypeById: () => 5, recipes: { register() {} } },
		settings: { get: () => undefined }, scene: { getActive: () => 4 }, ui: { update() {}, inject() {}, toast: (t) => toasts.push(t) },
		events: { on: (name, fn) => { (handlers[name] = handlers[name] || []).push(fn); } } },
		state: { sandkit: { mods: { recipes: { contacts: [], shakers: [], kineticPresses: [], growers: [], condensers: [], steamDryers: [], synthesizers: [], snowmakers: [], smelters: [] } } },
			session: { overrideCamera: false, ui: {}, settings: {}, view: { zoom: 2 }, rendering: { canvas: { width: 1920, height: 1080 } } }, store: { structures: [], player: { x: 0, y: 0 }, meta: { worldId: "w1" } } },
		enums: { Scene: { MainMenu: 1, Intro: 2, Deploy: 3, Game: 4 }, ElementType: { Empty: 0 }, ComponentId: {}, MatterType: { Solid: 1, Liquid: 2, Gas: 4, Slushy: 6, Powder: 7, Static: 8, Wisp: 9, Particle: 99 } }, react: null };
	global.window = { addEventListener() {}, localStorage: { setItem() {}, getItem: () => null }, __brandonSandboxLoop: { sources: () => [], emitOnce() {}, emitOnceResult: () => null, cancelEmitOnce() {} } };
	global.setInterval = (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; };
	global.setTimeout = (fn, ms) => { timeouts.push({ fn, ms }); return timeouts.length; };
	const log = console.log; console.log = () => {};
	eval('"use strict";\n' + src + "\nglobal.M = { get mapSweep(){return mapSweep}, get active(){return active}, set active(v){active=v}, get tlog(){return tlog}, get tracerTypes(){return tracerTypes}, startMapSweep };");
	console.log = log;
	const sweepTicks = intervals.filter((i) => i.ms === 50);
	return { M: global.M, hook: global.window.__brandonScreensaver, registerCalls, handlers, timeouts, toasts, sweepTicks, runTick: () => sweepTicks.forEach((i) => i.fn()) };
}
const tracerCellsLeft = (M) => [...cells.entries()].filter(([, t]) => M.tracerTypes.has(t)).map(([k]) => k);
const ordinaryLeft = (M) => [...cells.entries()].filter(([, t]) => !M.tracerTypes.has(t)).length;
function seed(M, withMover) {
	const tracers = [...M.tracerTypes];
	cells.clear(); removed.length = 0; movers.clear(); throwing = false;
	cells.set(K(0, 0), tracers[0]); cells.set(K(17, 3), tracers[1]); cells.set(K(150, 100), tracers[2 % tracers.length]);
	cells.set(K(W - 1, H - 1), tracers[3 % tracers.length]);   // the very last cell: only reached when the whole map was read
	cells.set(K(5, 5), IDS.sand); cells.set(K(299, 0), IDS.water); cells.set(K(100, 150), IDS.copper);
	if (withMover) { cells.set(K(40, 40), tracers[4 % tracers.length]); movers.add(K(40, 40)); }   // a tracer that moves on before the delete
	return tracers;
}
const events = (M) => M.tlog.filter((e) => e.kind === "map-sweep");
function runToEnd(G, max) { let n = 0; while (G.M.mapSweep && n < (max || 1000)) { G.runTick(); n++; } return n; }

// =====================================================================================
console.log("== boot A: api.world.mutate present (0.18.3 path: re-read inside the callback)");
const A = boot(true);
// --- 1. every registered element is kept out of the pickers ----------------------------
check(A.registerCalls.length >= 5 + E.length, "registered " + A.registerCalls.length + " elements (5 generic tracers + a copy per material)");
const shown = A.registerCalls.filter((d) => d.showInFilterPicker !== false).map((d) => d.id);
check(shown.length === 0, "every api.elements.register call carries showInFilterPicker === false" + (shown.length ? " — missing on: " + shown.join(", ") : ""));
check(A.registerCalls.every((d) => /^brandonTrc_|^brandonTracer/.test(d.id)), "every registered id starts with brandonTrc_ / brandonTracer (the pickers' own by-id filter)");
check(A.M.tracerTypes.size >= 5, "the mod knows " + A.M.tracerTypes.size + " tracer types");
check(A.sweepTicks.length >= 1, "a 50 ms interval drives the sweep (" + A.sweepTicks.length + " registered)");

// --- 2. the sweep removes every tracer grain that is still there, and nothing else ------
seed(A.M, true); A.M.active = false;
check(A.M.startMapSweep("harness") === true, "startMapSweep() accepts the request in a world");
check(A.hook && typeof A.hook.isSweeping === "function" && A.hook.isSweeping() === true, "isSweeping() answers true while a sweep is running");
A.runTick();
check(!!A.M.mapSweep, "the sweep is time-sliced: one tick did not finish " + W * H + " cells");
const ticksA = 1 + runToEnd(A);
check(!A.M.mapSweep && A.hook.isSweeping() === false, "the sweep finished after " + ticksA + " ticks and isSweeping() is false again");
check(tracerCellsLeft(A.M).length === 0, "every tracer cell was emptied (" + removed.length + " removals via " + [...new Set(removed.map((r) => r.how))].join("/") + ")");
check(removed.every((r) => r.how === "mutate.removeAtCell"), "every delete went through api.world.mutate → removeAtCell (not removeAtCellWhenIdle)");
check(removed.length === 4 && removed.every((r) => A.M.tracerTypes.has(r.was)), "exactly the 4 tracers still in place were removed — the grain that moved on was left alone");
check(cells.get(K(40, 40)) === IDS.sand && ordinaryLeft(A.M) === 4, "the soil that took the moved tracer's slot survived, with the three other ordinary grains");
const evA = events(A.M);
check(evA.length === 1 && evA[0].removed === 4 && evA[0].why === "harness", "one map-sweep log event, removed = 4 (only real deletes are counted): " + JSON.stringify(evA[0] || null));
check(A.toasts.some((t) => /removed 4 stray tracer grains/.test(t)), "the player is told: " + JSON.stringify(A.toasts[A.toasts.length - 1] || null));

// --- 3. a run starting mid-sweep aborts it ---------------------------------------------
seed(A.M); A.M.active = false;
check(A.M.startMapSweep("harness 2") === true, "a second sweep can start once the first is done");
A.runTick();
A.M.active = true;   // a screensaver run began
A.runTick();
check(!A.M.mapSweep && A.hook.isSweeping() === false, "the sweep is dropped when `active` is set");
check(tracerCellsLeft(A.M).includes(K(W - 1, H - 1)), "cells past the abort point were never touched (the last cell still holds its tracer)");
check(events(A.M).length === 1, "no map-sweep event for the aborted sweep");
check(A.M.startMapSweep("while active") === false, "startMapSweep() refuses while a run is active");
A.M.active = false;

// --- 4. read errors: ~100 consecutive failed slices abort it, a transient one does not --
seed(A.M);
check(A.M.startMapSweep("errors") === true, "a sweep starts on a map whose reads are about to fail");
throwing = true;
const errTicks = runToEnd(A, 400);
check(!A.M.mapSweep && errTicks >= 100 && errTicks <= 110, "the sweep gave up after " + errTicks + " consecutive failed ticks (~100), instead of looping forever");
check(events(A.M).length === 1 && tracerCellsLeft(A.M).length === 4, "an aborted sweep logs nothing and deletes nothing");
throwing = false;
seed(A.M);
check(A.M.startMapSweep("transient") === true, "a fresh sweep after the abort");
A.runTick();   // one good slice
throwing = true; for (let i = 0; i < 30; i++) A.runTick();   // 30 bad ticks, fewer than the limit
throwing = false;
check(!!A.M.mapSweep, "30 failed ticks do not abort it");
const restTicks = runToEnd(A);
check(!A.M.mapSweep && tracerCellsLeft(A.M).length === 0, "…and once reads work again it finishes (" + restTicks + " more ticks) with every tracer gone");
check(events(A.M).length === 2 && events(A.M)[1].removed === 4, "the recovered sweep logged its 4 real deletes");

// --- 5. the hook and the schedule ----------------------------------------------------
seed(A.M);
check(!!A.hook && typeof A.hook.sweepMap === "function", "window.__brandonScreensaver.sweepMap exists");
check(A.hook.sweepMap() === true && A.hook.isSweeping() === true, "sweepMap() starts a sweep (isSweeping() true)");
runToEnd(A);
check(tracerCellsLeft(A.M).length === 0, "the hook's sweep also cleared every tracer");
check((A.handlers["game:ready"] || []).length >= 1, "a game:ready handler is registered (schedules the world-load sweep)");
const before = A.timeouts.length; (A.handlers["game:ready"] || []).forEach((f) => f());
const sched = A.timeouts.slice(before).filter((t) => t.ms >= 1000);
check(sched.length >= 1, "game:ready schedules a delayed sweep (" + sched.map((t) => t.ms + "ms").join(", ") + ")");
seed(A.M); sched.forEach((t) => t.fn());
check(!!A.M.mapSweep, "…and firing that timer starts the sweep");
runToEnd(A);
check(tracerCellsLeft(A.M).length === 0, "the world-load sweep cleared every tracer");

// =====================================================================================
console.log("== boot B: no api.world.mutate (removeAtCellWhenIdle fallback)");
const B = boot(false);
seed(B.M); B.M.active = false;
check(B.M.startMapSweep("fallback") === true, "startMapSweep() accepts the request");
const ticksB = runToEnd(B);
check(!B.M.mapSweep && ticksB > 1, "the sweep finished after " + ticksB + " ticks");
check(tracerCellsLeft(B.M).length === 0, "every tracer cell was emptied");
check(removed.length === 4 && removed.every((r) => r.how === "removeAtCellWhenIdle"), "4 deletes, all through api.elements.removeAtCellWhenIdle");
check(ordinaryLeft(B.M) === 3, "the three ordinary grains are still there");
const evB = events(B.M);
check(evB.length === 1 && (evB[0].removed === 4 || evB[0].queued === 4), "a map-sweep log event counts the 4 tracers: " + JSON.stringify(evB[0] || null));
seed(B.M); B.M.startMapSweep("fallback 2"); B.runTick(); B.M.active = true; B.runTick();
check(!B.M.mapSweep && tracerCellsLeft(B.M).includes(K(W - 1, H - 1)), "the fallback sweep is dropped too when `active` is set");
B.M.active = false;

console.log(ok ? "\nALL OK" : "\nFAIL: see above"); process.exit(ok ? 0 : 1);
