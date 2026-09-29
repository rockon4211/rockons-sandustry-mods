// sim-mk3.js — Manufacturing 0.16.x: the Filter Mk.3 block of mods/manufacturing/main.real.js
// (the source of truth, not the hot-load stub), run the way the game runs it (strict mode,
// inside an async wrapper, top-level await) against a mocked sandkit. Checks:
//   (a) building:placed on a Mk.3 copies store.options.defaultFilter with affectsLiquid /
//       affectsGas true and its own copy of the element array; other buildings and a Mk.3
//       that already carries a filter (copy-paste) are left alone;
//   (b) Manufacturing 0.16.0: the Mk.3 joins the game's own filter lists through
//       Array.prototype.includes (in every list its Mk.2 twin is in; every other answer
//       unchanged), the panel's material pick can't swap a held Mk.3 for a Mk.2, a Mk.3 taken
//       up opens the panel expanded, and the self-check asks the game's editor to select one;
//   (c) (0.16.2) the sim grid stores a Mk.3 as a Mk.2 belt (blockGridType) and there is no
//       Mk.3 trigger or mod conveyor type any more (0.14-0.16.1 had a separate 166 ms one);
//   (d) the frame:render handler copies conveyorMk2AnimationIndex [0],[1] into `mk3anim`.
// Run from anywhere:  node .handoff/sim-mk3.js   (exit 1 on any failed check)
const fs = require("fs"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "mods", "manufacturing", "main.real.js"), "utf8");
let ok = true; const check = (c, msg) => { console.log((c ? "  ok   " : "  FAIL ") + msg); if (!c) ok = false; };
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// --- the mocked game -----------------------------------------------------------------
const vanilla = { sand: 1, water: 3, wetSand: 4, copper: 36, sunsand: 40 };
const byType = {}; for (const k in vanilla) byType[vanilla[k]] = { id: k, name: k, matterType: 7, metaColor: 0x808080 };
let nextType = 60; const registered = [], spriteLoads = [];
const buffers = {}, handlers = {}, intervals = [], timeouts = [], toasts = [], triggers = [], conveyors = [], interactables = {}, structDefs = {}, techNodes = {}, updateManyCalls = [];
const structs = [];   // on the map; a tile is 4 cells wide
const getAtCell = (x, y) => structs.find((s) => s.y === y && x >= s.x && x < s.x + 4) || null;
let engineActive = null, edAccepts = true, edBusy = false; const editorOps = [];   // what engine.api.action.getActive answers: {type, id} or null
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
	sprites: { loadFromMod: async (n, f) => { spriteLoads.push([n, f]); } },
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
	filterGroupEditor: { getSelection: () => { editorOps.push("getSelection"); return edBusy ? { structureType: "filterRightMk2" } : null; }, selectAt: () => { editorOps.push("selectAt"); return edAccepts; }, cancel: () => { editorOps.push("cancel"); } },
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
	const wrapped = new AsyncFunction("sandkit", '"use strict";\n' + src + "\nreturn { get mk3Ready(){return mk3Ready}, get filterListsOk(){return filterListsOk}, checkFilterLists, resetChecked(){ mk3Checked = false; }, MK3_R, MK3_L };");
	const M = await wrapped(sandkit);
	console.log = log; console.error = err;
	const R = M.MK3_R, L = M.MK3_L;
	check(M.mk3Ready === true, "the Mk.3 structures registered (mk3Ready)");
	check(structDefs[R] && structDefs[L] && structDefs[R].variants.some((v) => v.id === "filterWallMk2"), "filterRightMk3 / filterLeftMk3 registered, vertical variant = the vanilla filterWallMk2");
	const ss = structDefs[R] && structDefs[R].render.spritesheet, ssL = structDefs[L] && structDefs[L].render.spritesheet;
	check(ss && ss.frames === 4 && ss.frameBuffer && ss.frameBuffer.key === "mk3anim" && ss.frameBuffer.index === 1 && ssL.frameBuffer.index === 0, "spritesheet: 4 frames from buffer mk3anim, right reads [1], left reads [0]");
	// 0.16.1: icons (tech tree, build menu, hotbar) use render.ui.imageName when set - a single
	// frame - instead of the whole strip, which showed four filters side by side
	const ui = structDefs[R] && structDefs[R].render.ui;
	check(ui && ui.imageName === "brandon_filter_right_mk3_icon" && ui.size && ui.size.width === 18 && ui.size.height === 18 && structDefs[R].render.imageName === "brandon_filter_right_mk3",
		"the icon is the one-frame brandon_filter_right_mk3_icon (18x18); the world still draws the animated strip");
	check(spriteLoads.some((l) => l[0] === "brandon_filter_right_mk3_icon" && l[1] === "filter_right_mk3_icon.png"), "…loaded from filter_right_mk3_icon.png");
	const icon = fs.readFileSync(path.join(__dirname, "..", "mods", "manufacturing", "filter_right_mk3_icon.png"));
	check(icon.readUInt32BE(16) === 18 && icon.readUInt32BE(20) === 18, "filter_right_mk3_icon.png is 18x18 (one frame)");

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

	// --- (b) the Mk.3 joins the game's filter lists (Array.prototype.includes) ---------------
	// the game's own lists, as its bundle writes them (Mk.1 ids are numbers)
	const hk = [17, 18, "filterLeftMk2", "filterRightMk2"], mk = ["filterWall", "filterWallMk2"], pk = [...hk, ...mk], gk = [17, "filterLeftMk2"], Uk = ["filterLeftMk2", "filterRightMk2", "filterWallMk2"], hotbarM = [18, 17, "filterRightMk2", "filterLeftMk2"];
	check(Array.prototype.includes.__brandonMk3 === true, "Array.prototype.includes is the Mk.3-aware one");
	check(pk.includes(R) && pk.includes(L) && hk.includes(R) && Uk.includes(L) && hotbarM.includes(R) && hotbarM.includes(L), "both Mk.3s are in the filter list, the Mk.2 list and the hotbar list");
	// 0.16.1: the unlocked-buildings list holds the Mk.2 too, but it is NOT a filter list - in 0.16.0
	// it "already had" the Mk.3, so buying the research never added it and it never reached the
	// build menu. The game unlocks with `buildings.includes(id) || buildings.push(id)`.
	const owned = state.store.player.buildings = ["conveyorRight", "shakerRight", "filterRightMk2", "filterLeftMk2", "filterWallMk2"];
	check(!owned.includes(R) && !owned.includes(L), "the unlocked-buildings list (Mk.2 + other buildings) does NOT claim to hold a Mk.3");
	const gameUnlock = (id) => { const b = state.store.player.buildings; b.includes(id) || b.push(id); };   // the game's own add, verbatim
	gameUnlock(R);
	check(owned.includes(R) && owned.filter((x) => x === R).length === 1, "buying the research adds filterRightMk3 to the build menu list (once)");
	// the fallback for saves that researched it but never got the building (every 0.16.0 save)
	state.store.player.buildings = ["conveyorRight", "filterRightMk2"];
	api.player.buildings.unlockById = gameUnlock;
	api.tech.isResearchedById = (id) => id === "brandonFilterMk3";
	for (const iv of intervals) if (/TECH_FILTER_MK3/.test(String(iv.fn)) && /unlockById/.test(String(iv.fn))) iv.fn();
	check(state.store.player.buildings.includes("filterRightMk3") && state.store.player.buildings.length === 3, "a save that researched Filter Mk.3 without getting it (0.16.0) gets it from the fallback: " + JSON.stringify(state.store.player.buildings));
	api.tech.isResearchedById = () => false;
	check(gk.includes(L) && !gk.includes(R), "the left-facing list takes the left Mk.3 only");
	check(!mk.includes(R) && !mk.includes(L), "the walls list does not take a Mk.3");
	check(["filterRightMk2", "filterLeftMk2"].includes(R), "the placement / paste checks (a literal [Mk.2 right, left]) take it too");
	check(![1, 2].includes(3) && [1, 2].includes(2) && [NaN].includes(NaN) && ![1, 2, 3].includes(1, 1) && !["a"].includes(R), "every other includes answers exactly as before (NaN, fromIndex, unrelated lists)");
	check(Object.keys(Array.prototype).indexOf("includes") === -1, "…and it is not enumerable (for..in over arrays is unchanged)");
	check(M.filterListsOk === true, "the mod's own self-check passed");
	check(global.window.__brandonFilterMk3 === undefined, "no cloned Mk.3 panel hook any more (the game's panel serves it)");

	// --- the two spots that name the Mk.2 outright ------------------------------------------
	const frame = () => (handlers["frame:render"] || []).forEach((f) => f());
	const B = state.session.building;
	B.activeStructureType = null; B.filterForceExpand = false; frame();
	B.activeStructureType = R; state.store.player.action = { type: "building", id: R }; frame();
	check(B.filterForceExpand === true, "taking a Mk.3 up opens the game's panel expanded (filterForceExpand), as the build menu does for a Mk.2");
	B.activeStructureType = "filterRightMk2"; frame();   // the panel's material pick
	check(B.activeStructureType === R, "the panel's material pick swapped the hand to a Mk.2 right - put back to the Mk.3");
	B.activeStructureType = L; state.store.player.action = { type: "building", id: L }; frame();
	B.activeStructureType = "filterRightMk2"; frame();
	check(B.activeStructureType === L, "…a left Mk.3 stays a left Mk.3");
	state.store.player.action = null; state.store.player.hotbar = { bars: [[null, { type: "building", id: R }]], hotbarIndex: 0, activeSlotIndex: 1 };
	B.activeStructureType = R; frame(); B.activeStructureType = "filterRightMk2"; frame();
	check(B.activeStructureType === R, "…also when the Mk.3 came from the hotbar");
	state.store.player.hotbar = { activeSlotIndex: null }; state.store.player.action = { type: "building", id: "filterRightMk2" };
	B.activeStructureType = R; frame(); B.activeStructureType = "filterRightMk2"; frame();
	check(B.activeStructureType === "filterRightMk2", "a real switch to a Mk.2 is left alone");
	B.activeStructureType = null; state.store.player.action = null; state.store.player.hotbar = { activeSlotIndex: 0 }; frame();

	// --- the check against the game's own editor ---------------------------------------------
	structs.push({ type: R, x: 100, y: 50, filter: { mode: "allow", elementType: [3] } });
	const nToast = toasts.length;
	edAccepts = true; M.checkFilterLists();
	check(editorOps.join(",") === "getSelection,selectAt,cancel" && toasts.length === nToast, "with a Mk.3 placed, the game's editor is asked to select it (then cancelled); it accepts → no warning");
	M.resetChecked(); edAccepts = false; editorOps.length = 0; M.checkFilterLists();
	check(toasts.length === nToast + 1 && /Filter Mk\.3 menu/.test(toasts[toasts.length - 1]), "if the editor refuses a Mk.3, a toast says so");
	M.resetChecked(); edBusy = true; editorOps.length = 0; M.checkFilterLists();
	check(editorOps.join(",") === "getSelection", "…and a row already open in the editor is never disturbed");
	edBusy = false;

	// --- (c) moving (0.16.2): the sim grid stores a Mk.3 as a Mk.2 belt ---------------------
	// blockGridType aliases the grid type, so the game's own Mk.2 belt pass moves it, in the
	// same sweep as the belts around it. The old separate trigger + mod conveyor type (a second
	// sweep that let grains through one or two at a time) must be gone, or it would move twice.
	check(structDefs[R].blockGridType === "conveyorRightMk2" && structDefs[L].blockGridType === "conveyorLeftMk2", "the sim grid sees a right Mk.3 as conveyorRightMk2 and a left one as conveyorLeftMk2");
	check(structDefs[R].id === R && structDefs[L].id === L, "…while the structure itself keeps its own id (menus, labels, saves)");
	fire("game:ready");
	check(!triggers.some((t) => t.id === "brandonFilterMk3Belts") && !conveyors.some((c) => c.id === R || c.id === L), "no separate Mk.3 belt trigger and no mod conveyor type (not even after game:ready)");

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
