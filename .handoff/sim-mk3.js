// sim-mk3.js — Manufacturing 0.15.x: the Filter Mk.3 block of mods/manufacturing/main.real.js
// (the source of truth, not the hot-load stub), run the way the game runs it (strict mode,
// inside an async wrapper, top-level await) against a mocked sandkit. Checks:
//   (a) building:placed on a Mk.3 copies store.options.defaultFilter with affectsLiquid /
//       affectsGas true and its own copy of the element array; other buildings and a Mk.3
//       that already carries a filter (copy-paste) are left alone;
//   (b) the filterRightMk3 interactable selects the contiguous same-setting row, and Apply
//       writes it through engine structures.updateMany with a filter object per member;
//   (c) the manager-worker trigger `brandonFilterMk3Belts` is registered at 166 ms and both
//       ids are conveyor types;
//   (d) the frame:render handler copies conveyorMk2AnimationIndex [0],[1] into `mk3anim`.
// Run from anywhere:  node .handoff/sim-mk3.js   (exit 1 on any failed check)
const fs = require("fs"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "mods", "manufacturing", "main.real.js"), "utf8");
let ok = true; const check = (c, msg) => { console.log((c ? "  ok   " : "  FAIL ") + msg); if (!c) ok = false; };
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// --- the mocked game -----------------------------------------------------------------
const vanilla = { sand: 1, water: 3, wetSand: 4, copper: 36, sunsand: 40 };
const byType = {}; for (const k in vanilla) byType[vanilla[k]] = { id: k, name: k, matterType: 7, metaColor: 0x808080 };
let nextType = 60; const registered = [];
const buffers = {}, handlers = {}, intervals = [], timeouts = [], toasts = [], triggers = [], conveyors = [], interactables = {}, structDefs = {}, techNodes = {}, updateManyCalls = [];
const structs = [];   // on the map; a tile is 4 cells wide
const getAtCell = (x, y) => structs.find((s) => s.y === y && x >= s.x && x < s.x + 4) || null;
let engineActive = null;   // what engine.api.action.getActive answers: {type, id} or null
const state = { session: { building: { activeStructureType: null, placing: false }, action: { customData: {} }, rendering: { canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1920, height: 1080 }) } }, camera: { x: 0, y: 0 }, view: { zoom: 1 }, scale: 1 },
	store: { options: { defaultFilter: { mode: "allow", elementType: 1 }, showFilterOverlay: true }, discoveries: { elements: [1, 3, 4, 36] }, player: { inventory: [], buildings: ["filterRightMk2"], action: null, hotbar: { activeSlotIndex: 0 }, tech: {} } },
	shared: { mods: { conveyorMk2AnimationIndex: Uint8Array.from([0, 0]) } }, sandkit: { graphics: {} } };
const api = {
	settings: { get: () => undefined, onChange() {} },
	scene: { getActive: () => 4 },
	elements: { register: (d) => { const t = nextType++; registered.push(d); byType[t] = Object.assign({}, d); return { elementType: t }; },
		getTypeFromId: (id) => { for (const k in byType) if (byType[k].id === id) return +k; return undefined; }, getIdByType: (t) => byType[t] && byType[t].id,
		getRegisteredTypes: () => Object.keys(byType).map(Number), getDefinitionByType: (t) => byType[t], getNameByType: (t) => byType[t] && byType[t].name,
		updateDefinition(t, p) { if (byType[t]) Object.assign(byType[t], p); }, addInteractionInfo() {}, getInfoAtCell: () => null, getResolvedTypeAtCell: () => null, createAtCellWhenIdle() {}, removeAtCellWhenIdle() {} },
	terrains: { updateDefinition() {}, getTypeById: () => 15, getDefinitionByType: () => null },
	shared: { buffers: { create: (key, o) => { const b = o.type === "uint8" ? new Uint8Array(o.length) : new Uint32Array(o.length); buffers[key] = b; return b; } } },
	sprites: { loadFromMod: async () => {} },
	i18n: { register() {}, t: (k) => k },
	tech: { registerNode: (id, def) => { techNodes[id] = def; }, getDefinitionById: (id) => techNodes[id], isLockedById: () => true, isResearchedById: () => false },
	player: { buildings: { unlockById() {} }, getWorldPosition: () => ({ x: 0, y: 0 }) },
	structures: { register: (d) => { structDefs[d.id] = d; }, getAtCell, forEachOfType: (id, cb) => structs.filter((s) => s.type === id).forEach(cb), recipes: { register() {} } },
	structureBehaviors: { registerConveyorType: (id, o) => conveyors.push({ id, o }) },
	signals: { interactables: { register: (id, fn) => { interactables[id] = fn; } } },
	ui: { inject: () => true, toast: (t) => toasts.push(t), update() {}, overlays: { register: () => true, update() {} } },
	upgrades: { getLevelById: () => 0 },
	items: { register() {} },
	action: { getActive: () => null },
	input: { getMouseCellPosition: () => null },
	grid: { forEachCellInCircle() {} },
	world: { getDimensions: () => ({ widthCells: 100, heightCells: 100 }), getCellIdAtCell: () => 0, isTerrainAtCell: () => false, excavateAtCell() {} },
	events: { on: (name, fn) => { (handlers[name] = handlers[name] || []).push(fn); } },
};
const engine = { state, api: { action: { getActive: (st) => (st === state ? engineActive : undefined) },
	structures: { updateMany: (st, list, opts) => updateManyCalls.push({ st, list, opts }) },
	building: { cancelPlacement() {}, selectStructure() {} },
	workers: { triggers: { register: (st, id, def) => triggers.push({ st, id, def }) } } } };
const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useState: (v) => [v, () => {}], useEffect() {}, useRef: () => ({ current: null }), Fragment: "Fragment" };
const sandkit = { api, engine, state, react: React,
	enums: { MatterType: { Solid: 1, Liquid: 2, Gas: 4, Slushy: 6, Powder: 7, Static: 8, Wisp: 9, Particle: 99 }, Scene: { MainMenu: 1, Intro: 2, Deploy: 3, Game: 4 },
		ActionState: { Start: 1, Active: 2, End: 3 }, ItemType: { Tool: 1 }, ItemId: { Vacuum: 7, Grabber: 8 }, Tech: { Shaker: 10, Smelter: 20, AdvancedFilters: 30 }, StructureType: { FilterLeft: 17, FilterRight: 18 }, ComponentId: {} } };
global.window = { addEventListener() {}, localStorage: { getItem: () => null, setItem() {} } };
global.document = { querySelectorAll: () => [], createElement: () => ({ style: {}, addEventListener() {}, appendChild() {} }), head: { appendChild() {} }, body: { appendChild() {} } };
global.setInterval = (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; }; global.clearInterval = () => {};
global.setTimeout = (fn, ms) => { timeouts.push({ fn, ms }); return timeouts.length; };
global.requestAnimationFrame = () => 0; global.cancelAnimationFrame = () => {};

(async () => {
	const log = console.log, err = console.error; console.log = () => {}; console.error = () => {};
	const wrapped = new AsyncFunction("sandkit", '"use strict";\n' + src + "\nreturn { get mk3(){return mk3}, mk3Row, mk3Select, mk3Apply, mk3Cfg, FilterMk3Panel, get mk3Ready(){return mk3Ready}, MK3_R, MK3_L };");
	const M = await wrapped(sandkit);
	console.log = log; console.error = err;
	const R = M.MK3_R, L = M.MK3_L;
	check(M.mk3Ready === true, "the Mk.3 structures registered (mk3Ready)");
	check(structDefs[R] && structDefs[L] && structDefs[R].variants.some((v) => v.id === "filterWallMk2"), "filterRightMk3 / filterLeftMk3 registered, vertical variant = the vanilla filterWallMk2");
	const ss = structDefs[R] && structDefs[R].render.spritesheet, ssL = structDefs[L] && structDefs[L].render.spritesheet;
	check(ss && ss.frames === 4 && ss.frameBuffer && ss.frameBuffer.key === "mk3anim" && ss.frameBuffer.index === 1 && ssL.frameBuffer.index === 0, "spritesheet: 4 frames from buffer mk3anim, right reads [1], left reads [0]");

	// --- (a) building:placed copies the default filter --------------------------------------
	const placed = handlers["building:placed"] || [];
	check(placed.length >= 1, placed.length + " building:placed handler(s)");
	const fire = (name, p) => (handlers[name] || []).forEach((f) => f(p));
	state.store.options.defaultFilter = { mode: "block", elementType: [3, 36] };
	const s1 = { type: R, x: 200, y: 20 };
	fire("building:placed", { structure: s1, x: 200, y: 20, isBatch: false, isCopied: false });
	check(!!s1.filter && s1.filter.mode === "block" && JSON.stringify(s1.filter.elementType) === "[3,36]", "a new Mk.3 takes defaultFilter's mode + materials: " + JSON.stringify(s1.filter));
	check(s1.filter && s1.filter.affectsLiquid === true && s1.filter.affectsGas === true, "…with affectsLiquid / affectsGas true (as the game does for a new Mk.2)");
	check(s1.filter && s1.filter.elementType !== state.store.options.defaultFilter.elementType, "…and its own copy of the array (a later panel edit must not change the placed row)");
	check(state.store.options.defaultFilter.affectsLiquid === undefined && state.store.options.defaultFilter.mode === "block", "defaultFilter itself is untouched");
	const s2 = { type: "filterRightMk2", x: 204, y: 20 };
	fire("building:placed", { structure: s2 });
	check(s2.filter === undefined, "a vanilla filter is left to the game");
	const kept = { mode: "allow", elementType: 1 }, s3 = { type: L, x: 208, y: 20, filter: kept };
	fire("building:placed", { structure: s3, isCopied: true });
	check(s3.filter === kept, "a copy-pasted Mk.3 keeps its own filter");
	check(M.mk3.lastPlaced && M.mk3.lastPlaced.x === 208 && M.mk3.lastPlaced.y === 20, "lastPlaced follows the newest Mk.3 (for 'Edit last placed')");

	// --- (b) the interactable selects the row; Apply writes it via updateMany -------------
	const F = () => ({ mode: "allow", elementType: [3], affectsLiquid: true, affectsGas: true });
	structs.push({ type: R, x: 100, y: 50, filter: F() }, { type: R, x: 104, y: 50, filter: F() }, { type: R, x: 108, y: 50, filter: F() },
		{ type: R, x: 112, y: 50, filter: Object.assign(F(), { elementType: [36] }) },   // touching, but a different setting
		{ type: R, x: 120, y: 50, filter: F() },                                          // same setting, a gap
		{ type: L, x: 96, y: 50, filter: F() },                                           // touching, other direction
		{ type: R, x: 100, y: 54, filter: F() });                                         // the row below
	check(typeof interactables[R] === "function" && typeof interactables[L] === "function", "interactables registered for both Mk.3 ids");
	engineActive = { type: "structure", id: R };
	interactables[R](getAtCell(105, 50));   // a click on the middle member
	const sel = M.mk3.sel;
	check(!!sel && sel.members.length === 3 && sel.members.map((m) => m.x).join(",") === "100,104,108", "the click selected the contiguous same-setting row: " + (sel ? sel.members.map((m) => m.x).join(",") : "none"));
	const hook = global.window.__brandonFilterMk3;
	check(!!hook && hook.selection() && hook.selection().count === 3 && hook.selection().type === R, "window.__brandonFilterMk3.selection() reports the row (count 3)");
	check(hook && JSON.stringify(hook.draft()) === JSON.stringify({ mode: "allow", elementType: [3], affectsLiquid: true, affectsGas: true }), "draft() starts as the row's own filter: " + JSON.stringify(hook.draft()));
	const draft = { mode: "block", elementType: [36, 3] };
	check(hook.setDraft(draft) === true && M.mk3.draft !== draft && JSON.stringify(M.mk3.draft) === JSON.stringify(draft), "setDraft() copies the draft in");
	check(updateManyCalls.length === 0, "nothing is written before Apply");
	check(hook.apply() === true, "apply() accepted while a row is selected");
	check(updateManyCalls.length === 1 && updateManyCalls[0].st === state && updateManyCalls[0].opts && updateManyCalls[0].opts.propagateToWorkers === true, "one engine structures.updateMany(state, members, {propagateToWorkers:true}) call");
	const written = updateManyCalls[0] ? updateManyCalls[0].list : [];
	check(written.length === 3 && written.map((m) => m.x).join(",") === "100,104,108", "…for exactly the 3 row members");
	check(written.every((m) => m.filter.mode === "block" && JSON.stringify(m.filter.elementType) === "[36,3]"), "each member now blocks copper + water");
	check(written.every((m) => m.filter.affectsLiquid === true && m.filter.affectsGas === true), "each member kept its affectsLiquid / affectsGas true (Apply writes mode + elementType only)");
	check(new Set(written.map((m) => m.filter)).size === 3 && written.every((m) => m.filter !== draft), "a filter object per member, none of them the draft itself");
	check(getAtCell(112, 50).filter.mode === "allow" && getAtCell(120, 50).filter.mode === "allow" && getAtCell(96, 50).filter.mode === "allow", "the neighbours outside the row are untouched");
	check(M.mk3.sel === null && hook.selection() === null && hook.apply() === false, "the selection is closed after Apply; apply() refuses with no row");
	// the panel: shown while a Mk.3 is in hand (the game's own answer), gone when it isn't
	check(M.FilterMk3Panel() !== null, "FilterMk3Panel renders while engine action.getActive says a Mk.3 is in hand");
	engineActive = { type: "structure", id: "filterRightMk2" };
	check(M.FilterMk3Panel() === null, "…and renders nothing when a Mk.2 is in hand");
	engineActive = null;

	// --- (c) the belt trigger and the conveyor types ---------------------------------------
	const trig = triggers.filter((t) => t.id === "brandonFilterMk3Belts");
	check(trig.length >= 1 && trig[0].st === state, "trigger brandonFilterMk3Belts registered through engine workers.triggers with the engine state");
	check(trig.length && trig[0].def.interval === 166 && trig[0].def.sequentialRuns === 2, "…interval 166 ms, 2 sequential runs (right then left)");
	check(trig.length && typeof trig[0].def.callback === "function" && !/MOD_ID|MK3_R|MK3_L|safe\(/.test(trig[0].def.callback.toString()), "…the callback is self-contained (it is sent to the manager worker as text)");
	check(conveyors.some((c) => c.id === R && c.o.velocity.x === 1) && conveyors.some((c) => c.id === L && c.o.velocity.x === -1), "both ids registered as conveyor types (velocity +1 / -1)");
	const nT = triggers.length, nC = conveyors.length;
	fire("game:ready");
	check(triggers.length === nT + 1 && conveyors.length === nC + 2, "game:ready re-sends the trigger and both conveyor types (new worker threads)");

	// --- (d) frame:render mirrors the Mk.2 belt frame counter ------------------------------
	const buf = buffers["mk3anim"];
	check(buf instanceof Uint8Array && buf.length === 2, "shared buffer mk3anim is uint8[2]");
	const fr = handlers["frame:render"] || [];
	check(fr.length >= 1, fr.length + " frame:render handler(s)");
	state.shared.mods.conveyorMk2AnimationIndex = Uint8Array.from([2, 3]);
	fr.forEach((f) => f());
	check(buf && buf[0] === 2 && buf[1] === 3, "after a frame the buffer holds [2, 3] (left, right) from conveyorMk2AnimationIndex");
	state.shared.mods.conveyorMk2AnimationIndex[0] = 1; state.shared.mods.conveyorMk2AnimationIndex[1] = 0;
	fr.forEach((f) => f());
	check(buf && buf[0] === 1 && buf[1] === 0, "…and follows it frame by frame ([1, 0])");

	// the element list never reorders (saves store the numbers)
	check(registered.map((d) => d.id).join(",") === "HeavyStone,glass,Sand", "ELEMENTS registered in the fixed order HeavyStone, glass, Sand");

	console.log(ok ? "\nALL OK" : "\nFAIL: see above"); process.exit(ok ? 0 : 1);
})().catch((e) => { console.error("harness crashed:", e); process.exit(1); });
